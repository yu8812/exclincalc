"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Shield, AlertCircle, Smartphone, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { safeInternalPath } from "@/lib/safeRedirect";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function readLockout(): number | null {
  if (typeof window === "undefined") return null;
  const t = sessionStorage.getItem("mfa_locked_until");
  if (!t) return null;
  const until = Number(t);
  if (Number.isNaN(until) || until < Date.now()) {
    sessionStorage.removeItem("mfa_locked_until");
    sessionStorage.removeItem("mfa_attempts");
    return null;
  }
  return until;
}

function MFAForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);

  useEffect(() => {
    setLockedUntil(readLockout());
    const stored = Number(sessionStorage.getItem("mfa_attempts") ?? "0");
    setAttempts(stored);

    // 載入使用者已綁定的 TOTP factor
    (async () => {
      const supabase = createClient();
      const { data, error: e } = await supabase.auth.mfa.listFactors();
      if (e || !data) { setError("無法載入驗證器，請重新登入"); return; }
      const verified = (data.totp || []).find(f => f.status === "verified");
      if (!verified) {
        // 還沒綁過 — 應該去 /pro/security 設定，不是這裡
        router.replace("/pro/security");
        return;
      }
      setFactorId(verified.id);
    })();
  }, [router]);

  // 倒數鎖定剩餘時間
  useEffect(() => {
    if (!lockedUntil) return;
    const t = setInterval(() => {
      if (Date.now() >= lockedUntil) {
        sessionStorage.removeItem("mfa_locked_until");
        sessionStorage.removeItem("mfa_attempts");
        setLockedUntil(null);
        setAttempts(0);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockedUntil) return;
    if (code.length !== 6) { setError("請輸入 6 位數驗證碼"); return; }
    if (!factorId) { setError("驗證器尚未準備好"); return; }

    setVerifying(true);
    setError("");
    const supabase = createClient();
    const challengeRes = await supabase.auth.mfa.challenge({ factorId });
    if (challengeRes.error) {
      setError(challengeRes.error.message);
      setVerifying(false);
      return;
    }
    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challengeRes.data.id,
      code,
    });
    setVerifying(false);

    if (vErr) {
      const next = attempts + 1;
      setAttempts(next);
      sessionStorage.setItem("mfa_attempts", String(next));
      if (next >= MAX_ATTEMPTS) {
        const until = Date.now() + LOCKOUT_MINUTES * 60_000;
        sessionStorage.setItem("mfa_locked_until", String(until));
        setLockedUntil(until);
        setError(`連續 ${MAX_ATTEMPTS} 次失敗，已鎖定 ${LOCKOUT_MINUTES} 分鐘`);
      } else {
        setError(`驗證碼錯誤（${next}/${MAX_ATTEMPTS} 次）`);
      }
      setCode("");
      return;
    }

    sessionStorage.removeItem("mfa_attempts");
    // SEC001D-05：redirect 只接受站內路徑
    const redirect = safeInternalPath(searchParams.get("redirect"), "/pro/dashboard");
    router.push(redirect);
    router.refresh();
  };

  const lockoutRemaining = lockedUntil
    ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 60_000))
    : 0;

  return (
    <div style={{ background: "#0f1e35", border: "1px solid #1e3a5f", borderRadius: 14, padding: 28 }}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <Smartphone size={36} color="#3b82f6" style={{ margin: "0 auto 8px", display: "block" }} />
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>雙重驗證</h2>
        <p style={{ fontSize: 13, color: "#94a3b8" }}>
          請開啟驗證器 App 輸入當前的 6 位數動態碼
        </p>
      </div>

      <form onSubmit={verify}>
        <input
          autoFocus type="text" inputMode="numeric" maxLength={6}
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="000000"
          disabled={!!lockedUntil}
          style={{
            width: "100%", textAlign: "center", letterSpacing: "0.4em", fontSize: 22,
            background: "#07111f", border: "1px solid #1e3a5f", borderRadius: 8,
            padding: "14px 12px", color: "#e2e8f0", outline: "none", marginBottom: 12,
          }}
        />

        {error && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
            borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
            color: "#ef4444", fontSize: 13, marginBottom: 12,
          }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {lockedUntil && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
            borderRadius: 8, background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.3)",
            color: "#ca8a04", fontSize: 13, marginBottom: 12,
          }}>
            <Lock size={14} /> 帳號鎖定中，剩餘約 {lockoutRemaining} 分鐘
          </div>
        )}

        <button
          type="submit"
          disabled={verifying || !!lockedUntil || code.length !== 6}
          style={{
            width: "100%", padding: "11px", borderRadius: 8, border: "none",
            background: code.length === 6 && !lockedUntil ? "linear-gradient(135deg,#3b82f6,#1d4ed8)" : "#374151",
            color: "#fff", fontWeight: 700, fontSize: 14,
            cursor: code.length === 6 && !lockedUntil ? "pointer" : "not-allowed",
          }}>
          {verifying ? "驗證中…" : "驗證"}
        </button>
      </form>

      <p style={{ textAlign: "center", fontSize: 11, color: "#475569", marginTop: 14 }}>
        遺失驗證器？請聯繫系統管理員協助重置
      </p>
    </div>
  );
}

export default function MFAVerifyPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#07111f", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, margin: "0 auto 14px",
            background: "linear-gradient(135deg,#3b82f6,#1d4ed8)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Shield size={24} color="#fff" />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#e2e8f0", marginBottom: 4 }}>
            ClinCalc Pro
          </h1>
          <p style={{ fontSize: 13, color: "#94a3b8" }}>多重驗證確認 · 第二步</p>
        </div>
        <Suspense fallback={<div style={{ background: "#0f1e35", borderRadius: 14, padding: 28, color: "#94a3b8", textAlign: "center" }}>載入中…</div>}>
          <MFAForm />
        </Suspense>
      </div>
    </div>
  );
}
