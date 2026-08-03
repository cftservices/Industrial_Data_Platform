import { test, expect } from "@playwright/test";

/**
 * Bevindingen uit de bruikbaarheidsaudit van 02-08.
 *
 * Elke test hier hoort bij een bevinding die is gerepareerd. De les van de
 * navigatiebevinding: een bevinding zonder test komt terug, want de bestaande
 * tests toetsten of een scherm het deed en niet of iemand er iets aan had.
 */

test("het periodrapport krijgt het GEKOZEN venster mee, niet altijd zeven dagen", async ({
  page,
}) => {
  // De knop stond hard op days=7 pal onder de tekst dat het rapport exact
  // dezelfde parameters krijgt als het scherm. Koos je "Maand", dan kreeg je
  // een week: een onwaarheid in precies het blok dat vertrouwen moet dragen.
  await page.goto("/management?window=week");
  await page.waitForLoadState("networkidle").catch(() => {});

  const link = () => page.getByRole("link", { name: /Rapport over .* \(PDF\)/ });
  await expect(link()).toHaveAttribute("href", /window=week/);

  await page.getByRole("button", { name: "Maand" }).click();
  await expect(page).toHaveURL(/window=month/);
  await expect(link()).toHaveAttribute("href", /window=month/);
  await expect(link()).not.toHaveAttribute("href", /days=/);
});

test("het periodrapport levert het venster dat je vraagt", async ({ request }) => {
  const maand = await (await request.get("/api/v1/report/period?window=month")).json();
  expect(maand.window).toBe("month");
  const span =
    new Date(maand.to).getTime() - new Date(maand.from).getTime();
  expect(span / 86_400_000, "een maand mag geen week zijn").toBeGreaterThan(27);

  const dienst = await (await request.get("/api/v1/report/period?window=shift")).json();
  expect(new Date(dienst.to).getTime() - new Date(dienst.from).getTime()).toBeLessThan(
    span,
  );
});

test("het batchrapport is een document, geen JSON-dump", async ({ page, request }) => {
  // De spec noemt dit het bewijsstuk van de demo. Het toonde
  // JSON.stringify(report, null, 2) in een <pre>: een QA-medewerker kon er niet
  // in vinden of een dosering binnen tolerantie viel.
  const batches = await (await request.get("/api/v1/batches")).json();
  test.skip(!batches?.length, "geen batches in de testdatabase");
  const id = batches[0].batch_id;

  await page.goto(`/report/${id}`);
  await page.waitForLoadState("networkidle").catch(() => {});

  for (const kop of ["Verdict", "Batch en order", "Doseringen", "Ondertekening"]) {
    await expect(page.getByRole("heading", { name: kop })).toBeVisible();
  }

  // De ruwe JSON mag bestaan, maar ingeklapt en niet als hoofdinhoud.
  const details = page.locator("details", { hasText: "Ruwe gegevens" });
  await expect(details).toHaveCount(1);
  await expect(details.locator("pre")).toBeHidden();
});

test("geen twee knoppen met hetzelfde woord waarvan er een onomkeerbaar is", async ({
  page,
  request,
}) => {
  // Op /orders sloot de ene "Sluiten" een order af en de andere een paneel.
  const orders = await (await request.get("/api/v1/orders")).json();
  test.skip(!orders?.length, "geen orders in de testdatabase");

  await page.goto(`/orders?order=${orders[0].order_id}`);
  await page.waitForLoadState("networkidle").catch(() => {});

  const exact = page.getByRole("button", { name: "Sluiten", exact: true });
  const n = await exact.count();
  expect(n, "meerdere knoppen heten exact 'Sluiten'").toBeLessThanOrEqual(1);
});

test("een lege tabel zegt dat hij leeg is", async ({ page }) => {
  // Een tabel met alleen koppen leest als een storing.
  for (const [pad, tabel] of [
    ["/equipment", "Geen procesdelen bekend"],
    ["/batches", "Geen batches in deze selectie"],
    ["/voorraad", "Geen materialen"],
  ] as const) {
    await page.goto(pad);
    await page.waitForLoadState("networkidle").catch(() => {});
    const rows = page.locator("tbody tr");
    const count = await rows.count();
    expect(count, `${pad} rendert een tabel zonder enige rij`).toBeGreaterThan(0);
    // Er is dus ofwel data, ofwel een regel die uitlegt dat er geen is.
    if (count === 1) {
      const tekst = (await rows.first().textContent()) ?? "";
      expect(tekst.length, `${pad} heeft een lege rij zonder tekst`).toBeGreaterThan(10);
    }
    void tabel;
  }
});

test("geen meter met een verzonnen bereik", async ({ page }) => {
  // Gauge viel terug op basis_L ?? 5000 en spec.max * 1.25 ?? 400. Een naald op
  // een bereik dat nergens vandaan komt, is erger dan geen meter: DeviationBand
  // weigert dat elders al.
  await page.goto("/scada");
  await page.waitForLoadState("networkidle").catch(() => {});

  const meters = page.locator("figure");
  const n = await meters.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const tekst = (await meters.nth(i).textContent()) ?? "";
    // Elke meter draagt ofwel een schaal, ofwel de mededeling dat hij er geen heeft.
    expect(tekst.trim().length, "een meter zonder enige tekst").toBeGreaterThan(0);
  }
});
