/**
 * mcp_stream.ts — SSE streaming endpoints for MCP pipeline events
 *
 * Provides real-time streams for MCP signal processing, decisions,
 * brain node state transitions, and streaming statistics.
 *
 * Endpoints:
 *   GET /mcp/stream                 → MCP events (filterable by subtype)
 *   GET /mcp/stream/decisions       → Decision events only
 *   GET /mcp/stream/brain-graph     → Brain node state transitions
 *   GET /mcp/stream/stats           → Stream statistics (REST)
 *
 * All SSE endpoints support Last-Event-ID header for reconnect replay.
 */

import { Router } from "express";
import { signalHub } from "../lib/signal_stream.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Brain Node Simulation State ────────────────────────────────────────────

interface BrainNodeState {
  active: boolean;
  score: number | null;
  data?: Record<string, unknown>;
}

interface BrainGraphEvent {
  signalId: string;
  nodes: Record<string, BrainNodeState>;
  flow: {
    currentStep: string;
    progress: number;
    latencyMs: number;
  };
  decision: unknown;
}

const BRAIN_NODES = [
  "tick",
  "structure",
  "orderflow",
  "context",
  "memory",
  "risk",
  "reasoning",
];

const FLOW_STEPS = [
  "ingestion",
  "enrichment",
  "validation",
  "scoring",
  "reasoning",
  "decision",
];

let signalCounter = 0;
function nextSignalId(): string {
  return `sig-${Date.now()}-${++signalCounter}`;
}

/**
 * Generate a synthetic brain node state event for demo visualization.
 * Simulates a signal flowing through the 8-node system.
 */
function generateBrainGraphEvent(): BrainGraphEvent {
  const signalId = nextSignalId();
  const flowStep = Math.floor(Math.random() * FLOW_STEPS.length);
  const progress = (flowStep + Math.random()) / FLOW_STEPS.length;

  const nodes: Record<string, BrainNodeState> = {};

  // Simulate node activation as signal flows through pipeline
  for (const nodeName of BRAIN_NODES) {
    const nodeIdx = BRAIN_NODES.indexOf(nodeName);

    // Nodes activate in sequence as signal flows
    const activationThreshold = (flowStep / FLOW_STEPS.length) * 0.8;
    const isActive = nodeIdx / BRAIN_NODES.length < activationThreshold;

    if (isActive) {
      // Generate realistic score based on node position
      const baseScore = 0.6 + Math.random() * 0.35;
      nodes[nodeName] = {
        active: true,
        score: Math.min(0.99, baseScore),
        data: {
          processed: Math.floor(Math.random() * 1000),
          latency: Math.floor(Math.random() * 15),
          confidence: 0.7 + Math.random() * 0.25,
        },
      };
    } else {
      nodes[nodeName] = {
        active: false,
        score: null,
      };
    }
  }

  const latency = Math.floor(Math.random() * 20 + 2);

  return {
    signalId,
    nodes,
    flow: {
      currentStep: FLOW_STEPS[flowStep],
      progress: Math.min(0.99, progress),
      latencyMs: latency,
    },
    decision: flowStep === FLOW_STEPS.length - 1 ? {
      action: ["APPLY", "VETO", "REVIEW"][Math.floor(Math.random() * 3)],
      confidence: 0.7 + Math.random() * 0.25,
    } : null,
  };
}

// ── SSE Clients Tracking ───────────────────────────────────────────────────

const brainGraphClients = new Set<string>();
let brainGraphSimulator: ReturnType<typeof setInterval> | null = null;

/**
 * Start brain graph simulator if there are active clients.
 * Generates synthetic events every 2-3 seconds.
 */
