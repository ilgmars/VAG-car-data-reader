const { test, expect } = require("@playwright/test");

// Real exports contain many rows whose `value` field is missing entirely
// (the portal records an event but reports no measurement). The reader must
// treat those rows as absent data, not as the literal string "undefined".

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function doc(rows) {
  return {
    vin: "WVWZZZTEST000999",
    Data: rows.map((r) => ({
      key: "a7d18333-30ca-38e3-bf45-74d63352ceb3",
      dataFieldName: r.name,
      timestampUtc: r.t,
      ...(Object.prototype.hasOwnProperty.call(r, "value") ? { value: r.value } : {}),
    })),
  };
}

async function load(page, rows) {
  const buf = Buffer.from(JSON.stringify(doc(rows)));
  await page.setInputFiles("#file", { name: "test.json", mimeType: "application/json", buffer: buf });
  await expect(page.locator("#report")).toBeVisible({ timeout: 10000 });
}

test("rows missing the value field are dropped, not rendered as 'undefined'", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z" },
    { name: "speed", t: "2026-01-02T10:00:00Z" },
    { name: "speed", t: "2026-01-03T10:00:00Z", value: "42" },
  ]);
  const row = page.locator("tr.signal", { hasText: /Speed/ });
  await expect(row).toHaveCount(1);
  await expect(row.locator("td").nth(1)).toHaveText("1");
  await expect(row.locator("td").nth(2)).toHaveText("42");
  await expect(row.locator("td").nth(3)).toHaveText("42");
  await expect(row.locator("td").nth(4)).toHaveText("42");
  await expect(row.locator("td").nth(2)).not.toContainText("undefined");
});

test("rows with null or empty-string values are also dropped", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z", value: null },
    { name: "speed", t: "2026-01-02T10:00:00Z", value: "" },
    { name: "speed", t: "2026-01-03T10:00:00Z", value: "10" },
  ]);
  const row = page.locator("tr.signal", { hasText: /Speed/ });
  await expect(row).toHaveCount(1);
  await expect(row.locator("td").nth(1)).toHaveText("1");
  await expect(row.locator("td").nth(2)).toHaveText("10");
});

test("a signal with no values at all is omitted from the report", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z" },
    { name: "speed", t: "2026-01-02T10:00:00Z" },
    { name: "boardnetBatteryVoltageIndication", t: "2026-01-01T10:00:00Z", value: "14.4" },
  ]);
  const signals = await page.locator("tr.signal .name").allTextContents();
  expect(signals.join(" ")).not.toMatch(/Speed\b/);
  expect(signals.join(" ")).toMatch(/Battery/);
});

test("mixed present and absent values render only the present ones, sorted newest-first", async ({ page }) => {
  await load(page, [
    { name: "boardnetBatteryVoltageIndication", t: "2026-01-01T10:00:00Z" },
    { name: "boardnetBatteryVoltageIndication", t: "2026-01-02T10:00:00Z", value: "14.5" },
    { name: "boardnetBatteryVoltageIndication", t: "2026-01-03T10:00:00Z" },
    { name: "boardnetBatteryVoltageIndication", t: "2026-01-04T10:00:00Z", value: "14.6" },
  ]);
  const row = page.locator("tr.signal", { hasText: /Battery/ });
  await expect(row.locator("td").nth(1)).toHaveText("2");
  await expect(row.locator("td").nth(2)).toHaveText("14.6");
  await row.click();
  const tableRows = page.locator("tr.history .table-pane tbody tr");
  await expect(tableRows).toHaveCount(2);
  // newest first; dates render in the browser locale, so just compare the day
  await expect(tableRows.nth(0).locator("td").nth(0)).toContainText("1/4/2026");
  await expect(tableRows.nth(1).locator("td").nth(0)).toContainText("1/2/2026");
});

test("CSV export contains only rows with values; no literal 'undefined' cells", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z" },
    { name: "speed", t: "2026-01-02T10:00:00Z", value: "30" },
    { name: "speed", t: "2026-01-03T10:00:00Z" },
  ]);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#export-btn"),
  ]);
  const fs = require("fs");
  const csv = fs.readFileSync(await download.path(), "utf-8");
  // strip BOM
  const text = csv.replace(/^\uFEFF/, "");
  expect(text).not.toMatch(/undefined/);
  const lines = text.split("\r\n").filter(Boolean);
  // header + exactly one data row (only the row that had a value)
  expect(lines.length).toBe(2);
  expect(lines[1]).toContain(",30,");
});