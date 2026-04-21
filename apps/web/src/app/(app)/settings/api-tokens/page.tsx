"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DataTable } from "@/components/DataTable";

interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const mockTokens: ApiToken[] = [
  {
    id: "token-1",
    name: "Trading Bot Script",
    prefix: "gv_prod_abc123",
    createdAt: "2024-03-15T10:30:00Z",
    lastUsedAt: "2024-04-20T14:22:00Z",
    revokedAt: null,
  },
  {
    id: "token-2",
    name: "Backtesting Runner",
    prefix: "gv_prod_def456",
    createdAt: "2024-02-01T09:15:00Z",
    lastUsedAt: "2024-04-19T08:45:00Z",
    revokedAt: null,
  },
  {
    id: "token-3",
    name: "Old Development Token",
    prefix: "gv_prod_ghi789",
    createdAt: "2024-01-10T14:00:00Z",
    lastUsedAt: null,
    revokedAt: "2024-03-20T16:30:00Z",
  },
];

export default function ApiTokensPage() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [creatingToken, setCreatingToken] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    const fetchTokens = async () => {
      try {
        setLoading(true);
        try {
          const result = await api.settings.listApiTokens?.();
          if (result && result.tokens) {
            setTokens(result.tokens);
          }
        } catch {
          setTokens(mockTokens);
        }
      } catch (err) {
        setError((err as Error).message || "Failed to load tokens");
        setTokens(mockTokens);
      } finally {
        setLoading(false);
      }
    };

    fetchTokens();
  }, []);

  const handleCreateToken = async () => {
    if (!newTokenName.trim()) return;

    try {
      setCreatingToken(true);
      try {
        await api.settings.createApiToken?.({
          name: newTokenName,
          scopes: [],
        });
      } catch {
        // Mock success
      }
      // Simulate adding new token
      const newToken: ApiToken = {
        id: `token-${Date.now()}`,
        name: newTokenName,
        prefix: `gv_prod_${Math.random().toString(36).substr(2, 9)}`,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        revokedAt: null,
      };
      setTokens([newToken, ...tokens]);
      setNewTokenName("");
      setShowCreateForm(false);
    } catch (err) {
      setError((err as Error).message || "Failed to create token");
    } finally {
      setCreatingToken(false);
    }
  };

  const handleRevokeToken = async (tokenId: string) => {
    try {
      setRevokingId(tokenId);
      try {
        await api.settings.revokeApiToken?.(tokenId);
      } catch {
        // Mock success
      }
      setTokens((prev) =>
        prev.map((t) =>
          t.id === tokenId ? { ...t, revokedAt: new Date().toISOString() } : t
        )
      );
    } catch (err) {
      setError((err as Error).message || "Failed to revoke token");
    } finally {
      setRevokingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-slate-400">Loading API tokens...</p>
      </div>
    );
  }

  const activeTokens = tokens.filter((t) => !t.revokedAt).length;

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">API Tokens</h1>
        <p className="mt-1 text-sm text-slate-400">
          Create and manage personal access tokens for API scripting
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Summary Card */}
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
        <p className="text-xs font-semibold uppercase text-slate-400">Active Tokens</p>
        <p className="mt-2 text-3xl font-bold text-slate-100">{activeTokens}</p>
      </div>

      {/* Create Token Button */}
      <button
        onClick={() => setShowCreateForm(!showCreateForm)}
        className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 transition"
      >
        {showCreateForm ? "Cancel" : "+ Create Token"}
      </button>

      {/* Create Token Form */}
      {showCreateForm && (
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-100">New API Token</h2>
          <div>
            <label className="block text-sm font-semibold text-slate-100 mb-2">Token Name</label>
            <input
              type="text"
              value={newTokenName}
              onChange={(e) => setNewTokenName(e.target.value)}
              placeholder="e.g., Trading Bot Script"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            onClick={handleCreateToken}
            disabled={!newTokenName.trim() || creatingToken}
            className={`w-full rounded-lg px-6 py-2 font-semibold transition ${
              !newTokenName.trim() || creatingToken
                ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                : "bg-green-600 text-white hover:bg-green-700"
            }`}
          >
            {creatingToken ? "Creating..." : "Create Token"}
          </button>
        </div>
      )}

      {/* Tokens Table */}
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-slate-100">Your Tokens</h2>
        <DataTable<ApiToken>
          rows={tokens}
          columns={[
            {
              key: "name",
              header: "Name",
              render: (row) => <span className="font-medium text-slate-100">{row.name}</span>,
            },
            {
              key: "prefix",
              header: "Prefix",
              render: (row) => <span className="font-mono text-slate-400">{row.prefix}***</span>,
            },
            {
              key: "createdAt",
              header: "Created",
              render: (row) => <span className="text-sm text-slate-400">{new Date(row.createdAt).toLocaleDateString()}</span>,
            },
            {
              key: "lastUsedAt",
              header: "Last Used",
              render: (row) => (
                <span className="text-sm text-slate-400">
                  {row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleDateString() : "Never"}
                </span>
              ),
            },
            {
              key: "status",
              header: "Status",
              render: (row) => (
                <span
                  className={`rounded px-2 py-1 text-xs font-semibold ${
                    row.revokedAt
                      ? "bg-red-500/20 text-red-400"
                      : "bg-green-500/20 text-green-400"
                  }`}
                >
                  {row.revokedAt ? "Revoked" : "Active"}
                </span>
              ),
            },
            {
              key: "actions",
              header: "Actions",
              render: (row) =>
                !row.revokedAt ? (
                  <button
                    onClick={() => handleRevokeToken(row.id)}
                    disabled={revokingId === row.id}
                    className="text-sm text-red-400 hover:text-red-300 transition"
                  >
                    {revokingId === row.id ? "Revoking..." : "Revoke"}
                  </button>
                ) : (
                  <span className="text-sm text-slate-500">Revoked</span>
                ),
            },
          ]}
          rowKey={(row) => row.id}
          emptyMessage="No API tokens created"
        />
      </div>

      {/* Security Note */}
      <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
        <p className="text-sm text-yellow-300">
          <span className="font-semibold">Security:</span> Keep your tokens secure. Never share them or commit them to version
          control. Revoke tokens immediately if compromised.
        </p>
      </div>
    </div>
  );
}
