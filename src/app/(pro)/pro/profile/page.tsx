"use client";

import { useEffect, useState } from "react";
import { User, KeyRound, Building2, BadgeCheck, Save, Eye, EyeOff, CheckCircle, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase";

interface Profile {
  id: string;
  name: string | null;
  institution: string | null;
  license_number: string | null;
  is_pro: boolean;
  pro_role: string;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [license, setLicense] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);

  // Email change
  const [newEmail, setNewEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [emailOk, setEmailOk] = useState(false);

  // Password change
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwOk, setPwOk] = useState(false);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setEmail(user.email || "");
      const { data } = await supabase
        .from("profiles")
        .select("id, name, institution, license_number, is_pro, pro_role")
        .eq("id", user.id)
        .single();
      if (data) {
        setProfile(data);
        setName(data.name || "");
        setInstitution(data.institution || "");
        setLicense(data.license_number || "");
      }
    };
    load();
  }, []);

  const saveProfile = async () => {
    setSaving(true);
    setSaveOk(false);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("profiles").update({
      name: name.trim() || null,
      institution: institution.trim() || null,
      license_number: license.trim() || null,
    }).eq("id", user.id);
    setSaving(false);
    setSaveOk(true);
    setTimeout(() => setSaveOk(false), 2500);
  };

  const changeEmail = async () => {
    setEmailError("");
    setEmailOk(false);
    const trimmed = newEmail.trim();
    if (!trimmed || !trimmed.includes("@")) { setEmailError("請輸入有效的電子郵件地址"); return; }
    if (trimmed === email) { setEmailError("新地址與目前地址相同"); return; }
    setEmailLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ email: trimmed });
    setEmailLoading(false);
    if (error) { setEmailError(error.message); return; }
    setEmailOk(true);
    setNewEmail("");
    setTimeout(() => setEmailOk(false), 5000);
  };

  const changePassword = async () => {
    setPwError("");
    setPwOk(false);
    if (newPw.length < 8) { setPwError("新密碼至少 8 字元"); return; }
    if (newPw !== confirmPw) { setPwError("兩次密碼不一致"); return; }
    setPwLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPw });
    if (error) { setPwError(error.message); setPwLoading(false); return; }
    setPwLoading(false);
    setPwOk(true);
    setNewPw(""); setConfirmPw("");
    setTimeout(() => setPwOk(false), 3000);
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--pro-text)", marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
        <User size={18} color="var(--pro-accent)" /> 個人資料設定
      </h1>

      {/* Profile Info */}
      <div className="pro-card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
          <BadgeCheck size={14} color="var(--pro-accent)" /> 基本資料
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--pro-text-muted)", display: "block", marginBottom: 5 }}>
              <Mail size={11} style={{ display: "inline", marginRight: 4 }} />電子郵件
            </label>
            <input className="pro-input" value={email} disabled style={{ opacity: 0.6, cursor: "not-allowed", marginBottom: 8 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="pro-input"
                value={newEmail}
                onChange={e => { setNewEmail(e.target.value); setEmailError(""); setEmailOk(false); }}
                placeholder="輸入新電子郵件地址..."
                style={{ flex: 1 }}
                onKeyDown={e => e.key === "Enter" && changeEmail()}
              />
              <button
                onClick={changeEmail}
                disabled={emailLoading || !newEmail.trim()}
                style={{
                  padding: "7px 14px", borderRadius: 7, border: "none", cursor: "pointer",
                  background: "var(--pro-accent)", color: "#fff", fontSize: 12, fontWeight: 600,
                  opacity: !newEmail.trim() ? 0.4 : 1,
                }}
              >
                {emailLoading ? "送出中..." : "變更 Email"}
              </button>
            </div>
            {emailError && <p style={{ fontSize: 11, color: "var(--pro-danger)", marginTop: 5 }}>{emailError}</p>}
            {emailOk && (
              <p style={{ fontSize: 11, color: "#22c55e", marginTop: 5, display: "flex", alignItems: "center", gap: 5 }}>
                <CheckCircle size={11} /> 確認信已寄出，請點擊信件中的連結完成變更
              </p>
            )}
            <p style={{ fontSize: 10, color: "var(--pro-text-muted)", marginTop: 4 }}>變更後需點擊確認信中的連結才會生效</p>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--pro-text-muted)", display: "block", marginBottom: 5 }}>姓名</label>
            <input className="pro-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="您的姓名" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--pro-text-muted)", display: "block", marginBottom: 5 }}>
              <Building2 size={11} style={{ display: "inline", marginRight: 4 }} />機構 / 醫院
            </label>
            <input className="pro-input" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="服務醫療機構名稱" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--pro-text-muted)", display: "block", marginBottom: 5 }}>醫師執照字號</label>
            <input className="pro-input" value={license} onChange={(e) => setLicense(e.target.value)} placeholder="醫師執照字號（選填）" />
          </div>
        </div>

        {profile && (
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <span style={{
              padding: "3px 10px", borderRadius: 5, fontSize: 11, fontWeight: 700,
              background: "rgba(34,197,94,0.1)", color: "#22c55e",
            }}>
              ✓ Pro 版認證
            </span>
            <span style={{
              padding: "3px 10px", borderRadius: 5, fontSize: 11, fontWeight: 700,
              background: "rgba(59,130,246,0.1)", color: "var(--pro-accent)",
            }}>
              {profile.pro_role === "super_admin" ? "⭐ 超級管理員" : profile.pro_role === "admin" ? "👑 管理員" : profile.pro_role === "pharmacist" ? "💊 藥師" : profile.pro_role === "nurse" ? "🩹 護理師" : "🩺 醫師"}
            </span>
          </div>
        )}

        <button
          onClick={saveProfile}
          disabled={saving}
          className="pro-btn-primary"
          style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 6 }}
        >
          {saveOk ? <><CheckCircle size={13} /> 已儲存</> : <><Save size={13} /> {saving ? "儲存中..." : "儲存資料"}</>}
        </button>
      </div>

      {/* Password Change */}
      <div className="pro-card" style={{ padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
          <KeyRound size={14} color="var(--pro-accent)" /> 修改密碼
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--pro-text-muted)", display: "block", marginBottom: 5 }}>新密碼</label>
            <input
              className="pro-input"
              type={showPw ? "text" : "password"}
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="新密碼（至少 8 字元）"
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--pro-text-muted)", display: "block", marginBottom: 5 }}>確認新密碼</label>
            <input
              className="pro-input"
              type={showPw ? "text" : "password"}
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="再次輸入新密碼"
              onKeyDown={(e) => e.key === "Enter" && changePassword()}
            />
          </div>
        </div>

        {pwError && (
          <p style={{ fontSize: 12, color: "var(--pro-danger)", marginTop: 10 }}>{pwError}</p>
        )}
        {pwOk && (
          <p style={{ fontSize: 12, color: "#22c55e", marginTop: 10, display: "flex", alignItems: "center", gap: 5 }}>
            <CheckCircle size={12} /> 密碼已成功更新
          </p>
        )}

        <button
          onClick={changePassword}
          disabled={pwLoading}
          className="pro-btn-primary"
          style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 6 }}
        >
          <KeyRound size={13} /> {pwLoading ? "更新中..." : "更新密碼"}
        </button>
      </div>
    </div>
  );
}
