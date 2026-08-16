/** Pure helpers shared by the service worker, popup, and dashboard. */

export function extractDomain(urlString) {
  if (!urlString || typeof urlString !== "string") return null;
  try {
    const url = new URL(urlString);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    let host = url.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    if (!host || host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return host || null;
    }
    return host;
  } catch {
    return null;
  }
}

/** Local calendar date as YYYY-MM-DD (user timezone, not UTC). */
export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

export function eachDateKey(startKey, endKey) {
  const keys = [];
  let cursor = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  while (cursor <= end) {
    keys.push(dateKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return keys;
}

export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (seconds === 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 && h === 0 && m < 5 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

export function formatHours(totalSeconds, digits = 1) {
  const hours = (Number(totalSeconds) || 0) / 3600;
  return `${hours.toFixed(digits)}h`;
}

export function sumValues(obj) {
  return Object.values(obj || {}).reduce((acc, n) => acc + (Number(n) || 0), 0);
}

/**
 * Aggregate timeData over an inclusive date-key range.
 * Returns { byDomain, byDate, totalSeconds }.
 */
export function aggregateRange(timeData, startKey, endKey) {
  const keys = eachDateKey(startKey, endKey);
  const byDomain = {};
  const byDate = {};
  let totalSeconds = 0;

  for (const key of keys) {
    const day = timeData[key] || {};
    let dayTotal = 0;
    for (const [domain, seconds] of Object.entries(day)) {
      const value = Number(seconds) || 0;
      byDomain[domain] = (byDomain[domain] || 0) + value;
      dayTotal += value;
    }
    byDate[key] = dayTotal;
    totalSeconds += dayTotal;
  }

  return { byDomain, byDate, totalSeconds, keys };
}

export function rankedDomains(byDomain, { limit = Infinity, otherLabel = "Other" } = {}) {
  const entries = Object.entries(byDomain)
    .map(([domain, seconds]) => ({ domain, seconds: Number(seconds) || 0 }))
    .filter((row) => row.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);

  if (entries.length <= limit) return entries;

  const head = entries.slice(0, limit);
  const rest = entries.slice(limit);
  const otherSeconds = rest.reduce((acc, row) => acc + row.seconds, 0);
  if (otherSeconds > 0) head.push({ domain: otherLabel, seconds: otherSeconds, isOther: true });
  return head;
}

export function bucketSmallShares(rows, { minShare = 0.01, otherLabel = "Other" } = {}) {
  const total = rows.reduce((acc, row) => acc + row.seconds, 0);
  if (total <= 0) return rows;
  const kept = [];
  let other = 0;
  for (const row of rows) {
    if (row.isOther || row.seconds / total < minShare) other += row.seconds;
    else kept.push(row);
  }
  if (other > 0) kept.push({ domain: otherLabel, seconds: other, isOther: true });
  return kept;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function downloadBlob(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function timeDataToCsv(timeData) {
  const lines = ["date,domain,seconds,hours"];
  const dates = Object.keys(timeData).sort();
  for (const date of dates) {
    const domains = Object.entries(timeData[date] || {}).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
    for (const [domain, seconds] of domains) {
      const sec = Number(seconds) || 0;
      lines.push(`${date},${csvCell(domain)},${sec},${(sec / 3600).toFixed(4)}`);
    }
  }
  return lines.join("\n") + "\n";
}

function csvCell(value) {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export const CHART_COLORS = [
  "#f0b429",
  "#3ecfbe",
  "#7c9cff",
  "#f07178",
  "#c3e88d",
  "#c792ea",
  "#ff9e64",
  "#89ddff",
  "#ffd580",
  "#82aaff",
];
