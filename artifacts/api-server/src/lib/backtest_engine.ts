/**
 * backtest_engine.ts — GodsView Quant Backtester (L7)
 *
 * A Wall Street-grade walk-forward backtesting engine.
 * Thinks like a quant, works like a prop desk risk manager.
 *
 * What it does:
 *   1. Walks forward bar-by-bar through historical OHLCV data
 *   2. At each bar, runs the Structure + Perception engines
 *   3. Detects setup confirmation with exact timestamp and price
 *   4. Records ALL supporting evidence at confirmation time:
 *      - Which OBs were active, which FVGs were unfilled
 *      - Regime at confirmation
 *      - Orderflow bias, CVD direction
 *      - MTF alignment
 *   5. Projects forward N bars to compute outcome (MFE, MAE, win/loss)
 *   6. Calculates quant performance metrics per setup
 *   7. Learns each setup's "character" — what conditions produce highest accuracy
 *   8. Builds a Rulebook from empirical evidence (not assumptions)
 *
 * Metrics (Wall Street standard):
 *   - Win Rate, Profit Factor, Expectancy
 *   - Sharpe Ratio, Sortino Ratio, Calmar Ratio
 *   - Max Favorable Excursion (MFE) — best case per trade
 *   - Max Adverse Excursion (MAE) — worst case per trade (stop optimization)
 *   - R-Multiple distribution (how many R per winner/loser)
 *   - Regime-conditional win rates (when does the setup actually work?)
 *   - Consecutive win/loss streaks (robustness)
 *   - Equity curve with drawdown waterfall
 */

// ── Bar Shape ──────────────────────────────────────────────────────────────

export interface OHLCVBar {
  Timestamp: string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  Volume: number;
}

// ── Setup Confirmation Record ──────────────────────────────────────────────

/** Everything the agent saw at the moment it confirmed a setup */
export interface SetupConfirmation {
  /** Unique ID for this confirmation event */
  id: string;
  symbol: string;
  /** Exact date+time when confirmation bar closed */
  confirmedAt: string;
  /** Bar index in the historical series */
  barIndex: number;
  /** Direction the setup is calling */
  direction: "long" | "short";
  /** Which setup pattern was detected */
  setupType: string;
  /** Entry price (close of confirmation bar) */
  entryPrice: number;
  /** Stop loss level */
  stopLoss: number;
  /** Take profit level */
  takeProfit: number;
  /** ATR at time of confirmation */
  atr: number;
  /** Planned R:R ratio */
  plannedRR: number;

  // ── Supporting Evidence at Confirmation Time ──────────────────────────
  /** Market structure at confirmation */
  structure: {
    trend: string;
    pattern: string;
    bos: boolean;
    bosDirection: string;
    choch: boolean;
    activeOBCount: number;
    nearestOBPrice: number | null;
    unfilledFVGCount: number;
    nearestFVGPrice: number | null;
    confluenceScore: number;
  };
  /** Regime at confirmation */
  regime: {
    label: string;
    regime: string;
    trendStrength: number;
    confidence: number;
  };
  /** Orderflow at confirmation */
  orderflow: {
    bias: string;
    delta: number;
    cvdSlope: number;
    aggressionScore: number;
    largeDeltaBar: boolean;
    divergence: boolean;
  };
  /** MTF alignment */
  mtfAligned: boolean;
  /** Composite confidence score from all engines */
  confirmationScore: number;
  /** Human-readable summary of WHY this setup was confirmed */
  confirmationReason: string;
}

// ── Trade Outcome ──────────────────────────────────────────────────────────

export interface TradeOutcome {
  confirmationId: string;
  symbol: string;
  confirmedAt: string;
  closedAt: string;
  direction: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  exitReason: "tp_hit" | "sl_hit" | "time_exit";
  /** Max favorable excursion (best price reached from entry, in R) */
  mfeR: number;
  /** Max adverse excursion (worst price from entry before exit, in R) */
  maeR: number;
  /** Actual R:R achieved */
  achievedR: number;
  /** Win = achieved > 0 (TP hit), loss = achieved < 0 (SL hit) */
  won: boolean;
  /** P&L in R-multiples */
  pnlR: number;
  /** P&L in price units */
  pnlPrice: number;
  /** Bars held */
  barsHeld: number;
  /** Regime at entry */
  entryRegime: string;
  /** Setup type */
  setupType: string;
}

