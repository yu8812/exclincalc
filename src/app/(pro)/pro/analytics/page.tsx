"use client";

import { useEffect, useState } from "react";
import { BarChart3, Users, FileText, Pill, BookOpen, Stethoscope, Sparkles, X } from "lucide-react";
import ProStatCard from "@/components/pro/ProStatCard";

interface AnalyticsData {
  totalUsers: number;
  totalRecords: number;
  totalManual: number;
  totalScan: number;
  totalPatients: number;
  totalMedications: number;
  totalReferences: number;
  diagnosisAccuracy: number | null;
  totalFeedback: number;
  correctCount: number;
  partialCount: number;
  incorrectCount: number;
  weeklyVolume: Array<{ week: string; count: number }>;
  sexDistribution: Array<{ sex: string; count: number }>;
  topMedicationCategories: Array<{ category: string; count: number }>;
  scope?: "demo" | "all";   // demo = 展示帳號登入，只算展示資料
}

function SimpleBarChart({ data, maxVal, colorVar = "var(--pro-accent)" }: {
  data: Array<{ label: string; value: number }>;
  maxVal: number;
  colorVar?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {data.map(({ label, value }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 11, color: "var(--pro-text-muted)", width: 80, flexShrink: 0, textAlign: "right" }}>
            {label}
          </div>
          <div style={{ flex: 1, height: 20, background: "var(--pro-bg)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 4,
              width: `${maxVal > 0 ? (value / maxVal) * 100 : 0}%`,
              background: colorVar,
              transition: "width 0.5s ease",
              display: "flex", alignItems: "center", justifyContent: "flex-end",
              paddingRight: 6,
              minWidth: value > 0 ? 24 : 0,
            }}>
              {value > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>{value}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    fetch("/api/pro/analytics")
      .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }))
      .then(({ status, body }) => {
        if (status === 403) setError("數據分析只有管理員看得到；如果你是管理員，請先完成兩步驟驗證再回來。");
        else if (status === 401) setError("登入已經過期，重新登入後再試一次。");
        else if (body.error) setError("統計資料暫時載入不了，重新整理一次試試。");
        else setData(body);
        setLoading(false);
      })
      .catch(() => { setError("連不上伺服器，檢查一下網路再試。"); setLoading(false); });
  }, []);

  const handleAiAnalysis = async () => {
    if (!data) return;
    setAiLoading(true);
    setAiAnalysis("");
    try {
      const res = await fetch("/api/pro/analytics", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      setAiAnalysis(json.result || json.message || "AI 這次沒有回應，等一下再試一次。");
    } catch {
      setAiAnalysis("連不上伺服器，檢查一下網路再試。");
    }
    setAiLoading(false);
  };

  if (loading) return <div style={{ color: "var(--pro-text-muted)", padding: 40 }}>載入統計資料中...</div>;
  if (error) return <div style={{ color: "var(--pro-danger)", padding: 40 }}>{error}</div>;
  if (!data) return null;

  const weeklyMax = Math.max(...(data.weeklyVolume?.map(w => w.count) || [1]));
  const sexMax = Math.max(...(data.sexDistribution?.map(s => s.count) || [1]));

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--pro-text)", display: "flex", alignItems: "center", gap: 8 }}>
            <BarChart3 size={20} color="var(--pro-accent)" /> 數據分析
          </h1>
          <p style={{ fontSize: 13, color: "var(--pro-text-muted)", marginTop: 4 }}>
            {data.scope === "demo" ? "展示模式：下面的數字只算展示帳號的虛構資料" : "平台使用統計概覽"}
          </p>
        </div>
        <button
          onClick={handleAiAnalysis}
          disabled={aiLoading}
          style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "8px 16px", borderRadius: 8,
            background: aiLoading ? "var(--pro-bg)" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
            border: aiLoading ? "1px solid var(--pro-border)" : "none",
            color: aiLoading ? "var(--pro-text-muted)" : "#fff",
            cursor: aiLoading ? "not-allowed" : "pointer",
            fontSize: 13, fontWeight: 600,
            boxShadow: aiLoading ? "none" : "0 2px 8px rgba(99,102,241,0.35)",
          }}
        >
          <Sparkles size={14} />
          {aiLoading ? "AI 分析中..." : "AI 摘要分析"}
        </button>
      </div>

      {/* Summary cards — A: Accounts, B: Patients, C: Drugs, D: References, E: Accuracy */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, marginBottom: 28 }}>
        <ProStatCard icon={Users}        value={data.totalUsers}       label={data.scope === "demo" ? "展示帳號數" : "帳號數"}      color="blue"   href="/pro/admin/users" />
        <ProStatCard icon={Stethoscope}  value={data.totalPatients}    label="病患記錄"    color="green"  href="/pro/patients" />
        <ProStatCard icon={Pill}         value={data.totalMedications} label="藥物資料庫"  color="yellow" href="/pro/admin/medications" />
        <ProStatCard icon={BookOpen}     value={data.totalReferences}  label="醫療參考值"  color="red"    href="/pro/admin/references" />
        {/* Diagnosis Accuracy */}
        <div className="pro-card" style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--pro-text-muted)", marginBottom: 6, fontWeight: 600 }}>診斷準確率</div>
          {data.diagnosisAccuracy !== null ? (
            <>
              <div style={{ fontSize: 28, fontWeight: 800, color: data.diagnosisAccuracy >= 80 ? "#22c55e" : data.diagnosisAccuracy >= 60 ? "#f59e0b" : "#ef4444" }}>
                {data.diagnosisAccuracy}%
              </div>
              <div style={{ fontSize: 11, color: "var(--pro-text-muted)", marginTop: 4 }}>
                共 {data.totalFeedback} 筆回饋
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: "var(--pro-text-muted)", marginTop: 4 }}>暫無回饋資料</div>
          )}
        </div>
        <ProStatCard icon={FileText}   value={data.totalRecords} label="健康記錄總數" color="blue" href="/pro/admin/records" />
      </div>

      {/* AI Analysis result */}
      {(aiAnalysis || aiLoading) && (
        <div style={{
          marginBottom: 24, padding: "16px 20px", borderRadius: 10,
          background: "linear-gradient(135deg, rgba(99,102,241,0.07), rgba(139,92,246,0.07))",
          border: "1px solid rgba(99,102,241,0.25)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: "#6366f1" }}>
              <Sparkles size={14} /> AI 平台分析摘要
            </div>
            {!aiLoading && (
              <button onClick={() => setAiAnalysis("")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--pro-text-muted)" }}>
                <X size={14} />
              </button>
            )}
          </div>
          {aiLoading ? (
            <div style={{ fontSize: 13, color: "var(--pro-text-muted)" }}>正在分析平台數據，請稍候...</div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--pro-text)", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{aiAnalysis}</div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        {/* Weekly volume */}
        {data.weeklyVolume?.length > 0 && (
          <div className="pro-card" style={{ padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--pro-text)", marginBottom: 16 }}>近期記錄量（每週）</div>
            <SimpleBarChart
              data={data.weeklyVolume.map(w => ({ label: w.week, value: w.count }))}
              maxVal={weeklyMax}
              colorVar="var(--pro-accent)"
            />
          </div>
        )}

        {/* Sex distribution of doctor_patients */}
        {data.sexDistribution?.length > 0 && (
          <div className="pro-card" style={{ padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--pro-text)", marginBottom: 16 }}>病患性別分布</div>
            <SimpleBarChart
              data={data.sexDistribution.map(s => ({
                label: s.sex === "M" ? "男" : s.sex === "F" ? "女" : "其他",
                value: s.count,
              }))}
              maxVal={sexMax}
              colorVar="var(--pro-success)"
            />
          </div>
        )}

        {/* Record type breakdown */}
        <div className="pro-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--pro-text)", marginBottom: 16 }}>記錄類型佔比</div>
          {data.totalRecords > 0 ? (
            <>
              <div style={{ display: "flex", height: 20, borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
                <div style={{ width: `${(data.totalManual / data.totalRecords) * 100}%`, background: "var(--pro-accent)" }} />
                <div style={{ width: `${(data.totalScan / data.totalRecords) * 100}%`, background: "var(--pro-success)" }} />
              </div>
              <div style={{ display: "flex", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: "var(--pro-accent)" }} />
                  <span style={{ fontSize: 12, color: "var(--pro-text-muted)" }}>手動 {data.totalManual}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: "var(--pro-success)" }} />
                  <span style={{ fontSize: 12, color: "var(--pro-text-muted)" }}>掃描 {data.totalScan}</span>
                </div>
              </div>
            </>
          ) : (
            <p style={{ color: "var(--pro-text-muted)", fontSize: 13 }}>尚無記錄</p>
          )}
        </div>

        {/* E: Diagnosis feedback breakdown */}
        {data.totalFeedback > 0 && (
          <div className="pro-card" style={{ padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--pro-text)", marginBottom: 16 }}>診斷回饋分布</div>
            <div style={{ display: "flex", height: 20, borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
              <div style={{ width: `${(data.correctCount / data.totalFeedback) * 100}%`, background: "#22c55e" }} />
              <div style={{ width: `${(data.partialCount / data.totalFeedback) * 100}%`, background: "#f59e0b" }} />
              <div style={{ width: `${(data.incorrectCount / data.totalFeedback) * 100}%`, background: "#ef4444" }} />
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {[
                { label: "✓ 正確", count: data.correctCount,   color: "#22c55e" },
                { label: "△ 部分", count: data.partialCount,   color: "#f59e0b" },
                { label: "✗ 有誤", count: data.incorrectCount, color: "#ef4444" },
              ].map(({ label, count, color }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                  <span style={{ fontSize: 12, color: "var(--pro-text-muted)" }}>
                    {label} {count}筆（{data.totalFeedback > 0 ? Math.round((count / data.totalFeedback) * 100) : 0}%）
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top medication categories */}
        {data.topMedicationCategories?.length > 0 && (
          <div className="pro-card" style={{ padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--pro-text)", marginBottom: 16 }}>藥物資料庫分類</div>
            <SimpleBarChart
              data={data.topMedicationCategories.map(c => ({ label: c.category, value: c.count }))}
              maxVal={Math.max(...data.topMedicationCategories.map(c => c.count))}
              colorVar="var(--pro-warning)"
            />
          </div>
        )}
      </div>
    </div>
  );
}
