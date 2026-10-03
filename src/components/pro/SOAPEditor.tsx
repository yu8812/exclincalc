"use client";

import { useEffect, useRef } from "react";
import { Sparkles, X } from "lucide-react";

interface SOAPSection {
  key: "subjective" | "objective" | "assessment" | "plan";
  label: string;
  labelEn: string;
  placeholder: string;
  color: string;
}

const SECTIONS: SOAPSection[] = [
  {
    key: "subjective", label: "主觀 (S)", labelEn: "Subjective",
    placeholder: "病患主訴、症狀描述、病史、用藥史...\nPatient complaints, symptoms, history, current medications...",
    color: "#3b82f6",
  },
  {
    key: "objective", label: "客觀 (O)", labelEn: "Objective",
    placeholder: "體格檢查結果、生命徵象、實驗室數據...\nPhysical exam findings, vital signs, laboratory results...",
    color: "#10b981",
  },
  {
    key: "assessment", label: "評估 (A)", labelEn: "Assessment",
    placeholder: "診斷評估、鑑別診斷、ICD-10 代碼...\nDiagnosis, differential diagnoses, ICD-10 codes...",
    color: "#f59e0b",
  },
  {
    key: "plan", label: "計畫 (P)", labelEn: "Plan",
    placeholder: "治療計畫、藥物處方、追蹤安排...\nTreatment plan, prescriptions, follow-up schedule...",
    color: "#8b5cf6",
  },
];

interface SOAPEditorProps {
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onAiAssist?: (context: string) => void;
  aiLoading?: boolean;
  // AI 回覆全文。顯示在 P 欄下面，由醫師決定要不要加進 A 欄，不會自己蓋掉醫師寫的內容。
  aiSuggestion?: string;
  aiError?: string;
  onDismissAi?: () => void;
}

export default function SOAPEditor({
  values, onChange, onAiAssist, aiLoading, aiSuggestion, aiError, onDismissAi,
}: SOAPEditorProps) {
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Auto-resize textareas
  useEffect(() => {
    for (const key of Object.keys(textareaRefs.current)) {
      const el = textareaRefs.current[key];
      if (el) {
        el.style.height = "auto";
        el.style.height = `${Math.max(100, el.scrollHeight)}px`;
      }
    }
  }, [values]);

  const handleAiAssist = () => {
    if (!onAiAssist) return;
    const context = `S: ${values.subjective || ""}\nO: ${values.objective || ""}`;
    onAiAssist(context);
  };

  const appendToAssessment = () => {
    if (!aiSuggestion) return;
    const current = values.assessment?.trim();
    onChange("assessment", current ? `${current}\n\n${aiSuggestion.trim()}` : aiSuggestion.trim());
    onDismissAi?.();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {SECTIONS.map((section) => (
        <div key={section.key} className="pro-card" style={{ overflow: "hidden" }}>
          <div style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--pro-border)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: `${section.color}08`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 24, height: 24, borderRadius: 6,
                background: `${section.color}20`, border: `1px solid ${section.color}40`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 800, color: section.color,
              }}>
                {section.key[0].toUpperCase()}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--pro-text)" }}>
                {section.label}
              </span>
              <span style={{ fontSize: 11, color: "var(--pro-text-muted)" }}>
                {section.labelEn}
              </span>
            </div>
            {(section.key === "assessment" || section.key === "plan") && onAiAssist && (
              <button
                onClick={handleAiAssist}
                disabled={aiLoading}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                  background: "var(--pro-accent-dim)", color: "var(--pro-accent)",
                  border: "1px solid rgba(59,130,246,0.2)", cursor: "pointer",
                  opacity: aiLoading ? 0.6 : 1,
                }}
              >
                <Sparkles size={11} />
                {aiLoading ? "AI 思考中…" : "AI 輔助"}
              </button>
            )}
          </div>
          <textarea
            ref={el => { textareaRefs.current[section.key] = el; }}
            value={values[section.key] || ""}
            onChange={e => onChange(section.key, e.target.value)}
            placeholder={section.placeholder}
            style={{
              width: "100%", minHeight: 100, padding: "12px 16px",
              background: "transparent", border: "none", outline: "none",
              color: "var(--pro-text)", fontSize: 13, lineHeight: 1.7,
              resize: "none", fontFamily: "inherit",
            }}
          />
          <div style={{
            padding: "4px 16px 6px",
            fontSize: 10, color: "var(--pro-text-muted)",
            borderTop: "1px solid var(--pro-border)",
            textAlign: "right",
          }}>
            {(values[section.key] || "").length} 字
          </div>
        </div>
      ))}

      {aiError && (
        <div role="alert" style={{
          padding: "10px 14px", borderRadius: 8, fontSize: 13,
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--pro-danger)",
        }}>
          {aiError}
        </div>
      )}

      {aiSuggestion && (
        <div className="pro-card" style={{ padding: 16, border: "1px solid rgba(59,130,246,0.25)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--pro-accent)" }}>
              <Sparkles size={13} /> AI 建議（僅供參考，請自行判斷）
            </div>
            <button onClick={onDismissAi} aria-label="關閉 AI 建議"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--pro-text-muted)" }}>
              <X size={14} />
            </button>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.75, color: "var(--pro-text)", whiteSpace: "pre-wrap", maxHeight: 360, overflowY: "auto" }}>
            {aiSuggestion}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={appendToAssessment} style={{
              padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
              background: "var(--pro-accent)", color: "#fff", border: "none",
            }}>
              加到評估 (A) 欄最後面
            </button>
            <button onClick={onDismissAi} style={{
              padding: "6px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer",
              background: "transparent", color: "var(--pro-text-muted)", border: "1px solid var(--pro-border)",
            }}>
              不用了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
