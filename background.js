import { extractDomain, dateKey } from "./shared/utils.js";
import {
  addSeconds,
  getSettings,
  getSessionState,
  pruneOldData,
  saveSessionState,
} from "./shared/storage.js";

const FLUSH_ALARM = "wtt-flush";
const PRUNE_ALARM = "wtt-prune";
const MAX_GAP_SECONDS = 5 * 60;
const FLUSH_PERIOD_MINUTES = 0.25;

let currentSession = {
  domain: null,
  tabId: null,
  startTimestamp: null,
};

let lastFocusedWindowId = chrome.windows.WINDOW_ID_NONE;
let idleState = "active";
let settingsCache = null;
let writeChain = Promise.resolve();
let booted = false;

function enqueue(task) {
  const run = writeChain.then(task, task);
  writeChain = run.catch((error) => {
    console.error("[Website Time Tracker]", error);
  });
  return writeChain;
}

async function loadSettings() {
  settingsCache = await getSettings();
  const threshold = settingsCache.idleThresholdSeconds || 60;
  try {
    chrome.idle.setDetectionInterval(threshold);
  } catch (error) {
    console.warn("idle.setDetectionInterval failed", error);
  }
  return settingsCache;
}

async function persistSession() {
  await saveSessionState({
    ...currentSession,
    lastFocusedWindowId,
    idleState,
    savedAt: Date.now(),
  });
}

function resetSession() {
  currentSession = { domain: null, tabId: null, startTimestamp: null };
}

async function flushCurrentSession({ continueSession = false } = {}) {
  const { domain, startTimestamp } = currentSession;
  const now = Date.now();

  if (domain && startTimestamp) {
    const elapsed = (now - startTimestamp) / 1000;
    if (elapsed > 0 && elapsed <= MAX_GAP_SECONDS) {
      await addSeconds(domain, elapsed, dateKey());
    }
  }

  if (continueSession && currentSession.domain) {
    currentSession.startTimestamp = now;
  } else if (!continueSession) {
    resetSession();
  }

  await persistSession();
}

async function queryFocusedWindowId() {
  try {
    const focused = await chrome.windows.getLastFocused({ populate: false });
    if (focused?.focused && focused.id !== chrome.windows.WINDOW_ID_NONE) {
      return focused.id;
    }
  } catch {
    /* no window */
  }
  return chrome.windows.WINDOW_ID_NONE;
}

async function resolveActiveTarget() {
  if (!settingsCache) await loadSettings();
  if (!settingsCache.trackingEnabled) return null;
  if (idleState !== "active") return null;

  let windowId = lastFocusedWindowId;
  if (windowId !== chrome.windows.WINDOW_ID_NONE && windowId != null) {
    try {
      const existing = await chrome.windows.get(windowId);
      if (!existing?.focused || existing.incognito) {
        windowId = chrome.windows.WINDOW_ID_NONE;
      }
    } catch {
      windowId = chrome.windows.WINDOW_ID_NONE;
    }
  }
  if (windowId === chrome.windows.WINDOW_ID_NONE || windowId == null) {
    windowId = await queryFocusedWindowId();
    lastFocusedWindowId = windowId;
  }
  if (windowId === chrome.windows.WINDOW_ID_NONE) return null;

  let windowInfo;
  try {
    windowInfo = await chrome.windows.get(windowId);
  } catch {
    return null;
  }
  if (!windowInfo.focused || windowInfo.incognito) return null;

  const tabs = await chrome.tabs.query({ active: true, windowId });
  const tab = tabs[0];
  if (!tab || tab.incognito || !tab.url) return null;

  const domain = extractDomain(tab.url);
  if (!domain) return null;
  if ((settingsCache.excludedDomains || []).includes(domain)) return null;

  return { domain, tabId: tab.id };
}

async function reconcile() {
  const next = await resolveActiveTarget();
  const nextDomain = next?.domain || null;
  const nextTabId = next?.tabId ?? null;

  if (currentSession.domain === nextDomain && currentSession.tabId === nextTabId) {
    if (nextDomain && !currentSession.startTimestamp) {
      currentSession.startTimestamp = Date.now();
      await persistSession();
    }
    return;
  }

  await flushCurrentSession({ continueSession: false });

  if (nextDomain) {
    currentSession = {
      domain: nextDomain,
      tabId: nextTabId,
      startTimestamp: Date.now(),
    };
    await persistSession();
  }
}

function scheduleReconcile() {
  enqueue(reconcile);
}

async function init() {
  if (booted) {
    await reconcile();
    return;
  }
  booted = true;

  await loadSettings();

  const saved = await getSessionState();
  lastFocusedWindowId =
    saved?.lastFocusedWindowId ?? chrome.windows.WINDOW_ID_NONE;

  try {
    idleState = await chrome.idle.queryState(settingsCache.idleThresholdSeconds || 60);
  } catch {
    idleState = "active";
  }

  resetSession();
  await persistSession();

  // Avoid duplicate alarms if the service worker restarts
  const [existingFlush, existingPrune] = await Promise.all([
    chrome.alarms.get(FLUSH_ALARM),
    chrome.alarms.get(PRUNE_ALARM),
  ]);
  if (!existingFlush) chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_PERIOD_MINUTES });
  if (!existingPrune) chrome.alarms.create(PRUNE_ALARM, { periodInMinutes: 60 * 12 });

  await pruneOldData(settingsCache.retentionDays);
  await reconcile();
}

chrome.runtime.onInstalled.addListener(() => {
  enqueue(init);
});

chrome.runtime.onStartup.addListener(() => {
  enqueue(init);
});

enqueue(init);

chrome.tabs.onActivated.addListener(() => {
  scheduleReconcile();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    scheduleReconcile();
  }
});

chrome.tabs.onRemoved.addListener(() => {
  scheduleReconcile();
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  lastFocusedWindowId = windowId;
  scheduleReconcile();
});

chrome.idle.onStateChanged.addListener((state) => {
  idleState = state;
  enqueue(async () => {
    if (state !== "active") {
      await flushCurrentSession({ continueSession: false });
    } else {
      await reconcile();
    }
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) {
    enqueue(async () => {
      if (currentSession.domain && currentSession.startTimestamp) {
        await flushCurrentSession({ continueSession: true });
      } else {
        await reconcile();
      }
    });
  }
  if (alarm.name === PRUNE_ALARM) {
    enqueue(async () => {
      if (!settingsCache) await loadSettings();
      await pruneOldData(settingsCache.retentionDays);
    });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  enqueue(async () => {
    await loadSettings();
    await reconcile();
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_STATUS") {
    sendResponse({
      tracking: Boolean(settingsCache?.trackingEnabled) && idleState === "active",
      idleState,
      domain: currentSession.domain,
      trackingEnabled: settingsCache?.trackingEnabled ?? true,
    });
    return true;
  }
  if (message?.type === "RECONCILE") {
    scheduleReconcile();
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
