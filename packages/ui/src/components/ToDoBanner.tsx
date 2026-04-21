import * as React from "react";
import { Badge } from "./Badge.js";
import { cn } from "../utils/cn.js";

export interface ToDoBannerProps {
  phase: string;
  note?: string;
  className?: string;
}

/**
 * Banner rendered on v2 stub pages (Phase 0 ships 62 stubs).
 * Makes it impossible to confuse a stub for a real page. Removed
 * when the page graduates to real data in its phase.
 */
export function ToDoBanner({ phase, note, className }: ToDoBannerProps) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900",
        className,
      )}
    >
      <Badge tone="warn">stub</Badge>
      <span>
        This page is scaffolded for <strong>{phase}</strong>.
        {note ? ` ${note}` : " Real implementation lands in the phase shown."}
      </span>
    </div>
  );
}
