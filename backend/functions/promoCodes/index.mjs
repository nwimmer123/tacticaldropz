import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const PROMO_CODES_TABLE = process.env.PROMO_CODES_TABLE;
const USERS_TABLE       = process.env.USERS_TABLE;

const response = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://tacticaldropz.com',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  const method = event.httpMethod;
  const path   = event.path;
  const body   = event.body ? JSON.parse(event.body) : {};
  const userId = event.requestContext?.authorizer?.claims?.sub;

  try {

    // ── POST /promo/redeem — user redeems a promo code ────────────────────────
    if (method === 'POST' && path.endsWith('/redeem')) {
      if (!userId) return response(401, { error: 'Unauthorized' });

      const { code } = body;
      if (!code) return response(400, { error: 'code required' });

      const normalizedCode = code.toUpperCase().trim();

      // Look up the code
      const promoResult = await dynamo.send(new GetCommand({
        TableName: PROMO_CODES_TABLE,
        Key: { code: normalizedCode },
      }));

      if (!promoResult.Item) return response(404, { error: 'Promo code not found' });

      const promo = promoResult.Item;

      if (!promo.active) return response(400, { error: 'Promo code is no longer active' });
      if (promo.maxUses !== null && promo.useCount >= promo.maxUses) {
        return response(400, { error: 'Promo code has reached its usage limit' });
      }

      // Check user hasn't already used a promo
      const userResult = await dynamo.send(new GetCommand({
        TableName: USERS_TABLE,
        Key: { userId },
      }));

      if (!userResult.Item) return response(404, { error: 'User not found' });
      if (userResult.Item.promoCodeUsed) {
        return response(400, { error: 'You have already redeemed a promo code' });
      }

      // Calculate expiry date
      const trialDays  = promo.trialDays || 30;
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + trialDays);
      const expiryIso  = expiryDate.toISOString();

      // Update user — grant pro trial
      await dynamo.send(new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { userId },
        UpdateExpression: `SET 
          subscriptionStatus = :status,
          subscriptionExpiry = :expiry,
          promoCodeUsed      = :code,
          updatedAt          = :now`,
        ExpressionAttributeValues: {
          ':status': 'pro_trial',
          ':expiry': expiryIso,
          ':code':   normalizedCode,
          ':now':    new Date().toISOString(),
        },
      }));

      // Increment promo code use count
      await dynamo.send(new UpdateCommand({
        TableName: PROMO_CODES_TABLE,
        Key: { code: normalizedCode },
        UpdateExpression: 'SET useCount = useCount + :inc, updatedAt = :now',
        ExpressionAttributeValues: {
          ':inc': 1,
          ':now': new Date().toISOString(),
        },
      }));

      return response(200, {
        message: 'Promo code redeemed',
        expiryDate: expiryIso,
        trialDays,
      });
    }

    // ── POST /promo/create — admin creates a new promo code ───────────────────
    // TODO: add admin-only check once admin role is defined
    if (method === 'POST' && path.endsWith('/create')) {
      if (!userId) return response(401, { error: 'Unauthorized' });

      const { code, createdBy, trialDays = 30, maxUses = null } = body;
      if (!code || !createdBy) return response(400, { error: 'code and createdBy required' });

      const normalizedCode = code.toUpperCase().trim();

      // Check code doesn't already exist
      const existing = await dynamo.send(new GetCommand({
        TableName: PROMO_CODES_TABLE,
        Key: { code: normalizedCode },
      }));

      if (existing.Item) return response(409, { error: 'Promo code already exists' });

      await dynamo.send(new PutCommand({
        TableName: PROMO_CODES_TABLE,
        Item: {
          code:          normalizedCode,
          createdBy,
          trialDays,
          maxUses,
          useCount:      0,
          active:        true,
          schemaVersion: '1.0',
          createdAt:     new Date().toISOString(),
          updatedAt:     new Date().toISOString(),
        },
      }));

      return response(201, { message: 'Promo code created', code: normalizedCode });
    }

    // ── GET /promo/{code} — check if a code is valid (before redeeming) ───────
    if (method === 'GET') {
      const code = decodeURIComponent(event.pathParameters?.code || '');
      if (!code) return response(400, { error: 'code required' });

      const result = await dynamo.send(new GetCommand({
        TableName: PROMO_CODES_TABLE,
        Key: { code: code.toUpperCase().trim() },
      }));

      if (!result.Item || !result.Item.active) {
        return response(404, { error: 'Promo code not found or inactive' });
      }

      // Return just enough for the UI to show what the code offers
      return response(200, {
        code:      result.Item.code,
        trialDays: result.Item.trialDays,
        valid:     true,
      });
    }

    return response(404, { error: 'Route not found' });

  } catch (err) {
    console.error(err);
    return response(500, { error: 'Internal server error' });
  }
};
