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