// Core of the Chaos port: memory, timing, input, RNG and the original's
// display primitives. Routine names carry the original Z80 address so the
// code can be checked line by line against the SkoolKit disassembly
// (re/chaos.skool).
//
// Determinism: everything that affects game logic depends only on the seed
// and the ordered stream of key events. Display-only work (the 50Hz board
// animation interrupt, cursor blinking, sound) never feeds back into logic.

import { Spectrum, SV, TSTATES_PER_SECOND, TSTATES_PER_FRAME } from '../spectrum.js';

// ---- memory map --------------------------------------------------------------
export const BOARD = 0xE01F;          // layer 0: object id per square (160 squares, stride 16)
export const L1 = 0x0A1;              // redraw timer (display)
export const L2 = 0x141;              // animation frame, 4 = corpse
export const L3 = 0x1E1;              // owner (b0-2) + status bits
export const L4 = 0x281;              // object underneath (wizard in castle/wood/riding)
export const L5 = 0x321;              // object underneath (corpse under creature)
export const RECORDS = 0xE3E0;        // object record pointer table, id 1..

export const V = {                    // game variables (original addresses)
  PLAYER: 0xAC0E, NWIZ: 0xAC0F, P12: 0xAC12, P14: 0xAC14, WFLAGS: 0xAC16,
  AIFLAG: 0xAC1E, CPU: 0xAC26, ISCPU: 0xAC2E, DEADCOUNT: 0xAC34, ROUND: 0x7D03,
  LEVEL: 0x89A7, SUCCESS: 0x9167, VALID: 0x975F, BALANCE: 0xC3A4, CURSOR: 0xBC94,
  SPELL: 0x937B, CHANCE: 0x9153, SPELLPTR: 0x9380, SPELLALIGN: 0x937F,
  ILLUSION: 0x9166, LISTPTR: 0x9154, SCRATCH: 0xA172, CD86: 0xCD86,
};

export const ANY = -1;                // any player may answer
export const HOST = -2;               // game host answers

// Z80 helpers
export const s8 = v => (v & 0x80 ? (v & 0xFF) - 256 : v & 0xFF);
export const M = (a, b) => (((a - b) & 0x80) !== 0);   // CP b ; JP M
export const P = (a, b) => (((a - b) & 0x80) === 0);   // CP b ; JP P
export const u8 = v => v & 0xFF;

// Seeded PRNG (mulberry32) shared by all clients of a game.
export class Rng {
  constructor(seed) { this.s = seed >>> 0; }
  next32() {
    let t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  }
  byte() { return this.next32() & 0xFF; }
}

export class Chaos {
  constructor(bin, opts) {
    this.m = new Uint8Array(65536);
    this.m.set(bin, bin.length >= 65536 ? 0 : 0x4000);
    this.rom = this.m.slice(0, 0x4000);
    this.spec = new Spectrum(this.m);
    this.input = opts.input;          // { getKey(who), pollKey(who, frames), waitRelease(who), held(who) }
    this.beeper = opts.beeper || null;
    this.rng = new Rng(opts.seed || 1);
    this.fast = false;                // fast-forward (replay): no waits, no sound
    this.ei = true;                   // interrupts enabled
    this.im2 = false;                 // board animation interrupt active
    this.pendingBlank = new Uint8Array(160);
    this.haltWaiters = [];
    this.setupSeat = HOST;            // controller during setup screens
    this.onEvent = opts.onEvent || (() => {});
    this.rules = opts.rules || {};    // custom rules (rules.js); none = the original game
    this.rangeHint = null;            // squares to highlight (display only), or null
    this.sharedRolls = null;          // the stat rolls every wizard gets (rules.stats 'equal')
    this.frameCount = 0;
    this.fastCount = 0;
    this.tOwed = 0;                   // T-states run since the last wait, not yet waited for
    this.tNoInt = 0;                  // the part of tOwed run with interrupts off
    this.intLeft = 0;                 // T-states the last interrupt ran into the next frame
    this.tQuiet = 0;                  // T-states of drawing since the last sound
    this.stallSeq = 1;                // decides which $BE94 calls stall (timing only)
  }

  // ---- memory access ---------------------------------------------------------
  rw(a) { return this.m[a] | (this.m[(a + 1) & 0xFFFF] << 8); }
  ww(a, v) { this.m[a] = v & 0xFF; this.m[(a + 1) & 0xFFFF] = (v >> 8) & 0xFF; }

