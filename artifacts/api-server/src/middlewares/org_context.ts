/**
 * Multi-tenant org context.
 *
 * Reads `X-Org-Id` header, falls back to `ORG_DEFAULT` env, finally falls
 * back to `org_default`. Attaches to req.orgId for downstream handlers.
 *
 * This is a stub for SaaS. In single-tenant deployments every row gets
 * tagged with `org_default` so that future migrations to a real billing /
 * isolation layer have a starting point that doesn't require a backfill.
 */

import type { Request, Response, NextFunction } from "express";

// Symbol to attach orgId without polluting the Express type namespace.
// (Module augmentation against express-serve-static-core requires the dep
// type imported, which isn't always loaded; using a property on req with a
// non-enumerable cast keeps things simple and TS-clean.)
const ORG_KEY = "_godsviewOrgId";

export function attachOrgContext(req: Request, _res: Response, next: NextFunction): void {
  const headerVal = (req.header("x-org-id") || "").trim();
  const envDefault = (process.env.ORG_DEFAULT || "").trim();
  (req as any)[ORG_KEY] = headerVal || envDefault || "org_default";
  next();
}

export function getOrgId(req: Request): string {
  return ((req as any)[ORG_KEY] as string | undefined) || (process.env.ORG_DEFAULT || "org_default");
}
