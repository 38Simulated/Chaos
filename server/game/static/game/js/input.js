// Ordered key-event stream feeding the engine.
//
// Every client receives the same sequence of events (from the server, or
// locally in solo mode). The engine pulls events only at the points where the
// original game reads the keyboard, and accepts an event only if it comes from
// the player who is allowed to answer at that point. Because the decision
// depends solely on the event order and the game state, all clients stay in
// lockstep regardless of network or rendering speed.

import { ANY, HOST } from './engine/core.js';

export class InputStream {
  constructor() {
    this.queue = [];
    this.waiters = [];
    this.held = new Map();      // seat -> Set of keys currently held (as consumed)
    this.seats = new Map();     // seat index -> true if a human occupies it
    this.hostSeat = 0;
    this.replaying = false;     // set while catching up with past events
    this.engine = null;
    this.onNeed = () => {};     // called when the engine starts waiting for `who`
    this.waitingFor = null;
  }

  push(ev) {
    this.queue.push(ev);
    const w = this.waiters; this.waiters = [];
    for (const f of w) f();
  }

  accept(ev, who) {
    if (who === ANY) return true;
    if (who === HOST) return ev.seat === this.hostSeat;
    if (ev.seat === who) return true;
    // seats without a human are answered by the host
    return !this.seats.get(who) && ev.seat === this.hostSeat;
  }

  heldSet(seat) {
    let s = this.held.get(seat);
    if (!s) { s = new Set(); this.held.set(seat, s); }
    return s;
  }

  consume() {
    const ev = this.queue.shift();
    if (ev.type === 'takeover') {
      // the host answers for this seat from now on
      this.seats.set(ev.seat, false);
      this.heldSet(ev.seat).clear();
      if (this.queue.length === 0 && this.replaying) this.finishReplay();
      return ev;
    }
    const s = this.heldSet(ev.seat);
    if (ev.type === 'down') s.add(ev.code);
    else if (ev.type === 'up') s.delete(ev.code);
    if (this.queue.length === 0 && this.replaying) this.finishReplay();
    return ev;
  }

  finishReplay() {
    this.replaying = false;
    if (this.engine) { this.engine.fast = false; this.engine.onEvent({ type: 'caughtup' }); }
  }

  next(timeoutMs) {
    if (this.queue.length) return Promise.resolve(true);
    if (this.replaying) this.finishReplay();
    return new Promise(res => {
      let t = null;
      const f = () => { if (t) clearTimeout(t); res(true); };
      this.waiters.push(f);
      if (timeoutMs !== undefined) {
        t = setTimeout(() => {
          this.waiters = this.waiters.filter(x => x !== f);
          res(false);
        }, timeoutMs);
      }
    });
  }

  setWaiting(who) {
    if (this.waitingFor !== who) { this.waitingFor = who; this.onNeed(who); }
  }

  // Block until an accepted key press; returns its character code.
  async getKey(who) {
    this.setWaiting(who);
    for (;;) {
      await this.next();
      const ev = this.consume();
      if (ev.type === 'down' && this.accept(ev, who)) return ev.code;
    }
  }

  // Wait up to `frames` for an accepted key press; 0xFF if none arrived.
  async pollKey(who, frames, fast) {
    this.setWaiting(who);
    const deadline = performance.now() + frames * 20;
    for (;;) {
      if (!this.queue.length) {
        if (fast && this.replaying) { this.finishReplay(); }
        const left = deadline - performance.now();
        if (left <= 0) return 0xFF;
        if (!(await this.next(left))) return 0xFF;
      }
      const ev = this.consume();
      if (ev.type === 'down' && this.accept(ev, who)) return ev.code;
    }
  }

  // Wait until the answering player has no keys held.
  async waitRelease(who) {
    const seatOf = () => {
      if (who === ANY || who === HOST) return this.hostSeat;
      return (!this.seats.get(who)) ? this.hostSeat : who;
    };
    for (;;) {
      const s = this.heldSet(seatOf());
      if (s.size === 0) return;
      await this.next();
      this.consume();
    }
  }
}

// Map a browser KeyboardEvent to the code the Spectrum ROM would return
// (CAPS LOCK is on in Chaos, so letters are upper case).
export function spectrumCode(e) {
  const k = e.key;
  if (k === 'Enter') return 0x0D;
  if (k === ' ') return 0x20;
  if (k === 'Backspace' || k === 'Delete') return 0x0C;
  if (k.length === 1) {
    const c = k.toUpperCase().charCodeAt(0);
    if ((c >= 0x41 && c <= 0x5A) || (c >= 0x30 && c <= 0x39)) return c;
  }
  return null;
}

// Additions used by the cursor loop / prompts --------------------------------
InputStream.prototype.peekKey = async function (who) {
  this.setWaiting(who);
  for (;;) {
    await this.next();
    const ev = this.queue[0];
    if (ev.type === 'down' && this.accept(ev, who)) return ev.code;
    this.consume();
  }
};
// Wait up to `frames` for the answering player's keys to be released.
InputStream.prototype.pollRelease = async function (who, frames, fast) {
  const seat = (who === ANY || who === HOST || !this.seats.get(who)) ? this.hostSeat : who;
  const deadline = performance.now() + frames * 20;
  for (;;) {
    if (this.heldSet(seat).size === 0) return true;
    if (!this.queue.length) {
      if (fast && this.replaying) this.finishReplay();
      const left = deadline - performance.now();
      if (left <= 0) return false;
      if (!(await this.next(left))) return false;
    }
    this.consume();
  }
};
