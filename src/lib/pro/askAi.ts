// 前端呼叫 /api/pro/gemini-clinical 的共用包裝。
// 以前五個頁面各寫一份，有的把 RATE_LIMIT 這種代碼直接顯示給醫師、有的失敗了畫面毫無反應、
// 有一頁甚至忘了帶 type 所以永遠 400。統一在這裡處理，錯誤一律轉成一句看得懂的話。

export interface ClinicalAiInput {
  patientContext?: string;
  labData?: string;
  symptoms?: string;
  soapDraft?: string;
}

export type ClinicalAiResult = { ok: true; text: string } | { ok: false; message: string };

function fallbackMessage(status: number): string {
  if (status === 401) return "登入已經過期，重新登入後再試一次。";
  if (status === 403) return "這個帳號要先完成兩步驟驗證，才能使用 AI 輔助。";
  if (status === 400) return "先填一些症狀或檢驗數值，AI 才有東西可以分析。";
  if (status === 429) return "AI 用得有點頻繁，稍等一下再試。";
  return "AI 這次沒有回應，等一下再試一次。";
}

export async function askClinicalAi(input: ClinicalAiInput): Promise<ClinicalAiResult> {
  try {
    const res = await fetch("/api/pro/gemini-clinical", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "clinical", ...input }),
    });
    const json = await res.json().catch(() => ({} as Record<string, unknown>));
    if (res.ok && typeof json.result === "string" && json.result.trim()) {
      return { ok: true, text: json.result };
    }
    return { ok: false, message: typeof json.message === "string" ? json.message : fallbackMessage(res.status) };
  } catch {
    return { ok: false, message: "連不上伺服器，檢查一下網路再試。" };
  }
}

/**
 * 送給 AI 的病人背景：只給判讀需要的年齡、性別、慢性病、過敏。
 * 姓名、生日、身分證這些可以認出是誰的資料不送出去 —— 對 AI 判讀沒有幫助，只會多一份外洩風險。
 */
export function patientContextForAi(p: {
  sex?: string | null;
  date_of_birth?: string | null;
  chronic_conditions?: string[] | null;
  allergies?: string[] | null;
}, today: Date = new Date()): string {
  const parts: string[] = [];
  if (p.date_of_birth) {
    const dob = new Date(p.date_of_birth);
    if (!Number.isNaN(dob.getTime())) {
      // 只有日期的字串會被當成 UTC 解析，所以生日用 UTC 取年月日；今天用本地日期
      let age = today.getFullYear() - dob.getUTCFullYear();
      const beforeBirthday = today.getMonth() < dob.getUTCMonth()
        || (today.getMonth() === dob.getUTCMonth() && today.getDate() < dob.getUTCDate());
      if (beforeBirthday) age -= 1;
      if (age >= 0 && age < 130) parts.push(`Age: ${age}`);
    }
  }
  if (p.sex) parts.push(`Sex: ${p.sex}`);
  if (p.chronic_conditions?.length) parts.push(`Chronic conditions: ${p.chronic_conditions.join(", ")}`);
  if (p.allergies?.length) parts.push(`Allergies: ${p.allergies.join(", ")}`);
  return parts.join(", ");
}
