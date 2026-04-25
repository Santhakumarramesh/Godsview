# Order Flow Analysis — Learning Notes for GodsView

## Source
Order Flow Analysis Course (MEGA folder — 188 files, 42 subfolders, 45.69 GB)
Applied by: GodsView Senior Order Flow Trading Systems Engineer

---

## 1. Order Flow Fundamentals

### What is Order Flow?
Order flow is the study of actual buy and sell orders hitting the market. Unlike traditional technical analysis which looks at price patterns after the fact, order flow reveals WHO is trading, HOW MUCH, and WHETHER they are aggressive (market orders) or passive (limit orders).

Price moves because of an imbalance between aggressive buyers and aggressive sellers. When more market buy orders hit the ask than market sell orders hit the bid, price rises. Order flow analysis quantifies this imbalance in real-time.

### Market Microstructure
- **Bid**: highest price buyers are willing to pay (limit buy orders)
- **Ask/Offer**: lowest price sellers are willing to accept (limit sell orders)
- **Spread**: difference between best bid and best ask
- **Market order**: aggressive order that crosses the spread to get filled immediately
- **Limit order**: passive order that sits in the book waiting to be filled
- **Fill**: when an order is executed (matched with a counterparty)

### The Order Book (DOM — Depth of Market)
The order book shows all resting limit orders at each price level. It reveals:
- Where large participants have placed limit orders
- Potential support/resistance from order clusters
- How "thick" or "thin" the market is (liquidity)
- Whether one side is stacking more orders than the other

**GodsView implementation**: Real DOM requires Level 2 data feed. For crypto via ccxt, we use OHLCV proxy methods clearly labeled as such.

---

## 2. Delta Analysis

### What is Delta?
Delta = (volume traded at the ask) - (volume traded at the bid)

- **Positive delta**: more aggressive buying (market buys hitting the ask)
- **Negative delta**: more aggressive selling (market sells hitting the bid)
- **Near-zero delta**: balanced market, no dominant aggressor

### Delta Types
1. **Candle delta**: delta for a single candle period
2. **Cumulative delta (CVD)**: running sum of delta over time
3. **Delta divergence**: price makes new high but delta doesn't (or vice versa) — signals exhaustion

### Delta Trading Rules
- Rising price + rising delta = healthy trend (go with it)
- Rising price + falling delta = divergence (trend weakening, prepare for reversal)
- Falling price + falling delta = healthy downtrend
- Falling price + rising delta = divergence (sellers exhausting)
- Large delta spike on a single candle = institutional participation

### OHLCV Proxy for Delta
When tick-level data is unavailable:
```
CLV = ((Close - Low) - (High - Close)) / (High - Low)
Delta_proxy = Volume * CLV
```
- Close near high → positive delta (buying pressure)
- Close near low → negative delta (selling pressure)
- Close at midpoint → neutral delta

**Accuracy**: ~60-70% correlation with real delta. Good enough for directional bias, not precise enough for scalping.

---

## 3. Cumulative Volume Delta (CVD)

### What is CVD?
CVD is the running cumulative sum of delta. It shows the NET aggressive buying vs selling over time.

### CVD Trading Signals
1. **CVD confirms trend**: price rising + CVD rising = strong bullish
2. **CVD divergence (bearish)**: price makes higher high, CVD makes lower high → distribution happening, smart money selling into retail buying
3. **CVD divergence (bullish)**: price makes lower low, CVD makes higher low → accumulation happening, smart money buying into retail panic
4. **CVD breakout**: CVD breaks to new high/low before price does → leading indicator

### CVD and Structure
- At BOS level: if CVD confirms the break, it's a real breakout
- At BOS level: if CVD diverges from the break, it may be a false breakout / stop run
- At order block retest: CVD rising into bullish OB = buyers defending the zone

---

## 4. Absorption

### What is Absorption?
Absorption occurs when large limit orders (passive) absorb aggressive orders without letting price move. It's the footprint of institutional players defending a level.

### How to Detect Absorption
1. High volume at a specific price level
2. Price fails to move despite aggressive orders
3. Delta shows aggressive selling but price holds (bullish absorption)
4. Delta shows aggressive buying but price holds (bearish absorption)
5. Multiple touches of the same level with increasing volume

### Absorption Types
- **Bullish absorption**: sellers aggressively push price down, but large buy limit orders absorb all selling. Price eventually reverses up.
- **Bearish absorption**: buyers aggressively push price up, but large sell limit orders absorb all buying. Price eventually reverses down.

### OHLCV Proxy for Absorption
```
High volume + small candle body + long wicks = absorption candle
Volume > 1.5x average + range < 0.5x average range = absorption
If delta positive but price didn't rise = bearish absorption (buyers absorbed)
If delta negative but price didn't fall = bullish absorption (sellers absorbed)
```

### Absorption + Order Blocks
When absorption occurs at an order block level, it dramatically increases the probability of the OB holding. This is the highest-conviction trade setup.

