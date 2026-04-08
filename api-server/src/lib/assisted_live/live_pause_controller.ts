/**
 * Live Pause Controller — Phase 21
 *
 * Manages pause/resume for assisted-live sessions with incident tracking.
 * When a session is paused:
 *   - No new orders can be submitted
 *   - Pending approvals are frozen (not expired)
 *   - Existing positions remain open but unmanaged
 *
 * Pause can be triggered manually or automatically by safety systems.
 */

import { logger } from "../logger";
import { pauseSession, resumeSession, getSession } from "./live_session_manager";
import { logIncident } from "./live_incident_logger";

export interface PauseResult {
  session_id: string;
  action: "paused" | "resumed";
  operator_id: string;
  reason?: string;
  incident_id?: string;
  timestamp: string;
  error?: string;
}

/**
 * Pause a session — blocks new order submissions.
 */
export function pauseLiveSession(
  session_id: string,
  operator_id: string,
  reason: string = "manual_pause"
): PauseResult {
  const timestamp = new Date().toISOString();

  const result = pauseSession(session_id, operator_id);
  if (!result.success) {
    return { session_id, action: "paused", operator_id, timestamp, error: result.error };
  }

  const incident = logIncident({
    session_id,
    strategy_id: result.session?.strategy_id,
    severity: "warning",
    type: "manual_pause",
    title: `Session paused by ${operator_id}`,
    description: reason,
    auto_action: "pause_session",
  });

  logger.warn({ session_id, operator_id, reason }, "Live session PAUSED");

  return {
    session_id,
    action: "paused",
    operator_id,
    reason,
    incident_id: incident.incident_id,
    timestamp,
  };
}

/**
 * Resume a paused session — allows order submissions again.
 */
export function resumeLiveSession(
  session_id: string,
  operator_id: string,
  reason: string = "manual_resume"
): PauseResult {
  const timestamp = new Date().toISOString();

  const result = resumeSession(session_id, operator_id);
  if (!result.success) {
    return { session_id, action: "resumed", operator_id, timestamp, error: result.error };
  }

  logger.info({ session_id, operator_id, reason }, "Live session RESUMED");

  return {
    session_id,
    action: "resumed",
    operator_id,
    reason,
    timestamp,
  };
}

/**
 * Auto-pause triggered by safety systems (not manual).
 */
export function autoPauseLiveSession(
  session_id: string,
  trigger: string,
  details?: Record<string, unknown>
): PauseResult {
  const timestamp = new Date().toISOString();
  const session = getSession(session_id);
  if (!session || session.status !== "active") {
    return { session_id, action: "paused", operator_id: "system", timestamp, error: "Session not active" };
  }

  const result = pauseSession(session_id, "system");
  if (!result.success) {
    return { session_id, action: "paused", operator_id: "system", timestamp, error: result.error };
  }

  const incident = logIncident({
    session_id,
    strategy_id: session.strategy_id,
    severity: "critical",
    type: "manual_pause",
    title: `Session auto-paused: ${trigger}`,
    description: `Automatic pause triggered by ${trigger}`,
    details_json: details,
    auto_action: "auto_pause",
  });

  logger.fatal({ session_id, trigger, details }, "Live session AUTO-PAUSED by safety system");

  return {
    session_id,
    action: "paused",
    operator_id: "system",
    reason: trigger,
    incident_id: incident.incident_id,
    timestamp,
  };
}
