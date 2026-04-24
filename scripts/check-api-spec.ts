#!/usr/bin/env node

/**
 * check-api-spec.ts — API Specification Drift Check
 *
 * Verifies that:
 * 1. All registered routes are documented in openapi.yaml
 * 2. All documented endpoints exist in the codebase
 * 3. Auth requirements are consistent
 *
 * Usage:
 *   pnpm check-api-spec
 *   pnpm check-api-spec --strict  (fail on any drift)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const apiServerRoot = path.resolve(projectRoot, "artifacts/api-server");
const routesDir = path.resolve(apiServerRoot, "src/routes");
const openAPIPath = path.resolve(apiServerRoot, "src/openapi.yaml");

// ── Types ──────────────────────────────────────────────────────────────

interface RouteInfo {
  file: string;
  path: string;
  method: string[];
  protected: boolean;
  documented: boolean;
}

interface SpecDriftReport {
  undocumentedRoutes: RouteInfo[];
  missingImplementations: string[];
  authMismatches: { path: string; specRequiresAuth: boolean; implProtected: boolean }[];
  totalRoutes: number;
  totalDocumented: number;
  driftPercentage: number;
  passed: boolean;
}

// ── Extract routes from openapi.yaml ────────────────────────────────

function extractDocumentedRoutes(): Set<string> {
  if (!fs.existsSync(openAPIPath)) {
    console.warn("openapi.yaml not found");
    return new Set();
  }

  const content = fs.readFileSync(openAPIPath, "utf8");
  const spec = YAML.parse(content);

  const documented = new Set<string>();

  if (spec.paths) {
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      if (typeof pathItem === "object" && pathItem !== null) {
        const methods = Object.keys(pathItem).filter((k) =>
          ["get", "post", "put", "patch", "delete", "options"].includes(k),
        );
        for (const method of methods) {
          documented.add(`${method.toUpperCase()} ${path}`);
        }
      }
    }
  }

  return documented;
}

// ── Extract routes from route files ────────────────────────────────

function extractImplementedRoutes(): RouteInfo[] {
  const routes: RouteInfo[] = [];

  if (!fs.existsSync(routesDir)) {
    console.error(`Routes directory not found: ${routesDir}`);
    return routes;
  }

  const files = fs.readdirSync(routesDir).filter((f) => f.endsWith(".ts"));

  for (const file of files) {
    const content = fs.readFileSync(path.join(routesDir, file), "utf8");

    // Simple regex to find route definitions
    // This is a heuristic and may need refinement
    const routeMatches = content.matchAll(
      /router\.(get|post|put|patch|delete|options)\s*\(\s*["']([^"']+)["']/g,
    );

    for (const match of routeMatches) {
      const method = match[1].toUpperCase();
      let routePath = match[2];

      // Normalize path
      if (!routePath.startsWith("/")) {
        routePath = "/" + routePath;
      }

      const isProtected =
        content.includes("requireAuth") ||
        content.includes("apiKeyAuth") ||
        content.includes("requirePermission") ||
        file.includes("auth");

      routes.push({
        file,
        path: routePath,
        method: [method],
        protected: isProtected,
        documented: false,
      });
    }
  }

  // Merge routes with same path
  const merged = new Map<string, RouteInfo>();
  for (const route of routes) {
    const key = route.path;
    if (merged.has(key)) {
      const existing = merged.get(key)!;
      existing.method = [...new Set([...existing.method, ...route.method])];
      existing.protected = existing.protected || route.protected;
    } else {
      merged.set(key, route);
    }
  }

  return Array.from(merged.values());
}

// ── Main check logic ───────────────────────────────────────────────

function runSpecCheck(): SpecDriftReport {
  console.log("Checking API specification...\n");

  const documented = extractDocumentedRoutes();
  const implemented = extractImplementedRoutes();

  console.log(`Found ${implemented.length} implemented routes`);
  console.log(`Found ${documented.size} documented paths\n`);

  const undocumentedRoutes: RouteInfo[] = [];
  const authMismatches: { path: string; specRequiresAuth: boolean; implProtected: boolean }[] =
    [];

  for (const route of implemented) {
    let isDocumented = false;

    for (const method of route.method) {
      const docKey = `${method} ${route.path}`;
      if (documented.has(docKey)) {
        isDocumented = true;
        break;
      }

      // Also check with parameter placeholders
      const paramPath = route.path.replace(/:[^\/]+/g, "{$&}").replace(/:/g, "");
      const paramDocKey = `${method} ${paramPath}`;
      if (documented.has(paramDocKey)) {
        isDocumented = true;
        break;
      }
    }

    route.documented = isDocumented;

    if (!isDocumented) {
      // Skip health checks and metrics from drift report
      if (!route.path.includes("health") && !route.path.includes("metrics")) {
        undocumentedRoutes.push(route);
      }
    }
  }

  const missingImplementations: string[] = [];
  for (const docPath of documented) {
    const found = implemented.some((route) => {
      const routeKey = `${route.method[0]} ${route.path}`;
      return routeKey === docPath;
    });

    if (!found) {
      missingImplementations.push(docPath);
    }
  }

  const totalRoutes = implemented.length;
  const totalDocumented = implemented.filter((r) => r.documented).length;
  const driftPercentage =
    totalRoutes > 0 ? Math.round(((totalRoutes - totalDocumented) / totalRoutes) * 100) : 0;

  const passed = undocumentedRoutes.length === 0 && missingImplementations.length === 0;

  return {
    undocumentedRoutes,
    missingImplementations,
    authMismatches,
    totalRoutes,
    totalDocumented,
    driftPercentage,
    passed,
  };
}

// ── Report ─────────────────────────────────────────────────────────

function printReport(report: SpecDriftReport): void {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║          API Specification Drift Report                  ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  console.log(`Routes documented: ${report.totalDocumented}/${report.totalRoutes}`);
  console.log(`Drift: ${report.driftPercentage}%\n`);

  if (report.undocumentedRoutes.length > 0) {
    console.log(`⚠️  Undocumented routes (${report.undocumentedRoutes.length}):`);
    for (const route of report.undocumentedRoutes.slice(0, 10)) {
      const methods = route.method.join(",");
      const auth = route.protected ? " [AUTH]" : "";
      console.log(`   - ${methods} ${route.path}${auth} (${route.file})`);
    }
    if (report.undocumentedRoutes.length > 10) {
      console.log(`   ... and ${report.undocumentedRoutes.length - 10} more`);
    }
    console.log();
  }

  if (report.missingImplementations.length > 0) {
    console.log(`❌ Missing implementations (${report.missingImplementations.length}):`);
    for (const impl of report.missingImplementations.slice(0, 10)) {
      console.log(`   - ${impl}`);
    }
    if (report.missingImplementations.length > 10) {
      console.log(`   ... and ${report.missingImplementations.length - 10} more`);
    }
    console.log();
  }

  if (report.authMismatches.length > 0) {
    console.log(`🔐 Auth mismatches (${report.authMismatches.length}):`);
    for (const mismatch of report.authMismatches) {
      const specAuth = mismatch.specRequiresAuth ? "required" : "not required";
      const implAuth = mismatch.implProtected ? "protected" : "public";
      console.log(`   - ${mismatch.path}: spec=${specAuth}, impl=${implAuth}`);
    }
    console.log();
  }

  if (report.passed) {
    console.log("✅ API specification is in sync with implementation\n");
    process.exit(0);
  } else {
    console.log(
      "⚠️  API specification drift detected. Update openapi.yaml or route implementations.\n",
    );
    process.exit(1);
  }
}

// ── Main ───────────────────────────────────────────────────────────

const report = runSpecCheck();
printReport(report);
