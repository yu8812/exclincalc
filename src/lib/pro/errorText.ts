// API 拒絕時回的 reason（authz.ts / 各 route）→ 一句看得懂的話。
// 管理頁共用，免得畫面上出現 FORBIDDEN、aal2_required 這種代碼。

export const REASON_TEXT: Record<string, string> = {
  aal2_required: "這個操作要先完成兩步驟驗證。",
  demo_account_read_only: "展示帳號只能瀏覽，不能修改任何資料。",
  not_admin: "只有管理員可以做這件事。",
  not_pro: "這個帳號還沒有開通 Pro 權限。",
  cannot_act_on_super_admin: "超級管理員的帳號只能由超級管理員處理。",
  cannot_act_on_other_admin: "其他管理員的帳號要請超級管理員處理。",
  cannot_change_own_role: "不能修改自己的角色。",
  cannot_delete_self: "不能刪除自己的帳號。",
  self_service_via_personal_flow: "自己的密碼和兩步驟驗證，請到「個人設定」修改。",
  role_assignment_forbidden: "只有超級管理員可以指派管理員角色。",
  target_not_found: "找不到這個帳號，可能已經被刪除了，請重新整理。",
  target_lookup_failed: "暫時查不到這個帳號的資料，請稍後再試。",
  invalid_role: "不認得這個角色。",
};

export function errorText(json: { error?: unknown; reason?: unknown } | null | undefined): string {
  if (json && typeof json.reason === "string" && REASON_TEXT[json.reason]) return REASON_TEXT[json.reason];
  // 中文訊息直接顯示；全大寫底線的代碼（FORBIDDEN、INVALID_JSON…）不要丟給使用者
  if (json && typeof json.error === "string" && !/^[A-Z_]+$/.test(json.error)) return json.error;
  return "操作沒有成功，請重新整理後再試一次。";
}

/** 呼叫 /api/pro/admin（藥物資料庫、醫療參考值的增修刪）。成功回 null，失敗回一句說明。 */
export async function adminDataRequest(method: "POST" | "PUT" | "DELETE", body: unknown): Promise<string | null> {
  try {
    const res = await fetch("/api/pro/admin", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    return errorText(await res.json().catch(() => null));
  } catch {
    return "連不上伺服器，檢查一下網路再試。";
  }
}
