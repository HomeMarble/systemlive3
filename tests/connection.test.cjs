// node --test tests/connection.test.cjs (no SDK/network or real keys needed)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const app = readFileSync(require.resolve('../js/app.js'), 'utf8');
const url = 'https://test-project.supabase.co';
const jwt = role => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
function start(config, sdk = true) {
  const element = { innerHTML: '' }, calls = [];
  const window = { HM_CONFIG: config, addEventListener() {} };
  if (sdk) window.supabase = { createClient(...args) {
    calls.push(args);
    return { auth: { onAuthStateChange() {} } };
  } };
  vm.runInNewContext(app, { document: { querySelector: () => element }, window, atob });
  return { calls, html: element.innerHTML };
}

test('unconfigured, non-project URL or privileged key: no client, no login form, no key echoed', () => {
  for (const config of [undefined, {}, { url: '', key: 'sb_publishable_test' },
    { url: 'https://supabase.com/dashboard', key: 'sb_publishable_test' },
    { url, key: 'sb_secret_test' }, { url, key: jwt('service_role') }, { url, key: 'not-a-key' }]) {
    const { calls, html } = start(config);
    assert.equal(calls.length, 0);
    assert.match(html, /js\/config.js/);
    assert.doesNotMatch(html, /<form/);
    if (config?.key) assert.ok(!html.includes(config.key));
  }
});
test('one client for the configured project, with either public key format', () => {
  for (const key of ['sb_publishable_test', jwt('anon')]) {
    assert.deepEqual(start({ url: url + '/', key }).calls, [[url, key]]);
  }
});
test('SDK loading failure is visible, not a hanging spinner', () => {
  assert.match(start({ url, key: 'sb_publishable_test' }, false).html, /تعذّر تحميل/);
});
