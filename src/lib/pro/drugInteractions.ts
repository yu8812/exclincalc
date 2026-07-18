// Drug interaction checker (v2 — class-aware)
//
// 為什麼重寫（v1 的缺陷）：
//   舊版靜態規則用 "ssri" / "nsaid" / "nitrate" 等「藥物類別字串」，對藥名 alias
//   （name_zh + name_en + generic）做 substring 比對。但實際 generic name
//   （Escitalopram、Diclofenac…）根本不含 "ssri" / "nsaid" 這種字串，
//   所以多組關鍵警示「永遠不會觸發」，只有 DB 別名剛好寫到才偶然命中。
//
// v2 作法：
//   1. 以 generic name（英文 INN）為主鍵，建立 generic → drug class tags 對照表。
//   2. 規則的每一邊可以是「具體 generic 名」{g} 或「藥物類別」{c} 或「關鍵字」{kw}。
//   3. 比對時把每個輸入藥物解析成 profile = { tokens, classes }，用「精確 token / 精確 class」
//      比對，避免 substring 的漏判與誤判。
//   4. 保留 medications.interactions[] 自由文字欄位的補充檢查（v1 既有行為）。

export interface InteractionResult {
  drugA: string;
  drugB: string;
  severity: "contraindicated" | "major" | "moderate" | "minor" | "none";
  description: string;
}

// Severity order for sorting
export const SEVERITY_ORDER: Record<InteractionResult["severity"], number> = {
  contraindicated: 0,
  major: 1,
  moderate: 2,
  minor: 3,
  none: 4,
};

