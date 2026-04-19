"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@gv/ui";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { formatDate, pickErrorMessage } from "@/lib/format";

export default function SettingsProfilePage() {
  const qc = useQueryClient();
  const profileQuery = useQuery({
    queryKey: ["settings", "profile"],
    queryFn: () => api.settings.getProfile(),
  });

  const [displayName, setDisplayName] = useState("");
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileOk, setProfileOk] = useState<string | null>(null);

  useEffect(() => {
    if (profileQuery.data) {
      setDisplayName(profileQuery.data.displayName);
      setMfaEnabled(profileQuery.data.mfaEnabled);
    }
  }, [profileQuery.data]);

  const updateProfile = useMutation({
    mutationFn: () => api.settings.updateProfile({ displayName, mfaEnabled }),
    onSuccess: () => {
      setProfileError(null);
      setProfileOk("Profile saved");
      void qc.invalidateQueries({ queryKey: ["settings", "profile"] });
    },
    onError: (err) => {
      setProfileOk(null);
      setProfileError(pickErrorMessage(err));
    },
  });

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState<string | null>(null);

  const changePassword = useMutation({
    mutationFn: () => api.settings.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      setPwError(null);
      setPwOk("Password updated");
      setCurrentPassword("");
      setNewPassword("");
    },
    onError: (err) => {
      setPwOk(null);
      setPwError(pickErrorMessage(err));
    },
  });

  function submitProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProfileError(null);
    setProfileOk(null);
    updateProfile.mutate();
  }

  function submitPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPwError(null);
    setPwOk(null);
    changePassword.mutate();
  }

  const profile = profileQuery.data;

  return (
    <section className="space-y-6">
      <PageHeader title="Settings · Profile" description="Your identity and authentication." />

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardBody>
          {profileQuery.isLoading || !profile ? (
            <div className="text-sm text-slate-500">Loading…</div>
          ) : (
            <form className="grid gap-3 md:grid-cols-2" onSubmit={submitProfile}>
              <label className="text-xs font-medium text-slate-700">
                Email
                <input
                  disabled
                  className="mt-1 w-full rounded border border-slate-200 bg-slate-100 px-2 py-1 text-sm text-slate-500"
                  value={profile.email}
                />
              </label>
              <label className="text-xs font-medium text-slate-700">
                Display name
                <input
                  required
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </label>
              <div className="text-xs text-slate-700">
                Roles
                <div className="mt-1 flex flex-wrap gap-1">
                  {profile.roles.map((r) => (
                    <Badge key={r} tone={r === "admin" ? "danger" : r === "operator" ? "info" : "neutral"}>
                      {r}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="text-xs text-slate-700">
                Last login
                <div className="mt-1 text-slate-900">{formatDate(profile.lastLoginAt)}</div>
              </div>
              <label className="md:col-span-2 flex items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={mfaEnabled}
                  onChange={(e) => setMfaEnabled(e.target.checked)}
                />
                Multi-factor authentication enabled
              </label>
              {profileError ? (
                <div className="md:col-span-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                  {profileError}
                </div>
              ) : null}
              {profileOk ? (
                <div className="md:col-span-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
                  {profileOk}
                </div>
              ) : null}
              <div className="md:col-span-2">
                <Button type="submit" loading={updateProfile.isPending}>
                  Save profile
                </Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="grid gap-3 md:grid-cols-2" onSubmit={submitPassword}>
            <label className="text-xs font-medium text-slate-700 md:col-span-2">
              Current password
              <input
                type="password"
                required
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </label>
            <label className="text-xs font-medium text-slate-700 md:col-span-2">
              New password (≥12 chars)
              <input
                type="password"
                minLength={12}
                required
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>
            {pwError ? (
              <div className="md:col-span-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                {pwError}
              </div>
            ) : null}
            {pwOk ? (
              <div className="md:col-span-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
                {pwOk}
              </div>
            ) : null}
            <div className="md:col-span-2">
              <Button type="submit" loading={changePassword.isPending}>
                Update password
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </section>
  );
}
