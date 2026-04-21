'use client'

import { useState, useEffect } from 'react'

interface Signal {
  id: string
  symbol: string
  direction: string
  confidence: number
  timestamp: string
}

interface ScreenshotCard {
  id: string
  symbol: string
  direction: string
  confidence: number
  timestamp: string
  notes: string
}

export default function ScreenshotMemoryPage() {
  const [cards, setCards] = useState<ScreenshotCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [notes, setNotes] = useState<{ [key: string]: string }>({})

  useEffect(() => {
    const fetchSignals = async () => {
      try {
        const res = await fetch('/api/signals/history?limit=30')
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json()

        const signals = data.signals || []
        const cardData = signals.map((sig: Signal) => ({
          id: sig.id,
          symbol: sig.symbol,
          direction: sig.direction,
          confidence: sig.confidence,
          timestamp: sig.timestamp,
          notes: '',
        }))

        setCards(cardData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading')
      } finally {
        setLoading(false)
      }
    }
    fetchSignals()
  }, [])

  const handleNotesChange = (id: string, newNotes: string) => {
    setNotes((prev) => ({ ...prev, [id]: newNotes }))
  }

  if (loading) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-emerald-400 animate-pulse">Loading...</div>

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Screenshot Memory Vault</h1>
        <p className="text-gray-400 mb-6">Visual library of trading setups and patterns</p>

        {error && <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6 text-red-400">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cards.map((card) => (
            <div
              key={card.id}
              className="border border-[#1e1e2e] bg-[#12121a] rounded-lg overflow-hidden hover:border-emerald-400/30 transition"
            >
              <div className="bg-[#0a0a0f] aspect-square flex items-center justify-center border-b border-[#1e1e2e]">
                <div className="text-center">
                  <div className="text-4xl mb-2">📊</div>
                  <div className="text-gray-400 text-sm">{card.symbol}</div>
                  <div className={`text-xs mt-2 font-semibold ${card.direction === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {card.direction.toUpperCase()}
                  </div>
                </div>
              </div>

              <div className="p-4">
                <div className="flex justify-between items-center mb-3">
                  <div className="text-sm text-gray-400">
                    <div className="text-gray-500 text-xs mb-1">{new Date(card.timestamp).toLocaleString()}</div>
                    <div className="font-semibold text-white">{card.symbol}</div>
                  </div>
                  <div className={`text-sm font-bold px-2 py-1 rounded ${card.confidence > 0.7 ? 'bg-emerald-400/20 text-emerald-400' : 'bg-yellow-400/20 text-yellow-400'}`}>
                    {(card.confidence * 100).toFixed(0)}%
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-gray-400">Notes</div>
                  {editingId === card.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={notes[card.id] || ''}
                        onChange={(e) => handleNotesChange(card.id, e.target.value)}
                        className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded px-2 py-2 text-white text-xs h-20"
                        placeholder="Add notes about this setup..."
                      />
                      <button
                        onClick={() => setEditingId(null)}
                        className="w-full bg-emerald-400/20 hover:bg-emerald-400/30 border border-emerald-400/50 text-emerald-400 py-1 rounded text-xs font-semibold transition"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={() => setEditingId(card.id)}
                      className="bg-[#0a0a0f] border border-[#1e1e2e] rounded px-2 py-2 text-gray-400 text-xs min-h-20 cursor-pointer hover:border-emerald-400/30 transition"
                    >
                      {notes[card.id] || 'Click to add notes'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {cards.length === 0 && <div className="border border-[#1e1e2e] bg-[#12121a] rounded-lg p-6 text-center text-gray-400">No signals available</div>}
      </div>
    </div>
  )
}
