// Lockstep check: does the time at which key events arrive change the game?
//
// Every browser runs its own engine on the same ordered event log. Most
// prompts wait for the next key, but some (the board cursor loop, the result
// screens, holding a number key) poll for a few frames and give up, so a key
// can be used on an earlier or later pass depending on when it arrived. If
// those extra passes changed the game, browsers would drift apart, and a
// reloaded page or a replay would show a different game from the live one.
//
// For random event logs this plays each log twice and compares the game state
// after every event:
//   eager  - as a reloaded page replays it: every event already queued, fast mode
//   live   - in virtual real time: each key arrives after a random delay, so
//            polls time out between keys as they do for players
//
// Usage: node lockstep.mjs [games=50] [events=2000] [firstSeed=1] [--plant-bug]
import crypto from 'crypto';
import path from 'path';
import { pathToFileURL } from 'url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..');
const js = p => pathToFileURL(path.join(root, 'server', 'game', 'static', 'game', 'js', p)).href;
const { Chaos, BOARD } = await import(js('engine/index.js'));
const { gameImage } = await import(js('engine/image.js'));
const { InputStream } = await import(js('input.js'));

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const [GAMES, EVENTS, FIRST] = [+(args[0] || 50), +(args[1] || 2000), +(args[2] || 1)];
// --plant-bug: make every poll timeout use a random number, to show the check
// catches a timing-dependent change
const PLANT_BUG = process.argv.includes('--plant-bug');
const IMAGE = gameImage();

// Game state that lasts between key presses, leaving out what only drives
// the display: as in jsharness.mjs, animation frames (L1), the "blank
// pending" board value and display bits of the other layers are not compared.
// Scratch values the cursor loop rewrites on every pass (the square under
// the cursor at $AC10/$AC12, the last key at $AC32) are not compared either:
// a snapshot taken mid-pass catches different leftovers, and if they ever
// leaked into play the board, wizards or RNG would differ afterwards.
const REGIONS = [['L0', 0xE01F, 0xA0], ['L2', 0xE160, 0xA0], ['L3', 0xE200, 0xA0], ['L4', 0xE2A0, 0xA0],
  ['L5', 0xE340, 0xA0], ['spells', 0x7F47, 0x141], ['bal', 0xC3A4, 1], ['round', 0x7D03, 1],
  ['wiz', 0xEA39, 0x26 * 8],
  ['player', 0xAC0E, 2],          // current player, number of wizards
  ['wflags', 0xAC16, 0x19],       // wizard flags, AI flags, computer seats ... $AC2E
  ['dead', 0xAC34, 1]];
function snapshot(g) {
  const out = {};
  for (const [n, a, len] of REGIONS) {
    let b = [...g.m.slice(a, a + len)];
    if (n === 'L0') b = b.map(v => (v === 1 ? 0 : v));
    if (n === 'L2') b = b.map(v => (v === 4 ? 4 : 0));
    if (n === 'L3') b = b.map(v => v & 0x7F);
    out[n] = b;
  }
  out.rng = [g.rng.s];
  return out;
}
const hashOf = snap => crypto.createHash('md5').update(JSON.stringify(snap)).digest('hex');
function stateHash(g) {
  const snap = snapshot(g);
  return { h: hashOf(snap), snap };
}
// where two snapshots differ: region, address and the two values
function describe(x, y) {
  const out = [];
  for (const [n, a] of [...REGIONS, ['rng', 0]]) {
    const p = x[n], q = y[n];
    for (let i = 0; i < p.length && out.length < 8; i++) {
      if (p[i] !== q[i]) out.push(`${n} $${(a + i).toString(16).toUpperCase()}: ${p[i]} vs ${q[i]}`);
    }
  }
  return out.join(', ');
}

