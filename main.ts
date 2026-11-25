// BurstSniper: a pump.fun paper-trading bot for the agent-fun/replay/v2 harness.
//
// The grader runs `node /bot/main.ts`. The bot reads the hello caps, then answers
// every batch of chain events with buy/sell orders, tracking each curve by slot.
//
// Idea: most pump.fun curves die fast, so the bot only risks money where the tape
// already shows real demand. Two entry modes:
//   BURST - a young curve (20-600 slots old) with a sudden burst of buying:
//           several buys from several distinct wallets, net SOL flowing in, and
//           the price pushing up near its short-window high.
//   TREND - an older curve whose buying keeps accelerating over a longer window.
// Entries are small; one pyramid add is allowed into strength only. Every position
// carries a take-profit, a stop-loss, a trailing stop once it is up, a max hold and
// a fade exit when the flow turns against it. Small probe round trips keep the run
// above the guardrail pace (at least 20 coins with round trips of >= 0.01 SOL).
// Paper trading only: no real money moves anywhere in this repository.
//
// Deterministic by construction: no clock, no randomness, iteration only over
// insertion-ordered maps fed by the batch stream.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
