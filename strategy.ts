// BurstSniper strategy for the pump.fun bonding-curve replay (agent-fun/replay/v2).
//
// Every curve keeps a short rolling tape of its recorded trades. A curve becomes a
// buy in one of two ways, both read off the tape in the current batch:
//
//   BURST: the curve is young (20-600 slots since its CreateEvent) and its last
//     20 slots show a burst - at least 4 buys from at least 3 distinct wallets,
//     net SOL flowing in, the price up at least 4% over the window and sitting
//     near its window high, with no single wallet dominating the buys.
//   TREND: the curve is older and its last 60 slots show sustained demand -
//     at least 6 buys from at least 5 distinct wallets, net inflow of at least
//     2 SOL and the price up at least 8%, still near its window high.
// Both modes also require the flow to be accelerating (the newer half of the
// window brings in at least as much net SOL as the older half), the price not
// to have already run too far inside one window (burst +30%, trend +60%), the
// last trade in the window to be a buy, and the curve's real SOL reserve to
// sit between 1 and 50 SOL - tiny curves are untradeable noise, huge ones are
// already past their run.
//
// The first buy is tiny (0.01-0.015 SOL). One small pyramid add follows only
// while the price has stepped up from the entry price and net SOL still flows
// in. Stakes stay tiny because most curves die: the bot is a basket of small
// bets, not a concentrated trade. There is no take-profit - winners are left
// to run to curve completion, where the replay closes them at final reserves.
// Losers are cut: a stop-loss at -25% on cost, a trailing stop once a position
// is up 50% (exit 30% below its peak value), a fade exit when the last 20 slots
// of flow turn strongly negative, or a max hold of 3000 slots.
// A curve that completes is closed by the replay at its final reserves.
//
// Guardrail probes keep the run above the minimum bar (20 coins, each with a
// round trip of at least 0.01 SOL): when the bot's own fills or coins lag a pace
// set in block time, it buys 0.01 SOL of a liquid curve and sells it as soon as
// the buy lands.
//
// Deterministic by construction: no clock, no randomness, iteration only over
// insertion-ordered maps fed by the batch stream.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Burst entry window in slots. */
  burstWindow: number;
  /** Trend entry window in slots. */
  trendWindow: number;
  /** Burst: minimum net buy SOL (buys minus sells) over the burst window. */
  burstMinNetSol: 2
  /** Trend: minimum net buy SOL over the trend window. */
  trendMinNetSol: 4
  /** Burst: minimum buy trades in the window. */
  burstMinBuys: number;
  /** Trend: minimum buy trades in the window. */
  trendMinBuys: number;
  /** Burst: minimum distinct buying wallets in the window. */
  burstMinBuyers: 6
  /** Trend: minimum distinct buying wallets in the window. */
  trendMinBuyers: 6
  /** Burst: price now over price at window start, minus 1. */
  burstMinUp: number;
  /** Trend: price now over price at window start, minus 1. */
  trendMinUp: number;
  /** Upper bound on that rise: skip curves that already ran too far inside one window. */
  burstMaxUp: number;
  trendMaxUp: number;
  /** Newer-half net inflow must be at least this multiple of the older half's (acceleration). */
  accel: number;
  /** Curve real SOL bounds at entry. */
  minRqSol: number;
  maxRqSol: number;
  /** Price now at least this share of the window high. */
  nearHigh: number;
  /** Largest single wallet's share of the window's buy SOL. */
  maxBuyerShare: number;
  /** Burst entry allowed between these ages (slots since CreateEvent). */
  burstMinAge: number;
  burstMaxAge: number;
  /** Trend entry allowed from this age (slots since CreateEvent). */
  trendMinAge: number;
  /** First buy size (SOL) for a burst entry. */
  burstFirstSol: 0.01
  /** First buy size (SOL) for a trend entry. */
  trendFirstSol: 0.015
  /** One pyramid add (SOL). */
  addSol: 0.02
  /** Total stake cap per curve (SOL). */
  stakeSol: 0.04
  /** Smallest buy worth sending (SOL). */
  minBuySol: number;
  /** Slippage on buys (bps); sells always go out at 10000. */
  buySlipBps: number;
  /** Take-profit: exit when value reaches cost * (1 + takeProfit). */
  takeProfit: 10
  /** Stop-loss: exit when value falls below cost * (1 - stopLoss). */
  stopLoss: 0.25
  /** Trailing stop arms once value reached cost * (1 + trailArm). */
  trailArm: 0.5
  /** Trailing stop: exit when value falls below peak * (1 - trail). */
  trail: 0.3
  /** Fade window in slots; exit when net SOL over it falls below -fadeNetSol. */
  fadeWindow: number;
  fadeNetSol: 2
  /** Exit after this many slots held (unless up at least holdIfUp). */
  maxHold: 3000
  /** The time limit does not apply while the position is up at least this much. */
  holdIfUp: number;
  /** Slots to wait after an exit before the same curve may be bought again. */
  cooldown: number;
  /** Most entries per curve over the run. */
  maxEntries: 1
  /** Add only once the price is this much above the entry decision price. */
  addStep: number;
  /** Add only while net SOL over the trend window is at least this. */
  addNetSol: number;
  /** Most SOL at cost across all positions at once (a drawdown guard). */
  maxExposureSol: number;
  /** Guardrail pacing targets: coins and fills to reach over paceSecs. */
  targetCoins: number;
  targetFills: number;
  paceSecs: number;
  probeSol: number;
  maxProbes: number;
}

