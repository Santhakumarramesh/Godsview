/**
 * Emergency Flatten Controller — Phase 21
 *
 * Handles session-scoped emergency position flattening.
 * Unlike the global emergency liquidator, this targets a specific session's positions.
 */

import { logger } from "../logger";
import { emergencyLiquidateAll } from "../emergency_liquidator";
import { flattenSession } from "./live_session_manager";
import { logIncident } from "./live_incident_logger";

export interface FlattenResult {
  session_id: string;
  operator_id: string;
  status: "flattened" | "error";
  liquidation_result?: any;
  incident_id?: string;
  timestamp: string;
  error?: string;
}

/**
 * Flatten all positions for a given session.
 * This is the nuclear option — closes everything and marks the session as flattened.
 */
export async function flattenSessionPositions(
  session_id: string,
  operator_id: string,
  reason: string = "operator_flatten"
): Promise<FlattenResult> {
  const timestamp = new Date().toISOString();

  try {
    logger.fatal({ session_id, operator_id, reason }, "FLATTEN initiated for assisted-live session");

    // 1. Mark session as flattened
    const sessionResult = flattenSession(session_id, operator_id);
    if (!sessionResult.success) {
      return {
        session_id,
        operator_id,
        status: "error",
        timestamp,
        error: sessionResult.error,
      };
    }

    // 2. Emergency liquidate all positions (session-scoped in a real broker integration
    //    would filter by session — for now, we use the global liquidator as a safety net)
    const liquidationResult = await emergencyLiquidateAll(`session_flatten:${session_id}:${reason}`);

    // 3. Log incident
    const incident = logIncident({
      session_id,
      strategy_id: sessionResult.session?.strategy_id,
      severity: "emergency",
      type: "emergency_flatten",
      title: `Session ${session_id} flattened`,
      description: `Operator ${operator_id} flattened all positions. Reason: ${reason}`,
      details_json: { reason, liquidation_result: liquidationResult },
      auto_action: "flatten_all_positions",
    });

    return {
      session_id,
      operator_id,
      status: "flattened",
      liquidation_result: liquidationResult,
      incident_id: incident.incident_id,
      timestamp,
    };
  } catch (err) {
    logger.error({ err, session_id }, "Flatten failed");
    return {
      session_id,
      operator_id,
      status: "error",
      timestamp,
      error: String(err),
    };
  }
}
