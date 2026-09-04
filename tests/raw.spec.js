const { test, expect } = require("@playwright/test");

// The "Raw" view shows every original row (including those whose `value` field
// is missing) for a single signal. Each signal row has its own Raw button so
// the user doesn't have to open the history panel first.

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

test("each signal row has a Raw button", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z", value: "30" },
    { name: "brakePressureIndication", t: "2026-01-01T10:00:00Z", value: "5" },
  ]);
  const buttons = page.locator("tr.signal button.raw-btn");
  await expect(buttons).toHaveCount(2);
});

test("clicking the signal's Raw button shows the raw rows for that signal only", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z", value: "30" },
    { name: "speed", t: "2026-01-02T10:00:00Z" },
    { name: "brakePressureIndication", t: "2026-01-01T10:00:00Z", value: "5" },
  ]);
  const speedRow = page.locator("tr.signal", { hasText: /Speed/ });
  await speedRow.locator("button.raw-btn").click();
  // raw rows are inserted as a sibling of the signal row, scoped to speed only
  const rawRows = speedRow.locator("~ tr.signal-raw-pane tbody tr");
  await expect(rawRows).toHaveCount(2);
  const fields = await rawRows.locator("td:first-child").allTextContents();
  expect(fields).toEqual(["speed", "speed"]);
});

test("signal Raw rows: never render the literal 'undefined' for missing values", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z" },
    { name: "speed", t: "2026-01-02T10:00:00Z", value: "40" },
  ]);
  const speedRow = page.locator("tr.signal", { hasText: /Speed/ });
  await speedRow.locator("button.raw-btn").click();
  const text = await speedRow.locator("~ tr.signal-raw-pane").innerText();
  expect(text).not.toMatch(/undefined/);
});

test("signal Raw rows: newest first, missing values blank", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z", value: "30" },
    { name: "speed", t: "2026-01-02T10:00:00Z" },
    { name: "speed", t: "2026-01-03T10:00:00Z", value: "50" },
  ]);
  const speedRow = page.locator("tr.signal", { hasText: /Speed/ });
  await speedRow.locator("button.raw-btn").click();
  const rows = speedRow.locator("~ tr.signal-raw-pane tbody tr");
  // columns: Field, Value, Timestamp
  await expect(rows.nth(0).locator("td").nth(0)).toHaveText("speed");
  await expect(rows.nth(0).locator("td").nth(1)).toHaveText("50");
  await expect(rows.nth(0).locator("td").nth(2)).toContainText("1/3/2026");
  await expect(rows.nth(1).locator("td").nth(0)).toHaveText("speed");
  await expect(rows.nth(1).locator("td").nth(1)).toHaveText("");
  await expect(rows.nth(1).locator("td").nth(2)).toContainText("1/2/2026");
  await expect(rows.nth(2).locator("td").nth(0)).toHaveText("speed");
  await expect(rows.nth(2).locator("td").nth(1)).toHaveText("30");
  await expect(rows.nth(2).locator("td").nth(2)).toContainText("1/1/2026");
});

test("signal Raw button toggles: clicking again hides the raw pane", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z", value: "30" },
  ]);
  const speedRow = page.locator("tr.signal", { hasText: /Speed/ });
  const btn = speedRow.locator("button.raw-btn");
  await btn.click();
  await expect(speedRow.locator("~ tr.signal-raw-pane")).toHaveCount(1);
  await btn.click();
  await expect(speedRow.locator("~ tr.signal-raw-pane")).toHaveCount(0);
});

test("clicking one signal's Raw button does not affect another signal's row", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z", value: "30" },
    { name: "brakePressureIndication", t: "2026-01-01T10:00:00Z", value: "5" },
  ]);
  await page.locator("tr.signal", { hasText: /Speed/ }).locator("button.raw-btn").click();
  // brake row should not have a raw pane
  const brakeRow = page.locator("tr.signal", { hasText: /Brake/ });
  await expect(brakeRow.locator("~ tr.signal-raw-pane")).toHaveCount(0);
});

test("the Raw button on a signal row does not also open the history panel", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z", value: "30" },
  ]);
  await page.locator("tr.signal", { hasText: /Speed/ }).locator("button.raw-btn").click();
  // the history row (Chart/Table tabs) should not be inserted
  await expect(page.locator("tr.history")).toHaveCount(0);
});
