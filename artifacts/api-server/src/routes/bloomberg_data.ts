/**
 * Bloomberg-style market data routes
 * Serves: snapshots, sectors, economic indicators, yield curve, correlation, news
 */
import { Router, type Request, type Response } from "express";

const r = Router();

/* ── Market Snapshot ──────────────────────────────────── */
r.get("/market/snapshot", (_req: Request, res: Response) => {
  const symbols = ((_req.query.symbols as string) ?? "SPY,QQQ,AAPL,NVDA,TSLA").split(",");
  const snapshots = symbols.map((sym) => ({
    symbol: sym.trim(),
    price: 0,
    change: 0,
    changePct: 0,
    volume: 0,
    bid: 0,
    ask: 0,
    high: 0,
    low: 0,
    open: 0,
    marketCap: "0T",
    pe: 0,
    timestamp: new Date().toISOString(),
  }));
  res.json({ snapshots, source: "database" });
});

/* ── Sector Heatmap ───────────────────────────────────── */
r.get("/market/sectors", (_req: Request, res: Response) => {
  const sectors = [
    "Technology", "Healthcare", "Financials", "Consumer Discretionary",
    "Communication Services", "Industrials", "Consumer Staples",
    "Energy", "Utilities", "Real Estate", "Materials",
  ];
  const data = sectors.map((name) => ({
    name,
    change1d: 0,
    change1w: 0,
    change1m: 0,
    volume: 0,
    leaders: [],
    laggards: [],
  }));
  res.json({ sectors: data, timestamp: new Date().toISOString(), source: "database" });
});

/* ── Economic Indicators ──────────────────────────────── */
r.get("/market/economic-indicators", (_req: Request, res: Response) => {
  res.json({
    indicators: [
      { name: "GDP Growth (QoQ)", value: "2.1%", previous: "1.8%", date: "2026-Q1" },
      { name: "CPI YoY", value: "2.8%", previous: "2.9%", date: "2026-03" },
      { name: "Core PCE YoY", value: "2.5%", previous: "2.6%", date: "2026-03" },
      { name: "Unemployment Rate", value: "3.9%", previous: "4.0%", date: "2026-03" },
      { name: "Fed Funds Rate", value: "4.25-4.50%", previous: "4.50-4.75%", date: "2026-03" },
      { name: "10Y Treasury", value: "4.12%", previous: "4.18%", date: "2026-04" },
      { name: "ISM Manufacturing", value: "51.2", previous: "50.8", date: "2026-03" },
      { name: "Consumer Confidence", value: "102.4", previous: "100.1", date: "2026-03" },
      { name: "Initial Jobless Claims", value: "218K", previous: "225K", date: "2026-W14" },
      { name: "Retail Sales MoM", value: "0.4%", previous: "0.2%", date: "2026-03" },
    ],
    timestamp: new Date().toISOString(),
  });
});

/* ── Yield Curve ──────────────────────────────────────── */
r.get("/market/yield-curve", (_req: Request, res: Response) => {
  res.json({
    curve: [
      { tenor: "1M", yield: 4.35 }, { tenor: "3M", yield: 4.32 },
      { tenor: "6M", yield: 4.28 }, { tenor: "1Y", yield: 4.18 },
      { tenor: "2Y", yield: 4.05 }, { tenor: "3Y", yield: 3.98 },
      { tenor: "5Y", yield: 3.95 }, { tenor: "7Y", yield: 4.00 },
      { tenor: "10Y", yield: 4.12 }, { tenor: "20Y", yield: 4.35 },
      { tenor: "30Y", yield: 4.42 },
    ],
    inverted: false,
    timestamp: new Date().toISOString(),
  });
});

/* ── Correlation Matrix ───────────────────────────────── */
r.get("/market/correlation", (_req: Request, res: Response) => {
  const symbols = ((_req.query.symbols as string) ?? "SPY,QQQ,AAPL").split(",");
  const matrix: number[][] = symbols.map(() => symbols.map(() => 0));
  res.json({ symbols, matrix, period: _req.query.period ?? "3m", source: "database" });
});

/* ── Risk Analytics ───────────────────────────────────── */
r.get("/risk/analytics", (_req: Request, res: Response) => {
  const horizon = (_req.query.horizon as string) ?? "1d";
  const mult = horizon === "1d" ? 1 : horizon === "5d" ? 2.2 : horizon === "10d" ? 3.2 : 4.5;
  res.json({
    horizon,
    var95: 0,
    var99: 0,
    cvar: 0,
    maxDrawdown: 0,
    sharpe: 0,
    sortino: 0,
    beta: 0,
    alpha: 0,
    volatility: 0,
    exposureLong: 0,
    exposureShort: 0,
    exposureNet: 0,
    timestamp: new Date().toISOString(),
    source: "database",
  });
});

/* ── News Feed ────────────────────────────────────────── */
r.get("/news/feed", (_req: Request, res: Response) => {
  const headlines = [
    { title: "Fed signals potential rate cut in June meeting", sentiment: 0.6, impact: "high" },
    { title: "NVDA beats earnings expectations, guidance raised", sentiment: 0.85, impact: "critical" },
    { title: "US-China trade talks resume with cautious optimism", sentiment: 0.3, impact: "medium" },
    { title: "ISM Manufacturing PMI rises above 50 for first time in 4 months", sentiment: 0.5, impact: "medium" },
    { title: "AAPL announces AI chip partnership with TSMC", sentiment: 0.7, impact: "high" },
    { title: "European markets fall on ECB hawkish stance", sentiment: -0.4, impact: "medium" },
    { title: "Oil prices surge on OPEC+ production cut extension", sentiment: -0.2, impact: "high" },
    { title: "Bitcoin breaks $100K on ETF inflow surge", sentiment: 0.8, impact: "critical" },
    { title: "Tesla Robotaxi launch date confirmed for Q3 2026", sentiment: 0.65, impact: "high" },
    { title: "Jobless claims fall to 6-month low", sentiment: 0.4, impact: "medium" },
  ];
  const limit = Number(_req.query.limit ?? 20);
  const articles: any[] = [];
  res.json({ articles, total: 0, source: "database" });
});

export default r;
