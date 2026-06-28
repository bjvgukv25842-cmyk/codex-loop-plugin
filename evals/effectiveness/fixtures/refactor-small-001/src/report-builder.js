export function buildSummaryReport(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const createdAt = new Date(data?.createdAt ?? "2026-01-01T00:00:00Z");
  const date = [
    createdAt.getUTCFullYear(),
    String(createdAt.getUTCMonth() + 1).padStart(2, "0"),
    String(createdAt.getUTCDate()).padStart(2, "0")
  ].join("-");
  const title = String(data?.title ?? "Untitled").trim();
  const status = String(data?.status ?? "draft").trim().toLowerCase();
  const statusLabel = status === "published" ? "Published" : status === "archived" ? "Archived" : "Draft";
  const total = items.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);

  return [
    `Report: ${title}`,
    `Date: ${date}`,
    `Status: ${statusLabel}`,
    `Items: ${items.length}`,
    `Total: $${total.toFixed(2)}`
  ].join("\n");
}

export function buildDetailedReport(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const createdAt = new Date(data?.createdAt ?? "2026-01-01T00:00:00Z");
  const date = [
    createdAt.getUTCFullYear(),
    String(createdAt.getUTCMonth() + 1).padStart(2, "0"),
    String(createdAt.getUTCDate()).padStart(2, "0")
  ].join("-");
  const title = String(data?.title ?? "Untitled").trim();
  const owner = String(data?.owner ?? "Unassigned").trim();
  const status = String(data?.status ?? "draft").trim().toLowerCase();
  const statusLabel = status === "published" ? "Published" : status === "archived" ? "Archived" : "Draft";
  const lines = [
    `Report: ${title}`,
    `Owner: ${owner}`,
    `Date: ${date}`,
    `Status: ${statusLabel}`,
    "Items:"
  ];

  for (const item of items) {
    const name = String(item.name ?? "Unnamed").trim();
    const amount = Number(item.amount ?? 0);
    lines.push(`- ${name}: $${amount.toFixed(2)}`);
  }

  const total = items.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  lines.push(`Total: $${total.toFixed(2)}`);
  return lines.join("\n");
}

export function buildCsvReport(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const createdAt = new Date(data?.createdAt ?? "2026-01-01T00:00:00Z");
  const date = [
    createdAt.getUTCFullYear(),
    String(createdAt.getUTCMonth() + 1).padStart(2, "0"),
    String(createdAt.getUTCDate()).padStart(2, "0")
  ].join("-");
  const title = String(data?.title ?? "Untitled").trim();
  const status = String(data?.status ?? "draft").trim().toLowerCase();
  const statusLabel = status === "published" ? "Published" : status === "archived" ? "Archived" : "Draft";
  const rows = ["title,date,status,item,amount"];

  for (const item of items) {
    const name = String(item.name ?? "Unnamed").trim();
    const amount = Number(item.amount ?? 0);
    rows.push([title, date, statusLabel, name, amount.toFixed(2)].map(csvEscape).join(","));
  }

  return rows.join("\n");
}

function csvEscape(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}
