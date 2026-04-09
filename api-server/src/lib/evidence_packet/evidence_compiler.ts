import crypto from "crypto";
import pino from "pino";

const logger = pino({ name: "evidence-compiler" });

// Types
export interface BacktestEvidence {
  sharpe: number;
  win_rate: number;
  max_drawdown: number;
  trade_count: number;
  regime_results: Record<string, { pnl: number; trades: number }>;
}

export interface ValidationEvidence {
  session_count: number;
  paper_pnl: number;
  shadow_pnl: number;
  slippage_avg_bps: number;
}

export interface ReadinessEvidence {
  score: number;
  level: string;
  blockers_count: number;
  dimensions: Record<string, number>;
}

export interface CalibrationEvidence {
  drift_score: number;
  last_calibrated: string;
  divergence_metrics: Record<string, number>;
}

export interface RiskEvidence {
  max_exposure: number;
  daily_var: number;
  worst_drawdown: number;
  kill_switch_events: number;
}

export interface EvidencePacket {
  id: string;
  strategy_id: string;
  strategy_name: string;
  version: number;
  created_at: string;
  compiled_by: string;
  evidence: {
    backtest?: BacktestEvidence;
    validation?: ValidationEvidence;
    readiness?: ReadinessEvidence;
    calibration?: CalibrationEvidence;
    risk?: RiskEvidence;
  };
  overall_score: number;
  verdict: "promote" | "hold" | "reject" | "insufficient_data";
  blockers: string[];
  recommendations: string[];
  signature: string;
  locked: boolean;
}

// Weights
const WEIGHTS = { backtest: 20, validation: 25, readiness: 20, calibration: 15, risk: 20 };

// Storage
const packets = new Map<string, EvidencePacket>();

function scoreBacktest(e: BacktestEvidence): number {
  let s = 0;
  if (e.sharpe >= 2) s += 40; else if (e.sharpe >= 1) s += 25; else if (e.sharpe >= 0.5) s += 15;
  if (e.win_rate >= 0.6) s += 30; else if (e.win_rate >= 0.5) s += 20; else s += 10;
  if (e.max_drawdown <= 0.1) s += 30; else if (e.max_drawdown <= 0.2) s += 20; else s += 5;
  return Math.min(100, s);
}

function scoreValidation(e: ValidationEvidence): number {
  let s = 0;
  if (e.session_count >= 5) s += 25; else if (e.session_count >= 2) s += 15; else s += 5;
  if (e.paper_pnl > 0) s += 25; else s += 5;
  if (e.shadow_pnl > 0) s += 25; else s += 5;
  if (e.slippage_avg_bps <= 5) s += 25; else if (e.slippage_avg_bps <= 15) s += 15; else s += 5;
  return Math.min(100, s);
}

function scoreReadiness(e: ReadinessEvidence): number {
  return Math.min(100, Math.max(0, e.score));
}

function scoreCalibration(e: CalibrationEvidence): number {
  if (e.drift_score <= 0.05) return 100;
  if (e.drift_score <= 0.15) return 70;
  if (e.drift_score <= 0.3) return 40;
  return 20;
}

function scoreRisk(e: RiskEvidence): number {
  let s = 50;
  if (e.worst_drawdown <= 0.1) s += 25; else if (e.worst_drawdown <= 0.2) s += 15;
  if (e.kill_switch_events === 0) s += 25; else if (e.kill_switch_events <= 2) s += 10;
  return Math.min(100, s);
}

export function compileEvidencePacket(config: {
  strategy_id: string;
  strategy_name: string;
  backtest?: BacktestEvidence;
  validation?: ValidationEvidence;
  readiness?: ReadinessEvidence;
  calibration?: CalibrationEvidence;
  risk?: RiskEvidence;
  compiled_by?: string;
}): EvidencePacket {
  const evidence = {
    backtest: config.backtest,
    validation: config.validation,
    readiness: config.readiness,
    calibration: config.calibration,
    risk: config.risk,
  };

  // Score each category
  const scores: Record<string, number> = {
    backtest: config.backtest ? scoreBacktest(config.backtest) : 0,
    validation: config.validation ? scoreValidation(config.validation) : 0,
    readiness: config.readiness ? scoreReadiness(config.readiness) : 0,
    calibration: config.calibration ? scoreCalibration(config.calibration) : 0,
    risk: config.risk ? scoreRisk(config.risk) : 0,
  };

  const totalWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  const overall_score = Math.round(
    Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + scores[key] * weight, 0) / totalWeight
  );

  let verdict: EvidencePacket["verdict"];
  if (overall_score >= 80) verdict = "promote";
  else if (overall_score >= 60) verdict = "hold";
  else if (overall_score >= 40) verdict = "reject";
  else verdict = "insufficient_data";

  const blockers: string[] = [];
  if (config.readiness && config.readiness.blockers_count > 0) {
    blockers.push(`${config.readiness.blockers_count} readiness blockers remaining`);
  }

  const recommendations: string[] = [];
  if (scores.backtest < 50) recommendations.push("Improve backtest performance");
  if (scores.validation < 50) recommendations.push("Run more validation sessions");
  if (scores.calibration < 50) recommendations.push("Address calibration drift");
  if (config.risk && config.risk.kill_switch_events > 0) {
    recommendations.push("Investigate kill switch events before promotion");
  }

  const signature = crypto.createHash("sha256").update(JSON.stringify(evidence)).digest("hex");

  const existingPackets = Array.from(packets.values()).filter(p => p.strategy_id === config.strategy_id);
  const version = existingPackets.length + 1;

  const packet: EvidencePacket = {
    id: `ep_${crypto.randomUUID()}`,
    strategy_id: config.strategy_id,
    strategy_name: config.strategy_name,
    version,
    created_at: new Date().toISOString(),
    compiled_by: config.compiled_by || "system",
    evidence,
    overall_score,
    verdict,
    blockers,
    recommendations,
    signature,
    locked: false,
  };

  packets.set(packet.id, packet);
  logger.info({ id: packet.id, verdict, score: overall_score }, "Evidence packet compiled");
  return packet;
}

export function lockPacket(packet_id: string): { success: boolean; error?: string } {
  const p = packets.get(packet_id);
  if (!p) return { success: false, error: "Packet not found" };
  if (p.locked) return { success: false, error: "Packet already locked" };
  p.locked = true;
  return { success: true };
}

export function getPacket(id: string): EvidencePacket | undefined {
  return packets.get(id);
}

export function getPacketsByStrategy(strategy_id: string): EvidencePacket[] {
  return Array.from(packets.values()).filter(p => p.strategy_id === strategy_id);
}

export function getAllPackets(limit?: number): EvidencePacket[] {
  const all = Array.from(packets.values());
  return limit ? all.slice(-limit) : all;
}

export function _clearPackets(): void {
  packets.clear();
}
