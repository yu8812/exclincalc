"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Clock, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase";
import SOAPEditor from "@/components/pro/SOAPEditor";
import { askClinicalAi } from "@/lib/pro/askAi";

interface NoteData {
  id: string; title: string | null; draft: boolean;
  subjective: string | null; objective: string | null;
  assessment: string | null; plan: string | null;
  patient_id: string | null; updated_at: string;
  doctor_patients: { full_name: string } | null;
}

export default function EditNotePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [note, setNote] = useState<NoteData | null>(null);
  const [title, setTitle] = useState("");
  const [soap, setSoap] = useState({ subjective: "", objective: "", assessment: "", plan: "" });
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState("");
  const [aiError, setAiError] = useState("");

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data } = await supabase.from("soap_notes")
        .select("*, doctor_patients(full_name)")
        .eq("id", id).single();
      if (data) {
        setNote(data as NoteData);
        setTitle(data.title || "");
        setSoap({
          subjective: data.subjective || "",
          objective: data.objective || "",
          assessment: data.assessment || "",
          plan: data.plan || "",
        });
      }
    };
    load();
  }, [id]);

  const handleSave = async (asDraft?: boolean) => {
    setSaving(true);
    const supabase = createClient();
    await supabase.from("soap_notes").update({
      title: title || null,
      subjective: soap.subjective || null,
      objective: soap.objective || null,
      assessment: soap.assessment || null,
      plan: soap.plan || null,
      draft: asDraft ?? note?.draft ?? true,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    setLastSaved(new Date());
    setSaving(false);
    if (asDraft === false) router.push("/pro/notes");
  };

  const handleDelete = async () => {
    if (!confirm("確定刪除此筆記？")) return;
    const supabase = createClient();
    await supabase.from("soap_notes").delete().eq("id", id);
    router.push("/pro/notes");
  };

  const handleAiAssist = async (context: string) => {
    setAiLoading(true);
    setAiError("");
    const r = await askClinicalAi({ soapDraft: context, symptoms: soap.subjective });
    if (r.ok) setAiSuggestion(r.text);
    else setAiError(r.message);
    setAiLoading(false);
  };

  if (!note) return <div style={{ color: "var(--pro-text-muted)", padding: 40 }}>載入中...</div>;

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <Link href="/pro/notes" className="pro-btn-ghost" style={{ padding: "7px 10px" }}>
          <ArrowLeft size={15} />
        </Link>
        <div style={{ flex: 1 }}>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="筆記標題"
            style={{ fontSize: 18, fontWeight: 700, color: "var(--pro-text)", background: "none", border: "none", outline: "none", width: "100%" }}
          />
          {note.doctor_patients?.full_name && (
            <div style={{ fontSize: 12, color: "var(--pro-text-muted)", marginTop: 2 }}>
              病患：{note.doctor_patients.full_name}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {lastSaved && (
            <span style={{ fontSize: 11, color: "var(--pro-text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
              <Clock size={11} /> 已儲存 {lastSaved.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button onClick={handleDelete} className="pro-btn-danger" style={{ padding: "7px 10px" }}>
            <Trash2 size={13} />
          </button>
          <button onClick={() => handleSave(true)} className="pro-btn-ghost" disabled={saving}>儲存草稿</button>
          <button onClick={() => handleSave(false)} className="pro-btn-primary" disabled={saving}>
            <Save size={14} /> {saving ? "儲存中..." : "完成"}
          </button>
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
