"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, X, ExternalLink, Search, BookOpen, Globe, FileText, Play, Bookmark, BookMarked, Copy, Trash2, RefreshCw, ArrowUpCircle, LayoutGrid, List, ChevronDown, ChevronUp, Star } from "lucide-react";
import { createClient } from "@/lib/supabase";

interface Resource {
  id: string;
  title: string;
  author: string | null;
  year: string | null;
  category: string;
  cover_url: string | null;
  url: string | null;
  description: string | null;
  source: string | null;
  tags: string[];
  is_public: boolean;
  created_by: string | null;
}

interface UpdateResult {
  resourceId: string | null;
  currentTitle: string | null;
  currentYear: string | null;
  latestYear: string;
  latestTitle: string;
  latestUrl: string;
  source: string;
  changeNote: string;
  category: string;
}

const CATEGORIES = ["全部", "書籍", "指引", "文章", "網站", "影音"];

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  書籍: <BookOpen size={14} />,
  指引: <FileText size={14} />,
  文章: <FileText size={14} />,
  網站: <Globe size={14} />,
  影音: <Play size={14} />,
};

const CATEGORY_COLORS: Record<string, string> = {
  書籍: "#3b82f6",
  指引: "#22c55e",
  文章: "#a855f7",
  網站: "#f59e0b",
  影音: "#ef4444",
};

const EMPTY_FORM = {
  title: "", author: "", year: "", category: "書籍",
  cover_url: "", url: "", description: "", source: "", tags: "",
  is_public: false,
};