  // ---- controllers -----------------------------------------------------------
  // Who answers the current prompt: the current player during the game.
  who() { return this.inSetup ? this.setupSeat : this.m[V.PLAYER]; }
  // Is this seat a computer wizard? (Not known until setup has finished.)
  isComputer(seat) { return !this.inSetup && seat >= 0 && !!this.m[V.CPU + seat]; }
  async key(who = this.who()) { return this.input.getKey(who); }
  async poll(frames, who = this.who()) {
    if (this.fast) return this.input.pollKey(who, 0, true);
    return this.input.pollKey(who, frames, false);
  }
  async waitRelease(who = this.who()) { return this.input.waitRelease(who); }

  // ---- timing ----------------------------------------------------------------
  // Called by the host page every 20ms (one Spectrum frame).
  tick() {
    this.frameCount++;
    // writes to the ROM have no effect on a real Spectrum
    if ((this.frameCount & 15) === 0) this.m.set(this.rom, 0);
    // T-states the board interrupt took from the main program this frame.
    // An interrupt that ran past the end of a frame (redrawing the whole
    // board takes about 7) had interrupts off, so the next ones are missed.
    let t = 0;
    if (this.intLeft > 0) this.intLeft -= TSTATES_PER_FRAME;
    else if (this.im2 && this.ei) {
      t = this.r_DF72();
      this.intLeft = t - TSTATES_PER_FRAME;
    }
    const w = this.haltWaiters; this.haltWaiters = [];
    for (const f of w) f(t);
  }
  halt(n = 1) {
    // HALT waits for the next interrupt, so time already run this frame is absorbed
    this.tOwed = 0; this.tQuiet = 0; this.tNoInt = 0;
    return this.waitFrames(n);
  }
  // Wait n frames. The board interrupt runs at the start of each frame, and
  // the main program only carries on once it has finished: after a HALT the
  // program starts that far into the frame, and code that was running (busy)
  // falls behind by every interrupt's time, so it may run into more frames.
  waitFrames(n, busy = false) {
    if (this.fast) {
      // let the browser breathe while replaying a long event log
      if ((++this.fastCount & 255) === 0) return new Promise(res => setTimeout(res, 0));
      return Promise.resolve();
    }
    return new Promise(res => {
      const step = t => {
        if (busy) { this.tOwed += t; this.tQuiet += t; } else { this.tOwed = t; this.tQuiet = t; }
        if (--n > 0) { this.haltWaiters.push(step); return; }
        if (busy && this.tOwed >= TSTATES_PER_FRAME) {
          n = Math.floor(this.tOwed / TSTATES_PER_FRAME);
          this.tOwed -= n * TSTATES_PER_FRAME;
          this.haltWaiters.push(step);
          return;
        }
        res();
      };
      this.haltWaiters.push(step);
    });
  }
  // Code that runs for t T-states. Short runs add up, and the engine waits a
  // frame only once a whole frame's worth has built up: a loop of short sound
  // effects (one per point of a beam, say) then runs at the Spectrum's speed
  // instead of one step per frame.
  delayT(t, catchUp = false) {
    if (this.fast || (t <= 0 && !catchUp)) return Promise.resolve();
    this.tOwed += t;
    const n = Math.floor(this.tOwed / TSTATES_PER_FRAME);
    if (n === 0) return Promise.resolve();
    this.tOwed -= n * TSTATES_PER_FRAME;
    this.tNoInt = 0;
    return this.waitFrames(n, true);
  }
  // Drawing that the Spectrum spends real time on (measured on the original);
  // waited for with the next delay, and silent before the next sound.
  busy(t) { if (!this.fast) { this.tOwed += t; this.tQuiet += t; } }
  // DJNZ-style busy loops: outer x inner, cost per inner iteration ~13 T
  delayLoop(outer, inner, perOuter = 30) {
    const io = inner === 0 ? 256 : inner, oo = outer === 0 ? 256 : outer;
    return this.delayT(oo * (io * 13 - 5 + perOuter));
  }

