"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { createClient } from "@/lib/supabase";

// 展示帳號的密碼寫在 README，任何人都能登入同一個帳號、看到同一批資料。
// 所以要一直提醒：裡面都是虛構的，也千萬不要把真的病人資料打進來。
export default function DemoBanner() {
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: p } = await supabase
        .from("profiles").select("is_demo").eq("id", data.user.id).single();
      setIsDemo(p?.is_demo === true);
    });
  }, []);

  if (!isDemo) return null;
  return (
    <div role="note" style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "7px 24px", fontSize: 12, lineHeight: 1.6,
      background: "rgba(245,158,11,0.10)", borderBottom: "1px solid rgba(245,158,11,0.3)",
      color: "var(--pro-text)",
    }}>
      <Info size={13} color="#f59e0b" style={{ flexShrink: 0 }} />
      <span>
        這是<b>展示帳號</b>：裡面的病人和病歷都是虛構的，而且任何人都能登入這個帳號看到同樣的內容，
        請不要輸入真實的病人資料。
      </span>
    </div>
  );
}
