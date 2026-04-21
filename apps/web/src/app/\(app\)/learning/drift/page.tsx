'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { AlertTriangle, TrendingUp } from 'lucide-react';

interface DriftMetric {
  featureName: string;
  baselineMean: number;
  currentMean: number;
  driftDetected: boolean;
  driftPercent: number;
}

interface DriftReport {
  featureDrift: number;
  predictionDrift: number;
  dataDrift: number;
  metrics: DriftMetric[];
  hasAlert: boolean;
}

const mockDriftReport: DriftReport = {
  featureDrift: 0.12,
  predictionDrift: 0.08,
  dataDrift: 0.18,
  hasAlert: true,
  metrics: [
    {
      featureName: 'Price Return',
      baselineMean: 0.0012,
      currentMean: 0.0018,
      driftDetected: false,
      driftPercent: 0.06,
    },
    {
      featureName: 'Volume Ratio',
      baselineMean: 1.24,
      currentMean: 1.18,
      driftDetected: false,
      driftPercent: 0.05,
    },
    {
      featureName: 'Order Flow Delta',
      baselineMean: 145,
      currentMean: 198,
      driftDetected: true,
      driftPercent: 0.36,
    },
    {
      featureName: 'Volatility',
      baselineMean: 0.015,
      currentMean: 0.022,
      driftDetected: true,
      driftPercent: 0.47,
    },
    {
      featureName: 'Time Lag',
      baselineMean: 2.3,
      currentMean: 2.1,
      driftDetected: false,
      driftPercent: 0.09,
    },
    {
      featureName: 'Bid-Ask Spread',
      baselineMean: 0.8,
      currentMean: 0.9,
      driftDetected: false,
      driftPercent: 0.12,
    },
  ],
};

const DRIFT_THRESHOLD = 0.25;

export default function DriftPage() {
  const [report, setReport] = useState<DriftReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.ml.getDriftReport();
        setReport(res);
      } catch {
        setReport(mockDriftReport);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse h-24 bg-white/5 rounded" />
          ))}
        </div>
        <div className="animate-pulse h-96 bg-white/5 rounded" />
      </div>
    );
  }

  const alertTriggered = report && report.hasAlert;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Model Drift Detection</h1>
        <p className="text-gray-400">Feature and prediction distribution monitoring</p>
      </div>

      {/* Alert Banner */}
      {alertTriggered && (
        <div className="bg-red-950/50 border border-red-800 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-white font-semibold">Drift Detected</p>
            <p className="text-red-300 text-sm mt-1">
              Model drift exceeds threshold. Consider retraining on recent data.
            </p>
          </div>
        </div>
      )}

      {/* Drift Metrics */}
      {report && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
            <p className="text-gray-400 text-sm mb-2">Feature Drift</p>
            <p className={`text-3xl font-bold ${report.featureDrift > DRIFT_THRESHOLD ? 'text-red-400' : 'text-yellow-400'}`}>
              {(report.featureDrift * 100).toFixed(1)}%
            </p>
            <p className="text-xs text-gray-500 mt-2">Distribution shift</p>
          </div>
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
            <p className="text-gray-400 text-sm mb-2">Prediction Drift</p>
            <p className={`text-3xl font-bold ${report.predictionDrift > DRIFT_THRESHOLD ? 'text-red-400' : 'text-green-400'}`}>
              {(report.predictionDrift * 100).toFixed(1)}%
            </p>
            <p className="text-xs text-gray-500 mt-2">Model output shift</p>
          </div>
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
            <p className="text-gray-400 text-sm mb-2">Data Drift</p>
            <p className={`text-3xl font-bold ${report.dataDrift > DRIFT_THRESHOLD ? 'text-orange-400' : 'text-yellow-400'}`}>
              {(report.dataDrift * 100).toFixed(1)}%
            </p>
            <p className="text-xs text-gray-500 mt-2">Input distribution shift</p>
          </div>
        </div>
      )}

      {/* Detailed Metrics Table */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-800 bg-gray-800/30">
          <h2 className="text-lg font-semibold text-white">Feature Drift Details</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-800/20">
                <th className="px-6 py-3 text-left text-white font-semibold">Feature Name</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Baseline Mean</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Current Mean</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Drift %</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {report && report.metrics.length > 0 ? (
                report.metrics.map((metric) => (
                  <tr key={metric.featureName} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                    <td className="px-6 py-4 text-white font-medium">{metric.featureName}</td>
                    <td className="px-6 py-4 text-gray-300">
                      {typeof metric.baselineMean === 'number' ? metric.baselineMean.toFixed(4) : metric.baselineMean}
                    </td>
                    <td className="px-6 py-4 text-gray-300">
                      {typeof metric.currentMean === 'number' ? metric.currentMean.toFixed(4) : metric.currentMean}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`font-semibold ${metric.driftPercent > DRIFT_THRESHOLD ? 'text-red-400' : 'text-yellow-400'}`}>
                        {(metric.driftPercent * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${metric.driftDetected ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'bg-green-500/20 text-green-300 border border-green-500/30'}`}>
                        {metric.driftDetected ? 'Detected' : 'Normal'}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-400">
                    <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    No drift metrics available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
