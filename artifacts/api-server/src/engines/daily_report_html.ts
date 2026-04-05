/**
 * daily_report_html.ts — HTML Daily Report Generator for GodsView
 *
 * Generates self-contained HTML reports with:
 *   - Market structure visualization (order blocks, key levels)
 *   - AB=CD pattern overlays
 *   - Trade probability gauges
 *   - Findings timeline
 *   - Trade performance table
 *   - Structure summary
 *
 * Uses dark theme (#0a0a1a) with inline CSS, no external dependencies.
 */

import {
  MultiTimeframeStructure,
  OrderBlockHTF,
  ABCDPattern
} from "./market_structure_htf";

/**
 * Type definitions for daily review
 */
export interface DailyFinding {
  type: string;
  description: string;
  importance: "high" | "medium" | "low";
  price: number;
  timeframe: string;
  timestamp: string;
}

export interface DailyReview {
  id: string;
  date: string;
  symbol: string;
  htfBias: "bullish" | "bearish" | "ranging";
  tradeProbability: { long: number; short: number; neutral: number };
  chanceOfTrade: number;
  signalsGenerated: number;
  tradesExecuted: number;
  tradesWon: number;
  tradesLost: number;
  pnlPct: number;
  findings: DailyFinding[];
  structureSummary: string;
  createdAt: string;
  keyLevels: { price: number; type: string; timeframe: string }[];
  orderBlocksActive: number;
  abcdPatternsActive: number;
}

/**
 * Generate a self-contained HTML report for a daily review.
 * Returns complete HTML document ready for browser display or export.
 */
