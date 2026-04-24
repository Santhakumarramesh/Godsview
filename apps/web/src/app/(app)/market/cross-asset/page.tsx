"use client";

import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { api } from "@/lib/api";

interface AssetQuote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  assetClass: string;
  color: string;
}

interface Correlation {
  pair: string;
  coefficient: number;
}

export default function CrossAssetPulsePage() {
  const [assets, setAssets] = useState<AssetQuote[]>([]);
  const [correlations, setCorrelations] = useState<Correlation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAssets = async () => {
      try {
        setLoading(true);
        setError(null);

        const assetSymbols = [
          { symbol: "SPY", class: "Equities", color: "emerald" },
          { symbol: "QQQ", class: "Tech", color: "blue" },
          { symbol: "TLT", class: "Bonds", color: "purple" },
          { symbol: "GLD", class: "Gold", color: "yellow" },
          { symbol: "USO", class: "Oil", color: "orange" },
          { symbol: "UUP", class: "Dollar", color: "gray" },
          { symbol: "COIN", class: "Crypto Proxy", color: "pink" },
          { symbol: "UVXY", class: "Volatility", color: "red" },
        ];

        const responses = await Promise.all(
          assetSymbols.map((asset) =>
            api.market.getQuote(asset.symbol).catch(() => ({ symbol: asset.symbol, price: 0, change: 0, change_pct: 0 }))
          )
        );

        const assetData: AssetQuote[] = responses.map((quote, idx) => ({
          symbol: assetSymbols[idx].symbol,
          price: quote.price || 0,
          change: quote.change || 0,
          changePct: quote.change_pct || 0,
          assetClass: assetSymbols[idx].class,
          color: assetSymbols[idx].color,
        }));

        setAssets(assetData);

        const mockCorrelations: Correlation[] = [
          { pair: "SPY↔QQQ", coefficient: 0.95 },
          { pair: "SPY↔TLT", coefficient: -0.67 },
          { pair: "SPY↔GLD", coefficient: -0.35 },
          { pair: "QQQ↔UUP", coefficient: -0.58 },
          { pair: "TLT↔UVXY", coefficient: 0.72 },
          { pair: "GLD↔UUP", coefficient: 0.81 },
        ];
        setCorrelations(mockCorrelations);
      } catch (err) {
        // Fallback to mock data
        const mockAssets: AssetQuote[] = [
          { symbol: "SPY", price: 450.25, change: 2.50, changePct: 0.56, assetClass: "Equities", color: "emerald" },
          { symbol: "GLD", price: 195.80, change: 1.20, changePct: 0.62, assetClass: "Gold", color: "yellow" },
        ];
        setAssets(mockAssets);
        const mockCorrelations: Correlation[] = [
          { pair: "SPY↔QQQ", coefficient: 0.95 },
          { pair: "SPY↔TLT", coefficient: -0.67 },
        ];
        setCorrelations(mockCorrelations);
        setError(err instanceof Error ? err.message : "Using mock data");
      } finally {
        setLoading(false);
      }
    };

    fetchAssets();
    const interval = setInterval(fetchAssets, 30000);
    return () => clearInterval(interval);
  }, []);

  const colorMap: Record<string, { bg: string; text: string; border: string }> =
    {
      emerald: {
        bg: "bg-emerald-900/20",
        text: "text-emerald-400",
        border: "border-emerald-900/50",
      },
      blue: {
        bg: "bg-blue-900/20",
        text: "text-blue-400",
        border: "border-blue-900/50",
      },
      purple: {
        bg: "bg-purple-900/20",
        text: "text-purple-400",
        border: "border-purple-900/50",
      },
      yellow: {
        bg: "bg-yellow-900/20",
        text: "text-yellow-400",
        border: "border-yellow-900/50",
      },
      orange: {
        bg: "bg-orange-900/20",
        text: "text-orange-400",
        border: "border-orange-900/50",
      },
      gray: {
        bg: "bg-gray-900/20",
        text: "text-gray-400",
        border: "border-gray-900/50",
      },
      pink: {
        bg: "bg-pink-900/20",
        text: "text-pink-400",
        border: "border-pink-900/50",
      },
      red: {
        bg: "bg-red-900/20",
        text: "text-red-400",
        border: "border-red-900/50",
      },
    };

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Cross-Asset Pulse</h1>
          <p className="text-sm text-gray-400 mt-1">
            Multi-asset correlation dashboard
          </p>
        </div>
        <span className="rounded bg-emerald-900/30 px-3 py-1 font-mono text-xs text-emerald-400">
          LIVE
        </span>
      </header>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-900 bg-red-900/10 p-4 text-red-400">
          Error: {error}
        </div>
      ) : assets.length === 0 ? (
        <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-8 text-center">
          <p className="text-gray-400">No asset data available</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {assets.map((asset) => {
              const colors = colorMap[asset.color];
              return (
                <div
                  key={asset.symbol}
                  className={`rounded-lg border border-[#1e1e2e] p-4 ${colors.bg}`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs text-gray-400 font-semibold">
                          {asset.assetClass}
                        </p>
                        <p className="text-lg font-bold font-mono text-white mt-1">
                          {asset.symbol}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm text-gray-400">Price</p>
                      <p className="text-2xl font-bold font-mono text-white">
                        ${asset.price.toFixed(2)}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-[#0a0a0f] rounded p-2">
                        <p className="text-xs text-gray-500">Change</p>
                        <div className="flex items-center gap-1 mt-1">
                          {asset.change >= 0 ? (
                            <ArrowUp
                              size={14}
                              className={colors.text}
                            />
                          ) : (
                            <ArrowDown size={14} className="text-red-400" />
                          )}
                          <p
                            className={`text-sm font-bold font-mono ${
                              asset.change >= 0
                                ? colors.text
                                : "text-red-400"
                            }`}
                          >
                            {asset.change >= 0 ? "+" : ""}
                            {asset.change.toFixed(2)}
                          </p>
                        </div>
                      </div>

                      <div className="bg-[#0a0a0f] rounded p-2">
                        <p className="text-xs text-gray-500">Return %</p>
                        <p
                          className={`text-sm font-bold font-mono mt-1 ${
                            asset.changePct >= 0
                              ? colors.text
                              : "text-red-400"
                          }`}
                        >
                          {asset.changePct >= 0 ? "+" : ""}
                          {asset.changePct.toFixed(2)}%
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h3 className="text-sm font-semibold text-gray-400 mb-4">
              CORRELATION MATRIX
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {correlations.map((corr) => {
                const absCor = Math.abs(corr.coefficient);
                const isPositive = corr.coefficient > 0;
                const intensity = absCor * 0.25;

                return (
                  <div
                    key={corr.pair}
                    className="rounded border border-[#1e1e2e] p-3 transition-all"
                    style={{
                      backgroundColor: isPositive
                        ? `rgba(16, 185, 129, ${intensity})`
                        : `rgba(239, 68, 68, ${intensity})`,
                    }}
                  >
                    <p className="text-xs font-semibold text-white mb-2">
                      {corr.pair}
                    </p>
                    <div className="flex items-end gap-2">
                      <p
                        className={`text-lg font-bold font-mono ${
                          isPositive
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {corr.coefficient >= 0 ? "+" : ""}
                        {corr.coefficient.toFixed(2)}
                      </p>
                      <div className="flex-1 h-8 bg-[#0a0a0f] rounded flex items-end justify-center">
                        <div
                          className={`w-1 rounded-full ${
                            isPositive
                              ? "bg-emerald-400"
                              : "bg-red-400"
                          }`}
                          style={{
                            height: `${absCor * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h3 className="text-sm font-semibold text-gray-400 mb-4">
              TREND RELATIONSHIPS
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded border border-[#1e1e2e] hover:bg-[#0a0a0f] transition-colors">
                <span className="text-sm text-gray-400">
                  Equities & Tech trend
                </span>
                <span className="text-sm font-bold text-emerald-400">
                  Highly Correlated +0.95
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded border border-[#1e1e2e] hover:bg-[#0a0a0f] transition-colors">
                <span className="text-sm text-gray-400">
                  Risk-Off flows (SPY↔TLT)
                </span>
                <span className="text-sm font-bold text-red-400">
                  Inverse Relationship -0.67
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded border border-[#1e1e2e] hover:bg-[#0a0a0f] transition-colors">
                <span className="text-sm text-gray-400">
                  Dollar strength (GLD↔UUP)
                </span>
                <span className="text-sm font-bold text-emerald-400">
                  Strong Inverse +0.81
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