  // ---- random numbers --------------------------------------------------------
  // $904B: A = 0..9; the full byte (low nibble < 10) is left at $907A.
  r_904B() {
    let raw;
    do { raw = this.rng.byte(); } while ((raw & 0x0F) >= 10);
    this.m[0x907A] = raw;
    return raw & 0x0F;
  }
  // $BE94: another 0..9 generator (doesn't touch $907A)
  r_BE94() {
    let v;
    do { v = this.rng.byte() & 0x0F; } while (v >= 10);
    this.stallBE94();
    return v;
  }
  // The original builds the number from the R register, which its retry loop
  // steps by 16, so on a mostly empty board a number of 10 or more comes up
  // again every time round: about 3 calls in 8 spin until the next interrupt
  // changes R (measured: 37%). The interrupt then runs, which can take frames
  // when the whole board is being redrawn. Which calls stall is timing only,
  // kept apart from the game's random numbers.
  stallBE94() {
    if (this.fast) return;
    this.busy(150);
    if (!this.ei) return;
    this.stallSeq = (Math.imul(this.stallSeq, 1103515245) + 12345) >>> 0;
    if (((this.stallSeq >>> 16) & 15) >= 10) {
      this.busy(TSTATES_PER_FRAME - this.tOwed % TSTATES_PER_FRAME);
    }
  }
  rndByte() { return this.rng.byte(); }

  // ---- screen primitives -----------------------------------------------------
  // $DF0F: 8x8 char A at row B col C using CHARS, attribute ATTR-T
  r_DF0F(a, b, c) { this.spec.putChar(a & 0xFF, b, c & 0xFF); }

  // $DF4E: 16x16 sprite at ($DF4A) to char position ($DF4C)
  r_DF4E() {
    const m = this.m;
    const ptr = this.rw(0xDF4A);
    this.ww(SV.CHARS, (ptr - 256) & 0xFFFF);
    const c = m[0xDF4C], b = m[0xDF4D];
    this.r_DF0F(0x20, b, c);
    this.r_DF0F(0x21, b, c + 1);
    this.r_DF0F(0x22, b + 1, c);
    this.r_DF0F(0x23, b + 1, c + 1);
  }
  sprite(ptr, row, col) {
    this.ww(0xDF4A, ptr); this.m[0xDF4C] = col; this.m[0xDF4D] = row; this.r_DF4E();
    this.busy(2500);
  }

  // $E007: board address in ($E005) -> H=char row, L=char col
  r_E007(addr = this.rw(0xE005)) {
    this.ww(0xE005, addr);
    const l = (addr - BOARD) & 0xFF;
    const h = ((l & 0xF0) >> 3) + 1;
    const c = ((l << 1) & 0x1E) + 1;
    return { h, l: c, hl: (h << 8) | c };
  }
  // $C703: board address -> H=y (1..10), L=x (1..16)
  r_C703(addr) {
    const { h, l } = this.r_E007(addr);
    const y = (h >> 1) + 1, x = (l >> 1) + 1;
    return (y << 8) | x;
  }
  // $BDD1: B=y C=x (1-based) -> board address
  r_BDD1(bc) {
    const b = (bc >> 8) & 0xFF, c = bc & 0xFF;
    return BOARD + ((((b - 1) << 4) + (c - 1)) & 0xFF);
  }
  // $BC8D: board coords -> char coords (B=2B-1, C=2C-1)
  r_BC8D(bc) {
    const b = ((bc >> 8) * 2 - 1) & 0xFF, c = ((bc & 0xFF) * 2 - 1) & 0xFF;
    return (b << 8) | c;
  }

  // $BAD6: double-height character A at row B, col C; returns C+1
  r_BAD6(a, b, c) {
    this.ww(SV.CHARS, 0xD808);
    this.r_DF0F(a, b, c);
    this.ww(SV.CHARS, 0xDB08);
    this.r_DF0F(a, b + 1, c);
    return (c + 1) & 0xFF;
  }
  // $BAEE: print E chars from HL; returns new C
  r_BAEE(hl, e, b, c) {
    do {
      c = this.r_BAD6(this.m[hl], b, c);
      hl = (hl + 1) & 0xFFFF; e = (e - 1) & 0xFF;
    } while (e !== 0);
    return c;
  }
  // $BAFB: print name/message A from the table at $CDD3; returns new C
  r_BAFB(a, b, c) {
    const p = 0xCDD3 + (a & 0xFF) * 4;
    return this.r_BAEE(this.rw(p), this.m[p + 2], b, c);
  }
  // The text of message A from the table at $CDD3 (wizard names are $29 + seat)
  messageText(a) {
    const p = 0xCDD3 + (a & 0xFF) * 4, at = this.rw(p);
    return String.fromCharCode(...this.m.subarray(at, at + this.m[p + 2])).trim();
  }
  // $87EF: print setup message A from the table at $8809; returns new C
  r_87EF(a, b, c) {
    const p = 0x8809 + (a & 0xFF) * 4;
    return this.r_BAEE(this.rw(p), this.m[p + 2], b, c);
  }
  attr(a) { this.m[SV.ATTR_T] = a & 0xFF; }

