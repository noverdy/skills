#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log(`usage: node terminal.mjs spec.json [out.png]

spec.json fields (paths relative to the spec):
  text      path to the captured terminal or logcat output (required)
  theme     "dark" (default) or "light"
  logcat    true colours Android logcat lines by level (default: auto-detect)
  wrap      wrap long lines at this many columns (default 150)
  lines     [first, last] 1-based range of lines to keep
  box       [{ "match": "regex", "color": "red" }]  outline matches (group 1 if present)
  blur      [{ "match": "regex", "keep": 4, "box": true }]  blur matches (group 1 if present),
            last 4 chars stay in green; "box" also outlines the blurred value
  fontSize  px (default 14)
  scale     device pixel ratio (default 2)

Chrome or Chromium is found via $CHROME, PATH, or Playwright's cache.`);
  process.exit(args.length ? 0 : 1);
}

const specPath = resolve(args[0]);
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const known = new Set(["text", "theme", "logcat", "wrap", "lines", "box", "blur", "fontSize", "scale"]);
for (const k of Object.keys(spec)) if (!known.has(k)) fail(`unknown spec field: ${k}`);
if (!spec.text) fail("spec.text is required");
const out = resolve(args[1] || specPath.replace(/\.json$/, "") + ".png");

let lines = readFileSync(resolve(dirname(specPath), spec.text), "utf8").replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
if (spec.lines) lines = lines.slice(spec.lines[0] - 1, spec.lines[1]);
const wrapAt = spec.wrap ?? 150;
const logcatRe = /^(\d\d-\d\d \d\d:\d\d:\d\d\.\d+\s+\d+\s+\d+\s+)([VDIWEF])(\s+)([^:]*?)(\s*:\s)(.*)$/;
const isLogcat = spec.logcat ?? lines.some((l) => logcatRe.test(l));
const dark = (spec.theme ?? "dark") === "dark";
const fontSize = spec.fontSize ?? 14;
const scale = spec.scale ?? 2;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const levelColor = dark
  ? { V: "#8b949e", D: "#58a6ff", I: "#3fb950", W: "#d29922", E: "#f85149", F: "#f85149" }
  : { V: "#6e7781", D: "#0969da", I: "#1a7f37", W: "#9a6700", E: "#cf222e", F: "#cf222e" };

const rows = [];
for (const line of lines) {
  const m = isLogcat && line.match(logcatRe);
  const body = m
    ? `<span class="meta">${esc(m[1])}</span><span style="color:${levelColor[m[2]]};font-weight:600">${m[2]}</span>${esc(m[3])}<span class="tag">${esc(m[4])}</span>${esc(m[5])}<span style="color:${levelColor[m[2]]}">${esc(m[6])}</span>`
    : esc(line);
  rows.push(`<div class="row">${body}</div>`);
}

const markup = readFileSync(join(here, "markup.js"), "utf8");
const page = (measure) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:${dark ? "#0d1117" : "#ffffff"}}
#term{display:inline-block;padding:16px 20px;font:${fontSize}px/1.5 "JetBrains Mono","DejaVu Sans Mono","Noto Mono",monospace;color:${dark ? "#c9d1d9" : "#1f2328"}}
.row{white-space:pre-wrap;word-break:break-all;width:${wrapAt}ch}
.meta{color:${dark ? "#6e7681" : "#8c959f"}}
.tag{color:${dark ? "#d2a8ff" : "#8250df"}}
</style></head><body><div id="term">${rows.join("")}</div>
<script>${markup}
window.__res = evidenceMark(${JSON.stringify({ box: spec.box || [], blur: spec.blur || [] })});
${measure ? `const r=document.getElementById("term").getBoundingClientRect();document.title=JSON.stringify({w:Math.ceil(r.width),h:Math.ceil(r.height),res:window.__res});` : ""}
</script></body></html>`;

const chrome = findChrome();
const work = mkdtempSync(join(tmpdir(), "terminal-"));
try {
  const html = join(work, "page.html");
  writeFileSync(html, page(true));
  const dom = run(chrome, ["--dump-dom", `file://${html}`]);
  const title = dom.match(/<title>(.*?)<\/title>/s);
  if (!title) fail("could not measure the page; chrome printed:\n" + dom.slice(0, 500));
  const info = JSON.parse(title[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
  writeFileSync(html, page(false));
  run(chrome, [`--window-size=${info.w},${info.h}`, `--force-device-scale-factor=${scale}`, `--screenshot=${out}`, `file://${html}`]);
  console.log(JSON.stringify({ out, cssSize: [info.w, info.h], scale, logcat: isLogcat, lines: lines.length, ...info.res }, null, 2));
  if (info.res.missing.length) {
    console.error("selectors that matched nothing: " + JSON.stringify(info.res.missing));
    process.exit(1);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

function run(bin, extra) {
  return execFileSync(bin, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", ...sandboxFlag(), ...extra], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
}

function sandboxFlag() {
  return process.env.CHROME_NO_SANDBOX === "0" ? [] : ["--no-sandbox"];
}

function findChrome() {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome"]) {
    try {
      return execFileSync("which", [name], { encoding: "utf8" }).trim();
    } catch {}
  }
  const cache = join(homedir(), ".cache", "ms-playwright");
  if (existsSync(cache)) {
    const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => b.split("-")[1] - a.split("-")[1]);
    for (const d of dirs) {
      for (const p of ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
        if (existsSync(join(cache, d, p))) return join(cache, d, p);
      }
    }
  }
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(mac)) return mac;
  fail("no Chrome or Chromium found; set $CHROME to its path");
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
