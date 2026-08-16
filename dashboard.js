import {
  addDays,
  aggregateRange,
  bucketSmallShares,
  CHART_COLORS,
  dateKey,
  downloadBlob,
  escapeHtml,
  formatDuration,
  rankedDomains,
  timeDataToCsv,
} from "./shared/utils.js";
import {
  clearTimeData,
  getSettings,
  getTimeData,
  normalizeDomainList,
  saveSettings,
} from "./shared/storage.js";

const Chart = globalThis.Chart;

const state = {
  range: "today",
  customFrom: dateKey(addDays(new Date(), -6)),
  customTo: dateKey(),
  search: "",
  sort: { key: "seconds", dir: "desc" },
  rows: [],
  total: 0,
};

let barChart;
let pieChart;
let lineChart;

function chartDefaults() {
  if (!Chart) return;
  Chart.defaults.color = "#8b95b7";
  Chart.defaults.borderColor = "#2a3354";
  Chart.defaults.font.family = '"Segoe UI", "SF Pro Text", system-ui, sans-serif';
}

function rangeBounds(timeData) {
  const today = dateKey();
  if (state.range === "today") return { start: today, end: today };
  if (state.range === "7") return { start: dateKey(addDays(new Date(), -6)), end: today };
  if (state.range === "30") return { start: dateKey(addDays(new Date(), -29)), end: today };
  if (state.range === "custom") {
    const start = state.customFrom <= state.customTo ? state.customFrom : state.customTo;
    const end = state.customFrom <= state.customTo ? state.customTo : state.customFrom;
    return { start, end };
  }
  const keys = Object.keys(timeData).sort();
  if (!keys.length) return { start: today, end: today };
  return { start: keys[0], end: today };
}

function renderStats({ totalSeconds, byDomain, byDate, keys }) {
  const siteCount = Object.keys(byDomain).length;
  const daysWithTime = keys.filter((key) => (byDate[key] || 0) > 0).length;
  const daySpan = Math.max(1, keys.length);
  const avg = totalSeconds / daySpan;
  const top = rankedDomains(byDomain, { limit: 1 })[0];

  document.getElementById("stats").innerHTML = `
    <article class="stat">
      <div class="label">Total time</div>
      <div class="value">${escapeHtml(formatDuration(totalSeconds))}</div>
      <div class="sub">${(totalSeconds / 3600).toFixed(1)} hours</div>
    </article>
    <article class="stat">
      <div class="label">Sites</div>
      <div class="value">${siteCount}</div>
      <div class="sub">${daysWithTime} day${daysWithTime === 1 ? "" : "s"} with activity</div>
    </article>
    <article class="stat">
      <div class="label">Daily average</div>
      <div class="value">${escapeHtml(formatDuration(avg))}</div>
      <div class="sub">Across ${daySpan} day${daySpan === 1 ? "" : "s"}</div>
    </article>
    <article class="stat">
      <div class="label">Top site</div>
      <div class="value">${top ? escapeHtml(formatDuration(top.seconds)) : "—"}</div>
      <div class="sub">${top ? escapeHtml(top.domain) : "No data yet"}</div>
    </article>
  `;
}

function upsertChart(existing, ctx, config) {
  if (existing) {
    try {
      existing.data.labels = config.data.labels;
      existing.data.datasets = config.data.datasets;
      existing.update();
      return existing;
    } catch {
      try { existing.destroy(); } catch { /* already gone */ }
    }
  }
  return new Chart(ctx, config);
}

function showNoData(canvasId, show) {
  const canvas = document.getElementById(canvasId);
  const frame = canvas?.closest(".chart-frame");
  if (!frame) return;
  let overlay = frame.querySelector(".no-data");
  if (show) {
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "no-data";
      overlay.textContent = "No data for this range";
      frame.appendChild(overlay);
    }
    canvas.style.opacity = "0.2";
  } else {
    overlay?.remove();
    canvas.style.opacity = "";
  }
}

function renderBar(rows) {
  showNoData("bar-chart", rows.length === 0);
  const labels = rows.map((row) => row.domain);
  const hours = rows.map((row) => +(row.seconds / 3600).toFixed(2));
  barChart = upsertChart(barChart, document.getElementById("bar-chart"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Hours",
          data: hours,
          backgroundColor: labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
          borderRadius: 6,
          barThickness: 16,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          beginAtZero: true,
          title: { display: true, text: "Hours" },
          grid: { color: "#232b48" },
        },
        y: { grid: { display: false } },
      },
    },
  });
}

