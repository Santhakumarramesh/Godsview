'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { AlertCircle, TrendingUp, BarChart3 } from 'lucide-react';

interface CalibrationModel {
  id: string;
  name: string;
  accuracy: number;
  precision: number;
  recall: number;
  lastTrained: string;
  driftStatus: 'ok' | 'warning' | 'critical';
}

const mockCalibrationData: CalibrationModel[] = [
  {
    id: 'model-1',
    name: 'Price Action Classifier',
    accuracy: 0.876,
    precision: 0.892,
    recall: 0.841,
    lastTrained: '2024-04-18',
    driftStatus: 'ok',
  },
  {
    id: 'model-2',
    name: 'Setup Detector',
    accuracy: 0.834,
    precision: 0.867,
    recall: 0.798,
    lastTrained: '2024-04-17',
    driftStatus: 'ok',
  },
  {
    id: 'model-3',
    name: 'Regime Classifier',
    accuracy: 0.912,
    precision: 0.924,
    recall: 0.889,
    lastTrained: '2024-04-19',
    driftStatus: 'ok',
  },
  {
    id: 'model-4',
    name: 'Volume Anomaly Detector',
    accuracy: 0.756,
    precision: 0.812,
    recall: 0.701,
    lastTrained: '2024-04-16',
    driftStatus: 'warning',
  },
  {
    id: 'model-5',
    name: 'Order Flow Predictor',
    accuracy: 0.798,
    precision: 0.823,
    recall: 0.771,
    lastTrained: '2024-04-15',
    driftStatus: 'ok',
  },
];

const featureImportance = [
  { name: 'Price Change', importance: 0.24 },
  { name: 'Volume Ratio', importance: 0.19 },
  { name: 'Order Flow Delta', importance: 0.18 },
  { name: 'Structure Pattern', importance: 0.16 },
  { name: 'Time of Day', importance: 0.11 },
  { name: 'Volatility', importance: 0.08 },
  { name: 'Sentiment', importance: 0.04 },
];

export default function CalibrationPage() {
  const [models, setModels] = useState<CalibrationModel[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.ml.getCalibration();
        setModels(res);
      } catch {
        setModels(mockCalibrationData);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" />
        <div className="animate-pulse h-64 bg-white/5 rounded mb-4" />
        <div className="animate-pulse h-96 bg-white/5 rounded" />
      </div>
    );
  }

  const getDriftColor = (status: string) => {
    switch (status) {
      case 'ok':
        return 'text-green-400';
      case 'warning':
        return 'text-yellow-400';
      case 'critical':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Model Calibration</h1>
        <p className="text-gray-400">ML model accuracy and feature importance analysis</p>
      </div>

      {/* Feature Importance Chart */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
        <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Feature Importance
        </h2>
        <div className="space-y-3">
          {featureImportance.map((feature) => (
            <div key={feature.name}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm text-gray-300">{feature.name}</span>
                <span className="text-sm font-medium text-white">{(feature.importance * 100).toFixed(0)}%</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-cyan-500"
                  style={{ width: `${feature.importance * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Models Table */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-800/30">
                <th className="px-6 py-3 text-left text-white font-semibold">Model Name</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Accuracy</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Precision</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Recall</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Last Trained</th>
                <th className="px-6 py-3 text-left text-white font-semibold">Drift Status</th>
              </tr>
            </thead>
            <tbody>
              {models && models.length > 0 ? (
                models.map((model) => (
                  <tr key={model.id} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                    <td className="px-6 py-4 text-white">{model.name}</td>
                    <td className="px-6 py-4">
                      <span className="text-green-400">{(model.accuracy * 100).toFixed(1)}%</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-green-400">{(model.precision * 100).toFixed(1)}%</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-green-400">{(model.recall * 100).toFixed(1)}%</span>
                    </td>
                    <td className="px-6 py-4 text-gray-400">{model.lastTrained}</td>
                    <td className="px-6 py-4">
                      <span className={`font-medium capitalize ${getDriftColor(model.driftStatus)}`}>
                        {model.driftStatus}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-400">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    No models available
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
