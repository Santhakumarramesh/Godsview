/**
 * godsview_lab.ts — GodsView Lab MVP (Phase 51)
 *
 * Prompt-to-strategy parser and rule compiler:
 *   1. Natural language → structured strategy rules
 *   2. Rule compiler → executable trade conditions
 *   3. Auto-register in Strategy Registry
 *
 * Example prompt: "Buy AAPL when RSI < 30 and price above 200-day MA, 
 *   sell when RSI > 70, stop at 2 ATR below entry, risk 2% per trade"
 */

import { logger } from "./logger.js";
import { registerStrategy, type StrategyEntry } from "./strategy_registry.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConditionOperator = ">" | "<" | ">=" | "<=" | "==" | "crosses_above" | "crosses_below";
export type IndicatorType = "RSI" | "SMA" | "EMA" | "ATR" | "VWAP" | "MACD" | "BB_UPPER" | "BB_LOWER" | "PRICE" | "VOLUME";

export interface RuleCondition {
  indicator: IndicatorType;
  period?: number;
  operator: ConditionOperator;
  value: number | IndicatorType;
  valuePeriod?: number;
}

export interface StrategyRule {
  action: "BUY" | "SELL" | "STOP" | "TAKE_PROFIT";
  conditions: RuleCondition[];
  logic: "AND" | "OR";
}

export interface ParsedStrategy {
  name: string;
  symbols: string[];
  entryRules: StrategyRule[];
  exitRules: StrategyRule[];
  stopRule: { type: "ATR" | "FIXED" | "PERCENT"; value: number } | null;
  riskPct: number;
  timeframe: string;
  confidence: number;
  rawPrompt: string;
  parsedAt: string;
}

export interface CompiledRule {
  id: string;
  action: string;
  expression: string;
  conditions: { field: string; op: string; target: string }[];
  compiledAt: string;
}

export interface LabSnapshot {
  totalPromptsParsed: number;
  totalStrategiesCompiled: number;
  totalStrategiesRegistered: number;
  recentParsed: ParsedStrategy[];
  recentCompiled: CompiledRule[];
}

// ─── State ────────────────────────────────────────────────────────────────────

let totalPromptsParsed = 0;
let totalStrategiesCompiled = 0;
let totalStrategiesRegistered = 0;
const recentParsed: ParsedStrategy[] = [];
const recentCompiled: CompiledRule[] = [];
const MAX_RECENT = 30;

// ─── Pattern Matchers ─────────────────────────────────────────────────────────

const INDICATOR_PATTERNS: { regex: RegExp; indicator: IndicatorType; extractPeriod?: boolean }[] = [
  { regex: /RSI\s*(?:\(?\s*(\d+)\s*\)?)?/i, indicator: "RSI", extractPeriod: true },
  { regex: /(\d+)\s*(?:day|period|bar)?\s*(?:SMA|simple\s*moving\s*average)/i, indicator: "SMA", extractPeriod: true },
  { regex: /SMA\s*\(?\s*(\d+)\s*\)?/i, indicator: "SMA", extractPeriod: true },
  { regex: /(\d+)\s*(?:day|period|bar)?\s*(?:EMA|exponential\s*moving\s*average)/i, indicator: "EMA", extractPeriod: true },
  { regex: /EMA\s*\(?\s*(\d+)\s*\)?/i, indicator: "EMA", extractPeriod: true },
  { regex: /ATR\s*(?:\(?\s*(\d+)\s*\)?)?/i, indicator: "ATR", extractPeriod: true },
  { regex: /VWAP/i, indicator: "VWAP" },
  { regex: /MACD/i, indicator: "MACD" },
  { regex: /bollinger\s*(?:band)?\s*upper|BB_UPPER/i, indicator: "BB_UPPER" },
  { regex: /bollinger\s*(?:band)?\s*lower|BB_LOWER/i, indicator: "BB_LOWER" },
  { regex: /volume/i, indicator: "VOLUME" },
  { regex: /price/i, indicator: "PRICE" },
];

const OPERATOR_PATTERNS: { regex: RegExp; op: ConditionOperator }[] = [
  { regex: /crosses?\s*above|breaks?\s*above/i, op: "crosses_above" },
  { regex: /crosses?\s*below|breaks?\s*below/i, op: "crosses_below" },
  { regex: /(?:is\s*)?(?:greater|above|over|higher)\s*than|>\s*=?/i, op: ">=" },
  { regex: /(?:is\s*)?(?:less|below|under|lower)\s*than|<\s*=?/i, op: "<=" },
];

// ─── Prompt Parser ────────────────────────────────────────────────────────────

