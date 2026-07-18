-- ═══════════════════════════════════════════════════════════════════
-- SEC-001b R1 — Role Authority Migration（forward migration，需套用到已部署 DB）
--
-- 問題：profiles 的 "Users update own profile" policy 只檢查 auth.uid()=id，
--       未保護特權欄位。任何 authenticated 用戶可自行
--         UPDATE profiles SET is_pro=true, pro_role='super_admin' WHERE id=auth.uid()
--       完成自我提權，直接繞過 Admin API 的所有守衛。
--
-- 修法（縱深防禦，三層）：
--   1) 欄位級權限：撤銷整表 UPDATE，只重新授權「安全欄位」。
--   2) trigger：即使日後誤授權，仍擋下非 service_role 對 is_pro/pro_role 的變更。
--   3) RLS UPDATE policy 補 WITH CHECK，避免改寫 id。
--
-- is_pro / pro_role 之後只能由 service_role（Admin API）或 SECURITY DEFINER RPC 變更。
-- ═══════════════════════════════════════════════════════════════════

-- 1) 欄位級權限 ------------------------------------------------------
-- 撤銷整表 UPDATE，只重新授權「安全欄位」。改為動態授權：只 grant 實際存在的欄位，
-- 避免 schema drift（例如某些部署缺 avatar_url）導致 42703 column does not exist。
-- 清單需涵蓋兩個 app 客戶端會更新的欄位：
--   exclincalc: name / institution / license_number / settings
--   clincalc:   name / gender / date_of_birth
-- （is_pro / pro_role 刻意排除 → 只能由 service_role 變更）
revoke update on public.profiles from authenticated;
revoke update on public.profiles from anon;

do $$
declare
  safe_cols text[] := array[
    'name','avatar_url','institution','license_number','settings',
    'email','phone','gender','date_of_birth'
  ];
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'profiles'
    and column_name  = any(safe_cols);

  if cols is not null then
    execute format('grant update (%s) on public.profiles to authenticated', cols);
  end if;
end $$;

-- 2) 防禦縱深 trigger ------------------------------------------------
create or replace function enforce_profile_privilege_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  -- PostgREST 會把 JWT claims 放進此 GUC；直接 SQL（DBA）時為 null → 視為受信任，不阻擋。
  v_role := coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'service_role'
  );
  if v_role <> 'service_role' then
    if new.is_pro is distinct from old.is_pro
       or new.pro_role is distinct from old.pro_role then
      raise exception
        'privilege columns (is_pro, pro_role) can only be changed by service role';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_privilege_guard on public.profiles;
create trigger profiles_privilege_guard
  before update on public.profiles
  for each row execute function enforce_profile_privilege_columns();

-- 3) own-profile UPDATE policy 補 WITH CHECK -------------------------
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

select 'R1 role authority migration applied' as status;
