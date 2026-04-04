import { Router, type IRouter } from "express";
import {
  getBrainNode,
  getBrainNodeClusters,
  getBrainNodeDrilldown,
  getBrainNodeRelationships,
  listBrainNodes,
} from "../lib/brain_nodes";

const router: IRouter = Router();

function parsePositiveInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

router.get("/brain/nodes", async (req, res) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 120, 1, 300);
    const nodes = await listBrainNodes(limit);
    res.json({
      count: nodes.length,
      nodes,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list brain nodes");
    res.status(500).json({ error: "brain_nodes_failed", message: "Failed to list brain nodes" });
  }
});

router.get("/brain/nodes/:symbol", async (req, res) => {
  try {
    const node = await getBrainNode(req.params.symbol);
    if (!node) {
      res.status(404).json({ error: "not_found", message: "Node not found" });
      return;
    }
    res.json({ node });
  } catch (err) {
    req.log.error({ err }, "Failed to load brain node");
    res.status(500).json({ error: "brain_node_failed", message: "Failed to load brain node" });
  }
});

router.get("/brain/nodes/:symbol/drilldown", async (req, res) => {
  try {
    const memoryLimit = parsePositiveInt(req.query.memory_limit, 25, 1, 200);
    const eventLimit = parsePositiveInt(req.query.event_limit, 80, 1, 300);
    const decisionLimit = parsePositiveInt(req.query.decision_limit, 40, 1, 200);

    const drilldown = await getBrainNodeDrilldown(req.params.symbol, {
      memoryLimit,
      eventLimit,
      decisionLimit,
    });

    if (!drilldown) {
      res.status(404).json({ error: "not_found", message: "Node not found" });
      return;
    }

    res.json(drilldown);
  } catch (err) {
    req.log.error({ err }, "Failed to load brain node drilldown");
    res.status(500).json({ error: "brain_node_drilldown_failed", message: "Failed to load node drilldown" });
  }
});

router.get("/brain/clusters", async (req, res) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 120, 1, 300);
    const clusters = await getBrainNodeClusters(limit);
    res.json({
      ...clusters,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load brain node clusters");
    res.status(500).json({ error: "brain_clusters_failed", message: "Failed to load brain clusters" });
  }
});

router.get("/brain/relationships", async (req, res) => {
  try {
    const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
    const limit = parsePositiveInt(req.query.limit, 250, 1, 500);
    const relationships = await getBrainNodeRelationships(symbol, limit);
    res.json({
      count: relationships.length,
      relationships,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load brain relationships");
    res.status(500).json({ error: "brain_relationships_failed", message: "Failed to load relationships" });
  }
});

export default router;
