import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { checkInteractions } from "@/lib/pro/drugInteractions";
import { requireProAal2 } from "@/lib/pro/serverAuth";

export async function POST(req: NextRequest) {
  // SEC001D-02：需 is_pro + AAL2
  const gate = await requireProAal2();
  if (!gate.ok) return gate.res;
  const supabase = await createServerSupabaseClient();

  let body: { drugs?: string[]; patientId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 }); }

  const { drugs } = body;
  if (!Array.isArray(drugs) || drugs.length < 2) {
    return NextResponse.json({ error: "NEED_AT_LEAST_TWO_DRUGS" }, { status: 400 });
  }

  // Fetch medication interaction data from DB
  const { data: meds } = await supabase
    .from("medications")
    .select("name_zh, name_en, generic_name, interactions")
    .in("name_zh", drugs);

  // Static + DB interaction check
  const pairs = checkInteractions(drugs, meds || []);

  // AI narrative via Gemini
  const apiKey = process.env.GEMINI_API_KEY;
  let aiNarrative = "";

  if (apiKey) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      const pairsText = pairs.length > 0
        ? pairs.map(p => `${p.drugA} × ${p.drugB}: [${p.severity}] ${p.description}`).join("\n")
        : "No significant interactions detected in the static database.";

      const prompt = `You are a clinical pharmacology consultant providing drug interaction analysis for a licensed physician.

Drug list: ${drugs.join(", ")}

Pre-computed interaction flags:
${pairsText}

Please provide:
1. A concise clinical summary of the most important drug interactions in this combination
2. Mechanism of each significant interaction
3. Clinical monitoring recommendations
4. Any suggested medication adjustments or alternatives
5. Overall safety assessment of this medication combination

Respond in Traditional Chinese (繁體中文). Use clinical terminology appropriate for physicians.`;

      const result = await model.generateContent(prompt);
      aiNarrative = result.response.text();
    } catch (err) {
      console.error("[Pro Drug Interactions AI]", err);
    }
  }

  return NextResponse.json({ pairs, aiNarrative });
}
