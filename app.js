const csvInput = document.getElementById("csvInput");
const loadCsvBtn = document.getElementById("loadCsvBtn");
const csvStatus = document.getElementById("csvStatus");
const app = document.getElementById("app");

const REQUIRED_HEADERS = [
  "Id Branch",
  "Date Txs",
  "Corridor",
  "Transaction Id"
];

let appState = {
  rawCsv: "",
  rows: [],
  headers: [],
  branches: [],
  branchMetrics: {},
  route: getRouteContext()
};

function getRouteContext() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const segments = path.split("/").filter(Boolean);

  if (segments.length === 1 && segments[0].toLowerCase() === "bde") {
    return {
      mode: "bde",
      branchId: null,
      path
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
      path
    };
  }

  return {
    mode: "unknown",
    branchId: null,
    path
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
    throw new Error(
      `Missing required header(s): ${missingHeaders.join(", ")}`
    );
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
  return Array.from(
    new Set(rows.map((row) => row.branchId).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
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
        corridorSummaries: []
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

    corridorSummaries.sort((a, b) => b.latestWeekTx - a.latestWeekTx);

    const corridorWeekTotalsByCorridor = {};
    corridorSummaries.forEach((summary) => {
      corridorWeekTotalsByCorridor[summary.corridor] = {};
      Object.keys(corridorWeekTotals).forEach((weekKey) => {
        corridorWeekTotalsByCorridor[summary.corridor][weekKey] =
          getNestedNumber(corridorWeekTotals, weekKey, summary.corridor);
      });
    });

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
      corridorSummaries
    };
  });

  return branchMetrics;
}

function getNestedNumber(map, firstKey, secondKey) {
  if (!map[firstKey] || !map[firstKey][secondKey]) {
    return 0;
  }

  return map[firstKey][secondKey];
}

function setStatus(message, isError = false) {
  csvStatus.textContent = message;
  csvStatus.style.color = isError ? "#b42318" : "";
}

function renderUnknownRoute() {
  app.innerHTML = `
    <div class="portal-placeholder">
      <h2>Route not recognized</h2>
      <p>Use <code>/bde</code> or <code>/agency/[branchId]</code>.</p>
      <p>Current path: <strong>${escapeHtml(appState.route.path)}</strong></p>
      <p>Static fallback option later: <code>/?view=bde</code> or <code>/?view=agency&amp;branchId=A07667</code></p>
    </div>
  `;
}

function renderBdePlaceholder() {
  const branchListHtml = appState.branches
    .map((branchId) => {
      const metrics = appState.branchMetrics[branchId];
      const topCorridor = metrics && metrics.corridorSummaries[0]
        ? metrics.corridorSummaries[0].corridor
        : "N/A";

      return `
        <li>
          <strong>${escapeHtml(branchId)}</strong>
          <span>Latest full week: ${escapeHtml(metrics.latestFullWeekLabel || "N/A")}</span>
          <span>Top corridor in latest full week: ${escapeHtml(topCorridor)}</span>
        </li>
      `;
    })
    .join("");

  app.innerHTML = `
    <div class="portal-placeholder">
      <h2>BDE Portal</h2>
      <p>CSV loaded successfully.</p>
      <p>Normalized rows: <strong>${appState.rows.length}</strong></p>
      <p>Agencies found: <strong>${appState.branches.length}</strong></p>
      <ul class="branch-list">
        ${branchListHtml}
      </ul>
      <p>This now has the weekly aggregation layer. Next we will turn it into a real recommendation card and selector.</p>
    </div>
  `;
}

function renderAgencyPlaceholder() {
  const branchId = appState.route.branchId;
  const matchingRows = appState.rows.filter((row) => row.branchId === branchId);
  const metrics = appState.branchMetrics[branchId];
  const topCorridor = metrics && metrics.corridorSummaries[0]
    ? metrics.corridorSummaries[0].corridor
    : "N/A";

  app.innerHTML = `
    <div class="portal-placeholder">
      <h2>Agency Portal</h2>
      <p>Branch ID from URL: <strong>${escapeHtml(branchId || "")}</strong></p>
      <p>Matching normalized rows: <strong>${matchingRows.length}</strong></p>
      <p>Latest full week: <strong>${escapeHtml(metrics ? metrics.latestFullWeekLabel : "N/A")}</strong></p>
      <p>Current top corridor in that week: <strong>${escapeHtml(topCorridor)}</strong></p>
      <p>Next we will convert this into the real recommendation card.</p>
    </div>
  `;
}

function renderInitialState() {
  if (appState.route.mode === "bde") {
    app.innerHTML = `
      <div class="portal-placeholder">
        <h2>BDE Portal</h2>
        <p>Paste a CSV and click Load CSV.</p>
      </div>
    `;
    return;
  }

  if (appState.route.mode === "agency") {
    app.innerHTML = `
      <div class="portal-placeholder">
        <h2>Agency Portal</h2>
        <p>Branch ID from URL: <strong>${escapeHtml(appState.route.branchId || "")}</strong></p>
        <p>Paste a CSV and click Load CSV.</p>
      </div>
    `;
    return;
  }

  renderUnknownRoute();
}

function renderApp() {
  if (appState.route.mode === "bde") {
    renderBdePlaceholder();
    return;
  }

  if (appState.route.mode === "agency") {
    renderAgencyPlaceholder();
    return;
  }

  renderUnknownRoute();
}

function handleLoadCsv() {
  const rawCsv = csvInput.value.trim();

  if (!rawCsv) {
    setStatus("Paste CSV data first.", true);
    return;
  }

  try {
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

    const invalidRowNote = normalized.invalidRows.length
      ? ` Skipped ${normalized.invalidRows.length} invalid row(s).`
      : "";

    setStatus(
      `Loaded ${normalized.normalizedRows.length} normalized rows across ${branches.length} agencies.${invalidRowNote}`
    );

    renderApp();
  } catch (error) {
    setStatus(error.message || "Failed to load CSV.", true);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadCsvBtn.addEventListener("click", handleLoadCsv);

renderInitialState();