  // $BB57: draw the screen border using the 8 chars at ($BB55)
  r_BB57() {
    this.ww(SV.CHARS, this.rw(0xBB55));
    for (let e = 0x14; e > 0; e--) { this.r_DF0F(0, e, 0); this.r_DF0F(1, e, 0x1F); }
    for (let e = 0x1E; e > 0; e--) { this.r_DF0F(2, 0, e); this.r_DF0F(3, 0x15, e); }
    this.r_DF0F(4, 0, 0); this.r_DF0F(5, 0, 0x1F);
    this.r_DF0F(6, 0x15, 0); this.r_DF0F(7, 0x15, 0x1F);
  }
  // $BED7: blank the message line (rows 22-23) with the current attribute
  r_BED7() { this.r_BAFB(1, 0x16, 0); }
  // $C5EE: clear the whole screen (pixels and attributes)
  r_C5EE() { this.spec.cls(); }

  // ---- board redraw ----------------------------------------------------------
  // Logic never writes object id 1 ("blank me") to the board: blank() stores 0
  // and asks the display to draw the blank sprite, as the interrupt would.
  blank(addr) {
    this.m[addr] = 0;
    if (!this.noRedrawBlanks) this.pendingBlank[(addr - BOARD) & 0xFF] = 1;
  }
  // $C0DD (and $C0D8 = without the border): schedule a redraw of every square
  r_C0DD(noBorder = false) {
    const m = this.m;
    for (let i = 0; i < 0xA0; i++) {
      if (m[BOARD + i] === 0 && ((i + 1) & 0x0F) !== 0) {
        if (!this.noRedrawBlanks) this.pendingBlank[i] = 1;
        m[BOARD + L2 + i] = 0;
      }
    }
    for (let i = 0; i < 0xA0; i++) m[BOARD + L1 + i] = 1;
    if (!noBorder) { this.attr(0x41); this.r_BB57(); }
    // measured on the original: about 27600 T, and 65800 more for the border,
    // all with interrupts off
    const t = noBorder ? 27610 : 93456;
    this.busy(t);
    if (!this.fast) this.tNoInt += t;
    this.ei = true;
  }
  r_C0D8() { this.r_C0DD(true); }

  // $DF72: the IM2 interrupt - animate/redraw board squares. Returns the
  // T-states the whole interrupt ($FE69, with the ROM's) takes on the
  // Spectrum: measured, 13886 with an empty board, 105 more for each square
  // that only counts down, 3118 for each square it draws.
  r_DF72() {
    const m = this.m;
    let cost = 13886;
    const saveAttr = m[SV.ATTR_T], saveChars = this.rw(SV.CHARS);
    for (let i = 0; i < 0xA0; i++) {
      const a = BOARD + i;
      let id = m[a];
      const isBlank = id === 0 && this.pendingBlank[i];
      if (id === 0 && !isBlank) continue;
      if (isBlank) id = 1;
      let t = (m[a + L1] - 1) & 0xFF;
      if (t !== 0) {
        m[a + L1] = t;
        cost += 105;
        // the original turns id 1 back into 0 on this pass even if it did not
        // get round to drawing the blank
        if (isBlank) this.pendingBlank[i] = 0;
        continue;
      }
      const rec = this.rw(RECORDS + (id - 1) * 2);
      m[a + L1] = m[rec + 0x16];
      let f = m[a + L2] + 1;
      if (f === (this.noAnim ? 1 : 4)) f = 0;
      if (f === 5) f = 4;
      m[a + L2] = f;
      const fp = rec + 0x17 + 3 * f;
      this.ww(0xDF4A, this.rw(fp));
      m[SV.ATTR_T] = m[fp + 2];
      const { hl } = this.r_E007(a);
      this.m[0xDF4C] = hl & 0xFF; this.m[0xDF4D] = hl >> 8;
      this.r_DF4E();
      cost += 3118;
      if (isBlank) this.pendingBlank[i] = 0;
    }
    m[SV.ATTR_T] = saveAttr; this.ww(SV.CHARS, saveChars);
    return cost;
  }

