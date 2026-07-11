const { test, expect } = require("@playwright/test");

// One large-export stress run is enough; viewport size doesn't change the work.
test("large export (190k records, one 130k-record signal) renders and charts", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "scale check runs once, on desktop");
  test.setTimeout(120000);

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto("/");

  const t0 = Date.parse("2030-01-01T00:00:00Z");
  const rows = [];
  // a single very long time series — this is what used to overflow the stack
  for (let i = 0; i < 130000; i++) {
    rows.push({
      dataFieldName: "hvBatteryVoltage",
      value: (350 + 40 * Math.sin(i / 500)).toFixed(1),
      timestampUtc: new Date(t0 + i * 60e3).toISOString(),
    });
  }
  // plus a wide spread of ordinary signals
  for (let s = 0; s < 200; s++) {
    for (let i = 0; i < 300; i++) {
      rows.push({
        dataFieldName: `signal_${s}`,
        value: (50 + 50 * Math.sin(s + i / 10)).toFixed(1),
        timestampUtc: new Date(t0 + i * 3600e3).toISOString(),
      });
    }
  }
  const buffer = Buffer.from(JSON.stringify({ vin: "WVWZZZBIGZX000001", Data: rows }));

  const start = Date.now();
  await page.setInputFiles("#file", { name: "big.json", mimeType: "application/json", buffer });
  await expect(page.locator("#report")).toBeVisible({ timeout: 60000 });
  const elapsed = Date.now() - start;
  console.log(`large export rendered in ${elapsed}ms`);
  expect(elapsed).toBeLessThan(30000);

  expect(await page.locator("tr.signal").count()).toBe(201);
  // min/max computed for the long signal without a stack overflow
  const bigRow = page.locator("tr.signal", { hasText: "Hv Battery Voltage" });
  await expect(bigRow.locator("td").nth(1)).toHaveText("130,000");
  await expect(bigRow.locator("td").nth(3)).toContainText("310");
  await expect(bigRow.locator("td").nth(4)).toContainText("390");

  // its 130k-point chart opens and the history table caps politely
  await bigRow.click();
  await expect(page.locator("tr.history canvas")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("tr.history")).toContainText("latest 2,000 of 130,000 records");

  expect(pageErrors).toEqual([]);
});
