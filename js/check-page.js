/* Standalone diagnostic: no SDK, auth session, web storage, form or auto-probe. */
(function () {
  const dest = document.getElementById('hm-destination'), btn = document.getElementById('hm-check');
  const net = window.HMNet, cfg = net?.config(window.HM_CONFIG);
  if (!net) { dest.textContent = 'ملفات الفحص غير مكتملة.'; return; }
  net.bindCheck(() => ({ url: document.getElementById('hm-url').value, key: document.getElementById('hm-public').value }), document.getElementById('hm-test-target'), document.getElementById('hm-target-status'));
  if (cfg.error) { dest.textContent = cfg.error; return; }
  dest.textContent = cfg.url;
  net.bindCheck(cfg, btn, document.getElementById('hm-status'));
  btn.disabled = false;
})();
