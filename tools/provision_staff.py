#!/usr/bin/env python3
"""Optional, operator-only bootstrap for a NEW Supabase installation (not a data migration)."""
import getpass
import json
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import UUID


class NoRedirect(HTTPRedirectHandler):
    # Never forward an admin key or employee password to a redirect target.
    def redirect_request(self, *args):
        return None


def client(ref, key):
    opener = build_opener(NoRedirect())
    headers = {"apikey": key, "Content-Type": "application/json"}
    if not key.startswith("sb_secret_"):  # legacy service_role JWT
        headers["Authorization"] = "Bearer " + key

    def request(method, path, data=None):
        body = None if data is None else json.dumps(data).encode()
        req = Request(f"https://{ref}.supabase.co{path}", data=body, headers=headers, method=method)
        try:
            with opener.open(req, timeout=30) as res:
                raw = res.read()
                return json.loads(raw) if raw else None
        except HTTPError as exc:
            # Do not log request/response bodies, headers, or credentials.
            raise RuntimeError(f"{method} {path.split('?')[0]}: HTTP {exc.code}") from None
        except URLError:
            raise RuntimeError("تعذّر الاتصال بمشروع Supabase.") from None

    return request


def provision(request, password_for):
    roster = request("GET", "/rest/v1/hm_preset_roles?select=email,role,full_name,branch_name&order=email")
    if len(roster) != 15 or len({r['email'] for r in roster}) != 15:
        raise RuntimeError("هذه الأداة للقائمة القياسية (15 حساباً) في المشروع الجديد فقط؛ راجع 0004.")
    branches = request("GET", "/rest/v1/branches?select=id,name")
    branch_ids = {}
    for name in {r['branch_name'] for r in roster if r['branch_name']}:
        ids = [b['id'] for b in branches if b['name'] == name]
        if len(ids) != 1:
            raise RuntimeError(f"تعذّر تحديد الفرع: {name}")
        branch_ids[name] = ids[0]

    for r in roster:
        email = r['email']
        profiles = request("GET", "/rest/v1/profiles?" + urlencode({'email': 'eq.' + email, 'select': 'id'}))
        if profiles:
            print(f"{email}: موجود — لم يتم تغيير كلمة المرور أو الصلاحيات أو الفرع.")
            continue
        print(f"{email}: {r['full_name']} ({r['role']})")
        password = password_for(email)
        if len(password) < 6:
            raise RuntimeError("كلمة المرور أقصر من الحد الأدنى.")
        # The Admin API creates both the confirmed auth user and email identity.
        # If the email already exists WITHOUT a profile, create fails; never
        # look up an existing uid by email to grant privileges after a conflict.
        user = request("POST", "/auth/v1/admin/users", {
            'email': email, 'password': password, 'email_confirm': True,
            'user_metadata': {'full_name': r['full_name']},
        })
        del password
        uid = str(UUID(user['id']))
        if user['email'].lower() != email:
            raise RuntimeError("بريد الحساب المنشأ غير مطابق. لم يُمنح أي دور.")
        try:
            profile = request("GET", f"/rest/v1/profiles?id=eq.{uid}&select=id")
            if not profile:
                raise RuntimeError("لم يُنشأ ملف الموظف؛ راجع Auth trigger في 0004.")
            if r['branch_name']:
                request("PATCH", f"/rest/v1/profiles?id=eq.{uid}", {'branch_id': branch_ids[r['branch_name']]})
            request("POST", "/rest/v1/user_roles", {'user_id': uid, 'role': r['role']})
        except RuntimeError as exc:
            raise RuntimeError(f"{email} ({uid}): تم إنشاء الهوية. راجع دورها وفرعها يدوياً ولا تُعد إنشاءها. {exc}") from None
        print("تم الإنشاء والتفعيل.")


def main():
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        raise RuntimeError("شغّل الأداة من طرفية تفاعلية حتى لا تظهر كلمات المرور.")
    print("للتثبيت الجديد فقط. إذا عندك نسخة من القاعدة القديمة، استعدها بدلاً من إنشاء هويات جديدة.")
    ref = input("Project Ref لمشروع Supabase المستقل: ").strip()
    if not re.fullmatch(r"[a-z0-9]{20}", ref):
        raise RuntimeError("Project Ref غير صالح.")
    if input(f"سيتم إنشاء الحسابات الناقصة على https://{ref}.supabase.co فقط. اكتب CREATE للمتابعة: ") != "CREATE":
        return
    key = getpass.getpass("مفتاح secret أو service_role لهذا المشروع (إدخال مخفي): ").strip()
    provision(client(ref, key), lambda email: getpass.getpass(f"كلمة المرور المخصصة لـ {email}: "))
    print("انتهت معالجة القائمة. افحص الحسابات والفروع بواسطة tools/verify.sql ثم جرّب تسجيل الدخول.")


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, KeyError) as err:
        sys.exit(str(err))
    except (KeyboardInterrupt, EOFError):
        sys.exit("توقف الإعداد. الحسابات الموجودة لن تتغيّر عند إعادة التشغيل.")
