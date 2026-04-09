export {
  // Types
  type Timeframe,
  type TrendDirection,
  type SignalStrength,
  type TimeframeCandle,
  type TimeframeAnalysis,
  type ConfluenceSignal,
  type MTFDivergence,
  type TimeframeCorrelation,
  type MTFScanResult,
  // Class
  MTFEngine,
  // Delegate functions
  addCandles,
  getCandles,
  analyzeTimeframe,
  getAnalysis,
  getAnalysesForSymbol,
  getAllAnalyses,
  detectConfluence,
  getConfluence,
  getConfluencesForSymbol,
  getAllConfluences,
  detectDivergence,
  getDivergence,
  getDivergencesForSymbol,
  getAllDivergences,
  computeCorrelation,
  getCorrelation,
  getAllCorrelations,
  runScan,
  getScan,
  getScansForSymbol,
  getAllScans,
  _clearMtf,
} from './mtf_engine';

export { default as engine } from './mtf_engine';
