import type {
  Bar, Config, NewsEvent, NoTradeSignal, OrderBlock1H, RejectionReason, Signal,
} from "./types";
import { DEFAULT_CONFIG } from "./types";
import { atr } from "./atr";
import {
  detectPivots, findBOSDownAfter, findLatestBOSUp, isBullishStructure,
} from "./structure";
import { displacementATR, findOrderBlockForBOS } from "./order_block";
import { findRetestConfirmation } from "./retest";
import { atrTooLow, inNewsWindow } from "./filters";
import { buildLongSignal } from "./signal";

export interface EvaluateInput {
  symbol: string;        // accepted for caller convenience (e.g. logging) but NOT part of output
  bars: Bar[];
  news?: NewsEvent[];
  config?: Partial<Config>;
}

function noTrade(bars: Bar[], reason: RejectionReason): NoTradeSignal {
  const ts = bars.length > 0 ? bars[bars.length - 1]!.Timestamp : new Date(0).toISOString();
  return { kind: "no_trade", timestamp: ts, reason };
}

export function evaluate(input: EvaluateInput): Signal {
  const cfg: Config = { ...DEFAULT_CONFIG, ...(input.config ?? {}) };
  const bars = input.bars;

  const minBars = Math.max(
    cfg.atrPeriod + cfg.pivotLeft + cfg.pivotRight + 2,
    cfg.atrAvgWindow,
  );
  if (bars.length < minBars) return noTrade(bars, "insufficient_bars");

  const atrSeries = atr(bars, cfg.atrPeriod);
  const pivots = detectPivots(bars, cfg.pivotLeft, cfg.pivotRight);
  const lastIndex = bars.length - 1;

  const bos = findLatestBOSUp(bars, pivots, lastIndex, cfg.pivotRight);
  if (!bos) return noTrade(bars, "no_bos_up");

  const obFound = findOrderBlockForBOS(bars, bos.bosIndex, bos.brokenSwingIndex);
  if (!obFound) return noTrade(bars, "no_order_block");

  const atrAtBos = atrSeries[bos.bosIndex]!;
  const dispATR = displacementATR(bars, obFound.obIndex, bos.bosIndex, atrAtBos);
  const ob: OrderBlock1H = {
    obIndex: obFound.obIndex,
    bosIndex: bos.bosIndex,
    obLow: obFound.obLow,
    obHigh: obFound.obHigh,
    displacementATR: dispATR,
  };
  if (dispATR < cfg.minDisplacementATR) return noTrade(bars, "displacement_too_small");

  const retest = findRetestConfirmation(bars, ob, cfg.maxRetestBars, cfg.obBreakBufferPct);
  if (retest.kind === "ob_broken") return noTrade(bars, "ob_broken_before_retest");
  if (retest.kind === "expired")  return noTrade(bars, "retest_window_expired");

  const oppBosDown = findBOSDownAfter(
    bars, pivots, bos.bosIndex + 1, retest.index, cfg.pivotRight,
  );
  if (oppBosDown !== null && oppBosDown < retest.index) {
    return noTrade(bars, "opposite_bos_before_retest");
  }

  const sigIdx = retest.index;
  // Filter precedence: regime → atr → news (most fundamental first)
  if (cfg.requireBullishStructure && !isBullishStructure(pivots, sigIdx, cfg.pivotRight)) {
    return noTrade(bars, "regime_not_bullish");
  }
  if (atrTooLow(atrSeries, sigIdx, cfg.atrAvgWindow, cfg.minATRRatio)) {
    return noTrade(bars, "atr_too_low");
  }
  if (inNewsWindow(bars[sigIdx]!.Timestamp, input.news, cfg.newsBlockMinutes)) {
    return noTrade(bars, "news_window");
  }

  const atrAtSig = atrSeries[sigIdx]!;
  return buildLongSignal(bars, ob, sigIdx, atrAtSig, cfg);
}
