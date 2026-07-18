import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireProAal2 } from "@/lib/pro/serverAuth";

export async function GET() {
  // RR8：service-role 跨病患聚合查詢 → 需 is_pro + AAL2（不能只靠 middleware）
  const gate = await requireProAal2();
  if (!gate.ok) return gate.res;

  // service role 聚合查詢（繞過 RLS）；缺 key 明確 503，不 fallback 到 anon
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return NextResponse.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 });
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey);

  try {
    const [
      { count: totalUsers },
      { count: totalRecords },
      { count: totalManual },
      { count: totalScan },
      { count: totalPatients },
      { count: totalMedications },
      { count: totalReferences },
      { data: sexDist },
      { data: medCats },
      { data: diagFeedback },
    ] = await Promise.all([
      admin.from("profiles").select("*", { count: "exact", head: true }),
      admin.from("health_records").select("*", { count: "exact", head: true }),
      admin.from("health_records").select("*", { count: "exact", head: true }).eq("type", "manual"),
      admin.from("health_records").select("*", { count: "exact", head: true }).eq("type", "scan"),
      admin.from("doctor_patients").select("*", { count: "exact", head: true }),
      admin.from("medications").select("*", { count: "exact", head: true }),
      admin.from("medical_references").select("*", { count: "exact", head: true }),
      admin.from("doctor_patients").select("sex"),
      admin.from("medications").select("category"),
      admin.from("clinical_records").select("diagnosis_accuracy").not("diagnosis_accuracy", "is", null),
    ]);

    // E: diagnosis accuracy rate
    const feedbackRows = (diagFeedback || []) as Array<{ diagnosis_accuracy: string }>;
    const totalFeedback = feedbackRows.length;
    const correctCount   = feedbackRows.filter(r => r.diagnosis_accuracy === "correct").length;
    const partialCount   = feedbackRows.filter(r => r.diagnosis_accuracy === "partial").length;
    const incorrectCount = feedbackRows.filter(r => r.diagnosis_accuracy === "incorrect").length;
    // accuracy = (correct + partial*0.5) / total, expressed as percentage
    const diagnosisAccuracy = totalFeedback > 0
      ? Math.round(((correctCount + partialCount * 0.5) / totalFeedback) * 100)
      : null;

    // Weekly volume: last 8 weeks
    const { data: weeklyRaw } = await admin
      .from("health_records")
      .select("created_at")
      .gte("created_at", new Date(Date.now() - 56 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at");

    // Group by week
    const weekMap: Record<string, number> = {};
    for (const r of (weeklyRaw || [])) {
      const d = new Date(r.created_at);
      const monday = new Date(d);
      monday.setDate(d.getDate() - d.getDay() + 1);
      const key = monday.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
      weekMap[key] = (weekMap[key] || 0) + 1;
    }
    const weeklyVolume = Object.entries(weekMap).map(([week, count]) => ({ week, count }));

    // Sex distribution
    const sexMap: Record<string, number> = {};
    for (const p of (sexDist || [])) {
      const s = p.sex || "未知";
      sexMap[s] = (sexMap[s] || 0) + 1;
    }
    const sexDistribution = Object.entries(sexMap).map(([sex, count]) => ({ sex, count }));

    // Medication categories
    const catMap: Record<string, number> = {};
    for (const m of (medCats || [])) {
      const c = m.category || "其他";
      catMap[c] = (catMap[c] || 0) + 1;
    }
    const topMedicationCategories = Object.entries(catMap)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return NextResponse.json({
      totalUsers: totalUsers || 0,
      totalRecords: totalRecords || 0,
      totalManual: totalManual || 0,
      totalScan: totalScan || 0,
      totalPatients: totalPatients || 0,
      totalMedications: totalMedications || 0,
      totalReferences: totalReferences || 0,
      diagnosisAccuracy,        // null = 尚無回饋
      totalFeedback,
      correctCount,
      partialCount,
      incorrectCount,
      weeklyVolume,
      sexDistribution,
      topMedicationCategories,
    });
  } catch (err) {
    console.error("[Pro Analytics]", err);
    return NextResponse.json({ error: "ANALYTICS_ERROR" }, { status: 500 });
  }
}
