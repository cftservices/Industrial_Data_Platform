#!/usr/bin/env node
/**
 * Handhaaft de tokenregel uit hmi-style-guide.md §3.4.
 *
 * Componentcode gebruikt uitsluitend tier 2 en tier 3. Geen hexwaarde, geen
 * tier-1 primitive, geen Tailwind-defaultkleur. Dit is de reden dat de
 * bestaande in-huis ECharts-component onmogelijk twee thema's kan hebben: daar
 * staan 28 hexwaarden hardgecodeerd in het optie-object.
 *
 * globals.css is de enige plek waar hexwaarden mogen staan.
 *
 * Draai: node scripts/lint-tokens.mjs [--self-test]
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SCAN = ["app", "components", "lib"];
const ALLOW_FILES = new Set(["app/globals.css"]);
const EXT = /\.(tsx?|css)$/;

// Tailwind-defaultkleuren die door `--color-*: initial` niet meer bestaan maar
// die je uit gewoonte alsnog typt. Ze zouden stil niets doen.
const TW_COLORS =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

const RULES = [
  {
    id: "hex",
    // Niet voorafgegaan door "&": anders vangt de regel HTML-entiteiten zoals
    // &#8627; (de volgt-uit-pijl) aan voor een kleur. Dat is een teken, geen hex.
    re: /(?<!&)#[0-9a-fA-F]{3,8}\b/g,
    msg: "hexwaarde in componentcode; gebruik een tier-2 token",
  },
  {
    id: "tailwind-default",
    re: new RegExp(String.raw`\b(?:bg|text|border|fill|stroke|ring|from|to|via)-(?:${TW_COLORS})-\d{2,3}\b`, "g"),
    msg: "Tailwind-defaultkleur; die is gewist met --color-*: initial en doet niets",
  },
  {
    id: "tier1",
    re: /var\(\s*--(?:slate|blue|amber|vermilion|violet|white)-/g,
    msg: "tier-1 primitive in componentcode; gebruik het semantische token",
  },
  {
    id: "rgb-literal",
    re: /\b(?:rgb|rgba|hsl|hsla)\(\s*\d/g,
    msg: "kleurliteral in componentcode; gebruik een tier-2 token",
  },
];

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      yield* walk(full);
    } else if (EXT.test(e.name)) {
      yield full;
    }
  }
}

const selfTest = process.argv.includes("--self-test");
const findings = [];

for (const base of SCAN) {
  for await (const file of walk(join(ROOT, base))) {
    const rel = relative(ROOT, file).split("\\").join("/");
    if (ALLOW_FILES.has(rel)) continue;
    const src = await readFile(file, "utf-8");
    const lines = src.split("\n");
    for (const rule of RULES) {
      lines.forEach((line, i) => {
        // Een regel met een lint-uitzondering mag door, mits hij hem benoemt.
        if (line.includes("lint-tokens-allow:")) return;
        rule.re.lastIndex = 0;
        const m = rule.re.exec(line);
        if (m) findings.push({ rel, line: i + 1, rule: rule.id, msg: rule.msg, hit: m[0] });
      });
    }
  }
}

if (selfTest) {
  // Bewijst dat de linter werkt in plaats van dat hij alleen zwijgt: voer een
  // regel in die MOET falen en controleer dat elke regel hem vindt.
  const sample = `const c = "#b03a2e"; // bg-blue-500 var(--slate-40) rgb(1,2,3)`;
  const missed = RULES.filter((r) => {
    r.re.lastIndex = 0;
    return !r.re.test(sample);
  });
  if (missed.length) {
    console.error(`zelftest MISLUKT, regels vonden niets: ${missed.map((r) => r.id).join(", ")}`);
    process.exit(1);
  }
  // En het omgekeerde: een HTML-entiteit is geen kleur en mag GEEN treffer
  // zijn. Zonder deze helft dekt de zelftest alleen vals-negatief af.
  const hexRule = RULES.find((r) => r.id === "hex");
  hexRule.re.lastIndex = 0;
  if (hexRule.re.test("&#8627; &#9660;")) {
    console.error("zelftest MISLUKT: een HTML-entiteit wordt als hexkleur gezien");
    process.exit(1);
  }
  console.log(
    `zelftest OK: alle ${RULES.length} regels vinden een overtreding, en een HTML-entiteit niet`,
  );
}

if (findings.length) {
  console.error(`\nlint-tokens: ${findings.length} overtreding(en)\n`);
  for (const f of findings) {
    console.error(`  ${f.rel}:${f.line}  [${f.rule}]  ${f.hit}\n      ${f.msg}`);
  }
  console.error("\nAlleen app/globals.css mag hexwaarden bevatten (tier 1).\n");
  process.exit(1);
}

console.log(`lint-tokens: schoon (${SCAN.join(", ")})`);
