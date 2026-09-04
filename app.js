const el = (id) => document.getElementById(id);
const drop = el("drop");
const fileInput = el("file");
const statusBox = el("status");
const report = el("report");
const signalsBody = el("signals-body");

let groups = [];
let clusters = [];
let structured = [];
let fieldMeta = {};

const NUMERIC = /^-?\d+(\.\d+)?$/;

function numOf(v) {
  const m = /^-?\d+(\.\d+)?/.exec(String(v));
  if (!m) return null;
  const after = String(v)[m[0].length];
  if (after && /[0-9.A-Za-z]/.test(after)) return null;
  return parseFloat(m[0]);
}

let dictPromise = null;
function loadDict() {
  if (!dictPromise) {
    dictPromise = fetch("data-dictionary.json")
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return dictPromise;
}

const themeToggle = el("theme-toggle");
function applyTheme(t, persist) {
  document.documentElement.dataset.theme = t;
  if (persist) localStorage.setItem("theme", t);
  themeToggle.checked = t === "dark";
  el("switch-label").textContent = t === "dark" ? "Dark" : "Light";
}
const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
applyTheme(localStorage.getItem("theme") || (colorScheme.matches ? "dark" : "light"));
colorScheme.addEventListener("change", (e) => {
  if (!localStorage.getItem("theme")) applyTheme(e.matches ? "dark" : "light");
});
themeToggle.addEventListener("change", () =>
  applyTheme(themeToggle.checked ? "dark" : "light", true)
);

const CLUSTER_RULES = [
  [/oil|service|inspection|maintenance|brake.?pad|mileage|wear|adblue|coolant/, "Maintenance Related Information"],
  [/charg|state.?of.?charge|\bsoc\b|plug|cable/, "Charging"],
  [/climat|heating|cabin|air.?condition/, "Climatisation and Heating"],
  [/trip|consumption|average.?speed|distance.?travel|odometer/, "Trip Statistics"],
  [/door|lock|unlock|access|window|sunroof|trunk|bonnet|tailgate/, "Vehicle Access"],
  [/\bpark/, "Parking Data"],
  [/location|position|gps|latitude|longitude/, "Vehicle Location Tracking"],
  [/warning|lamp|indicator|telltale/, "Vehicle Warning Lights"],
  [/volume|media|radio|album|artist|infotainment|navigation/, "Infotainment Related Data"],
  [/breakdown|assistance.?call|ecall|available.?range/, "Breakdown"],
  [/campaign|zfdi|tss.?id/, "Dynamic Technical Data Campaigns"],
  [/driv(ing|er).?(behaviou?r|style)|acceleration.?profile/, "Driving Behaviour"],
  [/dashboard|instrument.?cluster|scr.?range/, "Dashboard Measurements"],
  [/speed|engine|battery|voltage|pressure|temperature|fuel|status/, "Vehicle Status"],
];

function clusterOf(meta, name) {
  const specific = (meta.c || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== "All Data");
  if (specific.length) return specific[0];
  // match on the humanized name so word boundaries work on camelCase
  // ("sparkPlugVoltage" must not hit \bpark)
  const hay = (humanize(name) + " " + (meta.d || "")).toLowerCase();
  for (const [re, cluster] of CLUSTER_RULES) if (re.test(hay)) return cluster;
  return "Other";
}

function humanize(name) {
  return name
    .replace(/\[(\d+)\]/g, "$1")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function setStatus(msg, isError) {
  statusBox.hidden = false;
  statusBox.textContent = msg;
  statusBox.classList.toggle("error", !!isError);
}

async function readZip(file) {
  const zip = await JSZip.loadAsync(file);
  const docs = [];
  const entries = Object.values(zip.files).filter(
    (f) => !f.dir && f.name.toLowerCase().endsWith(".json")
  );
  if (!entries.length) throw new Error("No JSON files found in the archive.");
  for (const entry of entries) docs.push(parseJson(await entry.async("string"), entry.name));
  return docs;
}

function parseJson(text, name) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${name}: not valid JSON (${err.message})`);
  }
}

async function handleFiles(files) {
  try {
    const list = [...files].filter((f) => /\.(zip|json)$/i.test(f.name));
    if (!list.length) throw new Error("Drop a .zip or one or more .json files.");
    setStatus(`Reading ${list.length} file${list.length > 1 ? "s" : ""}…`);
    const docs = [];
    for (const file of list) {
      if (file.name.toLowerCase().endsWith(".zip")) {
        docs.push(...(await readZip(file)));
      } else {
        docs.push(parseJson(await file.text(), file.name));
      }
    }
    const dict = await loadDict();
    build(docs, dict);
  } catch (err) {
    setStatus(err.message || String(err), true);
  }
}

function parsePath(name) {
  const segs = [];
  for (const part of name.split(".")) {
    const m = part.match(/^([^[\]]*)((?:\[\d+\])*)$/);
    if (!m) {
      segs.push({ k: part });
      continue;
    }
    if (m[1]) segs.push({ k: m[1] });
    for (const b of m[2].match(/\d+/g) || []) segs.push({ i: +b });
  }
  return segs;
}

function insert(root, segs, value) {
  let node = root;
  for (let s = 0; s < segs.length - 1; s++) {
    const key = segs[s].k ?? segs[s].i;
    if (node[key] == null || typeof node[key] !== "object") node[key] = {};
    node = node[key];
  }
  const last = segs[segs.length - 1];
  node[last.k ?? last.i] = value;
}

// Exports have varied across portal versions and may change again; accept the
// known container and field spellings instead of exactly one shape.
function rowsOf(doc) {
  if (Array.isArray(doc)) return doc;
  if (!doc || typeof doc !== "object") return [];
  if (Array.isArray(doc.Data)) return doc.Data;
  if (Array.isArray(doc.data)) return doc.data;
  for (const v of Object.values(doc)) {
    if (
      Array.isArray(v) &&
      v.length &&
      v[0] &&
      typeof v[0] === "object" &&
      ("dataFieldName" in v[0] || "dataPointName" in v[0] || "name" in v[0])
    )
      return v;
  }
  return [];
}

const nameOf = (row) => row.dataFieldName ?? row.dataPointName ?? row.name;
const timeOf = (row) => row.timestampUtc ?? row.timestampUTC ?? row.timestamp ?? row.carCapturedTime;

function metaOf(dict, row) {
  const known = dict[row.key];
  if (known) return { meta: known, undocumented: false };
  // a future export may carry its own metadata inline; use it when the
  // bundled dictionary has no entry for the key
  const meta = {};
  const d = row.description ?? row.desc;
  const u = row.unit ?? row.measurementUnit;
  const c = row.cluster ?? row.dataCluster;
  if (d) meta.d = String(d);
  if (u) meta.u = String(u);
  if (c) meta.c = String(c);
  return { meta, undocumented: row.key != null };
}

function build(docs, dict) {
  const vins = new Set();
  const users = new Set();
  const map = new Map();
  const roots = {};
  fieldMeta = {};
  let structuredCount = 0;

  for (const doc of docs) {
    if (doc && !Array.isArray(doc)) {
      if (doc.vin) vins.add(doc.vin);
      if (doc.userId) users.add(doc.userId);
    }
    for (const row of rowsOf(doc)) {
      if (!row || typeof row !== "object") continue;
      const name = nameOf(row);
      if (!name) continue;
      const { meta, undocumented } = metaOf(dict, row);
      if (name.includes(".") || name.includes("[")) {
        insert(roots, parsePath(name), row.value);
        fieldMeta[name.replace(/\[\d+\]/g, "[*]")] = meta;
        structuredCount++;
        continue;
      }
      let g = map.get(name);
      if (!g) {
        g = {
          name,
          label: humanize(name),
          unit: meta.u || "",
          desc: meta.d || "",
          type: meta.t || "",
          cluster: clusterOf(meta, name),
          undocumented,
          rows: [],
        };
        map.set(name, g);
      }
      const time = timeOf(row);
      g.rows.push({ value: row.value, time, t: new Date(time).getTime() });
    }
  }

  if (!map.size && !structuredCount)
    throw new Error(
      "No vehicle records found — expected VAG JSON export(s) containing a \"Data\" array."
    );

  let minTime = Infinity;
  let maxTime = -Infinity;

  const tv = (r) => (isNaN(r.t) ? -Infinity : r.t);
  groups = [...map.values()]
    .filter((g) => g.rows.length > 0)
    .map((g) => {
      // newest first; records without a valid timestamp sink to the end
      g.rows.sort((a, b) => tv(b) - tv(a) || 0);
      const latest = g.rows[0];
      // newest row that has a value; rows whose `value` field is missing
      // are common in real exports and the Latest column should show the
      // newest measurement, not "undefined"
      const withValue = g.rows.find((r) => r.value !== undefined && r.value !== null && r.value !== "");
      const series = g.rows
        .map((r) => ({ x: r.t, y: numOf(r.value) }))
        .filter((p) => p.y !== null && !isNaN(p.x))
        .sort((a, b) => a.x - b.x);
      const ys = series.map((p) => p.y);
      const ts = g.rows.map((r) => r.t).filter((t) => !isNaN(t));
      const tMin = ts.length ? ts[ts.length - 1] : NaN;
      const tMax = ts.length ? ts[0] : NaN;
      if (tMin < minTime) minTime = tMin;
      if (tMax > maxTime) maxTime = tMax;
      g.series = series;
      g.count = g.rows.length;
      g.latest = withValue ? withValue.value : undefined;
      g.latestT = latest.t;
      // no spread here: Math.min(...ys) overflows the stack on 100k+ records
      let mn = Infinity;
      let mx = -Infinity;
      for (const y of ys) {
        if (y < mn) mn = y;
        if (y > mx) mx = y;
      }
      g.min = ys.length ? mn : null;
      g.max = ys.length ? mx : null;
      return g;
    });
  groups.forEach((g, i) => (g.i = i));

  const byCluster = new Map();
  for (const g of groups) {
    if (!byCluster.has(g.cluster)) byCluster.set(g.cluster, []);
    byCluster.get(g.cluster).push(g);
  }
  clusters = [...byCluster.entries()]
    .map(([name, list]) => ({
      name,
      list: list.sort((a, b) => b.count - a.count),
      count: list.reduce((s, x) => s + x.count, 0),
    }))
    .sort((a, b) => b.list.length - a.list.length);

  structured = Object.keys(roots)
    .sort()
    .map((k) => ({ name: k, label: humanize(k), tree: roots[k] }));

  const sel = el("cluster-filter");
  sel.innerHTML =
    '<option value="">All clusters</option>' +
    clusters.map((c) => `<option value="${esc(c.name)}">${esc(c.name)} (${c.list.length})</option>`).join("");

  renderVehicle(vins, users, minTime, maxTime, structuredCount);
  renderSignals();
  renderStructured();
  statusBox.hidden = true;
  report.hidden = false;
  // after unhiding, so the map container has a real size
  renderTrack();
}

function fmtDate(ts) {
  const d = new Date(ts);
  return isNaN(d) ? "—" : d.toLocaleString();
}

function renderVehicle(vins, users, minTime, maxTime, structuredCount) {
  const total = groups.reduce((s, g) => s + g.count, 0) + structuredCount;
  const newCount = groups.filter((g) => g.undocumented).length;
  const cards = [
    ["VIN", vins.size === 1 ? [...vins][0] : `${vins.size} vehicles`],
    ["User ID", users.size === 1 ? [...users][0] : `${users.size} users`],
    ["Total records", total.toLocaleString()],
    ["Signals", groups.length.toLocaleString()],
    ["Clusters", clusters.length.toLocaleString()],
    ["Structured groups", structured.length.toLocaleString()],
    ["First seen", isFinite(minTime) ? fmtDate(minTime) : "—"],
    ["Last seen", isFinite(maxTime) ? fmtDate(maxTime) : "—"],
  ];
  if (newCount) cards.push(["New fields", newCount.toLocaleString()]);
  el("vehicle").innerHTML = cards
    .map(([k, v]) => `<div class="card"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`)
    .join("");
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function unitText(u) {
  return u ? ` <span class="unit">${esc(u)}</span>` : "";
}

function valCell(v, unit) {
  if (v === undefined || v === null || v === "") return "—";
  return esc(v) + (NUMERIC.test(String(v)) ? unitText(unit) : "");
}

let sortKey = null;
let sortDir = -1;

const SORTS = {
  label: (a, b) => a.label.localeCompare(b.label),
  count: (a, b) => a.count - b.count,
  latest: (a, b) => {
    const x = numOf(a.latest);
    const y = numOf(b.latest);
    if (x !== null && y !== null) return x - y;
    if (x !== null) return 1;
    if (y !== null) return -1;
    return String(a.latest).localeCompare(String(b.latest));
  },
  min: (a, b) => (a.min ?? -Infinity) - (b.min ?? -Infinity),
  max: (a, b) => (a.max ?? -Infinity) - (b.max ?? -Infinity),
  time: (a, b) => (isNaN(a.latestT) ? -Infinity : a.latestT) - (isNaN(b.latestT) ? -Infinity : b.latestT),
};

function renderSignals() {
  const q = el("search").value.trim().toLowerCase();
  const only = el("cluster-filter").value;
  el("signals-count").textContent = groups.length;

  const arrow = (k) => (sortKey === k ? (sortDir > 0 ? " ▲" : " ▼") : "");
  const ariaSort = (k) =>
    sortKey === k ? ` aria-sort="${sortDir > 0 ? "ascending" : "descending"}"` : "";

  // keep groups the user expanded open across re-renders (search, sort, filter)
  const openNow = new Set(
    [...signalsBody.querySelectorAll("details[open]")].map((d) => d.dataset.name)
  );

  let shown = 0;
  signalsBody.innerHTML = clusters
    .filter((c) => !only || c.name === only)
    .map((c) => {
      const inCluster = c.name.toLowerCase().includes(q);
      const rows = c.list.filter(
        (g) =>
          !q ||
          inCluster ||
          g.label.toLowerCase().includes(q) ||
          g.name.toLowerCase().includes(q) ||
          g.desc.toLowerCase().includes(q)
      );
      if (!rows.length) return "";
      if (sortKey) rows.sort((a, b) => (SORTS[sortKey](a, b) || 0) * sortDir);
      shown += rows.length;
      const open = openNow.has(c.name) || q || only || clusters.length <= 3 ? " open" : "";
      return `<details class="struct-group" data-name="${esc(c.name)}"${open}>
        <summary>${esc(c.name)} <span class="muted">${rows.length} signal${rows.length > 1 ? "s" : ""}</span><button class="raw-btn" type="button" aria-label="Show raw data for this cluster">Raw</button></summary>
        <div class="struct-body"><table>
          <thead><tr>
            <th data-sort="label" tabindex="0"${ariaSort("label")}>Signal${arrow("label")}</th>
            <th class="num" data-sort="count" tabindex="0"${ariaSort("count")}>Records${arrow("count")}</th>
            <th class="num" data-sort="latest" tabindex="0"${ariaSort("latest")}>Latest${arrow("latest")}</th>
            <th class="num" data-sort="min" tabindex="0"${ariaSort("min")}>Min${arrow("min")}</th>
            <th class="num" data-sort="max" tabindex="0"${ariaSort("max")}>Max${arrow("max")}</th>
            <th data-sort="time" tabindex="0"${ariaSort("time")}>Last seen${arrow("time")}</th>
          </tr></thead>
          <tbody>${rows
            .map(
              (g) => `<tr class="signal" tabindex="0" aria-expanded="false" data-i="${g.i}">
            <td><div class="name">${esc(g.label)}${
                g.undocumented
                  ? ' <span class="flag-new" title="This field is not in the bundled data dictionary yet — it may have been added to the vehicle data recently.">new</span>'
                  : ""
              }</div>
              ${g.desc ? `<div class="sub">${esc(g.desc)}</div>` : ""}
              <div class="sub raw">${esc(g.name)}</div></td>
            <td class="num">${g.count.toLocaleString()}</td>
            <td class="num">${valCell(g.latest, g.unit)}</td>
            <td class="num">${g.min === null ? "—" : g.min}</td>
            <td class="num">${g.max === null ? "—" : g.max}</td>
            <td>${fmtDate(g.latestT)}</td>
          </tr>`
            )
            .join("")}</tbody>
        </table></div>
      </details>`;
    })
    .join("");

  if (!shown) signalsBody.innerHTML = '<p class="hint">No signals match the filter.</p>';

  signalsBody.querySelectorAll(".raw-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleClusterRaw(btn.closest("details.struct-group"));
    });
  });
}

function toggleClusterRaw(detailsEl) {
  const next = detailsEl.querySelector(".cluster-raw-pane");
  if (next) {
    next.remove();
    return;
  }
  const cName = detailsEl.dataset.name;
  const cluster = clusters.find((c) => c.name === cName);
  if (!cluster) return;
  const allRows = [];
  for (const g of cluster.list) {
    for (const r of g.rows) allRows.push({ g, r });
  }
  allRows.sort((a, b) => {
    const ta = isNaN(a.r.t) ? -Infinity : a.r.t;
    const tb = isNaN(b.r.t) ? -Infinity : b.r.t;
    return tb - ta;
  });
  const shown = allRows.slice(0, 2000);
  const note = allRows.length > shown.length
    ? `<p class="hint">Raw shows the latest ${shown.length.toLocaleString()} of ${allRows.length.toLocaleString()} records in this cluster.</p>`
    : "";
  const html = `<div class="cluster-raw-pane raw-pane"><div class="history-wrap"><table>
    <thead><tr><th>Field</th><th class="num">Value</th><th>Timestamp</th></tr></thead>
    <tbody>${shown
      .map(
        ({ g, r }) => `<tr><td class="raw-field">${esc(g.name)}</td><td class="num">${
          r.value === undefined || r.value === null || r.value === "" ? "" : esc(r.value)
        }</td><td>${fmtDate(r.t)}</td></tr>`
      )
      .join("")}</tbody>
  </table></div></div>`;
  const table = detailsEl.querySelector(".struct-body");
  table.insertAdjacentHTML("afterend", html);
}

function metaFor(path) {
  return fieldMeta[path];
}

function isArrayNode(o) {
  const ks = Object.keys(o);
  return ks.length > 0 && ks.every((k) => /^\d+$/.test(k));
}

function nodeEntries(o) {
  return isArrayNode(o)
    ? Object.keys(o)
        .sort((a, b) => a - b)
        .map((k) => [k, o[k]])
    : Object.entries(o);
}

const isScalar = (v) => v === null || typeof v !== "object";

function renderNode(node, path, depth) {
  if (isScalar(node)) {
    if (node == null) return "—";
    const m = metaFor(path);
    return esc(node) + (m && m.u ? unitText(m.u) : "");
  }

  const entries = nodeEntries(node);
  const asArray = isArrayNode(node);

  if (asArray && entries.every(([, v]) => isScalar(v))) {
    return esc(entries.map(([, v]) => v).join(", "));
  }

  const objectRows =
    asArray && entries.every(([, v]) => v && typeof v === "object" && !isArrayNode(v));

  if (objectRows) {
    const elemPath = path + ".[*]";
    const flat = entries.every(([, v]) => Object.values(v).every(isScalar));
    let inner;
    if (flat) {
      const cols = [];
      for (const [, v] of entries) for (const c of Object.keys(v)) if (!cols.includes(c)) cols.push(c);
      inner = `<div class="table-scroll"><table class="struct">
        <thead><tr><th>#</th>${cols
          .map((c) => {
            const m = metaFor(elemPath + "." + c);
            return `<th${m && m.d ? ` title="${esc(m.d)}"` : ""}>${esc(humanize(c))}</th>`;
          })
          .join("")}</tr></thead>
        <tbody>${entries
          .map(
            ([i, v]) =>
              `<tr><td class="idx">${i}</td>${cols
                .map((c) => `<td>${c in v ? renderNode(v[c], elemPath + "." + c, depth + 1) : ""}</td>`)
                .join("")}</tr>`
          )
          .join("")}</tbody></table></div>`;
    } else {
      inner = `<div class="recs">${entries
        .map(
          ([i, v]) =>
            `<div class="rec"><div class="rec-h">#${esc(i)}</div><div class="rec-b">${renderNode(
              v,
              elemPath,
              depth + 1
            )}</div></div>`
        )
        .join("")}</div>`;
    }
    const n = entries.length;
    return `<details class="arr"${depth <= 1 ? " open" : ""}><summary>${n} item${
      n === 1 ? "" : "s"
    }</summary>${inner}</details>`;
  }

  if (!asArray && depth > 0 && entries.every(([, v]) => isScalar(v))) {
    return `<div class="kv-inline">${entries
      .map(([k, v]) => {
        const m = metaFor(path + "." + k);
        return `<span${m && m.d ? ` title="${esc(m.d)}"` : ""}><b>${esc(
          humanize(k)
        )}</b> ${esc(v)}${m && m.u ? unitText(m.u) : ""}</span>`;
      })
      .join("")}</div>`;
  }

  return `<table class="struct kv"><tbody>${entries
    .map(([k, v]) => {
      const childPath = asArray ? path + ".[*]" : path + "." + k;
      const m = metaFor(childPath);
      return `<tr><th${m && m.d ? ` title="${esc(m.d)}"` : ""}>${esc(
        asArray ? `#${k}` : humanize(k)
      )}</th><td>${renderNode(v, childPath, depth + 1)}</td></tr>`;
    })
    .join("")}</tbody></table>`;
}

const ROOT_INFO = {
  VSR: "Vehicle Status Report — periodic snapshots of vehicle data points (mileage, warning lights, fluid levels, …).",
  RLU: "Remote Lock & Unlock — door lock/unlock request sessions and their results.",
  RBC: "Remote Battery Charging — charging state, state of charge and charger settings.",
  RPC: "Remote Pre-trip Climatisation — cabin climate and target-temperature settings.",
  RTS: "Remote Trip Statistics — trip records and their deletion history.",
  RPT: "Remote departure & charging profiles — timer/profile options including smart charging.",
  PSO: "Personalisation settings — user profile settings and their sync revisions.",
  OTV: "Customer-contact call records linked to status, maintenance and configuration requests.",
};

function renderStructured() {
  const section = el("structured-section");
  if (!structured.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  el("structured-count").textContent = structured.length;
  el("structured-body").innerHTML = structured
    .map((s) => {
      const info = ROOT_INFO[s.name];
      const title = info ? info.split("—")[0].trim() : s.label;
      return `<details class="struct-group"><summary>${esc(title)} <span class="muted">${esc(
        s.name
      )}</span></summary><div class="struct-body">${
        info ? `<p class="hint">${esc(info)}</p>` : ""
      }${renderNode(s.tree, s.name, 0)}</div></details>`;
    })
    .join("");
}

let trackMap = null;

function buildTrack() {
  const latG = groups.find((g) => /\blat(itude)?\b/.test(humanize(g.name).toLowerCase()));
  const lonG = groups.find((g) => /\b(longitude|lon|lng)\b/.test(humanize(g.name).toLowerCase()));
  if (!latG || !lonG || latG === lonG) return [];
  const lonByTime = new Map();
  for (const r of lonG.rows) if (!isNaN(r.t)) lonByTime.set(r.t, r.value);
  const pts = [];
  for (const r of latG.rows) {
    if (isNaN(r.t) || !lonByTime.has(r.t)) continue;
    const lat = parseFloat(r.value);
    const lon = parseFloat(lonByTime.get(r.t));
    if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    pts.push({ lat, lon, t: r.t });
  }
  return pts.sort((a, b) => a.t - b.t);
}

function renderTrack() {
  const section = el("track-section");
  if (trackMap) {
    trackMap.remove();
    trackMap = null;
  }
  const btn = el("osm-btn");
  btn.hidden = false;
  section.querySelector(".osm-loaded")?.remove();

  const pts = buildTrack();
  if (pts.length < 2 || typeof L === "undefined") {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  el("track-count").textContent = pts.length;

  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  trackMap = L.map("track-map");
  const latlngs = pts.map((p) => [p.lat, p.lon]);
  L.polyline(latlngs, { color: accent, weight: 3, opacity: 0.85 }).addTo(trackMap);
  pts.forEach((p, i) => {
    const first = i === 0;
    const last = i === pts.length - 1;
    L.circleMarker([p.lat, p.lon], {
      radius: first || last ? 7 : 5,
      color: accent,
      weight: 2,
      fillColor: first ? "#3fa34d" : last ? "#d05353" : accent,
      fillOpacity: 0.9,
    })
      .bindPopup(
        `<div class="track-popup"><b>#${i + 1}${first ? " — start" : last ? " — end" : ""}</b><br>` +
          `${fmtDate(p.t)}<br>${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</div>`
      )
      .addTo(trackMap);
  });
  trackMap.fitBounds(latlngs, { padding: [30, 30] });
}

el("osm-btn").addEventListener("click", () => {
  if (!trackMap) return;
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(trackMap);
  const btn = el("osm-btn");
  btn.hidden = true;
  btn.insertAdjacentHTML(
    "afterend",
    '<span class="osm-loaded">Street map on — tiles &copy; OpenStreetMap contributors</span>'
  );
});

function buildChart(canvas, g) {
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `${g.label} history chart — the Table tab has the same data`);
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue("--accent").trim();
  const line = css.getPropertyValue("--line").trim();
  const muted = css.getPropertyValue("--muted").trim();
  return new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: g.label,
          data: g.series,
          borderColor: accent,
          backgroundColor: accent + "33",
          borderWidth: 1.5,
          pointRadius: g.series.length > 200 ? 0 : 2,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.15,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      interaction: { mode: "nearest", intersect: false },
      scales: {
        x: {
          type: "linear",
          grid: { color: line },
          ticks: {
            color: muted,
            maxRotation: 0,
            autoSkipPadding: 24,
            callback: (v) => new Date(v).toLocaleDateString(),
          },
        },
        y: {
          grid: { color: line },
          ticks: { color: muted },
          title: g.unit ? { display: true, text: g.unit, color: muted } : {},
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => new Date(items[0].parsed.x).toLocaleString(),
            label: (item) => ` ${item.parsed.y}${g.unit ? " " + g.unit : ""}`,
          },
        },
        zoom: {
          pan: { enabled: true, mode: "x" },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" },
        },
      },
    },
  });
}