export default function ReferencesPage() {
  const searchParams = useSearchParams();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("全部");
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [showForm, setShowForm] = useState(false);
  const [viewMode, setViewMode] = useState<"cards" | "list">("cards");
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [showUpdates, setShowUpdates] = useState(false);
  const [updateResults, setUpdateResults] = useState<UpdateResult[] | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // Favorites（前端本機儲存：每個帳號各自的 starred 列表）
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const FAV_KEY = "pro_ref_favorites_v1";

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      if (raw) setFavIds(new Set(JSON.parse(raw)));
    } catch { /* noop */ }
  }, []);

  const toggleFav = (id: string) => {
    setFavIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(FAV_KEY, JSON.stringify([...next])); } catch { /* noop */ }
      return next;
    });
  };

  // 預設置頂：第一次載入時把 ADA / KDIGO / ACC/AHA 等指引自動標 fav
  useEffect(() => {
    if (resources.length === 0) return;
    const initialized = localStorage.getItem(FAV_KEY + "_init");
    if (initialized) return;
    const autoFav = new Set<string>();
    for (const r of resources) {
      const t = (r.title || "").toLowerCase();
      if (/(ada|kdigo|acc.aha|standards of care|clinical practice guideline)/i.test(t)) {
        autoFav.add(r.id);
      }
    }
    if (autoFav.size > 0) {
      setFavIds(prev => {
        const next = new Set([...prev, ...autoFav]);
        localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
        return next;
      });
    }
    localStorage.setItem(FAV_KEY + "_init", "1");
  }, [resources]);

  const load = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setCurrentUserId(user.id);
      const { data: prof } = await supabase.from("profiles").select("pro_role, is_demo").eq("id", user.id).single();
      // 展示用 admin 不能管理公開資源（資料庫也會擋），畫面上就當一般醫師
      setIsAdmin(["admin", "super_admin"].includes(prof?.pro_role ?? "") && prof?.is_demo !== true);
    }
    const { data } = await supabase
      .from("pro_resources")
      .select("*")
      .order("created_at", { ascending: false });
    setResources((data as Resource[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (showForm) setTimeout(() => titleRef.current?.focus(), 50); }, [showForm]);
  // Auto-scroll to search bar when arriving via ?q= link
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchParams.get("q")) setTimeout(() => searchRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
  }, []);

  const filtered = resources.filter(r => {
    const matchCat = activeCategory === "全部" || r.category === activeCategory;
    const q = search.toLowerCase();
    const matchSearch = !q || r.title.toLowerCase().includes(q) ||
      r.author?.toLowerCase().includes(q) ||
      r.source?.toLowerCase().includes(q) ||
      r.tags.some(t => t.toLowerCase().includes(q));
    return matchCat && matchSearch;
  }).sort((a, b) => {
    // 已收藏（星號）置頂
    const aFav = favIds.has(a.id);
    const bFav = favIds.has(b.id);
    if (aFav && !bFav) return -1;
    if (!aFav && bFav) return 1;
    return 0;
  });

  // Duplicate detection: group by normalized title
  const duplicateGroups = resources.reduce((acc, r) => {
    const key = r.title.toLowerCase().trim();
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {} as Record<string, Resource[]>);
  const dupGroups = Object.values(duplicateGroups).filter(g => g.length > 1);
  const totalDups = dupGroups.reduce((sum, g) => sum + g.length - 1, 0);

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const payload = {
      title: form.title.trim(),
      author: form.author || null,
      year: form.year || null,
      category: form.category,
      cover_url: form.cover_url || null,
      url: form.url || null,
      description: form.description || null,
      source: form.source || null,
      tags: form.tags ? form.tags.split(/[,，\s]+/).map(t => t.trim()).filter(Boolean) : [],
      is_public: isAdmin ? form.is_public : false,
      created_by: user.id,
    };
    const { error } = await supabase.from("pro_resources").insert(payload);
    setSaving(false);
    if (error) { alert("沒有存成功，請重新整理後再試一次。"); return; }
    setForm(EMPTY_FORM);
    setShowForm(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("確定刪除這筆資料？")) return;
    const supabase = createClient();
    // 被權限擋下時資料庫不會報錯、只會刪掉 0 筆，所以要看實際刪了幾筆
    const { data, error } = await supabase.from("pro_resources").delete().eq("id", id).select("id");
    if (error || !data?.length) { alert("這筆沒有刪掉：只有建立者或管理員可以刪除。"); return; }
    setResources(prev => prev.filter(r => r.id !== id));
  };

  const handleDeleteMany = async (ids: string[]) => {
    const supabase = createClient();
    const { data } = await supabase.from("pro_resources").delete().in("id", ids).select("id");
    const deleted = new Set((data ?? []).map(r => r.id as string));
    if (deleted.size < ids.length) alert(`有 ${ids.length - deleted.size} 筆沒有刪掉：只有建立者或管理員可以刪除。`);
    setResources(prev => prev.filter(r => !deleted.has(r.id)));
  };

  const handleUpdateCover = async (id: string, cover_url: string) => {
    const supabase = createClient();
    const { data } = await supabase.from("pro_resources").update({ cover_url: cover_url || null }).eq("id", id).select("id");
    if (!data?.length) { alert("封面沒有更新：只有建立者或管理員可以修改。"); return; }
    setResources(prev => prev.map(r => r.id === id ? { ...r, cover_url: cover_url || null } : r));
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    setShowUpdates(true);
    try {
      const res = await fetch("/api/pro/resources/check-updates");
      const data = await res.json();
      const all: UpdateResult[] = [...(data.updates || []), ...(data.missing || [])];
      setUpdateResults(all);
    } catch {
      setUpdateResults([]);
    }
    setCheckingUpdates(false);
  };

  const handleApplyUpdate = async (u: UpdateResult) => {
    if (!u.resourceId) return;
    setApplyingUpdate(u.resourceId);
    await fetch("/api/pro/resources/check-updates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceId: u.resourceId,
        latestTitle: u.latestTitle,
        latestYear: u.latestYear,
        latestUrl: u.latestUrl,
        source: u.source,
      }),
    });
    setApplyingUpdate(null);
    setUpdateResults(prev => prev ? prev.filter(r => r.resourceId !== u.resourceId) : prev);
    load();
  };

  return (
    <div style={{ maxWidth: 1000 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--pro-text)", display: "flex", alignItems: "center", gap: 8 }}>
            <BookMarked size={20} color="var(--pro-accent)" /> 臨床參考資料庫
          </h1>
          <p style={{ fontSize: 13, color: "var(--pro-text-muted)", marginTop: 3 }}>
            書籍、指引、文章、網站連結，統一管理隨時查閱
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {totalDups > 0 && (
            <button
              onClick={() => setShowDuplicates(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 14px", borderRadius: 7, border: "1px solid rgba(245,158,11,0.4)",
                background: showDuplicates ? "rgba(245,158,11,0.15)" : "transparent",
                color: "#f59e0b", cursor: "pointer", fontSize: 12, fontWeight: 600,
              }}
            >
              <Copy size={13} /> {totalDups} 筆重複
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => { setShowUpdates(v => !v); if (!showUpdates && updateResults === null) handleCheckUpdates(); }}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 14px", borderRadius: 7,
                border: `1px solid ${showUpdates ? "rgba(59,130,246,0.4)" : "var(--pro-border)"}`,
                background: showUpdates ? "var(--pro-accent-dim)" : "transparent",
                color: showUpdates ? "var(--pro-accent)" : "var(--pro-text-muted)",
                cursor: "pointer", fontSize: 12, fontWeight: 600,
              }}
            >
              <RefreshCw size={13} className={checkingUpdates ? "spin" : ""} />
              {checkingUpdates ? "檢查中..." : "版本更新"}
            </button>
          )}
          <button
            onClick={() => setShowForm(true)}
            className="pro-btn-primary"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <Plus size={14} /> 新增資料
          </button>
        </div>
      </div>

      {/* Updates panel */}
      {showUpdates && (
        <div style={{
          marginBottom: 20, padding: 16, borderRadius: 10,
          background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-accent)", display: "flex", alignItems: "center", gap: 6 }}>
              <ArrowUpCircle size={14} /> 版本更新檢查
            </div>
            <button
              onClick={handleCheckUpdates}
              disabled={checkingUpdates}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 5, border: "1px solid var(--pro-border)", background: "transparent", color: "var(--pro-text-muted)", cursor: "pointer", fontSize: 11 }}
            >
              <RefreshCw size={11} /> 重新檢查
            </button>
          </div>
          {checkingUpdates ? (
            <div style={{ fontSize: 13, color: "var(--pro-text-muted)", padding: "8px 0" }}>比對中...</div>
          ) : updateResults === null ? null : updateResults.length === 0 ? (
            <div style={{ fontSize: 13, color: "#22c55e", padding: "8px 0", display: "flex", alignItems: "center", gap: 6 }}>
              ✓ 所有已追蹤的指引均為最新版本
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {updateResults.map((u, i) => (
                <div key={u.resourceId ?? i} style={{
                  padding: "10px 14px", borderRadius: 7,
                  background: "var(--pro-bg)", border: "1px solid var(--pro-border)",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)" }}>
                          {u.latestTitle}
                        </span>
                        <span style={{ padding: "1px 7px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: "rgba(59,130,246,0.15)", color: "var(--pro-accent)" }}>
                          {u.latestYear}
                        </span>
                        {u.resourceId === null && (
                          <span style={{ padding: "1px 7px", borderRadius: 10, fontSize: 10, background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
                            未收錄
                          </span>
                        )}
                        {u.currentYear && u.currentYear < u.latestYear && (
                          <span style={{ padding: "1px 7px", borderRadius: 10, fontSize: 10, background: "rgba(239,68,68,0.12)", color: "#ef4444" }}>
                            目前 {u.currentYear} → 最新 {u.latestYear}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--pro-accent)", marginTop: 3 }}>{u.source}</div>
                      <div style={{ fontSize: 11, color: "var(--pro-text-muted)", marginTop: 3 }}>{u.changeNote}</div>
                      <a href={u.latestUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--pro-text-muted)", marginTop: 3, display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <ExternalLink size={10} /> {u.latestUrl}
                      </a>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      {u.resourceId ? (
                        <button
                          onClick={() => handleApplyUpdate(u)}
                          disabled={applyingUpdate === u.resourceId}
                          style={{
                            display: "flex", alignItems: "center", gap: 5, padding: "5px 12px",
                            borderRadius: 6, border: "none", background: "var(--pro-accent)",
                            color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
                            opacity: applyingUpdate === u.resourceId ? 0.5 : 1,
                          }}
                        >
                          <ArrowUpCircle size={12} />
                          {applyingUpdate === u.resourceId ? "更新中..." : "套用更新"}
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--pro-text-muted)", padding: "5px 0" }}>尚未收錄</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Duplicates panel */}
      {showDuplicates && dupGroups.length > 0 && (
        <div style={{
          marginBottom: 20, padding: 16, borderRadius: 10,
          background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.25)",
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <Copy size={14} /> 重複項目（保留最新，刪除其餘）
          </div>
          {dupGroups.map(group => {
            // Sort by created_at descending (newest first, keep[0])
            const sorted = [...group].sort((a, b) => (b as Resource & { created_at?: string }).created_at?.localeCompare((a as Resource & { created_at?: string }).created_at ?? "") ?? 0);
            const keepId = sorted[0].id;
            const deleteIds = sorted.slice(1).map(r => r.id);
            return (
              <div key={keepId} style={{
                padding: "10px 14px", marginBottom: 8, borderRadius: 7,
                background: "var(--pro-bg)", border: "1px solid var(--pro-border)",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)" }}>{sorted[0].title}</div>
                    <div style={{ fontSize: 11, color: "var(--pro-text-muted)", marginTop: 3 }}>
                      {group.length} 筆重複 · 保留最新一筆，刪除 {deleteIds.length} 筆
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteMany(deleteIds)}
                    style={{
                      display: "flex", alignItems: "center", gap: 5, padding: "5px 12px",
                      borderRadius: 6, border: "1px solid rgba(239,68,68,0.3)",
                      background: "rgba(239,68,68,0.08)", color: "#ef4444",
                      cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
                    }}
                  >
                    <Trash2 size={12} /> 刪除重複
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, borderRadius: 8, padding: 3, background: "var(--pro-bg)", border: "1px solid var(--pro-border)" }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                padding: "4px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12,
                background: activeCategory === cat ? "var(--pro-accent)" : "transparent",
                color: activeCategory === cat ? "#fff" : "var(--pro-text-muted)",
                fontWeight: activeCategory === cat ? 700 : 400,
                transition: "all 0.1s",
              }}
            >
              {cat}
            </button>
          ))}
        </div>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--pro-text-muted)", pointerEvents: "none" }} />
          <input
            ref={searchRef}
            className="pro-input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜尋標題、作者、來源..."
            style={{ paddingLeft: 32, width: "100%", ...(searchParams.get("q") && search ? { borderColor: "var(--pro-accent)", boxShadow: "0 0 0 2px var(--pro-accent-dim)" } : {}) }}
          />
        </div>
        <span style={{ fontSize: 12, color: "var(--pro-text-muted)", whiteSpace: "nowrap" }}>
          {filtered.length} 筆
        </span>
        <div style={{ display: "flex", gap: 2, borderRadius: 7, padding: 2, background: "var(--pro-bg)", border: "1px solid var(--pro-border)", marginLeft: "auto" }}>
          <button
            onClick={() => setViewMode("cards")}
            title="卡片檢視"
            style={{ padding: "4px 8px", borderRadius: 5, border: "none", cursor: "pointer", background: viewMode === "cards" ? "var(--pro-accent)" : "transparent", color: viewMode === "cards" ? "#fff" : "var(--pro-text-muted)", display: "flex", alignItems: "center" }}
          ><LayoutGrid size={13} /></button>
          <button
            onClick={() => setViewMode("list")}
            title="合訂本檢視"
            style={{ padding: "4px 8px", borderRadius: 5, border: "none", cursor: "pointer", background: viewMode === "list" ? "var(--pro-accent)" : "transparent", color: viewMode === "list" ? "#fff" : "var(--pro-text-muted)", display: "flex", alignItems: "center" }}
          ><List size={13} /></button>
        </div>
      </div>

      {/* Resource grid / list */}
      {loading ? (
        <div style={{ color: "var(--pro-text-muted)", padding: 40, textAlign: "center" }}>載入中...</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: "var(--pro-text-muted)", padding: 40, textAlign: "center", fontSize: 14 }}>
          尚無資料，點擊「新增資料」開始建立你的臨床資料庫
        </div>
      ) : viewMode === "list" ? (
        <CollectionView
          resources={filtered}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          onDelete={handleDelete}
          onUpdateCover={handleUpdateCover}
          favIds={favIds}
          onToggleFav={toggleFav}
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {filtered.map(r => (
            <ResourceCard
              key={r.id}
              r={r}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              onDelete={handleDelete}
              onUpdateCover={handleUpdateCover}
              isFavorite={favIds.has(r.id)}
              onToggleFav={toggleFav}
            />
          ))}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setShowForm(true)}
        title="新增資料"
        style={{
          position: "fixed", bottom: 28, right: 28, zIndex: 100,
          width: 48, height: 48, borderRadius: "50%",
          background: "var(--pro-accent)", color: "#fff", border: "none",
          cursor: "pointer", boxShadow: "0 4px 16px rgba(59,130,246,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "transform 0.15s",
        }}
        onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.1)")}
        onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
      >
        <Plus size={22} />
      </button>

      {/* Add form modal */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "var(--pro-sidebar)", border: "1px solid var(--pro-border)", borderRadius: 14, width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--pro-border)", position: "sticky", top: 0, background: "var(--pro-sidebar)", zIndex: 1 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--pro-text)" }}>新增參考資料</span>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--pro-text-muted)" }}><X size={18} /></button>
            </div>

            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--pro-text-muted)", marginBottom: 5 }}>
                  標題 <span style={{ color: "var(--pro-danger)" }}>*</span>
                </label>
                <input ref={titleRef} className="pro-input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="書名 / 文章標題 / 網站名稱" style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--pro-text-muted)", marginBottom: 5 }}>類別</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {["書籍", "指引", "文章", "網站", "影音"].map(cat => (
                    <button key={cat} type="button" onClick={() => setForm(f => ({ ...f, category: cat }))}
                      style={{ padding: "4px 12px", borderRadius: 16, fontSize: 12, cursor: "pointer", border: `1.5px solid ${form.category === cat ? CATEGORY_COLORS[cat] : "var(--pro-border)"}`, background: form.category === cat ? CATEGORY_COLORS[cat] + "20" : "transparent", color: form.category === cat ? CATEGORY_COLORS[cat] : "var(--pro-text-muted)", fontWeight: form.category === cat ? 700 : 400 }}>
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--pro-text-muted)", marginBottom: 5 }}>作者 / 機構</label>
                  <input className="pro-input" value={form.author} onChange={e => setForm(f => ({ ...f, author: e.target.value }))} placeholder="作者姓名" style={{ width: "100%" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--pro-text-muted)", marginBottom: 5 }}>年份</label>
                  <input className="pro-input" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} placeholder="2024" style={{ width: 80 }} />
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--pro-text-muted)", marginBottom: 5 }}>來源</label>
                <input className="pro-input" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} placeholder="NEJM / WHO / 台灣衛福部 / 台灣家庭醫學會..." style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--pro-text-muted)", marginBottom: 5 }}>連結 URL</label>
                <input className="pro-input" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://..." style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--pro-text-muted)", marginBottom: 5 }}>封面圖片 URL（選填，書籍可用 ISBN 封面）</label>
                <input className="pro-input" value={form.cover_url} onChange={e => setForm(f => ({ ...f, cover_url: e.target.value }))} placeholder="https://covers.openlibrary.org/b/isbn/9780....-M.jpg" style={{ width: "100%" }} />
                <div style={{ fontSize: 11, color: "var(--pro-text-muted)", marginTop: 4 }}>
                  書籍封面可使用 Open Library：<code style={{ fontSize: 10 }}>https://covers.openlibrary.org/b/isbn/YOUR_ISBN-M.jpg</code>
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--pro-text-muted)", marginBottom: 5 }}>簡介</label>
                <textarea className="pro-input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="這本書/文章的主要內容..." style={{ width: "100%", resize: "vertical" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--pro-text-muted)", marginBottom: 5 }}>標籤（逗號分隔）</label>
                <input className="pro-input" value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="家醫科, 慢性病, 高血壓" style={{ width: "100%" }} />
              </div>
              {isAdmin && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.is_public} onChange={e => setForm(f => ({ ...f, is_public: e.target.checked }))} />
                  <span style={{ fontSize: 13, color: "var(--pro-text)" }}>設為公開（所有用戶可見）</span>
                </label>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, padding: "14px 20px", borderTop: "1px solid var(--pro-border)", position: "sticky", bottom: 0, background: "var(--pro-sidebar)" }}>
              <button onClick={handleSave} disabled={saving || !form.title.trim()} className="pro-btn-primary" style={{ flex: 1, justifyContent: "center", opacity: !form.title.trim() ? 0.5 : 1 }}>
                {saving ? "儲存中..." : "確認新增"}
              </button>
              <button onClick={() => setShowForm(false)} style={{ padding: "9px 18px", borderRadius: 7, border: "1px solid var(--pro-border)", background: "transparent", color: "var(--pro-text-muted)", cursor: "pointer", fontSize: 13 }}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 合訂本（清單）檢視 ──────────────────────────────────────

