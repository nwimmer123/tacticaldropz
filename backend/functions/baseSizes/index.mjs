import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const BASE_SIZES_TABLE = process.env.BASE_SIZES_TABLE;

const response = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://tacticaldropz.com',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  },
  body: JSON.stringify(body),
});

// Normalize unit name + faction into a consistent lookup key
function makeUnitKey(unitName, faction) {
  const name    = unitName.toLowerCase().trim().replace(/\s+/g, '-');
  const fact    = faction.toLowerCase().trim().replace(/\s+/g, '-');
  return `${fact}::${name}`;
}

export const handler = async (event) => {
  const method = event.httpMethod;
  const path   = event.path;
  const body   = event.body ? JSON.parse(event.body) : {};
  const params = event.queryStringParameters || {};

  try {

    // ── GET /bases?units=name1,name2&faction=x&edition=10th ─────────────────
    // Batch lookup — frontend sends all unit names at once
    if (method === 'GET') {
      const edition = params.edition || '10th';
      const faction = params.faction || '';
      const units   = params.units ? params.units.split(',') : [];

      if (units.length === 0) return response(400, { error: 'units parameter required' });

      // Batch get all requested units
      const results = await Promise.all(
        units.map(unitName =>
          dynamo.send(new GetCommand({
            TableName: BASE_SIZES_TABLE,
            Key: {
              unitKey: makeUnitKey(unitName, faction),
              edition,
            },
          }))
        )
      );

      const found = {};
      results.forEach((r, i) => {
        if (r.Item) found[units[i]] = r.Item;
      });

      return response(200, { bases: found, edition });
    }

    // ── POST /bases — submit a new base size ─────────────────────────────────
    if (method === 'POST' && !path.includes('/vote')) {
      const userId = event.requestContext?.authorizer?.claims?.sub;
      if (!userId) return response(401, { error: 'Unauthorized' });

      const { unitName, faction, baseSizeKey, shape = 'circle', edition = '10th' } = body;
      if (!unitName || !faction || !baseSizeKey) {
        return response(400, { error: 'unitName, faction and baseSizeKey required' });
      }

      const unitKey = makeUnitKey(unitName, faction);

      // Check if entry already exists
      const existing = await dynamo.send(new GetCommand({
        TableName: BASE_SIZES_TABLE,
        Key: { unitKey, edition },
      }));

      if (existing.Item) {
        // Already exists — just vote for it instead
        await dynamo.send(new UpdateCommand({
          TableName: BASE_SIZES_TABLE,
          Key: { unitKey, edition },
          UpdateExpression: 'SET voteCount = voteCount + :inc, updatedAt = :now',
          ExpressionAttributeValues: {
            ':inc': 1,
            ':now': new Date().toISOString(),
          },
        }));
        return response(200, { message: 'Vote recorded', unitKey });
      }

      // New entry
      await dynamo.send(new PutCommand({
        TableName: BASE_SIZES_TABLE,
        Item: {
          unitKey,
          edition,
          unitName:      unitName.trim(),
          faction:       faction.trim(),
          baseSizeKey,
          shape:         body.shape || 'circle',
          voteCount:     1,
          submittedBy:   userId,
          schemaVersion: '1.0',
          createdAt:     new Date().toISOString(),
          updatedAt:     new Date().toISOString(),
        },
      }));

      return response(201, { message: 'Base size submitted', unitKey });
    }

    // ── POST /bases/{unitKey}/vote ────────────────────────────────────────────
    if (method === 'POST' && path.includes('/vote')) {
      const userId = event.requestContext?.authorizer?.claims?.sub;
      if (!userId) return response(401, { error: 'Unauthorized' });

      const unitKey = decodeURIComponent(event.pathParameters?.unitKey || '');
      const edition = body.edition || '10th';

      await dynamo.send(new UpdateCommand({
        TableName: BASE_SIZES_TABLE,
        Key: { unitKey, edition },
        UpdateExpression: 'SET voteCount = voteCount + :inc, updatedAt = :now',
        ConditionExpression: 'attribute_exists(unitKey)',
        ExpressionAttributeValues: {
          ':inc': 1,
          ':now': new Date().toISOString(),
        },
      }));

      return response(200, { message: 'Vote recorded' });
    }

    return response(404, { error: 'Route not found' });

  } catch (err) {
    console.error(err);
    if (err.name === 'ConditionalCheckFailedException') return response(404, { error: 'Base size entry not found' });
    return response(500, { error: 'Internal server error' });
  }
};
