// Clinical report export utilities

import type { PatientRecord } from "./patientUtils";
import { calculateAge } from "./patientUtils";

// 報告是用 document.write 寫進「同源」的新視窗，裡面的病人姓名、主訴、SOAP、AI 分析
// 都是使用者輸入的內容。只要有一個欄位沒跳脫，寫進去的 <img onerror=...> 就能在主站執行。
// 所以：所有插值一律經過 esc()；另外在報告的 <head> 放一條 CSP 禁止任何腳本，當第二道保險。
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const NO_SCRIPT_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`;

export interface ClinicalReportData {
  patient: PatientRecord;
  visitDate: string;
  chiefComplaint?: string;
  subjective?: string;
  objective?: Record<string, number | string>;
  assessment?: string;
  plan?: string;
  icd10Codes?: string[];
  aiAnalysis?: string;
  doctorName?: string;
  institution?: string;
}

export function generateClinicalReportHTML(report: ClinicalReportData): string {
  const age = calculateAge(report.patient.date_of_birth);
  const sex = report.patient.sex === "M" ? "男" : report.patient.sex === "F" ? "女" : "—";

  const objRows = Object.entries(report.objective || {})
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`)
    .join("");

  const icdBadges = (report.icd10Codes || [])
    .map(c => `<span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:4px;font-size:12px;margin-right:4px;font-family:monospace;">${esc(c)}</span>`)
    .join("");

  const allergies = (report.patient.allergies || []).map(esc).join(", ");
  const chronic = (report.patient.chronic_conditions || []).map(esc).join(", ");

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
${NO_SCRIPT_CSP}
<title>臨床報告 - ${esc(report.patient.full_name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Noto Sans TC', Arial, sans-serif; font-size: 13px; color: #1e293b; background: #fff; padding: 0; }
  .page { max-width: 800px; margin: 0 auto; padding: 32px; }
  .header { border-bottom: 2px solid #1d4ed8; padding-bottom: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-start; }
  .logo { font-size: 20px; font-weight: 800; color: #1d4ed8; }
  .logo small { display: block; font-size: 11px; font-weight: 400; color: #64748b; }
  .patient-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin-bottom: 20px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .patient-card .field label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; }
  .patient-card .field value { font-size: 14px; font-weight: 600; color: #0f172a; }
  .section { margin-bottom: 18px; }
  .section h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #3b82f6; font-weight: 700; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid #e2e8f0; }
  .section p { line-height: 1.7; color: #334155; white-space: pre-wrap; }
  .obj-table { width: 100%; border-collapse: collapse; }
  .obj-table td { padding: 4px 8px; border-bottom: 1px solid #f1f5f9; }
  .obj-table td:first-child { color: #64748b; font-size: 12px; width: 50%; }
  .ai-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px; font-size: 12px; line-height: 1.7; white-space: pre-wrap; }
  .footer { border-top: 1px solid #e2e8f0; padding-top: 12px; margin-top: 24px; display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; }
  .stamp { text-align: right; }
  .stamp p { font-size: 13px; color: #1e293b; font-weight: 600; }
  @media print { body { padding: 0; } .page { padding: 20px; } }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="logo">
      ClinCalc Pro
      <small>醫師臨床決策系統 · Clinical Decision Support</small>
    </div>
    <div style="text-align:right; font-size:12px; color:#64748b;">
      <div>就診日期 Visit Date</div>
      <div style="font-weight:700; color:#1e293b;">${esc(report.visitDate)}</div>
    </div>
  </div>

  <div class="patient-card">
    <div class="field"><label>姓名 Name</label><value>${esc(report.patient.full_name)}</value></div>
    <div class="field"><label>年齡 Age</label><value>${age !== null ? `${esc(age)} 歲` : "—"}</value></div>
    <div class="field"><label>性別 Sex</label><value>${sex}</value></div>
    <div class="field"><label>血型 Blood Type</label><value>${esc(report.patient.blood_type || "—")}</value></div>
    ${allergies ? `<div class="field" style="grid-column:span 2"><label>過敏 Allergies</label><value style="color:#dc2626">${allergies}</value></div>` : ""}
    ${chronic ? `<div class="field" style="grid-column:span 2"><label>慢性病 Chronic Conditions</label><value>${chronic}</value></div>` : ""}
  </div>

  ${report.chiefComplaint ? `<div class="section"><h3>主訴 Chief Complaint</h3><p>${esc(report.chiefComplaint)}</p></div>` : ""}

  ${report.subjective ? `<div class="section"><h3>主觀病史 Subjective (S)</h3><p>${esc(report.subjective)}</p></div>` : ""}

  ${objRows ? `<div class="section"><h3>客觀數據 Objective (O)</h3><table class="obj-table">${objRows}</table></div>` : ""}

  ${report.assessment ? `<div class="section"><h3>評估 Assessment (A)</h3><p>${esc(report.assessment)}</p></div>` : ""}

  ${icdBadges ? `<div class="section"><h3>ICD-10 診斷碼</h3><div style="padding:4px 0">${icdBadges}</div></div>` : ""}

  ${report.plan ? `<div class="section"><h3>治療計畫 Plan (P)</h3><p>${esc(report.plan)}</p></div>` : ""}

  ${report.aiAnalysis ? `<div class="section"><h3>AI 臨床輔助分析</h3><div class="ai-box">${esc(report.aiAnalysis)}</div></div>` : ""}

  <div class="footer">
    <div>
      <p>⚠️ 本報告由 ClinCalc Pro 臨床輔助系統產生，僅供醫師參考。</p>
      <p>This report is generated by ClinCalc Pro for physician reference only.</p>
    </div>
    <div class="stamp">
      <p>${esc(report.doctorName || "主治醫師")}</p>
      ${report.institution ? `<p style="font-weight:400;color:#64748b;font-size:11px;">${esc(report.institution)}</p>` : ""}
      <p style="font-weight:400;color:#94a3b8;font-size:11px;">列印日期：${new Date().toLocaleDateString("zh-TW")}</p>
    </div>
  </div>
</div>
</body>
</html>`;
}

// ── Prescription slip ─────────────────────────────────────────

export interface PrescriptionItem {
  label: string;   // full label string e.g. "Metformin 500mg BID（隨餐）"
  days: number;
  totalQty: string; // auto-computed or manually overridden
  note: string;
}

export function generatePrescriptionHTML(opts: {
  patientName: string;
  patientDob?: string | null;
  visitDate: string;
  doctorName?: string;
  institution?: string;
  items: PrescriptionItem[];
}): string {
  const rows = opts.items.map(item => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;">${esc(item.label)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:13px;">${esc(item.days)} 天</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:13px;font-weight:600;">${esc(item.totalQty || "—")}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#64748b;">${esc(item.note || "")}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
${NO_SCRIPT_CSP}
<title>藥單 - ${esc(opts.patientName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Noto Sans TC', Arial, sans-serif; font-size: 13px; color: #1e293b; background: #fff; }
  .page { max-width: 700px; margin: 0 auto; padding: 28px 32px; }
  .header { border-bottom: 2px solid #1d4ed8; padding-bottom: 12px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-end; }
  .clinic-name { font-size: 18px; font-weight: 800; color: #1d4ed8; }
  .clinic-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
  .rx-title { font-size: 22px; font-weight: 800; color: #1e293b; letter-spacing: 0.05em; }
  .patient-row { display: flex; gap: 24px; background: #f8fafc; border-radius: 6px; padding: 10px 16px; margin-bottom: 18px; font-size: 13px; }
  .patient-row span { color: #64748b; }
  .patient-row strong { color: #0f172a; margin-left: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead th { background: #f1f5f9; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; text-align: left; }
  thead th:nth-child(2), thead th:nth-child(3) { text-align: center; }
  .footer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 32px; }
  .sign-box { border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 12px; color: #64748b; text-align: center; min-height: 50px; }
  .disclaimer { font-size: 11px; color: #94a3b8; margin-top: 20px; border-top: 1px solid #f1f5f9; padding-top: 10px; }
  @media print { body { padding: 0; } .page { padding: 16px; } }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="clinic-name">${esc(opts.institution || "ClinCalc Pro")}</div>
      <div class="clinic-sub">門診藥單 Outpatient Prescription</div>
    </div>
    <div class="rx-title">Rx</div>
  </div>

  <div class="patient-row">
    <div><span>病患</span><strong>${esc(opts.patientName)}</strong></div>
    ${opts.patientDob ? `<div><span>出生日期</span><strong>${esc(opts.patientDob)}</strong></div>` : ""}
    <div><span>就診日期</span><strong>${esc(opts.visitDate)}</strong></div>
    <div><span>列印日期</span><strong>${new Date().toLocaleDateString("zh-TW")}</strong></div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:55%">藥物名稱 / 劑量 / 頻率</th>
        <th style="width:12%">天數</th>
        <th style="width:13%">總量</th>
        <th>備註</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="footer-grid">
    <div class="sign-box">病患簽名 Patient Signature</div>
    <div class="sign-box">${esc(opts.doctorName || "醫師簽名 Physician Signature")}</div>
  </div>

  <div class="disclaimer">
    ⚠️ 本藥單由 ClinCalc Pro 輔助系統產生，請依醫囑按時服藥，如有不適請立即回診。
  </div>
</div>
</body>
</html>`;
}

export function printReport(html: string) {
  const win = window.open("", "_blank");
  if (!win) {
    alert("瀏覽器擋下了列印視窗。請在網址列右側允許這個網站開啟彈出視窗，再按一次列印。");
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 500);
}
