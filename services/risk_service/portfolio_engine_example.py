"""
Portfolio Intelligence Engine — Usage Examples

Demonstrates how to use the PortfolioEngine for analysis, backtesting, and
real-time portfolio monitoring.
"""
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from portfolio_engine import Position, PortfolioEngine


def example_basic_analysis():
    """Basic portfolio analysis with 3 positions."""
    print("\n=== Example 1: Basic Portfolio Analysis ===\n")

    # Create engine
    engine = PortfolioEngine(risk_free_rate=0.02, lookback_days=20)

    # Create positions
    positions = [
        Position(
            symbol="AAPL",
            qty=100,
            entry_price=150.0,
            current_price=152.0,
            entry_time=datetime.utcnow() - timedelta(days=5),
            strategy="momentum",
        ),
        Position(
            symbol="MSFT",
            qty=50,
            entry_price=300.0,
            current_price=305.0,
            entry_time=datetime.utcnow() - timedelta(days=3),
            strategy="momentum",
        ),
        Position(
            symbol="GOOGL",
            qty=30,
            entry_price=120.0,
            current_price=121.5,
            entry_time=datetime.utcnow() - timedelta(days=7),
            strategy="value",
        ),
    ]

    # Create synthetic price history (20 days of data)
    price_history = {}
    for pos in positions:
        dates = pd.date_range(end=datetime.utcnow(), periods=20, freq="D")
        # Simulate correlated returns
        returns = np.random.normal(0.001, 0.02, 19)
        prices = [pos.entry_price]
        for ret in returns:
            prices.append(prices[-1] * (1 + ret))
        price_history[pos.symbol] = pd.DataFrame({
            "close": prices,
        }, index=dates)

    # Strategy P&L history
    strategy_pnls = {
        "momentum": {
            "AAPL": {"win_rate": 0.58, "avg_win": 0.021, "avg_loss": 0.015},
            "MSFT": {"win_rate": 0.55, "avg_win": 0.018, "avg_loss": 0.012},
        },
        "value": {
            "GOOGL": {"win_rate": 0.62, "avg_win": 0.025, "avg_loss": 0.018},
        },
    }

    # Portfolio metrics
    account_equity = 100_000.0
    cash = 20_000.0
    peak_equity = 110_000.0

    # Run full analysis
    intel = engine.analyze_portfolio(
        positions=positions,
        price_history=price_history,
        account_equity=account_equity,
        cash=cash,
        peak_equity=peak_equity,
        strategy_pnls=strategy_pnls,
        max_position_pct=0.05,
        max_strategy_pct=0.40,
    )

    print(f"Timestamp: {intel.timestamp}")
    print(f"Total Equity: ${intel.total_equity:,.2f}")
    print(f"Cash: ${intel.cash:,.2f}")
    print(f"Positions: {intel.num_positions}")
    print(f"\n--- Correlations ---")
    print(f"Symbols: {intel.correlations.symbols}")
    print(f"Dangerous Pairs: {intel.correlations.dangerous_pairs}")

    print(f"\n--- Sector Exposure ---")
    for sector, pct in intel.sector_exposure.exposures.items():
        print(f"  {sector}: {pct:.1f}%")

    print(f"\n--- Drawdown ---")
    print(f"Drawdown: {intel.drawdown_metrics.drawdown_pct:.2f}%")
    print(f"Position Size Multiplier: {intel.drawdown_metrics.position_size_multiplier:.2f}x")

    print(f"\n--- Risk Metrics ---")
    print(f"VaR (95%): {intel.risk_metrics.var_95:.4f}")
    print(f"CVaR (95%): {intel.risk_metrics.cvar_95:.4f}")
    print(f"Sharpe Ratio: {intel.risk_metrics.sharpe_ratio:.3f}")
    print(f"Sortino Ratio: {intel.risk_metrics.sortino_ratio:.3f}")

    print(f"\n--- Position Sizing (Kelly-Inspired) ---")
    for sizing in intel.position_sizing:
        print(f"  {sizing.symbol}:")
        print(f"    Kelly: {sizing.kelly_fraction:.3f}")
        print(f"    Half-Kelly: {sizing.half_kelly_fraction:.3f}")
        print(f"    Recommended: {sizing.recommended_pct:.2f}%")
        print(f"    Final (after DD): {sizing.final_pct:.2f}%")

    print(f"\n--- Strategy Allocations ---")
    for alloc in intel.strategy_allocations:
        print(f"  {alloc.strategy}:")
        print(f"    Positions: {alloc.positions_count}")
        print(f"    Allocated: {alloc.allocated_pct:.2f}%")
        print(f"    P&L: ${alloc.total_pnl:,.2f} ({alloc.total_pnl_pct:.2f}%)")

    print(f"\n--- Health Warnings ---")
    if intel.health_warnings:
        for warning in intel.health_warnings:
            print(f"  ⚠️  {warning}")
    else:
        print("  ✓ No warnings")


def example_high_drawdown():
    """Demonstrate drawdown protection."""
    print("\n=== Example 2: Drawdown Protection ===\n")

    engine = PortfolioEngine()

    # Simulate drawdown scenario
    current_equity = 85_000.0  # Down 15% from peak
    peak_equity = 100_000.0

    drawdown = engine._compute_drawdown(current_equity, peak_equity)

    print(f"Peak Equity: ${peak_equity:,.2f}")
    print(f"Current Equity: ${current_equity:,.2f}")
    print(f"Drawdown: {drawdown.drawdown_pct:.2f}%")
    print(f"Position Size Multiplier: {drawdown.position_size_multiplier:.2f}x")
    print(f"\nExpected Behavior:")
    print(f"  - Normal position size: 100 shares")
    print(f"  - With {drawdown.drawdown_pct:.1f}% DD multiplier: {100 * drawdown.position_size_multiplier:.0f} shares")

    # Test different DD levels
    print(f"\n--- DD Protection Thresholds ---")
    test_levels = [(95_000, "5%"), (90_000, "10%"), (85_000, "15%"), (80_000, "20%+")]
    for equity, label in test_levels:
        dd = engine._compute_drawdown(equity, peak_equity)
        print(f"  {label} DD: multiplier = {dd.position_size_multiplier:.2f}x")