function toggleHistory(tr) {
  const next = tr.nextElementSibling;
  if (next && next.classList.contains("history")) {
    if (next._chart) next._chart.destroy();
    next.remove();
    tr.setAttribute("aria-expanded", "false");
    return;
  }
  tr.setAttribute("aria-expanded", "true");
  const g = groups[+tr.dataset.i];
  const hasChart = g.series.length >= 2;
  const rows = g.rows.slice(0, 2000);
  const note =
    g.rows.length > rows.length
      ? `<p class="hint">Table shows the latest ${rows.length.toLocaleString()} of ${g.count.toLocaleString()} records. The chart includes all numeric points.</p>`
      : "";

  const tableHtml = `
    <div class="history-wrap"><table>
      <thead><tr><th>Timestamp</th><th class="num">Value</th></tr></thead>
      <tbody>${rows
        .map((r) => `<tr><td>${fmtDate(r.t)}</td><td class="num">${valCell(r.value, g.unit)}</td></tr>`)
        .join("")}</tbody>
    </table></div>`;

  const rawRows = g.rows.slice(0, 2000);
  const rawNote = g.rows.length > rawRows.length
    ? `<p class="hint">Raw shows the latest ${rawRows.length.toLocaleString()} of ${g.count.toLocaleString()} records.</p>`
    : "";
  const rawHtml = `
    <div class="history-wrap"><table>
      <thead><tr><th>Field</th><th class="num">Value</th><th>Timestamp</th></tr></thead>
      <tbody>${rawRows
        .map(
          (r) => `<tr><td class="raw-field">${esc(g.name)}</td><td class="num">${
            r.value === undefined || r.value === null || r.value === "" ? "" : esc(r.value)
          }</td><td>${fmtDate(r.t)}</td></tr>`
        )
        .join("")}</tbody>
    </table></div>`;

  const desc = g.desc ? `<p class="history-desc">${esc(g.desc)}</p>` : "";
  const html = `
    <tr class="history"><td colspan="6"><div class="history-inner">
      ${desc}
      <div class="history-tabs">
        ${hasChart ? '<button data-tab="chart" class="active">Chart</button>' : ""}
        <button data-tab="table"${hasChart ? "" : ' class="active"'}>Table</button>
        <button data-tab="raw">Raw</button>
      </div>
      ${hasChart ? '<div class="hint">Scroll to zoom, drag to pan, hover for values.</div><div class="pane chart-box"><canvas></canvas></div>' : ""}
      <div class="pane table-pane"${hasChart ? " hidden" : ""}>${note}${tableHtml}</div>
      <div class="pane raw-pane" hidden>${rawNote}${rawHtml}</div>
    </div></td></tr>`;
  tr.insertAdjacentHTML("afterend", html);

  const histRow = tr.nextElementSibling;
  if (hasChart) histRow._chart = buildChart(histRow.querySelector("canvas"), g);
  histRow.querySelectorAll(".history-tabs button").forEach((btn) =>
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      histRow.querySelectorAll(".history-tabs button").forEach((b) => b.classList.toggle("active", b === btn));
      const chartBox = histRow.querySelector(".chart-box");
      if (chartBox) chartBox.hidden = tab !== "chart";
      histRow.querySelector(".table-pane").hidden = tab !== "table";
      histRow.querySelector(".raw-pane").hidden = tab !== "raw";
    })
  );
}