---

## 5. Volume Imbalance

### What is Imbalance?
Imbalance is when one side of the market overwhelms the other. In footprint charts, this appears as diagonal imbalance — when bid volume at one price is dramatically different from ask volume at the adjacent price.

### Imbalance Detection Rules
- **Buying imbalance**: ask volume > 3x bid volume at adjacent price
- **Selling imbalance**: bid volume > 3x ask volume at adjacent price
- **Stacked imbalance**: 3+ consecutive price levels all showing imbalance in the same direction = very strong signal

### OHLCV Proxy for Imbalance
```
Look at consecutive candles:
- 3+ candles all closing in same direction with increasing volume = directional imbalance
- Volume ratio: sum(up-candle volume) / sum(down-candle volume) over N periods
- Ratio > 2.0 = bullish imbalance
- Ratio < 0.5 = bearish imbalance
```

### Imbalance Trading
- Enter in the direction of the imbalance
- Stacked imbalance at an OB retest = very high confidence
- Imbalance against your position = warning sign

---

## 6. Liquidity Concepts

### Liquidity Walls
Large clusters of limit orders at specific prices visible in the order book:
- **Buy walls**: large bid orders → potential support
- **Sell walls**: large ask orders → potential resistance
- Walls can be real (institutional defense) or fake (spoofing)

### Liquidity Pools
Areas where stop losses cluster:
- Above swing highs (short stops)
- Below swing lows (long stops)
- At round numbers
- At obvious S/R levels

### Liquidity Sweeps / Stop Runs
Smart money deliberately pushes price into liquidity pools to fill their orders:
1. Price breaks above swing high (triggers short stops + breakout buys)
2. Smart money uses this liquidity to sell into
3. Price reverses sharply back below the swing high
4. The "false breakout" was actually a liquidity grab

### Detection in OHLCV
```
Sweep detection:
- Price exceeds prior swing high/low by small amount
- Then reverses back within 1-3 candles
- Wick extends beyond the swing level but close is back inside
- Volume spikes during the sweep candle
```

### Sweep + OB = Highest Confluence
When a liquidity sweep happens right at an order block:
- Smart money grabbed liquidity
- Used it to fill orders at the OB
- Price should now move in the OB direction
- This is the highest-probability setup in order flow trading

---

## 7. Trapped Traders

### What are Trapped Traders?
Traders who entered a position at a bad level and are now holding a losing trade. Their eventual forced exit (stop loss hit or panic exit) creates additional momentum.

### Types of Traps
1. **Bull trap**: price breaks above resistance, longs enter, price reverses → longs trapped → their stops fuel the downside move
2. **Bear trap**: price breaks below support, shorts enter, price reverses → shorts trapped → their stops fuel the upside move
3. **False breakout trap**: price appears to break structure → traders enter → reversal traps them

### Detection in OHLCV
```
Bull trap:
- Candle breaks above prior high with large body
- Next 1-2 candles: reversal candles with high volume
- Price closes back below the prior high
- Volume on reversal > volume on breakout

Bear trap:
- Candle breaks below prior low with large body
- Next 1-2 candles: reversal candles with high volume
- Price closes back above the prior low
- Volume on reversal > volume on breakout
```

### Trapped Traders + BOS
When BOS occurs and then reverses → trapped traders. This is actually a CHOCH (Change of Character) and signals trend reversal. The trapped traders' stops become fuel for the new direction.

---

## 8. Volume Profile

### What is Volume Profile?
Volume profile shows how much volume was traded at each price level over a given period. Unlike regular volume (per time), this is volume per price.

### Key Levels
- **POC (Point of Control)**: price with highest traded volume — fair value
- **VAH (Value Area High)**: upper boundary of 70% volume area — resistance
- **VAL (Value Area Low)**: lower boundary of 70% volume area — support
- **HVN (High Volume Node)**: price levels with heavy trading — "accepted" prices, act as magnets
- **LVN (Low Volume Node)**: price levels with little trading — "rejected" prices, price moves quickly through them

### Volume Profile Trading Rules
1. Price tends to return to POC (mean reversion)
2. Price moves quickly through LVNs (low liquidity = fast movement)
3. Price stalls at HVNs (high liquidity = slow movement)
4. Breakout from value area → trending move
5. Return to value area → mean reversion

### OHLCV Proxy for Volume Profile
```
Build price histogram:
- Divide price range into N bins
- Assign each candle's volume to the bins it touches
- Weighted by how much of the candle body falls in each bin
- POC = bin with highest volume
- VA = bins containing 70% of total volume
```

---

## 9. Market Auction Theory

### Core Principle
Markets move between two states:
1. **Balance (range)**: buyers and sellers agree on fair value → price rotates around POC
2. **Imbalance (trend)**: one side overwhelms → price searches for new fair value

