"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@gv/ui";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { formatDate, pickErrorMessage } from "@/lib/format";

export default function SettingsPreferencesPage() {
  const qc = useQueryClient();
  const prefQuery = useQuery({
    queryKey: ["settings", "preferences"],
    queryFn: () => api.settings.getPreferences(),
  });

  const [text, setText] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    if (prefQuery.data) {
      setText(JSON.stringify(prefQuery.data.preferences, null, 2));
    }
  }, [prefQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (preferences: Record<string, unknown>) => api.settings.putPreferences(preferences),
    onSuccess: () => {
      setError(null);
      setOk("Preferences saved");
      void qc.invalidateQueries({ queryKey: ["settings", "preferences"] });
    },
    onError: (err) => {
      setOk(null);
      setError(pickErrorMessage(err));
    },
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOk(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setError(`Invalid JSON: ${pickErrorMessage(err)}`);
      return;
    }
    if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
      setError("Preferences must be a JSON object.");
      return;
    }
    saveMutation.mutate(parsed);
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Settings · Preferences"
        description="A free-form per-user JSON object. Hard cap is 32 KiB. Values are scoped to your account."
      />

      <Card>
        <CardHeader>
          <CardTitle>Preferences JSON</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="grid gap-3" onSubmit={submit}>
            <textarea
              className="font-mono text-xs h-72 w-full rounded border border-slate-300 px-3 py-2"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
            />
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Last saved: {formatDate(prefQuery.data?.updatedAt)}</span>
              <span>{new Blob([text]).size} bytes</span>
            </div>
            {error ? (
              <div className="rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                {error}
              </div>
            ) : null}
            {ok ? (
              <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
                {ok}
              </div>
            ) : null}
            <div>
              <Button type="submit" loading={saveMutation.isPending}>
                Save preferences
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </section>
  );
}
