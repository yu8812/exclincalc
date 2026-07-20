"use client";

import { useState } from "react";
import Link from "next/link";
import { UserPlus, Eye, EyeOff, AlertCircle, Mail, Lock, User, Stethoscope, CheckCircle2 } from "lucide-react";

export default function RegisterPage() {
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) { setError("兩次密碼不一致"); return; }
    if (form.password.length < 8) { setError("密碼至少需要 8 個字元"); return; }
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.email, password: form.password, name: form.name }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "註冊失敗，請稍後再試");
      setLoading(false);
    } else {
      setSuccess(true);
      setLoading(false);
    }
  };

  const containerStyle = {
    minHeight: "100vh", background: "var(--bg-base)",
    display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px",
  } as const;
  const iconStyle = { position: "absolute" as const, left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" };
  const confirmMismatch = !!form.confirm && form.confirm !== form.password;

  if (success) return (
    <div style={containerStyle}>
      <div className="card" style={{ width: "100%", maxWidth: 380, padding: 28, textAlign: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", margin: "0 auto 14px", background: "var(--success-soft)", border: "1px solid var(--success-soft-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <CheckCircle2 size={26} color="var(--success)" />
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>申請已送出</h2>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
          若 <strong style={{ color: "var(--text-primary)" }}>{form.email}</strong> 符合申請條件，
          您將收到一封信箱驗證郵件，請點擊信中連結完成驗證。
        </p>
        <div className="alert alert-warning" style={{ marginBottom: 20, textAlign: "left" }}>
          <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>驗證信箱後，帳號仍需由管理員開通醫師權限才能登入系統，請聯繫您的機構管理員。</span>
        </div>
        <Link href="/auth/login" className="btn btn-primary" style={{ width: "100%" }}>前往登入</Link>
      </div>
    </div>
  );

  return (
    <div style={containerStyle}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, margin: "0 auto 12px",
            background: "var(--brand-soft)", border: "1px solid var(--brand-soft-border)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Stethoscope size={22} color="var(--brand)" strokeWidth={2.2} />
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)", marginBottom: 4 }}>申請醫師帳號</h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>ClinCalc Pro · 醫師臨床決策系統</p>
        </div>

        <div className="card" style={{ padding: 28 }}>
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { key: "name", label: "姓名", placeholder: "您的姓名", type: "text", icon: User },
              { key: "email", label: "電子郵件", placeholder: "doctor@hospital.com", type: "email", icon: Mail },
            ].map(({ key, label, placeholder, type, icon: Icon }) => (
              <div key={key}>
                <label className="field-label">{label}</label>
                <div style={{ position: "relative" }}>
                  <Icon size={15} style={iconStyle} />
                  <input className="input-field" type={type} required value={form[key as keyof typeof form]}
                    onChange={e => set(key, e.target.value)} placeholder={placeholder} style={{ paddingLeft: 36 }} />
                </div>
              </div>
            ))}

            <div>
              <label className="field-label">密碼（至少 8 字元）</label>
              <div style={{ position: "relative" }}>
                <Lock size={15} style={iconStyle} />
                <input className="input-field" type={showPw ? "text" : "password"} required value={form.password}
                  onChange={e => set("password", e.target.value)} placeholder="••••••••" style={{ paddingLeft: 36, paddingRight: 40 }} />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", display: "flex" }}>
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div>
              <label className="field-label">確認密碼</label>
              <div style={{ position: "relative" }}>
                <Lock size={15} style={iconStyle} />
                <input className={`input-field${confirmMismatch ? " input-error" : ""}`} type={showPw ? "text" : "password"} required
                  value={form.confirm} onChange={e => set("confirm", e.target.value)} placeholder="再輸入一次" style={{ paddingLeft: 36 }} />
              </div>
            </div>

            {error && (
              <div className="alert alert-danger"><AlertCircle size={15} />{error}</div>
            )}

            <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: "100%", marginTop: 2 }}>
              {loading ? "申請中..." : <><UserPlus size={15} /> 申請帳號</>}
            </button>
          </form>

          <div style={{ borderTop: "1px solid var(--border)", marginTop: 18, paddingTop: 14, textAlign: "center" }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>已有帳號？ </span>
            <Link href="/auth/login" style={{ fontSize: 13, color: "var(--brand-text)", fontWeight: 600 }}>前往登入</Link>
          </div>
        </div>

        <p style={{ textAlign: "center", fontSize: 11, color: "var(--text-tertiary)", marginTop: 14 }}>
          帳號申請後需由管理員開通醫師權限
        </p>
      </div>
    </div>
  );
}
