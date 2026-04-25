"""
Walk-Forward Validation Engine for GodsView
Splits existing backtest trades into train/validation/test periods
Checks for overfitting by comparing performance across periods
"""
import json, os, sys
from pathlib import Path
from datetime import datetime, timezone

BASE = Path("/home/ubuntu/Godsview/docs/backtests")
OUT = Path("/home/ubuntu/Godsview/docs/backtests/validation")
OUT.mkdir(exist_ok=True)

STRATEGIES = [
    {"symbol": "SOLUSD", "timeframe": "4h"},
    {"symbol": "ETHUSD", "timeframe": "1h"},
    {"symbol": "BTCUSD", "timeframe": "4h"},
]

def compute_metrics(trades):
    if not trades:
        return {"trades": 0, "pf": 0, "wr": 0, "ret": 0, "dd": 0, "avg_r": 0, "wins": 0, "losses": 0}
    wins = [t for t in trades if t["result"] == "win"]
    losses = [t for t in trades if t["result"] != "win"]
    total_win = sum(t["pnl_pct"] for t in wins) if wins else 0
    total_loss = abs(sum(t["pnl_pct"] for t in losses)) if losses else 0.001
    pf = total_win / total_loss if total_loss > 0 else 99.0
    wr = len(wins) / len(trades) * 100 if trades else 0
    ret = sum(t["pnl_pct"] for t in trades)
    equity = [0]
    for t in trades:
        equity.append(equity[-1] + t["pnl_pct"])
    peak = 0
    dd = 0
    for e in equity:
        peak = max(peak, e)
        dd = max(dd, peak - e)
    avg_r = sum(t["r_multiple"] for t in trades) / len(trades) if trades else 0
    return {
        "trades": len(trades), "wins": len(wins), "losses": len(losses),
        "pf": round(pf, 2), "wr": round(wr, 1), "ret": round(ret, 2),
        "dd": round(dd, 2), "avg_r": round(avg_r, 2)
    }

print("=" * 70)
print("WALK-FORWARD VALIDATION RESULTS")
print("=" * 70)

all_results = []

for strat in STRATEGIES:
    sym, tf = strat["symbol"], strat["timeframe"]
    trades_path = BASE / sym / tf / "trades.json"
    trades = json.loads(trades_path.read_text())
    trades.sort(key=lambda t: t["entry_time"])
    n = len(trades)

    train_end = n // 2
    val_end = train_end + n // 4

    train = trades[:train_end]
    val = trades[train_end:val_end]
    test = trades[val_end:]

    half1 = trades[:n // 2]
    half2 = trades[n // 2:]

    train_m = compute_metrics(train)
    val_m = compute_metrics(val)
    test_m = compute_metrics(test)
    full_m = compute_metrics(trades)
    h1_m = compute_metrics(half1)
    h2_m = compute_metrics(half2)

    checks = {
        "pf_stable": val_m["pf"] > 1.0 and test_m["pf"] > 1.0,
        "wr_stable": abs(train_m["wr"] - test_m["wr"]) < 30,
        "no_crash": test_m["ret"] > -5,
        "half_consistent": h1_m["pf"] > 0.8 and h2_m["pf"] > 0.8,
        "test_profitable": test_m["ret"] > 0,
    }
    passed = sum(checks.values())
    total_checks = len(checks)
    verdict = "PASS" if passed >= 4 else "MARGINAL" if passed >= 3 else "FAIL"

    print(f"\n{'─' * 60}")
    print(f"{sym} {tf} — Walk-Forward Validation")
    print(f"{'─' * 60}")
    print(f"  Total trades: {n}")
    print(f"  Train period: trades #1-{train_end} ({train[0]['entry_time'][:10]} to {train[-1]['entry_time'][:10]})")
    print(f"  Validation:   trades #{train_end+1}-{val_end} ({val[0]['entry_time'][:10]} to {val[-1]['entry_time'][:10]})")
    print(f"  Test (OOS):   trades #{val_end+1}-{n} ({test[0]['entry_time'][:10]} to {test[-1]['entry_time'][:10]})")

    print(f"\n  {'Period':<12} {'Trades':>6} {'PF':>6} {'WR':>6} {'Return':>8} {'DD':>6} {'AvgR':>6}")
    print(f"  {'-'*52}")
    for label, m in [("Train", train_m), ("Validation", val_m), ("Test (OOS)", test_m), ("Full", full_m)]:
        print(f"  {label:<12} {m['trades']:>6} {m['pf']:>6.2f} {m['wr']:>5.1f}% {m['ret']:>+7.2f}% {m['dd']:>5.2f}% {m['avg_r']:>+5.2f}")

    print(f"\n  Half-split consistency:")
    print(f"    1st half: PF={h1_m['pf']:.2f} WR={h1_m['wr']:.1f}% Ret={h1_m['ret']:+.2f}%")
    print(f"    2nd half: PF={h2_m['pf']:.2f} WR={h2_m['wr']:.1f}% Ret={h2_m['ret']:+.2f}%")

    print(f"\n  Consistency Checks ({passed}/{total_checks}):")
    for check, result in checks.items():
        icon = "✓" if result else "✗"
        print(f"    {icon} {check}")

    print(f"\n  >>> VERDICT: {verdict}")

    result = {
        "symbol": sym, "timeframe": tf, "verdict": verdict,
        "passed_checks": passed, "total_checks": total_checks,
        "train": train_m, "validation": val_m, "test": test_m,
        "full": full_m, "half1": h1_m, "half2": h2_m,
        "checks": {k: v for k, v in checks.items()}
    }
    all_results.append(result)

(OUT / "walk_forward_results.json").write_text(json.dumps(all_results, indent=2))

print(f"\n{'=' * 70}")
print("FINAL VALIDATION SUMMARY")
print(f"{'=' * 70}")
for r in all_results:
    icon = "+" if r["verdict"] == "PASS" else "~" if r["verdict"] == "MARGINAL" else "-"
    sym_tf = f"{r['symbol']} {r['timeframe']}"
    checks_str = f"{r['passed_checks']}/{r['total_checks']}"
    print(f"  [{icon}] {sym_tf}: {r['verdict']} ({checks_str} checks)")
    print(f"      Train PF={r['train']['pf']:.2f} -> Test PF={r['test']['pf']:.2f}  |  Train WR={r['train']['wr']:.1f}% -> Test WR={r['test']['wr']:.1f}%")
    pf_decay = ((r['test']['pf'] - r['train']['pf']) / r['train']['pf'] * 100) if r['train']['pf'] > 0 else 0
    label = "(acceptable)" if abs(pf_decay) < 60 else "(concerning)"
    print(f"      PF decay: {pf_decay:+.0f}% {label}")
    print()

print("Saved to docs/backtests/validation/walk_forward_results.json")
