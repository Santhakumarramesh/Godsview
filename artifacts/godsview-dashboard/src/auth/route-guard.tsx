/**
 * Route-level RBAC gate.
 *
 * Wrap any page tree in <RouteGuard required="operator">…</RouteGuard>. If the
 * current role lacks the required privilege, render a small access-denied panel
 * with a one-click switcher that elevates to the required role (this UI affordance
 * exists because the *server* is the real gate; this client gate is only here to
 * (a) surface the right call-to-action and (b) prevent destructive UI actions from
 * being even reachable without intent).
 */
import type { ReactNode } from "react";
import { useRole, type Role } from "./role-context";

export function RouteGuard({
  required,
  children,
}: {
  required: Role;
  children: ReactNode;
}) {
  const { role, setRole, can } = useRole();
  if (can(required)) return <>{children}</>;

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div
        className="max-w-md w-full rounded-lg p-6 border"
        style={{
          backgroundColor: "rgba(251, 191, 36, 0.05)",
          borderColor: "rgba(251, 191, 36, 0.25)",
        }}
        data-testid="route-guard-denied"
      >
        <div className="flex items-center gap-2 mb-3">
          <span
            className="material-symbols-outlined"
            style={{ color: "#fbbf24", fontSize: "20px" }}
          >
            lock
          </span>
          <h2
            className="font-headline font-bold text-sm tracking-[0.15em] uppercase"
            style={{ color: "#fbbf24" }}
          >
            Operator role required
          </h2>
        </div>
        <p className="text-sm text-[#adaaab] mb-4">
          This page can mutate live state (broker orders, risk caps, system
          config). It is locked behind the <code className="text-white">{required}</code>{" "}
          role. You are currently signed in as <code className="text-white">{role}</code>.
        </p>
        <button
          type="button"
          onClick={() => setRole(required)}
          className="px-4 py-2 rounded text-sm font-medium"
          style={{
            backgroundColor: "rgba(156, 255, 147, 0.1)",
            border: "1px solid rgba(156, 255, 147, 0.3)",
            color: "#9cff93",
          }}
          data-testid="route-guard-elevate"
        >
          Elevate to {required}
        </button>
        <p
          className="text-[10px] mt-3"
          style={{ color: "#767576", fontFamily: "JetBrains Mono, monospace" }}
        >
          Server-side authorization (api-server) remains the source of truth.
          This client-side gate only controls UI affordances.
        </p>
      </div>
    </div>
  );
}
