"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, Stethoscope, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 確認是否已透過 recovery session 登入
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setReady(true);
      } else {
        router.push("/auth/forgot-password");
      }
    });
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError("兩次密碼輸入不一致"); return; }
    if (password.length < 8) { setError("密碼至少需要 8 個字元"); return; }
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) {
      setError(err.message);
    } else {
      setDone(true);
      setTimeout(() => router.push("/pro/dashboard"), 2500);
    }
  };

  const iconStyle = { position: "absolute" as const, left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" };
  const confirmMismatch = !!confirm && confirm !== password;

  if (!ready) return null;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, margin: "0 auto 14px", background: "var(--brand-soft)", border: "1px solid var(--brand-soft-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Stethoscope size={24} color="var(--brand)" strokeWidth={2.2} />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", marginBottom: 4 }}>設定新密碼</h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>請輸入您的新密碼</p>
        </div>

        <div className="card" style={{ padding: "32px 28px" }}>
          {done ? (
            <div style={{ textAlign: "center" }}>
              <CheckCircle2 size={46} color="var(--success)" style={{ margin: "0 auto 16px", display: "block" }} />
              <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>密碼已更新</p>
              <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>即將跳轉至儀表板...</p>
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label className="field-label">新密碼</label>
                <div style={{ position: "relative" }}>
                  <Lock size={15} style={iconStyle} />
                  <input className="input-field" type={showPw ? "text" : "password"} required value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="至少 8 個字元" style={{ paddingLeft: 36, paddingRight: 40 }} />
                  <button type="button" onClick={() => setShowPw(!showPw)}
                    style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", display: "flex" }}>
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="field-label">確認新密碼</label>
                <div style={{ position: "relative" }}>
                  <Lock size={15} style={iconStyle} />
                  <input className={`input-field${confirmMismatch ? " input-error" : ""}`} type={showPw ? "text" : "password"} required value={confirm} onChange={e => setConfirm(e.target.value)}
                    placeholder="再次輸入新密碼" style={{ paddingLeft: 36 }} />
                </div>
              </div>

              {error && (
                <div className="alert alert-danger">{error}</div>
              )}

              <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: "100%" }}>
                {loading ? "更新中..." : "更新密碼"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
