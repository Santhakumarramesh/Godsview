"use client";

import { useEffect, useState, useCallback } from "react";

interface ConfluenceZone {
  price: number;
  type: string;
  strength: number;
}

interface TradePlan {
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  riskAmount: number;
  rewardAmount: number;
  ratio: number;
  positionSize: number;
}

export default function EntryPlannerPage() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("AAPL");
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [confluenceZones, setConfluenceZones] = useState<ConfluenceZone[]>([]);

  const [entryPrice, setEntryPrice] = useState<number>(0);
  const [stopPrice, setStopPrice] = useState<number>(0);
  const [positionSize, setPositionSize] = useState<number>(100);
  const [rrRatio, setRrRatio] = useState<string>("1:2");

  const [tradePlan, setTradePlan] = useState<TradePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  // Fetch symbols
  useEffect(() => {
    const fetchSymbols = async () => {
      try {
        const res = await fetch("/api/market/symbols");
        if (!res.ok) throw new Error("Failed to fetch symbols");
        const data = await res.json();
        setSymbols(data.symbols || []);
        if (data.symbols && data.symbols.length > 0) {
          setSelectedSymbol(data.symbols[0]);
        }
      } catch (err) {
        setError("Error loading symbols");
        console.error(err);
      }
    };
    fetchSymbols();
  }, []);

  // Fetch data
  const fetchData = useCallback(async (symbol: string) => {
    setLoading(true);
    setError("");
    try {
      const [quoteRes, confluenceRes] = await Promise.all([
        fetch(`/api/market/quote/${symbol}`),
        fetch(`/api/flow/${symbol}/confluence`),
      ]);

      if (!quoteRes.ok) throw new Error("Failed to fetch quote");

      const quoteData = await quoteRes.json();
      setCurrentPrice(quoteData.price || 0);
      setEntryPrice(quoteData.price || 0);

      if (confluenceRes.ok) {
        const confluenceData = await confluenceRes.json();
        setConfluenceZones(confluenceData.zones || []);
      }
    } catch (err) {
      setError("Failed to fetch data");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh
  useEffect(() => {
    fetchData(selectedSymbol);
    const interval = setInterval(() => {
      fetchData(selectedSymbol);
    }, 30000);
    return () => clearInterval(interval);
  }, [selectedSymbol, fetchData]);

  // Calculate trade plan
  const calculateTradePlan = () => {
    if (!entryPrice || !stopPrice || entryPrice === stopPrice) {
      setError("Invalid entry or stop price");
      return;
    }

    const risk = Math.abs(entryPrice - stopPrice);
    const [riskMultiplier, rewardMultiplier] = rrRatio.split(":").map(Number);
    const reward = (risk * rewardMultiplier) / riskMultiplier;

    const targetPrice = entryPrice > stopPrice
      ? entryPrice + reward
      : entryPrice - reward;

    const riskAmount = risk * positionSize;
    const rewardAmount = reward * positionSize;

    setTradePlan({
      entryPrice,
      stopPrice,
      targetPrice,
      riskAmount,
      rewardAmount,
      ratio: rewardAmount / riskAmount,
      positionSize,
    });
    setError("");
  };

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Entry / Stop / Target Planner</h1>
        <span className="rounded bg-blue-400/15 px-2 py-1 font-mono text-xs text-blue-400">
          planner
        </span>
      </header>

      {/* Symbol Selector */}
      <div className="flex gap-4 rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
        <div className="flex-1">
          <label className="block text-sm text-gray-400 mb-1">Symbol</label>
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="w-full rounded border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2 text-white text-sm"
          >
            {symbols.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
        </div>
        {currentPrice > 0 && (
          <div className="flex-1">
            <label className="block text-sm text-gray-400 mb-1">Current Price</label>
            <input
              type="text"
              value={`$${currentPrice.toFixed(2)}`}
              disabled
              className="w-full rounded border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2 text-white text-sm opacity-60"
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex h-96 items-center justify-center rounded-lg border border-[#1e1e2e] bg-[#12121a]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-center text-red-400">
          {error}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Input Panel */}
          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4 space-y-4">
            <h3 className="text-lg font-semibold text-white">Trade Setup</h3>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Entry Price</label>
              <input
                type="number"
                value={entryPrice}
                onChange={(e) => setEntryPrice(parseFloat(e.target.value))}
                className="w-full rounded border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2 text-white text-sm"
                step="0.01"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Stop Loss Price</label>
              <input
                type="number"
                value={stopPrice}
                onChange={(e) => setStopPrice(parseFloat(e.target.value))}
                className="w-full rounded border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2 text-white text-sm"
                step="0.01"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Position Size (shares)</label>
              <input
                type="number"
                value={positionSize}
                onChange={(e) => setPositionSize(parseFloat(e.target.value))}
                className="w-full rounded border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2 text-white text-sm"
                step="1"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Risk/Reward Ratio</label>
              <select
                value={rrRatio}
                onChange={(e) => setRrRatio(e.target.value)}
                className="w-full rounded border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2 text-white text-sm"
              >
                <option value="1:1">1:1</option>
                <option value="1:2">1:2</option>
                <option value="1:3">1:3</option>
                <option value="1:5">1:5</option>
              </select>
            </div>

            <button
              onClick={calculateTradePlan}
              className="w-full rounded border border-emerald-400 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-400 hover:bg-emerald-400/20"
            >
              Calculate Plan
            </button>
          </div>

          {/* Trade Plan Summary */}
          {tradePlan && (
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-4 space-y-4">
              <h3 className="text-lg font-semibold text-emerald-400">Trade Plan</h3>

              <div>
                <p className="text-xs text-gray-400 mb-1">Entry</p>
                <p className="text-2xl font-semibold text-white">${tradePlan.entryPrice.toFixed(2)}</p>
              </div>

              <div>
                <p className="text-xs text-gray-400 mb-1">Stop Loss</p>
                <p className="text-2xl font-semibold text-red-400">${tradePlan.stopPrice.toFixed(2)}</p>
              </div>

              <div>
                <p className="text-xs text-gray-400 mb-1">Take Profit Target</p>
                <p className="text-2xl font-semibold text-emerald-400">${tradePlan.targetPrice.toFixed(2)}</p>
              </div>

              <div className="border-t border-emerald-400/20 pt-4">
                <p className="text-xs text-gray-400 mb-1">Risk Amount</p>
                <p className="text-lg font-semibold text-red-400">${tradePlan.riskAmount.toFixed(2)}</p>
              </div>

              <div>
                <p className="text-xs text-gray-400 mb-1">Reward Amount</p>
                <p className="text-lg font-semibold text-emerald-400">${tradePlan.rewardAmount.toFixed(2)}</p>
              </div>

              <div>
                <p className="text-xs text-gray-400 mb-1">Risk/Reward Ratio</p>
                <p className="text-lg font-semibold text-blue-400">1:{tradePlan.ratio.toFixed(1)}</p>
              </div>
            </div>
          )}

          {/* Confluence Zones */}
          {confluenceZones.length > 0 && (
            <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4 space-y-3">
              <h3 className="text-lg font-semibold text-white">Confluence Zones</h3>
              <p className="text-xs text-gray-400">Suggested entry levels based on order flow analysis</p>

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {confluenceZones.slice(0, 8).map((zone, idx) => (
                  <div
                    key={idx}
                    className="rounded p-3 bg-blue-400/10 border border-blue-400/30 cursor-pointer hover:bg-blue-400/20"
                    onClick={() => setEntryPrice(zone.price)}
                  >
                    <p className="text-sm font-semibold text-blue-400">${zone.price.toFixed(2)}</p>
                    <p className="text-xs text-gray-400">{zone.type} (strength: {zone.strength})</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
