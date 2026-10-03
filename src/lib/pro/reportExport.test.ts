import { describe, it, expect } from "vitest";
import { generateClinicalReportHTML, generatePrescriptionHTML } from "./reportExport";
import type { PatientRecord } from "./patientUtils";

// 報告用 document.write 寫進同源視窗，任何一個欄位沒跳脫就是 XSS。
// 這裡把每個欄位都塞進同一段惡意字串，確認輸出裡找不到可執行的標籤。
const EVIL = `<img src=x onerror="alert(document.cookie)">`;

const patient: PatientRecord = {
  id: "p1", doctor_id: "d1", full_name: EVIL, date_of_birth: "1990-01-01", sex: "F",
  id_number: null, phone: null, email: null, blood_type: EVIL,
  allergies: [EVIL], chronic_conditions: [EVIL], notes: null,
  created_at: "2026-01-01", updated_at: "2026-01-01",
};

describe("臨床報告匯出", () => {
  const html = generateClinicalReportHTML({
    patient, visitDate: EVIL, chiefComplaint: EVIL, subjective: EVIL,
    objective: { [EVIL]: EVIL }, assessment: EVIL, plan: EVIL,
    icd10Codes: [EVIL], aiAnalysis: EVIL, doctorName: EVIL, institution: EVIL,
  });

  it("使用者輸入不會變成 HTML 標籤", () => {
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/onerror="/);
    expect(html).toContain("&lt;img");
  });

  it("報告本身帶有禁止腳本的 CSP（跳脫之外的第二道保險）", () => {
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`);
  });
});

describe("藥單匯出", () => {
  const html = generatePrescriptionHTML({
    patientName: EVIL, patientDob: EVIL, visitDate: EVIL, doctorName: EVIL, institution: EVIL,
    items: [{ label: EVIL, days: 7, totalQty: EVIL, note: EVIL }],
  });

  it("使用者輸入不會變成 HTML 標籤", () => {
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("藥單也帶有禁止腳本的 CSP", () => {
    expect(html).toContain("Content-Security-Policy");
  });
});
