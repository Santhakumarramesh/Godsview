import { EventEmitter } from 'events';

// Types
export interface PositionEntry {
  symbol: string;
  sector: string;
  direction: 'long' | 'short';
  size: number;
  pnl: number;
  entryTime: string;
  currentPrice: number;
  entryPrice: number;
}

export interface HeatmapCell {
  sector: string;
  timeframe: string;
  exposure: number;
  pnl: number;
  positionCount: number;
  riskScore: number;
  color: string;
}

export interface HeatmapData {
  cells: HeatmapCell[][];
  sectors: string[];
  timeframes: string[];
  maxExposure: number;
  totalExposure: number;
  generated_at: string;
}

export interface ExposureBreakdown {
  bySector: Record<string, number>;
  byDirection: {
    long: number;
    short: number;
  };
  netExposure: number;
  grossExposure: number;
}

export interface RiskHotspot {
  sector: string;
  timeframe: string;
  riskScore: number;
  reason: string;
  positions: string[];
}

// Configuration interface
interface PortfolioHeatmapConfig {
  sectors: string[];
  timeframes?: string[];
}

/**
 * PortfolioHeatmap class generates a heat map for portfolio visualization
 * Tracks positions and computes exposure metrics across sectors and timeframes
 */
export class PortfolioHeatmap extends EventEmitter {
  private config: PortfolioHeatmapConfig & { timeframes: string[] };
  private positions: Map<string, PositionEntry>;
  private heatmapCache: HeatmapData | null = null;
  private lastUpdated: number = 0;

  constructor(config: PortfolioHeatmapConfig) {
    super();
    this.config = {
      ...config,
      timeframes: config.timeframes || ['1d', '1w', '1m', '3m'],
    };
    this.positions = new Map();
  }

  /**
   * Update or add a position in the portfolio
   */
  public updatePosition(position: PositionEntry): void {
    this.positions.set(position.symbol, position);
    this.heatmapCache = null;
    this.lastUpdated = Date.now();
  }

  /**
   * Generate the heat map data for visualization
   */
  public generateHeatmap(): HeatmapData {
    if (this.heatmapCache && Date.now() - this.lastUpdated < 5000) {
      return this.heatmapCache;
    }

    const cells: HeatmapCell[][] = [];
    let maxExposure = 0;
    let totalExposure = 0;

    // Initialize cells for each sector x timeframe combination
    for (const sector of this.config.sectors) {
      const sectorCells: HeatmapCell[] = [];

      for (const timeframe of this.config.timeframes) {
        const cellData = this.computeHeatmapCell(sector, timeframe);
        sectorCells.push(cellData);

        maxExposure = Math.max(maxExposure, Math.abs(cellData.exposure));
        totalExposure += Math.abs(cellData.exposure);
      }

      cells.push(sectorCells);
    }

    // Normalize exposure values for consistent coloring
    if (maxExposure > 0) {
      for (const sectorCells of cells) {
        for (const cell of sectorCells) {
          cell.riskScore = this.computeRiskScore(cell, maxExposure);
          cell.color = this.generateColor(cell.riskScore);
        }
      }
    }

    const heatmapData: HeatmapData = {
      cells,
      sectors: this.config.sectors,
      timeframes: this.config.timeframes,
      maxExposure,
      totalExposure,
      generated_at: new Date().toISOString(),
    };

    this.heatmapCache = heatmapData;
    this.emit('heatmap:updated', heatmapData);

    return heatmapData;
  }

  /**
   * Compute a single heat map cell for a sector and timeframe
   */
  private computeHeatmapCell(sector: string, timeframe: string): HeatmapCell {
    const sectorPositions = Array.from(this.positions.values()).filter(
      (p) => p.sector === sector
    );

    let totalExposure = 0;
    let totalPnL = 0;
    let positionCount = 0;

    for (const position of sectorPositions) {
      // Weight exposure by timeframe decay
      const timeframeWeight = this.getTimeframeWeight(
        position.entryTime,
        timeframe
      );

      const positionExposure = position.size * timeframeWeight;
      const directionMultiplier = position.direction === 'long' ? 1 : -1;

      totalExposure += positionExposure * directionMultiplier;
      totalPnL += position.pnl;
      positionCount++;
    }

    return {
      sector,
      timeframe,
      exposure: totalExposure,
      pnl: totalPnL,
      positionCount,
      riskScore: 0,
      color: '#FFFFFF',
    };
  }

  /**
   * Calculate time-based weight factor for a position relative to timeframe
   */
  private getTimeframeWeight(entryTime: string, timeframe: string): number {
    const entryDate = new Date(entryTime).getTime();
    const now = Date.now();
    const ageMs = now - entryDate;

    const frameMs: Record<string, number> = {
      '1d': 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000,
      '1m': 30 * 24 * 60 * 60 * 1000,
      '3m': 90 * 24 * 60 * 60 * 1000,
    };

    const frameDuration = frameMs[timeframe] || 0;
    if (frameDuration === 0) return 0;

    if (ageMs > frameDuration) return 0;

    // Linear decay from 1.0 at entry to 0.0 at frame boundary
    return Math.max(0, 1 - ageMs / frameDuration);
  }

