const { test, expect } = require("@playwright/test");

// Real exports contain many rows whose `value` field is missing entirely
// (the portal records an event but reports no measurement). The reader must
// keep those rows in the row count (so the section isn't empty) and render
// their value cells as "—", never the literal string "undefined".

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

test("signal stays visible even when most rows have no value", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z" },
    { name: "speed", t: "2026-01-02T10:00:00Z" },
    { name: "speed", t: "2026-01-03T10:00:00Z", value: "42" },
  ]);
  const row = page.locator("tr.signal", { hasText: /Speed/ });
  await expect(row).toHaveCount(1);
  // Count is the total row count, not just rows with values
  await expect(row.locator("td").nth(1)).toHaveText("3");
  // Latest is the value of the newest row that has one
  await expect(row.locator("td").nth(2)).toHaveText("42");
  // Min/Max are computed from the rows that have numeric values
  await expect(row.locator("td").nth(3)).toHaveText("42");
  await expect(row.locator("td").nth(4)).toHaveText("42");
  // No literal "undefined" anywhere
  const cells = await row.locator("td").allTextContents();
  for (const c of cells) expect(c).not.toMatch(/undefined/);
});

test("rows with null or empty-string values: signal stays, value rendered as —", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z", value: null },
    { name: "speed", t: "2026-01-02T10:00:00Z", value: "" },
    { name: "speed", t: "2026-01-03T10:00:00Z", value: "10" },
  ]);
  const row = page.locator("tr.signal", { hasText: /Speed/ });
  await expect(row).toHaveCount(1);
  await expect(row.locator("td").nth(1)).toHaveText("3");
  // Latest is the value of the newest row (which has value "10")
  await expect(row.locator("td").nth(2)).toHaveText("10");
  const cells = await row.locator("td").allTextContents();
  for (const c of cells) expect(c).not.toMatch(/undefined/);
});

test("a signal with no values at all is still shown with — for Latest/Min/Max", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z" },
    { name: "speed", t: "2026-01-02T10:00:00Z" },
    { name: "boardnetBatteryVoltageIndication", t: "2026-01-01T10:00:00Z", value: "14.4" },
  ]);
  const speed = page.locator("tr.signal", { hasText: /Speed/ });
  await expect(speed).toHaveCount(1);
  await expect(speed.locator("td").nth(1)).toHaveText("2");
  // No value rows → Latest/Min/Max all "—"
  await expect(speed.locator("td").nth(2)).toHaveText("—");
  await expect(speed.locator("td").nth(3)).toHaveText("—");
  await expect(speed.locator("td").nth(4)).toHaveText("—");
});

test("Latest column shows the newest row's value, not the absolute newest row when it has no value", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z", value: "10" },
    { name: "speed", t: "2026-01-02T10:00:00Z", value: "20" },
    { name: "speed", t: "2026-01-03T10:00:00Z" }, // newest row, no value
  ]);
  const row = page.locator("tr.signal", { hasText: /Speed/ });
  // Last seen is the absolute newest row (1/3)
  await expect(row.locator("td").nth(5)).toContainText("1/3/2026");
  // Latest value is from the newest row that HAS a value (1/2 -> "20")
  await expect(row.locator("td").nth(2)).toHaveText("20");
  // Min/Max are over the rows that have values: 10, 20
  await expect(row.locator("td").nth(3)).toHaveText("10");
  await expect(row.locator("td").nth(4)).toHaveText("20");
});

test("mixed present and absent values: count = total, Latest = newest present, table shows all", async ({ page }) => {
  await load(page, [
    { name: "boardnetBatteryVoltageIndication", t: "2026-01-01T10:00:00Z" },
    { name: "boardnetBatteryVoltageIndication", t: "2026-01-02T10:00:00Z", value: "14.5" },
    { name: "boardnetBatteryVoltageIndication", t: "2026-01-03T10:00:00Z" },
    { name: "boardnetBatteryVoltageIndication", t: "2026-01-04T10:00:00Z", value: "14.6" },
  ]);
  const row = page.locator("tr.signal", { hasText: /Battery/ });
  await expect(row.locator("td").nth(1)).toHaveText("4");
  await expect(row.locator("td").nth(2)).toHaveText("14.6");
  await row.click();
  const tableRows = page.locator("tr.history .table-pane tbody tr");
  await expect(tableRows).toHaveCount(4);
  // newest first; dates render in the browser locale
  await expect(tableRows.nth(0).locator("td").nth(0)).toContainText("1/4/2026");
  // missing-value rows show "—", not "undefined"
  await expect(tableRows.nth(1).locator("td").nth(1)).toHaveText("—");
  await expect(tableRows.nth(2).locator("td").nth(0)).toContainText("1/2/2026");
  await expect(tableRows.nth(2).locator("td").nth(1)).toHaveText("14.5");
});

test("CSV export contains every row; missing values render empty, not 'undefined'", async ({ page }) => {
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
  const text = csv.replace(/^\uFEFF/, "");
  expect(text).not.toMatch(/undefined/);
  const lines = text.split("\r\n").filter(Boolean);
  // header + 3 data rows (every row, missing value = empty cell)
  expect(lines.length).toBe(4);
  // exactly one row has "30"
  expect(lines.filter((l) => l.includes(",30,")).length).toBe(1);
  // the other two rows have an empty value cell
  // (the value column is the 5th; a row with no value has ",,2026-")
  const dataLines = lines.slice(1);
  expect(dataLines.length).toBe(3);
  expect(text).not.toMatch(/undefined/);
  expect(dataLines.filter((l) => l.includes(",30,")).length).toBe(1);
  expect(dataLines.filter((l) => l.match(/,,2026-/)).length).toBe(2);
});

test("real export shape: rows with no value key and space-separated timestamps render as —", async ({ page }) => {
  await load(page, [
    { name: "recommendedGearIndication", t: "2026-08-12 05:04:10" },
    { name: "recommendedGearIndication", t: "2026-08-12 05:04:15" },
    { name: "recommendedGearIndication", t: "2026-08-12 05:04:20", value: "3" },
    { name: "recommendedGearIndication", t: "2026-08-12 05:04:25" },
  ]);
  const row = page.locator("tr.signal", { hasText: /Recommended Gear/ });
  await expect(row).toHaveCount(1);
  await expect(row.locator("td").nth(1)).toHaveText("4");
  await expect(row.locator("td").nth(2)).toHaveText("3");
  const cells = await row.locator("td").allTextContents();
  for (const c of cells) expect(c).not.toMatch(/undefined/);
});
