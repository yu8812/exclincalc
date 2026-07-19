-- ═══════════════════════════════════════════════════════════
-- 病患-醫師授權連結系統
-- 最後更新：2026-04-20
--
-- 流程：
--   1. 醫師在 ExClinCalc 點「邀請 ClinCalc 用戶授權」→ 產生 invite_token
--   2. 醫師將連結傳給病患：https://clincalc.pages.dev/consent/{token}
--   3. 病患登入 ClinCalc → 點同意 → RPC accept_consent(token) 寫入授權
--   4. 醫師可在 ExClinCalc 查看授權病患的 health_records
--   5. 任何一方可隨時撤銷授權
-- ═══════════════════════════════════════════════════════════

-- ── 授權表 ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS patient_consents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_token      text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  invite_expires_at timestamptz DEFAULT (now() + interval '7 days'),
  granted_at        timestamptz,
  revoked_at        timestamptz,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','revoked','expired')),
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consents_doctor ON patient_consents (doctor_id, status);
CREATE INDEX IF NOT EXISTS idx_consents_patient ON patient_consents (patient_user_id, status);

-- ── RLS ────────────────────────────────────────────────────

ALTER TABLE patient_consents ENABLE ROW LEVEL SECURITY;

-- 醫師可看自己發出的所有邀請（DROP IF EXISTS 以確保 replay-safe，SEC001D-12）
DROP POLICY IF EXISTS "doctor_view_own_consents" ON patient_consents;
CREATE POLICY "doctor_view_own_consents"
  ON patient_consents FOR SELECT
  USING (doctor_id = auth.uid());

-- 病患可看自己已授權的記錄
DROP POLICY IF EXISTS "patient_view_own_consents" ON patient_consents;
CREATE POLICY "patient_view_own_consents"
  ON patient_consents FOR SELECT
  USING (patient_user_id = auth.uid());

-- ── RPC：由 token 取得醫師資訊（不需驗證，token 即鑰匙）──

CREATE OR REPLACE FUNCTION get_consent_by_token(p_token text)
RETURNS TABLE(
  consent_id    uuid,
  doctor_name   text,
  institution   text,
  doctor_role   text,
  expires_at    timestamptz,
  is_valid      boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    pc.id,
    p.name,
    p.institution,
    p.pro_role,
    pc.invite_expires_at,
    (pc.status = 'pending' AND pc.invite_expires_at > now()) AS is_valid
  FROM patient_consents pc
  JOIN profiles p ON p.id = pc.doctor_id
  WHERE pc.invite_token = p_token;
END;
$$;

GRANT EXECUTE ON FUNCTION get_consent_by_token TO anon, authenticated;

-- ── RPC：病患同意授權 ───────────────────────────────────────

-- atomic 單次接受 + 拒絕匿名（SEC-001b R8 / GPT RR5）：
-- 單一 conditional UPDATE ... RETURNING 防競態；auth.uid() 為 null 直接拒絕；
-- 並從 PUBLIC/anon 收回 execute（Postgres function 預設 PUBLIC 可執行）。
CREATE OR REPLACE FUNCTION accept_consent(p_token text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  UPDATE patient_consents
     SET patient_user_id = auth.uid(),
         status = 'active',
         granted_at = now()
   WHERE invite_token = p_token
     AND status = 'pending'
     AND invite_expires_at > now()
     AND patient_user_id IS NULL
  RETURNING id INTO v_id;

  RETURN v_id IS NOT NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION accept_consent(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION accept_consent(text) TO authenticated;

-- ── RPC：撤銷授權（醫師或病患皆可） ─────────────────────────

CREATE OR REPLACE FUNCTION revoke_consent(p_consent_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE patient_consents
  SET status = 'revoked',
      revoked_at = now()
  WHERE id = p_consent_id
    AND status = 'active'
    AND (doctor_id = auth.uid() OR patient_user_id = auth.uid());

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION revoke_consent TO authenticated;

-- ── RPC：取得病患的活躍授權清單（給 ClinCalc profile 頁）──

CREATE OR REPLACE FUNCTION get_my_consents()
RETURNS TABLE(
  consent_id    uuid,
  doctor_name   text,
  institution   text,
  doctor_role   text,
  granted_at    timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    pc.id,
    p.name,
    p.institution,
    p.pro_role,
    pc.granted_at
  FROM patient_consents pc
  JOIN profiles p ON p.id = pc.doctor_id
  WHERE pc.patient_user_id = auth.uid()
    AND pc.status = 'active'
  ORDER BY pc.granted_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_consents TO authenticated;

-- ── health_records RLS：允許有授權的醫師讀取 ─────────────────
-- 注意：若 health_records 已有其他 policy，新增此條即可

-- 要求 AAL2 + 醫師目前仍有資格（SEC-001b R7 / GPT RR2）。
-- aal1 clinician session 不得直接以 Data API 讀 PHI。
DROP POLICY IF EXISTS "consented_doctor_read_records" ON health_records;
CREATE POLICY "consented_doctor_read_records"
  ON health_records FOR SELECT
  USING (
    (auth.jwt() ->> 'aal') = 'aal2'
    AND EXISTS (
      SELECT 1 FROM patient_consents pc
      JOIN profiles p ON p.id = pc.doctor_id
      WHERE pc.doctor_id = auth.uid()
        AND pc.patient_user_id = health_records.user_id
        AND pc.status = 'active'
        AND p.is_pro = true
        AND p.pro_role IN ('doctor', 'admin', 'super_admin')
    )
  );

-- ── 確認 ──────────────────────────────────────────────────
SELECT 'patient_consents table created' AS status;
