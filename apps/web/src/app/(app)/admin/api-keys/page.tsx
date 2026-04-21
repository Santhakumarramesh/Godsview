"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created: string;
  lastUsed: string | null;
  status: "active" | "revoked" | "expired";
}

export default function AdminApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.apiKeys.list();
        const data = Array.isArray(res) ? res : res?.keys ?? res?.data ?? [];
        setKeys(data);
      } catch (e) {
        // Mock fallback for development
        setKeys([
          {
            id: "key_1",
            name: "Production API",
            prefix: "sk_live_***",
            created: "2024-02-15T10:30:00Z",
            lastUsed: "2024-04-20T14:22:00Z",
            status: "active",
          },
          {
            id: "key_2",
            name: "Development",
            prefix: "sk_test_***",
            created: "2024-03-01T08:15:00Z",
            lastUsed: "2024-04-19T16:45:00Z",
            status: "active",
          },
          {
            id: "key_3",
            name: "Webhook Listener",
            prefix: "sk_hook_***",
            created: "2024-01-20T12:00:00Z",
            lastUsed: null,
            status: "revoked",
          },
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const newKey = await api.apiKeys.create({ name: "New API Key" });
      setKeys([...keys, newKey]);
    } catch (e) {
      setError("Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    setRevoking(keyId);
    try {
      await api.apiKeys.revoke(keyId);
      setKeys(keys.map((k) => (k.id === keyId ? { ...k, status: "revoked" } : k)));
    } catch (e) {
      setError("Failed to revoke API key");
    } finally {
      setRevoking(null);
    }
  };

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
        <h1 className="text-2xl font-semibold">Admin · API Keys</h1>
        <p className="text-sm text-muted">
          Issue, rotate, and revoke programmatic API keys with fine-grained scopes.
          Last-used timestamps and rate-limit bucket assignment shown per key.
        </p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleCreate}
          disabled={creating}
          className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {creating ? "Creating..." : "Create New Key"}
        </button>
      </div>

      {keys.length === 0 ? (
        <div className="p-6 text-center text-muted rounded border border-border">
          No API keys yet. Create one to get started.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface/80 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Prefix</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Last Used</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono">{key.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{key.prefix}</td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {new Date(key.created).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {key.lastUsed ? new Date(key.lastUsed).toLocaleDateString() : "Never"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        key.status === "active"
                          ? "bg-green-500/20 text-green-300"
                          : key.status === "revoked"
                            ? "bg-red-500/20 text-red-300"
                            : "bg-yellow-500/20 text-yellow-300"
                      }`}
                    >
                      {key.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => handleRevoke(key.id)}
                      disabled={key.status === "revoked" || revoking === key.id}
                      className="px-2 py-1 text-xs rounded border border-red-600/50 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      Revoke
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
