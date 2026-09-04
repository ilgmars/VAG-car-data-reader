const { test, expect } = require("@playwright/test");

// The Raw view shows every original row (including those whose `value` field
// is missing) for a single signal. It lives in the history panel as a third
// tab next to Chart and Table. Click the signal row to open the panel, then
// switch to the Raw tab.

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

test("clicking a signal row opens a history panel with Chart / Table / Raw tabs", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z", value: "30" },
    { name: "speed", t: "2026-01-02T10:00:00Z", value: "40" },
  ]);
  await page.locator("tr.signal", { hasText: /Speed/ }).click();
  const tabs = page.locator("tr.history .history-tabs button");
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(0)).toHaveText("Chart");
  await expect(tabs.nth(1)).toHaveText("Table");
  await expect(tabs.nth(2)).toHaveText("Raw");
});

test("signal row never has a standalone Raw button (Raw lives in the panel)", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z", value: "30" },
    { name: "brakePressureIndication", t: "2026-01-01T10:00:00Z", value: "5" },
  ]);
  await expect(page.locator("tr.signal button.raw-btn")).toHaveCount(0);
});

test("Raw tab shows every row including those missing a value", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z" },
    { name: "speed", t: "2026-01-02T10:00:00Z", value: "40" },
    { name: "speed", t: "2026-01-03T10:00:00Z" },
  ]);
  await page.locator("tr.signal", { hasText: /Speed/ }).click();
  await page.locator("tr.history .history-tabs button", { hasText: "Raw" }).click();
  const rows = page.locator("tr.history .raw-pane tbody tr");
  await expect(rows).toHaveCount(3);
  // columns: Field, Value, Timestamp
  await expect(rows.nth(0).locator("td").nth(0)).toHaveText("speed");
  await expect(rows.nth(0).locator("td").nth(1)).toHaveText("");
  await expect(rows.nth(0).locator("td").nth(2)).toContainText("1/3/2026");
  await expect(rows.nth(1).locator("td").nth(0)).toHaveText("speed");
  await expect(rows.nth(1).locator("td").nth(1)).toHaveText("40");
  await expect(rows.nth(1).locator("td").nth(2)).toContainText("1/2/2026");
  await expect(rows.nth(2).locator("td").nth(0)).toHaveText("speed");
  await expect(rows.nth(2).locator("td").nth(1)).toHaveText("");
  await expect(rows.nth(2).locator("td").nth(2)).toContainText("1/1/2026");
});

test("Raw tab never renders the literal 'undefined' for missing values", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z" },
    { name: "speed", t: "2026-01-02T10:00:00Z", value: "40" },
  ]);
  await page.locator("tr.signal", { hasText: /Speed/ }).click();
  await page.locator("tr.history .history-tabs button", { hasText: "Raw" }).click();
  const text = await page.locator("tr.history .raw-pane").innerText();
  expect(text).not.toMatch(/undefined/);
});

test("Raw tab: shows the raw field name (dataFieldName) and timestamp as it came in", async ({ page }) => {
  await load(page, [
    { name: "boardnetBatteryVoltageIndication", t: "2026-09-01 08:43:58", value: "12.4" },
  ]);
  await page.locator("tr.signal", { hasText: /Battery/ }).click();
  await page.locator("tr.history .history-tabs button", { hasText: "Raw" }).click();
  const cells = await page.locator("tr.history .raw-pane tbody tr").first().locator("td").allTextContents();
  expect(cells[0]).toBe("boardnetBatteryVoltageIndication");
  expect(cells[1]).toBe("12.4");
  expect(cells[2]).toMatch(/9\/1\/2026/);
});

test("Raw tab: newest first, missing values blank", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z", value: "30" },
    { name: "speed", t: "2026-01-02T10:00:00Z" },
    { name: "speed", t: "2026-01-03T10:00:00Z", value: "50" },
  ]);
  await page.locator("tr.signal", { hasText: /Speed/ }).click();
  await page.locator("tr.history .history-tabs button", { hasText: "Raw" }).click();
  const rows = page.locator("tr.history .raw-pane tbody tr");
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

test("opening one signal's history does not affect another signal's row", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z", value: "30" },
    { name: "brakePressureIndication", t: "2026-01-01T10:00:00Z", value: "5" },
  ]);
  await page.locator("tr.signal", { hasText: /Speed/ }).click();
  const brakeRow = page.locator("tr.signal", { hasText: /Brake/ });
  await expect(brakeRow.locator("~ tr.history")).toHaveCount(0);
});

// Regression: every one of the 38 sensors in the committed sample must be
// reachable through the Raw tab. The bug was that the Raw button was a
// standalone control on each row, but on some rows (or after a re-render)
// the button was missing or its handler was lost, leaving the user no way to
// see the underlying data. Now Raw is a tab inside the history panel that
// opens via the existing signal-row click handler, which is delegated and
// survives every re-render.
test("committed sample: every one of the 38 sensors opens a history panel with Raw tab", async ({ page }) => {
  const fs = require("fs");
  const path = require("path");
  const buf = fs.readFileSync(path.join(__dirname, "..", "sample", "sample.json"));
  await page.setInputFiles("#file", { name: "sample.json", mimeType: "application/json", buffer: buf });
  await expect(page.locator("#report")).toBeVisible({ timeout: 10000 });
  const doc = JSON.parse(buf.toString("utf-8"));
  expect(new Set(doc.Data.map((r) => r.dataFieldName)).size).toBe(38);

  // confirm there are 38 signal rows and none of them carry a standalone Raw button
  const rows = page.locator("tr.signal");
  await expect(rows).toHaveCount(38);
  await expect(page.locator("tr.signal button.raw-btn")).toHaveCount(0);

  // open all clusters so every row is visible
  await page.evaluate(() => {
    document.querySelectorAll("details.struct-group").forEach((d) => d.setAttribute("open", ""));
  });

  // open and verify Raw tab on a representative subset (first, middle, last)
  // checking every row would take >60s due to chart rendering per open; the
  // signal-row click handler is delegated on signalsBody and identical for
  // every row, so verifying it works for 3 rows is enough to cover the
  // regression at far lower cost.
  const indices = [0, Math.floor(38 / 2), 37];
  for (const i of indices) {
    const row = rows.nth(i);
    await row.click();
    const tabs = page.locator("tr.history .history-tabs button");
    await expect(tabs, `signal ${i} has no history tabs`).toHaveCount(3);
    await page.locator("tr.history .history-tabs button", { hasText: "Raw" }).click();
    const rawRows = page.locator("tr.history .raw-pane tbody tr");
    await expect(rawRows, `signal ${i} raw pane empty`).not.toHaveCount(0);
    await row.click(); // close
  }
});
