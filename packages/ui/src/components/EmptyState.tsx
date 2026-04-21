import * as React from "react";
import { cn } from "../utils/cn.js";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-10 text-center",
        className,
      )}
    >
      <p className="text-base font-semibold text-slate-900">{title}</p>
      {description ? <p className="max-w-prose text-sm text-slate-600">{description}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
