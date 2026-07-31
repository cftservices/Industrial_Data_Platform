#!/usr/bin/env node
/**
 * Controleert de uitgeleverde CSS na een build op drie dingen die stil kapot
 * kunnen gaan zonder dat een pagina er anders uitziet:
 *
 *   1. Beide familieblokken bestaan, met verschillende chrome. Zijn ze gelijk,
 *      dan is het onderscheid tussen operator- en managementtaal weg zonder
 *      dat er iets faalt.
 *   2. Tailwinds defaultpalet is echt gewist. `--color-*: initial` per ongeluk
 *      verliezen betekent dat `bg-blue-500` weer werkt en de tokenregel
 *      omzeilbaar wordt.
 *   3. De statustokens staan in de uitlevering. Tailwind schudt ongebruikte
 *      themavariabelen weg; verdwijnt een statuskleur, dan valt hij terug op
 *      niets.
 *
 * Draai na `next build`.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const CSS_DIR = new URL("../.next/static/css/", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

let css = "";
try {
  for (const f of await readdir(CSS_DIR)) {
    if (f.endsWith(".css")) css += await readFile(join(CSS_DIR, f), "utf-8");
  }
} catch {
  console.error(`geen gebouwde CSS in ${CSS_DIR}; draai eerst \`npm run build\``);
  process.exit(1);
}

const problems = [];

/** Alle declaraties van een familie, over alle regels heen (Lightning CSS
 *  splitst een blok op zodra er een @supports-fallback tussen komt). */
function declarations(family) {
  const out = new Map();
  const re = new RegExp(String.raw`\[data-ui=["']?${family}["']?\]\s*\{([^}]*)\}`, "g");
  let m;
  while ((m = re.exec(css)) !== null) {
    for (const decl of m[1].split(";")) {
      const i = decl.indexOf(":");
      if (i > 0) out.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
    }
  }
  return out;
}

const mgmt = declarations("mgmt");
const ops = declarations("ops");

if (mgmt.size === 0) problems.push('geen [data-ui="mgmt"]-blok in de uitgeleverde CSS');
if (ops.size === 0) problems.push('geen [data-ui="ops"]-blok in de uitgeleverde CSS');

for (const token of ["--density-row", "--tile-pad", "--ui-radius-tile", "--shadow-tile", "--ui-accent"]) {
  const a = mgmt.get(token);
  const b = ops.get(token);
  if (a === undefined) problems.push(`mgmt mist ${token}`);
  if (b === undefined) problems.push(`ops mist ${token}`);
  if (a !== undefined && b !== undefined && a === b) {
    problems.push(`${token} is gelijk in beide families (${a}); dan is er geen onderscheid`);
  }
}

// Het ops-accent moet neutraal zijn: de kleur BESTAAT daar, maar is grijs.
if (ops.get("--ui-accent") && !/ink-muted/.test(ops.get("--ui-accent"))) {
  problems.push(`ops --ui-accent is niet neutraal (${ops.get("--ui-accent")})`);
}

const TW = /\.(?:bg|text|border|fill|stroke)-(?:slate|gray|zinc|red|orange|amber|green|blue|indigo|violet|purple|pink)-\d{2,3}[\s{,:]/;
if (TW.test(css)) problems.push("Tailwind-defaultkleurutilities zitten in de uitlevering; --color-*: initial werkt niet");

const STATUS = ["idle", "run", "done", "warn", "alarm", "unset", "stale"];
for (const s of STATUS) {
  if (!css.includes(`--ui-status-${s}`)) problems.push(`statustoken --ui-status-${s} ontbreekt in de uitlevering`);
}

if (problems.length) {
  console.error("\ncheck-families: FOUT\n");
  for (const p of problems) console.error("  " + p);
  console.error("");
  process.exit(1);
}

const show = (m) => [...m.entries()].map(([k, v]) => `${k}=${v}`).join("  ");
console.log("check-families: OK");
console.log(`  mgmt  ${show(mgmt)}`);
console.log(`  ops   ${show(ops)}`);
console.log(`  ${STATUS.length} statustokens aanwezig, geen Tailwind-defaultkleuren`);
