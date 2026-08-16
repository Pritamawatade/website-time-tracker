import { dateKey, formatDuration, rankedDomains, escapeHtml } from "./shared/utils.js";
import { getTimeData } from "./shared/storage.js";

const totalEl = document.getElementById("today-total");
const listEl = document.getElementById("top-list");
const emptyEl = document.getElementById("empty");
const siteCountEl = document.getElementById("site-count");
const statusEl = document.getElementById("status");

async function render() {
  const timeData = await getTimeData();
  const today = timeData[dateKey()] || {};
  const rows = rankedDomains(today, { limit: 5 });
  const total = Object.values(today).reduce((acc, n) => acc + (Number(n) || 0), 0);
  const max = rows[0]?.seconds || 1;

  totalEl.textContent = formatDuration(total);
  siteCountEl.textContent = Object.keys(today).length
    ? `${Object.keys(today).length} site${Object.keys(today).length === 1 ? "" : "s"}`
    : "";

  if (!rows.length) {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
  } else {
    emptyEl.classList.add("hidden");
    listEl.innerHTML = rows
      .map((row, index) => {
        const width = Math.max(4, Math.round((row.seconds / max) * 100));
        return `<li class="row">
          <span class="rank">${index + 1}</span>
          <span class="domain" title="${escapeHtml(row.domain)}">${escapeHtml(row.domain)}</span>
          <span class="time">${escapeHtml(formatDuration(row.seconds))}</span>
          <div class="bar"><span style="width:${width}%"></span></div>
        </li>`;
      })
      .join("");
  }

  try {
    const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    if (!status?.trackingEnabled) {
      setStatus("paused", "Paused");
    } else if (status.idleState !== "active") {
      setStatus("idle", status.idleState === "locked" ? "Locked" : "Idle");
    } else {
      setStatus("live", status.domain ? "Live" : "Ready");
    }
  } catch {
    setStatus("paused", "Starting");
  }
}

function setStatus(state, label) {
  statusEl.dataset.state = state;
  statusEl.textContent = label;
}

document.getElementById("open-dashboard").addEventListener("click", async () => {
  const url = chrome.runtime.getURL("dashboard.html");
  await chrome.tabs.create({ url });
  window.close();
});

render();
