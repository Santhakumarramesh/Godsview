/**
 * Role-based access control context.
 *
 * Two roles ship today:
 *   - viewer    (default): can read every page, cannot mutate broker / risk / system state
 *   - operator           : can do everything viewer can plus run mutations on guarded pages
 *
 * Role is persisted in localStorage under `godsview.role`.
 *
 * In production this hook is the *only* place that decides "can the current user
 * see/operate this page?" — pages must NOT decide this themselves.
 *
 * Wiring in App.tsx is via <RouteGuard required="operator"> (see ./route-guard.tsx).
 * The current role is mutated through the small switcher widget in the Shell footer.
 *
 * NOTE: this is a *client-side* gate that controls UI affordances. The api-server
 * already enforces fail-closed `503 broker_not_configured` in production when no
 * Alpaca credentials are present (see Phase 2 demo_mode.ts). RBAC + that 503 are
 * the two layers that protect against accidental destructive actions.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Role = "viewer" | "operator";

const STORAGE_KEY = "godsview.role";

type RoleContextValue = {
  role: Role;
  setRole: (next: Role) => void;
  /** True if `role` includes the privileges of `required`. */
  can: (required: Role) => boolean;
};

const RoleContext = createContext<RoleContextValue | null>(null);

function readPersistedRole(): Role {
  if (typeof window === "undefined") return "viewer";
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "operator" || value === "viewer") return value;
  } catch {
    // localStorage may be blocked in some sandboxed contexts.
  }
  return "viewer";
}

function rolePrivilegeLevel(role: Role): number {
  return role === "operator" ? 1 : 0;
}

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(() => readPersistedRole());

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, role);
    } catch {
      // ignore quota / privacy mode failures
    }
  }, [role]);

  const value = useMemo<RoleContextValue>(
    () => ({
      role,
      setRole: (next) => setRoleState(next),
      can: (required) => rolePrivilegeLevel(role) >= rolePrivilegeLevel(required),
    }),
    [role],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) {
    throw new Error("useRole must be used inside <RoleProvider>");
  }
  return ctx;
}