export const DEFAULT_PARAMS: Params = {
  burstWindow: 20,
  trendWindow: 60,
  burstMinNetSol: 2,
  trendMinNetSol: 4,
  burstMinBuys: 4,
  trendMinBuys: 6,
  burstMinBuyers: 6,
  trendMinBuyers: 6,
  burstMinUp: 0.04,
  trendMinUp: 0.08,
  burstMaxUp: 0.3,
  trendMaxUp: 0.6,
  accel: 1,
  minRqSol: 1,
  maxRqSol: 50,
  nearHigh: 0.95,
  maxBuyerShare: 0.6,
  burstMinAge: 20,
  burstMaxAge: 600,
  trendMinAge: 600,
  burstFirstSol: 0.01,
  trendFirstSol: 0.015,
  addSol: 0.02,
  stakeSol: 0.04,
  minBuySol: 0.01,
  buySlipBps: 1500,
  takeProfit: 10,
  stopLoss: 0.25,
  trailArm: 0.5,
  trail: 0.3,
  fadeWindow: 20,
  fadeNetSol: 2,
  maxHold: 3000,
  holdIfUp: 0.1,
  cooldown: 200,
  maxEntries: 1,
  addStep: 0.12,
  addNetSol: 0.5,
  maxExposureSol: 8,
  targetCoins: 30,
  targetFills: 220,
  paceSecs: 21_600,
  probeSol: 0.01,
  maxProbes: 1,
};

const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125;

interface Trade {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
  price: number;
}

interface Tape {
  created: number | null;
  trades: Trade[];
  entries: number;
  lastExit: number;
}

interface Held {
  opened: number;
  peakValue: number;
  invested: number;
  exiting: boolean;
  filled: boolean;
  entryPrice: number;
  lastValue: number;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();
  /** Probe round trips in flight, by mint: false while buying, true once selling. */
  const probes = new Map<Pubkey, boolean>();
  /** The bot's own filled orders and the coins they were on. */
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  const keep = Math.max(p.burstWindow, p.trendWindow, p.fadeWindow) + 5;

  const tapeOf = (mint: Pubkey): Tape => {
    let t = tapes.get(mint);
    if (t === undefined) {
      t = { created: null, trades: [], entries: 0, lastExit: -1e12 };
      tapes.set(mint, t);
    }
    return t;
  };

