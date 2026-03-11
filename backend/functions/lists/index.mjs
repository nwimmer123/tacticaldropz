import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const LISTS_TABLE = process.env.LISTS_TABLE;

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
  const method  = event.httpMethod;
  const path    = event.path;
  const body    = event.body ? JSON.parse(event.body) : {};
  const userId  = event.requestContext?.authorizer?.claims?.sub;
  const listId  = event.pathParameters?.listId;

  if (!userId) return response(401, { error: 'Unauthorized' });

  try {

    // ── GET /lists — get all lists for user ──────────────────────────────────
    if (method === 'GET' && !listId) {
      const result = await dynamo.send(new QueryCommand({
        TableName: LISTS_TABLE,
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
        // Return summary only — no full units array for list view
        ProjectionExpression: 'listId, #n, faction, edition, totalPoints, detachment, battleSize, createdAt, updatedAt',
        ExpressionAttributeNames: { '#n': 'name' },
      }));

      return response(200, { lists: result.Items || [] });
    }

    // ── GET /lists/{listId} ──────────────────────────────────────────────────
    if (method === 'GET' && listId) {
      const result = await dynamo.send(new GetCommand({
        TableName: LISTS_TABLE,
        Key: { userId, listId },
      }));

      if (!result.Item) return response(404, { error: 'List not found' });
      return response(200, result.Item);
    }

    // ── POST /lists — create new list ────────────────────────────────────────
    if (method === 'POST') {
      const { name, faction, edition = '10th', totalPoints, detachment, battleSize, units = [], rawText } = body;
      if (!name || !faction) return response(400, { error: 'name and faction required' });

      const newListId = randomUUID();
      const now = new Date().toISOString();

      await dynamo.send(new PutCommand({
        TableName: LISTS_TABLE,
        Item: {
          userId,
          listId:        newListId,
          name,
          faction,
          edition,
          totalPoints:   totalPoints || 0,
          detachment:    detachment || null,
          battleSize:    battleSize || null,
          units,
          rawText:       rawText || null,
          schemaVersion: '1.0',
          createdAt:     now,
          updatedAt:     now,
        },
      }));

      return response(201, { listId: newListId, message: 'List created' });
    }

    // ── PUT /lists/{listId} — update list ────────────────────────────────────
    if (method === 'PUT' && listId) {
      const { name, units, detachment, battleSize } = body;

      await dynamo.send(new UpdateCommand({
        TableName: LISTS_TABLE,
        Key: { userId, listId },
        ConditionExpression: 'attribute_exists(listId)',
        UpdateExpression: 'SET #n = :name, units = :units, detachment = :det, battleSize = :bs, updatedAt = :now',
        ExpressionAttributeNames: { '#n': 'name' },
        ExpressionAttributeValues: {
          ':name': name,
          ':units': units,
          ':det':  detachment || null,
          ':bs':   battleSize || null,
          ':now':  new Date().toISOString(),
        },
      }));

      return response(200, { message: 'List updated' });
    }

    // ── DELETE /lists/{listId} ───────────────────────────────────────────────
    if (method === 'DELETE' && listId) {
      await dynamo.send(new DeleteCommand({
        TableName: LISTS_TABLE,
        Key: { userId, listId },
        ConditionExpression: 'attribute_exists(listId)',
      }));

      return response(200, { message: 'List deleted' });
    }

    return response(404, { error: 'Route not found' });

  } catch (err) {
    console.error(err);
    if (err.name === 'ConditionalCheckFailedException') return response(404, { error: 'List not found' });
    return response(500, { error: 'Internal server error' });
  }
};
