import Stripe from 'stripe';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const dynamo    = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ssmClient = new SSMClient({});

const USERS_TABLE  = process.env.USERS_TABLE;
const APP_URL      = process.env.APP_URL || 'https://tacticaldropz.com';
const PRICE_LOOKUP = process.env.STRIPE_PRICE_LOOKUP_KEY || 'TacticalDropzPro-c005ef8';

// Cache secrets in memory for Lambda warm invocations
let _stripe = null;
let _webhookSecret = null;

async function getStripe() {
  if (_stripe) return _stripe;
  const result = await ssmClient.send(new GetParameterCommand({
    Name: '/tacticaldropz/stripe/secret_key',
    WithDecryption: true,
  }));
  _stripe = new Stripe(result.Parameter.Value);
  return _stripe;
}

async function getWebhookSecret() {
  if (_webhookSecret) return _webhookSecret;
  const result = await ssmClient.send(new GetParameterCommand({
    Name: '/tacticaldropz/stripe/webhook_secret',
    WithDecryption: true,
  }));
  _webhookSecret = result.Parameter.Value;
  return _webhookSecret;
}

const response = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': APP_URL,
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    ...headers,
  },
  body: JSON.stringify(body),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getUserById(userId) {
  const result = await dynamo.send(new GetCommand({
    TableName: USERS_TABLE,
    Key: { userId },
  }));
  return result.Item || null;
}

async function getUserByEmail(email) {
  const result = await dynamo.send(new QueryCommand({
    TableName: USERS_TABLE,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': email },
  }));
  return result.Items?.[0] || null;
}

async function updateUserSubscription(userId, fields) {
  const sets = Object.entries(fields)
    .map(([k]) => `${k} = :${k}`)
    .join(', ');
  const vals = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [`:${k}`, v])
  );
  vals[':now'] = new Date().toISOString();

  await dynamo.send(new UpdateCommand({
    TableName: USERS_TABLE,
    Key: { userId },
    UpdateExpression: `SET ${sets}, updatedAt = :now`,
    ExpressionAttributeValues: vals,
  }));
}

// ── POST /stripe/create-checkout — create a Stripe Checkout session ───────────

async function createCheckout(userId) {
  const stripe = await getStripe();
  const user = await getUserById(userId);
  if (!user) return response(404, { error: 'User not found' });

  // Look up price by lookup key
  const prices = await stripe.prices.list({
    lookup_keys: [PRICE_LOOKUP],
    expand: ['data.product'],
  });

  if (!prices.data.length) return response(500, { error: 'Price not found in Stripe' });
  const priceId = prices.data[0].id;

  // Get or create Stripe customer
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId },
    });
    customerId = customer.id;
    await updateUserSubscription(userId, { stripeCustomerId: customerId });
  }

  const session = await stripe.checkout.sessions.create({
    customer:             customerId,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    mode:                 'subscription',
    success_url:          `${APP_URL}?subscribed=true`,
    cancel_url:           `${APP_URL}?cancelled=true`,
    metadata:             { userId },
    subscription_data: {
      metadata: { userId },
      trial_period_days: user.promoCodeUsed ? 0 : undefined,
    },
  });

  return response(200, { url: session.url });
}

// ── POST /stripe/create-portal — customer self-service portal ────────────────

async function createPortal(userId) {
  const stripe = await getStripe();
  const user = await getUserById(userId);
  if (!user) return response(404, { error: 'User not found' });
  if (!user.stripeCustomerId) return response(400, { error: 'No subscription found' });

  const session = await stripe.billingPortal.sessions.create({
    customer:   user.stripeCustomerId,
    return_url: APP_URL,
  });

  return response(200, { url: session.url });
}

// ── POST /stripe/webhook — handle Stripe events ───────────────────────────────

async function handleWebhook(event) {
  const stripe        = await getStripe();
  const WEBHOOK_SECRET = await getWebhookSecret();
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      event.headers['Stripe-Signature'] || event.headers['stripe-signature'],
      WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return response(400, { error: 'Invalid signature' });
  }

  const data = stripeEvent.data.object;

  switch (stripeEvent.type) {

    case 'checkout.session.completed': {
      // Payment successful — activate Pro
      const userId = data.metadata?.userId;
      if (!userId) break;
      const subscription = await stripe.subscriptions.retrieve(data.subscription);
      const expiry = new Date(subscription.current_period_end * 1000).toISOString();
      await updateUserSubscription(userId, {
        subscriptionStatus: 'pro',
        subscriptionExpiry: expiry,
        stripeSubscriptionId: data.subscription,
      });
      console.log(`Activated Pro for user ${userId}`);
      break;
    }

    case 'invoice.payment_succeeded': {
      // Recurring payment succeeded — extend expiry
      const customerId = data.customer;
      const user = await getUserByEmail(data.customer_email);
      if (!user) break;
      const subscription = await stripe.subscriptions.retrieve(data.subscription);
      const expiry = new Date(subscription.current_period_end * 1000).toISOString();
      await updateUserSubscription(user.userId, {
        subscriptionStatus: 'pro',
        subscriptionExpiry: expiry,
      });
      break;
    }

    case 'invoice.payment_failed': {
      // Payment failed — notify but keep access briefly
      const user = await getUserByEmail(data.customer_email);
      if (!user) break;
      await updateUserSubscription(user.userId, {
        subscriptionStatus: 'payment_failed',
      });
      // Email notification handled by separate Lambda trigger or SES call
      console.log(`Payment failed for ${data.customer_email}`);
      break;
    }

    case 'customer.subscription.deleted': {
      // Subscription cancelled — revoke Pro
      const userId = data.metadata?.userId;
      if (!userId) break;
      await updateUserSubscription(userId, {
        subscriptionStatus:   'free',
        subscriptionExpiry:   null,
        stripeSubscriptionId: null,
      });
      console.log(`Cancelled Pro for user ${userId}`);
      break;
    }

    case 'customer.subscription.updated': {
      // Subscription changed (e.g. reactivated after failed payment)
      const userId = data.metadata?.userId;
      if (!userId) break;
      const status = data.status === 'active' ? 'pro' : data.status;
      const expiry = new Date(data.current_period_end * 1000).toISOString();
      await updateUserSubscription(userId, {
        subscriptionStatus: status,
        subscriptionExpiry: expiry,
      });
      break;
    }

    default:
      console.log(`Unhandled event type: ${stripeEvent.type}`);
  }

  return response(200, { received: true });
}

// ── Main handler ──────────────────────────────────────────────────────────────

export const handler = async (event) => {
  const path   = event.path;
  const method = event.httpMethod;
  const userId = event.requestContext?.authorizer?.claims?.sub;

  try {
    // Webhook — no auth required, Stripe signs the payload
    if (path.endsWith('/webhook')) {
      return await handleWebhook(event);
    }

    // All other routes require auth
    if (!userId) return response(401, { error: 'Unauthorized' });

    if (method === 'POST' && path.endsWith('/create-checkout')) {
      return await createCheckout(userId);
    }

    if (method === 'POST' && path.endsWith('/create-portal')) {
      return await createPortal(userId);
    }

    return response(404, { error: 'Route not found' });

  } catch (err) {
    console.error('Stripe Lambda error:', err);
    return response(500, { error: 'Internal server error' });
  }
};
