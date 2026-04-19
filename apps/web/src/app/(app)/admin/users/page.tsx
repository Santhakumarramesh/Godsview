"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@gv/ui";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type { AdminUser, CreateUserRequest, Role } from "@gv/types";

const ALL_ROLES: ReadonlyArray<Role> = ["admin", "operator", "viewer"];

export default function AdminUsersPage() {
  const qc = useQueryClient();
  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.users.list(),
  });

  const [draft, setDraft] = useState<CreateUserRequest>({
    email: "",
    displayName: "",
    password: "",
    roles: ["viewer"],
  });
  const [createError, setCreateError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (payload: CreateUserRequest) => api.users.create(payload),
    onSuccess: () => {
      setDraft({ email: "", displayName: "", password: "", roles: ["viewer"] });
      setCreateError(null);
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err) => setCreateError(pickErrorMessage(err)),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.users.deactivate(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  const columns: ReadonlyArray<DataTableColumn<AdminUser>> = [
    { key: "email", header: "Email", render: (u) => u.email },
    { key: "name", header: "Name", render: (u) => u.displayName },
    {
      key: "roles",
      header: "Roles",
      render: (u) => (
        <div className="flex flex-wrap gap-1">
          {u.roles.map((r) => (
            <Badge key={r} tone={r === "admin" ? "danger" : r === "operator" ? "info" : "neutral"}>
              {r}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "mfa",
      header: "MFA",
      render: (u) => <Badge tone={u.mfaEnabled ? "success" : "warn"}>{u.mfaEnabled ? "on" : "off"}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      render: (u) => <Badge tone={u.disabled ? "danger" : "success"}>{u.disabled ? "disabled" : "active"}</Badge>,
    },
    { key: "last", header: "Last login", render: (u) => formatDate(u.lastLoginAt) },
    {
      key: "actions",
      header: "",
      render: (u) =>
        u.disabled ? null : (
          <Button
            size="sm"
            variant="danger"
            loading={deactivateMutation.isPending && deactivateMutation.variables === u.id}
            onClick={() => deactivateMutation.mutate(u.id)}
          >
            Deactivate
          </Button>
        ),
    },
  ];

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateError(null);
    createMutation.mutate(draft);
  }

  function toggleRole(role: Role) {
    setDraft((d) => {
      const has = d.roles.includes(role);
      const next = has ? d.roles.filter((r) => r !== role) : [...d.roles, role];
      return { ...d, roles: next.length ? next : ["viewer"] };
    });
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Admin · Users"
        description="Invite, deactivate, and assign roles. Every change is audit-logged."
      />

      <DataTable
        rows={usersQuery.data?.users ?? []}
        columns={columns}
        loading={usersQuery.isLoading}
        error={usersQuery.error ? pickErrorMessage(usersQuery.error) : null}
        emptyMessage="No users yet"
        rowKey={(u) => u.id}
      />

      <Card>
        <CardHeader>
          <CardTitle>Invite a user</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="grid gap-3 md:grid-cols-2" onSubmit={submit}>
            <label className="text-xs font-medium text-slate-700">
              Email
              <input
                type="email"
                required
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Display name
              <input
                required
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.displayName}
                onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-700 md:col-span-2">
              Initial password (≥12 chars)
              <input
                type="password"
                minLength={12}
                required
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={draft.password}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
              />
            </label>
            <div className="md:col-span-2">
              <div className="text-xs font-medium text-slate-700">Roles</div>
              <div className="mt-1 flex gap-3">
                {ALL_ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={draft.roles.includes(r)}
                      onChange={() => toggleRole(r)}
                    />
                    {r}
                  </label>
                ))}
              </div>
            </div>
            {createError ? (
              <div className="md:col-span-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                {createError}
              </div>
            ) : null}
            <div className="md:col-span-2">
              <Button type="submit" loading={createMutation.isPending}>
                Invite user
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </section>
  );
}
