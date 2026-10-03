"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase";
import SOAPEditor from "@/components/pro/SOAPEditor";
import { askClinicalAi } from "@/lib/pro/askAi";

export default function NewNotePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [soap, setSoap] = useState({ subjective: "", objective: "", assessment: "", plan: "" });
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState<Array<{ id: string; full_name: string }>>([]);
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; full_name: string } | null>(null);
  const [showPatientList, setShowPatientList] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState("");
  const [aiError, setAiError] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftIdRef = useRef<string | null>(null);

  // Patient search
  useEffect(() => {
    if (!patientSearch.trim()) { setPatients([]); return; }
    const timer = setTimeout(async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("doctor_patients").select("id, full_name").eq("doctor_id", user.id).ilike("full_name", `%${patientSearch}%`).limit(5);
      setPatients(data || []);
      setShowPatientList(true);
    }, 200);
    return () => clearTimeout(timer);
  }, [patientSearch]);

  // Auto-save draft every 30 seconds
  useEffect(() => {
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => autoSave(), 30000);
    return () => { if (autoSaveRef.current) clearTimeout(autoSaveRef.current); };
  }, [title, soap, selectedPatient]);

  const autoSave = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const payload = {
      doctor_id: user.id,
      patient_id: selectedPatient?.id || null,
      title: title || null,
      subjective: soap.subjective || null,
      objective: soap.objective || null,
      assessment: soap.assessment || null,
      plan: soap.plan || null,
      draft: true,
      updated_at: new Date().toISOString(),
    };
    if (draftIdRef.current) {
      await supabase.from("soap_notes").update(payload).eq("id", draftIdRef.current);
    } else {
      const { data } = await supabase.from("soap_notes").insert(payload).select("id").single();
      if (data?.id) draftIdRef.current = data.id;
    }
    setLastSaved(new Date());
  };

  const handleAiAssist = async (context: string) => {
    setAiLoading(true);
    setAiError("");
    const r = await askClinicalAi({ soapDraft: context, symptoms: soap.subjective });
    if (r.ok) setAiSuggestion(r.text);
    else setAiError(r.message);
    setAiLoading(false);
  };

  const handleSave = async (asDraft = false) => {
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const payload = {
      doctor_id: user.id,
      patient_id: selectedPatient?.id || null,
      title: title || null,
      subjective: soap.subjective || null,
      objective: soap.objective || null,
      assessment: soap.assessment || null,
      plan: soap.plan || null,
      draft: asDraft,
      updated_at: new Date().toISOString(),
    };
    if (draftIdRef.current) {
      await supabase.from("soap_notes").update(payload).eq("id", draftIdRef.current);
    } else {
      await supabase.from("soap_notes").insert(payload);
    }
    router.push("/pro/notes");
  };

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <Link href="/pro/notes" className="pro-btn-ghost" style={{ padding: "7px 10px" }}>
          <ArrowLeft size={15} />
        </Link>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--pro-text)", flex: 1 }}>新增 SOAP 筆記</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {lastSaved && (
            <span style={{ fontSize: 11, color: "var(--pro-text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
              <Clock size={11} /> {lastSaved.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })} 自動儲存
            </span>
          )}
          <button onClick={() => handleSave(true)} className="pro-btn-ghost" disabled={saving}>儲存草稿</button>
          <button onClick={() => handleSave(false)} className="pro-btn-primary" disabled={saving}>
            <Save size={14} /> {saving ? "儲存中..." : "完成"}
          </button>
        </div>
      </div>

      <div className="pro-card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--pro-text-muted)", display: "block", marginBottom: 5 }}>筆記標題</label>
            <input className="pro-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="筆記標題（選填）" />
          </div>
          <div style={{ position: "relative" }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--pro-text-muted)", display: "block", marginBottom: 5 }}>關聯病患（選填）</label>
            {selectedPatient ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, color: "var(--pro-text)", flex: 1 }}>{selectedPatient.full_name}</span>
                <button onClick={() => setSelectedPatient(null)} className="pro-btn-ghost" style={{ padding: "4px 8px", fontSize: 11 }}>移除</button>
              </div>
            ) : (
              <>
                <input className="pro-input" value={patientSearch} onChange={e => setPatientSearch(e.target.value)} placeholder="搜尋病患..." onFocus={() => patientSearch && setShowPatientList(true)} />
                {showPatientList && patients.length > 0 && (
                  <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "var(--pro-card)", border: "1px solid var(--pro-border)", borderRadius: 7, zIndex: 50, overflow: "hidden" }}>
                    {patients.map(p => (
                      <div key={p.id} onClick={() => { setSelectedPatient(p); setPatientSearch(""); setShowPatientList(false); }}
                        style={{ padding: "9px 12px", cursor: "pointer", fontSize: 13, color: "var(--pro-text)", borderBottom: "1px solid var(--pro-border)" }}
                        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "var(--pro-card-hover)"}
                        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}>
                        {p.full_name}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <SOAPEditor
        values={soap}
        onChange={(k, v) => setSoap(prev => ({ ...prev, [k]: v }))}
        onAiAssist={handleAiAssist}
        aiLoading={aiLoading}
        aiSuggestion={aiSuggestion}
        aiError={aiError}
        onDismissAi={() => setAiSuggestion("")}
      />
    </div>
  );
}