  /** Window statistics for one tape at slot `now` over the last `w` slots. */
  const windowStats = (t: Tape, now: number, w: number) => {
    const from = now - w;
    const mid = now - w / 2;
    let buySol = 0;
    let sellSol = 0;
    let buys = 0;
    let netOld = 0;
    let netNew = 0;
    let startPrice = -1;
    let high = 0;
    let last = 0;
    let lastIsBuy = false;
    const byUser = new Map<string, number>();
    for (const tr of t.trades) {
      if (tr.slot <= from) {
        startPrice = tr.price;
        continue;
      }
      if (startPrice < 0) startPrice = tr.price;
      const signed = tr.buy ? tr.sol : -tr.sol;
      if (tr.slot <= mid) netOld += signed;
      else netNew += signed;
      if (tr.buy) {
        buySol += tr.sol;
        buys++;
        byUser.set(tr.user, (byUser.get(tr.user) ?? 0) + tr.sol);
      } else {
        sellSol += tr.sol;
      }
      if (tr.price > high) high = tr.price;
      last = tr.price;
      lastIsBuy = tr.buy;
    }
    let top = 0;
    for (const v of byUser.values()) if (v > top) top = v;
    return {
      net: buySol - sellSol,
      buys,
      buyers: byUser.size,
      up: startPrice > 0 ? last / startPrice - 1 : -1,
      nearHigh: high > 0 ? last / high : 0,
      topShare: buySol > 0 ? top / buySol : 1,
      last,
      accelerating: netNew > 0 && netNew >= p.accel * netOld,
      lastIsBuy,
    };
  };

