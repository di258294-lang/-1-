// Inlines everything into one HTML file: life/build/random-life.html
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(here, "src", f), "utf8");
const scripts = ["data.js", "curated.js", "engine.js", "events.js", "flavor.js", "claude.js", "ui.js"];
const html = src("index.html")
  .replace("/*STYLE*/", () => src("styles.css"))
  .replace("<!--SCRIPTS-->", () => scripts.map((f) => `<script>\n${src(f).replace(/<\/script/gi, "<\\/script")}\n</script>`).join("\n"));
fs.mkdirSync(path.join(here, "build"), { recursive: true });
const out = path.join(here, "build", "random-life.html");
fs.writeFileSync(out, html);
console.log("wrote", path.relative(process.cwd(), out), Math.round(html.length / 1024), "KB");
