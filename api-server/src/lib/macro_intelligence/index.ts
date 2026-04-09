/**
 * Phase 33 — Macro Intelligence: Barrel Export
 *
 * Exports event calendar and macro risk scoring subsystems.
 */

export type { EconomicEvent, EventWindow, EventCategory, EventSeverity, EventStatus } from "./event_calendar.js";
export {
  addEvent,
  removeEvent,
  getUpcomingEvents,
  getActiveEvents,
  isInLockout,
  isInCooldown,
  getEventWindows,
  _clearEvents,
} from "./event_calendar.js";

export type { MacroRiskScore, NewsDistortion, RiskLevel } from "./macro_risk_scorer.js";
export {
  computeMacroRisk,
  addNewsDistortion,
  getActiveDistortions,
  getMacroRiskScore,
  getAllRiskScores,
  _clearAll,
} from "./macro_risk_scorer.js";
