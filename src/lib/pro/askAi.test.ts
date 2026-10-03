import { describe, it, expect } from "vitest";
import { patientContextForAi } from "./askAi";

describe("patientContextForAi：送給 AI 的病人背景不含可識別資料", () => {
  const patient = {
    full_name: "王小明",
    id_number: "A123456789",
    phone: "0912345678",
    sex: "M",
    date_of_birth: "1980-06-15",
    chronic_conditions: ["高血壓", "第二型糖尿病"],
    allergies: ["Penicillin"],
  };

  it("不會出現姓名、生日、身分證、電話", () => {
    const text = patientContextForAi(patient, new Date("2026-10-03"));
    for (const secret of ["王小明", "1980", "06-15", "A123456789", "0912345678"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("留下年齡、性別、慢性病、過敏", () => {
    expect(patientContextForAi(patient, new Date("2026-10-03")))
      .toBe("Age: 46, Sex: M, Chronic conditions: 高血壓, 第二型糖尿病, Allergies: Penicillin");
  });

  it("生日還沒到就少算一歲", () => {
    expect(patientContextForAi({ date_of_birth: "1980-12-01" }, new Date("2026-10-03"))).toBe("Age: 45");
  });

  it("欄位缺漏或生日格式錯誤時不會壞掉", () => {
    expect(patientContextForAi({})).toBe("");
    expect(patientContextForAi({ date_of_birth: "not-a-date", sex: "F" })).toBe("Sex: F");
  });
});
