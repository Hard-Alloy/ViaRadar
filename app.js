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
      branchId: decodeURIComponent(segments[1]),
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
      row[header] = values[index] !== undefined ? values[index] : "";
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
    </div>
  `;
}

function renderBdePlaceholder() {
  app.innerHTML = `
    <div class="portal-placeholder">
      <h2>BDE Portal</h2>
      <p>CSV loaded successfully.</p>
      <p>Rows loaded: <strong>${appState.rows.length}</strong></p>
      <p>This is the placeholder for the BDE agency selector and recommendation card.</p>
    </div>
  `;
}

function renderAgencyPlaceholder() {
  app.innerHTML = `
    <div class="portal-placeholder">
      <h2>Agency Portal</h2>
      <p>Branch ID from URL: <strong>${escapeHtml(appState.route.branchId || "")}</strong></p>
      <p>Rows loaded: <strong>${appState.rows.length}</strong></p>
      <p>This is the placeholder for the agency recommendation card.</p>
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

    appState.rawCsv = rawCsv;
    appState.headers = parsed.headers;
    appState.rows = parsed.rows;

    setStatus(`Loaded ${parsed.rows.length} rows successfully.`);
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
