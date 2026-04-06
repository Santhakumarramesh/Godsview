/**
 * Golden Test Suite for GodsView Quant Decision Loop
 * Phase 88: Hard Evidence Layer
 * 
 * 20 realistic strategy test cases covering the full difficulty spectrum.
 * Each case includes messy user input, expected interpretations, contradictions,
 * and final verdict to measure decision loop quality.
 */

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD' | 'ADVERSARIAL' | 'EDGE_CASE';
export type Verdict = 'PASS' | 'SOFT_REJECT' | 'HARD_REJECT';

export interface EdgeMechanism {
  description: string;
  strength: 'strong' | 'medium' | 'weak' | 'none';
  isNull: boolean;
}

export interface GoldenTestCase {
  id: string;
  title: string;
  rawInput: string;
  difficulty: Difficulty;
  tags: string[];
  
  expectedInterpretations: {
    assets: string[];
    timeframe: string;
    signals: string[];
    rules: string[];
    riskManagement: string;
  };
  
  expectedContradictions: {
    isPresent: boolean;
    conflicts: string[];
    severity: 'none' | 'minor' | 'major' | 'fatal';
  };
  
  expectedEdgeMechanism: EdgeMechanism;
  
  expectedVerdict: Verdict;
  rejectionReason?: string;
}