// A random log: two human seats set up properly, two computer wizards, then
// random game keys from both humans and the odd takeover-free stretch.
function randomLog(seed, n) {
  let r = seed * 2654435761 >>> 0;
  const rnd = () => (r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const keys = 'QWEADZXCSK0123456789YN\r ';
  const log = [];
  const press = (seat, ch) => log.push({ seat, code: ch.charCodeAt(0) });
  for (const ch of '41') press(0, ch);
  for (const ch of 'ANNA\rN11') press(0, ch);
  for (const ch of 'BOB\rN22') press(1, ch);
  for (const ch of 'CPU\rY33') press(0, ch);
  for (const ch of 'DOT\rY44') press(0, ch);
  while (log.length * 2 < n) press(rnd() < 0.5 ? 0 : 1, keys[Math.floor(rnd() * keys.length)]);
  return { log, rnd };
}

function newEngine(seed, input, onEvent) {
  input.hostSeat = 0;
  input.seats.set(0, true); input.seats.set(1, true);
  const g = new Chaos(IMAGE, { input, seed, onEvent });
  input.engine = g;
  return g;
}

// eager: the reload path. Records the state after each event is consumed.
async function runEager(seed, log) {
  const input = new InputStream();
  const hashes = [];
  let g, ended = false;
  const total = log.length * 2;
  const consume = input.consume.bind(input);
  input.consume = () => {
    const ev = consume();
    hashes.push(stateHash(g));
    // out of events: a fast engine polling an empty queue never yields, so
    // stall it as the page does when it leaves fast mode
    if (hashes.length === total) g.fast = false;
    return ev;
  };
  input.finishReplay = () => {};          // stay in fast mode to the end
  input.replaying = true;
  g = newEngine(seed, input, ev => { if (ev.type === 'ended') ended = true; });
  g.fast = true;
  for (const e of log) { input.push({ type: 'down', seat: e.seat, code: e.code }); input.push({ type: 'up', seat: e.seat, code: e.code }); }
  g.run(seed).catch(() => {});
  // run until every event is used or the game ends, then stall the engine
  for (let spins = 0; hashes.length < total && !ended && spins < 200000; spins++) await new Promise(r => setImmediate(r));
  g.fast = false;
  return { hashes, ended };
}

// live: virtual time. Polls really wait frames; keys arrive at random times.
class LiveInput extends InputStream {
  constructor(clock) { super(); this.clock = clock; this.timeouts = 0; }
  async pollKey(who, frames) {
    this.setWaiting(who);
    for (let f = 0; ; f++) {
      while (this.queue.length) {
        const ev = this.consume();
        if (ev.type === 'down' && this.accept(ev, who)) return ev.code;
      }
      if (f >= frames) { this.timeouts++; if (PLANT_BUG) this.engine.rng.byte(); return 0xFF; }
      await this.clock.frame();
    }
  }
  async pollRelease(who, frames) {
    const seat = (who < 0 || !this.seats.get(who)) ? this.hostSeat : who;
    for (let f = 0; ; f++) {
      if (this.heldSet(seat).size === 0) return true;
      if (this.queue.length) { this.consume(); continue; }
      if (f >= frames) return false;
      await this.clock.frame();
    }
  }
}

async function runLive(seed, log, rnd) {
  const waiters = [];
  const clock = { frame: () => new Promise(r => waiters.push(r)) };
  const input = new LiveInput(clock);
  const hashes = [];
  let g, ended = false;
  const consume = input.consume.bind(input);
  input.consume = () => { const ev = consume(); hashes.push(stateHash(g)); return ev; };
  g = newEngine(seed, input, ev => { if (ev.type === 'ended') ended = true; });
  // arrival frame of every event, in log order (the server's order never
  // changes, only the timing): a pause before each press, held 2-12 frames
  const arrivals = [];
  let t = 0;
  for (const e of log) {
    t += Math.floor(rnd() ** 3 * 400);        // mostly quick, sometimes long pauses
    arrivals.push([t, { type: 'down', seat: e.seat, code: e.code }]);
    t += 2 + Math.floor(rnd() * 10);
    arrivals.push([t, { type: 'up', seat: e.seat, code: e.code }]);
  }
  g.run(seed).catch(() => {});
  const total = log.length * 2;
  let next = 0;
  for (let frame = 0; hashes.length < total && !ended && frame < t + 200000; frame++) {
    await new Promise(r => setImmediate(r));  // let the engine run until it waits
    while (next < arrivals.length && arrivals[next][0] <= frame) input.push(arrivals[next++][1]);
    g.tick();
    const w = waiters.splice(0);
    for (const f of w) f();
  }
  return { hashes, ended, timeouts: input.timeouts, round: g.m[0x7D03] };
}

let failures = 0;
const t0 = Date.now();
for (let seed = FIRST; seed < FIRST + GAMES; seed++) {
  const { log, rnd } = randomLog(seed, EVENTS);
  let t = Date.now();
  const a = await runEager(seed, log);
  const ta = Date.now() - t; t = Date.now();
  const b = await runLive(seed, log, rnd);
  const tb = Date.now() - t;
  const n = Math.min(a.hashes.length, b.hashes.length);
  let diff = -1;
  for (let i = 0; i < n; i++) if (a.hashes[i].h !== b.hashes[i].h) { diff = i; break; }
  if (diff < 0 && a.hashes.length !== b.hashes.length) diff = n;
  const status = diff < 0 ? 'same'
    : diff < n ? `DIFFER after event ${diff + 1}: ${describe(a.hashes[diff].snap, b.hashes[diff].snap)}`
    : 'DIFFER in how many events were used';
  if (diff >= 0) failures++;
  console.log(`seed ${seed}: ${a.hashes.length} events used (eager), ${b.hashes.length} (live)`
    + `, round ${b.round + 1}, ${b.timeouts} poll timeouts${a.ended ? ', game ended' : ''} [${ta} ms / ${tb} ms] - ${status}`);
}
console.log(`${GAMES - failures} of ${GAMES} games identical (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures ? 1 : 0);
