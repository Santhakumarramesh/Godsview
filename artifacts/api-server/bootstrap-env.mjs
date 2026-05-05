// Pre-loads workspace .env into process.env before the API server starts.
// Used by `pnpm dev` so the server picks up PORT, DATABASE_URL, etc.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  resolve(here, ".env"),
  resolve(here, "..", ".env"),
  resolve(here, "..", "..", ".env"),
  resolve(here, "..", "..", "..", ".env"),
];

for (const p of candidates) {
  if (!existsSync(p)) continue;
  const text = readFileSync(p, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1);
    // strip trailing inline " # comment"
    const m = val.match(/^([^#]*?)\s+#.*$/);
    if (m) val = m[1];
    val = val.trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
  break;
}