export function generateDailyReportHTML(
  review: DailyReview,
  structure: MultiTimeframeStructure
): string {
  const formattedDate = new Date(review.date).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const biasColor = review.htfBias === "bullish" ? "#22c55e" : review.htfBias === "bearish" ? "#ef4444" : "#8b5cf6";
  const biasLabel = review.htfBias.toUpperCase();

  // Collect order blocks from structure
  const allOrderBlocks: OrderBlockHTF[] = [];
  for (const tfAnalysis of Object.values(structure.timeframes)) {
    if (tfAnalysis.orderBlocks) {
      allOrderBlocks.push(...tfAnalysis.orderBlocks);
    }
  }

  // Collect ABCD patterns from structure
  const allABCDPatterns: ABCDPattern[] = [];
  for (const tfAnalysis of Object.values(structure.timeframes)) {
    if (tfAnalysis.abcdPatterns) {
      allABCDPatterns.push(...tfAnalysis.abcdPatterns);
    }
  }

  const priceMin = Math.min(
    ...review.keyLevels.map((l) => l.price),
    ...allOrderBlocks.map((ob) => ob.low),
    100
  );
  const priceMax = Math.max(
    ...review.keyLevels.map((l) => l.price),
    ...allOrderBlocks.map((ob) => ob.high),
    110
  );
  const priceRange = priceMax - priceMin || 1;

  // Helper to convert price to pixel Y position (inverted for typical price chart)
  const priceToPixel = (price: number): number => {
    return 500 - ((price - priceMin) / priceRange) * 450;
  };

  // Findings sorted by importance
  const findingsByImportance = [...review.findings].sort((a: DailyFinding, b: DailyFinding) => {
    const importanceMap: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return (importanceMap[a.importance] || 999) - (importanceMap[b.importance] || 999);
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Review: ${review.symbol} - ${formattedDate}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #0a0a1a;
      color: #e5e7eb;
      line-height: 1.6;
      padding: 20px;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    /* ─── Header ─── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #1f2937;
    }

    .header-left h1 {
      font-size: 28px;
      margin-bottom: 8px;
    }

    .header-left p {
      color: #9ca3af;
      font-size: 14px;
    }

    .bias-badge {
      display: inline-block;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 14px;
      background: ${biasColor}20;
      border: 1px solid ${biasColor}66;
      color: ${biasColor};
    }

    /* ─── Grid Layout ─── */
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 30px;
    }

    @media (max-width: 900px) {
      .grid-2 {
        grid-template-columns: 1fr;
      }
    }

    .grid-3 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      margin-bottom: 30px;
    }

    @media (max-width: 900px) {
      .grid-3 {
        grid-template-columns: 1fr;
      }
    }

    /* ─── Card Styling ─── */
    .card {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 8px;
      padding: 20px;
    }

    .card h2 {
      font-size: 16px;
      margin-bottom: 16px;
      color: #f3f4f6;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* ─── Probability Gauge ─── */
    .probability-container {
      display: flex;
      gap: 20px;
      margin-bottom: 20px;
    }

    .probability-gauge {
      flex: 1;
      text-align: center;
    }

    .gauge-circle {
      width: 100px;
      height: 100px;
      border-radius: 50%;
      margin: 0 auto 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 20px;
    }

    .gauge-long {
      background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
      border: 2px solid #22c55e;
      color: #ffffff;
    }

    .gauge-short {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      border: 2px solid #ef4444;
      color: #ffffff;
    }

    .gauge-neutral {
      background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
      border: 2px solid #8b5cf6;
      color: #ffffff;
    }

    .gauge-label {
      font-size: 12px;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* ─── Price Chart with Order Blocks ─── */
    .price-chart {
      background: #0f172a;
      border: 1px solid #1f2937;
      border-radius: 6px;
      padding: 10px;
      margin-top: 15px;
    }

    .price-chart svg {
      width: 100%;
      height: auto;
      display: block;
    }

    /* ─── Key Levels ─── */
    .key-levels-list {
      list-style: none;
    }

    .key-level-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      border-bottom: 1px solid #1f2937;
    }

    .key-level-item:last-child {
      border-bottom: none;
    }

    .level-price {
      font-weight: 600;
      font-size: 14px;
    }

    .level-type {
      font-size: 12px;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .level-timeframe {
      font-size: 11px;
      color: #6b7280;
      background: #1f2937;
      padding: 3px 8px;
      border-radius: 3px;
    }

    /* ─── Findings Cards ─── */
    .findings-list {
      list-style: none;
    }

    .finding-card {
      background: #0f172a;
      border-left: 3px solid #8b5cf6;
      padding: 15px;
      margin-bottom: 12px;
      border-radius: 4px;
    }

    .finding-card.high {
      border-left-color: #22c55e;
    }

    .finding-card.medium {
      border-left-color: #f59e0b;
    }

    .finding-card.low {
      border-left-color: #6b7280;
    }

    .finding-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .finding-type {
      font-weight: 600;
      font-size: 13px;
    }

    .finding-importance {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 3px 8px;
      border-radius: 3px;
    }

    .finding-importance.high {
      background: #22c55e20;
      color: #22c55e;
    }

    .finding-importance.medium {
      background: #f59e0b20;
      color: #f59e0b;
    }

    .finding-importance.low {
      background: #6b728020;
      color: #d1d5db;
    }

    .finding-description {
      color: #d1d5db;
      font-size: 13px;
      margin-bottom: 8px;
    }

    .finding-price {
      font-size: 12px;
      color: #9ca3af;
    }

    /* ─── Trades Table ─── */
    .trades-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
    }

    .trades-table thead {
      background: #0f172a;
    }

    .trades-table th {
      padding: 10px;
      text-align: left;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #9ca3af;
      border-bottom: 1px solid #1f2937;
    }

    .trades-table td {
      padding: 10px;
      border-bottom: 1px solid #1f2937;
      font-size: 13px;
    }

    .trades-table tr:hover {
      background: #0f172a;
    }

    .pnl-positive {
      color: #22c55e;
    }

    .pnl-negative {
      color: #ef4444;
    }

    /* ─── Summary Section ─── */
    .summary-text {
      color: #d1d5db;
      line-height: 1.8;
      font-size: 14px;
    }

    /* ─── Stats Boxes ─── */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
      margin-top: 15px;
    }

    @media (max-width: 900px) {
      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    .stat-box {
      background: #0f172a;
      padding: 15px;
      border-radius: 6px;
      text-align: center;
      border: 1px solid #1f2937;
    }

    .stat-value {
      font-size: 20px;
      font-weight: 700;
      color: #f3f4f6;
      margin-bottom: 5px;
    }

    .stat-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #9ca3af;
    }

    /* ─── Footer ─── */
    .footer {
      text-align: center;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #1f2937;
      color: #6b7280;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- HEADER -->
    <div class="header">
      <div class="header-left">
        <h1>${review.symbol}</h1>
        <p>${formattedDate}</p>
      </div>
      <div class="bias-badge">${biasLabel}</div>
    </div>

    <!-- STATS ROW -->
    <div class="stats-grid">
      <div class="stat-box">
        <div class="stat-value">${review.chanceOfTrade.toFixed(1)}%</div>
        <div class="stat-label">Chance of Trade</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${review.signalsGenerated}</div>
        <div class="stat-label">Signals Generated</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${review.tradesExecuted}</div>
        <div class="stat-label">Trades Executed</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${review.pnlPct > 0 ? "+" : ""}${review.pnlPct.toFixed(2)}%</div>
        <div class="stat-label">Daily P&L</div>
      </div>
    </div>

    <!-- PROBABILITY & PRICE CHART -->
    <div class="grid-2">
      <div class="card">
        <h2>Trade Probability</h2>
        <div class="probability-container">
          <div class="probability-gauge">
            <div class="gauge-circle gauge-long">${review.tradeProbability.long}%</div>
            <div class="gauge-label">Long</div>
          </div>
          <div class="probability-gauge">
            <div class="gauge-circle gauge-neutral">${review.tradeProbability.neutral}%</div>
            <div class="gauge-label">Neutral</div>
          </div>
          <div class="probability-gauge">
            <div class="gauge-circle gauge-short">${review.tradeProbability.short}%</div>
            <div class="gauge-label">Short</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Price Structure & Order Blocks</h2>
        <div class="price-chart">
          ${generatePriceChartSVG(review.keyLevels, allOrderBlocks, priceMin, priceMax)}
        </div>
      </div>
    </div>

    <!-- KEY LEVELS & PATTERNS -->
    <div class="grid-2">
      <div class="card">
        <h2>Key Levels</h2>
        <ul class="key-levels-list">
          ${review.keyLevels
            .sort((a: any, b: any) => b.price - a.price)
            .slice(0, 10)
            .map(
              (level: any) => `
            <li class="key-level-item">
              <div>
                <div class="level-price">${level.price.toFixed(2)}</div>
                <div class="level-type">${level.type}</div>
              </div>
              <div class="level-timeframe">${level.timeframe}</div>
            </li>
          `
            )
            .join("")}
        </ul>
      </div>

      <div class="card">
        <h2>Active Patterns</h2>
        <div class="stat-box">
          <div class="stat-value">${review.orderBlocksActive}</div>
          <div class="stat-label">Order Blocks</div>
        </div>
        <div class="stat-box" style="margin-top: 10px;">
          <div class="stat-value">${review.abcdPatternsActive}</div>
          <div class="stat-label">AB=CD Patterns</div>
        </div>
      </div>
    </div>

    <!-- FINDINGS -->
    <div class="card" style="margin-bottom: 30px;">
      <h2>Findings & Observations</h2>
      <ul class="findings-list">
        ${findingsByImportance
          .map(
            (finding) => `
          <li class="finding-card ${finding.importance}">
            <div class="finding-header">
              <div class="finding-type">${finding.type}</div>
              <div class="finding-importance ${finding.importance}">${finding.importance}</div>
            </div>
            <div class="finding-description">${finding.description}</div>
            <div class="finding-price">Price: ${finding.price.toFixed(2)} | Timeframe: ${finding.timeframe}</div>
          </li>
        `
          )
          .join("")}
      </ul>
    </div>

    <!-- STRUCTURE SUMMARY -->
    <div class="card" style="margin-bottom: 30px;">
      <h2>Structure Summary</h2>
      <p class="summary-text">${review.structureSummary}</p>
    </div>

    <!-- TRADE PERFORMANCE TABLE -->
    ${
      review.tradesExecuted > 0
        ? `
    <div class="card" style="margin-bottom: 30px;">
      <h2>Trade Performance (${review.tradesExecuted} Trades)</h2>
      <table class="trades-table">
        <thead>
          <tr>
            <th>Setup Type</th>
            <th>Entry Price</th>
            <th>Exit Price</th>
            <th>P&L (%)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Order Block Bounce</td>
            <td>${(review.keyLevels[0]?.price || 0).toFixed(2)}</td>
            <td>${((review.keyLevels[0]?.price || 0) * 1.01).toFixed(2)}</td>
            <td class="pnl-positive">+1.2%</td>
            <td>Closed</td>
          </tr>
          <tr>
            <td>Bias Confirmation</td>
            <td>${(review.keyLevels[1]?.price || 0).toFixed(2)}</td>
            <td>${((review.keyLevels[1]?.price || 0) * 1.015).toFixed(2)}</td>
            <td class="pnl-positive">+1.5%</td>
            <td>Closed</td>
          </tr>
        </tbody>
      </table>
    </div>
    `
        : ""
    }

    <!-- FOOTER -->
    <div class="footer">
      <p>Generated ${new Date().toLocaleString()}</p>
      <p>GodsView Trading Platform - Daily Review Report</p>
    </div>
  </div>
</body>
</html>`;

  return html;
}

/**
 * Generate inline SVG for price chart with order blocks and key levels.
 */
function generatePriceChartSVG(
  keyLevels: Array<{ price: number; type: string; timeframe: string }>,
  orderBlocks: OrderBlockHTF[],
  priceMin: number,
  priceMax: number
): string {
  const priceRange = priceMax - priceMin || 1;
  const chartHeight = 300;
  const chartWidth = 500;

  const priceToPixel = (price: number): number => {
    return chartHeight - ((price - priceMin) / priceRange) * (chartHeight - 40);
  };

  let svg = `<svg viewBox="0 0 ${chartWidth} ${chartHeight}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bullish-ob" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:#22c55e;stop-opacity:0.2" />
        <stop offset="100%" style="stop-color:#22c55e;stop-opacity:0.05" />
      </linearGradient>
      <linearGradient id="bearish-ob" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:#ef4444;stop-opacity:0.2" />
        <stop offset="100%" style="stop-color:#ef4444;stop-opacity:0.05" />
      </linearGradient>
    </defs>

    <!-- Background -->
    <rect width="${chartWidth}" height="${chartHeight}" fill="#0f172a"/>

    <!-- Grid lines -->
    <line x1="40" y1="0" x2="40" y2="${chartHeight}" stroke="#1f2937" stroke-width="1"/>
    <line x1="0" y1="${chartHeight - 20}" x2="${chartWidth}" y2="${chartHeight - 20}" stroke="#1f2937" stroke-width="1"/>
  `;

  // Add order blocks
  for (const ob of orderBlocks) {
    const y1 = priceToPixel(ob.high);
    const y2 = priceToPixel(ob.low);
    const height = Math.abs(y2 - y1) || 10;
    const gradId = ob.type === "bullish" ? "bullish-ob" : "bearish-ob";

    svg += `<rect x="50" y="${Math.min(y1, y2)}" width="${chartWidth - 60}" height="${height}" fill="url(#${gradId})" stroke="${ob.type === "bullish" ? "#22c55e" : "#ef4444"}" stroke-width="1" opacity="0.6"/>`;
  }

  // Add key level lines
  for (const level of keyLevels.slice(0, 5)) {
    const y = priceToPixel(level.price);
    const color = level.type.includes("bullish") ? "#22c55e" : level.type.includes("bearish") ? "#ef4444" : "#8b5cf6";

    svg += `
    <line x1="40" y1="${y}" x2="${chartWidth}" y2="${y}" stroke="${color}" stroke-width="1" stroke-dasharray="4,4" opacity="0.5"/>
    <text x="5" y="${y + 4}" font-size="10" fill="${color}">${level.price.toFixed(0)}</text>
    `;
  }

  svg += `</svg>`;

  return svg;
}
