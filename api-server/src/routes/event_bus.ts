import { Router, Request, Response } from "express";
import { pino } from "pino";
import {
  eventBusService,
  EventChannel,
  EventPriority,
  EventStatus,
} from "../lib/event_bus";

const router = Router();
const logger = pino();

/**
 * POST /publish
 * Publish an event to the event bus
 */
router.post("/publish", (req: Request, res: Response) => {
  try {
    const { channel, type, payload, source, priority, correlation_id, expires_at, metadata } =
      req.body;

    if (!channel || !type || !payload || !source) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: channel, type, payload, source",
      });
    }

    const event = eventBusService.publishEvent(channel as EventChannel, type, payload, source, {
      priority: priority as EventPriority,
      correlation_id,
      expires_at,
      metadata,
    });

    logger.info({ event }, "Event published");
    res.status(201).json({ success: true, data: event });
  } catch (err) {
    logger.error(err, "Error publishing event");
    res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * GET /events
 * List events with optional filtering
 */
router.get("/events", (req: Request, res: Response) => {
  try {
    const { channel, limit, priority, status } = req.query;

    const events = eventBusService.getEvents({
      channel: channel as EventChannel,
      limit: limit ? parseInt(limit as string) : undefined,
      priority: priority as EventPriority,
      status: status as EventStatus,
    });

    logger.info({ count: events.length }, "Events retrieved");
    res.json({ success: true, data: events });
  } catch (err) {
    logger.error(err, "Error retrieving events");
    res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * GET /events/:id
 * Get a single event by ID
 */
router.get("/events/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const event = eventBusService.getEvent(id);

    if (!event) {
      return res.status(404).json({ success: false, error: "Event not found" });
    }

    logger.info({ id }, "Event retrieved");
    res.json({ success: true, data: event });
  } catch (err) {
    logger.error(err, "Error retrieving event");
    res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * GET /events/correlation/:correlation_id
 * Get events by correlation ID
 */
router.get("/events/correlation/:correlation_id", (req: Request, res: Response) => {
  try {
    const { correlation_id } = req.params;
    const events = eventBusService.getEventsByCorrelation(correlation_id);

    logger.info({ count: events.length }, "Events by correlation retrieved");
    res.json({ success: true, data: events });
  } catch (err) {
    logger.error(err, "Error retrieving events by correlation");
    res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * POST /subscribe
 * Create a subscription
 */
router.post("/subscribe", (req: Request, res: Response) => {
  try {
    const { channel, subscriber, filter } = req.body;

    if (!channel || !subscriber) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: channel, subscriber",
      });
    }

    const subscription = eventBusService.subscribe(channel as EventChannel, subscriber, filter);

    logger.info({ id: subscription.id }, "Subscription created");
    res.status(201).json({ success: true, data: subscription });
  } catch (err) {
    logger.error(err, "Error creating subscription");
    res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * DELETE /subscriptions/:id
 * Unsubscribe from a channel
 */
router.delete("/subscriptions/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const subscription = eventBusService.getSubscription(id);

    if (!subscription) {
      return res.status(404).json({ success: false, error: "Subscription not found" });
    }

    eventBusService.unsubscribe(id);

    logger.info({ id }, "Subscription deactivated");
    res.json({ success: true, data: { id, message: "Unsubscribed" } });
  } catch (err) {
    logger.error(err, "Error unsubscribing");
    res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * GET /subscriptions
 * List all subscriptions
 */
router.get("/subscriptions", (req: Request, res: Response) => {
  try {
    const subscriptions = eventBusService.getAllSubscriptions();

    logger.info({ count: subscriptions.length }, "Subscriptions retrieved");
    res.json({ success: true, data: subscriptions });
  } catch (err) {
    logger.error(err, "Error retrieving subscriptions");
    res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * GET /subscriptions/channel/:channel
 * Get subscriptions for a specific channel
 */
router.get("/subscriptions/channel/:channel", (req: Request, res: Response) => {
  try {
    const { channel } = req.params;
    const subscriptions = eventBusService.getSubscriptionsForChannel(channel as EventChannel);

    logger.info({ count: subscriptions.length }, "Subscriptions for channel retrieved");
    res.json({ success: true, data: subscriptions });
  } catch (err) {
    logger.error(err, "Error retrieving subscriptions for channel");
    res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * POST /rules
 * Add an event rule
 */
router.post("/rules", (req: Request, res: Response) => {
  try {
    const { name, channel, condition, action, action_config } = req.body;

    if (!name || !channel || !condition || !action || !action_config) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: name, channel, condition, action, action_config",
      });
    }

    const rule = eventBusService.addRule(
      name,
      channel as EventChannel,
      condition,
      action,
      action_config
    );

    logger.info({ id: rule.id }, "Rule created");
    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    logger.error(err, "Error creating rule");
    res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * GET /rules
 * List all rules
 */
router.get("/rules", (req: Request, res: Response) => {
  try {
    const rules = eventBusService.getAllRules();

    logger.info({ count: rules.length }, "Rules retrieved");
    res.json({ success: true, data: rules });
  } catch (err) {
    logger.error(err, "Error retrieving rules");
    res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * GET /rules/:id
 * Get a rule by ID
 */
router.get("/rules/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const rule = eventBusService.getRule(id);

    if (!rule) {
      return res.status(404).json({ success: false, error: "Rule not found" });
    }

    logger.info({ id }, "Rule retrieved");
    res.json({ success: true, data: rule });
  } catch (err) {
    logger.error(err, "Error retrieving rule");
    res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * PATCH /rules/:id/enable
 * Enable a rule
 */
router.patch("/rules/:id/enable", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const rule = eventBusService.getRule(id);

    if (!rule) {
      return res.status(404).json({ success: false, error: "Rule not found" });
    }

    eventBusService.enableRule(id);
    const updated = eventBusService.getRule(id);

    logger.info({ id }, "Rule enabled");
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error(err, "Error enabling rule");
    res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * PATCH /rules/:id/disable
 * Disable a rule
 */
router.patch("/rules/:id/disable", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const rule = eventBusService.getRule(id);

    if (!rule) {
      return res.status(404).json({ success: false, error: "Rule not found" });
    }

    eventBusService.disableRule(id);
    const updated = eventBusService.getRule(id);

    logger.info({ id }, "Rule disabled");
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error(err, "Error disabling rule");
    res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * DELETE /rules/:id
 * Delete a rule
 */
router.delete("/rules/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const rule = eventBusService.getRule(id);

    if (!rule) {
      return res.status(404).json({ success: false, error: "Rule not found" });
    }

    eventBusService.deleteRule(id);

    logger.info({ id }, "Rule deleted");
    res.json({ success: true, data: { id, message: "Rule deleted" } });
  } catch (err) {
    logger.error(err, "Error deleting rule");
    res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * POST /replay
 * Start an event replay
 */
router.post("/replay", (req: Request, res: Response) => {
  try {
    const { channel, from_time, to_time } = req.body;

    if (!from_time || !to_time) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: from_time, to_time",
      });
    }

    const replay = eventBusService.startReplay({
      channel: channel as EventChannel,
      from_time,
      to_time,
    });

    logger.info({ id: replay.id }, "Replay started");
    res.status(201).json({ success: true, data: replay });
  } catch (err) {
    logger.error(err, "Error starting replay");
    res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * GET /replay/:id
 * Get a replay by ID
 */
router.get("/replay/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const replay = eventBusService.getReplay(id);

    if (!replay) {
      return res.status(404).json({ success: false, error: "Replay not found" });
    }

    logger.info({ id }, "Replay retrieved");
    res.json({ success: true, data: replay });
  } catch (err) {
    logger.error(err, "Error retrieving replay");
    res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * GET /stats
 * Get event bus statistics
 */
router.get("/stats", (req: Request, res: Response) => {
  try {
    const stats = eventBusService.getStats();

    logger.info(stats, "Stats retrieved");
    res.json({ success: true, data: stats });
  } catch (err) {
    logger.error(err, "Error retrieving stats");
    res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * POST /purge
 * Purge expired events
 */
router.post("/purge", (req: Request, res: Response) => {
  try {
    const purgedCount = eventBusService.purgeExpiredEvents();

    logger.info({ purgedCount }, "Expired events purged");
    res.json({ success: true, data: { purged_count: purgedCount } });
  } catch (err) {
    logger.error(err, "Error purging expired events");
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
