// 持久化速率限制（跨 Cloudflare Workers isolate 有效）。
// 取代原本各 route 的 in-memory Map — 那在 serverless edge 上每個 isolate 獨立、
// 隨時重置、不共享，等於無效。此處透過共用 Postgres 的原子 RPC 計數。
//
// 需先在 Supabase 執行 supabase/rate_limits.sql（建表 + check_rate_limit 函式）。

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;
function serviceClient(): SupabaseClient | null {
  if (cached) return cached;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!key || !url) return null;
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}

/**
 * 檢查並遞增指定 bucket 的計數。回傳 true = 允許，false = 超過限制。
 * @param bucket 識別鍵，例："gemini:<userId>"、"register:<ip>"
 * @param limit  視窗內允許的最大次數
 * @param windowSeconds 視窗長度（秒）
 *
 * 失效策略：DB 不可用（缺 key / RPC 錯誤）時 fail-open（放行）並記 log，
 * 避免限流機制本身成為單點故障癱瘓整個服務。
 */
export async function checkRateLimit(
  bucket: string, limit: number, windowSeconds: number,
): Promise<boolean> {
  const supabase = serviceClient();
  if (!supabase) {
    console.error("[rateLimit] SUPABASE_SERVICE_ROLE_KEY missing — failing open");
    return true;
  }
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("[rateLimit] rpc error, failing open:", error.message);
    return true;
  }
  return data === true;
}
