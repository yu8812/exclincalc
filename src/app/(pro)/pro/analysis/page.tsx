"use client";

import { useState, useCallback, useEffect } from "react";
import { FlaskConical, Sparkles, AlertTriangle } from "lucide-react";
import { REFERENCE_RANGES, CATEGORIES } from "@/lib/referenceRanges";
import { analyzeClinically, type ClinicalAnalysisResult } from "@/lib/pro/clinicalAnalysis";
import ICD10Table from "@/components/pro/ICD10Table";
import { askClinicalAi } from "@/lib/pro/askAi";

export default function ClinicalAnalysisPage() {
  const [gender, setGender] = useState<"M" | "F" | "">("");
  const [age, setAge] = useState("");
  const [labData, setLabData] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ClinicalAnalysisResult | null>(null);
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const runAnalysis = useCallback(() => {
    const numData: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(labData)) {
      if (v !== "") numData[k] = v;
    }
    if (Object.keys(numData).length === 0) { setResult(null); return; }
    setResult(analyzeClinically(numData, gender as "M" | "F" | undefined, age ? Number(age) : undefined));
  }, [labData, gender, age]);

  useEffect(() => {
    const t = setTimeout(runAnalysis, 500);
    return () => clearTimeout(t);
  }, [runAnalysis]);

  const handleAI = async () => {
    setAiLoading(true);
    setAiError("");
    const labSummary = Object.entries(labData).filter(([, v]) => v).map(([k, v]) => {
      const ref = REFERENCE_RANGES.find(r => r.key === k);
      return ref ? `${ref.label_en}: ${v} ${ref.unit}` : `${k}: ${v}`;
    }).join(", ");
    const r = await askClinicalAi({
      patientContext: `Sex: ${gender || "unknown"}, Age: ${age || "unknown"}`,
      labData: labSummary,
    });
    if (r.ok) setAiResult(r.text);
    else { setAiResult(""); setAiError(r.message); }
    setAiLoading(false);
  };

  const categoryGroups = Object.entries(CATEGORIES);

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--pro-text)", display: "flex", alignItems: "center", gap: 8 }}>
          <FlaskConical size={20} color="var(--pro-accent)" /> 臨床分析工具
        </h1>
        <p style={{ fontSize: 13, color: "var(--pro-text-muted)", marginTop: 4 }}>
          快速輸入檢驗數值，即時獲得鑑別診斷與 ICD-10 建議（不與病患記錄綁定）
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Input panel */}
        <div>
          <div className="pro-card" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--pro-text-muted)", display: "block", marginBottom: 5 }}>性別</label>
                <select className="pro-input" value={gender} onChange={e => setGender(e.target.value as "M" | "F" | "")}>
                  <option value="">不指定</option>
                  <option value="M">男</option>
                  <option value="F">女</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--pro-text-muted)", display: "block", marginBottom: 5 }}>年齡</label>
                <input className="pro-input" type="number" value={age} onChange={e => setAge(e.target.value)} placeholder="歲" />
              </div>
            </div>
          </div>

          <div className="pro-card" style={{ padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)", marginBottom: 14 }}>輸入檢驗數值</div>
            {categoryGroups.map(([catKey, cat]) => {
              const items = REFERENCE_RANGES.filter(r => r.category === catKey && r.type === "number");
              if (items.length === 0) return null;
              return (
                <div key={catKey} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--pro-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                    {cat.icon} {cat.label_en}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {items.map(ref => {
                      const val = labData[ref.key] || "";
                      return (
                        <div key={ref.key} style={{ padding: "8px 10px", borderRadius: 7, border: `1px solid ${val ? "rgba(59,130,246,0.25)" : "var(--pro-border)"}`, background: "var(--pro-bg)" }}>
                          <div style={{ fontSize: 9, color: "var(--pro-text-muted)", marginBottom: 3 }}>{ref.label_en}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <input type="number" value={val} onChange={e => setLabData(prev => ({ ...prev, [ref.key]: e.target.value }))}
                              placeholder="—" style={{ background: "none", border: "none", outline: "none", color: "var(--pro-text)", fontSize: 13, fontWeight: 600, width: "70%" }} />
                            <span style={{ fontSize: 9, color: "var(--pro-text-muted)" }}>{ref.unit}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Result panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {result && result.criticalFlags.length > 0 && (
            <div style={{ padding: 14, background: "var(--pro-danger-dim)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <AlertTriangle size={14} color="var(--pro-danger)" />
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--pro-danger)" }}>危急值警示</span>
              </div>
              {result.criticalFlags.map((f, i) => (
                <div key={i} style={{ fontSize: 12, color: "var(--pro-danger)", lineHeight: 1.6 }}>{f}</div>
              ))}
            </div>
          )}

          {result && result.clinicalNotes.length > 0 && (
            <div className="pro-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pro-text)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>臨床解讀</div>
              {result.clinicalNotes.map((n, i) => (
                <div key={i} style={{ fontSize: 12, color: "var(--pro-text-muted)", lineHeight: 1.7, marginBottom: 8, paddingLeft: 8, borderLeft: "2px solid var(--pro-accent)" }}>{n}</div>
              ))}
            </div>
          )}

          {result && result.icd10Candidates.length > 0 && (
            <div className="pro-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)", marginBottom: 12 }}>ICD-10 候選診斷碼</div>
              <ICD10Table candidates={result.icd10Candidates} />
            </div>
          )}

          {result && result.differentials.length > 0 && (
            <div className="pro-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)", marginBottom: 12 }}>鑑別診斷</div>
              {result.differentials.map((d, i) => (
                <div key={i} style={{ padding: "10px 12px", borderRadius: 7, marginBottom: 7, background: "var(--pro-bg)", border: "1px solid var(--pro-border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{
                      padding: "1px 7px", borderRadius: 3, fontSize: 10, fontWeight: 700,
                      background: d.probability === "high" ? "var(--pro-danger-dim)" : "var(--pro-warning-dim)",
                      color: d.probability === "high" ? "var(--pro-danger)" : "var(--pro-warning)",
                    }}>
                      {d.probability === "high" ? "高" : d.probability === "moderate" ? "中" : "低"}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--pro-text)" }}>{d.diagnosis_zh}</span>
                    <span style={{ fontSize: 11, color: "var(--pro-text-muted)", marginLeft: 4 }}>{d.diagnosis_en}</span>
                    <code style={{ fontSize: 10, color: "var(--pro-accent)", marginLeft: "auto" }}>{d.icd10}</code>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--pro-text-muted)" }}>{d.supporting.join(" · ")}</div>
                </div>
              ))}
            </div>
          )}

          {result && result.abnormalCount > 0 && (
            <button className="pro-btn-primary" onClick={handleAI} disabled={aiLoading} style={{ width: "100%", justifyContent: "center" }}>
              <Sparkles size={14} />
              {aiLoading ? "AI 分析中..." : "取得 AI 臨床分析"}
            </button>
          )}

          {aiError && (
            <div role="alert" style={{ padding: "10px 14px", borderRadius: 8, fontSize: 12, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--pro-danger)" }}>
              {aiError}
            </div>
          )}

          {aiResult && (
            <div style={{ padding: 16, background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.15)", borderRadius: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--pro-accent)", marginBottom: 8, display: "flex", alignItems: "center", gap: 5, textTransform: "uppercase" }}>
                <Sparkles size={12} /> AI 臨床輔助分析
              </div>
              <div style={{ fontSize: 12, color: "var(--pro-text-muted)", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{aiResult}</div>
            </div>
          )}

          {!result && (
            <div className="pro-card" style={{ padding: 40, textAlign: "center" }}>
              <FlaskConical size={36} color="var(--pro-text-muted)" style={{ margin: "0 auto 12px" }} />
              <p style={{ color: "var(--pro-text-muted)", fontSize: 13 }}>請在左側輸入檢驗數值以開始分析</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
