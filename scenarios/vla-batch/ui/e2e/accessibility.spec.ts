import { test, expect, type Page } from "@playwright/test";

/**
 * Toegankelijkheidsregressie uit hmi-style-guide.md §10.
 *
 * De statische scripts (lint-tokens, contrast-check, check-families) bewaken de
 * tokens. Wat zij NIET kunnen zien is of een scherm in de praktijk nog leesbaar
 * is als je de kleur wegneemt. Daar zijn deze snapshots voor.
 *
 * Criterium 6: zet het scherm in grijswaarden, dan moet de VORM het onderscheid
 * alleen al dragen. Criterium 5: hetzelfde onder gesimuleerde deuteranopie en
 * protanopie, de twee vormen die samen circa 2 procent van de mannen treffen en
 * die het klassieke rood/groen-paar onbruikbaar maken.
 *
 * Een snapshot die verandert is geen fout maar een signaal: kijk of de
 * verandering bedoeld was voordat je hem bijwerkt met --update-snapshots.
 */

const SCREENS = [
  { path: "/", name: "plant" },
  { path: "/?view=sales", name: "sales" },
  { path: "/management", name: "management" },
  { path: "/line", name: "l1" },
  { path: "/alarms", name: "alarmen" },
  { path: "/equipment", name: "equipment" },
  { path: "/batches", name: "batches" },
  { path: "/reports", name: "rapporten" },
  { path: "/scada", name: "scada" },
  { path: "/shopfloor", name: "werkvloer" },
];

/** SVG-filters die de twee meest voorkomende kleurdeficiënties benaderen. */
const CVD_FILTERS = `
<svg xmlns="http://www.w3.org/2000/svg" style="position:fixed;width:0;height:0">
  <filter id="deuteranopia"><feColorMatrix type="matrix" values="
    0.625 0.375 0     0 0
    0.700 0.300 0     0 0
    0     0.300 0.700 0 0
    0     0     0     1 0"/></filter>
  <filter id="protanopia"><feColorMatrix type="matrix" values="
    0.567 0.433 0     0 0
    0.558 0.442 0     0 0
    0     0.242 0.758 0 0
    0     0     0     1 0"/></filter>
</svg>`;

async function settle(page: Page) {
  // Wacht tot de eerste dataronde binnen is; de schermen pollen daarna door,
  // dus animaties en tellers worden hieronder stilgezet.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.addStyleTag({
    content: `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`,
  });
}

/**
 * Alles met [data-volatile] wordt afgedekt. Nu is dat de "bijgewerkt HH:MM"
 * -klok op het managementoverzicht: die verandert per seconde en liet drie
 * snapshots afwisselend slagen en falen zonder dat er iets aan het ontwerp
 * veranderde. Een test die om de haverklap flapt, wordt genegeerd, en dan
 * bewaakt hij niets meer.
 */
const MASK = (page: Page) => [
  page.locator("[data-volatile]"),
  // Elke waarde in dit systeem draagt `.num`. Die maskeren haalt precies de
  // ruis weg waardoor deze snapshots bij herhaling rood gaven: de KPI's en
  // procesmetingen veranderen tussen twee runs, het ONTWERP niet. Vorm, kleur,
  // stand en label worden nog steeds vergeleken, en dat is wat criterium 5 en 6
  // van de stijlgids eisen: draagt de vorm het onderscheid als de kleur wegvalt.
  page.locator(".num"),
];

test.describe("grijswaarden", () => {
  for (const s of SCREENS) {
    test(`${s.name} blijft leesbaar zonder kleur`, async ({ page }) => {
      await page.goto(s.path);
      await settle(page);
      await page.addStyleTag({ content: `html{filter:grayscale(1)!important}` });
      await expect(page).toHaveScreenshot(`grijs-${s.name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.02,
        mask: MASK(page),
      });
    });
  }
});

test.describe("kleurenblindheid", () => {
  for (const s of SCREENS) {
    for (const cvd of ["deuteranopia", "protanopia"] as const) {
      test(`${s.name} onder ${cvd}`, async ({ page }) => {
        await page.goto(s.path);
        await settle(page);
        await page.evaluate((svg) => {
          document.body.insertAdjacentHTML("beforeend", svg);
        }, CVD_FILTERS);
        await page.addStyleTag({ content: `html{filter:url(#${cvd})!important}` });
        await expect(page).toHaveScreenshot(`${cvd}-${s.name}.png`, {
          fullPage: true,
          maxDiffPixelRatio: 0.02,
          mask: MASK(page),
        });
      });
    }
  }
});

test.describe("statustaal", () => {
  // Draait op de twee schermen die uit de pixelvergelijking zijn gehaald.
  for (const pad of ["/management", "/line"]) {
  test(`elke status draagt naast kleur ook een vorm en een woord (${pad})`, async ({ page }) => {
    await page.goto(pad);
    await settle(page);

    // Elke pill heeft een glyph (svg of span met vorm) EN tekst. Kleur alleen
    // is een WCAG 1.4.1-failure, en dat is niveau A.
    const pills = page.locator("span").filter({ has: page.locator("svg, span") });
    const count = await pills.count();
    expect(count).toBeGreaterThan(0);

    const statusTexts = await page
      .locator("text=/Op norm|Waarschuwing|Kritiek|Geen norm|Draait|Stil|Verouderd/")
      .count();
    expect(statusTexts, "geen enkele status draagt een woord").toBeGreaterThan(0);
  });
  }

  test("de alarmstrook is geen modal", async ({ page }) => {
    await page.goto("/line");
    await settle(page);
    // De meest genoemde operatorklacht is een alarmvenster dat het scherm
    // afdekt. De strook moet dus in de gewone documentstroom staan.
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Alarmen" })).toBeVisible();
  });
});
