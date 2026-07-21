"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { LogIn, Eye, EyeOff, AlertCircle, CheckCircle2, Mail, Lock, Stethoscope } from "lucide-react";
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

    // 尚未綁 TOTP（pro 角色強制設定）→ 引導至 /pro/security；demo 帳號豁免
    if (aal?.nextLevel === "aal1") {
      const { data: profile } = await supabase
        .from("profiles").select("is_pro, is_demo").eq("id", (await supabase.auth.getUser()).data.user!.id).single();
      if (profile?.is_pro && !profile.is_demo) {
        router.push("/pro/security?firstLogin=true");
        return;
      }
    }

    router.push(redirect);
    router.refresh();
  };

  const iconStyle = { position: "absolute" as const, left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" };

  return (
    <div className="card" style={{ padding: 28 }}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Email */}
        <div>
          <label className="field-label">電子郵件</label>
          <div style={{ position: "relative" }}>
            <Mail size={15} style={iconStyle} />
            <input
              className="input-field" type="email" required value={email}
              onChange={e => setEmail(e.target.value)} placeholder="doctor@hospital.com"
              style={{ paddingLeft: 36 }} suppressHydrationWarning
            />
          </div>
        </div>

        {/* Password */}
        <div>
          <label className="field-label">密碼</label>
          <div style={{ position: "relative" }}>
            <Lock size={15} style={iconStyle} />
            <input
              className="input-field" type={showPw ? "text" : "password"} required value={password}
              onChange={e => setPassword(e.target.value)} placeholder="••••••••"
              style={{ paddingLeft: 36, paddingRight: 40 }} suppressHydrationWarning
            />
            <button type="button" onClick={() => setShowPw(!showPw)}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", display: "flex" }}>
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {isVerified && !error && (
          <div className="alert alert-success"><CheckCircle2 size={15} />信箱已驗證成功。帳號仍需管理員開通醫師權限後才能登入。</div>
        )}
        {errNotice && !error && (
          <div className="alert alert-danger"><AlertCircle size={15} />{errNotice}</div>
        )}
        {isUnauthorized && !error && (
          <div className="alert alert-warning"><AlertCircle size={15} />此帳號尚未取得醫師權限，請聯繫管理員開通 is_pro 權限</div>
        )}
        {error && (
          <div className="alert alert-danger"><AlertCircle size={15} />{error}</div>
        )}

        <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: "100%", marginTop: 2 }}>
          {loading ? "登入中..." : <><LogIn size={15} /> 登入系統</>}
        </button>
      </form>

      <div style={{ borderTop: "1px solid var(--border)", marginTop: 20, paddingTop: 16 }}>
        <div style={{ textAlign: "center", marginBottom: 10 }}>
          <Link href="/auth/forgot-password" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>忘記密碼？</Link>
        </div>
        <div style={{ textAlign: "center" }}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>尚未有帳號？ </span>
          <Link href="/auth/register" style={{ fontSize: 13, color: "var(--brand-text)", fontWeight: 600 }}>申請帳號</Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 16, margin: "0 auto 14px",
            background: "var(--brand-soft)", border: "1px solid var(--brand-soft-border)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Stethoscope size={24} color="var(--brand)" strokeWidth={2.2} />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", marginBottom: 4 }}>ClinCalc Pro</h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>醫師臨床決策系統 · 請登入</p>
        </div>

        {/* Card */}
        <Suspense fallback={<div className="card" style={{ padding: 28, color: "var(--text-tertiary)", textAlign: "center" }}>載入中...</div>}>
          <LoginForm />
        </Suspense>

        <p style={{ textAlign: "center", fontSize: 11, color: "var(--text-tertiary)", marginTop: 16 }}>
          ClinCalc Pro · 本系統僅供授權醫事人員使用
        </p>
      </div>
    </div>
  );
}