function extractSymbols(prompt: string): string[] {
  const symbolRegex = /\b([A-Z]{1,5}(?:USD|USDT)?)\b/g;
  const reserved = new Set(["RSI", "SMA", "EMA", "ATR", "VWAP", "MACD", "BUY", "SELL", "AND", "OR", "THE", "WHEN", "DAY", "STOP"]);
  const matches = [...prompt.matchAll(symbolRegex)].map((m) => m[1]).filter((s) => !reserved.has(s));
  return [...new Set(matches)];
}

function extractTimeframe(prompt: string): string {
  const tf = prompt.match(/(\d+)\s*(?:min(?:ute)?|m)\b/i);
  if (tf) return `${tf[1]}m`;
  const tfh = prompt.match(/(\d+)\s*(?:hour|h)\b/i);
  if (tfh) return `${tfh[1]}h`;
  const tfd = prompt.match(/(\d+)\s*(?:day|d)\b/i);
  if (tfd) return `${tfd[1]}D`;
  if (/daily/i.test(prompt)) return "1D";
  if (/weekly/i.test(prompt)) return "1W";
  return "1D";
}

function extractRiskPct(prompt: string): number {
  const m = prompt.match(/risk\s*(\d+(?:\.\d+)?)\s*%/i);
  return m ? parseFloat(m[1]) / 100 : 0.02;
}

function parseConditionClause(clause: string): RuleCondition | null {
  let indicator: IndicatorType | null = null;
  let period: number | undefined;
  let operator: ConditionOperator = "<=";
  let value: number | IndicatorType = 0;
  let valuePeriod: number | undefined;

  // Find indicator
  for (const pat of INDICATOR_PATTERNS) {
    const m = clause.match(pat.regex);
    if (m) {
      indicator = pat.indicator;
      if (pat.extractPeriod && m[1]) period = parseInt(m[1], 10);
      break;
    }
  }
  if (!indicator) return null;

  // Find operator
  for (const pat of OPERATOR_PATTERNS) {
    if (pat.regex.test(clause)) {
      operator = pat.op;
      break;
    }
  }

  // Find value — could be number or another indicator
  const numMatch = clause.match(/(?:than|=|>|<)\s*(\d+(?:\.\d+)?)/);
  if (numMatch) {
    value = parseFloat(numMatch[1]);
  } else {
    // Check for indicator comparison (e.g., "price above 200-day SMA")
    for (const pat of INDICATOR_PATTERNS) {
      // Skip the first found indicator
      const remaining = clause.replace(INDICATOR_PATTERNS.find((p) => p.indicator === indicator)!.regex, "");
      const m2 = remaining.match(pat.regex);
      if (m2) {
        value = pat.indicator;
        if (pat.extractPeriod && m2[1]) valuePeriod = parseInt(m2[1], 10);
        break;
      }
    }
  }

  return { indicator, period, operator, value, valuePeriod };
}

export function parsePrompt(prompt: string): ParsedStrategy {
  const symbols = extractSymbols(prompt);
  const timeframe = extractTimeframe(prompt);
  const riskPct = extractRiskPct(prompt);
  const now = new Date().toISOString();

  // Split into entry/exit/stop clauses
  const parts = prompt.split(/[,;.]\s*/);
  const entryRules: StrategyRule[] = [];
  const exitRules: StrategyRule[] = [];
  let stopRule: ParsedStrategy["stopRule"] = null;

  for (const part of parts) {
    const lower = part.toLowerCase().trim();
    if (!lower) continue;

    // Stop rule
    const atrStop = lower.match(/stop\s*(?:at|loss)?\s*(\d+(?:\.\d+)?)\s*ATR/i);
    if (atrStop) {
      stopRule = { type: "ATR", value: parseFloat(atrStop[1]) };
      continue;
    }
    const pctStop = lower.match(/stop\s*(?:at|loss)?\s*(\d+(?:\.\d+)?)\s*%/i);
    if (pctStop) {
      stopRule = { type: "PERCENT", value: parseFloat(pctStop[1]) };
      continue;
    }

    // Entry conditions
    if (/\b(?:buy|long|enter)\b/i.test(lower)) {
      const subClauses = lower.split(/\s+and\s+/i);
      const conditions: RuleCondition[] = [];
      for (const sc of subClauses) {
        const cond = parseConditionClause(sc);
        if (cond) conditions.push(cond);
      }
      if (conditions.length > 0) {
        entryRules.push({ action: "BUY", conditions, logic: "AND" });
      }
    }

    // Exit conditions
    if (/\b(?:sell|short|exit|close)\b/i.test(lower)) {
      const subClauses = lower.split(/\s+and\s+/i);
      const conditions: RuleCondition[] = [];
      for (const sc of subClauses) {
        const cond = parseConditionClause(sc);
        if (cond) conditions.push(cond);
      }
      if (conditions.length > 0) {
        exitRules.push({ action: "SELL", conditions, logic: "AND" });
      }
    }
  }

  const confidence = Math.min(
    0.3 + (entryRules.length > 0 ? 0.25 : 0) + (exitRules.length > 0 ? 0.2 : 0) +
    (stopRule ? 0.15 : 0) + (symbols.length > 0 ? 0.1 : 0),
    1.0
  );

  const name = symbols.length > 0
    ? `Lab_${symbols[0]}_${Date.now().toString(36)}`
    : `Lab_Strategy_${Date.now().toString(36)}`;

  const parsed: ParsedStrategy = {
    name, symbols, entryRules, exitRules, stopRule, riskPct,
    timeframe, confidence, rawPrompt: prompt, parsedAt: now,
  };

  totalPromptsParsed++;
  recentParsed.unshift(parsed);
  if (recentParsed.length > MAX_RECENT) recentParsed.pop();

  logger.info({ name, symbols, entryCount: entryRules.length, exitCount: exitRules.length, confidence: confidence.toFixed(2) }, "Prompt parsed");
  return parsed;
}

