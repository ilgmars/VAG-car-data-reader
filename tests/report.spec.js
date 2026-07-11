const { test, expect } = require("@playwright/test");
const JSZip = require("../vendor/jszip.min.js");

async function zipOf(entries) {
  const zip = new JSZip();
  for (const [name, doc] of Object.entries(entries)) zip.file(name, JSON.stringify(doc));
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

function docOf(vin, signal, values) {
  return {
    vin,
    Data: values.map((v, i) => ({
      dataFieldName: signal,
      value: String(v),
      timestampUtc: `2031-08-0${i + 1}T10:00:00.000Z`,
    })),
  };
}

let pageErrors;

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && pageErrors.push("console: " + m.text()));
  await page.goto("/");
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

async function expectNoHorizontalScroll(page) {
  const overflow = await page.evaluate(
    () => document.scrollingElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function loadSample(page) {
  await page.click("#sample-btn");
  await expect(page.locator("#report")).toBeVisible({ timeout: 20000 });
}

async function openFirstGroup(page) {
  const group = page.locator("#signals-body details").first();
  if (!(await group.getAttribute("open")) && (await group.getAttribute("open")) !== "") {
    await group.locator("summary").click();
  }
  return group;
}

test("loads without errors, no external requests, no horizontal scroll", async ({ page }) => {
  await expect(page.locator("h1")).toContainText("VAG Car Data Reader");
  const external = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .filter((u) => !u.startsWith(location.origin))
  );
  expect(external).toEqual([]);
  await expectNoHorizontalScroll(page);
});

test("theme toggle flips the theme and persists across reloads", async ({ page }) => {
  const initial = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.locator(".switch .track").click();
  const flipped = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(flipped).not.toBe(initial);
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(flipped);
});

test("sample data renders the full report and fits the viewport", async ({ page }) => {
  await loadSample(page);
  await expect(page.locator("#vehicle .card")).toHaveCount(9);
  await expect(page.locator("#vehicle")).toContainText("New fields");
  expect(await page.locator("tr.signal").count()).toBeGreaterThan(10);
  await expect(page.locator("#structured-section")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("sample demonstrates the full range of tool capabilities", async ({ page }) => {
  await loadSample(page);
  // merged multi-file zip keeps a single vehicle
  await expect(page.locator("#vehicle")).toContainText("WVWZZZ1KZAW000001");
  // every official cluster plus the "Other" fallback bucket
  const clusterNames = await page
    .locator("#signals-body details > summary")
    .allTextContents();
  expect(clusterNames.length).toBeGreaterThanOrEqual(15);
  expect(clusterNames.join(" ")).toContain("Other");
  // an undocumented field shows the "new" badge and its inline metadata
  await expect(page.locator(".flag-new")).toHaveCount(1);
  const newRow = page.locator("tr.signal", { has: page.locator(".flag-new") });
  await expect(newRow).toContainText("battery pre-conditioning");
  await expect(newRow).toContainText("%");
});

test("signal history opens with chart/table tabs and closes again", async ({ page }) => {
  await loadSample(page);
  const group = await openFirstGroup(page);
  const row = group.locator("tr.signal").first();
  await row.click();
  const history = page.locator("tr.history");
  await expect(history).toHaveCount(1);
  await expect(row).toHaveAttribute("aria-expanded", "true");

  await history.locator('button[data-tab="table"]').click();
  await expect(history.locator(".table-pane tbody tr").first()).toBeVisible();
  await expectNoHorizontalScroll(page);

  await row.click();
  await expect(page.locator("tr.history")).toHaveCount(0);
  await expect(row).toHaveAttribute("aria-expanded", "false");
});

test("chart zooms in on mouse wheel", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "wheel interaction needs a mouse");
  await loadSample(page);
  const group = await openFirstGroup(page);
  await group.locator("tr.signal").first().click();
  const canvas = page.locator("tr.history canvas");
  await expect(canvas).toBeVisible();
  const xRange = () =>
    page.evaluate(() => {
      const chart = document.querySelector("tr.history")._chart;
      return chart.scales.x.max - chart.scales.x.min;
    });
  const before = await xRange();
  await canvas.hover();
  await page.mouse.wheel(0, -400);
  await expect.poll(xRange).toBeLessThan(before);
});

test("signal history is keyboard accessible", async ({ page }) => {
  await loadSample(page);
  const group = await openFirstGroup(page);
  const row = group.locator("tr.signal").first();
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("tr.history")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.locator("tr.history")).toHaveCount(0);
});

test("columns sort by click and by keyboard, with aria-sort", async ({ page }) => {
  await loadSample(page);
  const group = await openFirstGroup(page);
  const header = group.locator('th[data-sort="count"]');
  test.skip(!(await header.isVisible()), "table headers are hidden on this viewport");

  const values = async () =>
    (await group.locator("tr.signal td:nth-child(2)").allTextContents()).map((s) =>
      parseInt(s.replace(/\D/g, ""), 10)
    );

  await header.click();
  await expect(group.locator('th[data-sort="count"]')).toHaveAttribute("aria-sort", "descending");
  const desc = await values();
  expect([...desc].sort((a, b) => b - a)).toEqual(desc);

  await group.locator('th[data-sort="count"]').focus();
  await page.keyboard.press("Enter");
  await expect(group.locator('th[data-sort="count"]')).toHaveAttribute("aria-sort", "ascending");
  const asc = await values();
  expect([...asc].sort((a, b) => a - b)).toEqual(asc);
});

test("search filters signals and clearing restores them", async ({ page }) => {
  await loadSample(page);
  const total = await page.locator("tr.signal").count();
  await page.fill("#search", "charging");
  await expect
    .poll(async () => page.locator("tr.signal").count())
    .toBeLessThan(total);
  expect(await page.locator("tr.signal").count()).toBeGreaterThan(0);
  await page.fill("#search", "");
  await expect.poll(async () => page.locator("tr.signal").count()).toBe(total);
});

test("CSV export downloads a well-formed file", async ({ page }) => {
  await loadSample(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#export-btn"),
  ]);
  expect(download.suggestedFilename()).toBe("vehicle-data.csv");
  const fs = require("fs");
  const buf = fs.readFileSync(await download.path());
  expect([buf[0], buf[1], buf[2]]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
  expect(buf.toString("utf-8")).toContain("cluster,signal,field,unit,value,timestampUtc");
});

test("location signals render as a connected track, fully locally", async ({ page }) => {
  await loadSample(page);
  await expect(page.locator("#track-section")).toBeVisible();
  await expect(page.locator("#track-count")).toHaveText("12");
  // 1 polyline + 12 circle markers, all drawn as local SVG
  await expect(page.locator("#track-map path.leaflet-interactive")).toHaveCount(13);
  await expect(page.locator("#osm-btn")).toBeVisible();
  // rendering the map must not have contacted any external host
  const external = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .filter((u) => !u.startsWith(location.origin))
  );
  expect(external).toEqual([]);
  // markers carry timestamped popups
  await page.locator("#track-map path.leaflet-interactive").nth(1).click();
  await expect(page.locator(".track-popup")).toContainText("start");
  await expectNoHorizontalScroll(page);
});