function startBrainGraphSimulator(): void {
  if (brainGraphSimulator) return;

  brainGraphSimulator = setInterval(() => {
    if (brainGraphClients.size === 0) {
      // Stop if no clients
      if (brainGraphSimulator) {
        clearInterval(brainGraphSimulator);
        brainGraphSimulator = null;
      }
      return;
    }

    const event = generateBrainGraphEvent();
    signalHub.publish({
      id: `mcp-brain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "signal",
      data: {
        subtype: "mcp:brain-graph",
        ...event,
      },
      timestamp: new Date().toISOString(),
    });
  }, 2000 + Math.random() * 1000);

  if (brainGraphSimulator?.unref) brainGraphSimulator.unref();
}

/**
 * Stop brain graph simulator if no clients remain.
 */
function stopBrainGraphSimulatorIfNeeded(): void {
  if (brainGraphClients.size === 0 && brainGraphSimulator) {
    clearInterval(brainGraphSimulator);
    brainGraphSimulator = null;
  }
}

// ── GET /mcp/stream — MCP events with optional subtype filtering ────────────

router.get("/mcp/stream", (req, res) => {
  const subtypes = String(req.query.types ?? "").split(",").filter(Boolean);

  const clientId = signalHub.addClient(res, ["signal"]);

  // Wrap client to filter MCP events by subtype if specified
  const originalWrite = res.write.bind(res);
  let isFirstMessage = true;

  res.write = function (chunk: string | Buffer, encoding?: string | ((error?: Error | null) => void) | boolean, callback?: ((error?: Error | null) => void)): boolean {
    if (isFirstMessage) {
      // Allow the "connected" event through
      isFirstMessage = false;
      return originalWrite(chunk, encoding as any, callback as any);
    }

    if (typeof chunk === "string" && subtypes.length > 0) {
      try {
        // Check if this is an MCP signal event with subtype filtering
        if (chunk.includes("mcp:")) {
          const hasMatchingSubtype = subtypes.some((t) => chunk.includes(`mcp:${t}`));
          if (!hasMatchingSubtype) {
            // Skip this event
            return true;
          }
        }
      } catch {
        // Parsing error, allow through
      }
    }

    return originalWrite(chunk, encoding as any, callback as any);
  } as any;

  const lastId = req.headers["last-event-id"];
  if (lastId) {
    signalHub.replay(clientId, String(lastId));
  }

  res.on("close", () => {
    signalHub.removeClient(clientId);
    logger.debug({ clientId }, "MCP stream client disconnected");
  });
});

// ── GET /mcp/stream/decisions — Decision events only ────────────────────────

router.get("/mcp/stream/decisions", (req, res) => {
  const clientId = signalHub.addClient(res, ["signal"]);

  // Filter to only "mcp:decided" events
  const originalWrite = res.write.bind(res);
  let isFirstMessage = true;

  res.write = function (chunk: string | Buffer, encoding?: string | ((error?: Error | null) => void) | boolean, callback?: ((error?: Error | null) => void)): boolean {
    if (isFirstMessage) {
      // Allow the "connected" event through
      isFirstMessage = false;
      return originalWrite(chunk, encoding as any, callback as any);
    }

    if (typeof chunk === "string") {
      try {
        // Only allow mcp:decided events
        if (!chunk.includes("mcp:decided")) {
          // Skip this event
          return true;
        }
      } catch {
        // Parsing error, allow through
      }
    }

    return originalWrite(chunk, encoding as any, callback as any);
  } as any;

  const lastId = req.headers["last-event-id"];
  if (lastId) {
    signalHub.replay(clientId, String(lastId));
  }

  res.on("close", () => {
    signalHub.removeClient(clientId);
    logger.debug({ clientId }, "MCP decisions stream client disconnected");
  });
});

// ── GET /mcp/stream/brain-graph — Brain node state streaming ────────────────

router.get("/mcp/stream/brain-graph", (req, res) => {
  const clientId = signalHub.addClient(res, ["signal"]);
  brainGraphClients.add(clientId);

  // Start simulator when first client connects
  if (brainGraphClients.size === 1) {
    startBrainGraphSimulator();
    logger.debug("Brain graph simulator started");
  }

  // Filter to only "mcp:brain-graph" events
  const originalWrite = res.write.bind(res);
  let isFirstMessage = true;

  res.write = function (chunk: string | Buffer, encoding?: string | ((error?: Error | null) => void) | boolean, callback?: ((error?: Error | null) => void)): boolean {
    if (isFirstMessage) {
      // Allow the "connected" event through
      isFirstMessage = false;
      return originalWrite(chunk, encoding as any, callback as any);
    }

    if (typeof chunk === "string") {
      try {
        // Only allow mcp:brain-graph events
        if (!chunk.includes("mcp:brain-graph")) {
          // Skip this event
          return true;
        }
      } catch {
        // Parsing error, allow through
      }
    }

    return originalWrite(chunk, encoding as any, callback as any);
  } as any;

  const lastId = req.headers["last-event-id"];
  if (lastId) {
    signalHub.replay(clientId, String(lastId));
  }

  res.on("close", () => {
    signalHub.removeClient(clientId);
    brainGraphClients.delete(clientId);
    stopBrainGraphSimulatorIfNeeded();
    logger.debug({ clientId }, "Brain graph stream client disconnected");
  });
});

// ── GET /mcp/stream/stats — Stream statistics (REST endpoint) ────────────────

router.get("/mcp/stream/stats", (_req, res) => {
  const status = signalHub.status();

  res.json({
    timestamp: new Date().toISOString(),
    connectedClients: status.clientCount,
    recentEvents: status.recentEventCount,
    brainGraphClientsActive: brainGraphClients.size,
    brainGraphSimulatorRunning: brainGraphSimulator !== null,
    clientsByEndpoint: {
      "mcp/stream": status.clients.filter(
        (c) =>
          typeof c.filter === "object" &&
          Array.isArray(c.filter) &&
          c.filter.includes("signal")
      ).length,
      "mcp/stream/decisions": status.clients.filter((c) => {
        // Note: We can't easily distinguish without extra tracking,
        // so this counts signal clients. For better tracking, would need
        // separate hub or metadata.
        return (
          typeof c.filter === "object" &&
          Array.isArray(c.filter) &&
          c.filter.includes("signal")
        );
      }).length,
      "mcp/stream/brain-graph": brainGraphClients.size,
    },
    clients: status.clients.map((c) => ({
      id: c.id,
      connectedAt: c.connectedAt,
      connectionDuration: Date.now() - c.connectedAt,
    })),
  });
});

export default router;
