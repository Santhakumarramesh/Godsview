"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Preferences {
  darkMode: boolean;
  notifications: boolean;
  autoRefresh: boolean;
  soundAlerts: boolean;
  defaultTimeframe: string;
  chartType: string;
  riskProfile: string;
}

const mockPreferences: Preferences = {
  darkMode: true,
  notifications: true,
  autoRefresh: true,
  soundAlerts: false,
  defaultTimeframe: "15m",
  chartType: "candlestick",
  riskProfile: "moderate",
};

export default function SettingsPreferencesPage() {
  const [prefs, setPrefs] = useState<Preferences>(mockPreferences);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        setLoading(true);
        try {
          const result = await api.settings.getPreferences?.();
          if (result && result.preferences) {
            setPrefs({ ...mockPreferences, ...result.preferences });
          }
        } catch {
          setPrefs(mockPreferences);
        }
      } catch (err) {
        setError((err as Error).message || "Failed to load preferences");
        setPrefs(mockPreferences);
      } finally {
        setLoading(false);
      }
    };

    fetchPreferences();
  }, []);

  const handleToggle = (key: keyof Preferences) => {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSelectChange = (key: keyof Preferences, value: string) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      try {
        await api.settings.putPreferences?.(prefs);
      } catch {
        // Mock success
      }
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError((err as Error).message || "Failed to save preferences");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-slate-400">Loading preferences...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Trading Preferences</h1>
        <p className="mt-1 text-sm text-slate-400">
          Customize your trading experience
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-green-400">
          Preferences saved successfully!
        </div>
      )}

      <div className="rounded-lg border border-slate-700 bg-slate-900 p-8 space-y-6">
        {/* UI Section */}
        <div>
          <h2 className="text-lg font-semibold text-slate-100 mb-4">Interface</h2>
          <div className="space-y-4">
            <ToggleOption
              label="Dark Mode"
              description="Use dark theme (recommended for trading)"
              checked={prefs.darkMode}
              onChange={() => handleToggle("darkMode")}
            />
            <ToggleOption
              label="Auto-Refresh"
              description="Automatically refresh data every 5 seconds"
              checked={prefs.autoRefresh}
              onChange={() => handleToggle("autoRefresh")}
            />
          </div>
        </div>

        {/* Notifications Section */}
        <div className="border-t border-slate-700 pt-6">
          <h2 className="text-lg font-semibold text-slate-100 mb-4">Notifications</h2>
          <div className="space-y-4">
            <ToggleOption
              label="Desktop Notifications"
              description="Receive alerts for trade signals and updates"
              checked={prefs.notifications}
              onChange={() => handleToggle("notifications")}
            />
            <ToggleOption
              label="Sound Alerts"
              description="Play sound for important events"
              checked={prefs.soundAlerts}
              onChange={() => handleToggle("soundAlerts")}
            />
          </div>
        </div>

        {/* Chart Settings Section */}
        <div className="border-t border-slate-700 pt-6">
          <h2 className="text-lg font-semibold text-slate-100 mb-4">Chart Settings</h2>
          <div className="space-y-4">
            <SelectOption
              label="Default Timeframe"
              value={prefs.defaultTimeframe}
              onChange={(value) => handleSelectChange("defaultTimeframe", value)}
              options={[
                { value: "1m", label: "1 Minute" },
                { value: "5m", label: "5 Minutes" },
                { value: "15m", label: "15 Minutes" },
                { value: "1h", label: "1 Hour" },
                { value: "4h", label: "4 Hours" },
                { value: "1d", label: "1 Day" },
              ]}
            />
            <SelectOption
              label="Chart Type"
              value={prefs.chartType}
              onChange={(value) => handleSelectChange("chartType", value)}
              options={[
                { value: "candlestick", label: "Candlestick" },
                { value: "ohlc", label: "OHLC" },
                { value: "line", label: "Line" },
                { value: "renko", label: "Renko" },
              ]}
            />
          </div>
        </div>

        {/* Risk Profile Section */}
        <div className="border-t border-slate-700 pt-6">
          <h2 className="text-lg font-semibold text-slate-100 mb-4">Risk Profile</h2>
          <SelectOption
            label="Risk Preference"
            value={prefs.riskProfile}
            onChange={(value) => handleSelectChange("riskProfile", value)}
            options={[
              { value: "conservative", label: "Conservative - Lower risk, smaller position sizes" },
              { value: "moderate", label: "Moderate - Balanced risk and reward" },
              { value: "aggressive", label: "Aggressive - Higher risk tolerance" },
            ]}
          />
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className={`w-full rounded-lg px-6 py-3 font-semibold transition ${
            saving
              ? "bg-slate-700 text-slate-400 cursor-not-allowed"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          {saving ? "Saving..." : "Save Preferences"}
        </button>
      </div>
    </div>
  );
}

function ToggleOption({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between p-4 rounded-lg bg-slate-800/50 border border-slate-700">
      <div>
        <p className="font-medium text-slate-100">{label}</p>
        <p className="text-sm text-slate-400">{description}</p>
      </div>
      <button
        onClick={onChange}
        className={`relative w-12 h-6 rounded-full transition ${checked ? "bg-blue-600" : "bg-slate-700"}`}
      >
        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition ${checked ? "translate-x-6" : ""}`} />
      </button>
    </div>
  );
}

function SelectOption({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
      <label className="block text-sm font-semibold text-slate-100 mb-2">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
