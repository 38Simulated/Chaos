// Game setup, main round loop and end-of-game screens ($89B0-$8F9A).
import { BOARD, L3, L4, V, HOST, ANY, M, P, u8, s8, TROLL } from './core.js';

export const SetupMixin = {
  // $89B0: wait for a digit 1-8 (2-8 if $8323 set), echo it, return 0-7
  async r_89B0(b, c, who) {
    let k;
    for (;;) {
      k = await this.key(who);
      if (k < 0x31 || k >= 0x39) continue;
      if (this.m[0x8323] && k < 0x32) continue;
      break;
    }
    this.m[0x89A8] = k;
    this.attr(0x47);
    this.r_BAD6(k, b, c);
    await this.r_C2F9(0x89EF);
    await this.r_907B(who);
    this.m[0x8323] = 0;
    return k - 0x31;
  },

  // $907B: wait for all keys to be released (the original also gathers
  // timing entropy here, which the remake replaces with its seeded RNG)
  async r_907B(who) {
    await this.waitRelease(who);
    this.ww(V.CD86, (this.rw(V.CD86) + 4) & 0xFFFF);
  },

  // $96E6: ~0.15s pause
  async r_96E6() { await this.delayT(255 * 2116); },

  // $8300: ($89AA) = current wizard's record, ($8321) = its frame table
  r_8300() {
    const p = this.m[V.PLAYER];
    const rec = this.rw(0xE3E0 + ((p + 0x28) * 2 & 0xFF));
    this.ww(0x89AA, rec);
    this.ww(0x8321, rec + 0x17);
    return rec;
  },
  // $8324: copy 4 sprite pointers from ($831F) into the wizard's frames
  r_8324() {
    this.r_8300();
    let src = this.rw(0x831F), dst = this.rw(0x8321);
    for (let i = 0; i < 4; i++) {
      this.m[dst] = this.m[src]; this.m[dst + 1] = this.m[src + 1];
      src += 2; dst += 3;
    }
    this.ww(0x831F, src); this.ww(0x8321, dst);
  },
  // $834B: A = current wizard's flags; returns the address too
  r_834B() { return V.WFLAGS + this.m[V.PLAYER]; },

  // $90F0: draw character sprite ($90DF) at ($89AC)
  r_90F0() {
    const ptr = this.rw(0x90E0 + this.m[0x90DF] * 2);
    this.ww(0xDF4A, ptr);
    this.ww(0xDF4C, this.rw(0x89AC));
    this.r_DF4E();
  },

  // $92AA: ($9154) = current player's spell list (2 bytes per entry: priority, spell)
  r_92AA() {
    const hl = 0x7F47 + 40 * this.m[V.PLAYER] + 1;
    this.ww(V.LISTPTR, hl);
    return hl;
  },

  // $89F9: start of a game
  async r_89F9() {
    const m = this.m;
    this.inSetup = true;
    this.setupSeat = HOST;
    this.spec.border = 0;
    m[0x5C8F] = 0; m[0x5C8D] = 0; m[0x5C8E] = 0xFF; m[0x5C91] = 3;
    this.ei = false;
    this.r_C5EE();
    m.fill(0, 0xAC16, 0xAC36);
    m.fill(0, 0x7F47, 0x8088);
    m.fill(0, 0xE01F, 0xE0BF);
    m.fill(0, 0xE0C0, 0xE3E0);
    this.pendingBlank.fill(0);
    m[V.BALANCE] = 0;
    this.attr(0x5A); this.r_BB57();
    this.attr(0x43); this.r_87EF(0x00, 0x02, 0x02);
    this.attr(0x42); this.r_87EF(0x01, 0x04, 0x08);
    this.attr(0x46); this.r_87EF(0x02, 0x09, 0x02);
    this.attr(0x44); this.r_87EF(0x0E, 0x0B, 0x02);
    m[0x8323] = 1;
    m[V.NWIZ] = (await this.r_89B0(0x09, 0x14, HOST)) + 1;
    this.attr(0x46); this.r_87EF(0x08, 0x0E, 0x02);
    this.attr(0x43); this.r_87EF(0x03, 0x10, 0x02);
    const lvl = await this.r_89B0(0x0E, 0x1D, HOST);
    m[V.LEVEL] = lvl;
    m[0x89A9] = u8(lvl * 4 + 0x0F);
    for (let i = 0; i < 10; i++) await this.r_96E6();

    m[V.PLAYER] = 0;
    this.ww(V.CD86, 0xD3F2);
    for (let w = 0; w < m[V.NWIZ]; w++) {
      this.setupSeat = m[V.PLAYER];
      await this.setupWizard();
      m[V.PLAYER] = u8(m[V.PLAYER] + 1);
    }
    this.inSetup = false;

    // place the wizards ($8E14)
    let tbl = 0x909F + ((m[V.NWIZ] - 2) * 8 & 0xFF);
    m[V.PLAYER] = 0;
    for (let w = 0; w < m[V.NWIZ]; w++) {
      const idx = m[tbl++];
      m[BOARD + idx] = u8(m[V.PLAYER] + 0x29);
      m[BOARD + L3 + idx] = m[V.PLAYER];
      m[V.PLAYER] = u8(m[V.PLAYER] + 1);
    }

    // main round loop ($8E55)
    m[V.ROUND] = 0;
    const total = this.rules.turns || u8(m[V.NWIZ] * 2 + 0x0F);
    let rounds = total;
    let won = false;
    while (rounds-- > 0) {
      // the game ends after `total` turns: tell the page how many are left
      this.onEvent({ type: 'round', left: rounds + 1, total });
      await this.r_9168();
      if (u8(m[V.DEADCOUNT] + 1) === m[V.NWIZ]) { won = true; break; }
      await this.r_9F50();
      await this.r_8F9A();
      this.r_A173();
      await this.r_AC36();
      this.r_FE56();
      for (let i = 0; i < 10; i++) await this.r_96E6();
      this.r_FE60();
      if (u8(m[V.DEADCOUNT] + 1) === m[V.NWIZ]) { won = true; break; }
      m[V.ROUND] = u8(m[V.ROUND] + 1);
    }
    const survivors = [];
    for (let i = 0; i < m[V.NWIZ]; i++) if (!(m[V.WFLAGS + i] & 0x10)) survivors.push(i);
    this.onEvent({ type: 'gameover', won, survivors });
    if (won) await this.winnerScreen();
    else await this.drawScreen();
  },

  // $8AD8-$8E08: one wizard's name, control, character, colour and stats
  async setupWizard() {
    const m = this.m;
    const p = m[V.PLAYER];
    this.r_C5EE();
    this.attr(0x69); this.r_BB57();
    this.attr(0x46);
    let c = this.r_87EF(0x04, 0x02, 0x02);
    this.r_BAD6(u8(p + 0x31), 0x02, c);
    this.attr(0x43); this.r_87EF(0x09, 0x04, 0x02);
    this.r_8300();
    m[0x89AE] = 0;
    this.ww(0x89AC, 0x0602);
    this.attr(0x45);
    // name entry ($8B19)
    for (;;) {
      const k = await this.key();
      m[0x89AF] = k;
      if (k === 0x0D) {
        if (m[0x89AE] === 0) continue;
        break;
      }
      if (k === 0x0C) {
        if (m[0x89AE] === 0) continue;
        const bc = (this.rw(0x89AC) - 1) & 0xFFFF;
        this.r_BAD6(0x20, bc >> 8, bc & 0xFF);
        this.ww(0x89AC, bc);
        m[0x89AE]--;
        this.ww(0x89AA, this.rw(0x89AA) - 1);
        await this.r_C2F9(0x89EF);
        await this.r_96E6();
        continue;
      }
      if (m[0x89AE] === 0x0B) continue;
      if (k !== 0x20) {
        if (M(k, 0x41)) continue;
        if (P(k, 0x7B)) continue;
      }
      m[this.rw(0x89AA)] = k;
      this.ww(0x89AA, this.rw(0x89AA) + 1);
      m[0x89AE]++;
      const bc = this.rw(0x89AC);
      this.r_BAD6(k, bc >> 8, bc & 0xFF);
      this.ww(0x89AC, bc + 1);
      await this.r_C2F9(0x89EF);
      await this.r_907B();
    }
    // $8B95: store name length in the names table
    m[0xCDD3 + ((p + 0x29) * 4 & 0x3FF) + 2] = m[0x89AE];
    await this.r_907B();
    this.attr(0x43); this.r_87EF(0x05, 0x09, 0x02);
    this.attr(0x46);
    m[V.ISCPU] = 0;
    for (;;) {
      const k = await this.key();
      if (k === 0x59) {
        this.r_87EF(0x06, 0x09, 0x17);
        m[V.CPU + p] = 1;
        m[V.ISCPU] = 1;
        break;
      }
      if (k === 0x4E) { this.r_87EF(0x07, 0x09, 0x17); break; }
    }
    this.onEvent({ type: 'wizard', seat: p, cpu: !!m[V.ISCPU] });
    await this.r_C2F9(0x89EF);
    await this.r_907B();
    // character
    this.attr(0x43); this.r_87EF(0x0C, 0x0B, 0x02);
    this.attr(0x45); this.r_87EF(0x0D, 0x0D, 0x02);
    this.ww(0x89AC, 0x0D03);
    m[0x89A8] = 0;
    for (let i = 0; i < 8; i++) {
      m[0x90DF] = m[0x89A8];
      m[0x89A8]++;
      this.r_90F0();
      this.ww(0x89AC, this.rw(0x89AC) + 3);
    }
    const ch = await this.r_89B0(0x0B, 0x13);
    m[0x90DF] = ch;
    this.ww(0x89AC, 0x0B14);
    this.r_90F0();
    this.ww(0x831F, 0x82C0 + ch * 8);
    this.r_8324();
    // colour
    this.attr(0x43); this.r_87EF(0x0B, 0x10, 0x02);
    this.attr(0x46); this.r_87EF(0x0D, 0x12, 0x02);
    this.ww(0x89AC, 0x1203);
    this.ww(0x8321, 0x90D7);
    for (let i = 0; i < 8; i++) {
      const hl = this.rw(0x8321);
      this.attr(m[hl]);
      this.ww(0x8321, hl + 1);
      this.r_90F0();
      this.ww(0x89AC, this.rw(0x89AC) + 3);
    }
    const col = await this.r_89B0(0x10, 0x10);
    this.attr(m[0x90D7 + col]);
    this.ww(0x89AC, 0x1011);
    this.r_90F0();
    this.r_8300();
    {
      let hl = this.rw(0x8321) - 1;
      const a = m[0x5C8F];
      for (let i = 0; i < 4; i++) { hl += 3; m[hl] = a; }
    }
    m[0x9049] = m[V.ISCPU] ? m[V.LEVEL] : 0;
    await this.genStats();
  },

  // $8CF2: random stats and spells for the current wizard
  async genStats() {
    const m = this.m;
    const bonus = m[0x9049];
    const sra = v => (s8(v) >> 1) & 0xFF;
    this.r_8300();
    let hl = this.rw(0x89AA) + 0x0D;
    // the stat rolls, in the original's order; a stats rule replaces them and
    // drops the computer level's bonus
    let rolls = [this.r_904B(), this.r_904B(), this.r_904B(), this.r_904B()];
    let b = bonus;
    if (this.statsRuleApplies()) {
      if (!this.sharedRolls) this.sharedRolls = rolls;
      rolls = this.statRolls();
      b = 0;
    }
    m[hl] = u8(sra(rolls[0]) + 1 + sra(b));                   // combat
    m[hl + 1] = 0;                                              // ranged combat
    m[hl + 2] = 0;                                              // range
    m[hl + 3] = u8(sra(rolls[1]) + 1 + sra(b));               // defence
    m[hl + 4] = 1;                                              // movement
    m[hl + 5] = u8(sra(rolls[2]) + 3 + sra(sra(b)));          // manoeuvre
    m[hl + 6] = u8(sra(sra(rolls[3])) + 6);                   // magic resistance
    let n = u8(sra(this.r_904B()) + 0x0B + bonus);
    if (P(n, 0x15)) n = 0x14;
    if (this.rules.spells) n = this.rules.spells;
    m[0x904A] = n;
    m[hl + 7] = n;                                              // spells
    m[hl + 8] = 0;                                              // ability
    m[V.SCRATCH] = u8(5 - sra(bonus));
    const e = this.r_904B();
    if (M(m[V.SCRATCH], e)) m[hl + 8] = sra(sra(this.r_904B()));
    if (this.rules.ability != null) m[hl + 8] = this.rules.ability;
    // spell list: entry 0 is always Disbelieve
    this.r_92AA();
    let lp = this.rw(V.LISTPTR) - 1;
    m[lp] = u8(this.r_904B() + 0x0C);
    m[lp + 1] = 1;
    lp += 2;
    this.ww(V.CD86, 0xD3F2);
    for (let i = 0; i < n; i++) {
      let a;
      // 2-63: Turmoil (64, 65) only comes from Magic Wood, unless a rule allows
      // it. With the Troll, 1 (Disbelieve, never drawn) stands for the Troll.
      const mask = this.rules.turmoil ? 0x7F : 0x3F;
      do { a = this.rndByte() & mask; } while ((a < 2 || a >= 0x42) && !(a === 1 && this.rules.troll));
      if (a === 1) a = TROLL;
      m[V.SPELL] = a;
      this.ww(V.CD86, this.rw(V.CD86) + 1);
      const ix = this.r_92F9();
      m[lp] = m[ix + 4];
      m[lp + 1] = m[V.SPELL];
      lp += 2;
    }
    this.ww(V.LISTPTR, lp);
    if (m[V.ISCPU]) {
      // bubble sort by priority, highest first ($8DDB)
      const base = this.r_92AA() - 1;
      for (let pass = 0; pass < 0x13; pass++) {
        let h = base;
        for (let j = 0; j < 0x13; j++) {
          const e0 = m[h], d0 = m[h + 1], c1 = m[h + 2], b1 = m[h + 3];
          if (c1 > e0) {
            m[h + 3] = d0; m[h + 2] = e0; m[h + 1] = b1; m[h] = c1;
          }
          h += 2;
        }
      }
    }
  },

  // $8F8B: cycle ATTR-T through 1..7 - and, as in the original, fall through
  // into the Magic Wood routine every time it wraps round.
  async r_8F8B() {
    const m = this.m;
    m[0x5C8F] = u8(m[0x5C8F] + 1);
    if (m[0x5C8F] !== 8) return;
    m[0x5C8F] = 1;
    await this.r_8F9A();
  },

  // $8F9A: a wizard sheltering in a Magic Wood may receive a new spell
  async r_8F9A() {
    const m = this.m;
    for (let i = 0; i < 0x9F; i++) {
      const a = BOARD + i;
      this.ww(V.P12, a);
      if (m[a] !== 0x24) continue;
      const w = m[a + L4];
      if (w === 0) continue;
      m[V.SCRATCH] = w;
      if (P(this.r_904B(), 4)) continue;
      m[V.PLAYER] = u8(w - 0x29);
      this.attr(0x46);
      let c = this.r_87EF(0x0F, 0x16, 0x00);
      c = (c + 1) & 0xFF;
      this.r_BAFB(w, 0x16, c);
      await this.r_C2F9(0x903E);
      this.ei = true;
      for (let k = 0; k < 10; k++) await this.r_96E6();
      this.r_BED7();
      let s;
      do { this.r_904B(); s = m[0x907A]; } while ((M(s, 2) || P(s, 0x41)) && !(s === 1 && this.rules.troll));
      if (s === 1) s = TROLL;   // (custom rule: the Troll)
      m[V.SPELL] = s;
      this.r_92AA();
      let h = this.rw(V.LISTPTR) + 2;
      for (let b = 0x13; b > 0; b--) {
        if (m[h] === 0) break;
        h += 2;
      }
      m[h] = m[V.SPELL];
      m[a] = m[V.SCRATCH];
      m[a + L4] = 0;
      m[a + L3] = u8(m[V.SCRATCH] - 0x29);
      this.r_C0DD();
      await this.halt();
    }
    this.ww(V.P12, BOARD + 0x9F);
  },

  // $8E9C: the contest is drawn
  async drawScreen() {
    const m = this.m;
    this.r_C5EE();
    m[0x5C8F] = 1;
    for (;;) {
      await this.r_8F8B();
      this.r_BB57();
      await this.r_8F8B();
      this.r_87EF(0x10, 0x02, 0x02);
      let bc = 0x030A;
      m[V.PLAYER] = 0x29;
      for (let i = 0; i < m[V.NWIZ]; i++) {
        if (!(m[V.WFLAGS + i] & 0x10)) {
          await this.r_8F8B();
          bc += 0x200;
          this.r_BAFB(m[V.PLAYER], bc >> 8, bc & 0xFF);
        }
        m[V.PLAYER] = u8(m[V.PLAYER] + 1);
      }
      await this.r_8F8B();
      this.r_BAFB(0x3D, 0x16, 0x00);
      await this.r_96E6();
      if ((await this.poll(1, ANY)) !== 0xFF) break;
    }
  },

  // $8F04: we have a winner
  async winnerScreen() {
    const m = this.m;
    this.r_C5EE();
    m[0x5C8F] = 1;
    for (;;) {
      await this.r_8F8B();
      this.r_BB57();
      await this.r_8F8B();
      this.r_87EF(0x11, 0x04, 0x09);
      await this.r_8F8B();
      this.r_87EF(0x12, 0x08, 0x08);
      this.r_87EF(0x13, 0x0A, 0x08);
      this.r_87EF(0x13, 0x0C, 0x08);
      this.r_87EF(0x13, 0x0E, 0x08);
      this.r_87EF(0x12, 0x10, 0x08);
      await this.r_8F8B();
      let b = 8, i = 0;
      while (b > 0 && (m[V.WFLAGS + i] & 0x10)) { i++; b--; }
      const name = u8(0x31 - b);
      const len = m[0xCDD3 + name * 4 + 2];
      const c = u8(0x10 - (s8(len) >> 1));
      this.r_BAFB(name, 0x0C, c);
      await this.r_8F8B();
      this.r_BAFB(0x3D, 0x16, 0x00);
      await this.r_96E6();
      if ((await this.poll(1, ANY)) !== 0xFF) break;
    }
  },
};
