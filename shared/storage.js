import { dateKey } from "./utils.js";

export const DEFAULT_SETTINGS = {
  trackingEnabled: true,
  idleThresholdSeconds: 60,
  excludedDomains: [],
  retentionDays: 90,
};

export const STORAGE_KEYS = {
  timeData: "timeData",
  settings: "settings",
  sessionState: "sessionState",
};

export async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
}

export async function saveSettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  merged.excludedDomains = normalizeDomainList(merged.excludedDomains);
  merged.idleThresholdSeconds = clamp(
    Number(merged.idleThresholdSeconds) || DEFAULT_SETTINGS.idleThresholdSeconds,
    15,
    300
  );
  merged.retentionDays = clamp(Number(merged.retentionDays) || 90, 7, 3650);
  merged.trackingEnabled = Boolean(merged.trackingEnabled);
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: merged });
  return merged;
}

export async function getTimeData() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.timeData);
  return result.timeData || {};
}

export async function saveTimeData(timeData) {
  await chrome.storage.local.set({ [STORAGE_KEYS.timeData]: timeData });
}

export async function addSeconds(domain, seconds, day = dateKey()) {
  const amount = Math.round(Number(seconds) || 0);
  if (!domain || amount <= 0) return;
  const timeData = await getTimeData();
  if (!timeData[day]) timeData[day] = {};
  timeData[day][domain] = (Number(timeData[day][domain]) || 0) + amount;
  await saveTimeData(timeData);
}

export async function pruneOldData(retentionDays, today = dateKey()) {
  const keep = Math.max(7, Number(retentionDays) || 90);
  const timeData = await getTimeData();
  const cutoff = new Date();
  const [y, m, d] = today.split("-").map(Number);
  cutoff.setFullYear(y, m - 1, d);
  cutoff.setDate(cutoff.getDate() - keep);

  let changed = false;
  for (const key of Object.keys(timeData)) {
    const [ky, km, kd] = key.split("-").map(Number);
    const date = new Date(ky, km - 1, kd);
    if (date < cutoff) {
      delete timeData[key];
      changed = true;
    }
  }
  if (changed) await saveTimeData(timeData);
  return timeData;
}

export async function clearTimeData() {
  await chrome.storage.local.set({ [STORAGE_KEYS.timeData]: {} });
}

export async function getSessionState() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.sessionState);
  return result.sessionState || null;
}

export async function saveSessionState(session) {
  await chrome.storage.local.set({ [STORAGE_KEYS.sessionState]: session });
}

export function normalizeDomainList(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    let host = String(raw || "").trim().toLowerCase();
    host = host.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (host.startsWith("www.")) host = host.slice(4);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
