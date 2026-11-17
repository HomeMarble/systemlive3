// npm ci && npm test. Run the actual static scripts + pinned browser SDK.
// Fetch, Realtime and (for dashboard cases) the signed-in identity are fixtures.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const base = 'https://fixture-project.supabase.co';
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'fixture@example.invalid' };
const cust = id => ({ id, name: 'Customer ' + id });
const httpError = (status, code, message) => Response.json({ code, message }, { status });

function browser(t, { staff = true, route = '#/customers', intercept, sessionError } = {}) {
  const dom = new JSDOM(html, { url: 'https://fixture.invalid/systemlive/' + route, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window, doc = w.document;
  Object.assign(w, { fetch, Headers, Request, Response, TextDecoder, TextEncoder, AbortController, AbortSignal, structuredClone, scrollTo() {} });
  w.WebSocket = class { constructor() { throw Error('No socket is permitted in this test'); } };
  const state = { w, user, requests: [], signouts: 0, intercept, sessionError, cap: 1000, errors: [], data: {
    profiles: [{ ...user, full_name: 'Fixture Employee' }], branches: [], user_roles: [{ user_id: user.id, role: 'admin' }], customers: [cust('old')],
  } };
  w.addEventListener('error', e => state.errors.push(e.error));
  // auth-js logs rejected fetches to the developer console before returning its error.
  w.console.error = (...a) => { if (!String(a[0]).includes('Failed to fetch')) state.errors.push(a); };
  t.after(() => assert.deepEqual(state.errors, []));
  const session = () => state.user ? { user: state.user, access_token: 'synthetic-session' } : null;
  w.fetch = async (input, opts = {}) => {
    const u = new URL(input), method = opts.method || 'GET', params = u.searchParams;
    assert.equal(u.origin, base, 'no CDN, legacy project or other service');
    const table = u.pathname.split('/').pop();
    const req = { table, path: u.pathname, params, method, from: Number(params.get('offset') || 0), opts };
    state.requests.push(req);
    const override = await state.intercept?.(req);
    if (override !== undefined) return override;
    if (u.pathname === '/auth/v1/settings') return Response.json({ external: { email: true } });
    assert.ok(u.pathname.startsWith('/rest/v1/'), 'no unexpected Auth call');
    assert.equal(method, 'GET', 'mutations must have an explicit fixture');
    let rows = state.data[table] || [];
    for (const [key, val] of params) if (val.startsWith('eq.')) rows = rows.filter(r => r[key] === val.slice(3));
    const count = rows.length, limit = Math.min(Number(params.get('limit') ?? 1000), state.cap);
    rows = rows.slice(req.from, req.from + limit);
    return Response.json(rows, { headers: { 'Content-Range': (rows.length ? `${req.from}-${req.from + rows.length - 1}` : '*') + '/' + count } });
  };
  w.HM_EXT = [{ init(c) { state.ctx = c; } }];
  for (const tag of doc.querySelectorAll('script[src]')) {
    const src = tag.getAttribute('src').split('?')[0];
    assert.ok(src.startsWith('js/'), 'all login scripts must be served from Pages itself');
    if (src === 'js/config.js') { w.HM_CONFIG = { url: base, key: 'sb_publishable_fixture' }; continue; }
    w.eval(fs.readFileSync(path.join(root, src), 'utf8'));
    if (src.startsWith('js/vendor/')) {
      assert.equal(typeof w.supabase.createClient, 'function');
      const create = w.supabase.createClient;
      w.supabase = { createClient(url, key, opts) {
        const db = create(url, key, { ...opts, auth: { persistSession: false, autoRefreshToken: false } });
        if (staff) {
          db.auth.getSession = async () => ({ data: { session: session() }, error: null });
          db.auth.getUser = async () => ({ data: { user: state.user }, error: state.sessionError });
          db.auth.signOut = async () => { state.signouts++; return { error: null }; };
          db.auth.onAuthStateChange = fn => { state.emit = fn; fn('INITIAL_SESSION', session()); };
          db.channel = () => { const ch = { on() { return ch; }, subscribe(cb) { cb('SUBSCRIBED'); return ch; } }; return ch; };
          db.removeChannel = () => {};
        }
        return db;
      } };
    }
  }
  state.$ = sel => doc.querySelector(sel);
  state.text = () => state.$('#app').textContent;
  state.wait = async fn => {
    if (fn()) return;
    await new Promise((resolve, reject) => {
      const obs = new w.MutationObserver(() => { if (fn()) { clearTimeout(timer); obs.disconnect(); resolve(); } });
      obs.observe(doc.body, { subtree: true, childList: true, characterData: true });
      const timer = setTimeout(() => { obs.disconnect(); reject(Error('UI did not settle: ' + state.text().slice(0, 300))); }, 12000);
    });
  };
  return state;
}

test('actual SDK: sign-in network failure vs rejected login; check from the same form needs no password', async t => {
  const b = browser(t, { staff: false, route: '' });
  await b.wait(() => b.$('#authf'));
  const submit = () => b.$('#authf').dispatchEvent(new b.w.Event('submit', { cancelable: true }));
  b.intercept = r => { if (r.path === '/auth/v1/token') throw new TypeError('Failed to fetch'); };
  b.$('[name=email]').value = user.email; b.$('[name=password]').value = 'fixture-only';
  submit(); await b.wait(() => b.$('#hm-status').textContent.includes('لم يصل رد'));
  assert.ok(!b.text().includes('Failed to fetch'));
  assert.equal(b.requests.filter(r => r.method === 'POST').length, 1);
  b.intercept = r => r.path === '/auth/v1/token' ? httpError(400, 'invalid_credentials', 'Invalid login credentials') : undefined;
  submit(); await b.wait(() => b.text().includes('البريد أو كلمة المرور غير صحيحة'));
  b.$('[name=email]').value = ''; b.$('[name=password]').value = '';
  const n = b.requests.length; b.$('#hm-check').click();
  await b.wait(() => b.text().includes('الدخول بالبريد مفعّل'));
  assert.deepEqual(b.requests.slice(n).map(r => [r.method, r.path, r.opts.credentials, r.opts.body]), [
    ['GET', '/auth/v1/settings', 'omit', undefined], ['GET', '/rest/v1/rpc/hm_store_catalog', 'omit', undefined],
  ]);
});

test('an interrupted later page never replaces the last complete snapshot; retry recovers all pages including server-capped ranges', async t => {
  const b = browser(t); await b.wait(() => b.$('#hm-live'));
  const old = b.ctx.S.customers, oldOrders = b.ctx.S.orders;
  b.data.customers = [cust('first'), cust('second')]; b.cap = 1;
  let laterPages = 0;
  b.intercept = r => { if (r.table === 'customers' && r.from === 1) { laterPages++; throw new TypeError('Failed to fetch'); } };
  await b.ctx.refresh();
  assert.equal(laterPages, 4, 'pinned SDK made bounded read-only retries');
  assert.equal(b.ctx.S.customers, old); assert.equal(b.ctx.S.orders, oldOrders);
  assert.ok(b.$('#hm-retry')); assert.ok(b.text().includes('لم يكتمل تحميل البيانات'));
  b.ctx.render(); assert.ok(!b.$('#hm-live'), 'hash change cannot expose an incomplete snapshot');
  b.intercept = undefined; b.$('#hm-retry').click(); await b.wait(() => b.$('#hm-live'));
  assert.deepEqual(Array.from(b.ctx.S.customers, c => c.id), ['first', 'second']);
  assert.equal(b.signouts, 0); assert.ok(b.requests.every(r => r.method === 'GET'));
});

test('failure of either roles, core or any extension stays a failure, not pending, zero records, or an applied partial refresh', async t => {
  const b = browser(t); await b.wait(() => b.$('#hm-live'));
  const original = b.ctx.S.customers;
  b.data.customers = [cust('new')];
  for (const table of ['branches', 'audit_log', 'production_logs', 'fin_entries', 'saved_reports', 'user_roles']) {
    b.intercept = r => r.table === table ? httpError(403, '42501', 'permission denied') : undefined;
    await b.ctx.refresh(true);
    assert.equal(b.ctx.S.customers, original, table); assert.ok(b.$('#hm-retry'), table);
    assert.ok(!b.text().includes('بانتظار التفعيل'), table);
  }
  b.intercept = undefined; b.$('#hm-retry').click(); await b.wait(() => b.$('#hm-live'));
  assert.equal(b.ctx.S.customers[0].id, 'new');
});

test('session check failure does not sign the employee out; a late response after sign-out cannot publish old data', async t => {
  const b = browser(t, { sessionError: { status: 0, message: 'Load failed' } });
  await b.wait(() => b.$('#hm-retry'));
  assert.ok(b.text().includes('تعذّر التحقق من الجلسة')); assert.equal(b.signouts, 0);
  b.sessionError = null; b.$('#hm-retry').click(); await b.wait(() => b.$('#hm-live'));
  let paused, release;
  const started = new Promise(resolve => { paused = resolve; });
  b.intercept = r => { if (r.table === 'fin_entries') return new Promise(resolve => { release = resolve; paused(); }); };
  const pending = b.ctx.refresh(); await started;
  b.user = null; b.emit('SIGNED_OUT', null); assert.ok(b.$('#authf'));
  release(Response.json([])); await pending;
  assert.ok(b.$('#authf')); assert.equal(b.ctx.S.customers.length, 0);
});

test('a lost acknowledgement after bulk INSERT is never replayed or reported as a successful import', async t => {
  const b = browser(t); await b.wait(() => b.$('[data-act="ex-import-customers"]'));
  b.$('[data-act="ex-import-customers"]').click();
  const extras = b.w.HM_EXT.find(x => x.name === 'extras');
  await extras._test.E._importHandle(new b.w.File(['name,phone\nA,123\nB,456'], 'people.csv'));
  b.intercept = r => {
    if (r.table === 'customers' && r.method === 'POST') {
      const payload = JSON.parse(r.opts.body); assert.ok(Array.isArray(payload));
      b.data.customers.push(...payload.map(c => ({ ...c, id: c.name })));
      throw new TypeError('Failed to fetch'); // database already committed this request
    }
  };
  b.$('#ex-do-import').click();
  await b.wait(() => b.$('#toast-root').textContent.includes('لم نكرر الطلب الأخير'));
  await b.wait(() => b.ctx.S.customers.length === 3);
  assert.equal(b.requests.filter(r => r.method === 'POST').length, 1);
  assert.equal(b.data.customers.length, 3); assert.ok(!b.$('#toast-root').textContent.includes('بنجاح'));
});

test('public catalog and coupon errors are not cached as empty/missing', async t => {
  const b = browser(t, { staff: false, route: '#/shop', intercept: r => httpError(502, 'upstream', 'unavailable') });
  await b.wait(() => b.$('[data-p3-retry]')); assert.ok(!b.text().includes('لا توجد منتجات'));
  b.intercept = undefined; b.$('[data-p3-retry]').click(); await b.wait(() => b.text().includes('لا توجد منتجات'));
  b.intercept = r => httpError(502, 'upstream', 'unavailable'); b.w.location.hash = '#/coupon/demo';
  await b.wait(() => b.$('#p3-cpbox [data-p3-retry]')); assert.ok(!b.text().includes('الكوبون غير موجود'));
  b.intercept = () => Response.json({ found: false }); b.$('[data-p3-retry]').click();
  await b.wait(() => b.text().includes('الكوبون غير موجود'));
});

test('standalone preflight rejects a Lovable destination and privileged input locally, without any request or saved settings', async t => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'connection.html'), 'utf8'), { url: 'https://fixture.invalid/connection.html', runScripts: 'outside-only' });
  const w = dom.window; t.after(() => w.close());
  const seen = []; w.fetch = async url => { seen.push(url); return Response.json(url.endsWith('settings') ? { external: { email: true } } : []); };
  w.HM_CONFIG = { url: 'https://fixture.lovable.cloud', key: 'sb_publishable_fixture' };
  const $ = sel => w.document.querySelector(sel);
  for (const file of ['connection', 'check-page']) w.eval(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'));
  assert.ok($('#hm-check').disabled); assert.match($('#hm-destination').textContent, /Lovable Cloud/);
  $('#hm-url').value = base; $('#hm-public').value = 'sb_secret_fixture';
  await $('#hm-test-target').onclick(); assert.ok(!$('#hm-target-status').textContent.includes($('#hm-public').value));
  assert.equal(seen.length, 0);
  $('#hm-public').value = 'sb_publishable_fixture'; await $('#hm-test-target').onclick();
  assert.equal(seen.length, 2); assert.ok(seen.every(url => url.startsWith(base + '/')));
  assert.ok($('#hm-target-status').textContent.includes('واجهة البيانات: متاحة'));
  assert.equal(w.HM_CONFIG.url, 'https://fixture.lovable.cloud'); assert.equal(w.localStorage.length, 0);
});

test('a transient read recovers without a second login; online retries incomplete reads only', async t => {
  const b = browser(t); await b.wait(() => b.$('#hm-live'));
  let attempts = 0;
  b.intercept = r => { if (r.table === 'customers' && ++attempts === 1) throw new TypeError('Failed to fetch'); };
  b.data.customers = [cust('recovered')]; await b.ctx.refresh();
  assert.equal(attempts, 2); assert.ok(b.text().includes('Customer recovered'));
  b.intercept = r => r.table === 'customers' ? Response.json([cust('partial')]) : undefined; // no Content-Range for count:exact
  await b.ctx.refresh(); assert.ok(b.$('#hm-retry')); assert.equal(b.ctx.S.customers[0].id, 'recovered');
  b.intercept = undefined; b.w.dispatchEvent(new b.w.Event('online')); await b.wait(() => b.$('#hm-live'));
  assert.equal(b.signouts, 0); assert.ok(b.requests.every(r => r.method === 'GET'));
});
