import { db, signalsTable, tradesTable } from "@workspace/db";

const instruments = ["MES", "MNQ", "BTCUSDT", "ETHUSDT"];
const setupTypes = ["absorption_reversal", "sweep_reclaim", "continuation_pullback"];
const sessions = ["NY", "London", "Asian", "Overnight"];
const regimes = ["trending_bull", "trending_bear", "ranging", "volatile"];
const statuses = ["executed", "rejected", "expired"] as const;
const outcomes = ["win", "loss", "win", "win", "loss"] as const;

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function seed() {
  console.log("Seeding demo data...");

  const signalRows = [];
  const tradeRows = [];
  const now = Date.now();

  for (let i = 0; i < 60; i++) {
    const structure = rand(0.45, 0.95);
    const orderFlow = rand(0.40, 0.92);
    const recall = rand(0.42, 0.88);
    const ml = rand(0.48, 0.90);
    const claude = rand(0.50, 0.93);
    const finalQuality = 0.30 * structure + 0.25 * orderFlow + 0.20 * recall + 0.15 * ml + 0.10 * claude;

    const status = pick(statuses);
    const instrument = pick(instruments);
    const setupType = pick(setupTypes);
    const session = pick(sessions);
    const regime = pick(regimes);
    const entryPrice = instrument.includes("BTC") ? rand(58000, 70000) : instrument.includes("ETH") ? rand(3200, 4000) : rand(5200, 5400);
    const tickSize = instrument.includes("BTC") || instrument.includes("ETH") ? 5 : 0.25;
    const stopTicks = Math.round(rand(8, 20));
    const tpTicks = Math.round(rand(12, 35));

    const createdAt = new Date(now - i * rand(3600000, 18000000));

    const reasonings = [
      "Strong absorption at key support. CVD holding positive. ML confidence above threshold. Recommend TRADE.",
      "Sweep of liquidity confirmed. Reclaim candle forming. Structure aligned. High quality setup.",
      "Delta divergence detected at resistance. Recall engine shows bearish context on 15m. Caution — near news.",
      "Setup quality acceptable but regime is ranging. Reduced edge. Proceed with caution.",
      "Clear continuation signal. Trend intact across all timeframes. Order flow aligned. TRADE.",
    ];

    signalRows.push({
      instrument,
      setup_type: setupType,
      status,
      structure_score: String(structure.toFixed(4)),
      order_flow_score: String(orderFlow.toFixed(4)),
      recall_score: String(recall.toFixed(4)),
      ml_probability: String(ml.toFixed(4)),
      claude_score: String(claude.toFixed(4)),
      final_quality: String(finalQuality.toFixed(4)),
      claude_reasoning: pick(reasonings),
      entry_price: String(entryPrice.toFixed(2)),
      stop_loss: String((entryPrice - stopTicks * tickSize).toFixed(2)),
      take_profit: String((entryPrice + tpTicks * tickSize).toFixed(2)),
      session,
      regime,
      news_lockout: Math.random() < 0.08,
      created_at: createdAt,
    });

    if (status === "executed") {
      const outcome = pick(outcomes);
      const direction = Math.random() > 0.5 ? "long" : "short";
      const pnl = outcome === "win" ? rand(80, 350) : rand(-80, -40);
      const exitPrice = direction === "long"
        ? (outcome === "win" ? entryPrice + tpTicks * tickSize : entryPrice - stopTicks * tickSize)
        : (outcome === "win" ? entryPrice - tpTicks * tickSize : entryPrice + stopTicks * tickSize);

      tradeRows.push({
        instrument,
        setup_type: setupType,
        direction,
        entry_price: String(entryPrice.toFixed(2)),
        exit_price: String(exitPrice.toFixed(2)),
        stop_loss: String((entryPrice - stopTicks * tickSize).toFixed(2)),
        take_profit: String((entryPrice + tpTicks * tickSize).toFixed(2)),
        quantity: String("1"),
        pnl: String(pnl.toFixed(2)),
        pnl_pct: String((pnl / entryPrice * 100).toFixed(4)),
        outcome,
        mfe: String(rand(10, outcome === "win" ? 280 : 60).toFixed(2)),
        mae: String(rand(5, outcome === "win" ? 40 : 120).toFixed(2)),
        slippage: String(rand(0, 2).toFixed(2)),
        session,
        regime,
        notes: null,
        entry_time: createdAt,
        exit_time: new Date(createdAt.getTime() + rand(60000, 2700000)),
        created_at: createdAt,
      });
    }
  }

  await db.insert(signalsTable).values(signalRows);
  console.log(`Inserted ${signalRows.length} signals`);

  await db.insert(tradesTable).values(tradeRows);
  console.log(`Inserted ${tradeRows.length} trades`);

  console.log("Seeding complete.");
}

seed().catch(console.error);
