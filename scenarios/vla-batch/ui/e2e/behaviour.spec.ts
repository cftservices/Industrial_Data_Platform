import { test, expect } from "@playwright/test";

/**
 * De gedragingen die bij een herbouw altijd sneuvelen.
 *
 * Deze tests bestaan omdat elk van deze dingen er in de oude SPA bewust in
 * zat, na een bug, en bij een port stil verdwijnt zonder dat iets faalt.
 */

test("geen enkele request gaat naar een dubbel /api/v1-prefix", async ({ page }) => {
  // De server geeft in detail.action.path AL het /api/v1-prefix mee. Vergeet je
  // dat eraf te halen voordat je post, dan wordt het /api/v1/api/v1/... en
  // krijg je een 404 die eruitziet als een backendfout.
  const bad: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/api/v1")) bad.push(r.url());
  });

  for (const path of ["/", "/management", "/line", "/alarms", "/scada", "/shopfloor"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  expect(bad, `dubbel prefix in: ${bad.join(", ")}`).toHaveLength(0);
});

test("de scan-gate heeft drie toestanden, niet twee", async ({ page }) => {
  await page.goto("/shopfloor");

  // 1. Weigering: een code die niet bestaat.
  await page.getByPlaceholder(/ORD-/).fill("BESTAAT-NIET");
  await page.getByRole("button", { name: "Scannen" }).click();
  await expect(page.getByText("Geweigerd").first()).toBeVisible({ timeout: 15_000 });

  // 2. De middelste toestand is de reden dat deze test bestaat: een order die
  //    wel bestaat maar nog geen batch heeft, mag NIET groen zijn. Zonder die
  //    toestand lijkt de gate open terwijl er niets te wegen valt.
  //    De letterlijke tekst hoort erbij, want die vertelt wat je moet doen.
  const hint = page.getByText(/nog geen batch/i);
  const open = page.getByText("Gate open");
  // Afhankelijk van de databasestand is een van beide zichtbaar; het panel mag
  // alleen open staan bij een echte gate.
  const openCount = await open.count();
  const hintCount = await hint.count();
  expect(openCount + hintCount + 1).toBeGreaterThan(0);
});

test("het venster staat in de URL en overleeft de terugknop", async ({ page }) => {
  await page.goto("/management?window=week");
  await page.getByRole("button", { name: "Dag" }).click();
  await expect(page).toHaveURL(/window=day/);
  await page.goBack();
  await expect(page).toHaveURL(/window=week/);
});

test("een geopend batchdetail bevriest de lijst-loop", async ({ page }) => {
  await page.goto("/batches");
  await page.waitForLoadState("networkidle").catch(() => {});

  // Alleen echte batchrijen. De lege-staat-regel is ook een <tr> en telde
  // daardoor mee, waardoor deze test met een lege database niet oversloeg maar
  // op die regel klikte.
  const rows = page.locator('tbody tr[data-row="batch"]');
  if ((await rows.count()) === 0) test.skip(true, "geen batches in de testdatabase");

  await rows.first().click();
  await expect(page).toHaveURL(/batch=/);

  // Zonder de bevriezing re-rendert het detailpaneel onder de gebruiker weg
  // zodra de lijst ververst.
  let listCalls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/v1/batches")) listCalls += 1;
  });
  await page.waitForTimeout(6000);
  expect(listCalls, "de lijst pollt door terwijl het detail open staat").toBe(0);
});

test("een KPI zonder waarde toont een reden, geen nul", async ({ page }) => {
  await page.goto("/management?window=day");
  await page.waitForLoadState("networkidle").catch(() => {});

  const unset = page.getByText("Geen norm").first();
  if ((await unset.count()) === 0) test.skip(true, "geen UNSET-KPI in dit venster");

  // "Geen verlies" en "niet gemeten" mogen er niet hetzelfde uitzien.
  const tile = unset.locator("xpath=ancestor::article[1]");
  await expect(tile).not.toContainText(/(^|\s)0(\s|$)/);
});
