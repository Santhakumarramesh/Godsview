"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { SIDEBAR, type SidebarItem } from "@/lib/sidebar";
import { useAuth } from "@/lib/auth-context";

function allowedFor(item: SidebarItem, roles: ReadonlyArray<string>): boolean {
  if (!item.roles || item.roles.length === 0) return true;
  return item.roles.some((r) => roles.includes(r));
}

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const roles = user?.roles ?? [];

  return (
    <nav
      aria-label="Primary"
      className="h-full overflow-y-auto border-r border-border bg-surface/60 py-4 text-sm"
    >
      <div className="px-4 pb-3">
        <span className="font-mono text-xs uppercase tracking-widest text-muted">
          GodsView
        </span>
        <div className="text-lg font-semibold text-foreground">Command center</div>
      </div>
      {SIDEBAR.map((section) => {
        const visible = section.items.filter((it) => allowedFor(it, roles));
        if (visible.length === 0) return null;
        return (
          <div key={section.label} className="mb-3 px-2">
            <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted">
              {section.label}
            </div>
            <ul>
              {visible.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={clsx(
                        "flex items-center justify-between rounded px-2 py-1.5 transition-colors",
                        active
                          ? "bg-primary/15 text-primary"
                          : "text-foreground/80 hover:bg-surface hover:text-foreground",
                      )}
                    >
                      <span>{item.label}</span>
                      {item.stub ? (
                        <span className="ml-2 rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-mono uppercase text-warn">
                          stub
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
