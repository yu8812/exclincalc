"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Sparkles, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { REFERENCE_RANGES, CATEGORIES } from "@/lib/referenceRanges";
import { analyzeClinically, type ClinicalAnalysisResult } from "@/lib/pro/clinicalAnalysis";
import { runTaiwanRules } from "@/lib/pro/taiwanFamilyMedicine";
import ICD10Table from "@/components/pro/ICD10Table";
import SOAPEditor from "@/components/pro/SOAPEditor";
import { askClinicalAi, patientContextForAi } from "@/lib/pro/askAi";
import ExamProgressGuide from "@/components/pro/ExamProgressGuide";

interface Patient {
  id: string; full_name: string; sex: "M" | "F" | "Other" | null;
  date_of_birth: string | null; allergies: string[]; chronic_conditions: string[];
}

const PRESETS: Record<string, string[]> = {
  "糖尿病追蹤": ["glucose", "hba1c", "creatinine", "egfr", "systolic", "diastolic", "bmi", "weight"],
  "高血壓追蹤": ["systolic", "diastolic", "pulse", "creatinine", "egfr"],
  "血脂追蹤": ["total_cholesterol", "ldl", "hdl", "triglyceride", "bmi", "waist"],
  "全套CBC": ["wbc", "hemoglobin", "hematocrit", "platelet"],
  "肝功能": ["alt", "ast", "alp", "ggt", "bilirubin"],
  "腎功能": ["creatinine", "egfr", "uric_acid"],
  "甲狀腺": ["tsh", "ft4"],
};

