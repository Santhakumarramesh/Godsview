'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Activity, AlertCircle, Clock, MessageSquare, TrendingUp } from 'lucide-react';

interface Agent {
  id: string;
  name: string;
  status: 'active' | 'idle' | 'error';
  lastAction: string;
  messagesProcessed: number;
  uptime: number;
}

const mockAgents: Agent[] = [
  {
    id: 'agent-market-scanner',
    name: 'Market Scanner',
    status: 'active',
    lastAction: '2 minutes ago',
    messagesProcessed: 1247,
    uptime: 99.8,
  },
  {
    id: 'agent-structure',
    name: 'Structure',
    status: 'active',
    lastAction: '1 minute ago',
    messagesProcessed: 892,
    uptime: 99.9,
  },
  {
    id: 'agent-flow',
    name: 'Order Flow',
    status: 'active',
    lastAction: '30 seconds ago',
    messagesProcessed: 2156,
    uptime: 99.7,
  },
  {
    id: 'agent-execution',
    name: 'Execution',
    status: 'idle',
    lastAction: '5 minutes ago',
    messagesProcessed: 456,
    uptime: 99.5,
  },
  {
    id: 'agent-risk',
    name: 'Risk',
    status: 'active',
    lastAction: '1 minute ago',
    messagesProcessed: 1834,
    uptime: 99.9,
  },
  {
    id: 'agent-learning',
    name: 'Learning',
    status: 'active',
    lastAction: '3 minutes ago',
    messagesProcessed: 678,
    uptime: 99.6,
  },
  {
    id: 'agent-brain',
    name: 'God Brain',
    status: 'active',
    lastAction: 'Now',
    messagesProcessed: 4521,
    uptime: 99.95,
  },
];

export default function IntelAgentsPage() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.brain.getAgents();
        setAgents(res);
      } catch {
        setAgents(mockAgents);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="animate-pulse h-48 bg-white/5 rounded" />
          ))}
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/20 text-green-300 border border-green-500/30';
      case 'idle':
        return 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30';
      case 'error':
        return 'bg-red-500/20 text-red-300 border border-red-500/30';
      default:
        return 'bg-gray-500/20 text-gray-300 border border-gray-500/30';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <Activity className="w-4 h-4" />;
      case 'idle':
        return <Clock className="w-4 h-4" />;
      case 'error':
        return <AlertCircle className="w-4 h-4" />;
      default:
        return null;
    }
  };

  if (!agents || agents.length === 0) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <AlertCircle className="w-12 h-12 mx-auto text-gray-500 mb-4" />
          <p className="text-gray-400">No agents available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Agent Status Dashboard</h1>
        <p className="text-gray-400">Multi-agent brain status and metrics</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors"
          >
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">{agent.name}</h3>
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${getStatusColor(agent.status)}`}>
                {getStatusIcon(agent.status)}
                <span className="capitalize">{agent.status}</span>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                  <Clock className="w-4 h-4" />
                  <span>Last Action</span>
                </div>
                <p className="text-white font-medium">{agent.lastAction}</p>
              </div>

              <div>
                <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                  <MessageSquare className="w-4 h-4" />
                  <span>Messages Processed</span>
                </div>
                <p className="text-white font-medium">{agent.messagesProcessed.toLocaleString()}</p>
              </div>

              <div>
                <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                  <TrendingUp className="w-4 h-4" />
                  <span>Uptime</span>
                </div>
                <p className="text-white font-medium">{agent.uptime.toFixed(2)}%</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
