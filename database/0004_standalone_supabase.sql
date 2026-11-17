-- Destination only. Run after 0000–0003 (fresh install) OR after a full,
-- compatible schema + data restore. Safe to reapply. No auth users, passwords,
-- existing role assignments, branch assignments or business records are written.

-- Auth: public signup only creates a pending profile. Never grant admin to the
-- first signup, or grant a role because a visitor supplied a particular email.
create or replace function public.hm_handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)), new.email)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created_hm3 on auth.users;
drop function if exists public.hm_apply_preset_roles();
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.hm_handle_new_user();

-- Private roster used only to check a migration or explicitly bootstrap a NEW
-- installation. It is not an authorization source. RLS still uses user_roles.
create table if not exists public.hm_preset_roles (
  email text not null, role text not null, full_name text, primary key (email, role)
);
alter table public.hm_preset_roles add column if not exists branch_name text;
alter table public.hm_preset_roles enable row level security;
revoke all on public.hm_preset_roles from public, anon, authenticated;
grant all on public.hm_preset_roles to service_role;
insert into public.hm_preset_roles (email, role, full_name, branch_name) values
  ('admin@homemarble.com',       'admin',               'مدير النظام',         null),
  ('ceo@homemarble.com',         'executive',           'المدير التنفيذي',     null),
  ('sales.riyadh@homemarble.com','sales',               'مبيعات الرياض',       'معرض الرياض'),
  ('sales.kharj@homemarble.com', 'sales',               'مبيعات الخرج',        'معرض الخرج'),
  ('factory@homemarble.com',     'factory_manager',     'مدير المصنع',         null),
  ('accounting@homemarble.com',  'accountant',          'المحاسبة والمالية',    null),
  ('purchasing@homemarble.com',  'purchasing',          'المشتريات',           null),
  ('warehouse@homemarble.com',   'warehouse',           'أمين المستودع',       null),
  ('cutting@homemarble.com',     'cutting_supervisor',  'مشرف القص',           null),
  ('assembly@homemarble.com',    'assembly_supervisor', 'مشرف التجميع',        null),
  ('polishing@homemarble.com',   'polishing_supervisor','مشرف التلميع',        null),
  ('quality@homemarble.com',     'quality_inspector',   'مراقب الجودة',        null),
  ('measurement@homemarble.com', 'measurement_tech',    'فني القياسات',        null),
  ('install@homemarble.com',     'installer',           'فريق التركيبات',      null),
  ('support@homemarble.com',     'support',             'الدعم الفني',         null)
on conflict (email, role) do nothing;

-- Storage: keep object paths, MIME/size settings and existing files untouched.
insert into storage.buckets (id, name, public) values ('hm-files', 'hm-files', false)
on conflict (id) do nothing;
do $$ begin
  if exists (select 1 from storage.buckets where id = 'hm-files' and public) then
    raise exception 'hm-files must be a private bucket. Review its settings in Storage before continuing.';
  end if;
end $$;
drop policy if exists "hm_files_read" on storage.objects;
drop policy if exists "hm_files_insert" on storage.objects;
drop policy if exists "hm_files_delete" on storage.objects;
create policy "hm_files_read" on storage.objects for select to authenticated
  using (bucket_id = 'hm-files' and public.hm_is_staff());
create policy "hm_files_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'hm-files' and public.hm_is_staff());
create policy "hm_files_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'hm-files' and public.hm_has_any(array['admin','executive','factory_manager']));

-- Realtime: restore membership even when the source dump omitted publications.
-- No FOR ALL TABLES: in particular do not add auth or the visitor-token tables.
do $$ declare t text; begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['branches','profiles','user_roles','customers','orders','documents',
    'suppliers','inventory_items','inventory_movements','inventory_reservations','purchase_requests',
    'order_items','production_logs','quality_checks','measurement_visits','installation_jobs',
    'support_password_requests','support_messages','chat_rooms','chat_messages','saved_reports','deleted_records',
    'fin_entries','hr_employees','hr_leaves','hr_policies','announcements','mkt_campaigns','store_products','store_orders','coupons'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
notify pgrst, 'reload schema';