export const GOLDEN_STRATEGIES: GoldenTestCase[] = [
  // ============================================================================
  // EASY (4) - Clean, well-specified strategies
  // ============================================================================
  
  {
    id: 'EASY_001',
    title: 'RSI Mean Reversion - SPY',
    rawInput: `
      Trade SPY when RSI(14) drops below 30. Buy at market open next day.
      Exit when RSI crosses above 70 or after 5 days, whichever comes first.
      Risk 1% per trade. Stop loss at 2% below entry.
    `,
    difficulty: 'EASY',
    tags: ['momentum', 'mean_reversion', 'momentum_indicator', 'equities', 'clear_spec'],
    expectedInterpretations: {
      assets: ['SPY'],
      timeframe: 'daily',
      signals: ['RSI(14) < 30', 'RSI > 70'],
      rules: ['Buy at market open next day', 'Exit on RSI > 70 or 5 days'],
      riskManagement: '1% risk per trade, 2% stop loss'
    },
    expectedContradictions: {
      isPresent: false,
      conflicts: [],
      severity: 'none'
    },
    expectedEdgeMechanism: {
      description: 'Reversal following oversold conditions in trending market',
      strength: 'medium',
      isNull: false
    },
    expectedVerdict: 'PASS'
  },

  {
    id: 'EASY_002',
    title: 'Breakout with Volume Confirmation',
    rawInput: `
      Watch the EUR/USD hourly chart. When price breaks above the daily high with
      volume > 2x average, enter long immediately. Take profit at +100 pips,
      stop at -50 pips. Position size 2 micro lots.
    `,
    difficulty: 'EASY',
    tags: ['breakout', 'volume', 'forex', 'hourly', 'technical'],
    expectedInterpretations: {
      assets: ['EUR/USD'],
      timeframe: 'hourly',
      signals: ['Price > daily high', 'Volume > 2x average'],
      rules: ['Enter long on breakout', 'TP +100 pips', 'SL -50 pips'],
      riskManagement: '2 micro lots fixed'
    },
    expectedContradictions: {
      isPresent: false,
      conflicts: [],
      severity: 'none'
    },
    expectedEdgeMechanism: {
      description: 'Momentum continuation after key level break with volume confirmation',
      strength: 'medium',
      isNull: false
    },
    expectedVerdict: 'PASS'
  },

  {
    id: 'EASY_003',
    title: 'Gap Fill Strategy - Futures',
    rawInput: `
      Trade ES (E-mini S&P 500). At market open, if gap is > 10 points,
      fade the gap. Short at open + 5 points, target open price (gap fill).
      Use 20 point stop loss. Trade only first 30 minutes.
    `,
    difficulty: 'EASY',
    tags: ['gap_fill', 'mean_reversion', 'futures', 'intraday', 'mechanical'],
    expectedInterpretations: {
      assets: ['ES'],
      timeframe: '30-minute intraday',
      signals: ['Gap > 10 points', 'Price deviation from open'],
      rules: ['Short at open + 5', 'Target = gap fill', 'First 30 min only'],
      riskManagement: '20 point stop loss'
    },
    expectedContradictions: {
      isPresent: false,
      conflicts: [],
      severity: 'none'
    },
    expectedEdgeMechanism: {
      description: 'Market mean reversion on overnight gaps',
      strength: 'medium',
      isNull: false
    },
    expectedVerdict: 'PASS'
  },

  {
    id: 'EASY_004',
    title: 'Moving Average Crossover - Crypto',
    rawInput: `
      BTC/USDT on 4-hour chart. Buy when 20 EMA crosses above 50 EMA.
      Hold until 20 EMA crosses below 50 EMA or 14 days pass.
      No stop loss, let winners run. Position = 1 BTC.
    `,
    difficulty: 'EASY',
    tags: ['moving_average', 'trend_following', 'crypto', '4h', 'simple'],
    expectedInterpretations: {
      assets: ['BTC/USDT'],
      timeframe: '4-hour',
      signals: ['20 EMA > 50 EMA', 'Golden cross'],
      rules: ['Buy on 20 > 50 crossover', 'Sell on death cross or 14 days'],
      riskManagement: 'None specified - full position 1 BTC'
    },
    expectedContradictions: {
      isPresent: false,
      conflicts: [],
      severity: 'none'
    },
    expectedEdgeMechanism: {
      description: 'Trend following momentum capture',
      strength: 'medium',
      isNull: false
    },
    expectedVerdict: 'PASS'
  },

  // ============================================================================
  // MEDIUM (5) - Some ambiguity, mixed signals, incomplete specs
  // ============================================================================

  {
    id: 'MEDIUM_001',
    title: 'Multi-Indicator Confirmation',
    rawInput: `
      Looking at AAPL daily. When RSI is oversold (below 35), MACD shows
      bullish divergence, AND the stock closes near the high of the day,
      that's a strong buy signal. Risk about 2-3% maybe? Haven't decided on
      exact stop yet but somewhere below the swing low I guess.
    `,
    difficulty: 'MEDIUM',
    tags: ['multiple_indicators', 'confirmation', 'ambiguity', 'incomplete_risk'],
    expectedInterpretations: {
      assets: ['AAPL'],
      timeframe: 'daily',
      signals: ['RSI < 35', 'MACD bullish divergence', 'Close near high'],
      rules: ['All three conditions required for entry'],
      riskManagement: 'Vague: 2-3% risk, stop below swing low (undefined)'
    },
    expectedContradictions: {
      isPresent: true,
      conflicts: [
        'RSI oversold typically means mean reversion BUT MACD bullish divergence is trend continuation signal',
        'Risk is unspecified (2-3%?) and stop location unclear'
      ],
      severity: 'minor'
    },
    expectedEdgeMechanism: {
      description: 'Multiple confirmation for reversal from oversold',
      strength: 'weak',
      isNull: false
    },
    expectedVerdict: 'SOFT_REJECT'
  },

  {
    id: 'MEDIUM_002',
    title: 'Pairs Trading - Underspecified',
    rawInput: `
      Pair GLD (gold) with DBC (commodities). When they diverge more than
      2 standard deviations, we go long the underperformer and short the
      outperformer. Something about mean reversion? Exit when they converge
      again I think. Need to backtest this but it feels right.
    `,
    difficulty: 'MEDIUM',
    tags: ['pairs_trading', 'correlation', 'vague', 'untested'],
    expectedInterpretations: {
      assets: ['GLD', 'DBC'],
      timeframe: 'unspecified',
      signals: ['Divergence > 2 std dev'],
      rules: ['Long underperformer, short outperformer', 'Exit on convergence'],
      riskManagement: 'None specified'
    },
    expectedContradictions: {
      isPresent: true,
      conflicts: [
        'Divergence trigger not clearly defined (rolling correlation? Z-score of what?)',
        'No risk management or position sizing',
        'Convergence target not quantified'
      ],
      severity: 'major'
    },
    expectedEdgeMechanism: {
      description: 'Mean reversion in correlated asset pairs',
      strength: 'weak',
      isNull: true
    },
    expectedVerdict: 'SOFT_REJECT'
  },

  {
    id: 'MEDIUM_003',
    title: 'Sector Rotation - Vague Timing',
    rawInput: `
      Rotate between SPY, XLF (financials), XLV (healthcare) based on
      macro conditions. When rates are rising, overweight financials.
      When inflation is high, go to healthcare. Use some kind of risk parity
      weighting but I'm flexible on the exact numbers. Rebalance quarterly.
    `,
    difficulty: 'MEDIUM',
    tags: ['sector_rotation', 'macro', 'weighting_ambiguity', 'regime_dependent'],
    expectedInterpretations: {
      assets: ['SPY', 'XLF', 'XLV'],
      timeframe: 'quarterly',
      signals: ['Rate environment', 'Inflation regime'],
      rules: ['Rising rates -> overweight XLF', 'High inflation -> overweight XLV'],
      riskManagement: 'Risk parity weighting (not specified)'
    },
    expectedContradictions: {
      isPresent: true,
      conflicts: [
        'How to measure "rising rates" and "high inflation"? Which indicators?',
        'Risk parity weights not defined',
        'Regime overlap not addressed (high rates AND high inflation)'
      ],
      severity: 'major'
    },
    expectedEdgeMechanism: {
      description: 'Sector outperformance in different macro regimes',
      strength: 'medium',
      isNull: false
    },
    expectedVerdict: 'SOFT_REJECT'
  },

  {
    id: 'MEDIUM_004',
    title: 'Options Income with Mixed Specs',
    rawInput: `
      Sell 30-delta call spreads on QQQ weekly expiries. Collect 20% of width
      for credit, manage when it reaches 21% profit or 50% loss. Do 3-4 spreads
      per week depending on how much capital I have that day. Mostly hedged but
      haven't figured out the exact hedge ratio yet.
    `,
    difficulty: 'MEDIUM',
    tags: ['options', 'income', 'position_sizing_vague', 'risk_undefined'],
    expectedInterpretations: {
      assets: ['QQQ options'],
      timeframe: 'weekly',
      signals: ['30-delta calls'],
      rules: ['Sell call spreads, 20% credit collection', 'Exit at 21% profit or 50% loss'],
      riskManagement: 'Partial hedge (ratio undefined), position size varies daily'
    },
    expectedContradictions: {
      isPresent: true,
      conflicts: [
        'Position sizing is ad-hoc ("3-4 spreads depending on capital that day")',
        'Hedge ratio not defined',
        'Risk exposure not calculated'
      ],
      severity: 'major'
    },
    expectedEdgeMechanism: {
      description: 'Theta decay capture on overpriced short-dated options',
      strength: 'medium',
      isNull: false
    },
    expectedVerdict: 'SOFT_REJECT'
  },

  {
    id: 'MEDIUM_005',
    title: 'Mean Reversion on Intraday Swings',
    rawInput: `
      Trade TSLA intraday. Every time it swings 2% from open in either direction,
      fade it. Buy if down 2%, sell if up 2%. Hold for 1-2 hours or until
      we get back to within 0.5% of open. Use 1:2 risk:reward roughly.
      Trade each swing once per day max.
    `,
    difficulty: 'MEDIUM',
    tags: ['mean_reversion', 'intraday', 'swing', 'underspecified_reward'],
    expectedInterpretations: {
      assets: ['TSLA'],
      timeframe: 'intraday / hourly',
      signals: ['2% move from open', 'Price mean reversion signal'],
      rules: ['Fade 2% swings', 'Hold 1-2 hours or 0.5% from open', 'One swing per day'],
      riskManagement: 'Roughly 1:2 risk:reward (vague)'
    },
    expectedContradictions: {
      isPresent: true,
      conflicts: [
        'Risk:reward is "roughly" - not precise',
        'Exit on either time (1-2h) or price (0.5% from open) creates ambiguity',
        'Position size not specified'
      ],
      severity: 'minor'
    },
    expectedEdgeMechanism: {
      description: 'Intraday mean reversion in volatile single stock',
      strength: 'weak',
      isNull: false
    },
    expectedVerdict: 'SOFT_REJECT'
  },

  // ============================================================================
  // HARD (5) - Vague, contradictory, complex multi-leg strategies
  // ============================================================================

  {
    id: 'HARD_001',
    title: 'Complex Multi-Leg with Conflicting Regimes',
    rawInput: `
      This is a portfolio hedge strategy. We're long SPY as core holding.
      When VIX spikes above 25, we short ES to hedge but only if the SPY position
      is down more than 5% because that's when it's worth it. But ALSO if Fed
      is in rate hiking mode we actually want to BE more short because interest
      rates are going up and that's bearish. But historically when VIX is high
      and rates are rising that's often a bounce coming so maybe we go long instead?
      Not sure. Probably need to weight these differently but I have no idea how.
      The idea is to not lose money when things go bad but still make money when
      things are good. Stop losses feel constraining so let's just stop out when
      we've hedged back to even.
    `,
    difficulty: 'HARD',
    tags: ['complex', 'contradictory', 'regime_conflict', 'no_clear_logic'],
    expectedInterpretations: {
      assets: ['SPY', 'ES', 'VIX'],
      timeframe: 'daily',
      signals: [
        'VIX > 25',
        'SPY down 5%',
        'Fed hiking mode',
        'Historical bounce patterns'
      ],
      rules: [
        'Long SPY core',
        'Short ES when VIX > 25 AND SPY < -5%',
        'More short when Fed hiking (contradicts previous)',
        'Go long on VIX + rates rising (contradicts both)'
      ],
      riskManagement: 'Stop at breakeven (circular logic)'
    },
    expectedContradictions: {
      isPresent: true,
      conflicts: [
        'Fed hiking mode: signals both short (bearish) and long (bounce)',
        'When hedged back to even, you stop out, but whats the cumulative P&L?',
        'VIX spike could signal different things depending on context, no clear weighting',
        'No quantification of "Fed hiking mode"'
      ],
      severity: 'fatal'
    },
    expectedEdgeMechanism: {
      description: 'Attempted portfolio hedging with conflicting signals',
      strength: 'none',
      isNull: true
    },
    expectedVerdict: 'HARD_REJECT'
  },

  {
    id: 'HARD_002',
    title: 'Momentum + Reversion Contradiction',
    rawInput: `
      We buy stocks that are making new 52-week highs because momentum.
      BUT we also sell short when they're down the most in the sector because
      they're oversold. Hold for 2-5 weeks. Or maybe 2-5 days if intraday? Exit
      when momentum dies (whatever that means) or target is hit. Target is
      usually 10-15% but depends on how much capital at risk. Use leverage
      sometimes when volatility is low which gives us more edge. Hedge with puts
      but only on the long side. The short side sells calls so technically
      covered. This should beat SPY by 3x over time I think.
    `,
    difficulty: 'HARD',
    tags: ['contradictory', 'mixed_signals', 'leverage', 'unrealistic_returns'],
    expectedInterpretations: {
      assets: ['Various equities'],
      timeframe: 'mixed (2-5 weeks or 2-5 days)',
      signals: ['52-week highs', 'Sector weakness'],
      rules: ['Long new highs (momentum)', 'Short sector laggards (reversion)'],
      riskManagement: 'Leverage, puts, calls (underspecified), target 10-15%'
    },
    expectedContradictions: {
      isPresent: true,
      conflicts: [
        'Buying momentum (new highs) contradicts selling reversion (oversold)',
        'Timeframe unclear (2-5 weeks vs 2-5 days)',
        'Exit condition "momentum dies" is undefined',
        'Target depends on capital at risk (circular)',
        'Leverage increases with low vol (procyclical risk)',
        'Expected outperformance of 3x unrealistic given simple signals',
        'Hedge structure incomplete (puts on longs, calls on shorts - net delta unclear)'
      ],
      severity: 'fatal'
    },
    expectedEdgeMechanism: {
      description: 'Attempted capture of both momentum and reversion',
      strength: 'none',
      isNull: true
    },
    expectedVerdict: 'HARD_REJECT'
  },

  {
    id: 'HARD_003',
    title: 'Vague Macro Timing with No Indicators',
    rawInput: `
      Trade based on when the economy is "good" vs "bad". In good times, buy
      growth stocks and risk assets. In bad times, go defensive and bonds.
      The trick is knowing when we're switching from good to bad. I read the news
      and look at sentiment mostly. Sometimes unemployment reports matter, sometimes
      not. Fed policy obviously but it's complicated. I'll know it when I see it.
      Rebalance probably weekly or monthly or when I feel like the regime changed.
      Each position is usually 5-10% of portfolio I guess. This has worked well
      because I've been right most of the time on the macro calls (in my head).
    `,
    difficulty: 'HARD',
    tags: ['macro', 'vague', 'no_quantification', 'regime_undefined', 'backtest_impossible'],
    expectedInterpretations: {
      assets: ['Growth stocks', 'Bonds', 'Risk assets'],
      timeframe: 'macro regime dependent',
      signals: ['Regime: good vs bad economy'],
      rules: ['Long growth in good times, defensive in bad times'],
      riskManagement: 'Position size 5-10% vague'
    },
    expectedContradictions: {
      isPresent: true,
      conflicts: [
        'No objective definition of "good" vs "bad" economy',
        'Indicators mentioned (unemployment, Fed policy) but not quantified',
        'Rebalance frequency undefined (weekly, monthly, or feeling-based)',
        'No entry/exit rules, pure discretion',
        'Backtesting impossible - relies on hindsight bias ("been right in my head")',
        'Sentiment-based timing without framework'
      ],
      severity: 'fatal'
    },
    expectedEdgeMechanism: {
      description: 'Macro regime switching without clear mechanism',
      strength: 'none',
      isNull: true
    },
    expectedVerdict: 'HARD_REJECT'
  },

  {
    id: 'HARD_004',
    title: 'Statistical Arbitrage - Underspecified Model',
    rawInput: `
      Found a correlation anomaly between oil and energy stocks. When oil leads
      energy stocks, there's a spread trade opportunity. Not sure exactly how to
      measure the lead or lag, probably looking at returns over some rolling window.
      The spread should mean revert, so we long the lagging one and short the leader.
      Or wait, maybe vice versa? The half-life of the spread is critical but
      I haven't calculated it. Scale into trades as the spread gets wider.
      This should be profitable in calm markets but might blow up if correlation
      breaks. That's why it's an edge - because most people don't know about it yet.
      Position size relative to spread magnitude I guess.
    `,
    difficulty: 'HARD',
    tags: ['statistical_arb', 'correlation', 'underspecified', 'model_incomplete'],
    expectedInterpretations: {
      assets: ['Oil', 'Energy stocks'],
      timeframe: 'unknown',
      signals: ['Oil leads energy', 'Correlation anomaly'],
      rules: ['Spread trade on correlation breakdown', 'Scale in on spread widening'],
      riskManagement: 'Position size vague (relative to spread magnitude)'
    },
    expectedContradictions: {
      isPresent: true,
      conflicts: [
        'Lead/lag measurement not defined',
        'Direction unclear (long laggard or long leader?)',
        'Half-life not calculated',
        'Correlation break risk mentioned but not hedged',
        'Position sizing circular (relative to spread magnitude)',
        'Edge claim based on information gap, not sustainable',
        'Model incomplete - what constitutes mean reversion?'
      ],
      severity: 'fatal'
    },
    expectedEdgeMechanism: {
      description: 'Attempted correlation arbitrage with incomplete specification',
      strength: 'none',
      isNull: true
    },
    expectedVerdict: 'HARD_REJECT'
  },

  {
    id: 'HARD_005',
    title: 'Multi-Timeframe Confluence Without Rules',
    rawInput: `
      Trade BTC on multiple timeframes. 1-day shows trend, 4-hour shows momentum,
      1-hour shows entry points. But you have to look at all of them together
      and make sure they're aligned. Also watch the weekly for regime confirmation.
      The monthly tells you if we're in a bull market overall. If everything lines up,
      that's a really high confidence trade. Otherwise wait. The thing is there are
      so many combinations that sometimes they all align and sometimes nothing aligns
      for weeks. When they do align, take the whole position. When they don't,
      don't take anything or maybe scale in if some align. This is more art than science
      so it's hard to define exactly but I've made good money on these.
    `,
    difficulty: 'HARD',
    tags: ['multi_timeframe', 'confluence', 'discretionary', 'backtest_impossible'],
    expectedInterpretations: {
      assets: ['BTC'],
      timeframe: 'multiple (1m, 4h, 1d, 1w, 1mo)',
      signals: ['Timeframe alignment', 'Trend + momentum + entry confluence'],
      rules: ['Trade when all timeframes align', 'Scale or skip when they don\'t'],
      riskManagement: 'Full position on alignment, scaled on partial alignment'
    },
    expectedContradictions: {
      isPresent: true,
      conflicts: [
        'Definition of "aligned" is subjective (art not science)',
        'No rules for partial alignment handling',
        'Entry point definition on 1h unclear',
        'Exit rules completely absent',
        'Frequency and position sizing unclear',
        'Backtesting impossible due to discretion',
        'Sample size bias likely (remembering wins, forgetting losses)'
      ],
      severity: 'fatal'
    },
    expectedEdgeMechanism: {
      description: 'Attempted multi-timeframe confirmation without defined logic',
      strength: 'none',
      isNull: true
    },
    expectedVerdict: 'HARD_REJECT'
  },

  // ============================================================================
  // ADVERSARIAL (3) - Sound good but actually garbage
  // ============================================================================

  {
    id: 'ADVERSARIAL_001',
    title: 'Look-Ahead Bias Wrapped in Logic',
    rawInput: `
      Use the close price from yesterday to predict today's move. Close up yesterday?
      Buy today. Close down yesterday? Short today. Simple and elegant. Run this back
      to 2008 and it works like a charm - average win is 2%, loss is 1%, 65% win rate,
      Sharpe of 2.5. The reason this works is because markets have memory and momentum
      carries over day to day. You need at least a million dollars to avoid slippage issues
      but then it should compound to infinite returns.
    `,
    difficulty: 'ADVERSARIAL',
    tags: ['look_ahead_bias', 'overfitted', 'no_real_edge', 'backtest_error'],
    expectedInterpretations: {
      assets: ['Unknown - backtest universe'],
      timeframe: 'daily',
      signals: ['Previous day close direction'],
      rules: ['Follow yesterday\'s direction'],
      riskManagement: 'Not specified'
    },
    expectedContradictions: {
      isPresent: true,
      conflicts: [
        'Using yesterday\'s close to predict today = look-ahead bias IF using same day\'s data',
        'Actually this is just prior day momentum, but results too good to be true',
        'Sharpe of 2.5 is extraordinarily high - likely overfitting or backtest error',
        'Infinite returns claim is nonsensical (capital constraints, market impact)',
        '"Infinite returns" is red flag for overfitting'
      ],
      severity: 'fatal'
    },
    expectedEdgeMechanism: {
      description: 'False momentum capture due to overfitting',
      strength: 'none',
      isNull: true
    },
    expectedVerdict: 'HARD_REJECT',
    rejectionReason: 'Clear look-ahead bias and unrealistic backtest results indicate overfitting'
  },

  {
    id: 'ADVERSARIAL_002',
    title: 'Survivorship Bias in Historical Strategy',
    rawInput: `
      Buy every IPO in the first week and hold for 6 months. IPOs outperform
      the market on average by 2% in the first 6 months - I checked 20 years of data.
      The strategy has been proven. Just pick IPOs from the last month and let them ride.
      Diversify by buying 10 different IPOs each month. This is low risk because
      IPOs are usually good companies that people are excited about, so they go up.
    `,
    difficulty: 'ADVERSARIAL',
    tags: ['survivorship_bias', 'selection_bias', 'hot_hand', 'no_real_edge'],
    expectedInterpretations: {
      assets: ['IPO stocks'],
      timeframe: '6 months',
      signals: ['IPO launch', 'First week threshold'],
      rules: ['Buy IPO in week 1', 'Hold 6 months'],
      riskManagement: 'Diversify 10 IPOs per month'
    },
    expectedContradictions: {
      isPresent: true,
      conflicts: [
        'IPO outperformance data likely suffers from survivorship bias (failed IPOs not in dataset)',
        'Selection bias: only successful IPOs are remembered',
        'Hot hand fallacy: past outperformance doesn\'t predict future',
        'No risk management for downside',
        'Assumes all IPOs are "good companies" (false)',
        'Ignores IPO underpricing correction and lockup period effects',
        'No consideration of market regime or sector clustering'
      ],
      severity: 'fatal'
    },
    expectedEdgeMechanism: {
      description: 'False edge from data selection bias',
      strength: 'none',
      isNull: true
    },
    expectedVerdict: 'HARD_REJECT',
    rejectionReason: 'Survivorship bias and selection bias destroy strategy - no real edge'
  },

  {
    id: 'ADVERSARIAL_003',
    title: 'Correlation Mistaken for Causation',
    rawInput: `
      Stock returns are highly correlated with Bitcoin price changes. When Bitcoin
      goes up, tech stocks go up the next day. So the strategy is: monitor BTC,
      and when it's about to go up, buy tech ETF QQQ. Use historical correlation
      of 0.78 as the basis. This has worked for 2 years straight. Lately I've been
      using this to trade on every single BTC move and making great returns. It's a
      clear statistical relationship and the edge is there.
    `,
    difficulty: 'ADVERSARIAL',
    tags: ['correlation_causation', 'regime_dependent', 'short_sample', 'curve_fit'],
    expectedInterpretations: {
      assets: ['BTC', 'QQQ'],
      timeframe: 'daily',
      signals: ['BTC price direction', 'Correlation 0.78'],
      rules: ['Buy QQQ when BTC about to go up'],
      riskManagement: 'Not specified'
    },
    expectedContradictions: {
      isPresent: true,
      conflicts: [
        'Correlation is not causation - BTC may not drive QQQ, may be common cause (risk sentiment)',
        'Predicting "BTC about to go up" is itself unsolved problem',
        'Correlation 0.78 is historical, not guaranteed forward (regime change)',
        'Only 2 years of data is short sample',
        'Recent performance may be curve-fitted to recent regime',
        'No explanation for WHY BTC would drive QQQ next day mechanically',
        'Ignores lag/lead confusion and lead time bias'
      ],
      severity: 'fatal'
    },
    expectedEdgeMechanism: {
      description: 'False causal relationship between correlated assets',
      strength: 'none',
      isNull: true
    },
    expectedVerdict: 'HARD_REJECT',
    rejectionReason: 'Correlation mistaken for causation with no predictive mechanism'
  },

  // ============================================================================
  // EDGE CASES (3) - Empty, minimal, or degenerate inputs
  // ============================================================================

  {
    id: 'EDGE_001',
    title: 'Empty Input',
    rawInput: '',
    difficulty: 'EDGE_CASE',
    tags: ['empty', 'no_input', 'malformed'],
    expectedInterpretations: {
      assets: [],
      timeframe: 'undefined',
      signals: [],
      rules: [],
      riskManagement: 'none'
    },
    expectedContradictions: {
      isPresent: false,
      conflicts: [],
      severity: 'none'
    },
    expectedEdgeMechanism: {
      description: 'No strategy provided',
      strength: 'none',
      isNull: true
    },
    expectedVerdict: 'HARD_REJECT',
    rejectionReason: 'No strategy provided'
  },

  {
    id: 'EDGE_002',
    title: 'Single Word Input',
    rawInput: 'BUY',
    difficulty: 'EDGE_CASE',
    tags: ['minimal', 'incomplete', 'no_context'],
    expectedInterpretations: {
      assets: [],
      timeframe: 'undefined',
      signals: [],
      rules: ['Buy signal only'],
      riskManagement: 'none'
    },
    expectedContradictions: {
      isPresent: true,
      conflicts: ['No asset specified', 'No exit rules', 'No risk management'],
      severity: 'fatal'
    },
    expectedEdgeMechanism: {
      description: 'Incomplete strategy - insufficient information',
      strength: 'none',
      isNull: true
    },
    expectedVerdict: 'HARD_REJECT',
    rejectionReason: 'Insufficient specification - missing asset, exit, and risk rules'
  },

  {
    id: 'EDGE_003',
    title: 'Extremely Long Rambling Description',
    rawInput: `
      So you know I've been thinking about markets for like fifteen years now and
      I've seen a lot of cycles come and go. What really matters is understanding
      the macro environment but also the micro stuff matters too. Like sometimes when
      you look at individual stocks they don't follow the index even if they should.
      That's interesting to me. And then there's the whole thing about Vol, right?
      Vol usually goes up when things are bad and down when things are good. Or does it
      go down? I forget. Anyway the point is that if you're smart about reading the
      market you can make money. My uncle made a lot of money trading but he won't tell
      me his secrets. I think the secret is just to not lose money. Maybe I should
      focus on that. Or maybe the real edge is just in the people-pleasing aspect?
      Like if you make people happy with your returns they'll give you more money.
      Anyway I'm rambling but the core idea is that we should trade based on what
      feels right. Listen to the market, feel the flow, and execute when your gut
      says so. That's how you make real money. Real trading isn't about rules, it's
      about feel and experience. Risk management is for people who are scared.
    `,
    difficulty: 'EDGE_CASE',
    tags: ['rambling', 'no_concrete_rules', 'discretionary', 'gut_feel'],
    expectedInterpretations: {
      assets: [],
      timeframe: 'undefined',
      signals: [],
      rules: ['Trade based on feel and gut instinct'],
      riskManagement: 'None - "risk management is for scared people"'
    },
    expectedContradictions: {
      isPresent: true,
      conflicts: [
        'No concrete signals defined',
        'Strategy is purely discretionary and untestable',
        'Contradictory claims about Vol behavior (up when bad or down?)',
        'Rejects risk management',
        'No entry/exit rules, only vague philosophy',
        'Not backtestable'
      ],
      severity: 'fatal'
    },
    expectedEdgeMechanism: {
      description: 'No actual edge mechanism - pure discretion and feel',
      strength: 'none',
      isNull: true
    },
    expectedVerdict: 'HARD_REJECT',
    rejectionReason: 'No testable strategy - purely discretionary gut trading with no risk management'
  }
];

