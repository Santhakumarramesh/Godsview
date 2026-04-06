import {
  StrategyDSL,
  MarketContextSpec,
  EntrySpec,
  ExitSpec,
  SizingSpec,
  FilterSpec,
} from './strategy_dsl';

/**
 * Trading concept patterns for natural language parsing
 */
interface ConceptPattern {
  regex: RegExp;
  weight: number;
  category: 'indicator' | 'price_action' | 'market_structure' | 'orderflow';
}

interface ParsedConcept {
  name: string;
  category: string;
  confidence: number;
  rawText: string;
}

interface TimeframeInfo {
  periods: number;
  unit: 'minute' | 'hour' | 'day' | 'week';
}

/**
 * Natural Language Strategy Parser
 * Converts plain-English strategy descriptions into structured StrategyDSL objects
 * Recognizes 40+ trading concepts across indicators, price action, market structure, and orderflow
 */
export class NaturalLanguageStrategyParser {
  private indicatorPatterns: ConceptPattern[];
  private priceActionPatterns: ConceptPattern[];
  private marketStructurePatterns: ConceptPattern[];
  private orderflowPatterns: ConceptPattern[];
  private timeframePattern: RegExp;
  private riskPatterns: Map<string, RegExp>;

  constructor() {
    this.indicatorPatterns = [
      {
        regex: /\brsi\b|\brelative\s+strength\b/gi,
        weight: 1.0,
        category: 'indicator',
      },
      {
        regex: /\bmacd\b|\bmoving\s+average\s+convergence\b/gi,
        weight: 1.0,
        category: 'indicator',
      },
      {
        regex: /\bema\b|\bexponential\s+moving\s+average\b/gi,
        weight: 0.95,
        category: 'indicator',
      },
      {
        regex: /\bsma\b|\bsimple\s+moving\s+average\b/gi,
        weight: 0.95,
        category: 'indicator',
      },
      {
        regex: /\bvwap\b|\bvolume\s+weighted\s+average\b/gi,
        weight: 1.0,
        category: 'indicator',
      },
      {
        regex: /\bbollinger\s+band|\bbband\b/gi,
        weight: 0.95,
        category: 'indicator',
      },
      {
        regex: /\batr\b|\baverage\s+true\s+range\b/gi,
        weight: 0.95,
        category: 'indicator',
      },
      {
        regex: /\bstochastic\b|\b%k\b|\b%d\b/gi,
        weight: 0.9,
        category: 'indicator',
      },
      {
        regex: /\bcci\b|\bcommodity\s+channel\b/gi,
        weight: 0.85,
        category: 'indicator',
      },
      {
        regex: /\badx\b|\baverage\s+directional\b/gi,
        weight: 0.85,
        category: 'indicator',
      },
      {
        regex: /\broc\b|\brate\s+of\s+change\b/gi,
        weight: 0.8,
        category: 'indicator',
      },
      {
        regex: /\bkeltner\b/gi,
        weight: 0.85,
        category: 'indicator',
      },
      {
        regex: /\bfibonacci\b|\bfib\b/gi,
        weight: 0.9,
        category: 'indicator',
      },
    ];

    this.priceActionPatterns = [
      {
        regex: /\bbreakout\b|\bbreak\s+above\b/gi,
        weight: 1.0,
        category: 'price_action',
      },
      {
        regex: /\bpullback\b|\bretracement\b/gi,
        weight: 1.0,
        category: 'price_action',
      },
      {
        regex: /\breversal\b|\btrend\s+reversal\b/gi,
        weight: 1.0,
        category: 'price_action',
      },
      {
        regex: /\bengulfing\b/gi,
        weight: 0.95,
        category: 'price_action',
      },
      {
        regex: /\bpin\s+bar\b|\bpierce\b/gi,
        weight: 0.9,
        category: 'price_action',
      },
      {
        regex: /\bdoji\b/gi,
        weight: 0.9,
        category: 'price_action',
      },
      {
        regex: /\bcandle\b|\bcandles\b|\bcandle\s+pattern\b/gi,
        weight: 0.85,
        category: 'price_action',
      },
      {
        regex: /\bwick\b|\bshadow\b/gi,
        weight: 0.8,
        category: 'price_action',
      },
      {
        regex: /\bopen\b.*\bclose\b|\bclose\b.*\bopen\b/gi,
        weight: 0.75,
        category: 'price_action',
      },
      {
        regex: /\bhammer\b|\binverted\s+hammer\b/gi,
        weight: 0.85,
        category: 'price_action',
      },
      {
        regex: /\bmorning\s+star\b|\bevening\s+star\b/gi,
        weight: 0.8,
        category: 'price_action',
      },
    ];

    this.marketStructurePatterns = [
      {
        regex: /\bsupport\b/gi,
        weight: 1.0,
        category: 'market_structure',
      },
      {
        regex: /\bresistance\b/gi,
        weight: 1.0,
        category: 'market_structure',
      },
      {
        regex: /\btrend\b|\buptrend\b|\bdowntrend\b/gi,
        weight: 1.0,
        category: 'market_structure',
      },
      {
        regex: /\brange\b|\branging\b/gi,
        weight: 0.95,
        category: 'market_structure',
      },
      {
        regex: /\bconsolidation\b/gi,
        weight: 0.95,
        category: 'market_structure',
      },
      {
        regex: /\bhigher\s+high|higher\s+lows\b|\blower\s+lows\b/gi,
        weight: 0.9,
        category: 'market_structure',
      },
      {
        regex: /\bchannel\b/gi,
        weight: 0.9,
        category: 'market_structure',
      },
      {
        regex: /\btrend\s+line\b/gi,
        weight: 0.85,
        category: 'market_structure',
      },
      {
        regex: /\blevel\b|\bkey\s+level\b/gi,
        weight: 0.8,
        category: 'market_structure',
      },
      {
        regex: /\bfloor\b|\bceiling\b/gi,
        weight: 0.75,
        category: 'market_structure',
      },
      {
        regex: /\bfractal\b/gi,
        weight: 0.8,
        category: 'market_structure',
      },
    ];

    this.orderflowPatterns = [
      {
        regex: /\bvolume\s+spike\b|\bvolume\s+surge\b/gi,
        weight: 1.0,
        category: 'orderflow',
      },
      {
        regex: /\baccumulation\b/gi,
        weight: 0.95,
        category: 'orderflow',
      },
      {
        regex: /\bdistribution\b/gi,
        weight: 0.95,
        category: 'orderflow',
      },
      {
        regex: /\bdivergence\b|\bdiv\b/gi,
        weight: 0.9,
        category: 'orderflow',
      },
      {
        regex: /\bconvergence\b/gi,
        weight: 0.85,
        category: 'orderflow',
      },
      {
        regex: /\bbuy\s+volume\b|\bsell\s+volume\b/gi,
        weight: 0.9,
        category: 'orderflow',
      },
      {
        regex: /\bmarket\s+profile\b|\bprofile\b/gi,
        weight: 0.85,
        category: 'orderflow',
      },
      {
        regex: /\bpoc\b|\bpoint\s+of\s+control\b/gi,
        weight: 0.85,
        category: 'orderflow',
      },
      {
        regex: /\bliquid\b|\bliquidity\b|\bliquid\s+level\b/gi,
        weight: 0.85,
        category: 'orderflow',
      },
      {
        regex: /\bim\s+balance\b|\bimbalance\b/gi,
        weight: 0.8,
        category: 'orderflow',
      },
    ];

    this.timeframePattern =
      /(\d+)\s*(minute|min|hour|day|week|month)\s*(?:timeframe|candle|chart)?/gi;

    this.riskPatterns = new Map([
      ['stop_loss', /stop\s+(?:at|loss|to|limit)?\s*(\d+\.?\d*)\s*(%|pips?)?/gi],
      ['take_profit', /take\s+profit\s+(?:at|target)?\s*(\d+\.?\d*)\s*(%|pips?)?/gi],
      ['risk_reward', /risk.*reward\s*(?:ratio)?\s*1?\s*:\s*(\d+\.?\d*)/gi],
      [
        'max_loss',
        /max(?:imum)?\s+loss\s*(?:per\s+trade)?\s*(?:is|=)?\s*(\d+\.?\d*)\s*(%)?/gi,
      ],
    ]);
  }

