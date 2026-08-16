# Website Time Tracker

A Manifest V3 browser extension that privately tracks how long you spend on each website and visualizes it in a popup and a full dashboard.

All data stays on your device. There are no analytics, accounts, or network calls.

Works in Chrome, Edge, Brave, and other Chromium browsers that support Manifest V3.

## Load the unpacked extension

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder (`website-time-tracker`).

The toolbar icon opens a today summary. **Open full dashboard** (or right-click the icon → Options) opens the charts, table, filters, export, and settings.

## What it tracks

Time is counted only when **all** of these are true:

- A browser window is focused (switching to another app pauses tracking).
- The active tab in that window is `http://` or `https://`.
- You are not idle or locked (`chrome.idle`, default 60 seconds).
- Tracking is enabled and the domain is not on your exclude list.

`www.` is stripped so `youtube.com` and `www.youtube.com` are the same site. Incognito tabs are ignored unless you separately allow the extension in incognito — even then, incognito tabs are skipped.

## Where data lives

Everything is stored in `chrome.storage.local` on this machine:

```js
{
  timeData: {
    "2026-08-16": { "github.com": 5120, "youtube.com": 3421 }
  },
  settings: {
    trackingEnabled: true,
    idleThresholdSeconds: 60,
    excludedDomains: [],
    retentionDays: 90
  }
}
```

Dates use your **local** calendar day (`YYYY-MM-DD`). Durations are stored in **seconds**. Older days are pruned using the retention setting (default 90 days).

The service worker flushes time on tab/window/idle changes and on a short alarm so a worker restart cannot invent hours of “active” time. Gaps longer than 5 minutes (sleep, crash, long kill) are discarded instead of being assigned to the last site.

## Permissions

| Permission | Why |
|---|---|
| `tabs` | Read the active tab’s hostname when you switch tabs or windows. Full URLs and page content are not stored. |
| `idle` | Pause when you step away or the machine locks. |
| `alarms` | Periodic flush and data retention. |
| `storage` + `unlimitedStorage` | Persist daily totals locally. |

No `history`, `webNavigation`, or host permissions.

## Files

```
manifest.json
background.js          service worker
popup.html / js / css
dashboard.html / js / css
shared/storage.js
shared/utils.js
lib/chart.min.js       bundled Chart.js (no CDN)
icons/
```

## Privacy

The extension never sends browsing data anywhere. Export (JSON or CSV) is a local file download that you trigger yourself.
