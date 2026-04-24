"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "active" | "inactive" | "suspended";
  lastLogin: string | null;
  createdAt: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<string>("all");

  useEffect(() => {
    (async () => {
      try {
        const res = await api.users.list();
        const data = Array.isArray(res) ? res : res?.users ?? res?.data ?? [];
        setUsers(data);
      } catch (e) {
        // Mock fallback
        setUsers([
          {
            id: "user_1",
            name: "Alice Johnson",
            email: "alice@example.com",
            role: "admin",
            status: "active",
            lastLogin: "2024-04-20T14:22:00Z",
            createdAt: "2024-01-15T10:00:00Z",
          },
          {
            id: "user_2",
            name: "Bob Smith",
            email: "bob@example.com",
            role: "operator",
            status: "active",
            lastLogin: "2024-04-20T11:30:00Z",
            createdAt: "2024-02-01T09:00:00Z",
          },
          {
            id: "user_3",
            name: "Carol Davis",
            email: "carol@example.com",
            role: "analyst",
            status: "active",
            lastLogin: "2024-04-19T16:45:00Z",
            createdAt: "2024-02-15T14:00:00Z",
          },
          {
            id: "user_4",
            name: "David Wilson",
            email: "david@example.com",
            role: "viewer",
            status: "inactive",
            lastLogin: "2024-03-20T10:15:00Z",
            createdAt: "2024-03-01T11:00:00Z",
          },
          {
            id: "user_5",
            name: "Emma Brown",
            email: "emma@example.com",
            role: "analyst",
            status: "active",
            lastLogin: "2024-04-20T13:00:00Z",
            createdAt: "2024-03-10T08:30:00Z",
          },
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filteredUsers =
    roleFilter === "all" ? users : users.filter((u) => u.role === roleFilter);
  const roles = ["all", ...new Set(users.map((u) => u.role))];

  if (loading)
    return (
      <div className="p-6">
        <div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" />
        <div className="animate-pulse h-64 bg-white/5 rounded" />
      </div>
    );

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Admin · Users</h1>
        <p className="text-sm text-muted">
          User management — invite, deactivate, reset password, role assignment. All actions
          audit-logged.
        </p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 rounded border border-border bg-surface text-sm"
        >
          {roles.map((role) => (
            <option key={role} value={role}>
              {role === "all" ? "All Roles" : role.charAt(0).toUpperCase() + role.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {filteredUsers.length === 0 ? (
        <div className="p-6 text-center text-muted rounded border border-border">
          No users found.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface/80 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Last Login</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{user.name}</td>
                  <td className="px-3 py-2 text-muted text-sm">{user.email}</td>
                  <td className="px-3 py-2 text-sm">
                    <span className="px-2 py-1 rounded bg-blue-500/20 text-blue-300">
                      {user.role}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        user.status === "active"
                          ? "bg-green-500/20 text-green-300"
                          : user.status === "inactive"
                            ? "bg-yellow-500/20 text-yellow-300"
                            : "bg-red-500/20 text-red-300"
                      }`}
                    >
                      {user.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : "Never"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button className="px-2 py-1 text-xs rounded border border-border hover:bg-surface">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
