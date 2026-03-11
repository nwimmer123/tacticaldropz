import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE;

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
  const method       = event.httpMethod;
  const body         = event.body ? JSON.parse(event.body) : {};
  const userId       = event.requestContext?.authorizer?.claims?.sub;
  const deploymentId = event.pathParameters?.deploymentId;

  if (!userId) return response(401, { error: 'Unauthorized' });

  try {

    // ── GET /deployments — list all deployments for user ─────────────────────
    if (method === 'GET' && !deploymentId) {
      const result = await dynamo.send(new QueryCommand({
        TableName: DEPLOYMENTS_TABLE,
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
        // Summary only for list view — excludes heavy boardData
        ProjectionExpression: 'deploymentId, #n, faction, mission, terrainFormat, layoutIndex, listId, edition, opponent, #result, tournamentRound, createdAt, updatedAt',
        ExpressionAttributeNames: { '#n': 'name', '#result': 'result' },
      }));

      return response(200, { deployments: result.Items || [] });
    }

    // ── GET /deployments/{deploymentId} ──────────────────────────────────────
    if (method === 'GET' && deploymentId) {
      const result = await dynamo.send(new GetCommand({
        TableName: DEPLOYMENTS_TABLE,
        Key: { userId, deploymentId },
      }));

      if (!result.Item) return response(404, { error: 'Deployment not found' });
      return response(200, result.Item);
    }

    // ── POST /deployments — save new deployment ──────────────────────────────
    if (method === 'POST') {
      const {
        name, faction, mission, terrainFormat, layoutIndex,
        boardData, listId, edition = '10th',
        opponent = null, result = null, tournamentRound = null,
        isPublic = false,
        theme = null,
      } = body;

      if (!name || !mission) return response(400, { error: 'name and mission required' });

      const newDeploymentId = randomUUID();
      const now = new Date().toISOString();

      await dynamo.send(new PutCommand({
        TableName: DEPLOYMENTS_TABLE,
        Item: {
          userId,
          deploymentId:  newDeploymentId,
          name,
          faction:       faction || null,
          mission,
          terrainFormat: terrainFormat || 'gw',
          layoutIndex:   layoutIndex   || 0,
          boardData:     boardData      || [],
          listId:        listId         || null,
          edition,
          opponent,
          result,
          tournamentRound,
          isPublic,
          theme,
          schemaVersion: '1.0',
          createdAt:     now,
          updatedAt:     now,
        },
      }));

      return response(201, { deploymentId: newDeploymentId, message: 'Deployment saved' });
    }

    // ── PUT /deployments/{deploymentId} — update deployment ──────────────────
    if (method === 'PUT' && deploymentId) {
      const {
        name, boardData, mission, terrainFormat,
        layoutIndex, opponent, result, tournamentRound, isPublic, theme,
      } = body;

      await dynamo.send(new UpdateCommand({
        TableName: DEPLOYMENTS_TABLE,
        Key: { userId, deploymentId },
        ConditionExpression: 'attribute_exists(deploymentId)',
        UpdateExpression: `SET
          #n             = :name,
          boardData      = :boardData,
          mission        = :mission,
          terrainFormat  = :terrainFormat,
          layoutIndex    = :layoutIndex,
          opponent       = :opponent,
          #result        = :result,
          tournamentRound = :tournamentRound,
          isPublic       = :isPublic,
          theme          = :theme,
          updatedAt      = :now`,
        ExpressionAttributeNames: {
          '#n':      'name',
          '#result': 'result',
        },
        ExpressionAttributeValues: {
          ':name':          name,
          ':boardData':     boardData || [],
          ':mission':       mission,
          ':terrainFormat': terrainFormat || 'gw',
          ':layoutIndex':   layoutIndex   || 0,
          ':opponent':      opponent       || null,
          ':result':        result         || null,
          ':tournamentRound': tournamentRound || null,
          ':isPublic':      isPublic       || false,
          ':theme':         theme          || null,
          ':now':           new Date().toISOString(),
        },
      }));

      return response(200, { message: 'Deployment updated' });
    }

    // ── DELETE /deployments/{deploymentId} ───────────────────────────────────
    if (method === 'DELETE' && deploymentId) {
      await dynamo.send(new DeleteCommand({
        TableName: DEPLOYMENTS_TABLE,
        Key: { userId, deploymentId },
        ConditionExpression: 'attribute_exists(deploymentId)',
      }));

      return response(200, { message: 'Deployment deleted' });
    }

    return response(404, { error: 'Route not found' });

  } catch (err) {
    console.error(err);
    if (err.name === 'ConditionalCheckFailedException') return response(404, { error: 'Deployment not found' });
    return response(500, { error: 'Internal server error' });
  }
};
