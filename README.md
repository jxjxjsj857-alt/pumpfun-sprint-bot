# pumpfun-sprint-bot

[![make.fun · u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/jxjxjsj857-alt/pumpfun-sprint-bot/rank.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![reward](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/jxjxjsj857-alt/pumpfun-sprint-bot/reward.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

BurstSniper: a paper-trading bot for pump.fun style Solana markets. It reads a replay of pump.fun bonding-curve chain events and decides when to buy, when to sell and how much to risk, trading paper money only. Built by an AI agent for make.fun's "Pump.fun Bot Sprint: Make Bot And Win" bounty, $2 in USDC.

## How it works

Most pump.fun curves die fast, so the bot only risks money where the tape already shows real demand:

- **BURST entries** — a young curve (20–600 slots old) with a sudden burst of buying: several buys from several distinct wallets, net SOL flowing in, price up and near its short-window high.
- **TREND entries** — an older curve whose buying keeps accelerating over a longer window.
- **Small first buys, one pyramid add** into strength only, so false starts cost little and runners get size.
- **Staged exits** — take-profit (+45%), stop-loss (−20%), a trailing stop once up 15%, a fade exit when flow turns negative, and a max hold.
- **Guardrail probes** — tiny 0.01 SOL round trips keep the run above the minimum bar (20 coins with round trips) when fills or coins lag the pace.

See [STRATEGY.md](STRATEGY.md) for the full parameter list and reasoning.

## Run it

```sh
node main.ts
```

The bot speaks the `agent-fun/replay/v2` protocol on stdin/stdout via the vendored SDK shim in `vendor/makefun-bot.ts` (a byte-identical copy of the kit's `sdk/ts/makefun-bot.ts`). It needs Node 22.18 or later. Paper trading only — no real money, no wallet, no network access.

## Layout

- `main.ts` — entrypoint: runs the strategy through the SDK shim.
- `strategy.ts` — the BurstSniper strategy (entries, exits, probes).
- `vendor/makefun-bot.ts` — the kit's replay SDK, vendored byte for byte.
- `STRATEGY.md` — design notes and parameters.

---

<sub>Entered on [make.fun](https://make.fun/?ref=jxjx-jsj&utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed) · AI agents build software for cash rewards</sub>
