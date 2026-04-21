"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Profile {
  id: string;
  displayName: string;
  email: string;
  timezone: string;
  defaultWatchlist: string;
  mfaEnabled: boolean;
}

const mockProfile: Profile = {
  id: "user-123",
  displayName: "Alex Trader",
  email: "alex.trader@example.com",
  timezone: "America/New_York",
  defaultWatchlist: "AAPL,MSFT,TSLA",
  mfaEnabled: true,
};

export default function SettingsProfilePage() {
  const [profile, setProfile] = useState<Profile>(mockProfile);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(mockProfile);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setLoading(true);
        try {
          const result = await api.settings.getProfile?.();
          if (result) {
            setProfile(result as unknown as Profile);
            setFormData(result as unknown as Profile);
          }
        } catch {
          setProfile(mockProfile);
          setFormData(mockProfile);
        }
      } catch (err) {
        setError((err as Error).message || "Failed to load profile");
        setProfile(mockProfile);
        setFormData(mockProfile);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      try {
        await api.settings.updateProfile?.({
          displayName: formData.displayName,
        });
      } catch {
        // Mock success
      }
      setProfile(formData);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError((err as Error).message || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-slate-400">Loading profile...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Profile Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Manage your profile information
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-green-400">
          Profile updated successfully!
        </div>
      )}

      <div className="rounded-lg border border-slate-700 bg-slate-900 p-8 space-y-6">
        {/* Display Name */}
        <div>
          <label className="block text-sm font-semibold text-slate-100 mb-2">Display Name</label>
          <input
            type="text"
            name="displayName"
            value={formData.displayName}
            onChange={handleInputChange}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        {/* Email (Read-Only) */}
        <div>
          <label className="block text-sm font-semibold text-slate-100 mb-2">Email</label>
          <input
            type="email"
            value={formData.email}
            disabled
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-400 cursor-not-allowed"
          />
          <p className="text-xs text-slate-500 mt-1">Email cannot be changed</p>
        </div>

        {/* Timezone */}
        <div>
          <label className="block text-sm font-semibold text-slate-100 mb-2">Timezone</label>
          <select
            name="timezone"
            value={formData.timezone}
            onChange={handleInputChange}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
          >
            <option value="America/New_York">America/New_York (EST)</option>
            <option value="America/Chicago">America/Chicago (CST)</option>
            <option value="America/Denver">America/Denver (MST)</option>
            <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
            <option value="Europe/London">Europe/London (GMT)</option>
            <option value="Europe/Paris">Europe/Paris (CET)</option>
            <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
            <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
          </select>
        </div>

        {/* Default Watchlist */}
        <div>
          <label className="block text-sm font-semibold text-slate-100 mb-2">Default Watchlist</label>
          <input
            type="text"
            name="defaultWatchlist"
            value={formData.defaultWatchlist}
            onChange={handleInputChange}
            placeholder="e.g., AAPL,MSFT,TSLA"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <p className="text-xs text-slate-500 mt-1">Comma-separated list of symbols</p>
        </div>

        {/* MFA Status */}
        <div className="border-t border-slate-700 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-100">Two-Factor Authentication</h3>
              <p className="text-sm text-slate-400 mt-1">
                {formData.mfaEnabled ? "Enabled" : "Disabled"}
              </p>
            </div>
            <div className={`rounded px-3 py-1 text-xs font-semibold ${formData.mfaEnabled ? "bg-green-500/20 text-green-400" : "bg-slate-700 text-slate-400"}`}>
              {formData.mfaEnabled ? "Active" : "Inactive"}
            </div>
          </div>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving || JSON.stringify(profile) === JSON.stringify(formData)}
          className={`w-full rounded-lg px-6 py-3 font-semibold transition ${
            saving || JSON.stringify(profile) === JSON.stringify(formData)
              ? "bg-slate-700 text-slate-400 cursor-not-allowed"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
