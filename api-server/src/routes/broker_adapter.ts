import { Router, Request, Response } from "express";
import { brokerManager } from "../lib/broker_adapter";

const router = Router();

// POST /brokers - Register broker
router.post("/", (req: Request, res: Response) => {
  const { name, type, priority, capabilities, config } = req.body;
  if (!name || !type || priority === undefined || !capabilities || !config) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }
  const result = brokerManager.registerBroker(name, type, priority, capabilities, config);
  res.status(result.success ? 201 : 400).json(result);
});

// GET /brokers - Get all brokers
router.get("/", (_req: Request, res: Response) => {
  const result = brokerManager.getAllBrokers();
  res.status(200).json(result);
});

// GET /brokers/connected - Get connected brokers
router.get("/connected", (_req: Request, res: Response) => {
  const result = brokerManager.getConnectedBrokers();
  res.status(200).json(result);
});

// GET /brokers/:id - Get single broker
router.get("/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const result = brokerManager.getBroker(id);
  res.status(result.success ? 200 : 404).json(result);
});

// POST /brokers/:id/health - Update broker health
router.post("/:id/health", (req: Request, res: Response) => {
  const { id } = req.params;
  const { latency_ms, uptime_pct, error_rate, last_error } = req.body;
  if (latency_ms === undefined || uptime_pct === undefined || error_rate === undefined) {
    return res.status(400).json({ success: false, error: "Missing required health fields" });
  }
  const result = brokerManager.updateBrokerHealth(id, latency_ms, uptime_pct, error_rate, last_error);
  res.status(result.success ? 200 : 404).json(result);
});

// POST /brokers/:id/status - Update broker status
router.post("/:id/status", (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ success: false, error: "Missing status" });
  }
  const result = brokerManager.updateBrokerStatus(id, status);
  res.status(result.success ? 200 : 404).json(result);
});

// POST /brokers/:id/heartbeat - Record heartbeat
router.post("/:id/heartbeat", (req: Request, res: Response) => {
  const { id } = req.params;
  const result = brokerManager.recordHeartbeat(id);
  res.status(result.success ? 200 : 404).json(result);
});

// POST /brokers/:id/circuit-breaker - Trigger circuit breaker
router.post("/:id/circuit-breaker", (req: Request, res: Response) => {
  const { id } = req.params;
  const result = brokerManager.triggerCircuitBreaker(id);
  res.status(result.success ? 200 : 404).json(result);
});

// POST /brokers/:id/reset-circuit - Reset circuit breaker
router.post("/:id/reset-circuit", (req: Request, res: Response) => {
  const { id } = req.params;
  const result = brokerManager.resetCircuitBreaker(id);
  res.status(result.success ? 200 : 404).json(result);
});

// POST /routes - Set symbol route
router.post("/routes", (req: Request, res: Response) => {
  const { symbol, preferred_broker_id, fallback_broker_ids, reason } = req.body;
  if (!symbol || !preferred_broker_id || !fallback_broker_ids || !reason) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }
  const result = brokerManager.setRoute(symbol, preferred_broker_id, fallback_broker_ids, reason);
  res.status(result.success ? 201 : 400).json(result);
});

// GET /routes - Get all routes
router.get("/routes", (_req: Request, res: Response) => {
  const result = brokerManager.getAllRoutes();
  res.status(200).json(result);
});

// GET /routes/:symbol - Get route for symbol
router.get("/routes/:symbol", (req: Request, res: Response) => {
  const { symbol } = req.params;
  const result = brokerManager.getRoute(symbol);
  res.status(result.success ? 200 : 404).json(result);
});

// POST /route-order - Route order request
router.post("/route-order", (req: Request, res: Response) => {
  const { symbol, capability } = req.body;
  if (!symbol || !capability) {
    return res.status(400).json({ success: false, error: "Missing symbol or capability" });
  }
  const result = brokerManager.routeOrder(symbol, capability);
  res.status(result.success ? 200 : 400).json(result);
});

export default router;
