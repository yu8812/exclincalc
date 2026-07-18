"use client";

import { useState } from "react";
import Link from "next/link";
import { UserPlus, Eye, EyeOff, AlertCircle, Mail, Lock, User, Stethoscope } from "lucide-react";

export default function RegisterPage() {
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const inputStyle = {
    width: "100%", background: "#07111f", border: "1px solid #1e3a5f",
    borderRadius: 8, padding: "10px 12px 10px 36px",
    color: "#e2e8f0", fontSize: 14, outline: "none",
  };

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
    minHeight: "100vh", background: "#07111f",
    display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px",
  };

  const cardStyle = {
    background: "#0f1e35", border: "1px solid #1e3a5f",
    borderRadius: 14, padding: "28px",
  };

  if (success) return (
    <div style={containerStyle}>
      <div style={{ ...cardStyle, width: "100%", maxWidth: 380, textAlign: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", margin: "0 auto 14px", background: "rgba(34,197,94,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <UserPlus size={26} color="#22c55e" />
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>申請已送出</h2>
        <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.7, marginBottom: 8 }}>
          若 <strong style={{ color: "#e2e8f0" }}>{form.email}</strong> 符合申請條件，
          您將收到一封信箱驗證郵件，請點擊信中連結完成驗證。
        </p>
        <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 8, padding: "12px 16px", marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: "#f59e0b", lineHeight: 1.7, margin: 0 }}>
            ⚠ 驗證信箱後，帳號仍需由管理員開通醫師權限才能登入系統，請聯繫您的機構管理員。
          </p>
        </div>
        <Link href="/auth/login" style={{
          display: "block", textAlign: "center", padding: "10px", borderRadius: 8,
          background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
          color: "#fff", fontWeight: 700, fontSize: 14, textDecoration: "none",
        }}>
          前往登入
        </Link>
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
            background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Stethoscope size={22} color="#fff" />
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#e2e8f0", marginBottom: 4 }}>申請醫師帳號</h1>
          <p style={{ fontSize: 13, color: "#94a3b8" }}>ClinCalc Pro · 醫師臨床決策系統</p>
        </div>

        <div style={cardStyle}>
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { key: "name", label: "姓名", placeholder: "您的姓名", type: "text", icon: User },
              { key: "email", label: "電子郵件", placeholder: "doctor@hospital.com", type: "email", icon: Mail },
            ].map(({ key, label, placeholder, type, icon: Icon }) => (
              <div key={key}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: 5 }}>{label}</label>
                <div style={{ position: "relative" }}>
                  <Icon size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
                  <input type={type} required value={form[key as keyof typeof form]}
                    onChange={e => set(key, e.target.value)} placeholder={placeholder} style={inputStyle}
                    onFocus={e => (e.target as HTMLInputElement).style.borderColor = "#3b82f6"}
                    onBlur={e => (e.target as HTMLInputElement).style.borderColor = "#1e3a5f"}
                  />
                </div>
              </div>
            ))}

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: 5 }}>密碼（至少 8 字元）</label>
              <div style={{ position: "relative" }}>
                <Lock size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
                <input type={showPw ? "text" : "password"} required value={form.password} onChange={e => set("password", e.target.value)}
                  placeholder="••••••••" style={{ ...inputStyle, paddingRight: 40 }}
                  onFocus={e => (e.target as HTMLInputElement).style.borderColor = "#3b82f6"}
                  onBlur={e => (e.target as HTMLInputElement).style.borderColor = "#1e3a5f"}
                />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#94a3b8" }}>
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: 5 }}>確認密碼</label>
              <div style={{ position: "relative" }}>
                <Lock size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
                <input type={showPw ? "text" : "password"} required value={form.confirm} onChange={e => set("confirm", e.target.value)}
                  placeholder="再輸入一次" style={{
                    ...inputStyle,
                    borderColor: form.confirm && form.confirm !== form.password ? "rgba(239,68,68,0.5)" : "#1e3a5f",
                  }}
                  onFocus={e => (e.target as HTMLInputElement).style.borderColor = "#3b82f6"}
                  onBlur={e => (e.target as HTMLInputElement).style.borderColor = form.confirm && form.confirm !== form.password ? "rgba(239,68,68,0.5)" : "#1e3a5f"}
                />
              </div>
            </div>

            {error && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444", fontSize: 13 }}>
                <AlertCircle size={14} />
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
              color: "#fff", fontWeight: 700, padding: "11px", borderRadius: 8,
              border: "none", cursor: loading ? "default" : "pointer", fontSize: 14,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              opacity: loading ? 0.8 : 1,
            }}>
              {loading ? "申請中..." : <><UserPlus size={15} /> 申請帳號</>}
            </button>
          </form>

          <div style={{ borderTop: "1px solid #1e3a5f", marginTop: 18, paddingTop: 14, textAlign: "center" }}>
            <span style={{ fontSize: 13, color: "#94a3b8" }}>已有帳號？ </span>
            <Link href="/auth/login" style={{ fontSize: 13, color: "#3b82f6", textDecoration: "none", fontWeight: 600 }}>
              前往登入
            </Link>
          </div>
        </div>

        <p style={{ textAlign: "center", fontSize: 11, color: "#475569", marginTop: 14 }}>
          帳號申請後需由管理員開通醫師權限
        </p>
      </div>
    </div>
  );
}
