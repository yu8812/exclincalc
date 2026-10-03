"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import {
  Sparkles, Save, RotateCcw, User, ChevronDown, CheckCircle2,
  AlertTriangle, ClipboardList,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import { REFERENCE_RANGES } from "@/lib/referenceRanges";
import { analyzeClinically, type ClinicalAnalysisResult } from "@/lib/pro/clinicalAnalysis";
import { runTaiwanRules, EXAM_PACKAGES } from "@/lib/pro/taiwanFamilyMedicine";
import ICD10Table from "@/components/pro/ICD10Table";
import { askClinicalAi } from "@/lib/pro/askAi";

// ── 主訴快選 ─────────────────────────────────────────────────
const COMPLAINTS = [
  "頭暈/頭痛", "疲勞/倦怠", "多尿/口渴", "關節腫痛",
  "胸悶/心悸", "體重增加", "水腫", "腹部不適", "定期健檢",
  "高血壓追蹤", "糖尿病追蹤",
];

// ── 套組顏色 by stage ─────────────────────────────────────────
const STAGE_COLORS: Record<number, string> = {
  1: "#3b82f6", 2: "#f97316", 3: "#06b6d4", 4: "#8b5cf6",
};

interface PatientOption { id: string; full_name: string; }

export default function ExamWorkbenchPage() {
  // Patient
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);
  const [patientOpen, setPatientOpen] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");

  // Exam config
  const [gender, setGender] = useState<"M" | "F" | "">("");
  const [age, setAge] = useState("");
  const [complaint, setComplaint] = useState("");
  const [activePackages, setActivePackages] = useState<Set<string>>(new Set(["vitals", "cbc"]));

  // Lab data
  const [labData, setLabData] = useState<Record<string, string>>({});
  const [icd10Codes, setIcd10Codes] = useState<string[]>([]);
  const [icd10Input, setIcd10Input] = useState("");

  // Analysis
  const [result, setResult] = useState<ClinicalAnalysisResult | null>(null);
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);

  // Warn before leaving with unsaved data
  useEffect(() => {
    const hasData = Object.values(labData).some(v => v !== "");
    if (!hasData || saveOk) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [labData, saveOk]);

  // Load patients for selector
  useEffect(() => {
    createClient().auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: pts } = await createClient()
        .from("doctor_patients")
        .select("id, full_name")
        .eq("doctor_id", data.user.id)
        .order("full_name");
      setPatients(pts || []);
    });
  }, []);

  // Auto-analysis on data change
  const runAnalysis = useCallback(() => {
    const numData: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(labData)) {
      if (v !== "") numData[k] = v;
    }
    if (Object.keys(numData).length === 0) { setResult(null); return; }
    setResult(analyzeClinically(numData, gender as "M" | "F" | undefined, age ? Number(age) : undefined));
  }, [labData, gender, age]);

  useEffect(() => {
    const t = setTimeout(runAnalysis, 400);
    return () => clearTimeout(t);
  }, [runAnalysis]);

  // When patient selected, auto-fill gender/age
  const handleSelectPatient = (pt: PatientOption & { sex?: string; date_of_birth?: string }) => {
    setSelectedPatient(pt);
    setPatientOpen(false);
    setPatientSearch("");
    if (pt.sex === "M" || pt.sex === "F") setGender(pt.sex);
    if (pt.date_of_birth) {
      const age = Math.floor((Date.now() - new Date(pt.date_of_birth).getTime()) / (365.25 * 24 * 3600 * 1000));
      setAge(String(age));
    }
  };

  // Toggle package
  const togglePackage = (id: string) => {
    setActivePackages(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Keys to show: union of all active packages
  const activeKeys = new Set(
    EXAM_PACKAGES.filter(p => activePackages.has(p.id)).flatMap(p => p.keys)
  );

  // Active reference ranges
  const activeRefs = REFERENCE_RANGES.filter(r => r.type === "number" && activeKeys.has(r.key));

  // Taiwan disease results
  const taiwanHits = runTaiwanRules(labData, gender || undefined);

  // AI Assist
  const handleAI = async () => {
    setAiLoading(true);
    setAiError("");
    const labSummary = Object.entries(labData).filter(([, v]) => v).map(([k, v]) => {
      const ref = REFERENCE_RANGES.find(r => r.key === k);
      return ref ? `${ref.label_en}: ${v} ${ref.unit}` : `${k}: ${v}`;
    }).join(", ");
    const r = await askClinicalAi({
      patientContext: `Sex: ${gender || "unknown"}, Age: ${age || "unknown"}`,
      symptoms: complaint || undefined,
      labData: labSummary,
    });
    if (r.ok) setAiResult(r.text);
    else { setAiResult(""); setAiError(r.message); }
    setAiLoading(false);
  };

  // Save to patient record
  const handleSave = async () => {
    if (!selectedPatient) return;
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("clinical_records").insert({
      patient_id: selectedPatient.id,
      doctor_id: user.id,
      visit_date: new Date().toISOString().split("T")[0],
      chief_complaint: complaint || null,
      objective: labData,
      ai_analysis: aiResult || null,
      icd10_codes: icd10Codes,
    });
    setSaving(false);
    setSaveOk(true);
    setTimeout(() => setSaveOk(false), 3000);
  };

  const reset = () => {
    setLabData({});
    setResult(null);
    setAiResult("");
    setIcd10Codes([]);
    setComplaint("");
  };

  const filteredPatients = patients.filter(p =>
    p.full_name.toLowerCase().includes(patientSearch.toLowerCase())
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 60px)" }}>

      {/* ── Top toolbar ─────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 0 14px",
        borderBottom: "1px solid var(--pro-border)", flexWrap: "wrap",
      }}>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: "var(--pro-text)", marginRight: 4, whiteSpace: "nowrap" }}>
          🩺 檢驗工作台
        </h1>

        {/* Patient selector */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setPatientOpen(!patientOpen)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 12px", borderRadius: 7, fontSize: 12,
              border: `1px solid ${selectedPatient ? "var(--pro-accent)" : "var(--pro-border)"}`,
              background: selectedPatient ? "var(--pro-accent-dim)" : "var(--pro-bg)",
              color: selectedPatient ? "var(--pro-accent)" : "var(--pro-text-muted)",
              cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            <User size={12} />
            {selectedPatient ? selectedPatient.full_name : "選擇病患（選填）"}
            <ChevronDown size={11} />
          </button>
          {patientOpen && (
            <div style={{
              position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 50,
              background: "var(--pro-sidebar)", border: "1px solid var(--pro-border)",
              borderRadius: 8, minWidth: 220, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}>
              <div style={{ padding: "8px 8px 4px" }}>
                <input
                  className="pro-input"
                  placeholder="搜尋病患..."
                  value={patientSearch}
                  onChange={e => setPatientSearch(e.target.value)}
                  autoFocus
                  style={{ fontSize: 12, padding: "5px 10px" }}
                />
              </div>
              <div style={{ maxHeight: 200, overflowY: "auto", padding: "4px 4px 6px" }}>
                <button
                  onClick={() => { setSelectedPatient(null); setPatientOpen(false); }}
                  style={{ width: "100%", textAlign: "left", padding: "6px 10px", borderRadius: 5, background: "none", border: "none", cursor: "pointer", color: "var(--pro-text-muted)", fontSize: 12 }}
                >
                  — 不連結病患
                </button>
                {filteredPatients.map(pt => (
                  <button
                    key={pt.id}
                    onClick={() => handleSelectPatient(pt as PatientOption & { sex?: string; date_of_birth?: string })}
                    style={{
                      width: "100%", textAlign: "left", padding: "6px 10px",
                      borderRadius: 5, background: "none", border: "none",
                      cursor: "pointer", color: "var(--pro-text)", fontSize: 12,
                    }}
                  >
                    {pt.full_name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Gender */}
        <select
          value={gender}
          onChange={e => setGender(e.target.value as "M" | "F" | "")}
          className="pro-input"
          style={{ width: 80, fontSize: 12, padding: "5px 8px" }}
        >
          <option value="">性別</option>
          <option value="M">男</option>
          <option value="F">女</option>
        </select>

        {/* Age */}
        <input
          type="number"
          className="pro-input"
          placeholder="年齡"
          value={age}
          onChange={e => setAge(e.target.value)}
          style={{ width: 65, fontSize: 12, padding: "5px 8px" }}
        />

        {/* Complaint quick select */}
        <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
          <input
            className="pro-input"
            placeholder="主訴（可自由輸入）"
            value={complaint}
            onChange={e => setComplaint(e.target.value)}
            style={{ fontSize: 12, padding: "5px 10px", width: "100%" }}
          />
        </div>

        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          <button onClick={reset} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 7, border: "1px solid var(--pro-border)", background: "none", color: "var(--pro-text-muted)", cursor: "pointer", fontSize: 12 }}>
            <RotateCcw size={12} /> 清除
          </button>
          {selectedPatient && (
            <button onClick={handleSave} disabled={saving} className="pro-btn-primary" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
              {saveOk ? <><CheckCircle2 size={12} /> 已儲存</> : <><Save size={12} /> {saving ? "儲存中..." : "存入病歷"}</>}
            </button>
          )}
        </div>
      </div>

      {/* ── Complaint quick tags ─────────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "10px 0 6px" }}>
        {COMPLAINTS.map(c => (
          <button
            key={c}
            onClick={() => setComplaint(c)}
            style={{
              padding: "3px 10px", borderRadius: 20, fontSize: 11, cursor: "pointer",
              border: `1px solid ${complaint === c ? "var(--pro-accent)" : "var(--pro-border)"}`,
              background: complaint === c ? "var(--pro-accent-dim)" : "transparent",
              color: complaint === c ? "var(--pro-accent)" : "var(--pro-text-muted)",
              transition: "all 0.12s",
            }}
          >
            {c}
          </button>
        ))}
      </div>

      {/* ── Package tags ─────────────────────────────────────── */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 0 10px",
        borderBottom: "1px solid var(--pro-border)",
      }}>
        {EXAM_PACKAGES.map(pkg => {
          const active = activePackages.has(pkg.id);
          const color = STAGE_COLORS[pkg.stage];
          const filledCount = pkg.keys.filter(k => labData[k] && labData[k] !== "").length;
          return (
            <button
              key={pkg.id}
              onClick={() => togglePackage(pkg.id)}
              title={pkg.rationale}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                cursor: "pointer", transition: "all 0.12s",
                border: `1.5px solid ${active ? color : "var(--pro-border)"}`,
                background: active ? `${color}15` : "transparent",
                color: active ? color : "var(--pro-text-muted)",
              }}
            >
              <span style={{ fontSize: 13 }}>{pkg.icon}</span>
              {pkg.label}
              {active && filledCount > 0 && (
                <span style={{
                  fontSize: 10, padding: "0 5px", borderRadius: 8,
                  background: color, color: "#fff", fontWeight: 700,
                }}>
                  {filledCount}
                </span>
              )}
              {active && <span style={{ fontSize: 10, opacity: 0.7 }}>S{pkg.stage}</span>}
            </button>
          );
        })}
      </div>

      {/* ── Main workspace ───────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 16, flex: 1, overflow: "hidden", paddingTop: 12 }}>

        {/* Left: Input fields by active package */}
        <div style={{ overflowY: "auto", paddingRight: 8 }}>
          {activePackages.size === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--pro-text-muted)" }}>
              <ClipboardList size={40} style={{ opacity: 0.2, marginBottom: 12 }} />
              <p style={{ fontSize: 14 }}>點選上方標籤開始選擇檢查項目</p>
            </div>
          ) : (
            EXAM_PACKAGES.filter(pkg => activePackages.has(pkg.id)).map(pkg => {
              const refs = REFERENCE_RANGES.filter(r => r.type === "number" && pkg.keys.includes(r.key));
              const color = STAGE_COLORS[pkg.stage];
              return (
                <div key={pkg.id} style={{ marginBottom: 20 }}>
                  {/* Package header */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 7, marginBottom: 10,
                    paddingBottom: 6, borderBottom: `1px solid ${color}30`,
                  }}>
                    <span style={{ fontSize: 16 }}>{pkg.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color }}>{pkg.label}</span>
                    <span style={{ fontSize: 11, color: "var(--pro-text-muted)" }}>{pkg.labelEn}</span>
                    <span style={{
                      marginLeft: "auto", fontSize: 10, padding: "1px 7px", borderRadius: 3,
                      background: `${color}20`, color, fontWeight: 700,
                    }}>
                      Stage {pkg.stage}
                    </span>
                  </div>

                  {/* Input grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                    {refs.map(ref => {
                      const val = labData[ref.key] || "";
                      const hasVal = val !== "";
                      const abnormal = hasVal && (() => {
                        const n = parseFloat(val);
                        const range = ref.normal?.general ?? ref.normal?.male ?? ref.normal?.female;
                        if (range?.min !== undefined && n < range.min) return "low";
                        if (range?.max !== undefined && n > range.max) return "high";
                        return null;
                      })();
                      return (
                        <div
                          key={ref.key}
                          style={{
                            padding: "8px 10px", borderRadius: 8,
                            background: abnormal === "high" ? "rgba(239,68,68,0.05)" : abnormal === "low" ? "rgba(59,130,246,0.05)" : hasVal ? `${color}08` : "var(--pro-bg)",
                            border: `1px solid ${abnormal === "high" ? "rgba(239,68,68,0.3)" : abnormal === "low" ? "rgba(59,130,246,0.3)" : hasVal ? color + "40" : "var(--pro-border)"}`,
                            transition: "all 0.15s",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <span style={{ fontSize: 10, color: "var(--pro-text-muted)", fontWeight: 600 }}>
                              {ref.label_zh || ref.label_en}
                            </span>
                            {abnormal && (
                              <span style={{ fontSize: 9, fontWeight: 700, color: abnormal === "high" ? "var(--pro-danger)" : "var(--pro-accent)" }}>
                                {abnormal === "high" ? "↑" : "↓"}
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                            <input
                              type="number"
                              value={val}
                              onChange={e => setLabData(prev => ({ ...prev, [ref.key]: e.target.value }))}
                              placeholder="—"
                              style={{
                                background: "none", border: "none", outline: "none",
                                color: abnormal === "high" ? "var(--pro-danger)" : abnormal === "low" ? "var(--pro-accent)" : "var(--pro-text)",
                                fontSize: 16, fontWeight: 700, width: "65%",
                              }}
                            />
                            <span style={{ fontSize: 10, color: "var(--pro-text-muted)" }}>{ref.unit}</span>
                          </div>
                          {ref.normal?.general && (
                            <div style={{ fontSize: 9, color: "var(--pro-text-muted)", marginTop: 2 }}>
                              {ref.normal.general.min}–{ref.normal.general.max}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right: Analysis panel */}
        <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Critical flags */}
          {result && result.criticalFlags.length > 0 && (
            <div style={{ padding: 12, background: "var(--pro-danger-dim)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8 }}>
              {result.criticalFlags.map((f, i) => (
                <div key={i} style={{ fontSize: 12, color: "var(--pro-danger)", display: "flex", gap: 6, marginBottom: 3 }}>
                  <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} /> {f}
                </div>
              ))}
            </div>
          )}

          {/* Taiwan disease hits */}
          {taiwanHits.length > 0 && (
            <div className="pro-card" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pro-text)", marginBottom: 10 }}>
                🇹🇼 台灣常見疾病偵測
              </div>
              {taiwanHits.map(({ rule, evidence }) => (
                <div key={rule.id} style={{
                  padding: "8px 10px", borderRadius: 6, marginBottom: 6,
                  background: rule.severity === "critical" ? "var(--pro-danger-dim)" : "var(--pro-bg)",
                  border: `1px solid ${rule.severity === "critical" ? "rgba(239,68,68,0.25)" : "var(--pro-border)"}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <code style={{ fontSize: 10, fontFamily: "monospace", color: "var(--pro-accent)", background: "var(--pro-accent-dim)", padding: "1px 5px", borderRadius: 3 }}>
                      {rule.icd10}
                    </code>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--pro-text)" }}>{rule.name_zh}</span>
                    <button
                      onClick={() => !icd10Codes.includes(rule.icd10) && setIcd10Codes(prev => [...prev, rule.icd10])}
                      style={{ marginLeft: "auto", fontSize: 9, padding: "1px 6px", borderRadius: 3, background: "var(--pro-accent-dim)", color: "var(--pro-accent)", border: "none", cursor: "pointer" }}
                    >
                      +ICD
                    </button>
                  </div>
                  {evidence.slice(0, 2).map((e, i) => (
                    <div key={i} style={{ fontSize: 10, color: "var(--pro-text-muted)" }}>· {e}</div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* ICD-10 from clinical analysis */}
          {result && result.icd10Candidates.length > 0 && (
            <div className="pro-card" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pro-text)", marginBottom: 8 }}>ICD-10 候選診斷</div>
              <ICD10Table candidates={result.icd10Candidates.slice(0, 5)} />
              <div style={{ display: "flex", gap: 5, marginTop: 8 }}>
                <input
                  className="pro-input"
                  value={icd10Input}
                  onChange={e => setIcd10Input(e.target.value)}
                  placeholder="手動加入..."
                  style={{ flex: 1, fontSize: 11, padding: "4px 8px" }}
                  onKeyDown={e => {
                    if (e.key === "Enter" && icd10Input.trim()) {
                      setIcd10Codes(prev => [...new Set([...prev, icd10Input.trim()])]);
                      setIcd10Input("");
                    }
                  }}
                />
              </div>
              {icd10Codes.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                  {icd10Codes.map(c => (
                    <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 4, background: "var(--pro-accent-dim)", color: "var(--pro-accent)", fontSize: 11, fontFamily: "monospace" }}>
                      {c}
                      <button onClick={() => setIcd10Codes(prev => prev.filter(x => x !== c))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Differentials */}
          {result && result.differentials.length > 0 && (
            <div className="pro-card" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pro-text)", marginBottom: 8 }}>鑑別診斷</div>
              {result.differentials.slice(0, 4).map((d, i) => (
                <div key={i} style={{ padding: "8px 10px", borderRadius: 6, marginBottom: 5, background: "var(--pro-bg)", border: "1px solid var(--pro-border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700,
                      background: d.probability === "high" ? "var(--pro-danger-dim)" : d.probability === "moderate" ? "rgba(234,179,8,0.1)" : "var(--pro-card-hover)",
                      color: d.probability === "high" ? "var(--pro-danger)" : d.probability === "moderate" ? "#ca8a04" : "var(--pro-text-muted)",
                    }}>
                      {d.probability === "high" ? "高" : d.probability === "moderate" ? "中" : "低"}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--pro-text)" }}>{d.diagnosis_zh}</span>
                    <code style={{ fontSize: 10, color: "var(--pro-accent)", marginLeft: "auto" }}>{d.icd10}</code>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--pro-text-muted)", marginTop: 4 }}>{d.supporting.join(" · ")}</div>
                </div>
              ))}
            </div>
          )}

          {/* AI Assist */}
          <div className="pro-card" style={{ padding: 14 }}>
            <button
              onClick={handleAI}
              disabled={aiLoading || Object.values(labData).every(v => !v)}
              className="pro-btn-primary"
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12 }}
            >
              <Sparkles size={13} /> {aiLoading ? "AI 分析中..." : "AI 臨床輔助"}
            </button>
            {aiError && (
              <div role="alert" style={{ marginTop: 10, fontSize: 12, color: "var(--pro-danger)" }}>{aiError}</div>
            )}
            {aiResult && (
              <div style={{ marginTop: 10, fontSize: 11, color: "var(--pro-text-muted)", lineHeight: 1.8, whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto" }}>
                {aiResult}
              </div>
            )}
          </div>

          {/* Summary stats */}
          {result && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {[
                { label: "異常", value: result.abnormalCount, color: "#ef4444" },
                { label: "偏高", value: result.highCount, color: "#f97316" },
                { label: "偏低", value: result.lowCount, color: "#3b82f6" },
              ].map(s => (
                <div key={s.label} style={{ padding: "8px", borderRadius: 7, background: "var(--pro-card)", border: "1px solid var(--pro-border)", textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: "var(--pro-text-muted)" }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
