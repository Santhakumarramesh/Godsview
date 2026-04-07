/**
 * Phase 106 — Alert Engine & Anomaly Detection
 *
 * Three subsystems for proactive monitoring:
 * 1. AlertEngine — configurable rules with condition evaluation
 * 2. NotificationDispatcher — multi-channel notification delivery
 * 3. AnomalyDetector — statistical anomaly detection (z-score, EWMA, IQR)
 */

export { AlertEngine } from "./alert_engine.js";
export type { AlertEngineConfig, AlertRule, AlertCondition, AlertAction, Alert, AlertSummary } from "./alert_engine.js";

export { NotificationDispatcher } from "./notification_dispatcher.js";
export type { DispatcherConfig, ChannelConfig, Notification, NotificationStats, EscalationChain } from "./notification_dispatcher.js";

export { AnomalyDetector } from "./anomaly_detector.js";
export type { AnomalyConfig, MetricStream, Anomaly, AnomalyReport, DetectionResult } from "./anomaly_detector.js";