// ── Quant Performance Metrics ──────────────────────────────────────────────

export interface QuantMetrics {
  symbol: string;
  timeframeTested: string;
  periodStart: string;
  periodEnd: string;
  barsAnalyzed: number;
  /** Total confirmed setups found */
  totalSetups: number;
  /** Setups that reached a definitive outcome (TP or SL) */
  completedTrades: number;
  /** Win/Loss stats */
  winRate: number;
  lossRate: number;
  winCount: number;
  lossCount: number;
  /** R-multiple stats */
  avgWinR: number;
  avgLossR: number;
  avgR: number;
  /** Profit factor = gross wins / gross losses */
  profitFactor: number;
  /** Expectancy per trade in R */
  expectancy: number;
  /** Sharpe ratio (annualized, assuming 252 trading days) */
  sharpeRatio: number;
  /** Sortino ratio (penalizes downside volatility only) */
  sortinoRatio: number;
  /** Calmar ratio = annualized return / max drawdown */
  calmarRatio: number;
  /** Max drawdown in R */
  maxDrawdownR: number;
  /** Longest losing streak */
  maxLosingStreak: number;
  /** Longest winning streak */
  maxWinningStreak: number;
  /** Average MFE in R (best possible entry management) */
  avgMFE: number;
  /** Average MAE in R (how much heat trades take) */
  avgMAE: number;
  /** Optimal stop = percentile 90 MAE across losers */
  optimalStopR: number;
  /** Regime breakdown — win rate per regime */
  winRateByRegime: Record<string, { wins: number; total: number; wr: number }>;
  /** Setup type breakdown */
  winRateBySetup: Record<string, { wins: number; total: number; wr: number }>;
  /** MTF-aligned vs divergent performance */
  mtfAlignedWR: number;
  mtfDivergentWR: number;
  /** Equity curve in R-multiples (cumulative) */
  equityCurve: Array<{ trade: number; cumR: number; drawdown: number }>;
  /** Rulebook — what conditions produce highest accuracy */
  rulebook: RulebookEntry[];
}

export interface RulebookEntry {
  rule: string;
  condition: string;
  winRate: number;
  sampleSize: number;
  confidence: "high" | "medium" | "low";
  action: "require" | "prefer" | "avoid" | "prohibit";
}

// ── Walk-Forward Backtester ────────────────────────────────────────────────

const LOOKFORWARD_BARS = 50; // How many bars to check for TP/SL after confirmation
const MIN_BARS_FOR_STRUCTURE = 40; // Min bars before we start detecting setups

