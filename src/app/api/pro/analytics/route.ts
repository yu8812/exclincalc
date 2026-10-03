import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requirePrivilegedRead } from "@/lib/pro/serverAuth";
import { allowDemoAiCall, checkRateLimit } from "@/lib/rateLimit";

// SEC001D-03（決策：限 admin）：analytics 是平台級跨病患/跨醫師聚合(監督用)，UI 也只在 admin 區顯示。
// 這裡只回彙總數字，不含任何個人資料。展示用 admin 的密碼是公開的，所以它雖然能進來，
// 卻只算展示帳號自己的資料 —— 連「全平台有幾個人」這種數字都不給它。真正的管理員仍需 AAL2。

function serviceClient(): SupabaseClient | null {
  // service role 聚合查詢（繞過 RLS）；缺 key 明確 503，不 fallback 到 anon
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Stats = Awaited<ReturnType<typeof collectStats>>;

/** onlyIds = null 算全平台；給陣列就只算這些帳號的資料。藥物與參考值是共用字典，不分。 */
async function collectStats(admin: SupabaseClient, onlyIds: string[] | null) {
  const scoped = (table: string, column: string, select = "*", head = true) => {
    const q = admin.from(table).select(select, head ? { count: "exact", head: true } : undefined);
    return onlyIds ? q.in(column, onlyIds) : q;
  };

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
    { data: weeklyRaw },
  ] = await Promise.all([
    scoped("profiles", "id"),
    scoped("health_records", "user_id"),
    scoped("health_records", "user_id").eq("type", "manual"),
    scoped("health_records", "user_id").eq("type", "scan"),
    scoped("doctor_patients", "doctor_id"),
    admin.from("medications").select("*", { count: "exact", head: true }),
    admin.from("medical_references").select("*", { count: "exact", head: true }),
    scoped("doctor_patients", "doctor_id", "sex", false),
    admin.from("medications").select("category"),
    scoped("clinical_records", "doctor_id", "diagnosis_accuracy", false).not("diagnosis_accuracy", "is", null),
    scoped("health_records", "user_id", "created_at", false)
      .gte("created_at", new Date(Date.now() - 56 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at"),
  ]);

  // E: diagnosis accuracy rate
  const feedbackRows = (diagFeedback || []) as unknown as Array<{ diagnosis_accuracy: string }>;
  const totalFeedback = feedbackRows.length;
  const correctCount   = feedbackRows.filter(r => r.diagnosis_accuracy === "correct").length;
  const partialCount   = feedbackRows.filter(r => r.diagnosis_accuracy === "partial").length;
  const incorrectCount = feedbackRows.filter(r => r.diagnosis_accuracy === "incorrect").length;
  // accuracy = (correct + partial*0.5) / total, expressed as percentage
  const diagnosisAccuracy = totalFeedback > 0
    ? Math.round(((correctCount + partialCount * 0.5) / totalFeedback) * 100)
    : null;

  // 近 8 週記錄量。用台灣時間分週、週一開頭（Workers 跑在 UTC，直接用 getDay() 會把週日算進下一週）
  const TW_OFFSET_MS = 8 * 60 * 60 * 1000;
  const weekMap: Record<string, number> = {};
  for (const r of (weeklyRaw || []) as unknown as Array<{ created_at: string }>) {
    const t = new Date(new Date(r.created_at).getTime() + TW_OFFSET_MS);
    const sinceMonday = (t.getUTCDay() + 6) % 7;
    const monday = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - sinceMonday));
    const key = `${String(monday.getUTCMonth() + 1).padStart(2, "0")}/${String(monday.getUTCDate()).padStart(2, "0")}`;
    weekMap[key] = (weekMap[key] || 0) + 1;
  }
  const weeklyVolume = Object.entries(weekMap).map(([week, count]) => ({ week, count }));

  // Sex distribution
  const sexMap: Record<string, number> = {};
  for (const p of (sexDist || []) as unknown as Array<{ sex: string | null }>) {
    const s = p.sex || "未知";
    sexMap[s] = (sexMap[s] || 0) + 1;
  }
  const sexDistribution = Object.entries(sexMap).map(([sex, count]) => ({ sex, count }));

  // Medication categories
  const catMap: Record<string, number> = {};
  for (const m of (medCats || []) as Array<{ category: string | null }>) {
    const c = m.category || "其他";
    catMap[c] = (catMap[c] || 0) + 1;
  }
  const topMedicationCategories = Object.entries(catMap)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
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
  };
}

