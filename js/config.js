// إعدادات الاتصال بقاعدة البيانات (Lovable Cloud) — مفتاح عام آمن للاستخدام في المتصفح
window.HM_CONFIG = {
  url: "https://c--466ea992-70a0-4086-84a9-80d4791a1e05-prod.lovable.cloud",
  key: "sb_publishable_9jLWzUzM1xHSibWMkknzUw_SDoaR7LQ",
};

// فحص الاتصال: لو قاعدة البيانات غير متاحة تظهر رسالة واضحة بدل رفض الدخول بدون سبب
(function () {
  var c = window.HM_CONFIG;
  function warn(msg) {
    var show = function () {
      if (document.getElementById("hm-db-warn")) return;
      var d = document.createElement("div");
      d.id = "hm-db-warn";
      d.setAttribute("role", "alert");
      d.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;background:#b42318;color:#fff;padding:12px 16px;text-align:center;font:600 15px Tajawal,sans-serif;direction:rtl";
      d.textContent = msg;
      document.body.appendChild(d);
    };
    if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
  }
  try {
    fetch(c.url + "/auth/v1/health", { headers: { apikey: c.key }, cache: "no-store" })
      .then(function (r) {
        if (!r.ok && r.status >= 500) warn("تعذّر الاتصال بقاعدة بيانات النظام حالياً — المشكلة ليست في البريد أو كلمة المرور. حاول بعد دقائق، وإن استمرت تواصل مع مسؤول النظام.");
      })
      .catch(function () {
        warn("تعذّر الاتصال بقاعدة بيانات النظام — المشكلة ليست في البريد أو كلمة المرور. تأكد من الإنترنت، وإن استمرت الرسالة تواصل مع مسؤول النظام.");
      });
  } catch (e) {}
})();
