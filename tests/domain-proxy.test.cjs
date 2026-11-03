const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// The handler's only TypeScript syntax is its Request annotation.
const source = fs.readFileSync(require.resolve('../supabase/functions/domain-proxy/index.ts'), 'utf8').replace('(req: Request)', '(req)');

test('retired endpoint returns 410 for legacy routes and all non-preflight methods without upstream calls or secrets', async () => {
  let handler;
  const envReads = [];
  let upstreamCalls = 0;
  vm.runInNewContext(source, {
    Deno: {
      env: { get: name => { envReads.push(name); return name === 'ALLOWED_ORIGIN' ? 'https://opendomain.name' : undefined; } },
      serve: callback => { handler = callback; },
    },
    Response,
    fetch: () => { upstreamCalls++; throw new Error('Upstream calls are forbidden'); },
  });
  for (const path of ['', '?action=search&query=example', '?action=status&domain=example.com', '?action=invalid']) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'HEAD']) {
      const response = await handler(new Request(`https://example.test/domain-proxy${path}`, { method }));
      assert.equal(response.status, 410);
      assert.equal((await response.json()).error, 'endpoint_retired');
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://opendomain.name');
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
  }
  const preflight = await handler(new Request('https://example.test/domain-proxy', { method: 'OPTIONS' }));
  assert.equal(preflight.status, 204);
  assert.equal(await preflight.text(), '');
  assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
  assert.deepEqual(envReads, ['ALLOWED_ORIGIN']);
  assert.equal(upstreamCalls, 0);
});
