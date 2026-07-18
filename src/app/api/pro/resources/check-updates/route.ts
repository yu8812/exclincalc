import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { KNOWN_UPDATES, findUpdate } from "@/lib/pro/resourceUpdates";
import { requireProAal2, requirePrivileged } from "@/lib/pro/serverAuth";

interface ResourceRow {
  id: string;
  title: string;
  year: string | null;
  url: string | null;
  source: string | null;
  category: string;
}

export interface UpdateResult {
  resourceId: string;
  currentTitle: string;
  currentYear: string | null;
  latestYear: string;
  latestTitle: string;
  latestUrl: string;
  source: string;
  changeNote: string;
  category: string;
}

export async function GET() {
  // SEC001D-02：需 is_pro + AAL2
  const gate = await requireProAal2();
  if (!gate.ok) return gate.res;
  const supabase = await createServerSupabaseClient();

  // Fetch all resources
  const { data: resources, error } = await supabase
    .from("pro_resources")
    .select("id, title, year, url, source, category")
    .eq("is_public", true);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: UpdateResult[] = [];

  for (const r of (resources as ResourceRow[]) || []) {
    const known = findUpdate(r.title);
    if (!known) continue;

    // Check if this resource is outdated
    const currentYear = parseInt(r.year || "0");
    const latestYear = parseInt(known.latestYear);
    const urlOutdated = r.url !== known.latestUrl;

    if (currentYear < latestYear || urlOutdated) {
      results.push({
        resourceId: r.id,
        currentTitle: r.title,
        currentYear: r.year,
        latestYear: known.latestYear,
        latestTitle: known.latestTitle,
        latestUrl: known.latestUrl,
        source: known.source,
        changeNote: known.changeNote,
        category: known.category,
      });
    }
  }

  // Also return unmatched known updates (resources not in DB yet)
  const matchedTitles = new Set(results.map(r => r.currentTitle.toLowerCase()));
  const missing = KNOWN_UPDATES.filter(
    ku => !((resources as ResourceRow[]) || []).some(r => r.title.toLowerCase().includes(ku.titleMatch.toLowerCase()))
  ).map(ku => ({
    resourceId: null,
    currentTitle: null,
    currentYear: null,
    latestYear: ku.latestYear,
    latestTitle: ku.latestTitle,
    latestUrl: ku.latestUrl,
    source: ku.source,
    changeNote: ku.changeNote,
    category: ku.category,
  }));

  void matchedTitles;

  return NextResponse.json({ updates: results, missing, checkedAt: new Date().toISOString() });
}

// PATCH: apply an update to a specific resource
export async function PATCH(req: Request) {
  // SEC001D-02/RR13：需 admin + 目前 is_pro + AAL2（原本只查 role）
  const gate = await requirePrivileged();
  if (!gate.ok) return gate.res;
  const supabase = await createServerSupabaseClient();

  const { resourceId, latestTitle, latestYear, latestUrl, source } = await req.json();
  if (!resourceId) return NextResponse.json({ error: "Missing resourceId" }, { status: 400 });

  const { error } = await supabase.from("pro_resources").update({
    title: latestTitle,
    year: latestYear,
    url: latestUrl,
    source,
  }).eq("id", resourceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
