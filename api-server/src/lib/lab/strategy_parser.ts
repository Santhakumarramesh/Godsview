/**
 * Natural Language Strategy Parser
 *
 * Converts user descriptions to StrategyDSL objects using pattern matching,
 * indicator/price-action recognition, and confidence scoring.
 */

import {
  StrategyDSL,
  EntrySpec,
  ExitSpec,
  SizingSpec,
  FilterSpec,
  MarketContextSpec,
  createEmptyStrategy,
  Ambiguity,
  EntryCondition,
} from './strategy_dsl';

export interface ParseResult {
  strategy: StrategyDSL;
  confidence: number;
  ambiguities: Ambiguity[];
  suggestions: string[];
  interpretations: Interpretation[];
}

export interface Interpretation {
  field: string;
  raw: string;
  parsed: any;
  confidence: number;
  alternatives: { value: any; reasoning: string }[];
}

export interface IndicatorReference {
  name: string;
  params: Record<string, number | string>;
  comparison?: string;
  confidence: number;
}

export interface PriceActionReference {
  type: string;
  description: string;
  confidence: number;
}

export interface RiskParams {
  stopLossType?: string;
  stopLossValue?: number;
  takeProfitType?: string;
  takeProfitValue?: number;
  riskReward?: number;
  maxRisk?: number;
}

export class StrategyParser {
  private indicators = ['rsi', 'macd', 'ema', 'sma', 'bb', 'atr', 'vwap', 'iv', 'stochastic', 'kdj'];
  private priceActions = ['breakout', 'pullback', 'reversal', 'sweep', 'reclaim', 'bounce', 'retest', 'bos', 'choch'];
  private structures = ['orderblock', 'order block', 'fvg', 'fair value gap', 'supply', 'demand', 'support', 'resistance'];
  private sessions = ['london', 'open', 'morning', 'afternoon', 'close', 'ny', 'asia', 'premarket'];
  private regimes = ['trending', 'range', 'ranging', 'volatile', 'chop', 'quiet', 'bull', 'bear'];

  /**
   * Parse natural language description into a StrategyDSL
   */
  parse(naturalLanguage: string): ParseResult {
    const text = naturalLanguage.toLowerCase();
    const strategy = createEmptyStrategy('Parsed Strategy');
    const interpretations: Interpretation[] = [];
    const ambiguities: Ambiguity[] = [];
    const suggestions: string[] = [];

    // Extract name if provided
    const nameMatch = naturalLanguage.match(/(?:name|called|titled)[\s:]+([^,.\n]+)/i);
    if (nameMatch) {
      strategy.name = nameMatch[1].trim().substring(0, 100);
    }

    // Parse market context
    strategy.marketContext = this.parseMarketContext(text, interpretations);

    // Parse entry conditions
    strategy.entry = this.parseEntry(text, interpretations, ambiguities);

    // Parse exit rules
    strategy.exit = this.parseExit(text, interpretations);

    // Parse position sizing
    strategy.sizing = this.parseSizing(text, interpretations);

    // Parse filters
    strategy.filters = this.parseFilters(text, interpretations);

    // Extract indicators and price actions
    const indicators = this.extractIndicators(text);
    const priceActions = this.extractPriceAction(text);

    // Estimate edge source
    if (indicators.length > 0) {
      strategy.estimatedEdgeSource = indicators.map(i => i.name.toUpperCase()).join(' + ');
    } else if (priceActions.length > 0) {
      strategy.estimatedEdgeSource = priceActions.map(pa => pa.type).join(' + ');
    } else {
      strategy.estimatedEdgeSource = 'unknown';
    }

    // Determine complexity
    const totalConditions = strategy.entry.conditions.length + strategy.entry.confirmations.length;
    if (totalConditions <= 2) strategy.complexity = 'simple';
    else if (totalConditions <= 4) strategy.complexity = 'moderate';
    else if (totalConditions <= 6) strategy.complexity = 'complex';
    else strategy.complexity = 'advanced';

    // Confidence scoring
    let confidence = 0.5;
    if (strategy.entry.conditions.length > 0) confidence += 0.15;
    if (strategy.exit.takeProfit.targets.length > 0) confidence += 0.15;
    if (strategy.sizing.method !== 'fixed_percent') confidence += 0.1;
    if (strategy.marketContext.regimeFilter.allowed.length > 0) confidence += 0.1;
    confidence = Math.min(1.0, confidence);

    strategy.parseConfidence = confidence;
    strategy.ambiguities = ambiguities;
    strategy.warnings = this.generateWarnings(strategy);

    // Add suggestions
    if (strategy.entry.conditions.length === 0) {
      suggestions.push('Consider adding specific entry conditions (e.g., indicator crosses, price action patterns)');
    }
    if (strategy.exit.takeProfit.minRR < 2.0) {
      suggestions.push('Consider targeting higher risk-reward ratios (2:1 or better)');
    }
    if (strategy.marketContext.sessionFilter.allowedSessions.length === 0) {
      suggestions.push('Consider specifying trading sessions (e.g., US open, London session)');
    }
    if (strategy.sizing.maxRiskPercent > 2.0) {
      suggestions.push('Consider reducing risk per trade to 1-2% of account');
    }

    return {
      strategy,
      confidence,
      ambiguities,
      suggestions,
      interpretations,
    };
  }

  parseEntry(
    text: string,
    interpretations: Interpretation[],
    ambiguities: Ambiguity[]
  ): EntrySpec {
    const entry: EntrySpec = {
      type: 'market',
      conditions: [],
      confirmations: [],
      minConfirmationsRequired: 1,
      aggressiveness: 'moderate',
    };

    // Look for entry patterns
    const entryPatterns = [
      /buy when\s+(.+?)(?:and|,|then|take profit|stop|$)/gi,
      /enter when\s+(.+?)(?:and|,|then|take profit|stop|$)/gi,
      /long when\s+(.+?)(?:and|,|then|take profit|stop|$)/gi,
      /short when\s+(.+?)(?:and|,|then|take profit|stop|$)/gi,
    ];

    const conditions = new Set<string>();
    for (const pattern of entryPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        conditions.add(match[1].trim());
      }
    }

    // Parse each condition
    let id = 0;
    for (const condText of conditions) {
      const condition: EntryCondition = {
        id: `entry_${id++}`,
        name: condText.substring(0, 50),
        type: 'custom',
        operator: 'crosses_above',
        params: {},
        weight: 1.0,
        required: false,
      };

      // Check for indicator conditions
      const indicator = this.findIndicatorInText(condText);
      if (indicator) {
        condition.type = 'indicator';
        condition.name = indicator.name;
        condition.params = indicator.params;
      }