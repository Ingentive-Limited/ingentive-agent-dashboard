"use client";

/**
 * Export data as a downloadable file.
 */
export function downloadFile(
  data: string,
  filename: string,
  mimeType: string
) {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Convert array of objects to CSV string.
 */
export function toCSV(
  rows: Record<string, unknown>[],
  columns?: { key: string; label: string }[]
): string {
  if (rows.length === 0) return "";

  const cols = columns || Object.keys(rows[0]).map((k) => ({ key: k, label: k }));
  const header = cols.map((c) => escapeCSV(c.label)).join(",");
  const body = rows
    .map((row) =>
      cols.map((c) => escapeCSV(String(row[c.key] ?? ""))).join(",")
    )
    .join("\n");

  return header + "\n" + body;
}

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Export as JSON file.
 */
export function exportJSON(data: unknown, filename: string) {
  downloadFile(JSON.stringify(data, null, 2), filename, "application/json");
}

/**
 * Export as CSV file.
 */
export function exportCSV(
  rows: Record<string, unknown>[],
  filename: string,
  columns?: { key: string; label: string }[]
) {
  downloadFile(toCSV(rows, columns), filename, "text/csv");
}