async function demoAccountIds(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin.from("profiles").select("id").eq("is_demo", true);
  if (error) throw error;
  return (data ?? []).map((p) => p.id as string);
}

export async function GET() {
  const gate = await requirePrivilegedRead();
  if (!gate.ok) return gate.res;
  const admin = serviceClient();
  if (!admin) return NextResponse.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 });

  try {
    const onlyIds = gate.demoView ? await demoAccountIds(admin) : null;
    const stats = await collectStats(admin, onlyIds);
    return NextResponse.json({ ...stats, scope: gate.demoView ? "demo" : "all" });
  } catch (err) {
    console.error("[Pro Analytics]", err);
    return NextResponse.json({ error: "ANALYTICS_ERROR" }, { status: 500 });
  }
}

function summaryPrompt(s: Stats, demo: boolean): string {
  const sex = s.sexDistribution
    .map(x => `${x.sex === "M" ? "男" : x.sex === "F" ? "女" : "其他"} ${x.count} 人`).join("、");
  const accuracy = s.diagnosisAccuracy !== null
    ? `${s.diagnosisAccuracy}%（${s.totalFeedback} 筆回饋：正確 ${s.correctCount}、部分正確 ${s.partialCount}、有誤 ${s.incorrectCount}）`
    : "還沒有醫師回饋";
  return `你是醫療資訊系統的顧問。下面是 ClinCalc Pro 臨床決策平台的使用統計${demo ? "（只含展示帳號的虛構資料）" : ""}。
請用繁體中文寫 3 到 4 點觀察與建議，每點一到兩句，講具體的事，不要開場白和客套話。

- 帳號：${s.totalUsers} 個
- 病患：${s.totalPatients} 位${sex ? `（${sex}）` : ""}
- 藥物資料庫：${s.totalMedications} 筆；醫療參考值：${s.totalReferences} 筆
- AI 鑑別診斷被醫師評為正確的比例：${accuracy}
- 健康記錄：${s.totalRecords} 筆（手動輸入 ${s.totalManual}、拍照掃描 ${s.totalScan}）
- 近 8 週每週記錄量：${s.weeklyVolume.map(w => `${w.week} ${w.count} 筆`).join("、") || "沒有資料"}

可以從這些角度看：使用趨勢、AI 準確率代表什麼、資料庫還缺什麼、接下來可以改進哪裡。`;
}

// POST — 用目前的統計數字請 Gemini 寫一段摘要。
// 數字和提示詞都在伺服器這邊組，前端不能塞任意文字給 AI。
export async function POST() {
  const gate = await requirePrivilegedRead();
  if (!gate.ok) return gate.res;
  const admin = serviceClient();
  if (!admin) return NextResponse.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "NO_API_KEY", message: "伺服器沒有設定 AI 金鑰" }, { status: 503 });

  const allowed = gate.demoView
    ? await allowDemoAiCall()
    : await checkRateLimit(`analytics-ai:${gate.ctx.id}`, 5, 60);
  if (!allowed) {
    return NextResponse.json({
      error: "RATE_LIMIT",
      message: gate.demoView
        ? "展示帳號的 AI 額度是所有訪客共用的，現在用完了，晚一點再試。"
        : "一分鐘內最多產生 5 次摘要，稍等一下再按。",
    }, { status: 429 });
  }

  try {
    const onlyIds = gate.demoView ? await demoAccountIds(admin) : null;
    const stats = await collectStats(admin, onlyIds);
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(summaryPrompt(stats, gate.demoView));
    return NextResponse.json({ result: result.response.text() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Pro Analytics AI]", msg);
    if (msg.includes("429") || msg.includes("quota")) {
      return NextResponse.json({ error: "QUOTA_EXCEEDED", message: "Gemini 今天的配額用完了，明天再試。" }, { status: 429 });
    }
    return NextResponse.json({ error: "GEMINI_ERROR", message: "AI 這次沒有回應，等一下再試一次。" }, { status: 500 });
  }
}
