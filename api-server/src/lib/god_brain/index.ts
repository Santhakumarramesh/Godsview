/**
 * God Brain — Phase 25
 * Central unified brain module exporting decision packets and aggregation
 */

export {
  createDecisionPacket,
  getPacket,
  getAllPackets,
  queryPackets,
  markForReplay,
  _clearAll,
  type DecisionAction,
  type MarketRegime,
  type CertificationStatus,
  type DecisionPacket,
} from "./decision_packet";

export {
  getBrainStatus,
  getDecisionQueue,
  getTerminalData,
  _resetBrainStartTime,
  type BrainMode,
  type HealthStatus,
  type BrainStatus,
  type DecisionQueueItem,
  type TerminalData,
} from "./brain_aggregator";
