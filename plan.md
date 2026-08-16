# Build a Browser Extension: Website Time Tracker with Visual Dashboard

## 1. Project Goal

Build a cross-browser (Chrome/Edge/Brave, Manifest V3 compatible) extension that:

- Silently tracks how much time the user spends on each website (grouped by domain).
- Stores this data locally and persistently, broken down by day.
- Shows the data in a graphical dashboard (bar chart, pie chart, and a sortable list) with filters for Today / This Week / This Month / All Time.
- Shows a quick-glance summary in the toolbar popup.

The extension must be privacy-respecting: **all data stays on the user's device** (no external servers, no analytics, no network calls).

---

## 2. Tech Stack

- **Manifest version:** Manifest V3 (required for current Chrome Web Store submissions)
- **Language:** JavaScript (or TypeScript if the agent prefers, with a simple build step via esbuild/Vite — but plain JS is acceptable and simpler to ship)
- **UI:** HTML + CSS + vanilla JS, OR a lightweight framework (React/Preact) if it speeds up dashboard development — keep the bundle small
- **Charting library:** Chart.js (via a bundled local copy, NOT a CDN — Manifest V3 disallows remote code execution, so the library file must be bundled inside the extension)
- **Storage:** `chrome.storage.local` (NOT localStorage — it's not reliably accessible from service workers and has stricter quotas). Use `chrome.storage.local` for the time-tracking dataset, with the "unlimitedStorage" permission if data volume could get large.
- **Background logic:** Manifest V3 **Service Worker** (`background.js`), since persistent background pages are no longer allowed.
- **Idle detection:** `chrome.idle` API
- **Tab/window tracking:** `chrome.tabs` and `chrome.windows` APIs
- **Icons/assets:** simple SVG or PNG icons for toolbar (16/32/48/128 px)

---

## 3. High-Level Architecture

```
┌────────────────────────────────────────────────────────────┐
│                     Browser Extension                       │
│                                                              │
│  ┌────────────────┐        ┌──────────────────────────┐    │
│  │  Service Worker │◄──────►│   chrome.storage.local     │    │
│  │  (background.js)│        │   (time-tracking dataset) │    │
│  │                  │        └──────────────────────────┘    │
│  │  - Listens to    │                    ▲                   │
│  │    tab/window/   │                    │ reads             │
│  │    idle events   │                    │                   │
│  │  - Computes      │        ┌──────────────────────────┐    │
│  │    active domain │        │       Popup UI            │    │
│  │  - Accumulates   │        │  (popup.html/js/css)      │    │
│  │    time per      │        │  - Today's top sites       │    │
│  │    domain/day    │        │  - Mini bar chart           │    │
│  │  - Writes to     │        │  - "Open full dashboard"   │    │
│  │    storage every │        │    button                  │    │
│  │    N seconds     │        └──────────────────────────┘    │
│  └────────────────┘                                          │
│                              ┌──────────────────────────┐    │
│                              │   Dashboard (options.html) │    │
│                              │  - Full charts (bar/pie)   │    │
│                              │  - Date-range filters       │    │
│                              │  - Sortable domain list     │    │
│                              │  - Export to CSV/JSON       │    │
│                              └──────────────────────────┘    │
└────────────────────────────────────────────────────────────┘
```

---

## 4. Core Tracking Logic (this is the trickiest part — implement carefully)

The background service worker must determine, at any moment, **"which domain is the user actively looking at right now?"** and accumulate elapsed seconds against that domain. Time should only count when ALL of these are true:

1. A Chrome window is **focused** (`chrome.windows.onFocusChanged` — ignore `chrome.windows.WINDOW_ID_NONE`, which means the browser itself lost focus, e.g. user switched to another app).
2. The **active tab** in that focused window has a valid `http://` or `https://` URL (ignore `chrome://`, `about:`, `file://`, new-tab pages, and extension pages).
3. The user is **not idle** — use `chrome.idle.setDetectionInterval(60)` and `chrome.idle.onStateChanged` to pause tracking when state is `"idle"` or `"locked"`.

### Recommended implementation approach

- Maintain an in-memory state in the service worker:
  ```js
  let currentSession = {
    domain: null, // e.g. "youtube.com"
    tabId: null,
    startTimestamp: null, // ms since epoch, when this domain became active
  };
  ```
- Listen to these events, and on each one, **close out the current session** (compute elapsed time and add it to storage for `currentSession.domain`), then **start a new session** for the new active domain:
  - `chrome.tabs.onActivated` (user switched tabs)
  - `chrome.tabs.onUpdated` (URL changed within the same tab, e.g. navigation)
  - `chrome.windows.onFocusChanged` (user switched to a different browser window or to another application)
  - `chrome.idle.onStateChanged` (user went idle/locked, or came back to active)
  - Extension startup/service worker wake-up (recover any in-progress session state from storage)

- Because Manifest V3 service workers can be **terminated and restarted** at any time (they are not persistent), do NOT rely purely on in-memory state surviving. Two options:
  1. **Periodic flush**: use `chrome.alarms` to fire every ~15–30 seconds and flush accumulated time to `chrome.storage.local`, so at most ~30 seconds of data is ever at risk of being lost if the worker is killed.
  2. On every event above, immediately write the elapsed delta to storage rather than waiting.
- Use `chrome.alarms` (not `setInterval`, which does not survive service worker termination) for any periodic work.

### Domain extraction

- Use the JS `URL` object: `new URL(tab.url).hostname` to get the domain (e.g. `www.youtube.com`).
- Decide whether to normalize `www.` prefixes (recommended: strip `www.` so `youtube.com` and `www.youtube.com` are combined).

---

## 5. Data Model / Storage Schema

Store data keyed by date, then by domain, so it's easy to query per-day and aggregate for week/month/all-time views:

```js
// chrome.storage.local structure
{
  "timeData": {
    "2026-08-16": {
      "youtube.com": 3421,       // seconds
      "github.com": 5120,
      "news.ycombinator.com": 640
    },
    "2026-08-15": {
      "github.com": 7800,
      "gmail.com": 1200
    }
    // ... one entry per date, going back as far as data exists
  },
  "settings": {
    "trackingEnabled": true,
    "idleThresholdSeconds": 60,
    "excludedDomains": []       // user-defined ignore list (e.g. banking sites)
  }
}
```

- Use **local date strings** (`YYYY-MM-DD` in the user's own timezone, not UTC) as the top-level key, computed via `new Date().toLocaleDateString('en-CA')` or equivalent, so "today" always matches the user's actual day.
- Store durations in **seconds** internally; convert to hours only in the UI layer (`seconds / 3600`).
- Consider a periodic cleanup/rotation (e.g. keep only the last 90 days) to avoid unbounded storage growth — make this configurable in settings.

---

## 6. UI Requirements

### 6.1 Popup (`popup.html`, opens on toolbar icon click)

- Show **today's total browsing time** at the top.
- Show a **ranked list of top 5 domains today** with hours/minutes and a small horizontal bar per row (proportional to time).
- A button/link: **"Open full dashboard"** → opens `dashboard.html` in a new tab (via `chrome.tabs.create`).
- Keep this lightweight — no heavy charting library needed here, simple CSS bars are enough.

### 6.2 Dashboard (`dashboard.html`, full tab page — this is the main GUI)

- **Time range filter**: Today / Last 7 Days / Last 30 Days / Custom range (date pickers) / All Time.
- **Bar chart**: hours per domain for the selected range (horizontal bar, sorted descending, top N with an "Other" bucket for the rest).
- **Pie/Donut chart**: percentage share of total time per domain.
- **Trend line chart** (optional but valuable): total browsing hours per day over the selected range, to show daily patterns.
- **Data table**: sortable list of domain → total hours, with search/filter box.
- **Export button**: download the data as CSV or JSON.
- **Settings panel**: toggle tracking on/off, manage excluded domains, clear all data (with confirmation).

Use **Chart.js** bundled locally (`/lib/chart.min.js`, downloaded and shipped inside the extension — do not load from a CDN, since Manifest V3's default Content Security Policy blocks remote scripts).

---

## 7. Manifest (`manifest.json`) — Key Permissions

```json
{
  "manifest_version": 3,
  "name": "Website Time Tracker",
  "version": "1.0.0",
  "description": "Track and visualize how much time you spend on each website.",
  "permissions": ["storage", "tabs", "idle", "alarms", "unlimitedStorage"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- Note: `"tabs"` permission gives access to `tab.url`; if you want to minimize permission scope, `"activeTab"` alone is not sufficient here since we need to observe tab changes continuously, not just on user-invoked action — so `"tabs"` is required, but explain to the user in the store listing that only hostnames are stored, not full URLs or page content.
- Do **not** request `"history"` or `"webNavigation"` unless a feature genuinely needs it — keep permissions minimal for store review and user trust.

---

## 8. Recommended File Structure

```
website-time-tracker/
├── manifest.json
├── background.js              # service worker: tracking logic
├── popup.html
├── popup.js
├── popup.css
├── dashboard.html
├── dashboard.js                # chart rendering, filters, table
├── dashboard.css
├── lib/
│   └── chart.min.js            # bundled Chart.js (no CDN)
├── shared/
│   ├── storage.js               # helper functions: getTimeData(), saveTimeData(), getDateRange()
│   └── utils.js                 # domain extraction, time formatting (secondsToHours, etc.)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 9. Edge Cases to Handle

- Browser closes/restarts while a session is active → on next startup, do NOT count the gap as active time; simply start a fresh session.
- Multiple browser windows open simultaneously → only track the currently _focused_ window's active tab.
- User has incognito mode open → by default, extensions don't run in incognito unless explicitly allowed by the user; don't track incognito unless the user opts in (respect the `incognito` split behavior).
- System sleep/hibernate → idle detection should catch this on wake, but also compute a sanity check: if the gap between the last flush timestamp and "now" is larger than a reasonable threshold (e.g. > 5 minutes), don't attribute that entire gap to the last active domain — treat it as idle/untracked time.
- Domain with only a few seconds of time → still record it, but the dashboard can group anything below a small threshold (e.g. < 1%) into an "Other" bucket for chart readability.
- Time zone changes / DST → since we key by local date string computed fresh each time, this should self-correct.

---

## 10. Suggested Build Order (for the implementing agent)

1. Scaffold `manifest.json` and confirm the unpacked extension loads in `chrome://extensions` with no errors.
2. Implement `shared/storage.js` and `shared/utils.js` (pure functions, easy to test in isolation).
3. Implement `background.js` tracking logic; verify with `console.log` that domain switches and idle transitions are detected correctly.
4. Verify data is actually persisting to `chrome.storage.local` (inspect via the extension's service worker DevTools console: `chrome.storage.local.get(console.log)`).
5. Build `popup.html/js/css` — simplest UI first, to validate the data pipeline end-to-end.
6. Build `dashboard.html/js/css` with Chart.js integration — bar chart first, then pie chart, then trend line, then table, then filters.
7. Add settings (exclude domains, clear data, export).
8. Polish styling, add icons, test across a full day of real usage before considering it done.

---

## 11. Deliverable

A fully working, loadable-as-unpacked-extension folder that:

- Tracks time per domain accurately in the background.
- Has a clean, informative popup for quick checks.
- Has a full dashboard with at least a bar chart and pie chart, date-range filtering, and a data table.
- Stores everything locally with no external network calls.
- Includes a short `README.md` explaining how to load it in the browser (`chrome://extensions` → Developer mode → Load unpacked) and how the data is stored.