/** Detect setup confirmation on a single bar using the structure engine */
function detectConfirmation(
  symbol: string,
  bars1m: OHLCVBar[],
  bars5m: OHLCVBar[],
  barIdx: number,
): SetupConfirmation | null {
  if (barIdx < MIN_BARS_FOR_STRUCTURE) return null;

  const slice1m = bars1m.slice(Math.max(0, barIdx - 100), barIdx + 1);
  const slice5m = bars5m.slice(Math.max(0, Math.floor(barIdx / 5) - 30), Math.floor(barIdx / 5) + 1);

  const currentBar = bars1m[barIdx];
  if (!currentBar) return null;

  // SMC state
  let smc: any = null;
  let regime: any = null;
  let of: any = null;
  let mtf: any = null;

  try {
    const { computeSMCState } = require("./smc_engine");
    const smcBars1m = slice1m.map(toSMCBar);
    const smcBars5m = slice5m.map(toSMCBar);
    smc = computeSMCState(symbol, smcBars1m, smcBars5m);
  } catch { return null; }

  try {
    const { computeFullRegime } = require("./regime_engine");
    const regimeBars = slice5m.length >= 10 ? slice5m.map(toSMCBar) : slice1m.map(toSMCBar);
    regime = computeFullRegime(regimeBars);
  } catch { regime = { basic: { regime: "unknown", trendStrength: 0, confidence: 0.3 }, label: "unknown" }; }

  try {
    const { computeOrderflowState } = require("./orderflow_engine");
    of = computeOrderflowState(slice1m.map(toSMCBar), null);
  } catch { of = { orderflowBias: "neutral", delta: 0, cvdSlope: 0, aggressionScore: 0, divergence: false, largeDeltaBar: false }; }

  try {
    const { computeMTFScores } = require("./mtf_scores");
    mtf = computeMTFScores(slice1m.map(toAlpacaBar), slice5m.map(toAlpacaBar));
  } catch { mtf = { bias1m: 0, bias5m: 0 }; }

  if (!smc) return null;

  // ── Confirmation Logic ─────────────────────────────────────────────────
  // A setup is confirmed when a cluster of supporting evidence aligns.
  // This mirrors how a human SMC trader reads the market:

  const trend = smc.structure.trend;
  const bos = smc.structure.bos;
  const bosDir = smc.structure.bosDirection;
  const choch = smc.structure.choch;
  const hasActiveOB = smc.activeOBs.length > 0;
  const hasFVG = smc.unfilledFVGs.length > 0;
  const flowBias = of.orderflowBias;
  const mtfAligned = mtf.bias1m !== 0 && mtf.bias5m !== 0 && Math.sign(mtf.bias1m) === Math.sign(mtf.bias5m);

  // Long confirmation: BOS bullish + OB present + flow confirms + MTF aligned
  const longScore =
    (trend === "bullish" ? 0.3 : trend === "neutral" ? 0.1 : 0) +
    (bos && bosDir === "bullish" ? 0.25 : 0) +
    (hasActiveOB ? 0.15 : 0) +
    (hasFVG ? 0.1 : 0) +
    (flowBias === "bullish" ? 0.15 : 0) +
    (mtfAligned && (mtf.bias1m ?? 0) > 0 ? 0.05 : 0);

  // Short confirmation
  const shortScore =
    (trend === "bearish" ? 0.3 : trend === "neutral" ? 0.1 : 0) +
    (bos && bosDir === "bearish" ? 0.25 : 0) +
    (hasActiveOB ? 0.15 : 0) +
    (hasFVG ? 0.1 : 0) +
    (flowBias === "bearish" ? 0.15 : 0) +
    (mtfAligned && (mtf.bias1m ?? 0) < 0 ? 0.05 : 0) +
    (choch ? 0.1 : 0);

  const CONFIRMATION_THRESHOLD = 0.55;
  const direction = longScore >= CONFIRMATION_THRESHOLD ? "long"
    : shortScore >= CONFIRMATION_THRESHOLD ? "short"
    : null;

  if (!direction) return null;

  // Chaotic regime blocks all setups
  if (regime.basic?.regime === "chaotic") return null;

  const confirmScore = direction === "long" ? longScore : shortScore;
  const close = currentBar.Close;

  // ATR for SL/TP
  let atr = 0;
  try {
    const _se = "./strategy_engine"; const { computeATR } = require(_se);
    atr = computeATR(slice1m.map(toAlpacaBar));
  } catch { atr = (currentBar.High - currentBar.Low) * 1.5; }

  const slMult = regime.basic?.regime === "volatile" ? 1.5 : 1.0;
  const tpMult = regime.basic?.regime === "trending_bull" || regime.basic?.regime === "trending_bear" ? 2.5 : 2.0;
  const slDist = Math.max(atr * slMult, close * 0.002);
  const tpDist = Math.max(atr * tpMult, close * 0.004);

  const stopLoss = direction === "long" ? close - slDist : close + slDist;
  const takeProfit = direction === "long" ? close + tpDist : close - tpDist;

  // Nearest OB/FVG for context
  const nearOB = smc.activeOBs.length > 0
    ? smc.activeOBs.reduce((nearest: any, ob: any) => {
        const d = Math.abs(ob.midpoint - close);
        return !nearest || d < Math.abs(nearest.midpoint - close) ? ob : nearest;
      }, null)
    : null;

  const nearFVG = smc.unfilledFVGs.length > 0
    ? smc.unfilledFVGs.reduce((nearest: any, fvg: any) => {
        const d = Math.abs(((fvg.top + fvg.bottom) / 2) - close);
        return !nearest || d < Math.abs(((nearest.top + nearest.bottom) / 2) - close) ? fvg : nearest;
      }, null)
    : null;

  // Build confirmation reason
  const reasons: string[] = [];
  if (bos) reasons.push(`BOS ${bosDir}`);
  if (choch) reasons.push("CHoCH reversal");
  if (hasActiveOB) reasons.push(`${smc.activeOBs.length} active OBs`);
  if (hasFVG) reasons.push(`${smc.unfilledFVGs.length} unfilled FVGs`);
  if (flowBias !== "neutral") reasons.push(`${flowBias} orderflow`);
  if (of.largeDeltaBar) reasons.push("large delta bar");
  if (mtfAligned) reasons.push("MTF aligned");
  if (of.divergence) reasons.push("CVD divergence");
  reasons.push(`${regime.label} regime`);

  const id = `${symbol}_${currentBar.Timestamp}_${direction}`;

  return {
    id,
    symbol,
    confirmedAt: currentBar.Timestamp,
    barIndex: barIdx,
    direction,
    setupType: bos ? (choch ? "choch_reversal" : "bos_continuation") : (hasActiveOB ? "ob_reaction" : "structure_break"),
    entryPrice: close,
    stopLoss,
    takeProfit,
    atr,
    plannedRR: tpDist / slDist,
    structure: {
      trend,
      pattern: smc.structure.pattern ?? "unknown",
      bos,
      bosDirection: bosDir,
      choch,
      activeOBCount: smc.activeOBs.length,
      nearestOBPrice: nearOB ? nearOB.midpoint ?? null : null,
      unfilledFVGCount: smc.unfilledFVGs.length,
      nearestFVGPrice: nearFVG ? (nearFVG.top + nearFVG.bottom) / 2 : null,
      confluenceScore: smc.confluenceScore ?? 0.5,
    },
    regime: {
      label: regime.label ?? "unknown",
      regime: regime.basic?.regime ?? "unknown",
      trendStrength: regime.basic?.trendStrength ?? 0,
      confidence: regime.basic?.confidence ?? 0.3,
    },
    orderflow: {
      bias: of.orderflowBias,
      delta: of.delta ?? 0,
      cvdSlope: of.cvdSlope ?? 0,
      aggressionScore: of.aggressionScore ?? 0,
      largeDeltaBar: of.largeDeltaBar ?? false,
      divergence: of.divergence ?? false,
    },
    mtfAligned,
    confirmationScore: confirmScore,
    confirmationReason: reasons.join(" | "),
  };
}