function renderPie(rows) {
  showNoData("pie-chart", rows.length === 0);
  pieChart = upsertChart(pieChart, document.getElementById("pie-chart"), {
    type: "doughnut",
    data: {
      labels: rows.map((row) => row.domain),
      datasets: [
        {
          data: rows.map((row) => row.seconds),
          backgroundColor: rows.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
          borderColor: "#151c32",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label(ctx) {
              const seconds = ctx.raw || 0;
              const sum = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
              const pct = ((seconds / sum) * 100).toFixed(1);
              return ` ${ctx.label}: ${formatDuration(seconds)} (${pct}%)`;
            },
          },
        },
      },
      cutout: "62%",
    },
  });
}

function renderLine(byDate, keys) {
  const hasData = keys.some((k) => (byDate[k] || 0) > 0);
  showNoData("line-chart", !hasData);
  lineChart = upsertChart(lineChart, document.getElementById("line-chart"), {
    type: "line",
    data: {
      labels: keys,
      datasets: [
        {
          label: "Hours",
          data: keys.map((key) => +((byDate[key] || 0) / 3600).toFixed(2)),
          borderColor: "#f0b429",
          backgroundColor: "rgba(240, 180, 41, 0.16)",
          fill: true,
          tension: 0.3,
          pointRadius: keys.length > 40 ? 0 : 3,
          pointBackgroundColor: "#f0b429",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: "Hours" },
          grid: { color: "#232b48" },
        },
        x: {
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 10,
          },
          grid: { display: false },
        },
      },
    },
  });
}

function compareRows(a, b) {
  const { key, dir } = state.sort;
  let av = a[key];
  let bv = b[key];
  if (key === "domain") {
    av = a.domain.toLowerCase();
    bv = b.domain.toLowerCase();
    return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
  }
  return dir === "asc" ? av - bv : bv - av;
}

function updateSortIndicators() {
  document.querySelectorAll("th button[data-sort]").forEach((btn) => {
    const key = btn.dataset.sort;
    const isActive = state.sort.key === key;
    btn.setAttribute("aria-sort", isActive ? (state.sort.dir === "asc" ? "ascending" : "descending") : "none");
    const arrow = isActive ? (state.sort.dir === "asc" ? " ▲" : " ▼") : "";
    btn.textContent = btn.textContent.replace(/ [▲▼]$/, "") + arrow;
  });
}

function renderTable() {
  updateSortIndicators();
  const query = state.search.trim().toLowerCase();
  const visible = state.rows
    .filter((row) => row.domain.toLowerCase().includes(query))
    .sort(compareRows);

  document.getElementById("table-meta").textContent = query
    ? `${visible.length} matching site${visible.length === 1 ? "" : "s"}`
    : `${state.rows.length} site${state.rows.length === 1 ? "" : "s"} · sorted by ${state.sort.key}`;

  const body = document.getElementById("table-body");
  if (!visible.length) {
    body.innerHTML = `<tr><td class="empty-row" colspan="4">No sites in this range.</td></tr>`;
    return;
  }

  body.innerHTML = visible
    .map((row) => {
      const share = state.total ? (row.seconds / state.total) * 100 : 0;
      return `<tr>
        <td>${escapeHtml(row.domain)}</td>
        <td class="num">${escapeHtml(formatDuration(row.seconds))}</td>
        <td class="num">${(row.seconds / 3600).toFixed(2)}</td>
        <td class="num">
          <span class="barlet"><span style="width:${Math.max(3, share)}%"></span></span>
          ${share.toFixed(1)}%
        </td>
      </tr>`;
    })
    .join("");
}

async function refresh() {
  const timeData = await getTimeData();
  const { start, end } = rangeBounds(timeData);
  const agg = aggregateRange(timeData, start, end);
  const ranked = rankedDomains(agg.byDomain);
  const chartRows = rankedDomains(agg.byDomain, { limit: 10 });
  const pieRows = bucketSmallShares(ranked, { minShare: 0.01 });

  state.rows = ranked.map((row) => ({
    ...row,
    hours: row.seconds / 3600,
    share: agg.totalSeconds ? row.seconds / agg.totalSeconds : 0,
  }));
  state.total = agg.totalSeconds;

  renderStats(agg);
  renderBar(chartRows);
  renderPie(pieRows);
  renderLine(agg.byDate, agg.keys);
  renderTable();
}

