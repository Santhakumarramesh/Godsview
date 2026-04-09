/**
 * certification_gate/index.ts — Barrel exports for certification gate module
 */

export {
  type CertificationStatus,
  type CertificationCategory,
  type ReportStatus,
  type CertificationCheck,
  type CertificationReport,
  runFullCertification,
  runCategoryCheck,
  getReport,
  getLatestReport,
  getAllReports,
  _clearReports,
  getReportCount,
} from "./certification_engine";
