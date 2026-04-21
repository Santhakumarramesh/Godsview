"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface ScreenshotCard {
  id: string;
  symbol: string;
  timestamp: string;
  tags: string[];
  thumbnail: string;
}

const mockScreenshots: ScreenshotCard[] = [
  {
    id: "1",
    symbol: "AAPL",
    timestamp: "2024-04-20 14:30:00",
    tags: ["mean-reversion", "support"],
    thumbnail: "📈",
  },
  {
    id: "2",
    symbol: "MSFT",
    timestamp: "2024-04-20 10:15:00",
    tags: ["momentum", "breakout"],
    thumbnail: "📊",
  },
  {
    id: "3",
    symbol: "TSLA",
    timestamp: "2024-04-19 16:45:00",
    tags: ["volatility", "divergence"],
    thumbnail: "📉",
  },
  {
    id: "4",
    symbol: "NVDA",
    timestamp: "2024-04-19 11:20:00",
    tags: ["trend-following", "support"],
    thumbnail: "📈",
  },
];

export default function ScreenhotsPage() {
  const [screenshots, setScreenshots] = useState<ScreenshotCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => {
    const fetchScreenshots = async () => {
      try {
        setLoading(true);
        try {
          await api.memory.getRecentSignals?.();
        } catch {
          // Fallback
        }
        setScreenshots(mockScreenshots);
      } catch (err) {
        setError((err as Error).message || "Failed to load screenshots");
        setScreenshots(mockScreenshots);
      } finally {
        setLoading(false);
      }
    };

    fetchScreenshots();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-slate-400">Loading screenshots...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
        {error}
      </div>
    );
  }

  const allTags = Array.from(
    new Set(screenshots.flatMap((s) => s.tags))
  );
  const filteredScreenshots = selectedTags.length
    ? screenshots.filter((s) => selectedTags.some((tag) => s.tags.includes(tag)))
    : screenshots;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Screenshot Vault</h1>
        <p className="mt-1 text-sm text-slate-400">
          Chart screenshots tagged by trading pattern and setup
        </p>
      </header>

      {/* Tag Filter */}
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
        <h2 className="mb-4 text-sm font-semibold text-slate-100">Filter by Tag</h2>
        <div className="flex flex-wrap gap-2">
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() =>
                setSelectedTags(
                  selectedTags.includes(tag)
                    ? selectedTags.filter((t) => t !== tag)
                    : [...selectedTags, tag]
                )
              }
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                selectedTags.includes(tag)
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {tag}
            </button>
          ))}
          {selectedTags.length > 0 && (
            <button
              onClick={() => setSelectedTags([])}
              className="rounded-full px-4 py-2 text-sm font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Upload Area */}
      <div className="rounded-lg border-2 border-dashed border-slate-600 bg-slate-800/50 p-8 text-center hover:border-slate-500 transition">
        <p className="text-slate-400 mb-2">Drop chart screenshots here to add to vault</p>
        <p className="text-sm text-slate-500">Or click to browse</p>
      </div>

      {/* Screenshot Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredScreenshots.map((screenshot) => (
          <div
            key={screenshot.id}
            className="rounded-lg border border-slate-700 bg-slate-900 overflow-hidden hover:border-slate-600 transition cursor-pointer group"
          >
            {/* Thumbnail */}
            <div className="bg-slate-800 aspect-square flex items-center justify-center text-6xl group-hover:bg-slate-700 transition">
              {screenshot.thumbnail}
            </div>

            {/* Card Info */}
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-100">{screenshot.symbol}</h3>
              </div>
              <p className="text-xs text-slate-400">{screenshot.timestamp}</p>

              {/* Tags */}
              <div className="flex flex-wrap gap-2">
                {screenshot.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredScreenshots.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-600 bg-slate-800/50 p-8 text-center">
          <p className="text-slate-400">No screenshots match the selected filters</p>
        </div>
      )}
    </div>
  );
}
