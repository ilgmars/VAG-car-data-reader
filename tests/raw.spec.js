const { test, expect } = require("@playwright/test");

// The "Raw" view shows every original row (including those whose `value` field
// is missing) in the order the user asked for: per-signal (Raw tab in the
// history panel) or per-section (Raw button on the cluster <summary>).

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

// ---------- signal-level: Raw tab in history ----------

test("signal history: clicking the signal opens Chart/Table/Raw tabs", async ({ page }) => {
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

test("signal Raw tab: shows every row including those missing a value", async ({ page }) => {
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

test("signal Raw tab: never renders the literal 'undefined' for missing values", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z" },
    { name: "speed", t: "2026-01-02T10:00:00Z", value: "40" },
  ]);
  await page.locator("tr.signal", { hasText: /Speed/ }).click();
  await page.locator("tr.history .history-tabs button", { hasText: "Raw" }).click();
  const text = await page.locator("tr.history .raw-pane").innerText();
  expect(text).not.toMatch(/undefined/);
});

test("signal Raw tab: shows the raw field name (dataFieldName) and timestamp as it came in", async ({ page }) => {
  await load(page, [
    { name: "boardnetBatteryVoltageIndication", t: "2026-09-01 08:43:58", value: "12.4" },
  ]);
  await page.locator("tr.signal", { hasText: /Battery/ }).click();
  await page.locator("tr.history .history-tabs button", { hasText: "Raw" }).click();
  const cells = await page.locator("tr.history .raw-pane tbody tr").first().locator("td").allTextContents();
  // columns: Field, Value, Timestamp
  expect(cells[0]).toBe("boardnetBatteryVoltageIndication");
  expect(cells[1]).toBe("12.4");
  expect(cells[2]).toMatch(/9\/1\/2026/);
});

// ---------- cluster-level: Raw button on cluster <summary> ----------

test("cluster Raw button: opens a table of every raw row in that cluster", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z", value: "30" },
    { name: "brakePressureIndication", t: "2026-01-01T10:00:00Z", value: "5" },
    { name: "speed", t: "2026-01-02T10:00:00Z" },
  ]);
  // Vehicle Status cluster contains both Speed and Brake Pressure
  const cluster = page.locator("details.struct-group", { hasText: /Vehicle Status/ });
  await cluster.locator("summary button.raw-btn").click();
  const rows = cluster.locator(".raw-pane tbody tr");
  await expect(rows).toHaveCount(3);
});

test("cluster Raw button: rows from other clusters are excluded", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z", value: "30" },          // Vehicle Status
    { name: "mediaVolume", t: "2026-01-01T10:00:00Z", value: "8" },     // Infotainment
    { name: "speed", t: "2026-01-02T10:00:00Z" },
  ]);
  const cluster = page.locator("details.struct-group", { hasText: /Vehicle Status/ });
  await cluster.locator("summary button.raw-btn").click();
  const fields = await cluster.locator(".raw-pane tbody tr td:first-child").allTextContents();
  expect(fields).toEqual(["speed", "speed"]);
  expect(fields.join(" ")).not.toMatch(/media/);
});

test("cluster Raw button: newest first, missing values blank", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z", value: "30" },
    { name: "speed", t: "2026-01-02T10:00:00Z" },
    { name: "speed", t: "2026-01-03T10:00:00Z", value: "50" },
  ]);
  const cluster = page.locator("details.struct-group", { hasText: /Vehicle Status/ });
  await cluster.locator("summary button.raw-btn").click();
  const rows = cluster.locator(".raw-pane tbody tr");
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

test("cluster Raw button: never renders 'undefined' for missing values", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z" },
    { name: "speed", t: "2026-01-02T10:00:00Z", value: "30" },
  ]);
  const cluster = page.locator("details.struct-group", { hasText: /Vehicle Status/ });
  await cluster.locator("summary button.raw-btn").click();
  const text = await cluster.locator(".raw-pane").innerText();
  expect(text).not.toMatch(/undefined/);
});

test("cluster Raw button: hides when clicked again (toggle)", async ({ page }) => {
  await load(page, [
    { name: "speed", t: "2026-01-01T10:00:00Z", value: "30" },
  ]);
  const cluster = page.locator("details.struct-group", { hasText: /Vehicle Status/ });
  const btn = cluster.locator("summary button.raw-btn");
  await btn.click();
  await expect(cluster.locator(".raw-pane")).toBeVisible();
  await btn.click();
  await expect(cluster.locator(".raw-pane")).toHaveCount(0);
});