/** Walk forward from a confirmation bar to find outcome */
function resolveOutcome(
  confirmation: SetupConfirmation,
  bars: OHLCVBar[],
  startIdx: number,
): TradeOutcome | null {
  const { entryPrice, stopLoss, takeProfit, direction } = confirmation;
  const rSize = Math.abs(entryPrice - stopLoss);
  if (rSize <= 0) return null;

  let mfe = 0; // max favorable (in R)
  let mae = 0; // max adverse (in R)
  let exitPrice = entryPrice;
  let exitReason: TradeOutcome["exitReason"] = "time_exit";
  let closedAtBar = startIdx;

  for (let i = startIdx; i < Math.min(startIdx + LOOKFORWARD_BARS, bars.length); i++) {
    const bar = bars[i];
    if (!bar) break;

    const high = bar.High;
    const low = bar.Low;

    if (direction === "long") {
      const favorable = (high - entryPrice) / rSize;
      const adverse = (entryPrice - low) / rSize;
      mfe = Math.max(mfe, favorable);
      mae = Math.max(mae, adverse);

      if (bar.Low <= stopLoss) {
        exitPrice = stopLoss;
        exitReason = "sl_hit";
        closedAtBar = i;
        break;
      }
      if (bar.High >= takeProfit) {
        exitPrice = takeProfit;
        exitReason = "tp_hit";
        closedAtBar = i;
        break;
      }
    } else {
      const favorable = (entryPrice - low) / rSize;
      const adverse = (high - entryPrice) / rSize;
      mfe = Math.max(mfe, favorable);
      mae = Math.max(mae, adverse);

      if (bar.High >= stopLoss) {
        exitPrice = stopLoss;
        exitReason = "sl_hit";
        closedAtBar = i;
        break;
      }
      if (bar.Low <= takeProfit) {
        exitPrice = takeProfit;
        exitReason = "tp_hit";
        closedAtBar = i;
        break;
      }
    }
  }

  if (exitReason === "time_exit") {
    exitPrice = bars[Math.min(closedAtBar, bars.length - 1)]?.Close ?? entryPrice;
    closedAtBar = Math.min(startIdx + LOOKFORWARD_BARS - 1, bars.length - 1);
  }

  const pnlPrice = direction === "long" ? exitPrice - entryPrice : entryPrice - exitPrice;
  const achievedR = pnlPrice / rSize;
  const won = exitReason === "tp_hit" || (exitReason === "time_exit" && pnlPrice > 0);

  return {
    confirmationId: confirmation.id,
    symbol: confirmation.symbol,
    confirmedAt: confirmation.confirmedAt,
    closedAt: bars[closedAtBar]?.Timestamp ?? "",
    direction,
    entryPrice,
    exitPrice,
    stopLoss,
    takeProfit,
    exitReason,
    mfeR: round2(mfe),
    maeR: round2(mae),
    achievedR: round2(achievedR),
    won,
    pnlR: round2(won ? 1 : -1), // simplified: TP = +1R, SL = -1R, time = partial
    pnlPrice: round4(pnlPrice),
    barsHeld: closedAtBar - startIdx,
    entryRegime: confirmation.regime.regime,
    setupType: confirmation.setupType,
  };
}

