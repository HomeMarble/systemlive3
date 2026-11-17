// node --test tests/connection.test.cjs (no packages, network or real keys needed)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const script = f => readFileSync(require.resolve('../js/' + f + '.js'), 'utf8');
const url = 'https://test-project.supabase.co';
const pub = { url, key: 'sb_publishable_test' };
const jwt = (role, ref) => `header.${Buffer.from(JSON.stringify({ role, ref })).toString('base64url')}.signature`;
function start(config, sdk = true) {
  const element = { innerHTML: '' }, calls = [];
  const window = { HM_CONFIG: config, addEventListener() {}, navigator: { onLine: true } };
  if (sdk) window.supabase = { createClient(...args) {
    calls.push(args);
    return { auth: { onAuthStateChange() {} } };
  } };
  const ctx = vm.createContext({ document: { querySelector: () => element }, window, atob, setTimeout, clearTimeout, AbortController });
  vm.runInContext(script('connection'), ctx);
  vm.runInContext(script('app'), ctx);
  return { calls, html: element.innerHTML, net: window.HMNet, navigator: window.navigator };
}

test('unconfigured, non-project URL, mismatched anon JWT or privileged key: no client or probe', async () => {
  for (const config of [undefined, {}, { url: '', key: pub.key },
    { url: 'https://fixture.lovable.cloud', key: pub.key }, { url: 'https://supabase.com/dashboard', key: pub.key }, { url: url + '/elsewhere', key: pub.key },
    { url, key: 'sb_secret_test' }, { url, key: jwt('service_role') }, { url, key: jwt('anon', 'another-project') }, { url, key: 'not-a-key' }]) {
    const { calls, html, net } = start(config);
    assert.equal(calls.length, 0);
    assert.match(html, /js\/config.js/);
    assert.doesNotMatch(html, /<form/);
    if (config?.key) assert.ok(!html.includes(config.key));
    assert.match(await net.diagnose(config, assert.fail), /js\/config.js/);
  }
});
test('one client for the configured project, with either public key format', () => {
  for (const key of [pub.key, jwt('anon', 'test-project')]) {
    const { calls } = start({ url: url + '/', key });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 2), [url, key]);
    assert.equal(calls[0][2].db.retry, true);
  }
});
test('local SDK loading failure leaves the independent check available', () => {
  assert.match(start(pub, false).html, /تعذّر تحميل مكتبة Supabase/);
  assert.match(start(pub, false).html, /id="hm-check"/);
});
test('diagnostic is read-only, sends only the public key to the configured host, and has no dependency on a session', async () => {
  const { net } = start(pub, false), seen = [];
  const result = await net.diagnose(pub, async (target, opts) => {
    seen.push(target);
    assert.equal(new URL(target).origin, url);
    assert.equal(opts.method, 'GET'); assert.equal(opts.credentials, 'omit'); assert.equal(opts.cache, 'no-store');
    assert.equal(opts.referrerPolicy, 'no-referrer'); assert.equal(opts.redirect, 'error');
    assert.equal(opts.body, undefined); assert.deepEqual(Object.entries(opts.headers), [['apikey', pub.key]]);
    return Response.json(target.endsWith('/settings') ? { external: { email: true } } : []);
  });
  assert.deepEqual(seen, [url + '/auth/v1/settings', url + '/rest/v1/rpc/hm_store_catalog?select=id&limit=0']);
  assert.match(result, /الدخول بالبريد مفعّل/); assert.match(result, /دالة نظام Home Marble استجابت/);
  assert.ok(!result.includes(pub.key));
});
test('HTTP rejection is not a network failure, never leaks response bodies and identifies the failing service', async () => {
  const { net } = start(pub), sensitiveBody = 'do-not-display-body';
  for (const status of [401, 403, 404, 429, 503]) {
    const result = await net.diagnose(pub, async target => target.endsWith('/settings') ? new Response(sensitiveBody, { status }) : Response.json([]));
    assert.match(result, new RegExp('خدمة الدخول: وصل رد HTTP ' + status));
    assert.match(result, /واجهة البيانات: متاحة/); assert.ok(!result.includes(sensitiveBody));
  }
  const invalid = await net.diagnose(pub, async target => target.endsWith('/settings') ? Response.json({ external: { email: false } }) : new Response('<html>portal</html>'));
  assert.match(invalid, /البريد غير مفعّل/); assert.match(invalid, /الرد ليس نتيجة فحص/);
});
test('network failure, device offline and deadline are distinguishable; a later check can recover', async () => {
  const { net, navigator } = start(pub), down = async () => { throw new TypeError('Failed to fetch'); };
  assert.match(await net.diagnose(pub, down), /لم يصل رد مقروء/);
  navigator.onLine = false; assert.match(await net.diagnose(pub, down), /الجهاز غير متصل/); navigator.onLine = true;
  const hung = (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  assert.match(await net.diagnose(pub, hung, 5), /انتهت المهلة/);
  assert.match(await net.diagnose(pub, async () => Response.json({ external: { email: true } })), /الدخول بالبريد مفعّل/);
});
test('only a genuine optional schema error can be read as missing; failed reads can never become zero rows', () => {
  const { net } = start(pub);
  for (const r of [{ data: null, error: null }, { status: 0, error: { message: 'Failed to fetch' } },
    { status: 503, error: { code: 'PGRST002', message: 'Could not query the database for the schema cache' } }, { status: 403, error: { code: '42501' } }]) {
    assert.throws(() => net.rows(r, true));
  }
  assert.equal(net.rows({ status: 404, error: { code: 'PGRST205' } }, true).length, 0);
  assert.equal(net.rows({ data: [], error: null }).length, 0);
});
