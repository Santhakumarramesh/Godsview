"use client";

import { useState, useEffect } from "react";
import { TrendingUp, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";

interface ExposureBreakdown {
  symbol: string;
  sector: string;
  long: number;
  short: number;
  net: number;
}

interface ExposureData {
  totalLong: number;
  totalShort: number;
  netExposure: number;
  grossExposure: number;
  breakdown: ExposureBreakdown[];
}

const mockExposureData: ExposureData = {
  totalLong: 485000,
  totalShort: 245000,
  netExposure: 240000,
  grossExposure: 730000,
  breakdown: [
    { symbol: "AAPL", sector: "Technology", long: 125000, short: 0, net: 125000 },
    { symbol: "MSFT", sector: "Technology", long: 98000, short: 35000, net: 63000 },
    { symbol: "TSLA", sector: "Automotive", long: 87000, short: 0, net: 87000 },
    { symbol: "GLD", sector: "Commodities", long: 75000, short: 210000, net: -135000 },
    { symbol: "XLF", sector: "Financials", long: 100000, short: 0, net: 100000 },
  ],
};

export default function PortfolioExposurePage() {
  const [exposure, setExposure] = useState<ExposureData>(mockExposureData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchExposure = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.portfolio.getExposure?.();
        if (result) {
          setExposure(result);
        }
      } catch (err) {
        console.error("Error fetching exposure:", err);
        setError("Failed to fetch exposure data");
      } finally {
        setLoading(false);
      }
    };

    fetchExposure();
  }, []);

  const leverage = (exposure.grossExposure / (exposure.netExposure + 1)) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-8 h-8 text-green-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Portfolio Exposure</h1>
              <p className="text-slate-400 text-sm">Long/short position analysis and sector breakdown</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 flex items-center gap-2 text-red-300">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <p className="text-slate-400">Loading exposure data...</p>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
                <p className="text-slate-400 text-xs font-semibold uppercase mb-2">Total Long</p>
                <p className="text-3xl font-bold text-green-400">
                  ${(exposure.totalLong / 1000).toFixed(0)}K
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  {((exposure.totalLong / exposure.grossExposure) * 100).toFixed(1)}% of gross
                </p>
              </div>

              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
                <p className="text-slate-400 text-xs font-semibold uppercase mb-2">Total Short</p>
                <p className="text-3xl font-bold text-red-400">
                  ${(exposure.totalShort / 1000).toFixed(0)}K
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  {((exposure.totalShort / exposure.grossExposure) * 100).toFixed(1)}% of gross
                </p>
              </div>

              <div className="bg-blue-500/20 border border-blue-500/30 rounded-lg p-6">
                <p className="text-slate-400 text-xs font-semibold uppercase mb-2">Net Exposure</p>
                <p
                  className={`text-3xl font-bold ${
                    exposure.netExposure > 0 ? "text-blue-400" : "text-slate-400"
                  }`}
                >
                  ${Math.abs(exposure.netExposure / 1000).toFixed(0)}K
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  {exposure.netExposure > 0 ? "Long biased" : "Short biased"}
                </p>
              </div>

              <div className="bg-purple-500/20 border border-purple-500/30 rounded-lg p-6">
                <p className="text-slate-400 text-xs font-semibold uppercase mb-2">Leverage</p>
                <p className="text-3xl font-bold text-purple-400">
                  {leverage.toFixed(1)}x
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  Gross / Net ratio
                </p>
              </div>
            </div>

            {/* Position Breakdown Table */}
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Position Breakdown</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-700">
                    <tr className="text-slate-400 text-xs uppercase font-semibold">
                      <th className="text-left py-3 px-4">Symbol</th>
                      <th className="text-left py-3 px-4">Sector</th>
                      <th className="text-right py-3 px-4">Long</th>
                      <th className="text-right py-3 px-4">Short</th>
                      <th className="text-right py-3 px-4">Net</th>
                      <th className="text-center py-3 px-4">Contribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exposure.breakdown.map((pos) => (
                      <tr
                        key={pos.symbol}
                        className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors"
                      >
                        <td className="py-3 px-4 font-semibold text-white">
                          {pos.symbol}
                        </td>
                        <td className="py-3 px-4 text-slate-400">{pos.sector}</td>
                        <td className="py-3 px-4 text-right font-semibold text-green-400">
                          ${(pos.long / 1000).toFixed(0)}K
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-red-400">
                          ${(pos.short / 1000).toFixed(0)}K
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-semibold ${
                            pos.net > 0 ? "text-blue-400" : "text-slate-400"
                          }`}
                        >
                          ${(pos.net / 1000).toFixed(0)}K
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-20 h-2 bg-slate-700 rounded">
                              <div
                                className={`h-2 rounded ${
                                  pos.net > 0
                                    ? "bg-gradient-to-r from-green-500 to-green-400"
                                    : "bg-gradient-to-r from-red-500 to-red-400"
                                }`}
                                style={{
                                  width: `${Math.abs(
                                    (pos.net / exposure.netExposure) * 100
                                  )}%`,
                                }}
                              />
                            </div>
                            <span className="text-xs text-slate-400 w-10 text-right">
                              {(
                                (Math.abs(pos.net) / exposure.grossExposure) *
                                100
                              ).toFixed(1)}
                              %
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Sector Exposure */}
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Sector Exposure</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {Array.from(
                  new Set(exposure.breakdown.map((b) => b.sector))
                ).map((sector) => {
                  const sectorItems = exposure.breakdown.filter((b) => b.sector === sector);
                  const sectorLong = sectorItems.reduce((sum, item) => sum + item.long, 0);
                  const sectorShort = sectorItems.reduce((sum, item) => sum + item.short, 0);
                  const sectorNet = sectorLong - sectorShort;

                  return (
                    <div
                      key={sector}
                      className="bg-slate-800/50 rounded-lg p-4 border border-slate-700"
                    >
                      <h3 className="text-sm font-semibold text-white mb-3">
                        {sector}
                      </h3>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Long</span>
                          <span className="text-green-400 font-semibold">
                            ${(sectorLong / 1000).toFixed(0)}K
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Short</span>
                          <span className="text-red-400 font-semibold">
                            ${(sectorShort / 1000).toFixed(0)}K
                          </span>
                        </div>
                        <div className="flex justify-between text-sm pt-2 border-t border-slate-600">
                          <span className="text-slate-400">Net</span>
                          <span
                            className={`font-semibold ${
                              sectorNet > 0
                                ? "text-blue-400"
                                : "text-slate-400"
                            }`}
                          >
                            ${(sectorNet / 1000).toFixed(0)}K
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