/** Compute full quant metrics from a list of outcomes */
function computeMetrics(
  symbol: string,
  outcomes: TradeOutcome[],
  confirmations: SetupConfirmation[],
  bars: OHLCVBar[],
  timeframe: string,
): QuantMetrics {
  const completed = outcomes.filter((o) => o.exitReason !== "time_exit");
  const wins = completed.filter((o) => o.won);
  const losses = completed.filter((o) => !o.won);

  const winRate = completed.length > 0 ? wins.length / completed.length : 0;
  const avgWinR = wins.length > 0 ? wins.reduce((s, o) => s + o.mfeR, 0) / wins.length : 0;
  const avgLossR = losses.length > 0 ? losses.reduce((s, o) => s + o.maeR, 0) / losses.length : 0;
  const grossWins = wins.reduce((s, o) => s + Math.abs(o.pnlPrice), 0);
  const grossLosses = losses.reduce((s, o) => s + Math.abs(o.pnlPrice), 0);
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 1;
  const avgR = completed.length > 0 ? completed.reduce((s, o) => s + o.achievedR, 0) / completed.length : 0;
  const expectancy = winRate * avgWinR - (1 - winRate) * avgLossR;

  // Equity curve
  const equityCurve: QuantMetrics["equityCurve"] = [];
  let cumR = 0;
  let peak = 0;
  let maxDD = 0;
  let streak = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let currentStreak = 0;

  for (let i = 0; i < completed.length; i++) {
    const o = completed[i];
    cumR += o.pnlR;
    peak = Math.max(peak, cumR);
    const dd = peak - cumR;
    maxDD = Math.max(maxDD, dd);
    equityCurve.push({ trade: i + 1, cumR: round2(cumR), drawdown: round2(-dd) });

    if (o.won) {
      currentStreak = currentStreak > 0 ? currentStreak + 1 : 1;
      maxWinStreak = Math.max(maxWinStreak, currentStreak);
    } else {
      currentStreak = currentStreak < 0 ? currentStreak - 1 : -1;
      maxLossStreak = Math.max(maxLossStreak, Math.abs(currentStreak));
    }
  }

  // Sharpe (using R returns, annualize by # trades per year estimate)
  const rReturns = completed.map((o) => o.pnlR);
  const meanR = rReturns.length > 0 ? rReturns.reduce((s, r) => s + r, 0) / rReturns.length : 0;
  const stdR = rReturns.length > 1
    ? Math.sqrt(rReturns.reduce((s, r) => s + (r - meanR) ** 2, 0) / (rReturns.length - 1))
    : 1;
  const annFactor = Math.sqrt(252 * 6.5); // approx trades per year assumption
  const sharpe = stdR > 0 ? (meanR / stdR) * annFactor : 0;

  // Sortino (downside only)
  const downReturns = rReturns.filter((r) => r < 0);
  const downStd = downReturns.length > 1
    ? Math.sqrt(downReturns.reduce((s, r) => s + r ** 2, 0) / downReturns.length)
    : stdR;
  const sortino = downStd > 0 ? (meanR / downStd) * annFactor : 0;

  // Calmar
  const annReturn = meanR * Math.min(completed.length, 252);
  const calmar = maxDD > 0 ? annReturn / maxDD : annReturn > 0 ? 999 : 0;

  // MFE/MAE stats
  const avgMFE = completed.length > 0 ? completed.reduce((s, o) => s + o.mfeR, 0) / completed.length : 0;
  const avgMAE = completed.length > 0 ? completed.reduce((s, o) => s + o.maeR, 0) / completed.length : 0;
  const sortedMAE = losses.map((o) => o.maeR).sort((a, b) => a - b);
  const p90MAE = sortedMAE.length > 0 ? sortedMAE[Math.floor(sortedMAE.length * 0.9)] : 1;

  // Regime breakdown
  const winRateByRegime: QuantMetrics["winRateByRegime"] = {};
  for (const o of completed) {
    const r = o.entryRegime;
    if (!winRateByRegime[r]) winRateByRegime[r] = { wins: 0, total: 0, wr: 0 };
    winRateByRegime[r].total++;
    if (o.won) winRateByRegime[r].wins++;
  }
  for (const r of Object.keys(winRateByRegime)) {
    winRateByRegime[r].wr = round2(winRateByRegime[r].wins / winRateByRegime[r].total);
  }

  // Setup type breakdown
  const winRateBySetup: QuantMetrics["winRateBySetup"] = {};
  for (const o of completed) {
    const s = o.setupType;
    if (!winRateBySetup[s]) winRateBySetup[s] = { wins: 0, total: 0, wr: 0 };
    winRateBySetup[s].total++;
    if (o.won) winRateBySetup[s].wins++;
  }
  for (const s of Object.keys(winRateBySetup)) {
    winRateBySetup[s].wr = round2(winRateBySetup[s].wins / winRateBySetup[s].total);
  }

  // MTF breakdown
  const mtfAligned = confirmations.filter((c, i) => c.mtfAligned && i < completed.length);
  const mtfDiv = confirmations.filter((c, i) => !c.mtfAligned && i < completed.length);
  const mtfAlignedWins = mtfAligned.filter((_, i) => completed[i]?.won).length;
  const mtfDivWins = mtfDiv.filter((_, i) => completed[i]?.won).length;
  const mtfAlignedWR = mtfAligned.length > 0 ? mtfAlignedWins / mtfAligned.length : 0;
  const mtfDivWR = mtfDiv.length > 0 ? mtfDivWins / mtfDiv.length : 0;

  // Build Rulebook from empirical evidence
  const rulebook = buildRulebook(outcomes, confirmations, winRateByRegime, winRateBySetup, mtfAlignedWR, mtfDivWR);

  return {
    symbol,
    timeframeTested: timeframe,
    periodStart: bars[0]?.Timestamp ?? "",
    periodEnd: bars[bars.length - 1]?.Timestamp ?? "",
    barsAnalyzed: bars.length,
    totalSetups: confirmations.length,
    completedTrades: completed.length,
    winRate: round2(winRate),
    lossRate: round2(1 - winRate),
    winCount: wins.length,
    lossCount: losses.length,
    avgWinR: round2(avgWinR),
    avgLossR: round2(avgLossR),
    avgR: round2(avgR),
    profitFactor: round2(profitFactor),
    expectancy: round2(expectancy),
    sharpeRatio: round2(sharpe),
    sortinoRatio: round2(sortino),
    calmarRatio: round2(calmar),
    maxDrawdownR: round2(maxDD),
    maxLosingStreak: maxLossStreak,
    maxWinningStreak: maxWinStreak,
    avgMFE: round2(avgMFE),
    avgMAE: round2(avgMAE),
    optimalStopR: round2(p90MAE),
    winRateByRegime,
    winRateBySetup,
    mtfAlignedWR: round2(mtfAlignedWR),
    mtfDivergentWR: round2(mtfDivWR),
    equityCurve,
    rulebook,
  };
}