function csvField(v) {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv() {
  const lines = ["cluster,signal,field,unit,value,timestampUtc"];
  for (const g of groups) {
    for (const r of g.rows) {
      lines.push([g.cluster, g.label, g.name, g.unit, r.value, r.time].map(csvField).join(","));
    }
  }
  const walk = (root, node, path) => {
    if (isScalar(node)) {
      const m = metaFor((root + (path ? "." + path : "")).replace(/\[\d+\]/g, "[*]")) || {};
      lines.push(["structured", root, path, m.u || "", node, ""].map(csvField).join(","));
      return;
    }
    for (const [k, v] of nodeEntries(node)) walk(root, v, path ? `${path}.${k}` : k);
  };
  for (const s of structured) walk(s.name, s.tree, "");

  // BOM + CRLF so Excel opens the file with correct encoding
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "vehicle-data.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

fileInput.addEventListener("change", (e) => e.target.files.length && handleFiles(e.target.files));

["dragenter", "dragover"].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("over");
  })
);
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove("over");
  })
);
drop.addEventListener("drop", (e) => e.dataTransfer.files.length && handleFiles(e.dataTransfer.files));

// the whole dropzone opens the picker, not just the label text
drop.addEventListener("click", (e) => {
  if (e.target.closest("label, button, input")) return;
  fileInput.click();
});