### Auction Mechanics
- When price is "too cheap" (below value), buyers step in
- When price is "too expensive" (above value), sellers step in
- Trend occurs when perception of value changes → one side withdraws
- The market is always "auctioning" — searching for the price where supply = demand

### Applying to BOS
- BOS up = market found the prior range "too cheap" → searching for new higher value
- BOS down = market found the prior range "too expensive" → searching for new lower value
- OB retest = market returning to test if the old value area still holds

---

## 10. Aggressive vs Passive Participants

### Aggressive Participants (Market Orders)
- Take liquidity — they cross the spread
- Show urgency — willing to pay more for immediate execution
- Create price movement
- Measured by: delta, market order flow

### Passive Participants (Limit Orders)
- Provide liquidity — they sit in the book
- Show patience — willing to wait for their price
- Create support/resistance levels
- Measured by: order book depth, absorption patterns

### The Interaction
- Aggressive buyers vs passive sellers: if aggressive wins → price rises
- Aggressive sellers vs passive buyers: if aggressive wins → price falls
- When passive absorbs aggressive → reversal signal
- When aggressive overwhelms passive → breakout/continuation

### Key Insight for GodsView
The best trades occur when:
1. Aggressive participants confirm your direction (delta/imbalance aligns)
2. Passive participants defend your level (absorption at OB)
3. Trapped traders' stops will fuel your move (liquidity sweep just happened)

---

## 11. Iceberg Orders

### What are Iceberg Orders?
Large orders that are split into smaller visible pieces. Only a small portion shows in the order book, but the full size keeps refilling as pieces get filled.

### Detection
- Consistent volume appearing at the same price level
- Order book shows small size but volume keeps trading there
- Price keeps touching the level and bouncing
- Volume at that price is disproportionately large vs visible book size

### OHLCV Proxy
Cannot directly detect icebergs from OHLCV. However:
- Multiple touches of the same price with volume → possible iceberg defense
- Absorption pattern is the closest OHLCV proxy

---

## 12. Footprint Chart Concepts

### What is a Footprint Chart?
A footprint chart shows bid and ask volume at every price level within a candle. It's the most granular order flow visualization.

### Reading a Footprint
- Each price level shows: [bid volume x ask volume]
- Diagonal imbalance: compare ask volume at one price vs bid volume at the price below
- Clusters of high ask volume = buying aggression
- Clusters of high bid volume = selling aggression

### OHLCV Proxy
Cannot build true footprint from OHLCV. We approximate:
- Candle body direction = dominant aggressor
- Volume * CLV = approximate delta distribution
- Cannot see individual price levels within the candle

---

## 13. Order Flow Confirmation for GodsView Strategy

### Long Entry Confirmation
1. Bullish BOS (strength > 60)
2. Price retests bullish OB
3. Positive delta at OB level (buying pressure)
4. Absorption at OB low (sellers absorbed by passive buyers)
5. CVD rising or making higher low
6. Recent liquidity sweep below OB (stops grabbed)
7. Volume expanding on the retest candle
8. No bearish imbalance stacking

### Short Entry Confirmation
1. Bearish BOS (strength > 60)
2. Price retests bearish OB
3. Negative delta at OB level (selling pressure)
4. Absorption at OB high (buyers absorbed by passive sellers)
5. CVD falling or making lower high
6. Recent liquidity sweep above OB (stops grabbed)
7. Volume expanding on the retest candle
8. No bullish imbalance stacking

### Order Flow Score Formula
```
orderFlowScore = (
    delta_score * 0.25 +        # Delta direction alignment
    volume_spike_score * 0.20 + # Volume expansion confirmation
    absorption_score * 0.20 +   # Absorption at key level
    imbalance_score * 0.20 +    # Directional imbalance
    sweep_trapped_score * 0.15  # Liquidity sweep + trapped traders
)
```

### Score Classification
- 0-40: Weak — skip trade or reduce size significantly
- 41-60: Neutral — proceed with caution, tighter stops
- 61-75: Strong — standard entry, normal sizing
- 76-100: High conviction — full size, wider stops allowed

---

## 14. Key Takeaways for Implementation

1. **Delta proxy is our primary tool** — CLV-based delta from OHLCV gives directional bias
2. **CVD divergence is the highest-value signal** — catches trend exhaustion before price shows it
3. **Absorption at OB levels is the highest-confidence confirmation** — institutional defense visible even in OHLCV
4. **Liquidity sweeps before OB retests are the ideal setup** — stops grabbed, fuel loaded
5. **Trapped traders create momentum** — false breakouts followed by reversal = trapped traders fueling the move
6. **Volume profile gives context** — know if price is at HVN (will stall) or LVN (will accelerate)
7. **All OHLCV-based analysis must be clearly labeled as proxy** — never claim to have real order book data when using OHLCV approximations
8. **Combine multiple order flow signals** — no single signal is enough; the score aggregates all confluences
