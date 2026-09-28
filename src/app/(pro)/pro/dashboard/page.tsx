"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, FileText, ClipboardList, Plus, ArrowRight, AlertTriangle, CalendarDays } from "lucide-react";
import ProStatCard from "@/components/pro/ProStatCard";
import { createClient } from "@/lib/supabase";

interface Stats {
  totalPatients: number;
  totalRecords: number;
  totalNotes: number;
  waitingCount: number;
  recentPatients: Array<{ id: string; full_name: string; updated_at: string; sex: string | null }>;
}

// 問候語的稱謂依 pro_role 顯示(與側邊欄的角色標籤一致);管理類角色不加稱謂
const ROLE_TITLE: Record<string, string> = { doctor: "醫師", nurse: "護理師", pharmacist: "藥師" };

export default function ProDashboard() {
  const [stats, setStats] = useState<Stats>({
    totalPatients: 0, totalRecords: 0, totalNotes: 0, waitingCount: 0, recentPatients: [],
  });
  const [displayName, setDisplayName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const today = new Date().toISOString().split("T")[0];
      const [
        { data: profile },
        { count: pCount },
        { count: rCount },
        { count: nCount },
        { count: wCount },
        { data: recentPts },
      ] = await Promise.all([
        supabase.from("profiles").select("name, pro_role").eq("id", user.id).single(),
        supabase.from("doctor_patients").select("*", { count: "exact", head: true }).eq("doctor_id", user.id),
        supabase.from("clinical_records").select("*", { count: "exact", head: true }).eq("doctor_id", user.id),
        supabase.from("soap_notes").select("*", { count: "exact", head: true }).eq("doctor_id", user.id),
        supabase.from("appointments").select("*", { count: "exact", head: true }).eq("doctor_id", user.id).eq("visit_date", today).in("status", ["waiting", "in_progress"]),
        supabase.from("doctor_patients").select("id, full_name, updated_at, sex").eq("doctor_id", user.id).order("updated_at", { ascending: false }).limit(5),
      ]);

      setDisplayName(profile?.name || "");
      setRoleTitle(ROLE_TITLE[profile?.pro_role ?? ""] ?? "");
      setStats({
        totalPatients: pCount || 0,
        totalRecords: rCount || 0,
        totalNotes: nCount || 0,
        waitingCount: wCount || 0,
        recentPatients: recentPts || [],
      });
      setLoading(false);
    };

    load();

    // Re-fetch when user returns to this tab
    const handleVisibility = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "早安" : hour < 18 ? "午安" : "晚安";

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* Welcome header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--pro-text)", marginBottom: 4 }}>
          {greeting}{displayName && `，${displayName}`}{roleTitle && ` ${roleTitle}`} 👋
        </h1>
        <p style={{ fontSize: 13, color: "var(--pro-text-muted)" }}>
          {now.toLocaleDateString("zh-TW", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 28 }}>
        <ProStatCard icon={Users}         value={loading ? "—" : stats.totalPatients} label="管理病患數" color="blue" />
        <ProStatCard icon={ClipboardList} value={loading ? "—" : stats.totalRecords}  label="臨床記錄數" color="green" />
        <ProStatCard icon={FileText}      value={loading ? "—" : stats.totalNotes}    label="SOAP 筆記" color="yellow" />
        <Link href="/pro/appointments" style={{ textDecoration: "none" }}>
          <ProStatCard icon={CalendarDays} value={loading ? "—" : stats.waitingCount} label="今日候診中" color="green" />
        </Link>
      </div>

      {/* Quick actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
        <div className="pro-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)", marginBottom: 14 }}>快速操作</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { href: "/pro/appointments",  label: "掛號管理",     icon: CalendarDays },
              { href: "/pro/encounter",     label: "開始看診",     icon: ClipboardList },
              { href: "/pro/patients/new",  label: "新增病患",     icon: Plus },
              { href: "/pro/drugs",         label: "藥物交互檢查", icon: AlertTriangle },
            ].map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 12px", borderRadius: 8, textDecoration: "none",
                background: "var(--pro-card-hover)", color: "var(--pro-text)",
                fontSize: 13, fontWeight: 500, transition: "all 0.15s",
              }}>
                <Icon size={14} color="var(--pro-accent)" />
                {label}
                <ArrowRight size={12} style={{ marginLeft: "auto", color: "var(--pro-text-muted)" }} />
              </Link>
            ))}
          </div>
        </div>

        {/* Recent patients */}
        <div className="pro-card" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pro-text)" }}>最近病患</div>
            <Link href="/pro/patients" style={{ fontSize: 11, color: "var(--pro-accent)", textDecoration: "none" }}>
              查看全部 →
            </Link>
          </div>
          {loading ? (
            <div style={{ color: "var(--pro-text-muted)", fontSize: 13 }}>載入中...</div>
          ) : stats.recentPatients.length === 0 ? (
            <div style={{ color: "var(--pro-text-muted)", fontSize: 13 }}>尚無病患記錄</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {stats.recentPatients.map(p => (
                <Link key={p.id} href={`/pro/patients/${p.id}`} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", borderRadius: 7, textDecoration: "none",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.background = "var(--pro-card-hover)"}
                onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.background = "transparent"}
                >
                  <div style={{
                    width: 30, height: 30, borderRadius: "50%",
                    background: "var(--pro-accent-dim)", border: "1px solid rgba(59,130,246,0.2)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700, color: "var(--pro-accent)", flexShrink: 0,
                  }}>
                    {p.full_name.charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--pro-text)" }}>{p.full_name}</div>
                    <div style={{ fontSize: 11, color: "var(--pro-text-muted)" }}>
                      {p.sex === "M" ? "男" : p.sex === "F" ? "女" : ""} · 最後更新 {new Date(p.updated_at).toLocaleDateString("zh-TW")}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