export const SEVERITY_LABEL: Record<InteractionResult["severity"], { zh: string; color: string; bg: string }> = {
  contraindicated: { zh: "禁忌", color: "#ef4444", bg: "rgba(239,68,68,0.15)" },
  major:           { zh: "重大", color: "#f97316", bg: "rgba(249,115,22,0.15)" },
  moderate:        { zh: "中度", color: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
  minor:           { zh: "輕微", color: "#94a3b8", bg: "rgba(148,163,184,0.1)" },
  none:            { zh: "無",   color: "#10b981", bg: "rgba(16,185,129,0.1)" },
};

// ── 藥物類別 tag ─────────────────────────────────────────────────────
type DrugClass =
  | "nsaid" | "ssri" | "snri" | "serotonergic"
  | "statin" | "cyp3a4_statin"
  | "nitrate" | "pde5"
  | "anticoagulant" | "antiplatelet"
  | "acei" | "arb"
  | "fluoroquinolone" | "macrolide"
  | "biguanide" | "ppi" | "cyp2c19_ppi"
  | "cyp3a4_inhibitor";

// generic name（小寫 INN）→ class tags。
// 涵蓋種子藥物 + 常見手動處方藥名。cyp3a4_statin / cyp2c19_ppi 是刻意的細分類，
// 用來避免對「安全替代藥」（rosuvastatin、pantoprazole）過度警示。
const GENERIC_CLASSES: Record<string, DrugClass[]> = {
  // NSAIDs（aspirin 兼具抗血小板）
  "acetylsalicylic acid": ["nsaid", "antiplatelet"],
  "aspirin":              ["nsaid", "antiplatelet"],
  "ibuprofen":            ["nsaid"],
  "diclofenac":           ["nsaid"],
  "naproxen":             ["nsaid"],
  "ketorolac":            ["nsaid"],
  "celecoxib":            ["nsaid"],
  "meloxicam":            ["nsaid"],
  "indomethacin":         ["nsaid"],
  "mefenamic acid":       ["nsaid"],
  // SSRI / SNRI（皆為 serotonergic）
  "escitalopram": ["ssri", "serotonergic"],
  "citalopram":   ["ssri", "serotonergic"],
  "sertraline":   ["ssri", "serotonergic"],
  "fluoxetine":   ["ssri", "serotonergic"],
  "paroxetine":   ["ssri", "serotonergic"],
  "fluvoxamine":  ["ssri", "serotonergic"],
  "venlafaxine":  ["snri", "serotonergic"],
  "duloxetine":   ["snri", "serotonergic"],
  "tramadol":     ["serotonergic"],
  // Statins（cyp3a4_statin 才與 CYP3A4 抑制劑有臨床顯著交互）
  "simvastatin":  ["statin", "cyp3a4_statin"],
  "lovastatin":   ["statin", "cyp3a4_statin"],
  "atorvastatin": ["statin", "cyp3a4_statin"],
  "rosuvastatin": ["statin"],
  "pravastatin":  ["statin"],
  "pitavastatin": ["statin"],
  // Nitrates
  "nitroglycerin":          ["nitrate"],
  "glyceryl trinitrate":    ["nitrate"],
  "isosorbide dinitrate":   ["nitrate"],
  "isosorbide mononitrate": ["nitrate"],
  // PDE-5 抑制劑
  "sildenafil": ["pde5"],
  "tadalafil":  ["pde5"],
  "vardenafil": ["pde5"],
  "avanafil":   ["pde5"],
  // 抗凝血 / 抗血小板
  "warfarin":    ["anticoagulant"],
  "clopidogrel": ["antiplatelet"],
  "ticagrelor":  ["antiplatelet"],
  "prasugrel":   ["antiplatelet"],
  // ACEI / ARB
  "captopril":   ["acei"],
  "enalapril":   ["acei"],
  "lisinopril":  ["acei"],
  "ramipril":    ["acei"],
  "losartan":    ["arb"],
  "valsartan":   ["arb"],
  "candesartan": ["arb"],
  "irbesartan":  ["arb"],
  // 抗生素
  "ciprofloxacin":  ["fluoroquinolone"],
  "levofloxacin":   ["fluoroquinolone"],
  "moxifloxacin":   ["fluoroquinolone"],
  "ofloxacin":      ["fluoroquinolone"],
  "azithromycin":   ["macrolide", "cyp3a4_inhibitor"],
  "clarithromycin": ["macrolide", "cyp3a4_inhibitor"],
  "erythromycin":   ["macrolide", "cyp3a4_inhibitor"],
  // 其他 CYP3A4 抑制劑
  "amiodarone":   ["cyp3a4_inhibitor"],
  "ketoconazole": ["cyp3a4_inhibitor"],
  "itraconazole": ["cyp3a4_inhibitor"],
  // 降血糖
  "metformin": ["biguanide"],
  // PPI（cyp2c19_ppi 才顯著抑制 clopidogrel 活化）
  "omeprazole":   ["ppi", "cyp2c19_ppi"],
  "esomeprazole": ["ppi", "cyp2c19_ppi"],
  "lansoprazole": ["ppi", "cyp2c19_ppi"],
  "pantoprazole": ["ppi"],
};

// ── 規則定義 ─────────────────────────────────────────────────────────
type Side = { g: string } | { c: DrugClass } | { kw: RegExp };

interface Rule {
  a: Side;
  b: Side;
  severity: InteractionResult["severity"];
  description: string;
}

const RULES: Rule[] = [
  {
    a: { g: "warfarin" }, b: { c: "nsaid" },
    severity: "major",
    description: "Warfarin 與 NSAIDs 併用：NSAIDs 抑制血小板並置換蛋白結合，雙重提升出血風險（胃腸道、顱內）。臨床建議：改用 Acetaminophen 止痛；必要時密切監測 INR 與出血徵象、加 PPI 保護胃黏膜。",
  },
  {
    a: { g: "warfarin" }, b: { c: "antiplatelet" },
    severity: "major",
    description: "Warfarin 與抗血小板藥（Aspirin / Clopidogrel）併用顯著增加出血風險。臨床建議：僅在明確適應症（如機械瓣膜 + 支架）下合併，並嚴密監測 INR 與出血徵象。",
  },
  {
    a: { c: "pde5" }, b: { c: "nitrate" },
    severity: "contraindicated",
    description: "PDE-5 抑制劑與硝酸鹽類併用會造成嚴重低血壓（可達休克程度）。臨床建議：絕對禁用；服用 Sildenafil 後至少間隔 24 小時（Tadalafil 48 小時）才可給硝酸鹽。急性胸痛病患用過 PDE-5 者勿給 NTG。",
  },
  {
    a: { c: "cyp3a4_statin" }, b: { c: "cyp3a4_inhibitor" },
    severity: "major",
    description: "CYP3A4 代謝的 Statin（Simvastatin / Lovastatin / Atorvastatin）與 CYP3A4 抑制劑（Amiodarone、大環內酯類、azole）併用，Statin 血中濃度上升，增加肌病變與橫紋肌溶解風險。臨床建議：降低 Statin 劑量或改用 Pravastatin / Rosuvastatin（非 CYP3A4 代謝）。",
  },
  {
    a: { g: "amlodipine" }, b: { g: "simvastatin" },
    severity: "moderate",
    description: "Amlodipine 弱抑制 CYP3A4，使 Simvastatin 暴露量增加、提高肌病變風險。臨床建議：合併使用時 Simvastatin 不超過 20 mg/day。",
  },
  {
    a: { g: "clopidogrel" }, b: { c: "cyp2c19_ppi" },
    severity: "moderate",
    description: "Omeprazole / Esomeprazole / Lansoprazole 抑制 CYP2C19，降低 Clopidogrel 活化、削弱抗血小板效果。臨床建議：改用 Pantoprazole 或 H2 blocker。",
  },
  {
    a: { c: "ssri" }, b: { g: "tramadol" },
    severity: "major",
    description: "SSRI 與 Tramadol 皆增加血清素，併用有血清素症候群風險（躁動、肌陣攣、出汗、體溫升高、意識改變）。臨床建議：避免合併；必要時密切監測並備支持治療。",
  },
  {
    a: { c: "snri" }, b: { g: "tramadol" },
    severity: "major",
    description: "SNRI 與 Tramadol 皆增加血清素，併用有血清素症候群風險。臨床建議：避免合併；必要時密切監測。",
  },
  {
    a: { g: "methotrexate" }, b: { c: "nsaid" },
    severity: "major",
    description: "NSAIDs 降低 Methotrexate 腎清除率，導致 MTX 毒性（全血球減少、口腔潰瘍、肝毒性）。臨床建議：避免合併；必要時密切監測 CBC 與肝腎功能。",
  },
  {
    a: { g: "digoxin" }, b: { g: "amiodarone" },
    severity: "major",
    description: "Amiodarone 抑制 P-glycoprotein 並降低 Digoxin 腎清除率，可能造成 Digoxin 中毒（噁心、視力異常、心律不整）。臨床建議：Digoxin 減半量，監測血中濃度。",
  },
  {
    a: { g: "metformin" }, b: { kw: /contrast|顯影|造影|碘/i },
    severity: "major",
    description: "碘造影劑可能造成急性腎傷害，進而提高 Metformin 相關乳酸中毒風險。臨床建議：造影前 48 小時停 Metformin，待腎功能恢復再恢復用藥。",
  },
  {
    a: { c: "fluoroquinolone" }, b: { kw: /antacid|制酸|鈣|鎂|鋁|aluminum|magnesium|calcium/i },
    severity: "moderate",
    description: "制酸劑中的二價/三價陽離子（Ca²⁺、Mg²⁺、Al³⁺）與氟喹諾酮類螯合，降低吸收率達 50%。臨床建議：兩藥服用間隔至少 2 小時。",
  },
];

// ── 解析與比對 ───────────────────────────────────────────────────────

type MedRow = { name_zh: string; name_en: string; generic_name: string | null; interactions: string[] | null };

interface DrugProfile {
  raw: string;
  tokens: Set<string>;     // 小寫：raw + name_zh + name_en + generic_name
  classes: Set<DrugClass>;
}

function resolveProfile(name: string, medsDB?: MedRow[]): DrugProfile {
  const tokens = new Set<string>([name.toLowerCase()]);

  const med = medsDB?.find(m =>
    m.name_zh === name ||
    m.name_en.toLowerCase() === name.toLowerCase() ||
    (m.generic_name?.toLowerCase() === name.toLowerCase())
  );
  if (med) {
    tokens.add(med.name_zh.toLowerCase());
    tokens.add(med.name_en.toLowerCase());
    if (med.generic_name) tokens.add(med.generic_name.toLowerCase());
  }

  const classes = new Set<DrugClass>();
  for (const t of tokens) {
    const cls = GENERIC_CLASSES[t];
    if (cls) cls.forEach(c => classes.add(c));
  }

  return { raw: name, tokens, classes };
}

function sideMatches(side: Side, p: DrugProfile): boolean {
  if ("c" in side) return p.classes.has(side.c);
  if ("g" in side) return p.tokens.has(side.g);
  // kw：對所有 token 做關鍵字比對（顯影劑、制酸劑等非結構化藥名）
  return [...p.tokens].some(t => side.kw.test(t));
}

/**
 * 檢查一組藥名之間的交互作用。
 * @param drugNames 藥名清單（可為中文品名 / 英文品名 / generic）
 * @param medsWithInteractions 從 medications 表撈出的藥物（用於解析別名 + 補充 interactions[] 檢查）
 */
export function checkInteractions(
  drugNames: string[],
  medsWithInteractions?: MedRow[],
): InteractionResult[] {
  const results: InteractionResult[] = [];
  const seen = new Set<string>();

  const profiles = drugNames.map(n => resolveProfile(n, medsWithInteractions));

  for (let i = 0; i < drugNames.length; i++) {
    for (let j = i + 1; j < drugNames.length; j++) {
      const pA = profiles[i];
      const pB = profiles[j];
      const pairKey = [drugNames[i], drugNames[j]].sort().join("||");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      let matched = false;

      // 1) 規則表（class / generic / keyword 感知）
      for (const rule of RULES) {
        const hit =
          (sideMatches(rule.a, pA) && sideMatches(rule.b, pB)) ||
          (sideMatches(rule.a, pB) && sideMatches(rule.b, pA));
        if (hit) {
          results.push({
            drugA: drugNames[i], drugB: drugNames[j],
            severity: rule.severity, description: rule.description,
          });
          matched = true;
          break; // 每對只取第一條（規則表已按嚴重度排序）
        }
      }

      // 2) medications.interactions[] 自由文字補充（僅在規則未命中時，避免蓋掉具體警示）
      if (!matched && medsWithInteractions) {
        const medA = medsWithInteractions.find(m => pA.tokens.has(m.name_zh.toLowerCase()) || pA.tokens.has(m.name_en.toLowerCase()) || (m.generic_name != null && pA.tokens.has(m.generic_name.toLowerCase())));
        const medB = medsWithInteractions.find(m => pB.tokens.has(m.name_zh.toLowerCase()) || pB.tokens.has(m.name_en.toLowerCase()) || (m.generic_name != null && pB.tokens.has(m.generic_name.toLowerCase())));

        const aliasesOf = (m?: MedRow, fallback?: DrugProfile): string[] =>
          m ? [m.name_zh, m.name_en, m.generic_name].filter(Boolean).map(s => (s as string).toLowerCase())
            : [...(fallback?.tokens ?? [])];

        const listMentions = (med: MedRow | undefined, targetAliases: string[]): boolean => {
          if (!med?.interactions) return false;
          return med.interactions.some(entry => {
            const lowered = entry.toLowerCase();
            return targetAliases.some(alias => alias.length > 1 && lowered.includes(alias));
          });
        };

        if (listMentions(medA, aliasesOf(medB, pB)) || listMentions(medB, aliasesOf(medA, pA))) {
          results.push({
            drugA: drugNames[i], drugB: drugNames[j],
            severity: "moderate",
            description: "藥品仿單標示此兩者間存在交互作用，請檢視個別藥品資訊評估臨床顯著性。",
          });
        }
      }
    }
  }

  return results.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function getWorstSeverity(results: InteractionResult[]): InteractionResult["severity"] {
  if (results.length === 0) return "none";
  return results.reduce((worst, r) =>
    SEVERITY_ORDER[r.severity] < SEVERITY_ORDER[worst] ? r.severity : worst,
    "none" as InteractionResult["severity"]
  );
}
