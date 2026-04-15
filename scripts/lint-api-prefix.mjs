#!/usr/bin/env node
// P0-4 guard: forbids fetch("/...") in dashboard pages unless the path begins with /api.
// Static asset paths must be explicitly allow-listed below.
//
// Replaces the eslint rule "no fetch('/[^a]')" called for in the audit; we don't have
// an eslint config in godsview-dashboard yet, so we use a tiny grep-based check that
// can run in CI today and still be turned into an eslint rule later.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const pagesDir = path.join(repoRoot, "godsview-dashboard", "src", "pages");

// Static SPA assets that legitimately live outside /api.
const ALLOW_LIST_PREFIXES = [
  "/stitch-mission-control/",
];

const PATTERN = /\bfetch\(\s*[`"](\/[^"`)]+)/g;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const offenders = [];
for (const file of await walk(pagesDir)) {
  const src = await readFile(file, "utf8");
  let match;
  while ((match = PATTERN.exec(src)) !== null) {
    const url = match[1];
    if (url.startsWith("/api/") || url === "/api") continue;
    if (ALLOW_LIST_PREFIXES.some((p) => url.startsWith(p))) continue;
    const lineNum = src.slice(0, match.index).split("\n").length;
    offenders.push(`${path.relative(repoRoot, file)}:${lineNum}  fetch("${url}")`);
  }
}

if (offenders.length > 0) {
  console.error(
    `\nlint-api-prefix FAILED — fetch() calls in src/pages must use /api prefix:\n`,
  );
  for (const line of offenders) console.error("  " + line);
  console.error(
    `\nIf the path is a legitimate static asset, add it to ALLOW_LIST_PREFIXES in scripts/lint-api-prefix.mjs.`,
  );
  process.exit(1);
}

console.log(`lint-api-prefix OK — scanned ${pagesDir}.`);
