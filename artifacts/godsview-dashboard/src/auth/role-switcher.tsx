/**
 * Role-switcher widget.
 *
 * Renders in the Shell footer — small, unobtrusive. Lets the operator switch
 * between viewer and operator roles without opening DevTools.
 *
 * In a real auth-integrated build this widget would be replaced by the user's
 * SSO identity card, with role coming from the JWT claims. The control here is
 * intentionally explicit so that during the unauthenticated dev rollout the
 * operator can still demonstrate / test the RBAC gate.
 */
import { useRole, type Role } from "./role-context";

const ROLES: Role[] = ["viewer", "operator"];

export function RoleSwitcher() {
  const { role, setRole } = useRole();

  return (
    <div
      className="px-3 py-2 rounded mt-2"
      style={{
        backgroundColor: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(72,72,73,0.2)",
      }}
      data-testid="role-switcher"
    >
      <div
        style={{
          fontSize: "8px",
          color: "#484849",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          fontFamily: "Space Grotesk",
          fontWeight: 700,
          marginBottom: "6px",
        }}
      >
        Active Role
      </div>
      <div className="flex gap-1">
        {ROLES.map((option) => {
          const active = option === role;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setRole(option)}
              data-testid={`role-switch-${option}`}
              className="flex-1 px-2 py-1 rounded text-[10px] font-medium transition-colors"
              style={{
                backgroundColor: active ? "rgba(156,255,147,0.12)" : "transparent",
                color: active ? "#9cff93" : "#767576",
                border: active
                  ? "1px solid rgba(156,255,147,0.35)"
                  : "1px solid rgba(72,72,73,0.2)",
                fontFamily: "Space Grotesk",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