  /**
   * Main parse function: converts natural language to StrategyDSL
   */
  public parse(description: string): StrategyDSL {
    const indicators = this.extractIndicators(description);
    const priceAction = this.extractPriceAction(description);
    const marketStructure = this.extractMarketStructure(description);
    const orderflow = this.extractOrderflow(description);
    const timeframe = this.extractTimeframe(description);
    const riskParams = this.extractRiskParams(description);

    const entrySpec = this.buildEntrySpec(
      priceAction,
      marketStructure,
      indicators,
      orderflow
    );
    const exitSpec = this.buildExitSpec(riskParams, indicators);
    const sizingSpec = this.buildSizingSpec(riskParams);
    const filters = this.buildFilters(marketStructure, indicators, timeframe);

    return {
      name: this.extractStrategyName(description),
      description,
      marketContext: {
        asset: this.extractAsset(description),
        timeframe: timeframe || 'daily',
        minDataPoints: 100,
      },
      entry: entrySpec,
      exit: exitSpec,
      sizing: sizingSpec,
      filters,
      tags: ['nlp_parsed'],
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Extract indicator mentions from text
   */
  public extractIndicators(description: string): ParsedConcept[] {
    const concepts: ParsedConcept[] = [];
    const allPatterns = this.indicatorPatterns;

    allPatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.regex.exec(description)) !== null) {
        concepts.push({
          name: match[0].toLowerCase(),
          category: 'indicator',
          confidence: pattern.weight,
          rawText: match[0],
        });
      }
    });

    return this.deduplicateConcepts(concepts);
  }

  /**
   * Extract price action patterns from text
   */
  public extractPriceAction(description: string): ParsedConcept[] {
    const concepts: ParsedConcept[] = [];

    this.priceActionPatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.regex.exec(description)) !== null) {
        concepts.push({
          name: match[0].toLowerCase(),
          category: 'price_action',
          confidence: pattern.weight,
          rawText: match[0],
        });
      }
    });

    return this.deduplicateConcepts(concepts);
  }

  /**
   * Extract market structure references
   */
  public extractMarketStructure(description: string): ParsedConcept[] {
    const concepts: ParsedConcept[] = [];

    this.marketStructurePatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.regex.exec(description)) !== null) {
        concepts.push({
          name: match[0].toLowerCase(),
          category: 'market_structure',
          confidence: pattern.weight,
          rawText: match[0],
        });
      }
    });

    return this.deduplicateConcepts(concepts);
  }

  /**
   * Extract orderflow concepts
   */
  public extractOrderflow(description: string): ParsedConcept[] {
    const concepts: ParsedConcept[] = [];

    this.orderflowPatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.regex.exec(description)) !== null) {
        concepts.push({
          name: match[0].toLowerCase(),
          category: 'orderflow',
          confidence: pattern.weight,
          rawText: match[0],
        });
      }
    });

    return this.deduplicateConcepts(concepts);
  }

  /**
   * Extract timeframe from description
   */
  public extractTimeframe(description: string): string | null {
    const match = this.timeframePattern.exec(description);
    if (!match) return null;

    const periods = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    const unitMap: Record<string, string> = {
      minute: 'minute',
      min: 'minute',
      hour: 'hourly',
      day: 'daily',
      week: 'weekly',
      month: 'monthly',
    };

    return unitMap[unit] || null;
  }

  /**
   * Extract risk parameters (stop loss, take profit, risk/reward)
   */
  public extractRiskParams(description: string): Record<string, any> {
    const params: Record<string, any> = {};

    this.riskPatterns.forEach((pattern, key) => {
      const match = pattern.exec(description);
      if (match) {
        params[key] = {
          value: parseFloat(match[1]),
          unit: match[2] || 'percent',
          rawMatch: match[0],
        };
      }
    });

    return params;
  }

  /**
   * Build EntrySpec from parsed concepts
   */
  private buildEntrySpec(
    priceAction: ParsedConcept[],
    marketStructure: ParsedConcept[],
    indicators: ParsedConcept[],
    orderflow: ParsedConcept[]
  ): EntrySpec {
    const conditions: string[] = [];

    priceAction.forEach((pa) => {
      if (pa.confidence > 0.85) {
        conditions.push(`price_action.${pa.name}`);
      }
    });

    marketStructure.forEach((ms) => {
      if (ms.confidence > 0.8) {
        conditions.push(`market.${ms.name}`);
      }
    });

    indicators.forEach((ind) => {
      if (ind.confidence > 0.85) {
        conditions.push(`indicator.${ind.name}`);
      }
    });

    orderflow.forEach((of) => {
      if (of.confidence > 0.8) {
        conditions.push(`orderflow.${of.name}`);
      }
    });

    return {
      trigger: conditions.length > 0 ? `(${conditions.join(' AND ')})` : 'manual',
      conditions,
      confirmationBars: 1,
      entryMethod: 'market',
    };
  }

  /**
   * Build ExitSpec from risk parameters and indicators
   */
  private buildExitSpec(
    riskParams: Record<string, any>,
    indicators: ParsedConcept[]
  ): ExitSpec {
    const exits: string[] = [];

    if (riskParams.stop_loss) {
      exits.push(`stoploss_${riskParams.stop_loss.value}`);
    }

    if (riskParams.take_profit) {
      exits.push(`takeprofit_${riskParams.take_profit.value}`);
    }

    if (indicators.some((i) => i.name.includes('rsi'))) {
      exits.push('rsi_overbought');
    }

    return {
      profitTargets: riskParams.take_profit
        ? [
            {
              threshold: riskParams.take_profit.value,
              percentPosition: 1.0,
            },
          ]
        : [],
      stopLoss: riskParams.stop_loss
        ? { type: 'fixed', value: riskParams.stop_loss.value }
        : undefined,
      timeBasedExit: undefined,
      exitMethods: exits.length > 0 ? exits : ['manual'],
    };
  }

  /**
   * Build SizingSpec from risk parameters
   */
  private buildSizingSpec(riskParams: Record<string, any>): SizingSpec {
    return {
      method: 'fixed',
      baseSize: 1.0,
      maxSize: riskParams.max_loss
        ? Math.min(riskParams.max_loss.value / 100, 0.1)
        : 0.02,
      scalingFactor: 1.0,
      riskPerTrade:
        riskParams.risk_reward && riskParams.risk_reward.value
          ? riskParams.risk_reward.value
          : 1.0,
    };
  }

  /**
   * Build filters from market structure and indicators
   */
  private buildFilters(
    marketStructure: ParsedConcept[],
    indicators: ParsedConcept[],
    timeframe: string | null
  ): FilterSpec[] {
    const filters: FilterSpec[] = [];

    if (marketStructure.some((m) => m.name.includes('trend'))) {
      filters.push({
        type: 'trend',
        direction: 'any',
        strength: 'moderate',
      });
    }

    if (marketStructure.some((m) => m.name.includes('volatility'))) {
      filters.push({
        type: 'volatility',
        minAtr: 0.5,
        maxAtr: 5.0,
      });
    }

    if (marketStructure.some((m) => m.name.includes('range'))) {
      filters.push({
        type: 'range',
        minRange: 0.01,
        maxRange: 0.5,
      });
    }

    if (timeframe === 'daily') {
      filters.push({
        type: 'time',
        allowedHours: [9, 16],
        excludeWeekends: true,
      });
    }

    return filters;
  }

  /**
   * Extract strategy name from description
   */
  private extractStrategyName(description: string): string {
    const words = description.split(' ');
    return words.slice(0, Math.min(4, words.length)).join(' ') + ' Strategy';
  }

  /**
   * Extract asset/ticker from description
   */
  private extractAsset(description: string): string {
    const symbolMatch = /([A-Z]{1,5})\b/.exec(description);
    return symbolMatch ? symbolMatch[1] : 'SPY';
  }

  /**
   * Deduplicate concepts, keeping highest confidence
   */
  private deduplicateConcepts(concepts: ParsedConcept[]): ParsedConcept[] {
    const map = new Map<string, ParsedConcept>();

    concepts.forEach((concept) => {
      const key = concept.name;
      const existing = map.get(key);

      if (!existing || concept.confidence > existing.confidence) {
        map.set(key, concept);
      }
    });

    return Array.from(map.values());
  }
}

export default NaturalLanguageStrategyParser;
