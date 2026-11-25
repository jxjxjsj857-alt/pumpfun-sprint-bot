# BurstSniper — design notes

Paper-trading bot for the pump.fun replay (`agent-fun/replay/v2`). Capital 10
SOL, max 5 open positions, max 1% of a curve's real SOL reserve per buy order,
no shorts, no leverage. Every fee is paid per order (base + priority), so tiny
trades are fee-sensitive: the smallest buy is 0.01 SOL and probes are exactly
that size.

## Entries

| Mode | Age (slots) | Window | Net SOL | Buys | Buyers | Min up | First buy |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BURST | 20–600 | 20 | ≥ 0.5 | ≥ 4 | ≥ 3 | +4% | 0.04 SOL |
| TREND | ≥ 600 | 60 | ≥ 2 | ≥ 6 | ≥ 5 | +8% | 0.06 SOL |

Both modes also require the price to sit at ≥ 95% of the window high and the
largest single buyer to hold ≤ 60% of the window's buy SOL (a one-wallet pump
is not demand). At most 2 entries per curve, with a 200-slot cooldown after an
exit.

## Pyramid

One add of 0.12 SOL, only while the price is ≥ 12% above the entry decision
price and the 60-slot net flow is still ≥ 0.5 SOL. Total stake per curve is
capped at 0.2 SOL and total exposure at 8 SOL.

## Exits (first trigger sells the whole position)

- Take-profit: value ≥ cost × 1.45
- Stop-loss: value < cost × 0.80
- Trailing stop: arms at cost × 1.15, exits at 25% below the peak value
- Fade: 20-slot net flow < −0.8 SOL
- Max hold: 1800 slots, unless the position is up ≥ 10%

A completed curve is closed by the replay itself.

## Guardrail probes

The minimum bar is 20 coins with round trips of ≥ 0.01 SOL each. The bot
tracks its own fills and coins against a pace over 21,600 seconds (the 6-hour
final window); when it lags, it opens a 0.01 SOL probe on a liquid curve and
sells it as soon as the buy lands.

## Parameters

All parameters live in `DEFAULT_PARAMS` in `strategy.ts`. They were chosen
from the shape of the dev window (128k events over ~24h, slots
464338836–464741859): bursts are measured in slots because slot time is the
clock the replay gives, and the 20/60-slot windows are short enough to catch a
burst before the crowd and long enough to see more than one wallet.