let searchTimer;
el("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderSignals, 120);
});
el("cluster-filter").addEventListener("change", renderSignals);
el("export-btn").addEventListener("click", exportCsv);

el("sample-btn").addEventListener("click", async () => {
  try {
    setStatus("Loading sample data…");
    const res = await fetch("sample/sample-data.zip", { cache: "no-store" });
    if (!res.ok) throw new Error("Sample data not found.");
    handleFiles([new File([await res.blob()], "sample-data.zip")]);
  } catch (err) {
    setStatus(err.message, true);
  }
});

function applySort(k) {
  if (sortKey === k) sortDir = -sortDir;
  else {
    sortKey = k;
    sortDir = k === "label" ? 1 : -1;
  }
  renderSignals();
}

signalsBody.addEventListener("click", (e) => {
  const th = e.target.closest("th[data-sort]");
  if (th) {
    applySort(th.dataset.sort);
    return;
  }
  if (e.target.closest(".history-tabs")) return;
  const tr = e.target.closest("tr.signal");
  if (tr) toggleHistory(tr);
});

signalsBody.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const th = e.target.closest("th[data-sort]");
  if (th) {
    e.preventDefault();
    const group = th.closest("details")?.dataset.name || "";
    applySort(th.dataset.sort);
    // the table was rebuilt — put focus back on the header that was sorted
    signalsBody
      .querySelector(`details[data-name="${CSS.escape(group)}"] th[data-sort="${th.dataset.sort}"]`)
      ?.focus();
    return;
  }
  const tr = e.target.closest("tr.signal");
  if (tr) {
    e.preventDefault();
    toggleHistory(tr);
  }
});