// ─── Rule Compiler ────────────────────────────────────────────────────────────

export function compileRules(parsed: ParsedStrategy): CompiledRule[] {
  const compiled: CompiledRule[] = [];
  const now = new Date().toISOString();

  const compileConditions = (conditions: RuleCondition[]) =>
    conditions.map((c) => {
      const field = c.period ? `${c.indicator}(${c.period})` : c.indicator;
      const target = typeof c.value === "number"
        ? String(c.value)
        : c.valuePeriod ? `${c.value}(${c.valuePeriod})` : String(c.value);
      return { field, op: c.operator, target };
    });

  for (const rule of [...parsed.entryRules, ...parsed.exitRules]) {
    const conditions = compileConditions(rule.conditions);
    const expression = conditions
      .map((c) => `${c.field} ${c.op} ${c.target}`)
      .join(` ${rule.logic} `);

    compiled.push({
      id: `rule_${compiled.length + 1}_${Date.now().toString(36)}`,
      action: rule.action,
      expression,
      conditions,
      compiledAt: now,
    });
  }

  totalStrategiesCompiled++;
  for (const c of compiled) {
    recentCompiled.unshift(c);
    if (recentCompiled.length > MAX_RECENT) recentCompiled.pop();
  }

  logger.info({ name: parsed.name, rulesCompiled: compiled.length }, "Rules compiled");
  return compiled;
}

// ─── Full Pipeline: Parse → Compile → Register ───────────────────────────────

export function labCreateStrategy(prompt: string, author?: string): {
  parsed: ParsedStrategy;
  compiled: CompiledRule[];
  registered: StrategyEntry;
} {
  const parsed = parsePrompt(prompt);
  const compiled = compileRules(parsed);

  const registered = registerStrategy({
    name: parsed.name,
    description: `Auto-generated from prompt: "${prompt.slice(0, 100)}${prompt.length > 100 ? "..." : ""}"`,
    author: author ?? "godsview_lab",
    tags: ["lab", "auto-parsed", ...parsed.symbols.map((s) => `symbol:${s}`)],
    parameters: {
      entryRules: parsed.entryRules,
      exitRules: parsed.exitRules,
      stopRule: parsed.stopRule,
      riskPct: parsed.riskPct,
      timeframe: parsed.timeframe,
      symbols: parsed.symbols,
      compiledRules: compiled,
      confidence: parsed.confidence,
    },
  });

  totalStrategiesRegistered++;
  logger.info({ id: registered.id, name: parsed.name }, "Lab strategy registered");
  return { parsed, compiled, registered };
}

// ─── Snapshot & Reset ─────────────────────────────────────────────────────────

export function getLabSnapshot(): LabSnapshot {
  return {
    totalPromptsParsed,
    totalStrategiesCompiled,
    totalStrategiesRegistered,
    recentParsed: recentParsed.slice(0, 10),
    recentCompiled: recentCompiled.slice(0, 10),
  };
}

export function resetLab(): void {
  totalPromptsParsed = 0;
  totalStrategiesCompiled = 0;
  totalStrategiesRegistered = 0;
  recentParsed.length = 0;
  recentCompiled.length = 0;
  logger.info("GodsView Lab reset");
}
