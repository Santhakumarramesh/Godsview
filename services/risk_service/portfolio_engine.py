"""
GodsView v2 — Portfolio Intelligence Engine

Core portfolio analytics: correlation matrix, sector exposure, dynamic capital allocation,
drawdown protection, risk metrics (VaR/CVaR/Sharpe/Sortino), and strategy-level allocation.

Requires: numpy, pandas, scipy
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Optional

import numpy as np
import pandas as pd
from scipy import stats

from services.shared.logging import get_logger

log = get_logger(__name__)


# ── Sector Mapping ─────────────────────────────────────────────────────────────
# Map symbols to sectors for exposure tracking
SECTOR_MAP = {
    # Technology
    "AAPL": "Technology",
    "MSFT": "Technology",
    "GOOGL": "Technology",
    "NVDA": "Technology",
    "TSLA": "Technology",
    "META": "Technology",
    "NFLX": "Technology",
    "AMZN": "Technology",
    "AMD": "Technology",
    "ADBE": "Technology",
    # Financials
    "JPM": "Financials",
    "BAC": "Financials",
    "GS": "Financials",
    "MS": "Financials",
    "BLK": "Financials",
    "V": "Financials",
    "MA": "Financials",
    # Healthcare
    "JNJ": "Healthcare",
    "PFE": "Healthcare",
    "MRK": "Healthcare",
    "ABBV": "Healthcare",
    "PEP": "Healthcare",
    "COST": "Healthcare",
    # Energy
    "XOM": "Energy",
    "CVX": "Energy",
    "COP": "Energy",
    # Industrials
    "BA": "Industrials",
    "CAT": "Industrials",
    "GE": "Industrials",
    "MMM": "Industrials",
    # Consumer
    "WMT": "Consumer Discretionary",
    "HD": "Consumer Discretionary",
    "NKE": "Consumer Discretionary",
    "MCD": "Consumer Discretionary",
    # Utilities
    "D": "Utilities",
    "DUK": "Utilities",
    # Real Estate
    "SPG": "Real Estate",
    "PLD": "Real Estate",
    # Materials
    "NEM": "Materials",
    "FCX": "Materials",
    # Crypto (custom sector)
    "BTC": "Cryptocurrency",
    "ETH": "Cryptocurrency",
    "GBTC": "Cryptocurrency",
    "IBIT": "Cryptocurrency",
}


# ── Data Models ────────────────────────────────────────────────────────────────

@dataclass
class Position:
    """An open position in the portfolio."""
    symbol: str
    qty: float
    entry_price: float
    current_price: float
    entry_time: datetime
    strategy: str = "default"
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def value(self) -> float:
        return self.qty * self.current_price

    @property
    def cost(self) -> float:
        return self.qty * self.entry_price

    @property
    def pnl(self) -> float:
        return self.value - self.cost

    @property
    def pnl_pct(self) -> float:
        return (self.pnl / self.cost * 100.0) if self.cost else 0.0


@dataclass
class CorrelationMatrix:
    """Correlation analysis across positions."""
    timestamp: datetime
    symbols: list[str]
    matrix: np.ndarray  # Pearson correlation
    dangerous_pairs: list[tuple[str, str, float]] = field(default_factory=list)
    rolling_window_days: int = 20

    def flag_dangerous(self, threshold: float = 0.85) -> list[tuple[str, str, float]]:
        """Find pairs with correlation > threshold."""
        pairs = []
        n = len(self.symbols)
        for i in range(n):
            for j in range(i + 1, n):
                corr = self.matrix[i, j]
                if abs(corr) > threshold:
                    pairs.append((self.symbols[i], self.symbols[j], corr))
        self.dangerous_pairs = pairs
        return pairs


@dataclass
class SectorExposure:
    """Sector allocation breakdown."""
    timestamp: datetime
    exposures: dict[str, float]  # sector -> % of portfolio
    over_concentrated: list[tuple[str, float]] = field(default_factory=list)

    def check_concentration(self, threshold: float = 0.40) -> list[tuple[str, float]]:
        """Flag sectors with exposure > threshold."""
        over = [(s, pct) for s, pct in self.exposures.items() if pct > threshold]
        self.over_concentrated = over
        return over


@dataclass
class PositionSizing:
    """Kelly-criterion inspired position sizing."""
    symbol: str
    kelly_fraction: float  # [0, 1]
    half_kelly_fraction: float  # half_kelly_fraction = kelly_fraction / 2
    recommended_pct: float  # of portfolio
    max_pct: float  # config limit
    final_pct: float  # actual allocation
    reason: str = ""


@dataclass
class DrawdownMetrics:
    """Drawdown analysis and protection."""
    current_equity: float
    peak_equity: float
    drawdown_pct: float
    exceeds_5pct: bool = False
    exceeds_10pct: bool = False
    exceeds_15pct: bool = False
    exceeds_20pct: bool = False
    position_size_multiplier: float = 1.0  # reduce positions by this factor
    trading_halted: bool = False

    def compute_multiplier(self) -> float:
        """Determine position size reduction based on DD level."""
        if self.drawdown_pct >= 20.0:
            self.trading_halted = True
            return 0.0
        elif self.drawdown_pct >= 15.0:
            return 0.25
        elif self.drawdown_pct >= 10.0:
            return 0.50
        elif self.drawdown_pct >= 5.0:
            return 0.75
        return 1.0


@dataclass
class PortfolioRiskMetrics:
    """Comprehensive risk metrics."""
    timestamp: datetime
    var_95: float  # Value at Risk, 95% confidence
    var_99: float  # Value at Risk, 99% confidence
    cvar_95: float  # Conditional VaR (Expected Shortfall)
    cvar_99: float  # Conditional VaR, 99% confidence
    sharpe_ratio: float  # rolling sharpe
    sortino_ratio: float  # rolling sortino (downside focus)
    beta_to_spy: Optional[float] = None
    max_drawdown_pct: float = 0.0
    win_rate: float = 0.0
    profit_factor: float = 0.0


@dataclass
class StrategyAllocation:
    """Per-strategy capital allocation."""
    strategy: str
    positions_count: int
    total_pnl: float
    total_pnl_pct: float
    allocated_pct: float  # % of portfolio
    max_pct: float  # cap per strategy
    recommended_increase: bool = False


@dataclass
class PortfolioIntelligence:
    """Full portfolio snapshot."""
    timestamp: datetime
    total_equity: float
    cash: float
    num_positions: int
    correlations: CorrelationMatrix
    sector_exposure: SectorExposure
    drawdown_metrics: DrawdownMetrics
    risk_metrics: PortfolioRiskMetrics
    position_sizing: list[PositionSizing]
    strategy_allocations: list[StrategyAllocation]
    health_warnings: list[str] = field(default_factory=list)


# ── Portfolio Engine ───────────────────────────────────────────────────────────

class PortfolioEngine:
    """
    Core portfolio intelligence and optimization engine.

    Manages:
    - Correlation matrix across all positions
    - Sector exposure tracking
    - Dynamic position sizing (Kelly-inspired)
    - Drawdown protection
    - Risk metrics (VaR, Sharpe, Sortino, etc.)
    - Strategy-level allocation
    """

    def __init__(
        self,
        risk_free_rate: float = 0.02,
        lookback_days: int = 20,
        var_confidence: float = 0.95,
    ):
        self.risk_free_rate = risk_free_rate
        self.lookback_days = lookback_days
        self.var_confidence = var_confidence
        self.equity_curve: list[tuple[datetime, float]] = []
        self.daily_returns: list[float] = []

    def analyze_portfolio(
        self,
        positions: list[Position],
        price_history: dict[str, pd.DataFrame],
        account_equity: float,
        cash: float,
        peak_equity: float,
        strategy_pnls: dict[str, dict[str, float]],
        max_position_pct: float = 0.05,
        max_strategy_pct: float = 0.40,
    ) -> PortfolioIntelligence:
        """
        Run full portfolio analysis.

        Args:
            positions: List of open Position objects
            price_history: {symbol: DataFrame with 'close' column}
            account_equity: Current account equity
            cash: Available cash
            peak_equity: All-time peak equity for DD calc
            strategy_pnls: {strategy: {symbol: pnl_pct}}
            max_position_pct: Max per-position size
            max_strategy_pct: Max per-strategy size

        Returns:
            PortfolioIntelligence snapshot
        """
        timestamp = datetime.utcnow()

        # 1. Correlation analysis
        correlations = self._compute_correlations(positions, price_history)
        log.info(
            "correlations_computed",
            symbols=len(positions),
            dangerous_pairs=len(correlations.dangerous_pairs),
        )

        # 2. Sector exposure
        sector_exp = self._compute_sector_exposure(positions, account_equity)
        log.info(
            "sector_exposure_computed",
            sectors=len(sector_exp.exposures),
            over_concentrated=len(sector_exp.over_concentrated),
        )

        # 3. Drawdown metrics
        drawdown = self._compute_drawdown(account_equity, peak_equity)
        log.info(
            "drawdown_computed",
            dd_pct=f"{drawdown.drawdown_pct:.2f}%",
            multiplier=f"{drawdown.position_size_multiplier:.2f}",
        )

        # 4. Risk metrics (VaR, Sharpe, Sortino)
        risk_metrics = self._compute_risk_metrics(positions, price_history)

        # 5. Position sizing (Kelly-inspired)
        position_sizing = self._compute_position_sizing(
            positions,
            strategy_pnls,
            max_position_pct,
            drawdown.position_size_multiplier,
        )

        # 6. Strategy allocation
        strategy_allocs = self._compute_strategy_allocations(
            positions, strategy_pnls, account_equity, max_strategy_pct
        )

        # 7. Generate warnings
        warnings = self._generate_warnings(
            correlations,
            sector_exp,
            drawdown,
            risk_metrics,
            strategy_allocs,
        )

        intelligence = PortfolioIntelligence(
            timestamp=timestamp,
            total_equity=account_equity,
            cash=cash,
            num_positions=len(positions),
            correlations=correlations,
            sector_exposure=sector_exp,
            drawdown_metrics=drawdown,
            risk_metrics=risk_metrics,
            position_sizing=position_sizing,
            strategy_allocations=strategy_allocs,
            health_warnings=warnings,
        )

        return intelligence

    def _compute_correlations(
        self,
        positions: list[Position],
        price_history: dict[str, pd.DataFrame],
    ) -> CorrelationMatrix:
        """Compute Pearson correlation matrix across positions."""
        symbols = [p.symbol for p in positions]
        if len(symbols) < 2:
            # Not enough for correlation
            return CorrelationMatrix(
                timestamp=datetime.utcnow(),
                symbols=symbols,
                matrix=np.eye(len(symbols)) if symbols else np.array([]),
            )

        # Gather price data
        data = {}
        for symbol in symbols:
            if symbol in price_history:
                df = price_history[symbol].tail(self.lookback_days)
                if len(df) > 0:
                    data[symbol] = df["close"].values
                else:
                    log.warning(f"no_price_data {symbol}")

        if len(data) < 2:
            return CorrelationMatrix(
                timestamp=datetime.utcnow(),
                symbols=symbols,
                matrix=np.eye(len(symbols)),
            )

        # Align lengths and compute returns
        min_len = min(len(v) for v in data.values())
        returns_data = {}
        for symbol, prices in data.items():
            prices = prices[-min_len:]
            returns = np.diff(prices) / prices[:-1]
            returns_data[symbol] = returns

        # Build correlation matrix
        df_returns = pd.DataFrame(returns_data)
        corr_matrix = df_returns.corr().values

        corr = CorrelationMatrix(
            timestamp=datetime.utcnow(),
            symbols=list(returns_data.keys()),
            matrix=corr_matrix,
        )
        corr.flag_dangerous(threshold=0.85)
        return corr

    def _compute_sector_exposure(
        self,
        positions: list[Position],
        total_value: float,
    ) -> SectorExposure:
        """Compute sector allocation."""
        sector_values = {}
        for pos in positions:
            sector = SECTOR_MAP.get(pos.symbol, "Other")
            sector_values[sector] = sector_values.get(sector, 0.0) + pos.value

        exposures = {}
        if total_value > 0:
            for sector, value in sector_values.items():
                exposures[sector] = (value / total_value) * 100.0

        exp = SectorExposure(timestamp=datetime.utcnow(), exposures=exposures)
        exp.check_concentration(threshold=40.0)
        return exp

    def _compute_drawdown(
        self,
        current_equity: float,
        peak_equity: float,
    ) -> DrawdownMetrics:
        """Compute drawdown and protection multiplier."""
        dd_pct = 0.0
        if peak_equity > 0:
            dd_pct = ((peak_equity - current_equity) / peak_equity) * 100.0

        dd = DrawdownMetrics(
            current_equity=current_equity,
            peak_equity=peak_equity,
            drawdown_pct=max(0.0, dd_pct),
        )
        dd.exceeds_5pct = dd.drawdown_pct >= 5.0
        dd.exceeds_10pct = dd.drawdown_pct >= 10.0
        dd.exceeds_15pct = dd.drawdown_pct >= 15.0
        dd.exceeds_20pct = dd.drawdown_pct >= 20.0
        dd.position_size_multiplier = dd.compute_multiplier()
        return dd

    def _compute_risk_metrics(
        self,
        positions: list[Position],
        price_history: dict[str, pd.DataFrame],
    ) -> PortfolioRiskMetrics:
        """Compute VaR, CVaR, Sharpe, Sortino, etc."""
        timestamp = datetime.utcnow()

        # If no positions, return zeros
        if not positions:
            return PortfolioRiskMetrics(
                timestamp=timestamp,
                var_95=0.0,
                var_99=0.0,
                cvar_95=0.0,
                cvar_99=0.0,
                sharpe_ratio=0.0,
                sortino_ratio=0.0,
            )

        # Compute portfolio returns
        portfolio_returns = self._compute_portfolio_returns(
            positions, price_history
        )

        if len(portfolio_returns) < 2:
            return PortfolioRiskMetrics(
                timestamp=timestamp,
                var_95=0.0,
                var_99=0.0,
                cvar_95=0.0,
                cvar_99=0.0,
                sharpe_ratio=0.0,
                sortino_ratio=0.0,
            )

        returns = np.array(portfolio_returns)

        # VaR and CVaR
        var_95 = np.percentile(returns, (1 - self.var_confidence) * 100)
        var_99 = np.percentile(returns, 1.0)
        cvar_95 = returns[returns <= var_95].mean() if len(returns[returns <= var_95]) > 0 else var_95
        cvar_99 = returns[returns <= var_99].mean() if len(returns[returns <= var_99]) > 0 else var_99

        # Sharpe ratio
        mean_ret = np.mean(returns)
        std_ret = np.std(returns)
        sharpe = (mean_ret - self.risk_free_rate / 252) / (std_ret + 1e-6)

        # Sortino ratio (downside only)
        downside_returns = returns[returns < 0]
        downside_std = np.std(downside_returns) if len(downside_returns) > 0 else std_ret
        sortino = (mean_ret - self.risk_free_rate / 252) / (downside_std + 1e-6)

        return PortfolioRiskMetrics(
            timestamp=timestamp,
            var_95=var_95,
            var_99=var_99,
            cvar_95=cvar_95,
            cvar_99=cvar_99,
            sharpe_ratio=sharpe,
            sortino_ratio=sortino,
        )

    def _compute_portfolio_returns(
        self,
        positions: list[Position],
        price_history: dict[str, pd.DataFrame],
    ) -> list[float]:
        """Compute weighted portfolio returns."""
        total_cost = sum(p.cost for p in positions)
        if total_cost == 0:
            return [0.0]

        returns = []
        for pos in positions:
            if pos.symbol in price_history:
                df = price_history[pos.symbol].tail(self.lookback_days)
                if len(df) > 1:
                    prices = df["close"].values
                    pos_returns = np.diff(prices) / prices[:-1]
                    weight = pos.cost / total_cost
                    weighted_returns = pos_returns * weight
                    returns.extend(weighted_returns)

        return returns if returns else [0.0]

    def _compute_position_sizing(
        self,
        positions: list[Position],
        strategy_pnls: dict[str, dict[str, float]],
        max_position_pct: float,
        dd_multiplier: float,
    ) -> list[PositionSizing]:
        """Compute Kelly-inspired position sizes."""
        sizings = []
        for pos in positions:
            strategy = pos.strategy
            pnl_data = strategy_pnls.get(strategy, {}).get(pos.symbol, {})

            # Extract win rate and avg win/loss from pnl_data
            # Simplified: assume pnl_data has keys like 'win_rate', 'avg_win', 'avg_loss'
            win_rate = pnl_data.get("win_rate", 0.5) if isinstance(pnl_data, dict) else 0.5
            avg_win = pnl_data.get("avg_win", 0.01) if isinstance(pnl_data, dict) else 0.01
            avg_loss = pnl_data.get("avg_loss", 0.01) if isinstance(pnl_data, dict) else 0.01

            # Kelly formula: f = (p * b - q) / b
            # where p = win_rate, q = 1-p, b = win/loss ratio
            if avg_win > 0 and avg_loss > 0:
                b = avg_win / avg_loss
                kelly = (win_rate * b - (1 - win_rate)) / (b + 1e-6)
            else:
                kelly = 0.0

            kelly = max(0.0, min(kelly, 1.0))  # clamp [0, 1]
            half_kelly = kelly / 2.0
            recommended_pct = min(half_kelly * 100.0, max_position_pct * 100.0)
            final_pct = recommended_pct * dd_multiplier

            sizing = PositionSizing(
                symbol=pos.symbol,
                kelly_fraction=kelly,
                half_kelly_fraction=half_kelly,
                recommended_pct=recommended_pct,
                max_pct=max_position_pct * 100.0,
                final_pct=final_pct,
                reason=f"kelly={kelly:.3f}, dd_mult={dd_multiplier:.2f}",
            )
            sizings.append(sizing)

        return sizings

    def _compute_strategy_allocations(
        self,
        positions: list[Position],
        strategy_pnls: dict[str, dict[str, float]],
        total_equity: float,
        max_strategy_pct: float,
    ) -> list[StrategyAllocation]:
        """Compute per-strategy allocation."""
        strategy_stats: dict[str, dict[str, Any]] = {}

        for pos in positions:
            strategy = pos.strategy
            if strategy not in strategy_stats:
                strategy_stats[strategy] = {
                    "positions": [],
                    "total_pnl": 0.0,
                    "total_cost": 0.0,
                }
            strategy_stats[strategy]["positions"].append(pos)
            strategy_stats[strategy]["total_pnl"] += pos.pnl
            strategy_stats[strategy]["total_cost"] += pos.cost

        allocations = []
        for strategy, stats in strategy_stats.items():
            pos_count = len(stats["positions"])
            total_pnl = stats["total_pnl"]
            total_cost = stats["total_cost"]
            total_pnl_pct = (total_pnl / total_cost * 100.0) if total_cost > 0 else 0.0
            allocated_pct = (total_cost / total_equity * 100.0) if total_equity > 0 else 0.0
            recommended_increase = total_pnl_pct > 0  # increase if winning

            alloc = StrategyAllocation(
                strategy=strategy,
                positions_count=pos_count,
                total_pnl=total_pnl,
                total_pnl_pct=total_pnl_pct,
                allocated_pct=allocated_pct,
                max_pct=max_strategy_pct * 100.0,
                recommended_increase=recommended_increase,
            )
            allocations.append(alloc)

        return allocations

    def _generate_warnings(
        self,
        correlations: CorrelationMatrix,
        sector_exp: SectorExposure,
        drawdown: DrawdownMetrics,
        risk_metrics: PortfolioRiskMetrics,
        strategy_allocs: list[StrategyAllocation],
    ) -> list[str]:
        """Generate portfolio health warnings."""
        warnings = []

        # Correlation warnings
        if correlations.dangerous_pairs:
            warnings.append(
                f"HIGH_CORRELATION: {len(correlations.dangerous_pairs)} pairs > 0.85"
            )

        # Sector concentration
        if sector_exp.over_concentrated:
            sectors_str = ", ".join(f"{s}={p:.1f}%" for s, p in sector_exp.over_concentrated)
            warnings.append(f"SECTOR_CONCENTRATION: {sectors_str}")

        # Drawdown
        if drawdown.trading_halted:
            warnings.append("TRADING_HALTED: Drawdown > 20%")
        elif drawdown.exceeds_15pct:
            warnings.append(f"HIGH_DRAWDOWN: {drawdown.drawdown_pct:.2f}%")

        # Risk metrics
        if risk_metrics.sharpe_ratio < 0.5:
            warnings.append(f"LOW_SHARPE: {risk_metrics.sharpe_ratio:.2f}")

        # Strategy concentration
        for alloc in strategy_allocs:
            if alloc.allocated_pct > alloc.max_pct:
                warnings.append(
                    f"STRATEGY_OVER_ALLOCATED: {alloc.strategy} "
                    f"{alloc.allocated_pct:.1f}% > {alloc.max_pct:.1f}%"
                )

        return warnings
