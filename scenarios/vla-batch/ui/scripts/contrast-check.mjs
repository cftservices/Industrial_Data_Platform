#!/usr/bin/env node
/**
 * Toegankelijkheidscriterium 2 uit hmi-style-guide.md §10:
 * grafische objecten en statusindicatoren halen 3:1 tegen hun achtergrond
 * (WCAG SC 1.4.11 Non-text Contrast).
 *
 * Getoetst in VIER combinaties: licht en donker, elk tegen --color-surface en
 * --color-canvas. Een statuskleur die in het lichte thema net haalt en in het
 * donkere zakt is precies het soort regressie dat niemand ziet.
 *
 * Leest de waarden uit app/globals.css zelf, zodat de test niet uit de pas kan
 * lopen met de tokens.
 */

import { readFile } from "node:fs/promises";

const CSS = new URL("../app/globals.css", import.meta.url);
const MIN_RATIO = 3.0;

// Regeleinde-tolerant: op Windows schrijft niet elke tool LF, en een
// handhavingsscript dat daarop stilvalt handhaaft niets.
const src = (await readFile(CSS, "utf-8")).replace(/\r\n/g, "\n");

/** Alle tier-1 hexwaarden uit de :root-blok. */
function primitives(text) {
  const out = {};
  for (const m of text.matchAll(/^\s*--([a-z]+-\d{2}|white):\s*(#[0-9a-fA-F]{3,8});/gm)) {
    out[m[1]] = m[2];
  }
  return out;
}

/** De tier-2 toewijzingen binnen een selectorblok. */
function block(text, selector) {
  const i = text.indexOf(selector);
  if (i === -1) return null;
  const open = text.indexOf("{", i);
  const close = text.indexOf("}", open);
  const body = text.slice(open + 1, close);
  const out = {};
  for (const m of body.matchAll(/--(ui-[a-z-]+):\s*var\(--([a-z]+-\d{2}|white)\)/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

function hexToRgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const prim = primitives(src);
const themes = {
  licht: block(src, ':root,\n:root[data-theme="light"]'),
  donker: block(src, ':root[data-theme="dark"]'),
};

const STATUS = [
  "ui-status-idle",
  "ui-status-run",
  "ui-status-done",
  "ui-status-warn",
  "ui-status-alarm",
  "ui-status-unset",
  "ui-status-stale",
];
const GROUNDS = ["ui-surface", "ui-canvas"];

let failures = 0;
let checks = 0;
const rows = [];

for (const [themeName, map] of Object.entries(themes)) {
  if (!map) {
    console.error(`kon het themablok "${themeName}" niet uit globals.css lezen`);
    process.exit(1);
  }
  for (const ground of GROUNDS) {
    const bgKey = map[ground];
    const bg = prim[bgKey];
    if (!bg) {
      console.error(`geen hexwaarde voor ${ground} (${bgKey}) in thema ${themeName}`);
      process.exit(1);
    }
    for (const status of STATUS) {
      const fgKey = map[status];
      const fg = prim[fgKey];
      if (!fg) {
        console.error(`geen hexwaarde voor ${status} (${fgKey}) in thema ${themeName}`);
        process.exit(1);
      }
      const r = ratio(fg, bg);
      checks += 1;
      const ok = r >= MIN_RATIO;
      if (!ok) failures += 1;
      rows.push({
        thema: themeName,
        grond: ground.replace("ui-", ""),
        status: status.replace("ui-status-", ""),
        ratio: r.toFixed(2),
        ok,
      });
    }
  }
}

const w = (s, n) => String(s).padEnd(n);
console.log(`\ncontrast-check, WCAG 1.4.11, drempel ${MIN_RATIO}:1\n`);
console.log(`  ${w("thema", 8)}${w("grond", 10)}${w("status", 10)}${w("ratio", 8)}`);
console.log(`  ${"-".repeat(38)}`);
for (const r of rows) {
  console.log(`  ${w(r.thema, 8)}${w(r.grond, 10)}${w(r.status, 10)}${w(r.ratio, 8)}${r.ok ? "" : "  TE LAAG"}`);
}

console.log(
  `\n${checks} combinaties getoetst, ${failures} onder de drempel.` +
    (failures ? "\n\nVerhoog het lichtheidsverschil van de gemarkeerde kleuren.\n" : "\n"),
);

process.exit(failures ? 1 : 0);
