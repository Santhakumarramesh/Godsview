"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  userCount: number;
}

const PERMISSION_MATRIX = {
  viewer: ["read:portfolio", "read:audit", "read:market"],
  analyst: ["read:portfolio", "read:audit", "read:market", "read:strategies", "run:backtest"],
  operator: [
    "read:portfolio",
    "read:audit",
    "read:market",
    "read:strategies",
    "run:backtest",
    "execute:trade",
    "write:webhook",
  ],
  admin: [
    "read:*",
    "write:*",
    "execute:trade",
    "manage:users",
    "manage:roles",
    "manage:apikeys",
  ],
};

export default function AdminRolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.users.listRoles();
        const data = Array.isArray(res) ? res : res?.roles ?? res?.data ?? [];
        setRoles(data);
      } catch (e) {
        // Mock fallback
        setRoles([
          {
            id: "role_viewer",
            name: "Viewer",
            description: "Read-only access to portfolio and market data",
            permissions: PERMISSION_MATRIX.viewer,
            userCount: 12,
          },
          {
            id: "role_analyst",
            name: "Analyst",
            description: "Backtest strategies and analyze market data",
            permissions: PERMISSION_MATRIX.analyst,
            userCount: 8,
          },
          {
            id: "role_operator",
            name: "Operator",
            description: "Execute trades and manage webhooks",
            permissions: PERMISSION_MATRIX.operator,
            userCount: 3,
          },
          {
            id: "role_admin",
            name: "Admin",
            description: "Full system access and user management",
            permissions: PERMISSION_MATRIX.admin,
            userCount: 2,
          },
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading)
    return (
      <div className="p-6">
        <div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" />
        <div className="animate-pulse h-64 bg-white/5 rounded" />
      </div>
    );

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Admin · Roles</h1>
        <p className="text-sm text-muted">
          Role definitions and the permissions matrix they grant across the control plane.
        </p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {roles.map((role) => (
          <div
            key={role.id}
            className="p-4 border border-border rounded-lg bg-surface/40"
          >
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-semibold">{role.name}</h3>
              <span className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-300">
                {role.userCount} users
              </span>
            </div>
            <p className="text-sm text-muted mb-3">{role.description}</p>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted">Permissions:</p>
              <div className="flex flex-wrap gap-1">
                {role.permissions.slice(0, 5).map((perm, idx) => (
                  <span
                    key={idx}
                    className="text-xs px-2 py-1 rounded bg-green-500/20 text-green-300"
                  >
                    {perm}
                  </span>
                ))}
                {role.permissions.length > 5 && (
                  <span className="text-xs px-2 py-1 rounded text-muted">
                    +{role.permissions.length - 5} more
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <h2 className="text-xl font-semibold mb-4">Permission Matrix</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface/80 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Permission</th>
                <th className="px-3 py-2 font-medium text-center">Viewer</th>
                <th className="px-3 py-2 font-medium text-center">Analyst</th>
                <th className="px-3 py-2 font-medium text-center">Operator</th>
                <th className="px-3 py-2 font-medium text-center">Admin</th>
              </tr>
            </thead>
            <tbody>
              {[
                "read:portfolio",
                "read:audit",
                "read:market",
                "read:strategies",
                "run:backtest",
                "execute:trade",
                "write:webhook",
                "manage:users",
              ].map((perm) => (
                <tr key={perm} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{perm}</td>
                  <td className="px-3 py-2 text-center">
                    {PERMISSION_MATRIX.viewer.includes(perm) && (
                      <span className="text-green-400">✓</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {PERMISSION_MATRIX.analyst.includes(perm) && (
                      <span className="text-green-400">✓</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {PERMISSION_MATRIX.operator.includes(perm) && (
                      <span className="text-green-400">✓</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {PERMISSION_MATRIX.admin.includes(perm) && (
                      <span className="text-green-400">✓</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
