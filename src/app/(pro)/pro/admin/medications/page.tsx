"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { adminDataRequest } from "@/lib/pro/errorText";
import AdminDataTable, { type ColumnDef } from "@/components/pro/AdminDataTable";

interface Medication {
  id: string;
  name_zh: string;
  name_en: string;
  generic_name: string | null;
  category: string;
  uses_zh: string;
  side_effects_zh: string | null;
  common_dosage: string | null;
  warnings_zh: string | null;
  interactions: string[] | null;
  prescription_required: boolean;
  source: string | null;
}

const COLUMNS: ColumnDef<Medication>[] = [
  {
    key: "id", label: "No.", width: 44,
    render: (_row, index) => (
      <span style={{ fontSize: 11, color: "var(--pro-text-muted)", fontVariantNumeric: "tabular-nums" }}>
        {index + 1}
      </span>
    ),
  },
  {
    key: "prescription_required", label: "類型",
    render: (row) => (
      <span style={{
        padding: "2px 7px", borderRadius: 4, fontSize: 11, fontWeight: 600,
        background: row.prescription_required ? "rgba(239,68,68,0.1)" : "rgba(16,185,129,0.1)",
        color: row.prescription_required ? "#ef4444" : "#10b981",
      }}>
        {row.prescription_required ? "處方" : "OTC"}
      </span>
    ),
    editable: true, type: "boolean", width: 70,
  },
  { key: "name_zh", label: "中文名", editable: true },
  { key: "name_en", label: "英文名", editable: true },
  { key: "generic_name", label: "學名", editable: true },
  { key: "category", label: "分類", editable: true },
  { key: "common_dosage", label: "常見劑量", editable: true },
  {
    key: "source", label: "資料來源", editable: true, width: 130,
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
  { key: "uses_zh", label: "用途", editable: true, type: "textarea", modalOnly: true },
  { key: "side_effects_zh", label: "副作用", editable: true, type: "textarea", modalOnly: true },
  { key: "warnings_zh", label: "警告", editable: true, type: "textarea", modalOnly: true },
];

export default function AdminMedicationsPage() {
  const [meds, setMeds] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newMed, setNewMed] = useState<Partial<Medication>>({ prescription_required: true });
  const [formSaving, setFormSaving] = useState(false);

  const load = async () => {
    const supabase = createClient();
    const { data } = await supabase.from("medications").select("*")
      .order("prescription_required", { ascending: false })
      .order("name_zh");
    setMeds((data as Medication[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (row: Medication) => {
    const err = await adminDataRequest("PUT", { table: "medications", row });
    if (err) alert(err);
    await load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("確定刪除這筆藥物資料？刪了就救不回來。")) return;
    const err = await adminDataRequest("DELETE", { table: "medications", id });
    if (err) alert(err);
    await load();
  };

  const handleAdd = () => setShowForm(true);

  const handleSubmitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSaving(true);
    const err = await adminDataRequest("POST", { table: "medications", row: newMed });
    if (err) {
      alert(err);
    } else {
      await load();
      setShowForm(false);
      setNewMed({ prescription_required: true });
    }
    setFormSaving(false);
  };

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--pro-text)" }}>藥物資料庫管理</h1>
        <p style={{ fontSize: 13, color: "var(--pro-text-muted)", marginTop: 2 }}>共 {meds.length} 筆藥物記錄</p>
      </div>

      {showForm && (
        <div className="pro-card" style={{ padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--pro-text)", marginBottom: 16 }}>新增藥物</div>
          <form onSubmit={handleSubmitNew}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              {[
                { key: "name_zh", label: "中文名*", required: true },
                { key: "name_en", label: "英文名*", required: true },
                { key: "generic_name", label: "學名" },
                { key: "category", label: "分類*", required: true },
                { key: "common_dosage", label: "常見劑量" },
                { key: "source", label: "資料來源（名稱或 URL）" },
              ].map(({ key, label, required }) => (
                <div key={key}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--pro-text-muted)", display: "block", marginBottom: 4 }}>{label}</label>
                  <input className="pro-input" required={required} value={String(newMed[key as keyof Medication] || "")}
                    onChange={e => setNewMed(prev => ({ ...prev, [key]: e.target.value }))} />
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 20 }}>
                <input type="checkbox" id="prx" checked={newMed.prescription_required || false}
                  onChange={e => setNewMed(prev => ({ ...prev, prescription_required: e.target.checked }))} />
                <label htmlFor="prx" style={{ fontSize: 12, color: "var(--pro-text)" }}>需處方箋</label>
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--pro-text-muted)", display: "block", marginBottom: 4 }}>用途（中文）*</label>
              <textarea className="pro-input" required rows={2} value={String(newMed.uses_zh || "")}
                onChange={e => setNewMed(prev => ({ ...prev, uses_zh: e.target.value }))} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--pro-text-muted)", display: "block", marginBottom: 4 }}>副作用</label>
              <textarea className="pro-input" rows={2} value={String(newMed.side_effects_zh || "")}
                onChange={e => setNewMed(prev => ({ ...prev, side_effects_zh: e.target.value }))} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="pro-btn-ghost" onClick={() => setShowForm(false)}>取消</button>
              <button type="submit" className="pro-btn-primary" disabled={formSaving}>
                {formSaving ? "新增中..." : "新增藥物"}
              </button>
            </div>
          </form>
        </div>
      )}

      <AdminDataTable<Medication>
        columns={COLUMNS}
        data={meds}
        onSave={handleSave}
        onDelete={handleDelete}
        onAdd={handleAdd}
        searchKeys={["name_zh", "name_en", "generic_name", "category"]}
        loading={loading}
        groupBy={(row) => row.prescription_required ? "處方（Rx）" : "OTC 成藥"}
      />
    </div>
  );
}
