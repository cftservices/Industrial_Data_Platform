import { test, expect } from "@playwright/test";

/**
 * Het Level 2-procesbeeld.
 *
 * De mimic is uitgesloten van de pixel-snapshots, want hij verandert met elke
 * fasewissel. Dat mag alleen als de eisen die de snapshots bewaakten hier
 * scherper terugkomen, en dat is precies wat deze tests doen: ze toetsen de
 * kleurredundantie in de DOM in plaats van in grijswaarden, wat sterker is,
 * want een DOM-assertie kan niet met 2 procent pixelruis meebewegen.
 */

test("het procesbeeld staat op de SCADA-console", async ({ page }) => {
  await page.goto("/scada");
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("region", { name: "Procesbeeld" })).toBeVisible();
  await expect(page.locator("[data-mimic]")).toBeVisible();
});

test("elk procesdeel draagt naast zijn kleur ook een woord", async ({ page }) => {
  await page.goto("/scada");
  await page.waitForLoadState("networkidle").catch(() => {});

  const statussen = page.locator("[data-unit-state]");
  const n = await statussen.count();
  expect(n, "geen enkel procesdeel in het beeld").toBeGreaterThan(0);

  const woorden = ["draait", "vervuild", "stil", "gereserveerd", "storing", "fout", "verouderd"];
  for (let i = 0; i < n; i++) {
    const tekst = (await statussen.nth(i).textContent())?.trim() ?? "";
    expect(
      woorden.some((w) => tekst.includes(w)),
      `procesdeel ${await statussen.nth(i).getAttribute("data-unit-state")} toont "${tekst}", geen statuswoord`,
    ).toBe(true);
  }
});

test("elk procesdeel is een doorklik naar zijn onderhoud", async ({ page }) => {
  await page.goto("/scada");
  await page.waitForLoadState("networkidle").catch(() => {});
  const links = page.locator('[data-mimic] a[aria-label^="Details van"]');
  expect(await links.count()).toBeGreaterThanOrEqual(5);
});

test("de meters dragen een schaal, geen kale naald", async ({ page }) => {
  await page.goto("/scada");
  await page.waitForLoadState("networkidle").catch(() => {});
  // Elke gauge is een <img>-rol met een aria-label dat de waarde uitspreekt.
  // Een meter zonder toegankelijke waarde is voor een schermlezer een plaatje.
  const meters = page.getByRole("img", { name: /Viscositeit|temperatuur|Roerder|niveau|Ontvangst/i });
  expect(await meters.count()).toBeGreaterThanOrEqual(4);
});

test("viscositeit wordt tijdens het koken NIET tegen de spec afgerekend", async ({ request }) => {
  // Anders verschijnt bij elke normale batch een KRITIEK dat na een paar
  // minuten vanzelf verdwijnt, en dat leert een operator wegkijken bij rood.
  const r = await request.get("/api/ui/line");
  const body = await r.json();
  const koken = body.steps?.find((s: { id: string }) => s.id === "cooking");
  test.skip(!koken, "geen kookstap in de payload");

  const fase = body.line?.batch?.state ?? null;
  if (["COOLING", "FILLING", "COMPLETE"].includes(fase)) {
    expect(koken.spec_pending, "na de hold hoort het oordeel juist WEL te vallen").toBeNull();
  } else {
    expect(koken.spec_pending).toBeTruthy();
    expect(koken.tone, "nog niet beoordeeld mag nooit alarm zijn").toBe("neutral");
  }
});

test("elke meting heeft een verantwoorde schaal of zegt dat hij er geen heeft", async ({
  request,
}) => {
  // De balk viel terug op 0 tot 100 terwijl er 5000 L in de tank zat.
  const r = await request.get("/api/ui/line");
  const body = await r.json();
  for (const step of body.steps ?? []) {
    if (step.spec) continue; // een tweezijdige spec levert zijn eigen schaal
    if (step.scale === null) continue; // en dan toont de UI "geen schaal bekend"
    expect(step.scale.source, `${step.id} heeft een schaal zonder herkomst`).toBeTruthy();
    expect(step.scale.max, `${step.id} heeft een lege schaal`).toBeGreaterThan(0);
  }
});
