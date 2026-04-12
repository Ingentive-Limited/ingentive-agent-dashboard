import { describe, it, expect } from "vitest";
import { toCSV } from "@/lib/export";

describe("toCSV", () => {
  it("generates CSV from array of objects", () => {
    const rows = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ];
    const csv = toCSV(rows);
    expect(csv).toBe("name,age\nAlice,30\nBob,25");
  });

  it("uses custom column labels", () => {
    const rows = [{ name: "Alice", age: 30 }];
    const csv = toCSV(rows, [
      { key: "name", label: "Full Name" },
      { key: "age", label: "Age (years)" },
    ]);
    expect(csv).toContain("Full Name");
    expect(csv).toContain("Age (years)");
  });

  it("escapes commas in values", () => {
    const rows = [{ name: "Smith, John", age: 40 }];
    const csv = toCSV(rows);
    expect(csv).toContain('"Smith, John"');
  });

  it("escapes double quotes in values", () => {
    const rows = [{ name: 'Say "hello"', age: 25 }];
    const csv = toCSV(rows);
    expect(csv).toContain('"Say ""hello"""');
  });

  it("returns empty string for empty array", () => {
    expect(toCSV([])).toBe("");
  });

  it("neutralizes CSV formula injection with = prefix", () => {
    const rows = [{ formula: "=CMD()" }];
    const csv = toCSV(rows);
    expect(csv).toContain("'=CMD()");
  });

  it("neutralizes CSV formula injection with + prefix", () => {
    const rows = [{ formula: "+1234" }];
    const csv = toCSV(rows);
    expect(csv).toContain("'+1234");
  });

  it("neutralizes CSV formula injection with - prefix", () => {
    const rows = [{ formula: "-1+2" }];
    const csv = toCSV(rows);
    expect(csv).toContain("'-1+2");
  });

  it("neutralizes CSV formula injection with @ prefix", () => {
    const rows = [{ formula: "@SUM(A1)" }];
    const csv = toCSV(rows);
    expect(csv).toContain("'@SUM(A1)");
  });

  it("handles undefined values gracefully", () => {
    const rows = [{ name: "Alice", missing: undefined }];
    const csv = toCSV(rows as Record<string, unknown>[]);
    expect(csv).toContain("Alice,");
  });
});
