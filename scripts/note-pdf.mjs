// Exports NOTE.md as a one-page A4 NOTE.pdf using headless Microsoft Edge (or Chrome).
// Run: npm run note:pdf

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { marked } from "marked";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const md = readFileSync(join(root, "NOTE.md"), "utf8");

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Virtual KAM: submission note</title>
<style>
  @page { size: A4; margin: 13mm 15mm; }
  body { font-family: "Segoe UI", system-ui, sans-serif; font-size: 9.6pt; line-height: 1.38; color: #16181d; }
  h1 { font-size: 17pt; margin: 0 0 2pt; letter-spacing: -0.01em; }
  h1 + p { margin-top: 0; color: #5f6573; }
  h2 { font-size: 11pt; margin: 9pt 0 2pt; color: #e40046; }
  p, ul { margin: 0 0 4pt; }
  ul { padding-left: 14pt; }
  li { margin: 0 0 1.5pt; }
  code { font-family: Consolas, monospace; font-size: 8.8pt; background: #f1f2f4; padding: 0 2pt; border-radius: 2pt; }
  a { color: #e40046; }
  strong { font-weight: 600; }
</style></head><body>${marked.parse(md)}</body></html>`;

const browsers = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];
const browser = browsers.find(existsSync);
if (!browser) throw new Error("No Edge or Chrome found for PDF export.");

const dir = mkdtempSync(join(tmpdir(), "note-pdf-"));
const htmlFile = join(dir, "note.html");
writeFileSync(htmlFile, html);
const out = join(root, "NOTE.pdf");
execFileSync(browser, [
  "--headless=new",
  "--disable-gpu",
  `--user-data-dir=${join(dir, "profile")}`,
  "--no-pdf-header-footer",
  `--print-to-pdf=${out}`,
  pathToFileURL(htmlFile).href,
], { stdio: "ignore" });

// On Windows the launcher can exit before the browser finishes writing; wait for a stable file.
const { statSync } = await import("node:fs");
let last = -1;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const size = existsSync(out) ? statSync(out).size : -1;
  if (size > 0 && size === last) break;
  last = size;
}
if (!existsSync(out)) throw new Error("The browser didn't produce NOTE.pdf.");
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  /* profile may still be locked briefly; harmless */
}

const pages = (readFileSync(out, "latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
console.log(`Wrote NOTE.pdf (${pages} page${pages === 1 ? "" : "s"})`);
if (pages > 1) process.exitCode = 2;