test("street map tiles load only after explicit opt-in", async ({ page }) => {
  const PIXEL = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  let tileRequests = 0;
  await page.route("https://tile.openstreetmap.org/**", (route) => {
    tileRequests++;
    route.fulfill({ status: 200, contentType: "image/png", body: PIXEL });
  });
  await loadSample(page);
  await expect(page.locator("#track-section")).toBeVisible();
  expect(tileRequests).toBe(0); // nothing leaves the browser before consent
  await page.click("#osm-btn");
  await expect.poll(() => tileRequests).toBeGreaterThan(0);
  await expect(page.locator(".osm-loaded")).toContainText("OpenStreetMap contributors");
  await expect(page.locator("#osm-btn")).toBeHidden();
});

test("structured data section expands without breaking layout", async ({ page }) => {
  await loadSample(page);
  const section = page.locator("#structured-body details.struct-group").first();
  await section.locator("> summary").click();
  await expect(section.locator(".struct-body")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("clicking anywhere in the dropzone opens the file picker", async ({ page }) => {
  const chooser = page.waitForEvent("filechooser");
  await page.click("#drop", { position: { x: 8, y: 8 } });
  await chooser;
});

test("invalid JSON reports the offending file name", async ({ page }) => {
  await page.setInputFiles("#file", {
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from("{not json"),
  });
  await expect(page.locator("#status")).toContainText("bad.json");
});

test("multiple zip files dropped at once are merged into one report", async ({ page }) => {
  const a = await zipOf({ "a.json": docOf("WVWZZZ1KZAW000001", "firstArchiveSignal", [1, 2, 3]) });
  const b = await zipOf({ "b.json": docOf("WVWZZZ1KZAW000001", "secondArchiveSignal", [4, 5, 6]) });
  await page.setInputFiles("#file", [
    { name: "a.zip", mimeType: "application/zip", buffer: a },
    { name: "b.zip", mimeType: "application/zip", buffer: b },
  ]);
  await expect(page.locator("#report")).toBeVisible();
  await expect(page.locator("#signals-body")).toContainText("First Archive Signal");
  await expect(page.locator("#signals-body")).toContainText("Second Archive Signal");
  await expect(page.locator("tr.signal")).toHaveCount(2);
});

test("a zip and a loose json dropped together are merged, multi-VIN is summarised", async ({ page }) => {
  const a = await zipOf({ "a.json": docOf("WVWZZZ1KZAW000001", "archivedSignal", [7, 8]) });
  await page.setInputFiles("#file", [
    { name: "a.zip", mimeType: "application/zip", buffer: a },
    {
      name: "loose.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(docOf("WAUZZZ2KZBX000002", "looseSignal", [9, 10]))),
    },
  ]);
  await expect(page.locator("#report")).toBeVisible();
  await expect(page.locator("#signals-body")).toContainText("Archived Signal");
  await expect(page.locator("#signals-body")).toContainText("Loose Signal");
  await expect(page.locator("#vehicle")).toContainText("2 vehicles");
});

test("legacy minimal export (no keys, no wrapper extras) still renders", async ({ page }) => {
  const legacy = JSON.stringify({
    vin: "WVWZZZOLD000001",
    Data: [
      { dataFieldName: "mileage_km", value: "120500", timestampUtc: "2024-03-01T08:00:00Z" },
      { dataFieldName: "mileage_km", value: "120650", timestampUtc: "2024-03-08T08:00:00Z" },
      { dataFieldName: "fuelLevel", value: "55", timestampUtc: "2024-03-08T08:00:00Z" },
    ],
  });
  await page.setInputFiles("#file", {
    name: "legacy.json",
    mimeType: "application/json",
    buffer: Buffer.from(legacy),
  });
  await expect(page.locator("#report")).toBeVisible();
  await expect(page.locator("tr.signal")).toHaveCount(2);
  await expect(page.locator("#vehicle")).toContainText("WVWZZZOLD000001");
  // keyless legacy rows must not be flagged as new fields
  await expect(page.locator(".flag-new")).toHaveCount(0);
});

test("future export: aliases, inline metadata and unknown keys are presented", async ({ page }) => {
  // top-level array, renamed name/timestamp fields, a dictionary-unknown key,
  // and inline description/unit/cluster metadata
  const future = JSON.stringify([
    {
      dataPointName: "solarRoofYield",
      key: "ffffffff-0000-4fff-bfff-fffffffffff1",
      value: "1.8",
      timestamp: "2031-08-01T10:00:00Z",
      unit: "kWh",
      description: "Energy harvested by the solar roof",
      dataCluster: "Charging",
    },
    {
      dataPointName: "solarRoofYield",
      key: "ffffffff-0000-4fff-bfff-fffffffffff1",
      value: "2.4",
      timestamp: "2031-08-02T10:00:00Z",
      unit: "kWh",
      description: "Energy harvested by the solar roof",
      dataCluster: "Charging",
    },
  ]);
  await page.setInputFiles("#file", {
    name: "future.json",
    mimeType: "application/json",
    buffer: Buffer.from(future),
  });
  await expect(page.locator("#report")).toBeVisible();
  const row = page.locator("tr.signal").first();
  await expect(row).toContainText("Solar Roof Yield");
  await expect(row.locator(".flag-new")).toHaveCount(1); // marked as not-in-dictionary
  await expect(row).toContainText("Energy harvested by the solar roof"); // inline description used
  await expect(row).toContainText("kWh"); // inline unit used
  await expect(page.locator("#signals-body summary").first()).toContainText("Charging"); // inline cluster used
  await expect(page.locator("#vehicle")).toContainText("New fields"); // summary card appears
});

test("valid JSON without vehicle data is rejected with a clear message", async ({ page }) => {
  await page.setInputFiles("#file", {
    name: "other.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"foo": 1}'),
  });
  await expect(page.locator("#status")).toContainText("No vehicle records");
});
