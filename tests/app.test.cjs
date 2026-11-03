const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const app = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const sdk = fs.readFileSync(require('node:path').join(require('node:path').dirname(require.resolve('@supabase/supabase-js')), 'umd/supabase.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const user = id => ({ id, email: `${id}@example.test`, user_metadata: {} });
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };

function setup(t, options = {}) {
  const dom = new JSDOM(html, { url: options.url || 'https://opendomain.name/', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  t.after(() => dom.window.close());
  const w = dom.window;
  const context = dom.getInternalVMContext();
  const evaluate = code => vm.runInContext(code, context);
  const alerts = [], calls = [], timers = new Map();
  let nextTimer = 0, listener;
  w.alert = message => alerts.push(message);
  w.AbortController = AbortController;
  w.fetch = options.fetch || (async () => ({ ok: true, json: async () => ({ Status: 3 }) }));
  if (!options.realSdk) {
    w.setTimeout = (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; };
    w.clearTimeout = id => timers.delete(id);
    const auth = {
      onAuthStateChange: fn => { listener = fn; },
      initialize: async () => { listener('INITIAL_SESSION', options.user ? { user: options.user } : null); return { error: options.initError || null }; },
      getSession: async () => ({ data: { session: options.user ? { user: options.user } : null }, error: null }),
      signInWithOAuth: async () => ({ error: null }),
      signInWithOtp: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
    };
    const client = { auth, from: table => {
      const call = { table, op: null, filters: [] }; calls.push(call);
      const q = {
        select: () => { call.op = 'select'; return q; },
        order: () => q,
        eq: (field, value) => { call.filters.push([field, value]); return q; },
        limit: () => q,
        upsert: value => { call.op = 'upsert'; call.value = value; return q; },
        delete: () => { call.op = 'delete'; return q; },
        then: (resolve, reject) => Promise.resolve(options.database ? options.database(call) : { data: [], error: null }).then(resolve, reject)
      };
      return q;
    } };
    w.supabase = { createClient: () => client };
    w.testClient = client;
  } else {
    Object.defineProperty(w, 'crypto', { value: webcrypto });
    w.Headers = Headers; w.Request = Request; w.Response = Response;
    if (options.verifier) w.localStorage.setItem('sb-wmsxlrstfwfmonispafy-auth-token-code-verifier', JSON.stringify(options.verifier));
    vm.runInContext(sdk, context);
  }
  vm.runInContext(app, context);
  return {
    w, evaluate, alerts, calls, timers,
    emit: (event, session) => listener(event, session),
    runTimers: async delay => {
      const entries = [...timers].filter(([, item]) => item.delay === delay);
      for (const [id, item] of entries) { timers.delete(id); item.fn(); }
      await tick();
    },
    input: value => { w.document.getElementById('search').value = value; w.document.getElementById('search').dispatchEvent(new w.Event('input')); },
    el: id => w.document.getElementById(id)
  };
}

async function settled(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); }
  assert.ok(check(), 'condition did not settle');
}

test('real pinned SDK exchanges a callback code exactly once and retains unrelated URL state', async t => {
  let exchanges = 0;
  const h = setup(t, {
    realSdk: true, verifier: 'test-verifier', url: 'https://opendomain.name/?code=test-code&campaign=keep#details',
    fetch: async (url, init) => {
      if (String(url).includes('/token?grant_type=pkce')) {
        exchanges++;
        assert.equal(JSON.parse(init.body).auth_code, 'test-code');
        assert.equal(JSON.parse(init.body).code_verifier, 'test-verifier');
        return new Response(JSON.stringify({ access_token: 'mock-access-token', refresh_token: 'mock-refresh-token', expires_in: 3600, token_type: 'bearer', user: user('alpha') }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (String(url).includes('/rest/v1/search_history')) return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
      throw new Error(`Unexpected network request: ${url}`);
    }
  });
  await settled(() => h.el('ddEmail').textContent === 'alpha@example.test');
  await new Promise(r => setTimeout(r, 30));
  assert.equal(exchanges, 1);
  assert.deepEqual(h.alerts, []);
  assert.equal(h.w.location.search, '?campaign=keep');
  assert.equal(h.w.location.hash, '#details');
  await h.evaluate('sb.auth.stopAutoRefresh()');
});

test('real pinned SDK reports expired callback errors without showing provider details', async t => {
  const h = setup(t, { realSdk: true, verifier: 'test-verifier', url: 'https://opendomain.name/?code=expired&campaign=keep', fetch: async () => new Response(JSON.stringify({ code: 'flow_state_expired', msg: 'Private diagnostic' }), { status: 400, headers: { 'Content-Type': 'application/json' } }) });
  await settled(() => h.alerts.length === 1);
  assert.match(h.alerts[0], /Sign-in could not be completed/);
  assert.doesNotMatch(h.alerts[0], /Private diagnostic/);
  assert.equal(h.w.location.search, '?campaign=keep');
});

test('callback without a browser verifier reports an incomplete sign-in', async t => {
  const h = setup(t, { realSdk: true, url: 'https://opendomain.name/?code=orphaned', fetch: async () => { throw new Error('No network expected'); } });
  await settled(() => h.alerts.length === 1);
  assert.match(h.alerts[0], /same browser/);
});

test('Google initiation failures and thrown network errors are visible', async t => {
  const h = setup(t);
  h.w.testClient.auth.signInWithOAuth = async () => ({ error: new Error('disabled') });
  await h.evaluate('signInWithGoogle()');
  h.w.testClient.auth.signInWithOAuth = async () => { throw new Error('offline'); };
  await h.evaluate('signInWithGoogle()');
  assert.equal(h.alerts.length, 2);
});

test('failed sign-out preserves the signed-in UI', async t => {
  const h = setup(t, { user: user('alpha') });
  h.w.testClient.auth.signOut = async () => ({ error: new Error('offline') });
  await h.evaluate('signOut()');
  assert.equal(h.el('ddEmail').textContent, 'alpha@example.test');
  assert.match(h.alerts[0], /Sign-out could not/);
});

test('email modal resets after success and avoids duplicate in-flight sends', async t => {
  const pending = deferred(); let sends = 0;
  const h = setup(t);
  h.w.testClient.auth.signInWithOtp = () => { sends++; return pending.promise; };
  h.evaluate('openModal()'); h.el('magicEmail').value = 'alpha@example.test';
  const send = h.evaluate('sendMagicLink()');
  await h.evaluate('sendMagicLink()');
  assert.equal(sends, 1);
  pending.resolve({ error: null }); await send;
  assert.equal(h.el('magicSent').style.display, 'flex');
  h.evaluate('closeModal(); openModal()');
  assert.equal(h.el('magicSent').style.display, 'none');
  assert.equal(h.el('magicEmail').style.display, '');
  assert.equal(h.el('btnMagic').disabled, false);
});

test('closing and reopening an email request ignores the old response', async t => {
  const pending = deferred(); const h = setup(t);
  h.w.testClient.auth.signInWithOtp = () => pending.promise;
  h.evaluate('openModal()'); h.el('magicEmail').value = 'alpha@example.test';
  const send = h.evaluate('sendMagicLink()');
  h.evaluate('closeModal(); openModal()');
  pending.resolve({ error: null }); await send;
  assert.equal(h.el('magicSent').style.display, 'none');
  assert.equal(h.el('btnMagic').disabled, false);
});

test('email request rejection restores usable controls', async t => {
  const h = setup(t);
  h.w.testClient.auth.signInWithOtp = async () => { throw new Error('offline'); };
  h.evaluate('openModal()'); h.el('magicEmail').value = 'alpha@example.test';
  await h.evaluate('sendMagicLink()');
  assert.equal(h.el('btnMagic').disabled, false);
  assert.match(h.alerts[0], /could not be sent/);
});

test('old history responses cannot reappear after logout or account switch', async t => {
  const pending = deferred();
  const h = setup(t, { database: call => call.filters.some(([, value]) => value === 'alpha') ? pending.promise : { data: [{ query: 'beta-domain', searched_at: '2026-11-03' }], error: null } });
  h.emit('SIGNED_IN', { user: user('alpha') }); await h.runTimers(0);
  h.emit('SIGNED_OUT', null);
  assert.equal(h.el('historyList').innerHTML, '');
  h.emit('SIGNED_IN', { user: user('beta') }); await h.runTimers(0);
  pending.resolve({ data: [{ query: 'private-alpha-domain', searched_at: '2026-11-03' }], error: null }); await tick();
  assert.match(h.el('historyList').textContent, /beta-domain/);
  assert.doesNotMatch(h.el('historyList').textContent, /private-alpha/);
});

test('history errors are distinguishable from an empty history', async t => {
  const h = setup(t, { user: user('alpha'), database: () => ({ data: null, error: new Error('backend unavailable') }) });
  await h.runTimers(0);
  assert.match(h.el('historyList').textContent, /unavailable/);
  assert.doesNotMatch(h.el('historyList').textContent, /No searches yet/);
});

test('history deletion failure leaves the saved row visible', async t => {
  const h = setup(t, { user: user('alpha'), database: call => call.op === 'delete' ? { error: new Error('denied') } : { data: [{ query: 'saved-domain', searched_at: '2026-11-03' }] } });
  await h.runTimers(0);
  h.w.document.querySelector('.history-delete').click(); await tick();
  assert.match(h.el('historyList').textContent, /saved-domain/);
  assert.match(h.alerts[0], /could not be removed/);
});

for (const [name, response, expected] of [
  ['NXDOMAIN', { Status: 3 }, 'maybe'],
  ['empty DNS answer', { Status: 0 }, 'maybe'],
  ['CNAME only', { Status: 0, Answer: [{ type: 5 }] }, 'maybe'],
  ['NS record', { Status: 0, Answer: [{ type: 2 }] }, 'active'],
  ['SERVFAIL', { Status: 2 }, 'unknown']
]) test(`${name} is classified without falsely confirming availability`, async t => {
  const h = setup(t, { fetch: async () => ({ ok: true, json: async () => response }) });
  assert.equal(await h.evaluate("checkStatus('example.test')"), expected);
  assert.notEqual(h.evaluate(`parseStatus('${expected}')`), 'available');
});

test('old positive availability cache is ignored and unknown results are not cached', async t => {
  let requests = 0;
  const h = setup(t, { fetch: async () => { requests++; return { ok: false }; } });
  h.w.localStorage.setItem('d_s_example.test', JSON.stringify({ ts: Date.now(), data: 'inactive' }));
  assert.equal(await h.evaluate("checkStatus('example.test')"), 'unknown');
  assert.equal(await h.evaluate("checkStatus('example.test')"), 'unknown');
  assert.equal(requests, 2);
  assert.notEqual(h.evaluate("dotClass('unknown')"), 'dot-loading');
});

test('network failure, malformed DNS JSON, and timeout finish with an unknown status', async t => {
  for (const mode of ['network', 'json', 'timeout']) {
    const h = setup(t, { fetch: async (_, options) => {
      if (mode === 'network') throw new Error('offline');
      if (mode === 'json') return { ok: true, json: async () => { throw new Error('bad JSON'); } };
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    } });
    const pending = h.evaluate("checkStatus('example.test')");
    if (mode === 'timeout') await h.runTimers(8000);
    assert.equal(await pending, 'unknown');
    assert.equal([...h.timers.values()].some(timer => timer.delay === 8000), false);
  }
});

test('changing input invalidates old results immediately, before the next debounce', async t => {
  const pending = deferred(); const h = setup(t, { fetch: () => pending.promise });
  const search = h.evaluate("runSearch('first.test')");
  h.input('second.test');
  pending.resolve({ ok: true, json: async () => ({ Status: 0, Answer: [{ type: 2 }] }) }); await search;
  assert.equal(h.el('results').innerHTML, '');
  assert.equal(h.evaluate('currentResults.length'), 0);
  assert.equal(h.el('spinner').classList.contains('visible'), true);
});

test('clearing input prevents late responses from repopulating results', async t => {
  const pending = deferred(); const h = setup(t, { fetch: () => pending.promise });
  const search = h.evaluate("runSearch('first.test')"); h.input('');
  pending.resolve({ ok: true, json: async () => ({ Status: 3 }) }); await search;
  assert.equal(h.el('results').innerHTML, '');
  assert.equal(h.evaluate('currentResults.length'), 0);
  assert.equal(h.el('spinner').classList.contains('visible'), false);
});

test('editing input cancels deferred history saves; account changes do not inherit searches', async t => {
  const h = setup(t, { user: user('alpha') });
  await h.evaluate("runSearch('first.test')"); h.input('second.test'); await h.runTimers(4000);
  assert.equal(h.calls.filter(call => call.op === 'upsert').length, 0);
  await h.evaluate("runSearch('second.test')");
  h.emit('SIGNED_IN', { user: user('beta') }); await h.runTimers(4000);
  assert.equal(h.calls.filter(call => call.op === 'upsert').length, 0);
});

test('unconfirmed results offer registrar verification and a terminal accessible status', async t => {
  const h = setup(t);
  await h.evaluate("runSearch('example.test')");
  assert.match(h.el('results').textContent, /check registrar/);
  assert.match(h.el('results').textContent, /Confirm availability and pricing/);
  assert.doesNotMatch(h.el('results').textContent, /grab it|buy now/);
  assert.match(h.w.document.querySelector('.status-dot').getAttribute('aria-label'), /unconfirmed/);
  assert.equal(h.el('spinner').classList.contains('visible'), false);
});
