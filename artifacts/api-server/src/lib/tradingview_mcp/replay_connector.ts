/**
 * Phase 97 — Replay Connector
 *
 * Connects TradingView replay sessions with the memory/recall engine.
 * Stores observations, links to case library, and exports replay data
 * for learning.
 */
import { EventEmitter } from "events";
import { logger } from "../logger";

export interface ChartState {
  symbol: string;
  timeframe: string;
  timestamp: Date;
  price: number;
  openPrice?: number;
  highPrice?: number;
  lowPrice?: number;
  closePrice?: number;
  volume?: number;
  indicators?: Record<string, unknown>;
}

export interface Decision {
  timestamp: Date;
  type: "entry" | "exit" | "scale" | "analysis";
  direction: "long" | "short" | "none";
  price: number;
  rationale: string;
  confidence: number;
}

export interface ReplayObservation {
  id: string;
  chartState: ChartState;
  decision?: Decision;
  notes?: string;
  tags?: string[];
  timestamp: Date;
}

export interface ReplaySession {
  id: string;
  symbol: string;
  timeframe: string;
  startDate: Date;
  endDate?: Date;
  status: "active" | "paused" | "completed" | "archived";
  observations: ReplayObservation[];
  caseLibraryId?: string;
  outcome?: "win" | "loss" | "breakeven" | "incomplete";
  summary?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ReplayConnector — manages TradingView replay sessions and memory linking
 *
 * Events:
 * - 'session_started': (session: ReplaySession)
 * - 'observation_recorded': (observation: ReplayObservation)
 * - 'session_ended': (session: ReplaySession)
 * - 'linked_to_case': (sessionId: string, caseId: string)
 * - 'error': (error: Error)
 */
export class ReplayConnector extends EventEmitter {
  private sessions: Map<string, ReplaySession> = new Map();
  private observations: Map<string, ReplayObservation[]> = new Map();
  private maxSessions = 500;
  private maxObservationsPerSession = 1000;
  private stats = {
    sessionsCreated: 0,
    observationsRecorded: 0,
    casesLinked: 0,
  };

  constructor() {
    super();
    logger.info("Replay Connector initialized");
  }

  /** Start a new replay session */
  startSession(symbol: string, timeframe: string, startDate: Date): ReplaySession {
    const id = `replay_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const session: ReplaySession = {
      id,
      symbol,
      timeframe,
      startDate,
      status: "active",
      observations: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sessions.set(id, session);
    this.observations.set(id, []);
    this.stats.sessionsCreated++;

    logger.info(`Replay session started: ${symbol} ${timeframe} from ${startDate.toISOString()}`);
    this.emit("session_started", session);

    return session;
  }

  /** Stop a replay session */
  stopSession(sessionId: string, outcome?: ReplaySession["outcome"], summary?: string): ReplaySession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    session.status = "completed";
    session.endDate = new Date();
    session.outcome = outcome;
    session.summary = summary;
    session.updatedAt = new Date();

    logger.info(`Replay session completed: ${sessionId} (outcome: ${outcome})`);
    this.emit("session_ended", session);

    return session;
  }

  /** Pause a replay session */
  pauseSession(sessionId: string): ReplaySession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    session.status = "paused";
    session.updatedAt = new Date();

    logger.info(`Replay session paused: ${sessionId}`);
    return session;
  }

  /** Resume a paused replay session */
  resumeSession(sessionId: string): ReplaySession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (session.status !== "paused") return null;

    session.status = "active";
    session.updatedAt = new Date();

    logger.info(`Replay session resumed: ${sessionId}`);
    return session;
  }

  /** Record an observation within a session */
  recordObservation(
    sessionId: string,
    chartState: ChartState,
    decision?: Decision,
    notes?: string,
    tags?: string[],
  ): ReplayObservation | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const obsId = `obs_${sessionId}_${Date.now()}`;

    const observation: ReplayObservation = {
      id: obsId,
      chartState,
      decision,
      notes,
      tags,
      timestamp: new Date(),
    };

    session.observations.push(observation);
    const sessionObs = this.observations.get(sessionId) || [];
    sessionObs.push(observation);
    if (sessionObs.length > this.maxObservationsPerSession) {
      sessionObs.shift();
    }
    this.observations.set(sessionId, sessionObs);

    session.updatedAt = new Date();
    this.stats.observationsRecorded++;

    logger.debug(`Observation recorded in session ${sessionId}`);
    this.emit("observation_recorded", observation);

    return observation;
  }

  /** Link replay session to case library */
  linkToCase(sessionId: string, caseLibraryId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.caseLibraryId = caseLibraryId;
    session.updatedAt = new Date();
    this.stats.casesLinked++;

    logger.info(`Replay session ${sessionId} linked to case ${caseLibraryId}`);
    this.emit("linked_to_case", sessionId, caseLibraryId);

    return true;
  }

  /** Get a session by ID */
  getSession(sessionId: string): ReplaySession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Get all observations in a session */
  getObservations(sessionId: string): ReplayObservation[] {
    return this.observations.get(sessionId) || [];
  }

  /** Get sessions by status */
  getSessionsByStatus(status: ReplaySession["status"]): ReplaySession[] {
    return Array.from(this.sessions.values()).filter((s) => s.status === status);
  }

  /** Get sessions by symbol */
  getSessionsBySymbol(symbol: string): ReplaySession[] {
    return Array.from(this.sessions.values()).filter((s) => s.symbol === symbol);
  }

  /** Export replay session data for memory engine */
  exportSessionData(sessionId: string): unknown {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const observations = this.observations.get(sessionId) || [];

    return {
      sessionId,
      symbol: session.symbol,
      timeframe: session.timeframe,
      duration: session.endDate ? session.endDate.getTime() - session.startDate.getTime() : null,
      outcome: session.outcome,
      observations: observations.map((o) => ({
        timestamp: o.timestamp,
        price: o.chartState.price,
        decision: o.decision,
        tags: o.tags,
      })),
      decisionLog: observations
        .filter((o) => o.decision)
        .map((o) => ({
          type: o.decision?.type,
          direction: o.decision?.direction,
          price: o.decision?.price,
          rationale: o.decision?.rationale,
          confidence: o.decision?.confidence,
        })),
      summary: session.summary,
      caseId: session.caseLibraryId,
    };
  }

  /** Get all active sessions */
  getActiveSessions(): ReplaySession[] {
    return Array.from(this.sessions.values()).filter((s) => s.status === "active");
  }

  /** Get session statistics */
  getStats() {
    return {
      totalSessions: this.sessions.size,
      activeSessions: this.getActiveSessions().length,
      totalObservations: Array.from(this.observations.values()).reduce((sum, obs) => sum + obs.length, 0),
      sessionsCreated: this.stats.sessionsCreated,
      observationsRecorded: this.stats.observationsRecorded,
      casesLinked: this.stats.casesLinked,
    };
  }

  /** Get all sessions */
  getAllSessions(): ReplaySession[] {
    return Array.from(this.sessions.values());
  }

  /** Archive a session */
  archiveSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.status = "archived";
    session.updatedAt = new Date();

    logger.info(`Replay session archived: ${sessionId}`);
    return true;
  }

  /** Clear all (for testing) */
  clear(): void {
    this.sessions.clear();
    this.observations.clear();
    logger.info("Replay Connector cleared");
  }
}

export const replayConnector = new ReplayConnector();
