"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Shield, ShieldCheck, Smartphone, Key, RefreshCw, Copy, Check, AlertTriangle, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase";
import Image from "next/image";

interface MFAFactor {
  id: string;
  friendly_name: string;
  factor_type: string;
  status: "verified" | "unverified";
  created_at: string;
}

export default function SecurityPage() {
  const searchParams = useSearchParams();
  const isFirstLogin = searchParams?.get("firstLogin") === "true";
  const [factors, setFactors] = useState<MFAFactor[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [factorId, setFactorId] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [secretCopied, setSecretCopied] = useState(false);

  const supabase = createClient();

  const loadFactors = async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (!error && data) {
      setFactors(data.totp as MFAFactor[]);
    }
    setLoading(false);
  };

  useEffect(() => { loadFactors(); }, []); // eslint-disable-line

  const startEnroll = async () => {
    setError("");
    setEnrolling(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "ClinCalc Pro" });
    if (error) { setError(error.message); setEnrolling(false); return; }
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    setFactorId(data.id);
  };

  const verify = async () => {
    if (!verifyCode || verifyCode.length !== 6) { setError("請輸入 6 位數驗證碼"); return; }
    setVerifying(true);
    setError("");
    const challengeRes = await supabase.auth.mfa.challenge({ factorId });
    if (challengeRes.error) { setError(challengeRes.error.message); setVerifying(false); return; }
    const { error: verifyErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challengeRes.data.id,
      code: verifyCode,
    });
    if (verifyErr) {
      setError("驗證碼錯誤，請重試");
      setVerifying(false);
      return;
    }
    setSuccess("雙重驗證已成功啟用！");
    setEnrolling(false);
    setQrCode("");
    setSecret("");
    setVerifyCode("");
    loadFactors();
    setVerifying(false);
  };

  const unenroll = async (id: string) => {
    // SEC001D-04：醫事帳號強制 MFA，禁止移除唯一的 verified factor
    // （要更換請先新增另一個再移除；遺失可由管理員 reset）。
    const target = factors.find(f => f.id === id);
    const verifiedCount = factors.filter(f => f.status === "verified").length;
    if (target?.status === "verified" && verifiedCount <= 1) {
      setError("醫事帳號強制雙重驗證，無法移除唯一的驗證方式。請先新增另一個驗證方式後再移除。");
      return;
    }
    if (!confirm("確定要停用此雙重驗證方式嗎？")) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) { setError(error.message); return; }
    // 立即刷新 session 使 aal 由 aal2 降為 aal1（否則 JWT 要等 refresh 才降級，暫時保有 PHI 存取）
    await supabase.auth.refreshSession();
    setSuccess("已停用雙重驗證");
    loadFactors();
  };

  const copySecret = () => {
    navigator.clipboard.writeText(secret);
    setSecretCopied(true);
    setTimeout(() => setSecretCopied(false), 2000);
  };

  const verifiedFactors = factors.filter(f => f.status === "verified");
  const hasMFA = verifiedFactors.length > 0;

  return (
    <div style={{ maxWidth: 600 }}>
      {/* 首次登入引導橫幅 */}
      {isFirstLogin && !hasMFA && (
        <div style={{
          marginBottom: 20, padding: "14px 18px", borderRadius: 12,
          background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.3)",
          display: "flex", alignItems: "flex-start", gap: 10,
        }}>
          <Shield size={18} color="#3b82f6" style={{ marginTop: 2, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#3b82f6", marginBottom: 4 }}>
              歡迎使用 ClinCalc Pro
            </div>
            <div style={{ fontSize: 12, color: "var(--pro-text-muted)", lineHeight: 1.6 }}>
              依本系統安全規範，醫事人員角色（pro）首次登入後須完成雙重驗證設定。
              請在下方「設定雙重驗證」區塊完成 TOTP 綁定，之後每次登入都需輸入驗證器顯示的 6 位數動態碼。
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--pro-text)", display: "flex", alignItems: "center", gap: 8 }}>
          {hasMFA ? <ShieldCheck size={20} color="#22c55e" /> : <Shield size={20} color="var(--pro-accent)" />}
          帳號安全
        </h1>
        <p style={{ fontSize: 12, color: "var(--pro-text-muted)", marginTop: 3 }}>
          雙重驗證（2FA/MFA）· 帳號保護設定
        </p>
      </div>

      {/* MFA Status Card */}
      <div style={{
        background: "var(--pro-surface)", border: `2px solid ${hasMFA ? "#22c55e40" : "rgba(245,158,11,0.3)"}`,
        borderRadius: 12, padding: 20, marginBottom: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: hasMFA ? 16 : 0 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12, flexShrink: 0,
            background: hasMFA ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: hasMFA ? "#22c55e" : "#f59e0b",
          }}>
            <Smartphone size={24} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--pro-text)" }}>
              {hasMFA ? "雙重驗證已啟用" : "建議啟用雙重驗證"}
            </div>
            <div style={{ fontSize: 12, color: "var(--pro-text-muted)", marginTop: 2 }}>
              {hasMFA
                ? `${verifiedFactors.length} 個驗證器已綁定，帳號受到雙重保護`
                : "啟用 TOTP 雙重驗證可有效保護您的醫療數據帳號"}
            </div>
          </div>
          <span style={{
            fontSize: 11, padding: "4px 10px", borderRadius: 20, fontWeight: 700,
            background: hasMFA ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)",
            color: hasMFA ? "#22c55e" : "#f59e0b",
          }}>
            {hasMFA ? "✓ 已啟用" : "未啟用"}
          </span>
        </div>

        {/* Enrolled factors list */}
        {verifiedFactors.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {verifiedFactors.map(f => (
              <div key={f.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", borderRadius: 8,
                background: "var(--pro-bg)", border: "1px solid var(--pro-border)",
              }}>
                <Key size={14} color="#22c55e" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--pro-text)" }}>{f.friendly_name}</div>
                  <div style={{ fontSize: 11, color: "var(--pro-text-muted)" }}>
                    TOTP 驗證器 · 綁定於 {new Date(f.created_at).toLocaleDateString("zh-TW")}
                  </div>
                </div>
                <button onClick={() => unenroll(f.id)} style={{
                  padding: "5px 12px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.3)",
                  background: "rgba(239,68,68,0.08)", color: "#ef4444",
                  cursor: "pointer", fontSize: 12, fontWeight: 600,
                }}>
                  停用
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Success / Error messages */}
      {success && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderRadius: 8,
          background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)",
          marginBottom: 16,
        }}>
          <Check size={15} color="#22c55e" />
          <span style={{ fontSize: 13, color: "#22c55e" }}>{success}</span>
        </div>
      )}
      {error && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderRadius: 8,
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
          marginBottom: 16,
        }}>
          <AlertTriangle size={15} color="#ef4444" />
          <span style={{ fontSize: 13, color: "#ef4444" }}>{error}</span>
        </div>
      )}

      {/* Enroll flow */}
      {!enrolling && !hasMFA && (
        <div style={{ background: "var(--pro-surface)", border: "1px solid var(--pro-border)", borderRadius: 12, padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--pro-text)", marginBottom: 10 }}>設定雙重驗證</h3>
          <p style={{ fontSize: 12, color: "var(--pro-text-muted)", marginBottom: 16, lineHeight: 1.6 }}>
            使用 Google Authenticator、Authy 或其他 TOTP 驗證器 App 掃描 QR Code，
            每次登入時需輸入動態驗證碼。
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {[
              { step: "1", text: "在手機安裝 Google Authenticator 或 Authy" },
              { step: "2", text: "點擊「開始設定」並掃描 QR Code" },
              { step: "3", text: "輸入 App 顯示的 6 位數驗證碼完成綁定" },
            ].map(({ step, text }) => (
              <div key={step} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "var(--pro-accent-dim)", color: "var(--pro-accent)",
                  fontSize: 11, fontWeight: 700,
                }}>{step}</span>
                <span style={{ fontSize: 13, color: "var(--pro-text)", paddingTop: 2 }}>{text}</span>
              </div>
            ))}
          </div>
          <button onClick={startEnroll} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "10px 20px", borderRadius: 8, border: "none",
            background: "var(--pro-accent)", color: "#fff",
            cursor: "pointer", fontSize: 14, fontWeight: 700,
          }}>
            <Smartphone size={15} /> 開始設定 2FA
          </button>
        </div>
      )}

      {/* QR Code + Verify step */}
      {enrolling && qrCode && (
        <div style={{ background: "var(--pro-surface)", border: "1px solid var(--pro-accent)", borderRadius: 12, padding: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--pro-text)", marginBottom: 16 }}>掃描 QR Code</h3>

          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            {/* QR Code */}
            <div style={{ flexShrink: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrCode} alt="MFA QR Code" width={160} height={160}
                style={{ borderRadius: 8, border: "3px solid var(--pro-border)", background: "#fff", display: "block" }} />
              <p style={{ fontSize: 11, color: "var(--pro-text-muted)", marginTop: 6, textAlign: "center" }}>
                手機掃描此 QR Code
              </p>
            </div>

            <div style={{ flex: 1, minWidth: 200 }}>
              {/* Manual secret */}
              <p style={{ fontSize: 12, color: "var(--pro-text-muted)", marginBottom: 8 }}>
                或手動輸入此金鑰到驗證器 App：
              </p>
              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                <code style={{
                  flex: 1, padding: "8px 12px", borderRadius: 6, fontSize: 12,
                  background: "var(--pro-bg)", border: "1px solid var(--pro-border)",
                  color: "var(--pro-text)", wordBreak: "break-all",
                }}>
                  {secret}
                </code>
                <button onClick={copySecret} style={{
                  padding: "8px", borderRadius: 6,
                  border: "1px solid var(--pro-border)", background: "var(--pro-bg)",
                  cursor: "pointer", color: secretCopied ? "#22c55e" : "var(--pro-text-muted)",
                }}>
                  {secretCopied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>

              {/* Verification input */}
              <p style={{ fontSize: 12, fontWeight: 600, color: "var(--pro-text)", marginBottom: 6 }}>
                輸入驗證碼確認綁定
              </p>
              <input
                type="text"
                className="pro-input"
                maxLength={6}
                value={verifyCode}
                onChange={e => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                placeholder="6 位數驗證碼"
                style={{ width: "100%", textAlign: "center", letterSpacing: "0.3em", fontSize: 20, marginBottom: 12 }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={verify} disabled={verifying || verifyCode.length !== 6} style={{
                  flex: 1, padding: "10px", borderRadius: 8, border: "none",
                  background: verifyCode.length === 6 ? "#22c55e" : "#4b5563",
                  color: "#fff", fontWeight: 700, fontSize: 13, cursor: verifyCode.length === 6 ? "pointer" : "not-allowed",
                }}>
                  {verifying ? "驗證中…" : "完成綁定"}
                </button>
                <button onClick={() => { setEnrolling(false); setQrCode(""); setError(""); }} style={{
                  padding: "10px 16px", borderRadius: 8,
                  border: "1px solid var(--pro-border)", background: "none",
                  color: "var(--pro-text-muted)", fontSize: 13, cursor: "pointer",
                }}>
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add another factor button when already has MFA */}
      {!enrolling && hasMFA && (
        <button onClick={startEnroll} style={{
          display: "flex", alignItems: "center", gap: 6, padding: "10px 18px",
          borderRadius: 8, border: "1px solid var(--pro-border)",
          background: "var(--pro-surface)", color: "var(--pro-text-muted)",
          cursor: "pointer", fontSize: 13,
        }}>
          <Key size={13} /> 新增另一個驗證器
        </button>
      )}

      {/* Security tips */}
      <div style={{
        marginTop: 24, padding: 16, borderRadius: 10,
        background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)",
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#3b82f6", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <Shield size={12} /> 安全提示
        </div>
        <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
          {[
            "啟用 2FA 後，登入時需同時輸入密碼和驗證碼",
            "請勿在不信任的設備上保存驗證器備份",
            "遺失驗證器請聯繫管理員重置",
            "醫療數據帳號建議使用強密碼 + 2FA 雙重保護",
          ].map(tip => (
            <li key={tip} style={{ fontSize: 12, color: "var(--pro-text-muted)" }}>{tip}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
