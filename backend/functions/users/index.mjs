import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, SignUpCommand, InitiateAuthCommand, ConfirmSignUpCommand } from '@aws-sdk/client-cognito-identity-provider';
import { randomUUID } from 'crypto';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});

const USERS_TABLE      = process.env.USERS_TABLE;
const CLIENT_ID        = process.env.USER_POOL_CLIENT_ID;

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

  try {

    // ── POST /users/verify ──────────────────────────────────────────────────
    if (method === 'POST' && path.endsWith('/verify')) {
      const { email, code } = body;
      if (!email || !code) return response(400, { error: 'Email and code required' });

      await cognito.send(new ConfirmSignUpCommand({
        ClientId:         CLIENT_ID,
        Username:         email,
        ConfirmationCode: code,
      }));

      return response(200, { message: 'Email verified successfully' });
    }

    // ── POST /users/signup ──────────────────────────────────────────────────
    if (method === 'POST' && path.endsWith('/signup')) {
      const { email, password } = body;
      if (!email || !password) return response(400, { error: 'Email and password required' });

      // Create Cognito user
      const signUpResult = await cognito.send(new SignUpCommand({
        ClientId: CLIENT_ID,
        Username: email,
        Password: password,
        UserAttributes: [{ Name: 'email', Value: email }],
      }));

      const userId = signUpResult.UserSub;

      // Create user record in DynamoDB
      await dynamo.send(new PutCommand({
        TableName: USERS_TABLE,
        Item: {
          userId,
          email,
          subscriptionStatus: 'free',
          stripeCustomerId: null,
          subscriptionExpiry: null,
          theme:         'default',
          schemaVersion: '1.0',
          createdAt: new Date().toISOString(),
          lastLoginAt: null,
        },
      }));

      return response(201, { userId, email, message: 'Signup successful. Please verify your email.' });
    }

    // ── POST /users/signin ──────────────────────────────────────────────────
    if (method === 'POST' && path.endsWith('/signin')) {
      const { email, password } = body;
      if (!email || !password) return response(400, { error: 'Email and password required' });

      const authResult = await cognito.send(new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: { USERNAME: email, PASSWORD: password },
      }));

      const tokens = authResult.AuthenticationResult;

      // Update lastLoginAt
      const userQuery = await dynamo.send(new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: 'email-index',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: { ':email': email },
      }));

      if (userQuery.Items?.length > 0) {
        await dynamo.send(new UpdateCommand({
          TableName: USERS_TABLE,
          Key: { userId: userQuery.Items[0].userId },
          UpdateExpression: 'SET lastLoginAt = :now',
          ExpressionAttributeValues: { ':now': new Date().toISOString() },
        }));
      }

      return response(200, {
        accessToken:  tokens.AccessToken,
        refreshToken: tokens.RefreshToken,
        expiresIn:    tokens.ExpiresIn,
      });
    }

    // ── GET /users/profile ──────────────────────────────────────────────────
    if (method === 'GET' && path.endsWith('/profile')) {
      const userId = event.requestContext?.authorizer?.claims?.sub;
      if (!userId) return response(401, { error: 'Unauthorized' });

      const result = await dynamo.send(new GetCommand({
        TableName: USERS_TABLE,
        Key: { userId },
      }));

      if (!result.Item) return response(404, { error: 'User not found' });

      // Never return sensitive fields
      const { stripeCustomerId, ...safeUser } = result.Item;
      return response(200, safeUser);
    }

    // ── PUT /users/profile ──────────────────────────────────────────────────
    if (method === 'PUT' && path.endsWith('/profile')) {
      const userId = event.requestContext?.authorizer?.claims?.sub;
      if (!userId) return response(401, { error: 'Unauthorized' });

      const { displayName, theme } = body;

      await dynamo.send(new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { userId },
        UpdateExpression: 'SET displayName = :name, theme = :theme, updatedAt = :now',
        ExpressionAttributeValues: {
          ':name':  displayName,
          ':theme': theme || 'default',
          ':now':   new Date().toISOString(),
        },
      }));

      return response(200, { message: 'Profile updated' });
    }

    return response(404, { error: 'Route not found' });

  } catch (err) {
    console.error(err);
    if (err.name === 'UsernameExistsException') return response(409, { error: 'Email already registered' });
    if (err.name === 'NotAuthorizedException')  return response(401, { error: 'Invalid email or password' });
    if (err.name === 'UserNotConfirmedException') return response(403, { error: 'Please verify your email first' });
    return response(500, { error: 'Internal server error' });
  }
};