def example_kelly_sizing():
    """Demonstrate Kelly-based position sizing."""
    print("\n=== Example 3: Kelly-Criterion Position Sizing ===\n")

    engine = PortfolioEngine()

    # Create positions with different win rates
    positions = [
        Position(
            symbol="HIGH_WINRATE",
            qty=100,
            entry_price=100.0,
            current_price=101.0,
            entry_time=datetime.utcnow(),
            strategy="test",
        ),
        Position(
            symbol="MEDIUM_WINRATE",
            qty=50,
            entry_price=100.0,
            current_price=100.5,
            entry_time=datetime.utcnow(),
            strategy="test",
        ),
        Position(
            symbol="LOW_WINRATE",
            qty=80,
            entry_price=100.0,
            current_price=99.5,
            entry_time=datetime.utcnow(),
            strategy="test",
        ),
    ]

    # Different P&L profiles
    strategy_pnls = {
        "test": {
            "HIGH_WINRATE": {
                "win_rate": 0.70,
                "avg_win": 0.03,
                "avg_loss": 0.01,
            },
            "MEDIUM_WINRATE": {
                "win_rate": 0.55,
                "avg_win": 0.02,
                "avg_loss": 0.015,
            },
            "LOW_WINRATE": {
                "win_rate": 0.48,
                "avg_win": 0.015,
                "avg_loss": 0.02,
            },
        }
    }

    sizings = engine._compute_position_sizing(
        positions=positions,
        strategy_pnls=strategy_pnls,
        max_position_pct=0.10,
        dd_multiplier=1.0,  # no drawdown
    )

    print("Symbol              | Kelly  | Half-Kelly | Recommended | Final")
    print("-" * 65)
    for s in sizings:
        print(
            f"{s.symbol:18s} | {s.kelly_fraction:6.3f} | {s.half_kelly_fraction:10.3f} | "
            f"{s.recommended_pct:11.2f}% | {s.final_pct:6.2f}%"
        )

    print("\nInterpretation:")
    print("  - HIGH_WINRATE: Kelly suggests 20.9% allocation, capped to 10%, half-Kelly = 5%")
    print("  - MEDIUM_WINRATE: Kelly suggests 8.3%, half-Kelly = 4.2%")
    print("  - LOW_WINRATE: Kelly suggests 2%, half-Kelly = 1% (losing strategy)")


def example_sector_concentration():
    """Demonstrate sector exposure tracking."""
    print("\n=== Example 4: Sector Concentration Check ===\n")

    engine = PortfolioEngine()

    # Create positions in same sector
    positions = [
        Position("AAPL", 100, 150.0, 152.0, datetime.utcnow(), strategy="tech"),
        Position("MSFT", 100, 300.0, 305.0, datetime.utcnow(), strategy="tech"),
        Position("GOOGL", 100, 120.0, 121.0, datetime.utcnow(), strategy="tech"),
        Position("JPM", 100, 150.0, 151.0, datetime.utcnow(), strategy="finance"),
    ]

    total_value = sum(p.value for p in positions)
    sector_exp = engine._compute_sector_exposure(positions, total_value)

    print("Sector Exposures:")
    for sector, pct in sector_exp.exposures.items():
        status = "⚠️  OVER" if pct > 40 else "✓"
        print(f"  {sector:20s}: {pct:6.1f}% {status}")

    if sector_exp.over_concentrated:
        print("\nWarnings:")
        for sector, pct in sector_exp.over_concentrated:
            print(f"  ⚠️  {sector} at {pct:.1f}% exceeds 40% limit")


def example_correlation_warning():
    """Demonstrate correlation risk warning."""
    print("\n=== Example 5: Correlation Risk Detection ===\n")

    engine = PortfolioEngine()

    positions = [
        Position("AAPL", 100, 150.0, 152.0, datetime.utcnow()),
        Position("MSFT", 100, 300.0, 305.0, datetime.utcnow()),
        Position("GOOGL", 100, 120.0, 121.0, datetime.utcnow()),
    ]

    # Create highly correlated price history
    dates = pd.date_range(end=datetime.utcnow(), periods=20, freq="D")
    base_returns = np.random.normal(0.001, 0.015, 20)

    price_history = {}
    for i, pos in enumerate(positions):
        # Add small noise to base returns to simulate correlation
        noise = np.random.normal(0, 0.005, 20)
        returns = base_returns + noise
        prices = [pos.entry_price]
        for ret in returns[1:]:
            prices.append(prices[-1] * (1 + ret))
        price_history[pos.symbol] = pd.DataFrame({"close": prices}, index=dates)

    corr = engine._compute_correlations(positions, price_history)

    print(f"Correlation Matrix:")
    print(f"  Symbols: {corr.symbols}")
    print(f"  Matrix shape: {corr.matrix.shape}")
    print(f"\nDangerous Pairs (> 0.85 correlation):")
    if corr.dangerous_pairs:
        for sym1, sym2, corr_val in corr.dangerous_pairs:
            print(f"  {sym1} <-> {sym2}: {corr_val:.3f}")
    else:
        print("  None detected")


if __name__ == "__main__":
    example_basic_analysis()
    example_high_drawdown()
    example_kelly_sizing()
    example_sector_concentration()
    example_correlation_warning()
    print("\n" + "=" * 70)
    print("✓ All examples completed")
