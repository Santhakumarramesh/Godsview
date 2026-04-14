/**
 * GuidedBuilder - Interactive strategy builder with guided questions
 *
 * Step-by-step questionnaire that guides users through strategy creation,
 * building a strategy from their answers.
 */

import { randomUUID } from 'crypto';
import { StrategySummarizer } from './strategy_summarizer';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface BuildQuestion {
  id: string;
  text: string;
  helpText: string;
  type: 'text' | 'choice' | 'number' | 'multi_choice';
  options?: { value: string; label: string; description: string }[];
  default?: any;
  required: boolean;
  validation?: string;
}

export interface BuildSection {
  id: string;
  name: string;
  questions: BuildQuestion[];
  completed: boolean;
}

export interface BuildSession {
  id: string;
  currentStep: number;
  totalSteps: number;
  sections: BuildSection[];
  strategy: Partial<any>;
  answers: Map<string, any>;
  completedAt?: string;
}

export interface BuildStep {
  section: string;
  question: BuildQuestion;
  progress: number;
  strategySoFar: string;
  suggestedAnswer?: string;
  nextButtonText: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Questions Database
// ──────────────────────────────────────────────────────────────────────────

const GUIDED_QUESTIONS: BuildSection[] = [
  {
    id: 'market',
    name: 'Market & Instrument Selection',
    completed: false,
    questions: [
      {
        id: 'q1',
        text: 'What instrument(s) do you want to trade?',
        helpText: 'Select the primary markets or asset classes for your strategy.',
        type: 'multi_choice',
        required: true,
        options: [
          { value: 'stocks', label: 'Stocks', description: 'US equities and indices' },
          {
            value: 'options',
            label: 'Options',
            description: 'Stock options for hedging or income',
          },
          { value: 'forex', label: 'Forex', description: 'Currency pairs' },
          { value: 'crypto', label: 'Crypto', description: 'Bitcoin and altcoins' },
          { value: 'futures', label: 'Futures', description: 'Index, commodity futures' },
        ],
      },
      {
        id: 'q2',
        text: 'What timeframe do you prefer?',
        helpText: 'Shorter timeframes = more active trading. Longer = less frequent.',
        type: 'choice',
        required: true,
        options: [
          { value: 'scalp', label: 'Scalping', description: 'Minutes - very active' },
          { value: 'day', label: 'Day Trading', description: 'Hours - active' },
          {
            value: 'swing',
            label: 'Swing Trading',
            description: 'Days/weeks - moderate',
          },
          {
            value: 'position',
            label: 'Position Trading',
            description: 'Weeks/months - passive',
          },
        ],
      },
      {
        id: 'q3',
        text: 'Target specific symbols? (optional)',
        helpText: 'Leave blank to trade any symbol or list them (SPY,AAPL,TSLA).',
        type: 'text',
        required: false,
      },
    ],
  },
  {
    id: 'style',
    name: 'Trading Style & Approach',
    completed: false,
    questions: [
      {
        id: 'q4',
        text: 'What is your primary trading approach?',
        helpText: 'The core philosophy of how you identify trades.',
        type: 'choice',
        required: true,
        options: [
          {
            value: 'trend',
            label: 'Trend Following',
            description: 'Ride established trends',
          },
          {
            value: 'mean_reversion',
            label: 'Mean Reversion',
            description: 'Trade extremes back to average',
          },
          { value: 'breakout', label: 'Breakout', description: 'Trade above/below levels' },
          {
            value: 'momentum',
            label: 'Momentum',
            description: 'Trade strength/weakness',
          },
          {
            value: 'arbitrage',
            label: 'Arbitrage',
            description: 'Trade mispricings',
          },
        ],
      },
      {
        id: 'q5',
        text: 'What indicators drive your signals?',
        helpText: 'Can select multiple indicators or mechanical rules.',
        type: 'multi_choice',
        required: true,
        options: [
          {
            value: 'moving_avg',
            label: 'Moving Averages',
            description: 'Trend direction',
          },
          { value: 'rsi', label: 'RSI', description: 'Momentum/extremes' },
          {
            value: 'macd',
            label: 'MACD',
            description: 'Momentum divergence',
          },
          { value: 'bb', label: 'Bollinger Bands', description: 'Volatility levels' },
          { value: 'stoch', label: 'Stochastic', description: 'Oscillator' },
          {
            value: 'volume',
            label: 'Volume',
            description: 'Confirmation/divergence',
          },
          {
            value: 'support',
            label: 'Support/Resistance',
            description: 'Key price levels',
          },
        ],
      },
      {
        id: 'q6',
        text: 'What is your risk tolerance?',
        helpText: 'How much maximum drawdown can you tolerate?',
        type: 'choice',
        required: true,
        options: [
          {
            value: 'conservative',
            label: 'Conservative',
            description: 'Max 10% drawdown',
          },
          {
            value: 'moderate',
            label: 'Moderate',
            description: 'Max 20% drawdown',
          },
          { value: 'aggressive', label: 'Aggressive', description: 'Max 35% drawdown' },
        ],
      },
    ],
  },
  {
    id: 'entry',
    name: 'Entry Logic',
    completed: false,
    questions: [
      {
        id: 'q7',
        text: 'Primary entry signal?',
        helpText: 'The main condition that triggers a buy/sell signal.',
        type: 'choice',
        required: true,
        options: [
          {
            value: 'ma_cross',
            label: 'Moving Average Crossover',
            description: 'Fast MA crosses slow MA',
          },
          {
            value: 'rsi_level',
            label: 'RSI Level',
            description: 'RSI above/below threshold',
          },
          {
            value: 'price_breakout',
            label: 'Price Breakout',
            description: 'Price breaks above/below level',
          },
          {
            value: 'slope_change',
            label: 'Slope Change',
            description: 'Trend changes direction',
          },
          {
            value: 'volume_spike',
            label: 'Volume Spike',
            description: 'Unusual volume surge',
          },
        ],
      },
      {
        id: 'q8',
        text: 'How many confirmation signals do you want?',
        helpText: 'More confirmations = fewer false signals but slower entries.',
        type: 'choice',
        required: true,
        options: [
          { value: '1', label: '1 Signal', description: 'Just the primary signal' },
          { value: '2', label: '2 Signals', description: 'Primary + 1 confirmation' },
          {
            value: '3',
            label: '3+ Signals',
            description: 'Multiple confirmations (conservative)',
          },
        ],
      },
      {
        id: 'q9',
        text: 'Entry strength preference?',
        helpText: 'Strong=wait for clear signal, Weak=early entry attempts.',
        type: 'choice',
        required: true,
        options: [
          {
            value: 'aggressive',
            label: 'Aggressive',
            description: 'Early entry, quick execution',
          },
          {
            value: 'balanced',
            label: 'Balanced',
            description: 'Wait for reasonable confirmation',
          },
          {
            value: 'conservative',
            label: 'Conservative',
            description: 'Wait for strong, clear signal',
          },
        ],
      },
    ],
  },
  {
    id: 'exit',
    name: 'Exit Logic',
    completed: false,
    questions: [
      {
        id: 'q10',
        text: 'Primary exit method?',
        helpText: 'How do you typically exit winning trades?',
        type: 'choice',
        required: true,
        options: [
          {
            value: 'profit_target',
            label: 'Profit Target',
            description: 'Exit at fixed %',
          },
          {
            value: 'time_based',
            label: 'Time-Based',
            description: 'Exit after N bars',
          },
          {
            value: 'signal_reversal',
            label: 'Signal Reversal',
            description: 'Exit on opposite signal',
          },
          {
            value: 'trailing_stop',
            label: 'Trailing Stop',
            description: 'Follow profit with stop',
          },
          {
            value: 'rsi_overbought',
            label: 'Overbought/Oversold',
            description: 'Exit when extreme',
          },
        ],
      },
      {
        id: 'q11',
        text: 'Stop loss method?',
        helpText: 'How do you define maximum loss per trade?',
        type: 'choice',
        required: true,
        options: [
          {
            value: 'fixed_pct',
            label: 'Fixed %',
            description: 'Fixed percentage below entry',
          },
          {
            value: 'recent_low',
            label: 'Recent Low',
            description: 'Below recent support level',
          },
          {
            value: 'atr',
            label: 'ATR-Based',
            description: 'Multiple of volatility',
          },
          {
            value: 'chandelier',
            label: 'Chandelier Stop',
            description: 'Dynamic trailing stop',
          },
        ],
      },
      {
        id: 'q12',
        text: 'Target risk per trade?',
        helpText: 'Maximum acceptable loss on a single trade.',
        type: 'choice',
        required: true,
        options: [
          { value: '0.5', label: '0.5%', description: 'Conservative' },
          { value: '1', label: '1%', description: 'Moderate' },
          { value: '2', label: '2%', description: 'Aggressive' },
        ],
      },
    ],
  },
  {
    id: 'filters',
    name: 'Market Filters',
    completed: false,
    questions: [
      {
        id: 'q13',
        text: 'Apply trend filters?',
        helpText: 'Only trade in certain market conditions.',
        type: 'choice',
        required: true,
        options: [
          { value: 'none', label: 'No Filters', description: 'Trade in any condition' },
          {
            value: 'trend_only',
            label: 'Trending Only',
            description: 'Trade when in clear trend',
          },
          {
            value: 'volatility',
            label: 'Volatility Threshold',
            description: 'Only when volatility adequate',
          },
          {
            value: 'session',
            label: 'Session Filter',
            description: 'Trade specific hours only',
          },
        ],
      },
      {
        id: 'q14',
        text: 'Use volatility filter?',
        helpText: 'Skip trades during very low or very high volatility.',
        type: 'choice',
        required: false,
        options: [
          { value: 'no', label: 'No', description: 'Trade regardless' },
          {
            value: 'exclude_low',
            label: 'Exclude Low Vol',
            description: 'Skip when dead',
          },
          {
            value: 'exclude_high',
            label: 'Exclude High Vol',
            description: 'Skip when chaotic',
          },
        ],
      },
      {
        id: 'q15',
        text: 'Maximum trades per day?',
        helpText: 'Prevent over-trading. Leave blank for unlimited.',
        type: 'number',
        required: false,
        default: 5,
      },
    ],
  },
  {
    id: 'review',
    name: 'Final Review',
    completed: false,
    questions: [
      {
        id: 'q16',
        text: 'Strategy name?',
        helpText: 'Give your strategy a memorable name.',
        type: 'text',
        required: true,
        validation: '^[a-zA-Z0-9_-]{3,50}$',
      },
      {
        id: 'q17',
        text: 'Strategy description? (optional)',
        helpText: 'Short notes about your strategy.',
        type: 'text',
        required: false,
      },
      {
        id: 'q18',
        text: 'Ready to build?',
        helpText: 'Click "Build Strategy" to compile your strategy.',
        type: 'choice',
        required: true,
        options: [
          { value: 'yes', label: 'Yes, build it!', description: 'Proceed' },
          {
            value: 'no',
            label: 'Review again',
            description: 'Go back and review',
          },
        ],
      },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────────
// GuidedBuilder
// ──────────────────────────────────────────────────────────────────────────

export class GuidedBuilder {
  private sessions: Map<string, BuildSession> = new Map();
  private summarizer: StrategySummarizer;

  constructor() {
    this.summarizer = new StrategySummarizer();
  }

  /**
   * Start a guided build session
   */
  startSession(): BuildSession {
    const sessionId = randomUUID();
    const allQuestions = JSON.parse(JSON.stringify(GUIDED_QUESTIONS));

    const session: BuildSession = {
      id: sessionId,
      currentStep: 0,
      totalSteps: allQuestions.reduce((sum: number, section: any) => sum + section.questions.length, 0),
      sections: allQuestions,
      strategy: {},
      answers: new Map(),
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Process user answer to current question
   */
  processAnswer(sessionId: string, answer: string): BuildStep {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Find current question
    let currentQuestion: BuildQuestion | null = null;
    let currentSection: BuildSection | null = null;
    let questionIndex = 0;
    let foundCount = 0;

    for (const section of session.sections) {
      for (const question of section.questions) {
        if (foundCount === session.currentStep) {
          currentQuestion = question;
          currentSection = section;
          break;
        }
        foundCount++;
      }
      if (currentQuestion) break;
    }

    if (!currentQuestion || !currentSection) {
      throw new Error('No more questions');
    }

    // Validate answer
    if (currentQuestion.required && !answer) {
      throw new Error('This field is required');
    }

    if (currentQuestion.validation) {
      const regex = new RegExp(currentQuestion.validation);
      if (!regex.test(answer)) {
        throw new Error(`Invalid format for ${currentQuestion.text}`);
      }
    }

    // Store answer
    session.answers.set(currentQuestion.id, answer);

    // Update strategy based on answer
    this.updateStrategy(session, currentQuestion.id, answer);

    // Move to next question
    session.currentStep++;

    // Generate summary
    const strategySoFar = this.summarizer.oneLiner(session.strategy);
    const progress = (session.currentStep / session.totalSteps) * 100;

    // Get next question
    const nextStep = this.getCurrentQuestion(session);

    return {
      section: currentSection.name,
      question: nextStep?.question || currentQuestion,
      progress,
      strategySoFar,
      nextButtonText: session.currentStep >= session.totalSteps ? 'Complete' : 'Next',
    };
  }

  /**
   * Get current question/prompt
   */
  getCurrentStep(sessionId: string): BuildStep {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const step = this.getCurrentQuestion(session);
    if (!step) {
      throw new Error('Build session complete');
    }

    const progress = (session.currentStep / session.totalSteps) * 100;
    const strategySoFar = this.summarizer.oneLiner(session.strategy);

    return {
      section: step.section.name,
      question: step.question,
      progress,
      strategySoFar,
      nextButtonText: session.currentStep >= session.totalSteps - 1 ? 'Complete' : 'Next',
    };
  }

  /**
   * Skip to a specific section
   */
  skipTo(sessionId: string, section: string): BuildStep {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Find section
    let sectionIndex = 0;
    let questionCount = 0;

    for (const sec of session.sections) {
      if (sec.id === section) {
        session.currentStep = questionCount;
        return this.getCurrentStep(sessionId);
      }
      questionCount += sec.questions.length;
      sectionIndex++;
    }

    throw new Error(`Section not found: ${section}`);
  }

  /**
   * Complete and compile the strategy
   */
  compile(sessionId: string): any {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Build final strategy object
    const strategy = {
      id: randomUUID(),
      name: session.answers.get('q16') || 'Untitled Strategy',
      description: session.answers.get('q17'),
      instruments: session.answers.get('q1'),
      timeframe: session.answers.get('q2'),
      symbols: session.answers.get('q3'),
      approach: session.answers.get('q4'),
      indicators: session.answers.get('q5'),
      riskTolerance: session.answers.get('q6'),
      entry: {
        signal: session.answers.get('q7'),
        confirmations: parseInt(session.answers.get('q8') || '1'),
        strength: session.answers.get('q9'),
      },
      exit: {
        method: session.answers.get('q10'),
        stopLoss: session.answers.get('q11'),
        riskPerTrade: parseFloat(session.answers.get('q12') || '1'),
      },
      filters: {
        trendFilter: session.answers.get('q13'),
        volatilityFilter: session.answers.get('q14'),
        maxTradesPerDay: parseInt(session.answers.get('q15') || '0'),
      },
      createdAt: new Date().toISOString(),
      compiledAt: new Date().toISOString(),
    };

    session.completedAt = new Date().toISOString();
    this.sessions.set(sessionId, session);

    return strategy;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────────────────

  private getCurrentQuestion(
    session: BuildSession
  ): { section: BuildSection; question: BuildQuestion } | null {
    let count = 0;
    for (const section of session.sections) {
      for (const question of section.questions) {
        if (count === session.currentStep) {
          return { section, question };
        }
        count++;
      }
    }
    return null;
  }

  private updateStrategy(session: BuildSession, questionId: string, answer: string): void {
    const answerMap = {
      q1: 'instruments',
      q2: 'timeframe',
      q3: 'symbols',
      q4: 'approach',
      q5: 'indicators',
      q6: 'riskTolerance',
    };

    const key = answerMap[questionId as keyof typeof answerMap];
    if (key) {
      (session.strategy as Record<string, unknown>)[key as string] = answer;
    }
  }
}

// Export singleton
let builderInstance: GuidedBuilder | null = null;

export function getGuidedBuilder(): GuidedBuilder {
  if (!builderInstance) {
    builderInstance = new GuidedBuilder();
  }
  return builderInstance;
}