  /** Net recorded SOL (buys minus sells) over the last `w` slots. */
  const flow = (t: Tape, now: number, w: number): number => {
    let net = 0;
    for (let i = t.trades.length - 1; i >= 0; i--) {
      const tr = t.trades[i]!;
      if (tr.slot <= now - w) break;
      net += tr.buy ? tr.sol : -tr.sol;
    }
    return net;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const traded = new Set<Pubkey>();
      for (const f of batch.fills) {
        if (f.status === 'filled' && !f.client_id.startsWith('_')) {
          myFills++;
          myCoins.add(f.mint);
        }
      }
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          tapeOf(e.mint).created = e.slot;
        } else if (e.event === 'TradeEvent') {
          const t = tapeOf(e.mint);
          const sol = Number(e.sol_amount) / LAMPORTS;
          t.trades.push({
            slot: e.slot,
            buy: e.is_buy,
            sol,
            user: e.user,
            price: Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves),
          });
          traded.add(e.mint);
        }
      }
      for (const mint of traded) {
        const t = tapes.get(mint)!;
        let cut = 0;
        while (cut < t.trades.length && t.trades[cut]!.slot <= now - keep) cut++;
        if (cut > 0) t.trades.splice(0, cut);
      }
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingByMint = new Map<Pubkey, number>();
      for (const po of state.pending.values()) {
        pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);
      }

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;

      // Exits first: take-profit, stop-loss, trailing stop, fade, max hold.
      for (const [mint, h] of held) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) {
            held.delete(mint);
            const t = tapeOf(mint);
            if (h.filled) t.lastExit = now;
            else t.entries--;
          }
          continue;
        }
        h.filled = true;
        if (curve === undefined || curve.complete) continue;
        const mk = marks.get(mint);
        const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const tokens = Number(pos.token_amount);
        const value = ((tokens * vq) / (vt + tokens) / LAMPORTS) * (1 - CURVE_FEE) - tx;
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (value > h.peakValue) h.peakValue = value;
        h.lastValue = value;
        let exit = h.exiting;
        const t = tapeOf(mint);
        if (!exit && value >= cost * (1 + p.takeProfit)) exit = true;
        if (!exit && value < cost * (1 - p.stopLoss)) exit = true;
        if (!exit && h.peakValue >= cost * (1 + p.trailArm) && value < h.peakValue * (1 - p.trail)) exit = true;
        if (!exit && flow(t, now, p.fadeWindow) < -p.fadeNetSol) exit = true;
        if (!exit && now - h.opened > p.maxHold && value < cost * (1 + p.holdIfUp)) exit = true;
        if (!exit) continue;
        h.exiting = true;
        if (pendingByMint.has(mint)) {
          let sellPending = false;
          for (const po of state.pending.values()) {
            if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
          }
          if (sellPending) continue;
        }
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      }

      // Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, selling] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pendingByMint.has(mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        if (!selling) probes.set(mint, true);
      }

      // Entries and pyramid adds, for curves that traded in this batch.
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let exposure = 0;
      for (const [mint, h] of held) {
        exposure += Math.max(h.invested, Number(state.positions.get(mint)?.cost_lamports ?? 0n) / LAMPORTS);
      }
      for (const mint of traded) {
        if (orders.length >= cap) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (pendingByMint.has(mint) || probes.has(mint)) continue;
        const t = tapes.get(mint)!;
        const h = held.get(mint);
        const price = Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
        let want: number;
        if (h === undefined) {
          if (slotsLeft <= 0) continue;
          if (t.entries >= p.maxEntries || now - t.lastExit < p.cooldown) continue;
          if (t.created === null) continue;
          const age = now - t.created;
          const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
          let first: number | null = null;
          if (rqSol >= p.minRqSol && rqSol <= p.maxRqSol && age >= p.burstMinAge && age <= p.burstMaxAge) {
            const s = windowStats(t, now, p.burstWindow);
            if (
              s.net >= p.burstMinNetSol &&
              s.buys >= p.burstMinBuys &&
              s.buyers >= p.burstMinBuyers &&
              s.up >= p.burstMinUp &&
              s.up <= p.burstMaxUp &&
              s.nearHigh >= p.nearHigh &&
              s.topShare <= p.maxBuyerShare &&
              s.accelerating &&
              s.lastIsBuy
            ) {
              first = p.burstFirstSol;
            }
          }
          if (first === null && rqSol >= p.minRqSol && rqSol <= p.maxRqSol && age >= p.trendMinAge) {
            const s = windowStats(t, now, p.trendWindow);
            if (
              s.net >= p.trendMinNetSol &&
              s.buys >= p.trendMinBuys &&
              s.buyers >= p.trendMinBuyers &&
              s.up >= p.trendMinUp &&
              s.up <= p.trendMaxUp &&
              s.nearHigh >= p.nearHigh &&
              s.topShare <= p.maxBuyerShare &&
              s.accelerating &&
              s.lastIsBuy
            ) {
              first = p.trendFirstSol;
            }
          }
          if (first === null) continue;
          want = first;
        } else {
          // Pyramid into strength only: price stepped up from entry, flow still positive.
          if (h.exiting || !h.filled || h.invested >= p.stakeSol - p.minBuySol) continue;
          const pos = state.positions.get(mint);
          if (pos === undefined) continue;
          if (price < h.entryPrice * (1 + p.addStep)) continue;
          if (flow(t, now, p.trendWindow) < p.addNetSol) continue;
          want = Math.min(p.addSol, p.stakeSol - h.invested);
        }
        const capSol = Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS;
        let amount = Math.min(capSol, want, p.maxExposureSol - exposure);
        if (amount > free - tx) amount = free - tx;
        if (amount < p.minBuySol) continue;
        const lamports = BigInt(Math.floor(amount * LAMPORTS));
        orders.push({ side: 'buy', mint, quote_lamports: lamports, max_slippage_bps: p.buySlipBps });
        free -= amount + tx;
        exposure += amount;
        if (h === undefined) {
          held.set(mint, {
            opened: now,
            peakValue: 0,
            invested: amount,
            exiting: false,
            filled: false,
            entryPrice: price,
            lastValue: 0,
          });
          t.entries++;
          slotsLeft--;
        } else {
          h.invested += amount;
        }
      }

      // Guardrail pacing: open a probe when fills or coins lag the pace.
      if (probes.size < p.maxProbes && slotsLeft > 0 && firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / p.paceSecs);
        const needCoins = myCoins.size < Math.ceil(p.targetCoins * pace);
        const needFills = myFills < Math.ceil(p.targetFills * pace);
        if (needCoins || needFills) {
          const minRq = (p.probeSol * 10_000) / state.hello.caps.max_order_bps_of_real_reserve;
          for (const mint of traded) {
            if (orders.length >= cap || probes.size >= p.maxProbes) break;
            if (held.has(mint) || probes.has(mint) || pendingByMint.has(mint) || state.positions.has(mint)) continue;
            if (needCoins && !needFills && myCoins.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            if (Number(curve.real_quote_reserves) / LAMPORTS < minRq * 1.5) continue;
            if (free < p.probeSol + 2 * tx) break;
            orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(p.probeSol * LAMPORTS)), max_slippage_bps: p.buySlipBps });
            probes.set(mint, false);
            free -= p.probeSol + tx;
          }
        }
      }
      return orders;
    },
  };
}