function bindFilters() {
  document.querySelectorAll(".pill").forEach((button) => {
    button.addEventListener("click", () => {
      state.range = button.dataset.range;
      document.querySelectorAll(".pill").forEach((el) => el.classList.toggle("active", el === button));
      document.getElementById("custom-range").classList.toggle("hidden", state.range !== "custom");
      if (state.range === "custom") {
        state.customFrom = document.getElementById("from-date").value || state.customFrom;
        state.customTo = document.getElementById("to-date").value || state.customTo;
      }
      refresh();
    });
  });

  document.getElementById("from-date").value = state.customFrom;
  document.getElementById("to-date").value = state.customTo;
  document.getElementById("apply-custom").addEventListener("click", () => {
    state.customFrom = document.getElementById("from-date").value || state.customFrom;
    state.customTo = document.getElementById("to-date").value || state.customTo;
    refresh();
  });

  document.getElementById("search").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderTable();
  });

  document.querySelectorAll("th button[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      if (state.sort.key === key) state.sort.dir = state.sort.dir === "desc" ? "asc" : "desc";
      else state.sort = { key, dir: key === "domain" ? "asc" : "desc" };
      renderTable();
    });
  });
}

function bindExport() {
  document.getElementById("btn-export-json").addEventListener("click", async () => {
    const timeData = await getTimeData();
    downloadBlob(
      `website-time-tracker-${dateKey()}.json`,
      "application/json",
      JSON.stringify(timeData, null, 2)
    );
  });
  document.getElementById("btn-export-csv").addEventListener("click", async () => {
    const timeData = await getTimeData();
    downloadBlob(
      `website-time-tracker-${dateKey()}.csv`,
      "text/csv",
      timeDataToCsv(timeData)
    );
  });
}

function openSettings(open) {
  const panel = document.getElementById("settings-panel");
  panel.classList.toggle("hidden", !open);
  panel.setAttribute("aria-hidden", open ? "false" : "true");
}

async function renderSettings() {
  const settings = await getSettings();
  document.getElementById("tracking-enabled").checked = settings.trackingEnabled;
  document.getElementById("idle-threshold").value = settings.idleThresholdSeconds;
  document.getElementById("retention-days").value = settings.retentionDays;
  const list = document.getElementById("exclude-list");
  list.innerHTML = (settings.excludedDomains || [])
    .map(
      (domain) => `<li>
        <span>${escapeHtml(domain)}</span>
        <button type="button" data-remove="${escapeHtml(domain)}">Remove</button>
      </li>`
    )
    .join("");
}

async function persistSettingsPatch(patch) {
  const current = await getSettings();
  await saveSettings({ ...current, ...patch });
  await renderSettings();
  try {
    await chrome.runtime.sendMessage({ type: "RECONCILE" });
  } catch {
    /* service worker will pick up storage.onChanged */
  }
}

function bindSettings() {
  document.getElementById("btn-settings").addEventListener("click", async () => {
    await renderSettings();
    openSettings(true);
  });
  document.querySelectorAll("[data-close]").forEach((el) => {
    el.addEventListener("click", () => openSettings(false));
  });

  document.getElementById("tracking-enabled").addEventListener("change", (event) => {
    persistSettingsPatch({ trackingEnabled: event.target.checked });
  });
  document.getElementById("idle-threshold").addEventListener("change", (event) => {
    persistSettingsPatch({ idleThresholdSeconds: Number(event.target.value) });
  });
  document.getElementById("retention-days").addEventListener("change", (event) => {
    persistSettingsPatch({ retentionDays: Number(event.target.value) });
  });

  document.getElementById("exclude-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("exclude-input");
    const settings = await getSettings();
    const excludedDomains = normalizeDomainList([...(settings.excludedDomains || []), input.value]);
    input.value = "";
    await persistSettingsPatch({ excludedDomains });
  });

  document.getElementById("exclude-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    const settings = await getSettings();
    const excludedDomains = (settings.excludedDomains || []).filter((d) => d !== button.dataset.remove);
    await persistSettingsPatch({ excludedDomains });
  });

  document.getElementById("clear-data").addEventListener("click", async () => {
    const ok = confirm("Delete all tracked browsing time? This cannot be undone.");
    if (!ok) return;
    await clearTimeData();
    await refresh();
  });
}

if (!Chart) {
  console.error("[Website Time Tracker] Chart.js failed to load. Make sure lib/chart.min.js is present.");
} else {
  chartDefaults();
}
bindFilters();
bindExport();
bindSettings();
refresh();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.timeData) refresh();
});