/** Build an empirical rulebook from backtest results */
function buildRulebook(
  outcomes: TradeOutcome[],
  confirmations: SetupConfirmation[],
  regimeBreakdown: QuantMetrics["winRateByRegime"],
  setupBreakdown: QuantMetrics["winRateBySetup"],
  mtfAlignedWR: number,
  mtfDivWR: number,
): RulebookEntry[] {
  const rules: RulebookEntry[] = [];

  // Rule: MTF alignment
  if (mtfAlignedWR > mtfDivWR + 0.10 && confirmations.filter((c) => c.mtfAligned).length >= 10) {
    rules.push({
      rule: "MTF_ALIGNMENT_REQUIRED",
      condition: "Multi-timeframe bias aligned (1m + 5m same direction)",
      winRate: mtfAlignedWR,
      sampleSize: confirmations.filter((c) => c.mtfAligned).length,
      confidence: "high",
      action: "require",
    });
  }

  // Rule: Regime filtering
  for (const [regime, stats] of Object.entries(regimeBreakdown)) {
    if (stats.total >= 5) {
      if (stats.wr >= 0.65) {
        rules.push({
          rule: `REGIME_${regime.toUpperCase()}_FAVORABLE`,
          condition: `Market regime is '${regime}'`,
          winRate: stats.wr,
          sampleSize: stats.total,
          confidence: stats.total >= 20 ? "high" : stats.total >= 10 ? "medium" : "low",
          action: "prefer",
        });
      } else if (stats.wr <= 0.35) {
        rules.push({
          rule: `REGIME_${regime.toUpperCase()}_AVOID`,
          condition: `Market regime is '${regime}'`,
          winRate: stats.wr,
          sampleSize: stats.total,
          confidence: stats.total >= 20 ? "high" : stats.total >= 10 ? "medium" : "low",
          action: "avoid",
        });
      }
    }
  }

  // Rule: Setup type quality
  for (const [setup, stats] of Object.entries(setupBreakdown)) {
    if (stats.total >= 5) {
      if (stats.wr >= 0.60) {
        rules.push({
          rule: `SETUP_${setup.toUpperCase()}_QUALITY`,
          condition: `Setup pattern is '${setup}'`,
          winRate: stats.wr,
          sampleSize: stats.total,
          confidence: stats.total >= 20 ? "high" : "medium",
          action: "prefer",
        });
      } else if (stats.wr <= 0.40) {
        rules.push({
          rule: `SETUP_${setup.toUpperCase()}_WEAK`,
          condition: `Setup pattern is '${setup}'`,
          winRate: stats.wr,
          sampleSize: stats.total,
          confidence: stats.total >= 20 ? "high" : "medium",
          action: "avoid",
        });
      }
    }
  }

  // Rule: Orderflow confirmation
  const ofConfirmed = outcomes.filter((_, i) => confirmations[i]?.orderflow?.bias !== "neutral");
  const ofNeutral = outcomes.filter((_, i) => confirmations[i]?.orderflow?.bias === "neutral");
  if (ofConfirmed.length >= 5 && ofNeutral.length >= 5) {
    const ofWR = ofConfirmed.filter((o) => o.won).length / ofConfirmed.length;
    const noWR = ofNeutral.filter((o) => o.won).length / ofNeutral.length;
    if (ofWR > noWR + 0.10) {
      rules.push({
        rule: "ORDERFLOW_CONFIRMATION",
        condition: "Orderflow bias matches trade direction",
        winRate: ofWR,
        sampleSize: ofConfirmed.length,
        confidence: ofConfirmed.length >= 20 ? "high" : "medium",
        action: "prefer",
      });
    }
  }

  return rules.sort((a, b) => b.winRate - a.winRate);
}

