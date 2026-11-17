-- Read only. Run on the destination AFTER 0004 in the SQL Editor as the owner.
-- Compare actual UUIDs, roles (including any custom roles) and branches to the
-- source. Reports discrepancies; never resets a password or "repairs" a role.
select r.email, u.id as auth_id, r.role as expected_role,
       array(select ur.role::text from public.user_roles ur where ur.user_id = u.id order by 1) as actual_roles,
       r.branch_name as expected_branch, b.name as actual_branch,
       (p.id is not null and lower(p.email) = r.email) as profile_ok,
       (u.email_confirmed_at is not null and coalesce(u.encrypted_password, '') <> '' and
        exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email')) as has_email_login
from public.hm_preset_roles r
left join auth.users u on lower(u.email) = r.email
left join public.profiles p on p.id = u.id
left join public.branches b on b.id = p.branch_id
order by r.email, r.role;

-- All application tables should have RLS. Realtime is intentionally OFF on
-- audit_log, hm_preset_roles, support_threads and chat_members (private data).
select t.tablename, t.rowsecurity as rls,
       exists (select 1 from pg_publication_tables pt where pt.pubname = 'supabase_realtime'
               and pt.schemaname = t.schemaname and pt.tablename = t.tablename) as realtime
from pg_tables t where t.schemaname = 'public' order by t.tablename;

-- Exactly one PRIVATE bucket. Metadata count is not proof that files were copied.
select b.id, b.public, count(o.id) as object_records
from storage.buckets b left join storage.objects o on o.bucket_id = b.id
where b.id = 'hm-files' group by b.id, b.public;