const COLLECTION_CATS = ["指引", "文章", "網站", "影音"];

function CollectionView({ resources, currentUserId, isAdmin, onDelete, onUpdateCover, favIds, onToggleFav }: {
  resources: Resource[];
  currentUserId: string | null;
  isAdmin: boolean;
  onDelete: (id: string) => void;
  onUpdateCover: (id: string, url: string) => void;
  favIds: Set<string>;
  onToggleFav: (id: string) => void;
}) {
  const books = resources.filter(r => r.category === "書籍");
  const nonBooks = resources.filter(r => r.category !== "書籍");

  // Group non-books by category
  const grouped = COLLECTION_CATS.reduce((acc, cat) => {
    const items = nonBooks.filter(r => r.category === cat);
    if (items.length > 0) acc[cat] = items;
    return acc;
  }, {} as Record<string, Resource[]>);

  // Also capture any unknown categories
  const knownCats = new Set(["書籍", ...COLLECTION_CATS]);
  const otherNonBooks = nonBooks.filter(r => !knownCats.has(r.category));
  if (otherNonBooks.length > 0) grouped["其他"] = otherNonBooks;

  const allCats = [...Object.keys(grouped), ...(books.length > 0 ? ["書籍"] : [])];
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(allCats.map(c => [c, false]))
  );
  const toggle = (cat: string) => setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Non-book collection — 合訂本 */}
      {Object.entries(grouped).map(([cat, items]) => {
        const catColor = CATEGORY_COLORS[cat] ?? "#64748b";
        const catIcon = CATEGORY_ICONS[cat];
        const isCollapsed = collapsed[cat];
        return (
          <div key={cat}>
            <button
              onClick={() => toggle(cat)}
              style={{
                display: "flex", alignItems: "center", gap: 8, marginBottom: isCollapsed ? 0 : 8,
                background: "none", border: "none", cursor: "pointer", padding: 0, width: "100%", textAlign: "left",
              }}
            >
              <div style={{ width: 22, height: 22, borderRadius: 6, background: catColor + "20", display: "flex", alignItems: "center", justifyContent: "center", color: catColor, flexShrink: 0 }}>
                {catIcon}
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)" }}>{cat}</span>
              <span style={{ fontSize: 11, color: "var(--pro-text-muted)" }}>{items.length} 筆</span>
              <span style={{ marginLeft: "auto", color: "var(--pro-text-muted)" }}>
                {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </span>
            </button>
            {!isCollapsed && <div style={{ borderRadius: 10, border: "1px solid var(--pro-border)", overflow: "hidden" }}>
              {items.map((r, idx) => {
                const canDelete = isAdmin || r.created_by === currentUserId;
                return (
                  <div
                    key={r.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                      borderBottom: idx < items.length - 1 ? "1px solid var(--pro-border)" : "none",
                      background: "var(--pro-sidebar)",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--pro-bg)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "var(--pro-sidebar)")}
                  >
                    {/* Title */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {r.url ? (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 13, fontWeight: 600, color: "var(--pro-text)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
                        >
                          {r.title} <ExternalLink size={10} color="var(--pro-text-muted)" />
                        </a>
                      ) : (
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--pro-text)" }}>{r.title}</span>
                      )}
                      {r.description && (
                        <div style={{ fontSize: 11, color: "var(--pro-text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.description}
                        </div>
                      )}
                    </div>
                    {/* Author · Year */}
                    {(r.author || r.year) && (
                      <div style={{ fontSize: 11, color: "var(--pro-text-muted)", whiteSpace: "nowrap", flexShrink: 0 }}>
                        {r.author}{r.author && r.year && " · "}{r.year}
                      </div>
                    )}
                    {/* Source — clickable only when URL exists */}
                    {r.source && (
                      <div style={{ flexShrink: 0 }}>
                        {r.url ? (
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 11, color: "var(--pro-accent)", fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}
                          >
                            {r.source} <ExternalLink size={9} />
                          </a>
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--pro-text-muted)", fontWeight: 500 }}>{r.source}</span>
                        )}
                      </div>
                    )}
                    {/* Tags */}
                    {r.tags.length > 0 && (
                      <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                        {r.tags.slice(0, 2).map(tag => (
                          <span key={tag} style={{ fontSize: 9, padding: "1px 5px", borderRadius: 6, background: "var(--pro-bg)", color: "var(--pro-text-muted)", border: "1px solid var(--pro-border)" }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Delete */}
                    {canDelete && (
                      <button
                        onClick={() => onDelete(r.id)}
                        style={{ padding: "3px 6px", borderRadius: 5, background: "transparent", border: "none", color: "var(--pro-text-muted)", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", opacity: 0.5 }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; (e.currentTarget as HTMLElement).style.color = "#ef4444"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "0.5"; (e.currentTarget as HTMLElement).style.color = "var(--pro-text-muted)"; }}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>}
          </div>
        );
      })}

      {/* Books stay as cards */}
      {books.length > 0 && (
        <div>
          <button
            onClick={() => toggle("書籍")}
            style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: collapsed["書籍"] ? 0 : 8,
              background: "none", border: "none", cursor: "pointer", padding: 0, width: "100%", textAlign: "left",
            }}
          >
            <div style={{ width: 22, height: 22, borderRadius: 6, background: CATEGORY_COLORS["書籍"] + "20", display: "flex", alignItems: "center", justifyContent: "center", color: CATEGORY_COLORS["書籍"], flexShrink: 0 }}>
              {CATEGORY_ICONS["書籍"]}
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)" }}>書籍</span>
            <span style={{ fontSize: 11, color: "var(--pro-text-muted)" }}>{books.length} 本</span>
            <span style={{ marginLeft: "auto", color: "var(--pro-text-muted)" }}>
              {collapsed["書籍"] ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </span>
          </button>
          {!collapsed["書籍"] && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {books.map(r => (
              <ResourceCard
                key={r.id}
                r={r}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                onDelete={onDelete}
                onUpdateCover={onUpdateCover}
                isFavorite={favIds.has(r.id)}
                onToggleFav={onToggleFav}
              />
            ))}
          </div>}
        </div>
      )}

      {nonBooks.length === 0 && books.length === 0 && (
        <div style={{ color: "var(--pro-text-muted)", padding: 40, textAlign: "center", fontSize: 14 }}>無資料</div>
      )}
    </div>
  );
}

// ── 資源卡片元件 ────────────────────────────────────────────

function ResourceCard({ r, currentUserId, isAdmin, onDelete, onUpdateCover, isFavorite, onToggleFav }: {
  r: Resource;
  currentUserId: string | null;
  isAdmin: boolean;
  onDelete: (id: string) => void;
  onUpdateCover: (id: string, url: string) => void;
  isFavorite?: boolean;
  onToggleFav?: (id: string) => void;
}) {
  const canDelete = isAdmin || r.created_by === currentUserId;
  const canEdit = isAdmin || r.created_by === currentUserId;
  const catColor = CATEGORY_COLORS[r.category] ?? "#64748b";
  const [imgFailed, setImgFailed] = useState(false);
  const [editingCover, setEditingCover] = useState(false);
  const [coverInput, setCoverInput] = useState(r.cover_url || "");
  const [showDetail, setShowDetail] = useState(false);

  const handleCoverSave = () => {
    onUpdateCover(r.id, coverInput);
    setEditingCover(false);
    setImgFailed(false);
  };

  const handleCardClick = () => {
    if (editingCover) return;
    if (r.url) window.open(r.url, "_blank", "noopener");
    else setShowDetail(true);
  };

  return (
    <>
    {showDetail && (
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        onClick={() => setShowDetail(false)}
      >
        <div
          style={{ background: "var(--pro-sidebar)", border: "1px solid var(--pro-border)", borderRadius: 14, width: "100%", maxWidth: 460, overflow: "auto", maxHeight: "80vh" }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--pro-border)" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--pro-text)" }}>{r.title}</span>
            <button onClick={() => setShowDetail(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--pro-text-muted)" }}><X size={16} /></button>
          </div>
          <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: catColor + "20", color: catColor }}>{r.category}</span>
              {r.year && <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 11, background: "var(--pro-bg)", color: "var(--pro-text-muted)", border: "1px solid var(--pro-border)" }}>{r.year}</span>}
            </div>
            {r.author && <div style={{ fontSize: 13, color: "var(--pro-text-muted)" }}>作者：{r.author}</div>}
            {r.source && <div style={{ fontSize: 13, color: "var(--pro-text-muted)" }}>來源：{r.source}</div>}
            {r.description && <div style={{ fontSize: 13, color: "var(--pro-text)", lineHeight: 1.6 }}>{r.description}</div>}
            {r.tags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {r.tags.map(tag => (
                  <span key={tag} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 8, background: "var(--pro-bg)", color: "var(--pro-text-muted)", border: "1px solid var(--pro-border)" }}>{tag}</span>
                ))}
              </div>
            )}
            {!r.url && <div style={{ fontSize: 12, color: "var(--pro-text-muted)", marginTop: 4, fontStyle: "italic" }}>此資料暫無外部連結</div>}
          </div>
        </div>
      </div>
    )}
    <div className="pro-card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", transition: "transform 0.1s", cursor: editingCover ? "default" : "pointer", border: isFavorite ? "1px solid rgba(245,158,11,0.5)" : undefined }}
      onClick={handleCardClick}
    >
      {/* Cover area */}
      <div style={{ position: "relative", height: 140, background: "var(--pro-bg)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
        {/* 星號收藏：右上角 */}
        {onToggleFav && (
          <button
            onClick={e => { e.stopPropagation(); onToggleFav(r.id); }}
            title={isFavorite ? "取消收藏" : "加入收藏（置頂）"}
            style={{
              position: "absolute", top: 6, right: 6, zIndex: 2,
              width: 28, height: 28, borderRadius: "50%",
              background: isFavorite ? "rgba(245,158,11,0.95)" : "rgba(0,0,0,0.45)",
              border: "1px solid " + (isFavorite ? "#f59e0b" : "rgba(255,255,255,0.3)"),
              color: isFavorite ? "#fff" : "rgba(255,255,255,0.9)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", padding: 0,
              boxShadow: isFavorite ? "0 2px 8px rgba(245,158,11,0.4)" : "0 1px 4px rgba(0,0,0,0.3)",
            }}
          >
            <Star size={14} fill={isFavorite ? "#fff" : "none"} strokeWidth={2.2} />
          </button>
        )}
        {r.cover_url && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={r.cover_url}
            alt={r.title}
            style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: catColor + "20", display: "flex", alignItems: "center", justifyContent: "center", color: catColor, fontSize: 24 }}>
              {CATEGORY_ICONS[r.category] ?? <BookOpen size={24} />}
            </div>
            {/* Edit cover button when no cover or image failed */}
            {canEdit && !editingCover && (
              <button
                onClick={e => { e.stopPropagation(); setEditingCover(true); setCoverInput(r.cover_url || ""); }}
                style={{
                  fontSize: 10, padding: "2px 8px", borderRadius: 6,
                  border: "1px solid var(--pro-border)", background: "var(--pro-bg)",
                  color: "var(--pro-text-muted)", cursor: "pointer",
                }}
              >
                設定封面
              </button>
            )}
          </div>
        )}

        {/* Inline cover edit form */}
        {editingCover && (
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: "absolute", inset: 0,
              background: "var(--pro-sidebar)", padding: 10,
              display: "flex", flexDirection: "column", gap: 6, justifyContent: "center",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--pro-text-muted)" }}>封面圖片 URL</div>
            <input
              autoFocus
              className="pro-input"
              value={coverInput}
              onChange={e => setCoverInput(e.target.value)}
              placeholder="https://covers.openlibrary.org/b/isbn/..."
              style={{ fontSize: 11, padding: "4px 8px" }}
              onKeyDown={e => e.key === "Enter" && handleCoverSave()}
            />
            <div style={{ display: "flex", gap: 5 }}>
              <button onClick={handleCoverSave} style={{ flex: 1, padding: "4px", borderRadius: 5, border: "none", background: "var(--pro-accent)", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>儲存</button>
              <button onClick={e => { e.stopPropagation(); setEditingCover(false); }} style={{ flex: 1, padding: "4px", borderRadius: 5, border: "1px solid var(--pro-border)", background: "transparent", color: "var(--pro-text-muted)", cursor: "pointer", fontSize: 11 }}>取消</button>
            </div>
          </div>
        )}

        {/* Category badge */}
        <span style={{ position: "absolute", top: 8, left: 8, padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: catColor + "20", color: catColor, border: `1px solid ${catColor}40`, pointerEvents: "none" }}>
          {r.category}
        </span>
        {/* Visibility badge */}
        {!r.is_public && (
          <span style={{ position: "absolute", top: 8, right: 8, padding: "2px 8px", borderRadius: 10, fontSize: 10, background: "rgba(100,116,139,0.15)", color: "var(--pro-text-muted)", border: "1px solid var(--pro-border)", pointerEvents: "none" }}>
            <Bookmark size={9} style={{ display: "inline", marginRight: 3 }} />個人
          </span>
        )}
        {/* Delete button */}
        {canDelete && !editingCover && (
          <button
            onClick={e => { e.stopPropagation(); onDelete(r.id); }}
            style={{ position: "absolute", bottom: 6, right: 6, padding: "3px 6px", borderRadius: 5, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444", cursor: "pointer", display: "flex", alignItems: "center" }}
          >
            <X size={11} />
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: "12px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {r.title}
        </div>
        {(r.author || r.year) && (
          <div style={{ fontSize: 11, color: "var(--pro-text-muted)" }}>
            {r.author}{r.author && r.year && " · "}{r.year}
          </div>
        )}
        {r.source && (
          r.url ? (
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ fontSize: 11, color: "var(--pro-accent)", fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}
            >
              {r.source} <ExternalLink size={9} />
            </a>
          ) : (
            <div style={{ fontSize: 11, color: "var(--pro-text-muted)", fontWeight: 500 }}>{r.source}</div>
          )
        )}
        {r.description && (
          <div style={{ fontSize: 11, color: "var(--pro-text-muted)", lineHeight: 1.5, marginTop: 4, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {r.description}
          </div>
        )}
        {r.tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
            {r.tags.map(tag => (
              <span key={tag} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "var(--pro-bg)", color: "var(--pro-text-muted)", border: "1px solid var(--pro-border)" }}>
                {tag}
              </span>
            ))}
          </div>
        )}
        {r.url ? (
          <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--pro-accent)" }}>
            <ExternalLink size={11} /> 點擊開啟連結
          </div>
        ) : (
          <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--pro-text-muted)" }}>
            點擊查看詳情
          </div>
        )}
      </div>
    </div>
    </>
  );
}
