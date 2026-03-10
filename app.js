const app = document.getElementById("app");

const REQUIRED_HEADERS = [
  "Id Branch",
  "Date Txs",
  "Corridor",
  "Transaction Id"
];

const ACTION_LIBRARY = {
  PUSH: "Push",
  DEFEND: "Defend",
  DIVERSIFY: "Diversify beyond",
  HOLD: "Hold focus on"
};

let appState = {
  rawCsv: "",
  rows: [],
  headers: [],
  branches: [],
  branchMetrics: {},
  route: getRouteContext(),
  selectedBranchId: null
};

function getRouteContext() {
  const url = new URL(window.location.href);
  const viewParam = normalizeValue(url.searchParams.get("view")).toLowerCase();
  const branchParam = normalizeValue(url.searchParams.get("branchId"));
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const segments = path.split("/").filter(Boolean);

  if (viewParam === "bde") {
    return {
      mode: "bde",
      branchId: null,
      path,
      source: "query"
    };
  }

  if (viewParam === "agency" && branchParam) {
    return {
      mode: "agency",
      branchId: branchParam,
      path,
      source: "query"
    };
  }

  if (segments.length === 1 && segments[0].toLowerCase() === "bde") {
    return {
      mode: "bde",
      branchId: null,
      path,
      source: "path"
    };
  }

  if (
    segments.length === 2 &&
    segments[0].toLowerCase() === "agency" &&
    segments[1]
  ) {
    return {
      mode: "agency",
      branchId: decodeURIComponent(segments[1]).trim(),
      path,
      source: "path"
    };
  }

  return {
    mode: "unknown",
    branchId: null,
    path,
    source: "none"
  };
}

function normalizeHeader(header) {
  return String(header || "").trim();
}

function normalizeValue(value) {
  return String(value == null ? "" : value).trim();
}

function splitCsvLine(line) {
  const output = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      output.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  output.push(current);
  return output.map((value) => value.trim());
}

function parseCsv(csvText) {
  const lines = csvText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "");

  if (!lines.length) {
    throw new Error("CSV is empty.");
  }

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);

  const rows = lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] !== undefined ? normalizeValue(values[index]) : "";
    });

    return row;
  });

  return { headers, rows };
}

function validateHeaders(headers) {
  const missingHeaders = REQUIRED_HEADERS.filter(
    (requiredHeader) => !headers.includes(requiredHeader)
  );

  if (missingHeaders.length) {
    throw new Error(`Missing required header(s): ${missingHeaders.join(", ")}`);
  }
}

function parseDateValue(value) {
  const raw = normalizeValue(value);

  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeCorridor(value) {
  return normalizeValue(value);
}

function normalizeBranchId(value) {
  return normalizeValue(value);
}

function normalizeTransactionCount(value) {
  const raw = normalizeValue(value);

  if (!raw) {
    return 1;
  }

  const numeric = Number(raw.replace(/,/g, ""));

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 1;
  }

  return numeric;
}

function normalizeRows(rows) {
  const normalizedRows = [];
  const invalidRows = [];

  rows.forEach((row, index) => {
    const branchId = normalizeBranchId(row["Id Branch"]);
    const corridor = normalizeCorridor(row["Corridor"]);
    const date = parseDateValue(row["Date Txs"]);
    const transactionCount = normalizeTransactionCount(row["Transaction Id"]);

    if (!branchId || !corridor || !date) {
      invalidRows.push(index + 2);
      return;
    }

    normalizedRows.push({
      branchId,
      date,
      dateKey: formatDateKey(date),
      corridor,
      transactionCount,
      raw: row
    });
  });

  return {
    normalizedRows,
    invalidRows
  };
}

