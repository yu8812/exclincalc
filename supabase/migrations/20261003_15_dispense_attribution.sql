-- ═══════════════════════════════════════════════════════════════════
-- 15：調配紀錄由資料庫蓋章（THREAT_MODEL 的 R2）
--
-- 之前藥師按「完成調配」只寫 dispensed_at，dispensed_by 一直是空的；而且這兩個欄位都由前端決定，
-- 藥師可以把 dispensed_by 寫成別人，也可以把時間往前填。
--
-- 現在由 BEFORE trigger 決定，前端傳什麼都不算：
--   * 從「未調配」變成「已調配」：時間 = 資料庫的 now()，調配者 = 這次登入的人（auth.uid()）
--   * 已調配過的紀錄：時間和調配者都不能再改（再送一次也會被還原成原本的值）
--   * 改回未調配（取消）：兩個欄位一起清空；是誰取消的，會留在 clinical_audit_log（migration 14）
--   * 伺服器端（service role）或 SQL editor 沒有登入者，照它給的值，例如匯入示範資料
--
-- 這不是電子簽章：它證明的是「哪個帳號在什麼時間按的」，帳號本身要靠 MFA 和密碼保護。
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.stamp_dispense()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.dispensed_at is null then
      new.dispensed_by := null;
    else
      new.dispensed_at := now();
      new.dispensed_by := auth.uid();
    end if;
  elsif new.dispensed_at is null then
    new.dispensed_by := null;
  elsif old.dispensed_at is null then
    new.dispensed_at := now();
    new.dispensed_by := auth.uid();
  else
    new.dispensed_at := old.dispensed_at;
    new.dispensed_by := old.dispensed_by;
  end if;
  return new;
end;
$$;
revoke execute on function public.stamp_dispense() from public, anon, authenticated;

drop trigger if exists clinical_records_stamp_dispense on public.clinical_records;
create trigger clinical_records_stamp_dispense
  before insert or update on public.clinical_records
  for each row execute function public.stamp_dispense();

select 'migration 15：調配時間與調配者改由資料庫決定' as status;
