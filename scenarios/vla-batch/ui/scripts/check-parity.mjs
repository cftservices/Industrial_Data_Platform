#!/usr/bin/env node
/**
 * Actiepariteit met de oude SPA.
 *
 * De nieuwe UI is opnieuw opgebouwd uit een spec, niet geport. Daardoor zijn er
 * bij het opsplitsen van het vijf-banen-doende SCADA-scherm negen handelingen
 * stil verdwenen: goederenontvangst, bijvullen, monster nemen, monsterlabel
 * herdrukken, productie boeken, pallet maken, inslaan, verschepen en het
 * ondertekenen van het verdict. Geen enkele test merkte dat, want elk
 * overgebleven scherm werkte prima.
 *
 * Dit script vergelijkt de POST-endpoints van de oude applicatie met die van de
 * nieuwe. Zodra de oude SPA verdwijnt slaat het zichzelf over: dan is er niets
 * meer om tegen af te zetten.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const here = (p) => new URL(p, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const OUD = here("../../dashboard/index.html");
const NIEUW = [here("../components"), here("../lib"), here("../app")];

/** `/orders/${id}/close` en `/orders/{x}/close` worden hetzelfde pad. */
function normaliseer(pad) {
  return pad.replace(/\$\{[^}]*\}/g, "{id}").replace(/\/+$/, "");
}

async function bestandenOnder(dir) {
  const uit = [];
  for (const naam of await readdir(dir)) {
    const pad = join(dir, naam);
    if ((await stat(pad)).isDirectory()) uit.push(...(await bestandenOnder(pad)));
    else if (/\.(tsx?|mjs)$/.test(naam)) uit.push(pad);
  }
  return uit;
}

/** Alles wat als eerste argument aan een post() meegaat. */
function postPaden(bron) {
  const uit = new Set();
  for (const m of bron.matchAll(/post(?:<[^>]*>)?\(\s*[`'"]([^`'"]+)/g)) {
    uit.add(normaliseer(m[1]));
  }
  // De oude SPA bouwde een paar paden op met concatenatie in plaats van een
  // template. `/alarms/` + id + `/ack` levert daar alleen het stuk tot de
  // eerste variabele op; die kortere vormen tellen als prefix.
  return uit;
}

let oud;
try {
  oud = postPaden(await readFile(OUD, "utf-8"));
} catch {
  console.log("check-parity: de oude SPA bestaat niet meer, niets te vergelijken.");
  process.exit(0);
}

let nieuw = new Set();
for (const dir of NIEUW) {
  for (const bestand of await bestandenOnder(dir)) {
    for (const pad of postPaden(await readFile(bestand, "utf-8"))) nieuw.add(pad);
  }
}

/**
 * Een oud pad is gedekt als zijn segmenten een prefix zijn van een nieuw pad,
 * waarbij `{id}` op elk segment past.
 *
 * Twee gevallen maken dit nodig. De oude SPA bouwde `/hu/` + id + '/' + actie
 * met concatenatie, wat hier `/hu/{id}/{id}` wordt terwijl de nieuwe UI
 * `/hu/{id}/putaway` en `/hu/{id}/ship` los aanroept. En `/alarms/` + id +
 * '/ack' levert alleen het stuk tot de eerste variabele op, dus dat pad is
 * korter dan zijn nieuwe tegenhanger.
 */
function past(oudPad, nieuwPad) {
  const o = oudPad.split("/").filter(Boolean);
  const n = nieuwPad.split("/").filter(Boolean);
  if (o.length > n.length) return false;
  return o.every((seg, i) => seg === "{id}" || seg === n[i]);
}

const gedekt = (pad) => [...nieuw].some((n) => past(pad, n));
const ontbreekt = [...oud].filter((pad) => !gedekt(pad)).sort();

if (ontbreekt.length > 0) {
  console.error("check-parity: deze acties kon de oude applicatie wel en de nieuwe niet:");
  for (const pad of ontbreekt) console.error(`  POST ${pad}`);
  console.error("\nElke regel is een knop die een gebruiker kwijt is.");
  process.exit(1);
}

const extra = [...nieuw].filter((pad) => ![...oud].some((o) => past(o, pad))).sort();
console.log(`check-parity: ${oud.size} acties uit de oude applicatie, allemaal gedekt.`);
if (extra.length > 0) console.log(`  nieuw erbij: ${extra.join(", ")}`);