export function getGoldenStrategyById(id: string): GoldenTestCase | undefined {
  return GOLDEN_STRATEGIES.find(s => s.id === id);
}

export function getGoldenStrategiesByDifficulty(difficulty: Difficulty): GoldenTestCase[] {
  return GOLDEN_STRATEGIES.filter(s => s.difficulty === difficulty);
}

export function getGoldenStrategiesByTag(tag: string): GoldenTestCase[] {
  return GOLDEN_STRATEGIES.filter(s => s.tags.includes(tag));
}

export function getGoldenStrategiesStats() {
  return {
    total: GOLDEN_STRATEGIES.length,
    byDifficulty: {
      EASY: GOLDEN_STRATEGIES.filter(s => s.difficulty === 'EASY').length,
      MEDIUM: GOLDEN_STRATEGIES.filter(s => s.difficulty === 'MEDIUM').length,
      HARD: GOLDEN_STRATEGIES.filter(s => s.difficulty === 'HARD').length,
      ADVERSARIAL: GOLDEN_STRATEGIES.filter(s => s.difficulty === 'ADVERSARIAL').length,
      EDGE_CASE: GOLDEN_STRATEGIES.filter(s => s.difficulty === 'EDGE_CASE').length
    },
    byVerdict: {
      PASS: GOLDEN_STRATEGIES.filter(s => s.expectedVerdict === 'PASS').length,
      SOFT_REJECT: GOLDEN_STRATEGIES.filter(s => s.expectedVerdict === 'SOFT_REJECT').length,
      HARD_REJECT: GOLDEN_STRATEGIES.filter(s => s.expectedVerdict === 'HARD_REJECT').length
    }
  };
}
