"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export function TopBar() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const env = process.env.NEXT_PUBLIC_GODSVIEW_ENV || "local";

  return (
    <header className="flex items-center justify-between border-b border-border bg-surface/80 px-6 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="rounded border border-border px-2 py-0.5 font-mono text-[11px] uppercase text-muted">
          env: {env}
        </span>
        <span className="text-sm text-foreground/80">
          Multi-agent trading intelligence
        </span>
      </div>
      <div className="flex items-center gap-4 text-sm">
        {user ? (
          <>
            <div className="text-right">
              <div className="text-foreground">{user.displayName}</div>
              <div className="text-xs text-muted">
                {user.roles.join(" · ") || "no roles"}
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                await signOut();
                router.push("/login");
              }}
              className="rounded border border-border px-2 py-1 text-xs text-foreground/80 hover:bg-surface"
            >
              Sign out
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}
