"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { pickErrorMessage } from "@/lib/format";

interface RoleSummary {
  role: "admin" | "operator" | "viewer";
  description: string;
  capabilities: ReadonlyArray<string>;
  tone: "danger" | "info" | "neutral";
}

const ROLE_MATRIX: ReadonlyArray<RoleSummary> = [
  {
    role: "admin",
    description: "Full control plane authority. Can manage users, keys, webhooks, MCP, and system config.",
    tone: "danger",
    capabilities: [
      "Manage users + roles",
      "Mint and revoke API keys",
      "Register and rotate webhooks",
      "Edit feature flags + system config",
      "All operator + viewer capabilities",
    ],
  },
  {
    role: "operator",
    description: "Operational authority. Acts on alerts, incidents, deployments — read-only on identity.",
    tone: "info",
    capabilities: [
      "Acknowledge + resolve alerts",
      "Open + transition incidents",
      "Record deployments",
      "Read user + key roster",
    ],
  },
  {
    role: "viewer",
    description: "Read-only audit access. Cannot mutate anything.",
    tone: "neutral",
    capabilities: ["List ops state", "Read audit events", "Read self profile + preferences"],
  },
];

export default function AdminRolesPage() {
  const usersQuery = useQuery({
    queryKey: ["admin", "users", "for-roles"],
    queryFn: () => api.users.list(),
  });

  const counts = usersQuery.data?.users.reduce(
    (acc, u) => {
      for (const r of u.roles) acc[r as keyof typeof acc] = (acc[r as keyof typeof acc] ?? 0) + 1;
      return acc;
    },
    { admin: 0, operator: 0, viewer: 0 } as Record<"admin" | "operator" | "viewer", number>,
  );

  return (
    <section className="space-y-6">
      <PageHeader
        title="Admin · Roles"
        description="The three-role authorization model. Role assignment lives on the Users page."
      />

      <div className="grid gap-4 md:grid-cols-3">
        {ROLE_MATRIX.map((entry) => (
          <Card key={entry.role}>
            <CardHeader className="flex items-center justify-between gap-2">
              <CardTitle className="capitalize">{entry.role}</CardTitle>
              <Badge tone={entry.tone}>
                {usersQuery.isLoading ? "…" : (counts?.[entry.role] ?? 0)} users
              </Badge>
            </CardHeader>
            <CardBody>
              <p className="text-sm text-slate-700">{entry.description}</p>
              <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-slate-600">
                {entry.capabilities.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>

      {usersQuery.error ? (
        <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          Could not load user counts: {pickErrorMessage(usersQuery.error)}
        </div>
      ) : null}
    </section>
  );
}
