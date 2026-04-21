import { z } from "zod";

export const BrainNodeTypeSchema = z.enum(["asset", "strategy", "agent", "position", "risk", "alert", "signal", "regime"]);
export type BrainNodeType = z.infer<typeof BrainNodeTypeSchema>;

export const BrainNodeSchema = z.object({
  id: z.string(),
  type: BrainNodeTypeSchema,
  label: z.string(),
  symbol: z.string().optional(),
  confidence: z.number().min(0).max(1),
  status: z.enum(["active", "idle", "alert", "error"]),
  metrics: z.record(z.string(), z.number()).optional(),
  updatedAt: z.string().datetime(),
});
export type BrainNode = z.infer<typeof BrainNodeSchema>;

export const BrainEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  weight: z.number().min(0).max(1),
  type: z.enum(["signal", "dependency", "correlation", "flow"]),
});
export type BrainEdge = z.infer<typeof BrainEdgeSchema>;

export const BrainGraphSchema = z.object({
  nodes: z.array(BrainNodeSchema),
  edges: z.array(BrainEdgeSchema),
  timestamp: z.string().datetime(),
});
export type BrainGraph = z.infer<typeof BrainGraphSchema>;

export const BrainStreamEventSchema = z.object({
  type: z.enum(["node_update", "edge_update", "alert", "heartbeat"]),
  payload: z.unknown(),
  timestamp: z.string().datetime(),
});
export type BrainStreamEvent = z.infer<typeof BrainStreamEventSchema>;