export default function NewClinicalRecordPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [visitDate, setVisitDate] = useState(new Date().toISOString().split("T")[0]);
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [labData, setLabData] = useState<Record<string, string>>({});
  const [soap, setSoap] = useState({ subjective: "", objective: "", assessment: "", plan: "" });
  const [icd10Input, setIcd10Input] = useState("");
  const [icd10Codes, setIcd10Codes] = useState<string[]>([]);
  const [clinicalResult, setClinicalResult] = useState<ClinicalAnalysisResult | null>(null);
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [saving, setSaving] = useState(false);
  const [gender, setGender] = useState<"M" | "F" | undefined>(undefined);
  const [highlightKeys, setHighlightKeys] = useState<Set<string>>(new Set());
  const [addedPackageIds, setAddedPackageIds] = useState<string[]>([]);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data } = await supabase.from("doctor_patients").select("id, full_name, sex, date_of_birth, allergies, chronic_conditions").eq("id", id).single();
      setPatient(data);
      if (data?.sex === "M" || data?.sex === "F") setGender(data.sex);
    };
    load();
  }, [id]);

  const runLocalAnalysis = useCallback(() => {
    const numericData: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(labData)) {
      if (v !== "") numericData[k] = v;
    }
    const result = analyzeClinically(numericData, gender);
    setClinicalResult(result);

    // Auto-populate ICD10 from analysis
    const codes = result.icd10Candidates.filter(c => c.confidence === "high").map(c => c.code);
    if (codes.length > 0) {
      setIcd10Codes(prev => Array.from(new Set([...prev, ...codes])));
    }
  }, [labData, gender]);

  useEffect(() => {
    const timer = setTimeout(runLocalAnalysis, 600);
    return () => clearTimeout(timer);
  }, [runLocalAnalysis]);

  const applyPreset = (keys: string[]) => {
    setHighlightKeys(new Set(keys));
    setTimeout(() => setHighlightKeys(new Set()), 3000);
  };

  const handleAiAssist = async (soapContext: string) => {
    setAiLoading(true);
    setAiError("");
    const labSummary = Object.entries(labData).filter(([, v]) => v).map(([k, v]) => {
      const ref = REFERENCE_RANGES.find(r => r.key === k);
      return ref ? `${ref.label_en}: ${v} ${ref.unit}` : `${k}: ${v}`;
    }).join(", ");
    const r = await askClinicalAi({
      // 只送年齡、性別、慢性病、過敏；姓名和生日不出這台伺服器
      patientContext: patient ? patientContextForAi(patient) : "",
      labData: labSummary,
      symptoms: chiefComplaint,
      soapDraft: soapContext,
    });
    if (r.ok) {
      setAiResult(r.text);
      setSoap(prev => ({
        ...prev,
        assessment: prev.assessment || (clinicalResult?.differentials.slice(0, 3).map(d => `• ${d.diagnosis_zh} (${d.icd10})`).join("\n") || ""),
      }));
    } else {
      setAiError(r.message);
    }
    setAiLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const objectiveData: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(labData)) {
      if (v !== "") objectiveData[k] = isNaN(Number(v)) ? v : Number(v);
    }

    await supabase.from("clinical_records").insert({
      patient_id: id,
      doctor_id: user.id,
      visit_date: visitDate,
      chief_complaint: chiefComplaint || null,
      subjective: soap.subjective || null,
      objective: objectiveData,
      assessment: soap.assessment || null,
      plan: soap.plan || null,
      icd10_codes: icd10Codes,
      ai_analysis: aiResult || null,
    });
    router.push(`/pro/patients/${id}`);
  };

  const categoryGroups = Object.entries(CATEGORIES);

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <Link href={`/pro/patients/${id}`} className="pro-btn-ghost" style={{ padding: "7px 10px" }}>
          <ArrowLeft size={15} />
        </Link>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--pro-text)" }}>新增臨床記錄</h1>
          {patient && <p style={{ fontSize: 13, color: "var(--pro-text-muted)", marginTop: 2 }}>{patient.full_name}</p>}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <input type="date" className="pro-input" value={visitDate} onChange={e => setVisitDate(e.target.value)} style={{ width: "auto" }} />
          <button className="pro-btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={14} />
            {saving ? "儲存中..." : "儲存記錄"}
          </button>
        </div>
      </div>

      {/* Allergy warning */}
      {(patient?.allergies?.length ?? 0) > 0 && (
        <div style={{ padding: "10px 14px", background: "var(--pro-danger-dim)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={15} color="var(--pro-danger)" />
          <span style={{ fontSize: 13, color: "var(--pro-danger)" }}>
            過敏史: {patient?.allergies?.join(", ")}
          </span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Left: Lab data input */}
        <div>
          <div className="pro-card" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)", marginBottom: 12 }}>主訴</div>
            <input className="pro-input" value={chiefComplaint} onChange={e => setChiefComplaint(e.target.value)} placeholder="主要就診原因（如：頭暈/頭痛、疲勞/倦怠、定期健檢）..." />
          </div>

          {/* Progressive Exam Guide */}
          <ExamProgressGuide
            complaint={chiefComplaint}
            labData={labData}
            addedIds={addedPackageIds}
            onAdd={(keys) => applyPreset(keys)}
            onAddId={(id) => setAddedPackageIds(prev => prev.includes(id) ? prev : [...prev, id])}
          />

          <div className="pro-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)" }}>客觀數據 (O)</div>
            </div>

            {/* Quick Presets */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 14 }}>
              {Object.entries(PRESETS).map(([label, keys]) => (
                <button key={label} onClick={() => applyPreset(keys)} className="pro-btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }}>
                  {label}
                </button>
              ))}
            </div>

            {categoryGroups.map(([catKey, cat]) => {
              const items = REFERENCE_RANGES.filter(r => r.category === catKey && r.type === "number");
              if (items.length === 0) return null;
              return (
                <div key={catKey} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--pro-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                    {cat.icon} {cat.label_en}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {items.map(ref => {
                      const highlighted = highlightKeys.has(ref.key);
                      const val = labData[ref.key] || "";
                      const hasValue = val !== "";
                      return (
                        <div key={ref.key} style={{
                          padding: "8px 10px", borderRadius: 7,
                          border: `1px solid ${highlighted ? "var(--pro-accent)" : hasValue ? "rgba(59,130,246,0.2)" : "var(--pro-border)"}`,
                          background: highlighted ? "var(--pro-accent-dim)" : "var(--pro-bg)",
                          transition: "all 0.2s",
                        }}>
                          <div style={{ fontSize: 10, color: "var(--pro-text-muted)", marginBottom: 4 }}>
                            {ref.label_en}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <input
                              type="number"
                              value={val}
                              onChange={e => setLabData(prev => ({ ...prev, [ref.key]: e.target.value }))}
                              placeholder="—"
                              style={{
                                background: "none", border: "none", outline: "none",
                                color: "var(--pro-text)", fontSize: 14, fontWeight: 600,
                                width: "70%",
                              }}
                            />
                            <span style={{ fontSize: 10, color: "var(--pro-text-muted)" }}>{ref.unit}</span>
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

        {/* Right: Analysis + SOAP */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Critical flags */}
          {clinicalResult && clinicalResult.criticalFlags.length > 0 && (
            <div style={{ padding: 14, background: "var(--pro-danger-dim)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8 }}>
              {clinicalResult.criticalFlags.map((f, i) => (
                <div key={i} style={{ fontSize: 12, color: "var(--pro-danger)", marginBottom: 4 }}>⚠ {f}</div>
              ))}
            </div>
          )}

          {/* Taiwan Disease Rules */}
          {(() => {
            const tw = runTaiwanRules(labData, gender);
            if (tw.length === 0) return null;
            return (
              <div className="pro-card" style={{ padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)", marginBottom: 10, display: "flex", alignItems: "center", gap: 5 }}>
                  🇹🇼 台灣常見疾病偵測
                </div>
                {tw.map(({ rule, evidence }) => (
                  <div key={rule.id} style={{
                    padding: "10px 12px", borderRadius: 7, marginBottom: 6,
                    background: rule.severity === "critical" ? "var(--pro-danger-dim)" : rule.severity === "urgent" ? "rgba(234,179,8,0.06)" : "var(--pro-bg)",
                    border: `1px solid ${rule.severity === "critical" ? "rgba(239,68,68,0.25)" : rule.severity === "urgent" ? "rgba(234,179,8,0.25)" : "var(--pro-border)"}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                      <code style={{ fontSize: 11, fontFamily: "monospace", color: "var(--pro-accent)", background: "var(--pro-accent-dim)", padding: "1px 6px", borderRadius: 3 }}>{rule.icd10}</code>
                      <span style={{ fontSize: 12, fontWeight: 700, color: rule.severity === "critical" ? "var(--pro-danger)" : "var(--pro-text)" }}>{rule.name_zh}</span>
                      <button
                        onClick={() => setIcd10Codes(prev => prev.includes(rule.icd10) ? prev : [...prev, rule.icd10])}
                        style={{ marginLeft: "auto", fontSize: 10, padding: "1px 7px", borderRadius: 3, background: "var(--pro-accent-dim)", color: "var(--pro-accent)", border: "none", cursor: "pointer" }}
                      >
                        + 加入ICD
                      </button>
                    </div>
                    {evidence.map((e, i) => (
                      <div key={i} style={{ fontSize: 11, color: "var(--pro-text-muted)", marginLeft: 4 }}>· {e}</div>
                    ))}
                    <div style={{ fontSize: 10, color: "var(--pro-text-muted)", marginTop: 4, fontStyle: "italic" }}>{rule.prevalence_note}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* ICD-10 */}
          {clinicalResult && clinicalResult.icd10Candidates.length > 0 && (
            <div className="pro-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)", marginBottom: 10 }}>ICD-10 候選診斷碼</div>
              <ICD10Table candidates={clinicalResult.icd10Candidates.slice(0, 6)} />
              <div style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}>
                <input className="pro-input" value={icd10Input} onChange={e => setIcd10Input(e.target.value)}
                  placeholder="手動輸入 ICD-10 碼" style={{ flex: 1 }}
                  onKeyDown={e => { if (e.key === "Enter" && icd10Input.trim()) { setIcd10Codes(prev => [...new Set([...prev, icd10Input.trim()])]); setIcd10Input(""); } }}
                />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                {icd10Codes.map(c => (
                  <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 4, background: "var(--pro-accent-dim)", color: "var(--pro-accent)", fontSize: 12, fontFamily: "monospace" }}>
                    {c}
                    <button onClick={() => setIcd10Codes(prev => prev.filter(x => x !== c))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit" }}>×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Differentials */}
          {clinicalResult && clinicalResult.differentials.length > 0 && (
            <div className="pro-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)", marginBottom: 10 }}>鑑別診斷</div>
              {clinicalResult.differentials.map((d, i) => (
                <div key={i} style={{ padding: "10px 12px", borderRadius: 7, marginBottom: 6, background: "var(--pro-bg)", border: "1px solid var(--pro-border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{
                      padding: "1px 7px", borderRadius: 3, fontSize: 10, fontWeight: 700,
                      background: d.probability === "high" ? "var(--pro-danger-dim)" : d.probability === "moderate" ? "var(--pro-warning-dim)" : "var(--pro-card-hover)",
                      color: d.probability === "high" ? "var(--pro-danger)" : d.probability === "moderate" ? "var(--pro-warning)" : "var(--pro-text-muted)",
                    }}>
                      {d.probability === "high" ? "高" : d.probability === "moderate" ? "中" : "低"}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--pro-text)" }}>{d.diagnosis_zh}</span>
                    <code style={{ fontSize: 10, color: "var(--pro-accent)", marginLeft: "auto" }}>{d.icd10}</code>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--pro-text-muted)" }}>{d.supporting.join(" · ")}</div>
                </div>
              ))}
            </div>
          )}

          {/* SOAP editor */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)", marginBottom: 10 }}>SOAP 記錄</div>
            <SOAPEditor
              values={soap}
              onChange={(k, v) => setSoap(prev => ({ ...prev, [k]: v }))}
              onAiAssist={handleAiAssist}
              aiLoading={aiLoading}
              aiError={aiError}
            />
          </div>

          {/* AI result */}
          {aiResult && (
            <div style={{ padding: 16, background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.15)", borderRadius: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--pro-accent)", marginBottom: 8, display: "flex", alignItems: "center", gap: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <Sparkles size={12} /> AI 臨床輔助分析
              </div>
              <div style={{ fontSize: 12, color: "var(--pro-text-muted)", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{aiResult}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