  /**
   * Compute risk score for a heat map cell (0-1 range)
   */
  private computeRiskScore(cell: HeatmapCell, maxExposure: number): number {
    if (maxExposure === 0) return 0;

    const exposureRisk = Math.abs(cell.exposure) / maxExposure;
    const concentrationRisk = Math.min(cell.positionCount / 10, 1);
    const pnlRisk = cell.pnl < 0 ? Math.abs(cell.pnl) / (maxExposure * 0.1) : 0;

    const normalizedPnLRisk = Math.min(pnlRisk, 1);
    const riskScore =
      exposureRisk * 0.5 + concentrationRisk * 0.3 + normalizedPnLRisk * 0.2;

    return Math.min(riskScore, 1);
  }

  /**
   * Generate hex color based on risk score (green -> yellow -> red)
   */
  private generateColor(riskScore: number): string {
    // Green: #00AA00 (0)
    // Yellow: #FFAA00 (0.5)
    // Red: #FF0000 (1)

    if (riskScore < 0.5) {
      // Green to Yellow
      const t = riskScore * 2; // 0 to 1
      const r = Math.round(255 * t);
      const g = 170;
      const b = Math.round(0 * (1 - t));
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    } else {
      // Yellow to Red
      const t = (riskScore - 0.5) * 2; // 0 to 1
      const r = 255;
      const g = Math.round(170 * (1 - t));
      const b = 0;
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }
  }

  /**
   * Get exposure breakdown by sector, direction, and net exposure
   */
  public getExposure(): ExposureBreakdown {
    const bySector: Record<string, number> = {};
    let longExposure = 0;
    let shortExposure = 0;

    for (const position of this.positions.values()) {
      const sectorExposure = position.size;

      if (!bySector[position.sector]) {
        bySector[position.sector] = 0;
      }

      if (position.direction === 'long') {
        bySector[position.sector] += sectorExposure;
        longExposure += sectorExposure;
      } else {
        bySector[position.sector] -= sectorExposure;
        shortExposure += sectorExposure;
      }
    }

    const netExposure = longExposure - shortExposure;
    const grossExposure = longExposure + shortExposure;

    return {
      bySector,
      byDirection: {
        long: longExposure,
        short: shortExposure,
      },
      netExposure,
      grossExposure,
    };
  }

  /**
   * Identify areas of concentrated risk in the portfolio
   */
  public getRiskHotspots(): RiskHotspot[] {
    const heatmap = this.generateHeatmap();
    const hotspots: RiskHotspot[] = [];

    for (const sectorCells of heatmap.cells) {
      for (const cell of sectorCells) {
        if (cell.riskScore >= 0.6) {
          const positions = Array.from(this.positions.values())
            .filter((p) => p.sector === cell.sector)
            .map((p) => p.symbol);

          let reason = '';

          if (cell.exposure > heatmap.maxExposure * 0.7) {
            reason = 'High exposure concentration';
          } else if (cell.positionCount > 8) {
            reason = 'Multiple positions creating concentration risk';
          } else if (cell.pnl < 0 && Math.abs(cell.pnl) > heatmap.totalExposure * 0.1) {
            reason = 'Significant unrealized losses';
          } else {
            reason = 'Combined risk factors detected';
          }

          hotspots.push({
            sector: cell.sector,
            timeframe: cell.timeframe,
            riskScore: cell.riskScore,
            reason,
            positions,
          });

          this.emit('hotspot:detected', {
            sector: cell.sector,
            timeframe: cell.timeframe,
            riskScore: cell.riskScore,
            reason,
          });
        }
      }
    }

    return hotspots.sort((a, b) => b.riskScore - a.riskScore);
  }

  /**
   * Remove a position from tracking
   */
  public removePosition(symbol: string): void {
    this.positions.delete(symbol);
    this.heatmapCache = null;
    this.lastUpdated = Date.now();
  }

  /**
   * Get all tracked positions
   */
  public getPositions(): PositionEntry[] {
    return Array.from(this.positions.values());
  }

  /**
   * Clear all positions
   */
  public clearPositions(): void {
    this.positions.clear();
    this.heatmapCache = null;
    this.lastUpdated = Date.now();
  }

  /**
   * Get statistics about the portfolio
   */
  public getStats() {
    const exposure = this.getExposure();
    const heatmap = this.generateHeatmap();
    const hotspots = this.getRiskHotspots();

    return {
      positionCount: this.positions.size,
      sectorCount: new Set(
        Array.from(this.positions.values()).map((p) => p.sector)
      ).size,
      exposure,
      heatmapMetrics: {
        maxExposure: heatmap.maxExposure,
        totalExposure: heatmap.totalExposure,
        averageExposure:
          heatmap.totalExposure / (this.config.sectors.length * this.config.timeframes.length) || 0,
      },
      hotspotCount: hotspots.length,
      totalPnL: Array.from(this.positions.values()).reduce(
        (sum, p) => sum + p.pnl,
        0
      ),
    };
  }
}

export default PortfolioHeatmap;
