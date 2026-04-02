export interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: string;
}

export interface FeatureVector {
  symbol: string;
  timeframe: string;
  timestamp: string;
  // Returns
  log_return: number;
  rolling_mean_return_20: number;
  rolling_std_20: number;
  // Volatility
  realized_vol: number;
  atr_14: number;
  vol_of_vol: number;
  // Momentum
  momentum_5: number;
  momentum_20: number;
  rsi_14: number;
  // Structure
  range_pct: number;
  body_pct: number;
  upper_wick_pct: number;
  lower_wick_pct: number;
  // Volume
  relative_volume: number;
  volume_sma_20: number;
  // Session
  session_label: string;
}

export function computeRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50; // neutral default
  
  const changes = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }
  
  const gains = changes.filter((c) => c > 0).reduce((a, b) => a + b, 0);
  const losses = changes.filter((c) => c < 0).reduce((a, b) => a + Math.abs(b), 0);
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function computeATR(bars: OHLCV[], period: number = 14): number {
  if (bars.length < period) return 0;
  
  const trs: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const curr = bars[i];
    if (i === 0) {
      trs.push(curr.high - curr.low);
    } else {
      const prev = bars[i - 1];
      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close)
      );
      trs.push(tr);
    }
  }
  
  // SMA of TR for simplicity
  const recentTRs = trs.slice(-period);
  return recentTRs.reduce((a, b) => a + b, 0) / period;
}

export function computeRollingStd(values: number[], window: number): number {
  if (values.length < window) return 0;
  
  const windowVals = values.slice(-window);
  const mean = windowVals.reduce((a, b) => a + b, 0) / window;
  const variance = windowVals.reduce(
    (sum, v) => sum + Math.pow(v - mean, 2),
    0
  ) / window;
  
  return Math.sqrt(variance);
}

export function getSessionLabel(timestamp: string): string {
  const date = new Date(timestamp);
  const utcHour = date.getUTCHours();
  
  // Session windows (UTC):
  // Asia: 22:00-08:00 (22-23, 0-7)
  // London: 08:00-12:00 (8-11)
  // New York: 13:00-21:00 (13-20)
  // Overlap: varies
  
  if (utcHour >= 22 || utcHour < 2) {
    return "asia";
  } else if (utcHour >= 2 && utcHour < 8) {
    return "pre_market";
  } else if (utcHour >= 8 && utcHour < 12) {
    return "london";
  } else if (utcHour >= 12 && utcHour < 13) {
    return "london_ny_overlap";
  } else if (utcHour >= 13 && utcHour < 21) {
    return "new_york";
  } else {
    return "after_hours";
  }
}

export function computeFeatures(
  bars: OHLCV[],
  symbol: string,
  timeframe: string
): FeatureVector {
  if (bars.length === 0) {
    throw new Error("Empty bars array");
  }
  
  const current = bars[bars.length - 1];
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  
  // Log returns
  const logReturn =
    bars.length >= 2
      ? Math.log(current.close / bars[bars.length - 2].close)
      : 0;
  
  // Rolling mean return (last 20 bars)
  const recentCloses = closes.slice(-20);
  const returns20 = [];
  for (let i = 1; i < recentCloses.length; i++) {
    returns20.push(Math.log(recentCloses[i] / recentCloses[i - 1]));
  }
  const rollingMeanReturn20 =
    returns20.length > 0 ? returns20.reduce((a, b) => a + b, 0) / returns20.length : 0;
  
  // Rolling std of returns (last 20 bars)
  const rollingStd20 = computeRollingStd(returns20, returns20.length);
  
  // Realized volatility (annualized from last 20 returns)
  const realizedVol20 = rollingStd20 * Math.sqrt(252);
  
  // ATR
  const atr14 = computeATR(bars, 14);
  
  // Vol of vol: std of returns over 20 bars (can use rolling)
  const volOfVol = computeRollingStd(returns20, Math.min(10, returns20.length));
  
  // Momentum: log return change over 5 and 20 bars
  const momentum5 =
    bars.length >= 5 ? Math.log(current.close / bars[bars.length - 5].close) : 0;
  const momentum20 =
    bars.length >= 20 ? Math.log(current.close / bars[bars.length - 20].close) : 0;
  
  // RSI
  const rsi14 = computeRSI(closes, 14);
  
  // Candle structure
  const range = current.high - current.low;
  const body = Math.abs(current.close - current.open);
  const upperWick = current.high - Math.max(current.open, current.close);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  
  const rangePct = range > 0 ? range / current.close : 0;
  const bodyPct = range > 0 ? body / range : 0;
  const upperWickPct = range > 0 ? upperWick / range : 0;
  const lowerWickPct = range > 0 ? lowerWick / range : 0;
  
  // Relative volume
  const volumeSMA20 =
    volumes.length >= 20
      ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20
      : volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const relativeVolume = volumeSMA20 > 0 ? current.volume / volumeSMA20 : 0;
  
  // Session
  const session = getSessionLabel(current.timestamp);
  
  return {
    symbol,
    timeframe,
    timestamp: current.timestamp,
    log_return: logReturn,
    rolling_mean_return_20: rollingMeanReturn20,
    rolling_std_20: rollingStd20,
    realized_vol: realizedVol20,
    atr_14: atr14,
    vol_of_vol: volOfVol,
    momentum_5: momentum5,
    momentum_20: momentum20,
    rsi_14: rsi14,
    range_pct: rangePct,
    body_pct: bodyPct,
    upper_wick_pct: upperWickPct,
    lower_wick_pct: lowerWickPct,
    relative_volume: relativeVolume,
    volume_sma_20: volumeSMA20,
    session_label: session,
  };
}

export function computeFeatureSeries(
  bars: OHLCV[],
  symbol: string,
  timeframe: string
): FeatureVector[] {
  const features: FeatureVector[] = [];
  
  // Compute features for each bar, starting from bar 20 (need enough history)
  for (let i = Math.max(0, 20); i < bars.length; i++) {
    const barSlice = bars.slice(0, i + 1);
    const feature = computeFeatures(barSlice, symbol, timeframe);
    features.push(feature);
  }
  
  return features;
}