function extractBranches(rows) {
  return Array.from(new Set(rows.map((row) => row.branchId).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
}

function getStartOfWeek(date) {
  const normalized = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = normalized.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  normalized.setDate(normalized.getDate() + diffToMonday);
  return normalized;
}

function addDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function addWeeks(date, weeks) {
  return addDays(date, weeks * 7);
}

function getWeekKey(date) {
  return formatDateKey(getStartOfWeek(date));
}

function formatWeekLabel(weekStart) {
  const weekEnd = addDays(weekStart, 6);
  return `${formatDateKey(weekStart)} to ${formatDateKey(weekEnd)}`;
}

function getNestedNumber(map, firstKey, secondKey) {
  if (!map[firstKey] || !map[firstKey][secondKey]) {
    return 0;
  }

  return map[firstKey][secondKey];
}

function buildBranchMetrics(rows, branches) {
  const branchMetrics = {};

  branches.forEach((branchId) => {
    const branchRows = rows.filter((row) => row.branchId === branchId);

    if (!branchRows.length) {
      branchMetrics[branchId] = {
        branchId,
        latestDate: null,
        latestFullWeekKey: null,
        latestFullWeekStart: null,
        latestFullWeekLabel: "",
        corridorWeekTotals: {},
        corridorWeekTotalsByCorridor: {},
        weeklyBranchTotals: {},
        priorWeekKeys: [],
        corridorSummaries: [],
        recommendations: []
      };
      return;
    }

    const latestDate = branchRows.reduce((maxDate, row) => {
      return !maxDate || row.date > maxDate ? row.date : maxDate;
    }, null);

    const currentWeekStart = getStartOfWeek(latestDate);
    const latestFullWeekStart = addWeeks(currentWeekStart, -1);
    const latestFullWeekKey = formatDateKey(latestFullWeekStart);

    const corridorWeekTotals = {};
    const weeklyBranchTotals = {};
    const corridorSet = new Set();

    branchRows.forEach((row) => {
      const weekKey = getWeekKey(row.date);

      if (!corridorWeekTotals[weekKey]) {
        corridorWeekTotals[weekKey] = {};
      }

      if (!corridorWeekTotals[weekKey][row.corridor]) {
        corridorWeekTotals[weekKey][row.corridor] = 0;
      }

      corridorWeekTotals[weekKey][row.corridor] += row.transactionCount;

      if (!weeklyBranchTotals[weekKey]) {
        weeklyBranchTotals[weekKey] = 0;
      }

      weeklyBranchTotals[weekKey] += row.transactionCount;
      corridorSet.add(row.corridor);
    });

    const priorWeekKeys = [1, 2, 3, 4].map((offset) =>
      formatDateKey(addWeeks(latestFullWeekStart, -offset))
    );

    const corridorSummaries = Array.from(corridorSet).map((corridor) => {
      const latestWeekTx = getNestedNumber(corridorWeekTotals, latestFullWeekKey, corridor);
      const prior4WeekValues = priorWeekKeys.map((weekKey) =>
        getNestedNumber(corridorWeekTotals, weekKey, corridor)
      );
      const prior4WeekTotal = prior4WeekValues.reduce((sum, value) => sum + value, 0);
      const prior4WeekAvg = prior4WeekTotal / 4;
      const deltaVsAvg = latestWeekTx - prior4WeekAvg;
      const pctVsAvg = prior4WeekAvg > 0 ? (deltaVsAvg / prior4WeekAvg) * 100 : null;
      const latestWeekBranchTotal = weeklyBranchTotals[latestFullWeekKey] || 0;
      const shareOfLatestWeek =
        latestWeekBranchTotal > 0 ? latestWeekTx / latestWeekBranchTotal : 0;

      return {
        corridor,
        latestWeekTx,
        prior4WeekAvg,
        prior4WeekTotal,
        deltaVsAvg,
        pctVsAvg,
        shareOfLatestWeek,
        prior4WeekValues
      };
    });

    corridorSummaries.sort((a, b) => {
      if (b.latestWeekTx !== a.latestWeekTx) {
        return b.latestWeekTx - a.latestWeekTx;
      }
      return b.shareOfLatestWeek - a.shareOfLatestWeek;
    });

    const corridorWeekTotalsByCorridor = {};
    corridorSummaries.forEach((summary) => {
      corridorWeekTotalsByCorridor[summary.corridor] = {};
      Object.keys(corridorWeekTotals).forEach((weekKey) => {
        corridorWeekTotalsByCorridor[summary.corridor][weekKey] =
          getNestedNumber(corridorWeekTotals, weekKey, summary.corridor);
      });
    });

    const recommendations = buildRecommendations(corridorSummaries);

    branchMetrics[branchId] = {
      branchId,
      latestDate,
      latestFullWeekKey,
      latestFullWeekStart,
      latestFullWeekLabel: formatWeekLabel(latestFullWeekStart),
      corridorWeekTotals,
      corridorWeekTotalsByCorridor,
      weeklyBranchTotals,
      priorWeekKeys,
      corridorSummaries,
      recommendations
    };
  });

  return branchMetrics;
}

function buildRecommendations(corridorSummaries) {
  if (!corridorSummaries.length) {
    return [];
  }

  const sortedByLatest = [...corridorSummaries].sort((a, b) => b.latestWeekTx - a.latestWeekTx);
  const topCorridor = sortedByLatest[0];
  const secondCorridor = sortedByLatest[1] || null;

  const ranked = corridorSummaries.map((summary) => {
    let action = ACTION_LIBRARY.HOLD;
    let score = 0;
    let why = "";
    let subject = summary.corridor;

    const pctVsAvg = summary.pctVsAvg;
    const sharePct = summary.shareOfLatestWeek * 100;
    const latestRounded = Math.round(summary.latestWeekTx);
    const avgRounded = Math.round(summary.prior4WeekAvg);

    if (pctVsAvg !== null && pctVsAvg >= 15) {
      action = ACTION_LIBRARY.PUSH;
      score = 400 + pctVsAvg + sharePct;
      why = `${summary.corridor} is running above trend. Latest week delivered ${formatWholeNumber(latestRounded)} transactions versus a prior 4-week average of ${formatWholeNumber(avgRounded)}.`;
    } else if (pctVsAvg !== null && pctVsAvg <= -15 && sharePct >= 35) {
      action = ACTION_LIBRARY.DEFEND;
      score = 300 + Math.abs(pctVsAvg) + sharePct;
      why = `${summary.corridor} is a core corridor but softened versus trend. Latest week delivered ${formatWholeNumber(latestRounded)} transactions versus a prior 4-week average of ${formatWholeNumber(avgRounded)}.`;
    } else if (
      topCorridor &&
      topCorridor.corridor === summary.corridor &&
      topCorridor.shareOfLatestWeek >= 0.6 &&
      secondCorridor
    ) {
      action = ACTION_LIBRARY.DIVERSIFY;
      subject = topCorridor.corridor;
      score = 200 + topCorridor.shareOfLatestWeek * 100 + (secondCorridor.latestWeekTx || 0) / 10;
      why = `${topCorridor.corridor} drives ${formatPercent(topCorridor.shareOfLatestWeek * 100, 0)} of latest-week volume. The agency is overly concentrated in one corridor.`;
    } else {
      action = ACTION_LIBRARY.HOLD;
      score = 100 + sharePct + (pctVsAvg || 0);
      why = `${summary.corridor} is relatively stable. Latest week delivered ${formatWholeNumber(latestRounded)} transactions versus a prior 4-week average of ${formatWholeNumber(avgRounded)}.`;
    }

    return {
      corridor: summary.corridor,
      action,
      subject,
      why,
      score,
      latestWeekTx: summary.latestWeekTx,
      prior4WeekAvg: summary.prior4WeekAvg,
      deltaVsAvg: summary.deltaVsAvg,
      pctVsAvg: summary.pctVsAvg,
      shareOfLatestWeek: summary.shareOfLatestWeek
    };
  });

  const deduped = [];
  const seenKeys = new Set();

  ranked
    .sort((a, b) => b.score - a.score)
    .forEach((item) => {
      const key = `${item.action}|${item.subject}`;
      if (seenKeys.has(key)) {
        return;
      }
      seenKeys.add(key);
      deduped.push(item);
    });

  if (deduped.length < 3) {
    sortedByLatest.forEach((summary) => {
      const fallback = {
        corridor: summary.corridor,
        action: ACTION_LIBRARY.HOLD,
        subject: summary.corridor,
        why: `${summary.corridor} remains an active corridor with ${formatWholeNumber(Math.round(summary.latestWeekTx))} latest-week transactions.`,
        score: 10 + summary.latestWeekTx,
        latestWeekTx: summary.latestWeekTx,
        prior4WeekAvg: summary.prior4WeekAvg,
        deltaVsAvg: summary.deltaVsAvg,
        pctVsAvg: summary.pctVsAvg,
        shareOfLatestWeek: summary.shareOfLatestWeek
      };
      const key = `${fallback.action}|${fallback.subject}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        deduped.push(fallback);
      }
    });
  }

  return deduped.slice(0, 3);
}

function formatWholeNumber(value) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 0
  });
}

function formatPercent(value, digits = 0) {
  if (!Number.isFinite(value)) {
    return "N/A";
  }

  return `${value.toFixed(digits)}%`;
}

function formatSignedPercent(value, digits = 0) {
  if (!Number.isFinite(value)) {
    return "N/A";
  }

  const rounded = value.toFixed(digits);
  return `${value > 0 ? "+" : ""}${rounded}%`;
}

function formatSignedWhole(value) {
  const numeric = Number(value || 0);
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${formatWholeNumber(Math.round(numeric))}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderUnknownRoute() {
  app.innerHTML = `
    <div class="portal-placeholder">
      <h2>Route not recognized</h2>
      <p>Use <code>/?view=bde</code> or <code>/?view=agency&amp;branchId=A07667</code>.</p>
      <p>Path routes also work: <code>/bde</code> and <code>/agency/[branchId]</code>.</p>
      <p>Current path: <strong>${escapeHtml(appState.route.path)}</strong></p>
    </div>
  `;
}

function getSelectedBranchId() {
  if (appState.route.mode === "agency") {
    return appState.route.branchId;
  }

  if (appState.route.mode === "bde") {
    if (appState.selectedBranchId && appState.branches.includes(appState.selectedBranchId)) {
      return appState.selectedBranchId;
    }
    return appState.branches[0] || null;
  }

  return null;
}

function buildMiniChart(branchMetrics, corridor) {
  if (!branchMetrics || !corridor || !branchMetrics.latestFullWeekStart) {
    return "";
  }

  const weekStarts = [4, 3, 2, 1, 0].map((offset) =>
    addWeeks(branchMetrics.latestFullWeekStart, -offset)
  );

  const chartRows = weekStarts.map((weekStart) => {
    const weekKey = formatDateKey(weekStart);
    const value = getNestedNumber(
      branchMetrics.corridorWeekTotals,
      weekKey,
      corridor
    );
    return {
      label: weekKey.slice(5),
      value
    };
  });

  const maxValue = Math.max(...chartRows.map((item) => item.value), 1);

  return `
    <div class="mini-chart">
      ${chartRows
        .map((item) => {
          const height = Math.max((item.value / maxValue) * 100, item.value > 0 ? 8 : 2);
          return `
            <div class="mini-chart-col">
              <div class="mini-chart-bar-wrap">
                <div class="mini-chart-bar" style="height:${height}%"></div>
              </div>
              <div class="mini-chart-value">${formatWholeNumber(item.value)}</div>
              <div class="mini-chart-label">${escapeHtml(item.label)}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function buildRecommendationCard(branchId, showSelector) {
  const branchMetrics = appState.branchMetrics[branchId];

  if (!branchMetrics) {
    return `
      <div class="portal-placeholder">
        <h2>Agency not found</h2>
        <p>No data was found for branch <strong>${escapeHtml(branchId || "")}</strong>.</p>
      </div>
    `;
  }

  const recommendations = branchMetrics.recommendations || [];
  const mainRec = recommendations[0];
  const secondRec = recommendations[1];
  const thirdRec = recommendations[2];

  if (!mainRec) {
    return `
      <div class="portal-placeholder">
        <h2>No recommendation available</h2>
        <p>There is not enough complete weekly data yet for <strong>${escapeHtml(branchId)}</strong>.</p>
      </div>
    `;
  }

  const selectorHtml = showSelector
    ? `
      <div class="portal-toolbar">
        <label class="field-label" for="branchSelect">Agency</label>
        <select id="branchSelect" class="branch-select">
          ${appState.branches
            .map(
              (id) => `
                <option value="${escapeHtml(id)}" ${id === branchId ? "selected" : ""}>
                  ${escapeHtml(id)}
                </option>
              `
            )
            .join("")}
        </select>
      </div>
    `
    : "";

  const mainActionText =
    mainRec.action === ACTION_LIBRARY.DIVERSIFY
      ? `${mainRec.action} ${mainRec.subject}`
      : `${mainRec.action} ${mainRec.subject}`;

  return `
    <div class="portal-view">
      <div class="portal-head">
        <div>
          <div class="view-kicker">${showSelector ? "BDE Portal" : "Agency Portal"}</div>
          <h2 class="view-title">Branch ${escapeHtml(branchId)}</h2>
          <p class="view-subtitle">Latest full week: ${escapeHtml(branchMetrics.latestFullWeekLabel)}</p>
        </div>
        ${selectorHtml}
      </div>

      <section class="recommendation-hero">
        <div class="recommendation-hero-main">
          <div class="hero-label">Main Action</div>
          <div class="hero-action">${escapeHtml(mainActionText)}</div>
          <div class="hero-why-label">Why</div>
          <p class="hero-why">${escapeHtml(mainRec.why)}</p>

          <div class="metric-grid">
            <div class="metric-card">
              <div class="metric-label">Latest week</div>
              <div class="metric-value">${formatWholeNumber(Math.round(mainRec.latestWeekTx))}</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">Prior 4-week avg</div>
              <div class="metric-value">${formatWholeNumber(Math.round(mainRec.prior4WeekAvg))}</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">Vs avg</div>
              <div class="metric-value">${formatSignedPercent(mainRec.pctVsAvg || 0, 0)}</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">Share of week</div>
              <div class="metric-value">${formatPercent(mainRec.shareOfLatestWeek * 100, 0)}</div>
            </div>
          </div>
        </div>

        <div class="recommendation-hero-chart">
          <div class="chart-title">${escapeHtml(mainRec.corridor)} last 5 weeks</div>
          ${buildMiniChart(branchMetrics, mainRec.corridor)}
        </div>
      </section>

      <section class="next-actions">
        <div class="next-actions-title">Other recommended actions</div>
        <div class="next-actions-grid">
          ${renderSecondaryAction(secondRec, 2)}
          ${renderSecondaryAction(thirdRec, 3)}
        </div>
      </section>
    </div>
  `;
}

function renderSecondaryAction(rec, rank) {
  if (!rec) {
    return `
      <div class="secondary-card">
        <div class="secondary-rank">#${rank}</div>
        <div class="secondary-action">No additional action</div>
      </div>
    `;
  }

  const actionText =
    rec.action === ACTION_LIBRARY.DIVERSIFY
      ? `${rec.action} ${rec.subject}`
      : `${rec.action} ${rec.subject}`;

  return `
    <div class="secondary-card">
      <div class="secondary-rank">#${rank}</div>
      <div class="secondary-action">${escapeHtml(actionText)}</div>
      <p class="secondary-why">${escapeHtml(rec.why)}</p>
      <div class="secondary-metrics">
        <span>Latest: ${formatWholeNumber(Math.round(rec.latestWeekTx))}</span>
        <span>Vs avg: ${formatSignedWhole(rec.deltaVsAvg)}</span>
      </div>
    </div>
  `;
}

function renderBdeView() {
  const branchId = getSelectedBranchId();

  if (!branchId) {
    app.innerHTML = `
      <div class="portal-placeholder">
        <h2>No agencies found</h2>
        <p>The CSV loaded, but no valid branch IDs were found.</p>
      </div>
    `;
    return;
  }

  app.innerHTML = buildRecommendationCard(branchId, true);

  const branchSelect = document.getElementById("branchSelect");
  if (branchSelect) {
    branchSelect.addEventListener("change", (event) => {
      appState.selectedBranchId = event.target.value;
      renderApp();
    });
  }
}

function renderAgencyView() {
  const branchId = getSelectedBranchId();

  if (!branchId) {
    app.innerHTML = `
      <div class="portal-placeholder">
        <h2>Agency not specified</h2>
        <p>Use <code>/?view=agency&amp;branchId=A07667</code>.</p>
      </div>
    `;
    return;
  }

  app.innerHTML = buildRecommendationCard(branchId, false);
}

function renderInitialState() {
  if (appState.route.mode === "bde") {
    app.innerHTML = `
      <div class="portal-placeholder">
        <h2>BDE Portal</h2>
        <p>Loading agency data from the repo...</p>
      </div>
    `;
    return;
  }

  if (appState.route.mode === "agency") {
    app.innerHTML = `
      <div class="portal-placeholder">
        <h2>Agency Portal</h2>
        <p>Branch ID: <strong>${escapeHtml(appState.route.branchId || "")}</strong></p>
        <p>Loading agency data from the repo...</p>
      </div>
    `;
    return;
  }

  renderUnknownRoute();
}

function renderApp() {
  if (appState.route.mode === "bde") {
    renderBdeView();
    return;
  }

  if (appState.route.mode === "agency") {
    renderAgencyView();
    return;
  }

  renderUnknownRoute();
}

async function loadCsvFromRepo() {
  const response = await fetch("./data.csv", { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Could not load data.csv (${response.status}).`);
  }

  const rawCsv = await response.text();

  if (!rawCsv.trim()) {
    throw new Error("data.csv is empty.");
  }

  const parsed = parseCsv(rawCsv);
  validateHeaders(parsed.headers);

  const normalized = normalizeRows(parsed.rows);
  const branches = extractBranches(normalized.normalizedRows);
  const branchMetrics = buildBranchMetrics(normalized.normalizedRows, branches);

  appState.rawCsv = rawCsv;
  appState.headers = parsed.headers;
  appState.rows = normalized.normalizedRows;
  appState.branches = branches;
  appState.branchMetrics = branchMetrics;
  appState.route = getRouteContext();
  appState.selectedBranchId = branches[0] || null;

  renderApp();
}

async function initApp() {
  renderInitialState();

  try {
    await loadCsvFromRepo();
  } catch (error) {
    app.innerHTML = `
      <div class="portal-placeholder">
        <h2>Data load error</h2>
        <p>${escapeHtml(error.message || "Failed to load data.")}</p>
        <p>Check that <code>data.csv</code> exists in the repo root and has the required headers.</p>
      </div>
    `;
  }
}

initApp();