  // ---- sound -----------------------------------------------------------------
  // $C2F9: copy a 10-byte effect to $C2E8 and play it; $C2F6 uses ($C2F3)
  async r_C2F9(hl) { this.m.copyWithin(0xC2E8, hl, hl + 10); return this.r_C301(); }
  async r_C2F6() { return this.r_C2F9(this.rw(0xC2F3)); }
  // $C301: replay the effect in $C2E8 (delays are updated in place)
  async r_C301() {
    const m = this.m;
    // code run with interrupts on since the last wait may have reached the
    // next frame: its interrupt comes before this sound's DI
    if (this.ei && this.tOwed - this.tNoInt >= TSTATES_PER_FRAME) await this.delayT(0, true);
    this.ei = false;
    let t = 4 + 10 + 7;
    const edges = [];
    let outer = m[0xC2E8] || 256;
    let level = (m[0xC2F2] >> 4) & 1;
    const startLevel = level;
    while (outer--) {
      t += 11 + 10 + 7;
      let inner = m[0xC2E9] || 256;
      while (inner--) {
        t += 11 + 7 + 10;
        for (let k = 0; k < 4; k++) {
          const d = m[0xC2EA + k] || 256;
          t += 11 + 11 + 7 + 17 + (d - 1) * 13 + 8 + 10 + 13 + 7 + 13 + 11;
          m[0xC2F2] ^= 0x30;
          edges.push(t);
          this.spec.border = m[0xC2F2] & 7;
          t += 10 + 6 + 10 + (k < 3 ? 13 : 8);
        }
        t += 10 + (inner ? 13 : 8);
      }
      t += 7 + 4 + 10;
      for (let k = 0; k < 4; k++) {
        m[0xC2EA + k] = (m[0xC2EA + k] + m[0xC2EE + k]) & 0xFF;
        t += 7 + 7 + 7 + 6 + 6 + (k < 3 ? 13 : 8);
      }
      t += 10 + (outer ? 13 : 8);
    }
    t += 10;
    const a = m[0xC2ED];   // value left in A
    if (this.fast) return a;
    // the speaker is silent while the drawing before this sound runs
    const quiet = this.tQuiet; this.tQuiet = 0;
    if (this.beeper) this.beeper.play(edges.map(e => e + quiet), t + quiet, startLevel);
    await this.delayT(t);
    return a;
  }

  // ---- cursor and highlights -------------------------------------------------
  // $BDA5: XOR the cursor UDGs ($90-$93) at the cursor position
  r_BDA5() {
    const spec = this.spec;
    spec.chanOpenS();
    const bc = this.r_BC8D(this.rw(V.CURSOR));
    const b = bc >> 8, c = bc & 0xFF;
    spec.rst10(0x16); spec.rst10(b); spec.rst10(c); spec.rst10(0x90); spec.rst10(0x91);
    spec.rst10(0x16); spec.rst10(b + 1); spec.rst10(c); spec.rst10(0x92); spec.rst10(0x93);
  }
  // $D392: highlight every live creature belonging to player ($D391)
  r_D392() {
    const m = this.m, spec = this.spec;
    for (let i = 0; i < 0x9F; i++) {
      const a = BOARD + i;
      if (m[a] === 0 || m[a + L2] === 4) continue;
      if ((m[a + L3] & 7) !== m[0xD391]) continue;
      spec.chanOpenS();
      const { h, l } = this.r_E007(a);
      spec.rst10(0x16); spec.rst10(h); spec.rst10(l); spec.rst10(0x8F); spec.rst10(0x8F);
      spec.rst10(0x16); spec.rst10(h + 1); spec.rst10(l); spec.rst10(0x8F); spec.rst10(0x8F);
    }
  }

  // $FE56 / $FE60: switch the board animation interrupt on/off
  r_FE56() { this.im2 = true; }
  r_FE60() { this.im2 = false; }
}
