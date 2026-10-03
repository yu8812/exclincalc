"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { REFERENCE_RANGES } from "@/lib/referenceRanges";
import { adminDataRequest } from "@/lib/pro/errorText";
import AdminDataTable, { type ColumnDef } from "@/components/pro/AdminDataTable";

interface MedReference {
  id: string;
  key: string;
  label_zh: string;
  label_en: string;
  unit: string;
  explanation_zh: string;
  normal_general: Record<string, number> | null;
  normal_male: Record<string, number> | null;
  normal_female: Record<string, number> | null;
  warning_high: number | null;
  warning_low: number | null;
  category: string;
  source: string | null;
}

const COLUMNS: ColumnDef<MedReference>[] = [
  { key: "key", label: "Key", editable: true, width: 120 },
  { key: "label_zh", label: "中文名稱", editable: true },
  { key: "label_en", label: "英文名稱", editable: true },
  { key: "unit", label: "單位", editable: true, width: 80 },
  { key: "category", label: "分類", editable: true, width: 90 },
  { key: "warning_high", label: "危急高值", editable: true, type: "number", width: 80 },
  { key: "warning_low", label: "危急低值", editable: true, type: "number", width: 80 },
  {
    key: "source", label: "來源", editable: true, width: 140,
    render: (row) => row.source ? (
      row.source.startsWith("http") ? (
        <a href={row.source} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
          style={{ color: "var(--pro-accent)", fontSize: 12, textDecoration: "none" }}>
          🔗 連結
        </a>
      ) : (
        <Link href={`/pro/references?q=${encodeURIComponent(row.source)}`} onClick={e => e.stopPropagation()}
          style={{ color: "var(--pro-accent)", fontSize: 12, textDecoration: "none" }}>
          {row.source}
        </Link>
      )
    ) : null,
  },
  { key: "explanation_zh", label: "說明", editable: true, type: "textarea", modalOnly: true },
];

export default function AdminReferencesPage() {
  const [refs, setRefs] = useState<MedReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newRef, setNewRef] = useState<Partial<MedReference>>({});
  const [formSaving, setFormSaving] = useState(false);

  const load = async () => {
    const supabase = createClient();
    const { data } = await supabase.from("medical_references").select("*").order("category").order("label_zh");
    setRefs((data as MedReference[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (row: MedReference) => {
    const err = await adminDataRequest("PUT", { table: "medical_references", row });
    if (err) alert(err);
    await load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("確定刪除這筆參考值？刪了就救不回來。")) return;
    const err = await adminDataRequest("DELETE", { table: "medical_references", id });
    if (err) alert(err);
    await load();
  };

  const syncFromLocal = async () => {
    setSyncing(true);
    let firstError: string | null = null;
    for (const ref of REFERENCE_RANGES) {
      const err = await adminDataRequest("POST", {
        table: "medical_references",
        upsert: true,
        row: {
          key: ref.key,
          label_zh: ref.label_zh,
          label_en: ref.label_en,
          unit: ref.unit,
          explanation_zh: ref.explanation_zh,
          normal_general: ref.normal.general || null,
          normal_male: ref.normal.male || null,
          normal_female: ref.normal.female || null,
          warning_high: ref.warning_high ?? null,
          warning_low: ref.warning_low ?? null,
          category: ref.category,
          source: ref.source || null,
        },
      });
      if (err) { firstError = err; break; }   // 第一筆就被拒（例如展示帳號），後面不用再試
    }
    if (firstError) alert(firstError);
    await load();
    setSyncing(false);
  };

  const handleSubmitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSaving(true);
    const err = await adminDataRequest("POST", { table: "medical_references", row: newRef });
    if (err) {
      alert(err);
    } else {
      await load();
      setShowForm(false);
      setNewRef({});
    }
    setFormSaving(false);
  };

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--pro-text)" }}>參考值資料庫管理</h1>
          <p style={{ fontSize: 13, color: "var(--pro-text-muted)", marginTop: 2 }}>共 {refs.length} 筆參考值</p>
        </div>
        <button className="pro-btn-ghost" onClick={syncFromLocal} disabled={syncing}>
          <RefreshCw size={13} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
          {syncing ? "同步中..." : "從本地同步"}
        </button>
      </div>

      <div className="pro-card" style={{ padding: 14, marginBottom: 20, fontSize: 12, color: "var(--pro-text-muted)" }}>
        💡 「從本地同步」會將 <code>referenceRanges.ts</code> 的資料 upsert 到資料庫。資料庫為 null 時使用本地資料做為備用來源。
      </div>

      {showForm && (
        <div className="pro-card" style={{ padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--pro-text)", marginBottom: 16 }}>新增參考值</div>
          <form onSubmit={handleSubmitNew}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              {[
                { key: "key", label: "Key*", required: true },
                { key: "label_zh", label: "中文名稱*", required: true },
                { key: "label_en", label: "英文名稱*", required: true },
                { key: "unit", label: "單位*", required: true },
                { key: "category", label: "分類*", required: true },
                { key: "source", label: "來源" },
              ].map(({ key, label, required }) => (
                <div key={key}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--pro-text-muted)", display: "block", marginBottom: 4 }}>{label}</label>
                  <input className="pro-input" required={required} value={String(newRef[key as keyof MedReference] || "")}
                    onChange={e => setNewRef(prev => ({ ...prev, [key]: e.target.value }))} />
                </div>
              ))}
              {[
                { key: "warning_high", label: "危急高值" },
                { key: "warning_low", label: "危急低值" },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--pro-text-muted)", display: "block", marginBottom: 4 }}>{label}</label>
                  <input className="pro-input" type="number" value={String(newRef[key as keyof MedReference] || "")}
                    onChange={e => setNewRef(prev => ({ ...prev, [key]: e.target.value ? Number(e.target.value) : null }))} />
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--pro-text-muted)", display: "block", marginBottom: 4 }}>說明（中文）*</label>
              <textarea className="pro-input" required rows={2} value={String(newRef.explanation_zh || "")}
                onChange={e => setNewRef(prev => ({ ...prev, explanation_zh: e.target.value }))} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="pro-btn-ghost" onClick={() => setShowForm(false)}>取消</button>
              <button type="submit" className="pro-btn-primary" disabled={formSaving}>
                {formSaving ? "新增中..." : "新增參考值"}
              </button>
            </div>
          </form>
        </div>
      )}

      <AdminDataTable<MedReference>
        columns={COLUMNS}
        data={refs}
        onSave={handleSave}
        onDelete={handleDelete}
        onAdd={() => setShowForm(true)}
        searchKeys={["key", "label_zh", "label_en", "category"]}
        loading={loading}
        groupBy={(row) => row.category}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
