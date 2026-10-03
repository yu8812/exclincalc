"use client";

import { useEffect, useState } from "react";
import {
  FlaskConical, Search, AlertTriangle, Pill,
  ShieldAlert, CheckCircle, Package, RefreshCw, Clock, Phone,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import Link from "next/link";

interface Medication {
  id: string; name_zh: string; name_en: string; generic_name: string | null;
  category: string; uses_zh: string; side_effects_zh: string | null;
  common_dosage: string | null; warnings_zh: string | null;
  interactions: string[] | null; prescription_required: boolean; source: string | null;
}

interface PrescriptionRecord {
  id: string;
  visit_date: string;
  chief_complaint: string | null;
  assessment: string | null;
  prescriptions: PrescriptionItem[];
  dispensed_at: string | null;
  patient_name: string | null;
  patient_sex: string | null;
  patient_birth_date: string | null;   // 交藥時核對身分用
}

const SEX_LABEL: Record<string, string> = { M: "男", F: "女", Other: "其他" };

function patientIdLine(r: PrescriptionRecord): string {
  const parts: string[] = [];
  if (r.patient_sex) parts.push(SEX_LABEL[r.patient_sex] ?? r.patient_sex);
  if (r.patient_birth_date) parts.push(r.patient_birth_date.replaceAll("-", "/"));
  return parts.join("・");
}

interface PrescriptionItem {
  drug: string; generic: string; dose: string;
  frequency: string; route: string; note?: string; nhiCode?: string;
  days?: number;          // 預計使用天數
  dispensed?: boolean;
}

export default function PharmacyPage() {
  const [tab, setTab] = useState<"dispense" | "reference">("dispense");
  const [meds, setMeds] = useState<Medication[]>([]);
  const [medsLoading, setMedsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Medication | null>(null);
  const [filterRx, setFilterRx] = useState<"all" | "rx" | "otc">("all");

  // Dispensing state
  const [pendingRx, setPendingRx] = useState<PrescriptionRecord[]>([]);
  const [dispensedRx, setDispensedRx] = useState<PrescriptionRecord[]>([]);
  const [rxLoading, setRxLoading] = useState(true);
  const [dispensing, setDispensing] = useState<string | null>(null);
  const [showDispensed, setShowDispensed] = useState(false);

  const [dispenseError, setDispenseError] = useState("");
  const [loadError, setLoadError] = useState("");

  const supabase = createClient();

  const loadMeds = async () => {
    setMedsLoading(true);
    const { data } = await supabase.from("medications").select("*").order("name_zh");
    setMeds((data as Medication[]) || []);
    setMedsLoading(false);
  };

  const loadPrescriptions = async () => {
    setRxLoading(true);
    // 用 local date 格式（與畫面顯示一致），避免 UTC 時差導致跨日漏資料
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    // 藥師讀不到整張病人表（有身分證、電話），所以用 pharmacy_queue() 只拿姓名、性別、生日（migration 17）
    const { data, error } = await supabase.rpc("pharmacy_queue", { p_visit_date: today });
    setLoadError(error ? "處方清單載入不了，請按「刷新」再試一次。" : "");
    if (!error) {
      const records = (data ?? []) as PrescriptionRecord[];
      setPendingRx(records.filter(r => !r.dispensed_at));
      setDispensedRx(records.filter(r => !!r.dispensed_at));
    }
    setRxLoading(false);
  };

  useEffect(() => {
    loadPrescriptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "reference" && meds.length === 0) loadMeds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // 藥師不能改處方內容（醫囑）：資料庫 trigger 會直接擋下（migration 07）。
  // 以前這頁有「修改處方」，存檔時被擋卻照樣顯示成功，重新整理後修改就默默消失了，所以拿掉。
  // 真實流程也是這樣：處方有疑問要回頭問開立的醫師。
  const dispense = async (record: PrescriptionRecord) => {
    const items = (record.prescriptions || [])
      .map(rx => `• ${rx.drug}${rx.dose ? ` ${rx.dose}` : ""} ${rx.frequency}，${rx.days ?? 7} 天`)
      .join("\n");
    const who = record.patient_name ?? "這位病人";
    const idLine = patientIdLine(record);
    if (!confirm(`確認已經把下面的藥交給 ${who}${idLine ? `（${idLine}）` : ""}？\n\n${items}\n\n交藥前請先核對姓名和生日。按下確定後，系統會記錄是你在這個時間調配的。`)) return;

    setDispensing(record.id);
    setDispenseError("");
    // dispensed_by 由資料庫依登入的人自動填（migration 12），前端不用、也不能指定。
    // 加上 dispensed_at is null：兩位藥師同時按時，只有第一位會成功，不會互相蓋掉時間。
    const { data, error } = await supabase.from("clinical_records")
      .update({ dispensed_at: new Date().toISOString() })
      .eq("id", record.id)
      .is("dispensed_at", null)
      .select("id");
    if (error) {
      setDispenseError(`${who}這筆沒有存成功，還在待調配。請重新整理後再試一次；一直失敗的話請找系統管理員。`);
    } else if (!data?.length) {
      setDispenseError(`${who}這筆可能剛被其他藥師調配了，畫面已經重新整理。`);
    }
    await loadPrescriptions();
    setDispensing(null);
  };

  const filtered = meds.filter(m => {
    const matchRx = filterRx === "all" || (filterRx === "rx" ? m.prescription_required : !m.prescription_required);
    const q = search.toLowerCase();
    return matchRx && (!q ||
      m.name_zh.toLowerCase().includes(q) || m.name_en.toLowerCase().includes(q) ||
      (m.generic_name?.toLowerCase().includes(q) ?? false) || m.category.toLowerCase().includes(q));
  });

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--pro-text)", display: "flex", alignItems: "center", gap: 8 }}>
          <FlaskConical size={20} color="#f59e0b" /> 藥師工作台
        </h1>
        <p style={{ fontSize: 12, color: "var(--pro-text-muted)", marginTop: 3 }}>
          處方調配 · 藥物查詢 · 交互作用核對
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "2px solid var(--pro-border)", marginBottom: 20, gap: 0 }}>
        {[
          { key: "dispense", label: "待調配", badge: pendingRx.length },
          { key: "reference", label: "藥物查詢" },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as typeof tab)} style={{
            padding: "10px 20px", background: "none", border: "none", cursor: "pointer",
            fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6,
            borderBottom: tab === t.key ? "2px solid var(--pro-accent)" : "2px solid transparent",
            color: tab === t.key ? "var(--pro-accent)" : "var(--pro-text-muted)",
            marginBottom: -2,
          }}>
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span style={{
                fontSize: 10, padding: "1px 7px", borderRadius: 20,
                background: "var(--pro-accent)", color: "#fff",
              }}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ─── TAB: Dispensing ─── */}
      {tab === "dispense" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <p style={{ fontSize: 13, color: "var(--pro-text-muted)" }}>
              今日需調配處方 — {new Date().toLocaleDateString("zh-TW")}
            </p>
            <button onClick={loadPrescriptions} style={{
              display: "flex", alignItems: "center", gap: 5, padding: "6px 12px",
              borderRadius: 7, border: "1px solid var(--pro-border)",
              background: "var(--pro-surface)", color: "var(--pro-text-muted)",
              cursor: "pointer", fontSize: 12,
            }}>
              <RefreshCw size={12} /> 刷新
            </button>
          </div>

          {loadError && (
            <div role="alert" style={{
              marginBottom: 12, padding: "10px 14px", borderRadius: 8, fontSize: 12,
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--pro-danger)",
            }}>
              {loadError}
            </div>
          )}

          {dispenseError && (
            <div role="alert" style={{
              marginBottom: 12, padding: "10px 14px", borderRadius: 8, fontSize: 12,
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--pro-danger)",
            }}>
              {dispenseError}
            </div>
          )}

          {rxLoading ? (
            <p style={{ color: "var(--pro-text-muted)", fontSize: 13, padding: "20px 0" }}>載入中…</p>
          ) : pendingRx.length === 0 ? (
            <div style={{
              textAlign: "center", padding: "50px 0",
              border: "1px dashed var(--pro-border)", borderRadius: 10,
              color: "var(--pro-text-muted)",
            }}>
              <Package size={36} style={{ opacity: 0.3, marginBottom: 10 }} />
              <p style={{ fontSize: 14, fontWeight: 600 }}>今日無待調配處方</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>醫師開立的處方會自動出現在此</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {pendingRx.map(record => (
                <div key={record.id} style={{
                  background: "var(--pro-surface)", border: "2px solid rgba(245,158,11,0.3)",
                  borderRadius: 10, padding: 16,
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: "var(--pro-text)" }}>
                          {record.patient_name ?? "未知病患"}
                        </span>
                        {patientIdLine(record) && (
                          <span style={{ fontSize: 12, color: "var(--pro-text-muted)" }}>{patientIdLine(record)}</span>
                        )}
                        <span style={{
                          fontSize: 10, padding: "2px 8px", borderRadius: 10,
                          background: "rgba(245,158,11,0.15)", color: "#f59e0b", fontWeight: 600,
                        }}>
                          待調配
                        </span>
                      </div>
                      {record.chief_complaint && (
                        <p style={{ fontSize: 12, color: "var(--pro-text-muted)", marginTop: 3 }}>
                          主訴：{record.chief_complaint}
                        </p>
                      )}
                      {record.assessment && (
                        <p style={{ fontSize: 11, color: "var(--pro-text-muted)", marginTop: 2 }}>
                          診斷：{record.assessment}
                        </p>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <button
                        onClick={() => dispense(record)}
                        disabled={dispensing === record.id}
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "8px 16px", borderRadius: 8, border: "none",
                          background: dispensing === record.id ? "#4b5563" : "#22c55e",
                          color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
                        }}>
                        <CheckCircle size={14} />
                        {dispensing === record.id ? "記錄中…" : "完成調配"}
                      </button>
                    </div>
                  </div>

                  {/* Prescription items */}
                  <div style={{ background: "var(--pro-bg)", borderRadius: 7, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--pro-border)" }}>
                          {["藥物", "學名", "劑量", "頻次", "途徑", "天數", "備註"].map((h, idx) => (
                            <th key={idx} style={{
                              padding: "7px 10px", textAlign: "left", fontWeight: 600,
                              color: "var(--pro-text-muted)", fontSize: 11,
                            }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(record.prescriptions as PrescriptionItem[]).map((rx, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid var(--pro-border)" }}>
                            <td style={{ padding: "8px 10px", fontWeight: 600, color: "var(--pro-text)" }}>{rx.drug}</td>
                            <td style={{ padding: "8px 10px", color: "var(--pro-text-muted)" }}>{rx.generic}</td>
                            <td style={{ padding: "8px 10px", color: "var(--pro-text)" }}>{rx.dose}</td>
                            <td style={{ padding: "8px 10px", color: "var(--pro-text)" }}>{rx.frequency}</td>
                            <td style={{ padding: "8px 10px", color: "var(--pro-text-muted)" }}>{rx.route}</td>
                            <td style={{ padding: "8px 10px", color: "var(--pro-accent)", fontWeight: 600 }}>{rx.days ?? 7} 天</td>
                            <td style={{ padding: "8px 10px", color: "#f59e0b", fontSize: 11 }}>{rx.note || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--pro-text-muted)", marginTop: 8 }}>
                    <Phone size={11} /> 處方有疑問時請先聯絡開立的醫師；醫師改好後按「刷新」就會看到新的處方。
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Already dispensed section */}
          {dispensedRx.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <button
                onClick={() => setShowDispensed(!showDispensed)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, background: "none", border: "none",
                  cursor: "pointer", fontSize: 12, color: "var(--pro-text-muted)", padding: 0, marginBottom: 10,
                }}>
                <Clock size={13} /> 今日已調配 ({dispensedRx.length}) {showDispensed ? "▲" : "▼"}
              </button>
              {showDispensed && dispensedRx.map(record => (
                <div key={record.id} style={{
                  background: "var(--pro-surface)", border: "1px solid var(--pro-border)",
                  borderRadius: 10, padding: 14, marginBottom: 8, opacity: 0.8,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <CheckCircle size={14} color="#22c55e" />
                    <span style={{ fontWeight: 600, fontSize: 13, color: "var(--pro-text)" }}>
                      {record.patient_name ?? "—"}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--pro-text-muted)" }}>
                      已於 {record.dispensed_at ? new Date(record.dispensed_at).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }) : "—"} 調配
                    </span>
                    <span style={{ fontSize: 11, color: "var(--pro-text-muted)" }}>
                      共 {record.prescriptions.length} 項藥品
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB: Drug Reference ─── */}
      {tab === "reference" && (
        <div>
          {/* Stats */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            {[
              { label: "藥物總數", value: meds.length, color: "#6366f1", icon: <Pill size={15} /> },
              { label: "處方藥（Rx）", value: meds.filter(m => m.prescription_required).length, color: "#ef4444", icon: <ShieldAlert size={15} /> },
              { label: "成藥（OTC）", value: meds.filter(m => !m.prescription_required).length, color: "#22c55e", icon: <CheckCircle size={15} /> },
            ].map(({ label, value, color, icon }) => (
              <div key={label} className="pro-card" style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, flex: "1 1 140px" }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: color + "18", display: "flex", alignItems: "center", justifyContent: "center", color }}>{icon}</div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "var(--pro-text)" }}>{value}</div>
                  <div style={{ fontSize: 11, color: "var(--pro-text-muted)" }}>{label}</div>
                </div>
              </div>
            ))}
            <Link href="/pro/drugs" className="pro-card" style={{
              padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, flex: "1 1 140px",
              textDecoration: "none", border: "1px dashed var(--pro-border)",
            }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(245,158,11,0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: "#f59e0b" }}>
                <AlertTriangle size={15} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)" }}>交互作用</div>
                <div style={{ fontSize: 11, color: "var(--pro-accent)" }}>前往檢查 →</div>
              </div>
            </Link>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 360px" : "1fr", gap: 16 }}>
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
                  <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--pro-text-muted)", pointerEvents: "none" }} />
                  <input className="pro-input" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="搜尋藥名（中文 / 英文 / 學名 / 分類）..."
                    style={{ paddingLeft: 32, width: "100%" }} />
                </div>
                <div style={{ display: "flex", gap: 4, background: "var(--pro-bg)", border: "1px solid var(--pro-border)", borderRadius: 8, padding: 3 }}>
                  {(["all", "rx", "otc"] as const).map(f => (
                    <button key={f} onClick={() => setFilterRx(f)} style={{
                      padding: "4px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                      background: filterRx === f ? "var(--pro-accent)" : "transparent",
                      color: filterRx === f ? "#fff" : "var(--pro-text-muted)",
                    }}>
                      {f === "all" ? "全部" : f === "rx" ? "Rx" : "OTC"}
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: 12, color: "var(--pro-text-muted)", alignSelf: "center" }}>{filtered.length} 筆</span>
              </div>

              <div style={{ borderRadius: 10, border: "1px solid var(--pro-border)", overflow: "hidden" }}>
                {medsLoading && <div style={{ padding: 32, textAlign: "center", color: "var(--pro-text-muted)" }}>載入中...</div>}
                {!medsLoading && filtered.length === 0 && <div style={{ padding: 32, textAlign: "center", color: "var(--pro-text-muted)" }}>無符合藥物</div>}
                {filtered.map((m, i) => (
                  <div key={m.id} onClick={() => setSelected(prev => prev?.id === m.id ? null : m)} style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                    borderBottom: i < filtered.length - 1 ? "1px solid var(--pro-border)" : "none",
                    background: selected?.id === m.id ? "var(--pro-accent-dim)" : "var(--pro-sidebar)",
                    cursor: "pointer",
                  }}>
                    <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, flexShrink: 0,
                      background: m.prescription_required ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)",
                      color: m.prescription_required ? "#ef4444" : "#22c55e" }}>
                      {m.prescription_required ? "Rx" : "OTC"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--pro-text)" }}>{m.name_zh}</div>
                      <div style={{ fontSize: 11, color: "var(--pro-text-muted)", marginTop: 1 }}>
                        {m.name_en}{m.generic_name ? ` · ${m.generic_name}` : ""}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--pro-text-muted)", flexShrink: 0 }}>{m.category}</div>
                    {m.interactions && m.interactions.length > 0 && <AlertTriangle size={12} color="#f59e0b" />}
                  </div>
                ))}
              </div>
            </div>

            {selected && (
              <div className="pro-card" style={{ padding: 20, height: "fit-content", position: "sticky", top: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "var(--pro-text)" }}>{selected.name_zh}</div>
                    <div style={{ fontSize: 12, color: "var(--pro-text-muted)", marginTop: 2 }}>{selected.name_en}{selected.generic_name ? ` (${selected.generic_name})` : ""}</div>
                  </div>
                  <span style={{ padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 700, height: "fit-content",
                    background: selected.prescription_required ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)",
                    color: selected.prescription_required ? "#ef4444" : "#22c55e" }}>
                    {selected.prescription_required ? "Rx" : "OTC"}
                  </span>
                </div>
                {[
                  { label: "適應症", value: selected.uses_zh },
                  { label: "常見劑量", value: selected.common_dosage },
                  { label: "副作用", value: selected.side_effects_zh },
                  { label: "警告", value: selected.warnings_zh, danger: true },
                ].map(({ label, value, danger }) => value ? (
                  <div key={label} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: danger ? "var(--pro-danger)" : "var(--pro-text-muted)", marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 13, color: "var(--pro-text)", lineHeight: 1.6 }}>{value}</div>
                  </div>
                ) : null)}
                {selected.interactions && selected.interactions.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
                      <AlertTriangle size={11} /> 交互作用（{selected.interactions.length}）
                    </div>
                    {selected.interactions.map(i => (
                      <div key={i} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 5, marginBottom: 3, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "var(--pro-text)" }}>{i}</div>
                    ))}
                  </div>
                )}
                <Link href={`/pro/drugs?q=${encodeURIComponent(selected.name_en)}`} style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px",
                  borderRadius: 7, background: "rgba(245,158,11,0.1)", color: "#f59e0b",
                  textDecoration: "none", fontSize: 13, fontWeight: 600, marginTop: 10,
                  border: "1px solid rgba(245,158,11,0.2)",
                }}>
                  <AlertTriangle size={13} /> 開啟交互作用檢查
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
