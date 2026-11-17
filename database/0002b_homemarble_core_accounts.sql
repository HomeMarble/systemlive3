do $$
declare a record; uid uuid; br uuid;
  accs text[][] := array[
    ['admin@homemarble.com',        'HM-Admin#2026x',  'مدير النظام',              'admin',           ''],
    ['ceo@homemarble.com',          'HM-Ceo#2026q',    'المدير التنفيذي',          'executive',       ''],
    ['sales.riyadh@homemarble.com', 'HM-SalesR#2026k', 'موظف مبيعات معرض الرياض',  'sales',           'الرياض'],
    ['sales.kharj@homemarble.com',  'HM-SalesK#2026m', 'موظف مبيعات معرض الخرج',   'sales',           'الخرج'],
    ['factory@homemarble.com',      'HM-Factory#2026z','مدير المصنع',              'factory_manager', ''],
    ['accounting@homemarble.com',   'HM-Acc#2026w',    'المحاسبة والمشتريات',      'accountant',      '']];
  i int;
begin
  perform set_config('search_path', 'public, extensions', true);
  for i in 1..array_length(accs, 1) loop
    select id into uid from auth.users where lower(email) = accs[i][1];
    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                              confirmation_token, email_change, email_change_token_new, recovery_token)
      values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', accs[i][1],
              crypt(accs[i][2], gen_salt('bf')), now(),
              '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', accs[i][3]),
              now(), now(), '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, uid::text,
              jsonb_build_object('sub', uid::text, 'email', accs[i][1], 'email_verified', true), 'email', now(), now(), now());
    end if;
    insert into public.profiles (id, full_name, email) values (uid, accs[i][3], accs[i][1])
      on conflict (id) do update set full_name = excluded.full_name;
    insert into public.user_roles (user_id, role) values (uid, accs[i][4]::public.app_role) on conflict do nothing;
    if accs[i][5] <> '' then
      select id into br from public.branches where city = accs[i][5] limit 1;
      update public.profiles set branch_id = br where id = uid;
    end if;
  end loop;
end $$;