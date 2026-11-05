import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { type Env } from './worker';

const syntheticEnv: Env & { JWT_SECRET?: string } = {
  DB: undefined as unknown as Env['DB'],
  JWT_SECRET: 'synthetic-test-signing-key',
};

async function postMcp(
  pathname: string,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  const request = new Request(`https://spentrack.test${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  return worker.fetch(request, syntheticEnv);
}

test('notifications/initialized on /api/mcp returns HTTP 202, 0 bytes, no Content-Type, and CORS headers', async () => {
  const res = await postMcp('/api/mcp', {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });
  assert.equal(res.status, 202);
  const text = await res.text();
  assert.equal(text.length, 0);
  assert.equal(res.headers.get('content-type'), null);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('notifications/initialized on /api/mcp/sse returns HTTP 202, 0 bytes, no Content-Type, and CORS headers', async () => {
  const res = await postMcp('/api/mcp/sse', {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });
  assert.equal(res.status, 202);
  const text = await res.text();
  assert.equal(text.length, 0);
  assert.equal(res.headers.get('content-type'), null);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('initialize with id 0 and ping with id "ping-test" keep JSON-RPC IDs and serverInfo.name spentrack', async () => {
  const initRes = await postMcp('/api/mcp', {
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  });
  assert.equal(initRes.status, 200);
  const initData = (await initRes.json()) as {
    jsonrpc: string;
    id: number | null;
    result: { serverInfo?: { name: string; version: string } };
  };
  assert.equal(initData.jsonrpc, '2.0');
  assert.equal(initData.id, 0);
  assert.equal(initData.result?.serverInfo?.name, 'spentrack');

  const pingRes = await postMcp('/api/mcp', {
    jsonrpc: '2.0',
    id: 'ping-test',
    method: 'ping',
  });
  assert.equal(pingRes.status, 200);
  const pingData = (await pingRes.json()) as {
    jsonrpc: string;
    id: string | null;
    result: Record<string, unknown>;
  };
  assert.equal(pingData.jsonrpc, '2.0');
  assert.equal(pingData.id, 'ping-test');
  assert.deepEqual(pingData.result, {});
});

test('unauthenticated tools/list with id 2 returns 401 with error code -32001', async () => {
  const res = await postMcp('/api/mcp', {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  });
  assert.equal(res.status, 401);
  const data = (await res.json()) as {
    jsonrpc: string;
    id: number | null;
    error: { code: number; message: string };
  };
  assert.equal(data.jsonrpc, '2.0');
  assert.equal(data.id, 2);
  assert.equal(data.error?.code, -32001);
});

test('initialize -> initialized -> tools/list with dev header x-user-id returns exact five tools in order', async () => {
  const devHeaders = { 'x-user-id': 'synthetic-mcp-test-user' };

  // 1. initialize
  const initRes = await postMcp(
    '/api/mcp',
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {} },
    },
    devHeaders
  );
  assert.equal(initRes.status, 200);

  // 2. initialized notification
  const notifRes = await postMcp(
    '/api/mcp',
    {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    },
    devHeaders
  );
  assert.equal(notifRes.status, 202);
  const notifText = await notifRes.text();
  assert.equal(notifText.length, 0);

  // 3. tools/list
  const toolsRes = await postMcp(
    '/api/mcp',
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
    },
    devHeaders
  );
  assert.equal(toolsRes.status, 200);
  const toolsData = (await toolsRes.json()) as {
    jsonrpc: string;
    id: number | null;
    result: { tools: Array<{ name: string }> };
  };
  assert.equal(toolsData.jsonrpc, '2.0');
  assert.equal(toolsData.id, 3);

  const toolNames = toolsData.result.tools.map((tool) => tool.name);
  assert.deepEqual(toolNames, [
    'add_expense',
    'update_expense',
    'list_expenses',
    'get_financial_summary',
    'delete_expense',
  ]);
});