// ── Main Backtest Function ─────────────────────────────────────────────────

export interface BacktestRequest {
  symbol: string;
  bars1m: OHLCVBar[];
  bars5m: OHLCVBar[];
  timeframe?: string;
}

export interface BacktestResult {
  confirmations: SetupConfirmation[];
  outcomes: TradeOutcome[];
  metrics: QuantMetrics;
  computedAt: string;
  latencyMs: number;
}

/**
 * Run a full walk-forward backtest on historical bars.
 * This is the main entry point for the L7 Backtest Agent.
 */
export function runBacktest(req: BacktestRequest): BacktestResult {
  const { symbol, bars1m, bars5m, timeframe = "1Min" } = req;
  const start = Date.now();

  const confirmations: SetupConfirmation[] = [];
  const outcomes: TradeOutcome[] = [];

  // Walk forward bar by bar — skip last LOOKFORWARD_BARS (no outcome data yet)
  const endIdx = Math.max(0, bars1m.length - LOOKFORWARD_BARS);
  let lastConfirmIdx = -20; // Prevent confirmation clusters (min gap between trades)

  for (let i = MIN_BARS_FOR_STRUCTURE; i < endIdx; i++) {
    // Enforce minimum bar gap between setups (prevent over-trading same move)
    if (i - lastConfirmIdx < 10) continue;

    const confirmation = detectConfirmation(symbol, bars1m, bars5m, i);
    if (!confirmation) continue;

    confirmations.push(confirmation);
    lastConfirmIdx = i;

    // Resolve outcome by walking forward
    const outcome = resolveOutcome(confirmation, bars1m, i + 1);
    if (outcome) outcomes.push(outcome);
  }

  const metrics = computeMetrics(symbol, outcomes, confirmations, bars1m, timeframe);

  // ── Bidirectional Learning: feed backtest outcomes into continuous learning ──
  try {
    const { ingestBacktestResults } = require("./continuous_learning");
    const ingestPayload = outcomes.map((o: TradeOutcome) => {
      const conf = confirmations.find(c => c.id === o.confirmationId);
      return {
        symbol: o.symbol,
        setup_type: conf?.setupType ?? "unknown",
        direction: o.direction,
        regime: "backtest",
        structure_score: conf?.structure?.activeOBCount ? Math.min(1, conf.structure.activeOBCount / 5) : 0.5,
        order_flow_score: 0.5,
        recall_score: 0.5,
        final_quality: Math.max(0, Math.min(1, o.achievedR / 3)),
        outcome: o.won ? "win" as const : "loss" as const,
        entry_price: o.entryPrice,
        stop_loss: o.stopLoss,
        take_profit: o.takeProfit,
        realized_pnl: o.pnlR,
      };
    });
    // Fire-and-forget — don't block synchronous return
    ingestBacktestResults(ingestPayload).catch(() => {});
  } catch {
    // continuous_learning may not be loaded yet — non-fatal
  }

  return {
    confirmations,
    outcomes,
    metrics,
    computedAt: new Date().toISOString(),
    latencyMs: Date.now() - start,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toSMCBar(b: OHLCVBar): any {
  return { Timestamp: b.Timestamp, Open: b.Open, High: b.High, Low: b.Low, Close: b.Close, Volume: b.Volume };
}

function toAlpacaBar(b: OHLCVBar): any {
  return { t: b.Timestamp, o: b.Open, h: b.High, l: b.Low, c: b.Close, v: b.Volume, Open: b.Open, High: b.High, Low: b.Low, Close: b.Close, Volume: b.Volume };
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}
