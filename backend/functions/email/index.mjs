import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const ses    = new SESClient({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const USERS_TABLE  = process.env.USERS_TABLE;
const FROM_EMAIL   = process.env.SES_FROM_EMAIL;

const response = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://tacticaldropz.com',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  },
  body: JSON.stringify(body),
});

// ── Faction sign-offs ─────────────────────────────────────────────────────────

const signOffs = {
  'chaos-daemons':          'Blood for the Blood God!',
  'chaos-space-marines':    'Death to the Corpse King!',
  'death-guard':            'Blessed be the Plague Father,',
  'thousand-sons':          'All is Dust,',
  'world-eaters':           'MAIM KILL BURN,',
  'necrons':                'We shall rise again,',
  'tyranids':               'The Hive Mind hungers,',
  'orks':                   'WAAAGH!',
  'tau':                    'For the Greater Good,',
  'aeldari':                'May Isha watch over you,',
  'drukhari':               'Pain is merely weakness leaving the body,',
  'leagues-of-votann':      'By the Ancestor Cores,',
  'adeptus-mechanicus':     'Praise the Omnissiah,',
  'adeptus-custodes':       'In the name of the Ten Thousand,',
  'sisters-of-battle':      'By His Light and His Will,',
  'imperial-knights':       'Honour to your House,',
  'chaos-knights':          'Bow to the Dread Household,',
  'genestealer-cults':      'The Four-Armed Emperor beckons,',
  'space-marines':          'For the Emperor,',
  'space-wolves':           'For Russ and the Allfather!',
  'dark-angels':            'The Lion Watches,',
  'blood-angels':           'For Sanguinius!',
  'default':                'For the Emperor,',
};

// ── Email templates ───────────────────────────────────────────────────────────

const templates = {

  trial_ending: (data) => ({
    subject: 'Your TacticalDropz Pro trial ends in 3 days',
    html: `
      <h2>Your free trial is almost up!</h2>
      <p>Hi ${data.displayName || 'Commander'},</p>
      <p>Your TacticalDropz Pro trial ends on <strong>${data.expiryDate}</strong>.</p>
      <p>After that you'll be charged $5/month to keep access to:</p>
      <ul>
        <li>Saved deployments</li>
        <li>Army list storage</li>
        <li>Custom themes</li>
      </ul>
      <p>To cancel before being charged, visit your account settings at 
         <a href="https://tacticaldropz.com">tacticaldropz.com</a>.</p>
      <p>${signOffs[data.faction] || signOffs['default']}<br/>The TacticalDropz Team</p>
    `,
  }),

  charge_confirmation: (data) => ({
    subject: 'TacticalDropz Pro - Payment confirmed',
    html: `
      <h2>Payment confirmed</h2>
      <p>Hi ${data.displayName || 'Commander'},</p>
      <p>Your TacticalDropz Pro subscription has been renewed.</p>
      <p><strong>Amount:</strong> $5.00</p>
      <p><strong>Next charge:</strong> ${data.nextChargeDate}</p>
      <p>Thank you for supporting TacticalDropz!</p>
      <p>${signOffs[data.faction] || signOffs['default']}<br/>The TacticalDropz Team</p>
    `,
  }),

  payment_failed: (data) => ({
    subject: 'TacticalDropz - Payment failed, action required',
    html: `
      <h2>We couldn't process your payment</h2>
      <p>Hi ${data.displayName || 'Commander'},</p>
      <p>We were unable to charge your payment method for TacticalDropz Pro.</p>
      <p>Please update your payment details at 
         <a href="https://tacticaldropz.com/account">tacticaldropz.com/account</a> 
         to keep your Pro access.</p>
      <p>Your account will revert to free tier in <strong>7 days</strong> if not resolved.</p>
      <p>${signOffs[data.faction] || signOffs['default']}<br/>The TacticalDropz Team</p>
    `,
  }),

  subscription_cancelled: (data) => ({
    subject: 'TacticalDropz Pro - Subscription cancelled',
    html: `
      <h2>Subscription cancelled</h2>
      <p>Hi ${data.displayName || 'Commander'},</p>
      <p>Your TacticalDropz Pro subscription has been cancelled.</p>
      <p>You'll retain Pro access until <strong>${data.expiryDate}</strong>, 
         after which your account will revert to free tier.</p>
      <p>Your saved deployments and lists will remain stored — 
         you just won't be able to create new ones or access them until you resubscribe.</p>
      <p>We hope to see you back on the battlefield.</p>
      <p>${signOffs[data.faction] || signOffs['default']}<br/>The TacticalDropz Team</p>
    `,
  }),

  promo_welcome: (data) => ({
    subject: 'Welcome to TacticalDropz Pro!',
    html: `
      <h2>Your free Pro month is activated!</h2>
      <p>Hi ${data.displayName || 'Commander'},</p>
      <p>Your promo code <strong>${data.promoCode}</strong> has been applied.</p>
      <p>You have <strong>30 days of TacticalDropz Pro</strong> — enjoy:</p>
      <ul>
        <li>Saved deployments</li>
        <li>Army list storage</li>
        <li>Custom themes</li>
      </ul>
      <p>Your trial ends on <strong>${data.expiryDate}</strong>. 
         We'll remind you before it ends.</p>
      <p>${signOffs[data.faction] || signOffs['default']}<br/>The TacticalDropz Team</p>
    `,
  }),

};

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  const body = event.body ? JSON.parse(event.body) : {};
  const { toEmail, templateName, templateData } = body;

  if (!toEmail || !templateName) {
    return response(400, { error: 'toEmail and templateName required' });
  }

  const template = templates[templateName];
  if (!template) {
    return response(400, { error: `Unknown template: ${templateName}` });
  }

  const { subject, html } = template(templateData || {});

  try {
    await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [toEmail] },
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: html, Charset: 'UTF-8' },
        },
      },
    }));

    return response(200, { message: 'Email sent' });

  } catch (err) {
    console.error('SES error:', err);
    return response(500, { error: 'Failed to send email' });
  }
};
