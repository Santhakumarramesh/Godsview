/**
 * StrategySummarizer - Human-readable strategy summaries
 *
 * Translates technical strategy parameters into plain English descriptions
 * suitable for traders of all skill levels.
 */

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface StrategySummary {
  oneLiner: string;
  description: string; // 2-3 sentences
  howItWorks: string; // plain English explanation
  whenItWorks: string; // best conditions
  whenItFails: string; // worst conditions
  riskProfile: string; // risk description
  suitableFor: string; // what type of trader
  keyMetrics: { label: string; value: string; rating: 'good' | 'neutral' | 'bad' }[];
  quickFacts: string[];
  grade: string;
  emoji: string; // strategy health emoji
}

export interface DetailedSummary {
  overview: string;
  entrySignals: string;
  exitSignals: string;
  riskManagement: string;
  filters: string;
  tradingHours: string;
  positionSizing: string;
  expectedPerformance: string;
  assumptions: string[];
}

export interface ComparisonSummary {
  strategies: Array<{
    name: string;
    oneLiner: string;
    grade: string;
    complexity: 'simple' | 'moderate' | 'complex';
    riskLevel: 'low' | 'moderate' | 'high';
  }>;
  recommendation: string;
  differences: string[];
  winner: string;
}

export interface FormattedMetrics {
  [key: string]: {
    value: string;
    unit: string;
    interpretation: string;
  };
}

// ──────────────────────────────────────────────────────────────────────────
// StrategySummarizer
// ──────────────────────────────────────────────────────────────────────────

export class StrategySummarizer {
  /**
   * Generate a complete plain-English summary of a strategy
   */
  summarize(strategy: any): StrategySummary {
    const entryLogic = this.describeEntryLogic(strategy);
    const exitLogic = this.describeExitLogic(strategy);
    const riskProfile = this.assessRiskProfile(strategy);

    const oneLiner = this.generateOneLiner(entryLogic, exitLogic);
    const description = this.generateDescription(strategy, entryLogic, exitLogic);
    const howItWorks = this.explainMechanism(strategy, entryLogic, exitLogic);
    const whenItWorks = this.describeWhenItWorks(strategy);
    const whenItFails = this.describeWhenItFails(strategy);

    const keyMetrics = this.extractKeyMetrics(strategy);
    const quickFacts = this.generateQuickFacts(strategy);
    const grade = this.calculateGrade(strategy);
    const emoji = this.selectEmoji(grade);

    return {
      oneLiner,
      description,
      howItWorks,
      whenItWorks,
      whenItFails,
      riskProfile,
      suitableFor: this.determineSuitability(strategy),
      keyMetrics,
      quickFacts,
      grade,
      emoji,
    };
  }

  /**
   * Generate a quick one-liner
   */