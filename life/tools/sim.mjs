// Plays many lives with random choices and compares the results with the source statistics.
// Usage: node life/tools/sim.mjs [lives=3000] [ISO]
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "src");
const ctx = { console, Intl, Math, JSON, Object, Array };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["data.js", "curated.js", "engine.js", "events.js", "flavor.js"]) {
  vm.runInContext(fs.readFileSync(path.join(src, f), "utf8"), ctx, { filename: f });
}
const E = ctx.LIFE_ENGINE;
const N = +(process.argv[2] || 3000);
const ONLY = process.argv[3] && process.argv[3] !== "all" ? process.argv[3] : null;
const POLICY = process.argv[4] || "first"; // first: 40% lean to the first option; random: uniform

function play(seed) {
  const s = E.newLife(ONLY ? { seed, custom: { iso: ONLY, age: 14 } } : { seed });
  if (ONLY) { E.childhood(s); }
  let guard = 0;
  while (!s.dead && guard++ < 12 * 110) {
    const r = E.step(s);
    if (r.decision) {
      const opts = r.decision.options.filter((o) => !o.disabled);
      // random policy, with a mild lean to the first (most "standard") option
      const o = POLICY === "first" && Math.random() < 0.4 ? opts[0] : opts[Math.floor(Math.random() * opts.length)];
      E.choose(s, o.key);
    }
  }
  return s;
}

const t0 = Date.now();
const lives = [];
let errors = 0;
for (let i = 0; i < N; i++) {
  try { lives.push(play((i * 2654435761) >>> 0)); } catch (e) { errors++; if (errors < 4) console.error(e.stack); }
}
const ms = Date.now() - t0;
const byIso = {};
for (const s of lives) (byIso[s.homeIso] = byIso[s.homeIso] || []).push(s);

const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
console.log(`lives ${lives.length}, errors ${errors}, ${(ms / lives.length).toFixed(1)} ms/life`);

// life expectancy at the start age vs the life table
const rows = [];
for (const iso in byIso) {
  const L = byIso[iso];
  if (L.length < 40) continue;
  const stay = L.filter((s) => !s.prevIso);
  const sim = mean(stay.map((s) => s.death ? s.death.age : s.age));
  const wpp = mean(stay.map((s) => 14 + E.survivalMean(iso, s.sex, 14, 2026)));
  rows.push([iso, L.length, sim.toFixed(1), wpp.toFixed(1), (sim - wpp).toFixed(1), ((1 - stay.length / L.length) * 100).toFixed(0) + "%"]);
}
rows.sort((a, b) => b[1] - a[1]);
console.log("\nage at death (sim) vs life table (WPP 2024), by country");
console.log("iso   n     sim   wpp   diff  emigrated   (sim/wpp: people who stayed)");
for (const r of rows) console.log(r.map((x, i) => String(x).padEnd(i === 0 ? 5 : 6)).join(""));
const stayAll = lives.filter((s) => !s.prevIso);
const allSim = mean(stayAll.map((s) => s.death ? s.death.age : s.age));
const allW = mean(stayAll.map((s) => 14 + E.survivalMean(s.homeIso, s.sex, 14, 2026)));
console.log(`ALL  sim ${allSim.toFixed(2)}  wpp ${allW.toFixed(2)}  diff ${(allSim - allW).toFixed(2)}`);

// causes of death
const causes = {};
for (const s of lives) if (s.death) causes[s.death.cause] = (causes[s.death.cause] || 0) + 1;
const top = Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log("\ntop causes of death (sim, % of deaths)");
for (const [k, v] of top) console.log(`  ${k.padEnd(14)} ${(v / lives.length * 100).toFixed(1)}%`);

// education, family, money
const edu = [0, 0, 0, 0, 0, 0, 0, 0];
for (const s of lives) edu[s.edu.level]++;
console.log("\nhighest education:", edu.map((x, i) => `${E.EDU[i]} ${(x / lives.length * 100).toFixed(0)}%`).join(", "));
console.log("ever married:", (mean(lives.map((s) => (s.partner && s.partner.status === "married") || s.widowed || s.divorced ? 1 : 0)) * 100).toFixed(0) + "%",
  " children (women 45+):", mean(lives.filter((s) => s.sex === "f" && (s.death ? s.death.age : s.age) >= 45).map((s) => s.kids.length)).toFixed(2));
console.log("migrated abroad:", (mean(lives.map((s) => (s.prevIso ? 1 : 0))) * 100).toFixed(1) + "%", " decisions per life:", mean(lives.map((s) => s.history.length)).toFixed(1));
const kor = byIso.KOR || [];
if (kor.length) console.log("KOR: univ", (mean(kor.map((s) => (s.edu.level >= 5 ? 1 : 0))) * 100).toFixed(0) + "%", " married", (mean(kor.map((s) => (s.partner && s.partner.status === "married") || s.widowed || s.divorced ? 1 : 0)) * 100).toFixed(0) + "%");
// decision counts
const dc = {};
for (const s of lives) for (const h of s.history) dc[h.id] = (dc[h.id] || 0) + 1;
console.log("\ndecisions seen per 100 lives:", Object.entries(dc).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / lives.length * 100).toFixed(0)}`).join(", "));
