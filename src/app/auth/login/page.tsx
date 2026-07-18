"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { LogIn, Eye, EyeOff, AlertCircle, Mail, Lock, Stethoscope } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { safeInternalPath } from "@/lib/safeRedirect";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isUnauthorized = searchParams.get("error") === "unauthorized";
  const isVerified = searchParams.get("verified") === "1";
  const errCode = searchParams.get("error");
  const errNotice =
    errCode === "verification_failed" ? "驗證連結無效或已過期，請重新註冊或要求新的驗證信。" :
    errCode === "invalid_link" ? "驗證連結不完整，請點擊信中完整連結。" :
    errCode === "missing_code" ? "驗證流程有誤，請重新操作。" :
    "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message.includes("Invalid login") ? "電子郵件或密碼錯誤" : err.message);
      setLoading(false);
      return;
    }
    // 帳密通過後檢查 MFA 狀態
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    // SEC001D-05：redirect 只接受站內路徑
    const redirect = safeInternalPath(searchParams.get("redirect"), "/pro/dashboard");

    // 已綁 TOTP 但尚未通過第二步驗證 → 跳 MFA 驗證頁
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      router.push(`/auth/mfa-verify?redirect=${encodeURIComponent(redirect)}`);
      return;
    }

    // 尚未綁 TOTP（pro 角色強制設定）→ 引導至 /pro/security
    if (aal?.nextLevel === "aal1") {
      const { data: profile } = await supabase
        .from("profiles").select("is_pro").eq("id", (await supabase.auth.getUser()).data.user!.id).single();
      if (profile?.is_pro) {
        router.push("/pro/security?firstLogin=true");
        return;
      }
    }

    router.push(redirect);
    router.refresh();
  };

  return (
    <div style={{
      background: "#0f1e35",
      border: "1px solid #1e3a5f",
      borderRadius: 14,
      padding: "28px 28px",
    }}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Email */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: 6 }}>
            電子郵件
          </label>
          <div style={{ position: "relative" }}>
            <Mail size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
            <input
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              placeholder="doctor@hospital.com"
              style={{
                width: "100%", background: "#07111f", border: "1px solid #1e3a5f",
                borderRadius: 8, padding: "10px 12px 10px 36px",
                color: "#e2e8f0", fontSize: 14, outline: "none",
              }}
              onFocus={e => (e.target as HTMLInputElement).style.borderColor = "#3b82f6"}
              onBlur={e => (e.target as HTMLInputElement).style.borderColor = "#1e3a5f"}
            />
          </div>
        </div>

        {/* Password */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: 6 }}>
            密碼
          </label>
          <div style={{ position: "relative" }}>
            <Lock size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
            <input
              type={showPw ? "text" : "password"} required value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width: "100%", background: "#07111f", border: "1px solid #1e3a5f",
                borderRadius: 8, padding: "10px 40px 10px 36px",
                color: "#e2e8f0", fontSize: 14, outline: "none",
              }}
              onFocus={e => (e.target as HTMLInputElement).style.borderColor = "#3b82f6"}
              onBlur={e => (e.target as HTMLInputElement).style.borderColor = "#1e3a5f"}
            />
            <button type="button" onClick={() => setShowPw(!showPw)}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#94a3b8" }}>
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {isVerified && !error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 8, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)", color: "#16a34a", fontSize: 13 }}>
            <AlertCircle size={14} />
            信箱已驗證成功。帳號仍需管理員開通醫師權限後才能登入。
          </div>
        )}
        {errNotice && !error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444", fontSize: 13 }}>
            <AlertCircle size={14} />
            {errNotice}
          </div>
        )}
        {isUnauthorized && !error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 8, background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)", color: "#ca8a04", fontSize: 13 }}>
            <AlertCircle size={14} />
            此帳號尚未取得醫師權限，請聯繫管理員開通 is_pro 權限
          </div>
        )}
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444", fontSize: 13 }}>
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        <button type="submit" disabled={loading} style={{
          background: loading ? "#1d4ed8" : "linear-gradient(135deg, #3b82f6, #1d4ed8)",
          color: "#fff", fontWeight: 700, padding: "11px", borderRadius: 8,
          border: "none", cursor: loading ? "default" : "pointer",
          fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          transition: "opacity 0.2s",
          opacity: loading ? 0.8 : 1,
        }}>
          {loading ? "登入中..." : <><LogIn size={15} /> 登入系統</>}
        </button>
      </form>

      <div style={{ borderTop: "1px solid #1e3a5f", marginTop: 20, paddingTop: 16 }}>
        <div style={{ textAlign: "center", marginBottom: 10 }}>
          <Link href="/auth/forgot-password" style={{ fontSize: 12, color: "#64748b", textDecoration: "none" }}>
            忘記密碼？
          </Link>
        </div>
        <div style={{ textAlign: "center" }}>
          <span style={{ fontSize: 13, color: "#94a3b8" }}>尚未有帳號？ </span>
          <Link href="/auth/register" style={{ fontSize: 13, color: "#3b82f6", textDecoration: "none", fontWeight: 600 }}>
            申請帳號
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#07111f",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px 16px",
    }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, margin: "0 auto 14px",
            background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Stethoscope size={24} color="#fff" />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#e2e8f0", marginBottom: 4 }}>
            ClinCalc Pro
          </h1>
          <p style={{ fontSize: 13, color: "#94a3b8" }}>醫師臨床決策系統 · 請登入</p>
        </div>

        {/* Card */}
        <Suspense fallback={<div style={{ background: "#0f1e35", border: "1px solid #1e3a5f", borderRadius: 14, padding: "28px", color: "#94a3b8", textAlign: "center" }}>載入中...</div>}>
          <LoginForm />
        </Suspense>

        <p style={{ textAlign: "center", fontSize: 11, color: "#475569", marginTop: 16 }}>
          ClinCalc Pro · 本系統僅供授權醫事人員使用
        </p>
      </div>
    </div>
  );
}
