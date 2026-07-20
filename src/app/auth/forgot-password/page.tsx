"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, ArrowLeft, Stethoscope, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
    });
    setLoading(false);
    if (err) {
      setError(err.message);
    } else {
      setDone(true);
    }
  };

  const iconStyle = { position: "absolute" as const, left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, margin: "0 auto 14px", background: "var(--brand-soft)", border: "1px solid var(--brand-soft-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Stethoscope size={24} color="var(--brand)" strokeWidth={2.2} />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", marginBottom: 4 }}>重設密碼</h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>輸入帳號電子郵件，我們將寄送重設連結</p>
        </div>

        <div className="card" style={{ padding: "32px 28px" }}>
          {done ? (
            <div style={{ textAlign: "center" }}>
              <CheckCircle2 size={46} color="var(--success)" style={{ margin: "0 auto 16px", display: "block" }} />
              <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>重設信已寄出</p>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 20 }}>
                請至 <strong style={{ color: "var(--text-primary)" }}>{email}</strong> 收件匣點擊重設連結。
              </p>
              <Link href="/auth/login" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13, color: "var(--brand-text)", fontWeight: 600 }}>
                <ArrowLeft size={13} /> 返回登入
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label className="field-label">電子郵件</label>
                <div style={{ position: "relative" }}>
                  <Mail size={15} style={iconStyle} />
                  <input
                    className="input-field" type="email" required value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="doctor@hospital.com" style={{ paddingLeft: 36 }}
                  />
                </div>
              </div>

              {error && (
                <div className="alert alert-danger">{error}</div>
              )}

              <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: "100%" }}>
                {loading ? "寄送中..." : "寄送重設連結"}
              </button>

              <Link href="/auth/login" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
                <ArrowLeft size={13} /> 返回登入
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
