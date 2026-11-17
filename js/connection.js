/* Shared by the ERP and the read-only, SDK-independent connection check. */
(function () {
  const publicKeyHint = "استخدم مفتاح المتصفح Publishable أو anon من نفس مشروع Supabase في js/config.js، وليس مفتاحاً سرياً.";
  function config(raw = {}) {
    const url = String(raw?.url || "").trim().replace(/\/$/, "");
    const key = String(raw?.key || "").trim();
    const host = /^https:\/\/([a-z0-9-]+)\.supabase\.co$/i.exec(url);
    if (!host) {
      if (/^https:\/\/(?:[a-z0-9-]+\.)*lovable\.cloud$/i.test(url)) return { error: "العنوان في js/config.js تابع لـ Lovable Cloud، وليس لمشروع Supabase المستقل. لم نرسل طلباً إليه. استخدم Project URL والمفتاح العام للوجهة المستعادة." };
      return { error: "اضبط Project URL لمشروع الشركة في js/config.js (وليس رابط لوحة التحكم)." };
    }
    if (!/^sb_publishable_[\w-]+$/.test(key)) {
      try {
        const parts = key.split(".");
        const claims = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (parts.length !== 3 || parts.some(p => !p) || claims.role !== "anon" || (claims.ref && claims.ref !== host[1])) return { error: publicKeyHint };
      } catch { return { error: publicKeyHint }; }
    }
    return { url, key };
  }

  const text = e => String(e?.message || e?.error_description || "");
  function message(e, context) {
    const msg = text(e);
    if (/invalid login credentials/i.test(msg) || e?.code === "invalid_credentials") return "البريد أو كلمة المرور غير صحيحة.";
    if (/invalid api key|invalid publishable key/i.test(msg)) return publicKeyHint;
    if (/timed?\s*out|timeout|AbortError|TimeoutError/i.test(`${e?.name} ${msg}`)) return "انتهت مهلة الطلب أو تم إلغاؤه. افحص الاتصال قبل المحاولة مرة أخرى.";
    if (e?.status === 0 || /failed to fetch|fetch failed|network\s?error|network request failed|load failed/i.test(msg)) {
      const reason = window.navigator?.onLine === false ? "الجهاز غير متصل بالشبكة." : "لم يصل رد من خدمة Supabase إلى المتصفح.";
      if (context === 'login') return reason + " استخدم «فحص الاتصال»؛ لم يصل رد يؤكد تسجيل الدخول.";
      if (context === 'read') return reason + " استخدم «فحص الاتصال» ثم أعد المحاولة.";
      return reason + " افحص الاتصال، وراجع البيانات قبل تكرار أي عملية حفظ.";
    }
    if (e?.status === 429) return "الخدمة تحدّ عدد الطلبات مؤقتاً. انتظر قليلاً ثم حاول مجدداً.";
    if (e?.status >= 500) return `خدمة Supabase غير متاحة الآن (HTTP ${e.status}). تحقّق من حالة المشروع ثم أعد الاتصال.`;
    return msg || "حدث خطأ غير متوقع";
  }

  // Only an actually missing optional phase may degrade to an empty section.
  // A failed network read is NEVER a successful empty page or end of pagination.
  const missing = r => ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(r?.error?.code);
  function checked(r) {
    if (r && !r.error) return r;
    const e = r?.error;
    throw Object.assign(new Error(text(e) || "لم يصل رد سليم من الخدمة."), { code: e?.code, status: r?.status ?? e?.status });
  }
  function rows(r, optional = false) {
    if (optional && missing(r)) return [];
    if (!Array.isArray(checked(r).data)) throw new Error("ردّ الخدمة لا يحتوي على قائمة البيانات المطلوبة.");
    return r.data;
  }

  // No session, passwords, cookies, storage reads or business writes. A REST
  // failure is separate from Auth. Never show response bodies/keys in a report.
  async function diagnose(raw, fetcher = (...args) => window.fetch(...args), timeoutMs = 8000) {
    const cfg = config(raw);
    if (cfg.error) return cfg.error;
    async function probe(path, validate) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetcher(cfg.url + path, { method: 'GET', headers: { apikey: cfg.key }, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal });
        if (!res.ok) {
          const hint = res.status === 401 || res.status === 403 ? 'راجع المفتاح العام وصلاحية الخدمة.' : res.status === 404 ? 'راجع عنوان المشروع وتثبيت مخطط النظام.' : res.status === 429 ? 'انتظر قبل تكرار الفحص.' : 'راجع حالة الخدمة في لوحة Supabase.';
          return `وصل رد HTTP ${res.status} — ${hint}`;
        }
        let data;
        try { data = await res.json(); } catch (e) { if (e?.name !== "SyntaxError") throw e; }
        return validate(data);
      } catch {
        if (controller.signal.aborted) return 'انتهت المهلة دون رد كامل.';
        if (window.navigator?.onLine === false) return 'الجهاز غير متصل بالشبكة.';
        return 'لم يصل رد مقروء. جرّب شبكة أخرى وراجع عنوان المشروع وحالته وقيود الشبكة أو المتصفح (DNS/TLS/CORS).';
      } finally { clearTimeout(timer); }
    }
    const [auth, data] = await Promise.all([
      probe('/auth/v1/settings', d => typeof d?.external?.email !== 'boolean' ? 'الرد ليس إعدادات Supabase Auth المتوقعة.' : d.external.email ? 'متاحة، والدخول بالبريد مفعّل.' : 'متاحة لكن الدخول بالبريد غير مفعّل.'),
      probe('/rest/v1/rpc/hm_store_catalog?select=id&limit=0', d => Array.isArray(d) && !d.length ? 'متاحة؛ دالة نظام Home Marble استجابت.' : 'الرد ليس نتيجة فحص Home Marble المتوقعة.'),
    ]);
    return `المشروع: ${cfg.url}\nخدمة الدخول: ${auth}\nواجهة البيانات: ${data}`;
  }
  function bindCheck(raw, button, output) {
    button.onclick = async () => {
      button.disabled = true; output.textContent = "جارٍ فحص الاتصال دون تسجيل دخول…";
      try { output.textContent = await diagnose(typeof raw === 'function' ? raw() : raw); }
      catch { output.textContent = "تعذّر تشغيل الفحص. جرّب متصفحاً محدثاً."; }
      finally { button.disabled = false; }
    };
  }
  window.HMNet = Object.freeze({ config, message, checked, missing, rows, diagnose, bindCheck });
})();
