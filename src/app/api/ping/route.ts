import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const start = Date.now();

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );

    // Lightweight read — public table, no auth needed
    const { error } = await supabase
      .from("medical_references")
      .select("id")
      .limit(1);

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      supabase: "online",
      latency_ms: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    // 不對匿名訪客回傳原始錯誤（可能洩漏 schema/RLS/backend 資訊）；詳情只寫 server log。
    console.error("[ping] supabase check failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({
      ok: false,
      supabase: "error",
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}
