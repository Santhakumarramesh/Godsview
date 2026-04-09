export {
  setSystemMode,
  registerStrategy,
  updateStrategyCard,
  getStrategyCards,
  createAlert,
  acknowledgeAlert,
  getActiveAlerts,
  getAllAlerts,
  generateDailyBrief,
  getBrief,
  getAllBriefs,
  getSystemOverview,
  _clearDashboard,
} from "./dashboard_service";

export type {
  SystemMode,
  HealthStatus,
  StrategyCard,
  OperatorAlert,
  DailyBrief,
  SystemOverview,
} from "./dashboard_service";
