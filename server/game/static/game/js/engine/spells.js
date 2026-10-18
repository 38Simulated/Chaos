// Spell selection menus, casting phase and all spell handlers ($8357-$A1E5).
import { BOARD, L1, L2, L3, L4, L5, V, M, P, u8, s8, TROLL_SPELL } from './core.js';

// "H+L == 0" null test used by the original on board addresses. Note that the
// real square $E020 (index 1) also passes this test - the original treats it
// as off-board in neighbour scans, and so do we.
// Stats $0D-$15 of object 0: the 48K ROM bytes at $202D-$2035.
// Turmoil's targets: a random byte r (low nibble 0-9) gives square
// r + (r & 15), kept when the signed compare with $9F says it is lower. That
// leaves the even squares $20-$9E: every other column, below the top two rows.
const TURMOIL_SQUARES = [];
for (let r = 0; r < 256; r++) {
  const a = u8(r + (r & 15));
  if ((r & 15) < 10 && !P(a, 0x9F) && !TURMOIL_SQUARES.includes(a)) TURMOIL_SQUARES.push(a);
}
const OBJECT0_STATS =[0xFB, 0x24, 0xCD, 0xC3, 0x1F, 0xFD, 0xCB, 0x01, 0x76];

export const isNull = a => ((((a >> 8) & 0xFF) + (a & 0xFF)) & 0xFF) === 0;

export const SpellsMixin = {
  // ---- helpers ---------------------------------------------------------------
  // $BE0A: stat E of object D. Object 0 (an empty square) has no record: its
  // pointer is $2020, so the original reads its stats from the Spectrum ROM.
  r_BE0A(d, e) {
    const rec = this.record(d);
    if (rec === 0x2020 && e >= 0x0D && e <= 0x15) return OBJECT0_STATS[e - 0x0D];
    return this.m[(rec + e) & 0xFFFF];
  },

  // $BEEF: distance = 2*max(dx,dy) + min(dx,dy) between ($BEE9) and ($BEEB)
  r_BEEF() {
    const m = this.m;
    const l = m[0xBEE9], h = m[0xBEEA], e = m[0xBEEB], d = m[0xBEEC];
    const dy = M(d, h) ? u8(h - d) : u8(d - h);
    const dx = M(e, l) ? u8(l - e) : u8(e - l);
    m[0xBEEE] = dy; m[0xBEED] = dx;
    const dist = M(dy, dx) ? u8(dx * 2 + dy) : u8(dy * 2 + dx);
    m[0xBEE8] = dist;
    return dist;
  },
  distance(fromAddr, toAddr) {
    this.ww(0xBEE9, this.r_C703(fromAddr));
    this.ww(0xBEEB, this.r_C703(toAddr));
    return this.r_BEEF();
  },

  // $92F9: look up spell ($937B); sets $9380 (entry), $937F (alignment) and
  // $9153 (casting chance 0-9). Returns the entry address (IX).
  r_92F9() {
    const m = this.m;
    const ix = this.isTroll(m[V.SPELL]) ? TROLL_SPELL : 0x7D60 + 7 * u8(m[V.SPELL] - 1);
    this.ix = ix;
    this.ww(V.SPELLPTR, ix);
    m[V.SPELLALIGN] = m[ix + 3];
    const bal = m[V.BALANCE];
    let ch = m[ix + 1];
    const al = m[V.SPELLALIGN];
    if (bal !== 0) {
      if (!(bal & 0x80)) {
        if (al !== 0 && !(al & 0x80)) ch = u8(m[ix + 1] + (bal >> 2));
      } else {
        const e = u8(-bal);
        if (al & 0x80) ch = u8(m[ix + 1] + (e >> 2));
      }
    }
    ch = u8(ch + this.r_BE0A(u8(m[V.PLAYER] + 0x29), 0x15));
    if (!M(ch, 0x0A)) ch = 9;
    if (!P(ch, 0)) ch = 0;
    m[V.CHANCE] = ch;
    return ix;
  },

  // $95B8: $AC2E = is the current player computer controlled?
  r_95B8() { const v = this.m[V.CPU + this.m[V.PLAYER]]; this.m[V.ISCPU] = v; return v; },

  // $BBB0: wait for a key press (not consumed) unless computer
  async r_BBB0() {
    if (this.m[V.ISCPU]) return;
    await this.input.peekKey(this.who());
  },
  // $BBCC: wait for keys to be released unless computer
  async r_BBCC() {
    if (this.m[V.ISCPU]) return;
    await this.waitRelease();
  },

  // $97A3: SPELL FAILS / SPELL SUCCEEDS and a 2 second pause
  async r_97A3() {
    this.r_BED7();
    if (!this.m[V.SUCCESS]) { this.attr(0x43); this.r_BAFB(0x54, 0x16, 0); }
    else { this.attr(0x47); this.r_BAFB(0x55, 0x16, 0); }
    this.onEvent({ type: 'spellresult', ok: !!this.m[V.SUCCESS] });
    await this.halt(100);
  },

  // $9760: casting roll used by the handlers
  r_9760() {
    const m = this.m;
    if (!m[V.ILLUSION]) {
      const r = this.r_BE94();
      if (!M(r, u8(m[V.CHANCE] + 1))) { m[V.SUCCESS] = 0; return; }
    }
    m[V.SUCCESS] = 1;
    m[V.BALANCE] = u8(m[V.BALANCE] + m[V.SPELLALIGN]);
  },

  // $9786: is ($AC12) within range of ($AC14) for spell IX? (JP M = out of range)
  r_9786() {
    this.distance(this.rw(V.P14), this.rw(V.P12));
    return P(this.m[this.ix + 2], this.m[0xBEE8]);
  },

  // $97D1: find the current wizard; sets $AC14/$AC12/$C649 and the cursor
  r_97D1() {
    const m = this.m, p = m[V.PLAYER];
    let a = BOARD, n = 0x9F;
    while (n--) {
      if (u8(m[a] - 0x29) === p) break;
      if (u8(m[a + L4] - 0x29) === p) break;
      a++;
    }
    this.ww(0x97CF, a);
    this.ww(V.P14, a); this.ww(V.P12, a); this.ww(0xC649, a);
    this.ww(V.CURSOR, this.r_C703(a));
  },

  // $980E: Z (true) if ($AC12) is in the unused 16th column
  r_980E() { return (this.r_C703(this.rw(V.P12)) & 0xFF) === 0x10; },

  // ---- $9168: spell selection for each human wizard -------------------------
  async r_9168() {
    const m = this.m;
    m.fill(0, 0x9156, 0x9166);
    this.ww(0x5C7B, 0x7F27);
    m[V.PLAYER] = 0;
    this.ei = false;
    for (let w = 0; w < m[V.NWIZ]; w++) {
      if (!(m[V.WFLAGS + m[V.PLAYER]] & 0x10) && !this.r_95B8()) {
        this.onEvent({ type: 'turn', phase: 'menu', seat: m[V.PLAYER] });
        await this.menu();
      }
      m[V.PLAYER] = u8(m[V.PLAYER] + 1);
    }
    await this.r_95C7();
  },

  async menu() {
    const m = this.m;
    for (;;) {
      // $919C
      await this.r_C2F9(0xC2E3);
      await this.r_BBCC();
      this.r_C5EE();
      this.attr(0x72); this.r_BB57();
      const bal = m[V.BALANCE];
      if (bal !== 0) {
        let c;
        if (!(bal & 0x80)) {
          this.attr(0x46);
          c = this.r_BAFB(0x47, 0x07, 0x07);
          const n = (s8(bal) >> 2) & 0xFF;
          for (let i = 0; i < n; i++) c = this.r_BAD6(0x5E, 0x07, c);
          this.r_BAD6(0x29, 0x07, c);
        } else {
          this.attr(0x45);
          c = this.r_BAFB(0x46, 0x07, 0x07);
          const n = (s8(u8(-bal)) >> 2) & 0xFF;
          for (let i = 0; i < n; i++) c = this.r_BAD6(0x2A, 0x07, c);
          this.r_BAD6(0x29, 0x07, c);
        }
      }
      this.attr(0x46); this.r_BAFB(u8(m[V.PLAYER] + 0x29), 0x05, 0x07);
      this.attr(0x45);
      this.r_BAFB(0x59, 0x09, 0x07);
      this.r_BAFB(0x5A, 0x0B, 0x07);
      this.r_BAFB(0x5B, 0x0D, 0x07);
      this.r_BAFB(0x5C, 0x0F, 0x07);
      this.attr(0x56); this.r_BAFB(0x57, 0x16, 0x00);
      this.r_92AA();
      for (;;) {
        const k = await this.key();
        m[0x9384] = 0;
        if (k === 0x31) { await this.r_9385(); break; }
        if (k === 0x34) return;
        if (k === 0x33) { await this.r_92BE(); break; }
        if (k === 0x32) { m[0x9384] = 1; await this.r_9385(); break; }
      }
    }
  },

  // $92BE: examine board
  async r_92BE() {
    const m = this.m;
    this.r_C5EE();
    this.r_FE56();
    m[0x5C8D] = 0; m[0x5C8E] = 0xFF;
    this.r_C0DD();
    this.ei = true;
    await this.halt();
    m[0x5C91] = 3;
    await this.r_BBCC();
    for (;;) {
      const k = await this.r_BC96();
      if (k === 0x30) break;
      if (k === 0x49) await this.r_C3B3();
    }
    this.ei = false;
    this.ww(0x5C7B, 0x7F27);
    this.r_C5EE();
  },

  // $9385: list the current wizard's spells; select or examine one
  async r_9385() {
    const m = this.m;
    for (;;) {
      await this.r_C2F9(0xC2E3);
      this.r_C5EE();
      this.attr(0x46);
      let c = this.r_BAFB(u8(m[V.PLAYER] + 0x29), 0, 0);
      this.r_BAFB(0x53, 0, c);
      m[0x937E] = 0x40;
      m[0x937C] = 0x10; m[0x937D] = 0;
      let lp = this.rw(V.LISTPTR);
      for (let i = 0; i < 0x14; i++, lp += 2) {
        if (m[lp] === 0) continue;
        m[0x937C] = u8(0x10 - m[0x937C]);
        if (m[0x937C] === 0) m[0x937D] = u8(m[0x937D] + 2);
        m[V.SPELL] = m[lp];
        const ix = this.r_92F9();
        this.attr(u8(((m[V.CHANCE] + 1) >> 1) + 0x42));
        m[0x937E] = u8(m[0x937E] + 1);
        const b = m[0x937D];
        let cc = this.r_BAD6(m[0x937E], b, m[0x937C]);
        const al = m[V.SPELLALIGN];
        cc = this.r_BAD6(al === 0 ? 0x2D : (al & 0x80 ? 0x2A : 0x5E), b, cc);
        this.r_BAFB(m[ix], b, cc);
      }
      this.attr(0x46); this.r_BAFB(0x58, 0x16, 0);
      await this.r_BBCC();
      let k;
      for (;;) {
        k = await this.key();
        if (k === 0x30) return;
        const a = u8(k - 1);
        if (P(a, m[0x937E])) continue;
        if (M(a, 0x3F)) continue;
        break;
      }
      let n = u8(k - 0x40) || 256;
      let h = this.rw(V.LISTPTR) - 2;
      while (n--) { do { h += 2; } while (m[h & 0xFFFF] === 0); }
      m[V.SPELL] = m[h];
      if (m[0x9384] === 0) { await this.r_94A7(); continue; }
      const id = m[V.SPELL];
      m[0x9156 + m[V.PLAYER]] = id;
      if (!this.isTroll(id) && (M(id, 2) || P(id, 0x22))) return;
      this.r_BED7();
      this.attr(0x47); this.r_BAFB(0x5E, 0x16, 0);
      await this.r_BBCC();
      for (;;) {
        const y = await this.key();
        if (y === 0x4E) return;
        if (y === 0x59) { m[0x915E + m[V.PLAYER]] = 1; return; }
      }
    }
  },

  // $94A7: information about spell ($937B)
  async r_94A7() {
    const m = this.m;
    const ix = this.r_92F9();
    const id = m[V.SPELL];
    if (id !== 1 && M(id, 0x22)) {
      const sq = 0xE0BE;
      m[sq] = id;
      this.ww(V.P12, sq);
      m[sq + L4] = 0;
      m[0xC39E] = 3;
      m[0xFFFF] = m[V.CHANCE];
      await this.r_C3B3();
      m[0xC39E] = 0;
      m[sq] = 0;
      this.ww(V.P12, BOARD);
      return;
    }
    this.r_C5EE();
    await this.r_C2F9(0xC2E3);
    this.attr(0x69); this.r_BB57();
    this.attr(0x46); this.r_BAFB(m[ix], 0x05, 0x08);
    const al = m[V.SPELLALIGN];
    if (al !== 0) {
      let c;
      if (al & 0x80) {
        this.attr(0x43);
        c = this.r_BAFB(0x46, 0x07, 0x08);
        c = this.r_BAD6(u8(-al + 0x30), 0x07, c);
      } else {
        this.attr(0x45);
        c = this.r_BAFB(0x47, 0x07, 0x08);
        c = this.r_BAD6(u8(al + 0x30), 0x07, c);
      }
      this.r_BAD6(0x29, 0x07, c);
    }
    this.attr(0x44);
    let c = this.r_BAFB(0x4F, 0x0B, 0x08);
    this.attr(0x46);
    const ch = u8(m[V.CHANCE] + 1);
    if (ch === 0x0A) c = this.r_BAFB(0x50, 0x0B, c);
    else c = this.r_BAD6(u8(ch + 0x30), 0x0B, c);
    c = this.r_BAD6(0x30, 0x0B, c);
    this.r_BAD6(0x25, 0x0B, c);
    this.attr(0x44);
    c = this.r_BAFB(0x4A, 0x0F, 0x08);
    this.attr(0x46);
    const r = m[ix + 2] >> 1;
    if (P(r, 0x0A)) { c = this.r_BAD6(0x32, 0x0F, c); this.r_BAD6(0x30, 0x0F, c); }
    else this.r_BAD6(u8(r + 0x30), 0x0F, c);
    this.attr(0x4D); this.r_BAFB(0x3D, 0x16, 0);
    await this.r_BBCC();
    await this.r_BBB0();
  },

  // ---- $95C7: casting phase ---------------------------------------------------
  async r_95C7() {
    const m = this.m;
    this.r_C5EE();
    this.r_FE56();
    this.r_C0DD();
    await this.halt(2);
    m[V.PLAYER] = 0;
    do {
      const p = m[V.PLAYER];
      if (m[V.WFLAGS + p] & 0x10) this.r_BED7();
      else {
        this.r_97D1();
        this.onEvent({ type: 'turn', phase: 'cast', seat: p });
        if (this.r_95B8()) { await this.r_96F3(); }
        else {
          m[V.SPELL] = m[0x9156 + p];
          if (m[V.SPELL] !== 0) {
            let h = this.r_92AA();
            if (m[V.SPELL] !== 1) {
              for (let b = 0x13; b > 0; b--) {
                if (m[h] === m[V.SPELL]) { m[h] = 0; break; }
                h += 2;
              }
            }
            this.r_92F9();
            await this.r_967A();
            await this.r_BBB0();
            this.r_BED7();
            m[V.ILLUSION] = m[0x915E + p];
            if (m[V.ILLUSION] || M(this.r_BE94(), u8(m[V.CHANCE] + 1))) {
              m[V.SUCCESS] = 1;
              m[V.BALANCE] = u8(m[V.BALANCE] + m[V.SPELLALIGN]);
            } else m[V.SUCCESS] = 0;
            await this.callSpell(this.rw(this.ix + 5));
          }
          this.r_BED7();
        }
      }
      // $9668
      this.r_7D04();
      m[V.PLAYER] = u8(m[V.PLAYER] + 1);
    } while (m[V.PLAYER] !== m[V.NWIZ]);
  },

  async callSpell(addr) {
    const f = this['r_' + addr.toString(16).toUpperCase().padStart(4, '0')];
    if (!f) throw new Error('No spell handler for ' + addr.toString(16));
    await f.call(this);
  },

  // $7D04: after round 6, flag wizards that have no creatures of their own
  r_7D04() {
    const m = this.m, p = m[V.PLAYER];
    if (M(m[V.ROUND], 6)) return;
    for (let i = 0; i < 0x9F; i++) {
      const a = BOARD + i, id = m[a];
      this.ww(V.P12, a);
      if (!this.isTroll(id) && (M(id, 2) || P(id, 0x22))) continue;
      if (u8(m[a + L4] - 0x29) === p) continue;
      if ((m[a + L3] & 7) === p) { m[V.AIFLAG + p] = 0; return; }
    }
    this.ww(V.P12, BOARD + 0x9F);
    m[V.AIFLAG + p] = 0x14;
  },

  // $967A: "<wizard> <spell> <range>" on the message line
  async r_967A() {
    const m = this.m, ix = this.ix;
    this.attr(0x46);
    let c = this.r_BAFB(u8(m[V.PLAYER] + 0x29), 0x16, 0);
    c = await this.r_96D1(c);
    this.attr(0x44);
    c = this.r_BAFB(m[ix], 0x16, c);
    c = await this.r_96D1(c);
    this.attr(0x47);
    c = u8(c + 1);
    const r = m[ix + 2] >> 1;
    if (P(r, 0x0A)) { c = this.r_BAD6(0x32, 0x16, c); c = u8(c + 1); this.r_BAD6(0x30, 0x16, c); c = u8(c + 1); }
    else c = this.r_BAD6(u8(r + 0x30), 0x16, c);
    c = await this.r_96D1(c);
    if (m[V.ISCPU]) for (let i = 0; i < 8; i++) await this.r_96E6();
  },
  async r_96D1(c) {
    await this.r_C2F9(0x9117);
    this.ei = true;
    await this.delayT(255 * 816);
    return u8(c + 1);
  },

  // ---- $96F3: a computer wizard chooses and casts a spell ---------------------
  async r_96F3() {
    const m = this.m;
    if (m[V.WFLAGS + m[V.PLAYER]] & 0x10) return;
    this.r_92AA();
    const lp0 = this.rw(V.LISTPTR) - 1;
    m[lp0] = u8(this.r_904B() + 0x0C);
    this.sortList(0x13, lp0);
    let lp = this.r_92AA();
    for (let b = 0x14; b > 0; b--) {
      m[V.VALID] = 1;
      if (m[lp] !== 0) {
        m[V.SPELL] = m[lp];
        const ix = this.r_92F9();
        this.ww(V.LISTPTR, lp);
        await this.callSpell(this.rw(ix + 5));
        this.r_BED7();
        if (m[V.VALID]) {
          if (m[V.SPELL] !== 1) m[this.rw(V.LISTPTR)] = 0;
          return;
        }
      }
      lp += 2;
      this.ww(V.LISTPTR, lp);
    }
  },

  // $C64C: bubble sort A entries of [key, value] at HL, largest key first
  sortList(n, hl) {
    const m = this.m;
    n = n || 256;
    for (let pass = 0; pass < n; pass++) {
      let h = hl;
      for (let j = 0; j < n; j++) {
        const e0 = m[h], d0 = m[h + 1], c1 = m[h + 2], b1 = m[h + 3];
        if (c1 > e0) { m[h + 3] = d0; m[h + 2] = e0; m[h + 1] = b1; m[h] = c1; }
        h += 2;
      }
    }
  },
  r_C64C(a, hl) { this.sortList(a & 0xFF, hl); },

  // ---- targeting -----------------------------------------------------------------
  // $981A: human chooses up to ($97CE) target squares for the current spell
  async r_981A() {
    const m = this.m;
    this.r_BED7();
    this.r_97D1();
    this.r_FE56();
    m[0x5C8D] = 0; m[0x5C8E] = 0xFF;
    this.r_C0DD();
    this.ei = true;
    await this.halt();
    m[0x5C91] = 3;
    this.r_BED7();
    let b = m[0x97CE];
    for (;;) {
      // $983F
      let k;
      for (;;) {
        k = await this.castKey();
        if (k === 0x4B) { await this.r_C2F9(0xC2B1); this.ei = true; return; }
        if (k !== 0x53) continue;
        await this.r_BBCC();
        if (!this.r_9786()) {
          this.r_BED7();
          this.attr(0x45); this.r_BAFB(0x35, 0x16, 0);
          await this.r_BBCC(); await this.r_BBB0();
          continue;
        }
        const t = this.rw(V.P12);
        if (m[t] !== 0) {
          if (P(m[V.SPELL], 0x24)) continue;
          if (m[t + L2] !== 4) continue;
        }
        if (this.r_98F1()) continue;
        if (this.r_9C0F()) continue;
        if (await this.r_98DB()) {
          this.attr(0x45);
          this.r_BED7();
          this.r_BAFB(0x3C, 0x16, 0);
          await this.r_BBCC(); await this.r_BBB0();
          continue;
        }
        break;
      }
      await this.r_A18A();
      if (!m[V.SUCCESS]) { await this.r_97A3(); return; }
      await this.r_9941();
      if (b === 1) await this.r_97A3();
      b = u8(b - 1);
      if (b === 0) return;
    }
  },

  // $98DB: line of sight from ($AC14) to ($AC12); true if blocked
  async r_98DB() {
    const m = this.m;
    m[0xB754] = 0;
    m[0xB60B] = 0;
    this.r_BA77();
    const blocked = this.lineOfSight();
    m[0xB754] = blocked ? 1 : 0;
    this.r_C0DD();
    await this.halt();
    return blocked;
  },

  // $98F1: trees may not be placed next to other trees
  r_98F1() {
    const m = this.m;
    m[0x9940] = 0;
    const s = m[V.SPELL];
    if (M(s, 0x24) || P(s, 0x26)) return false;
    this.ww(0xCD3A, 0xCD2A);
    const save = this.rw(V.P14);
    this.ww(0xC78B, save);
    for (let i = 0; i < 8; i++) {
      this.ww(V.P14, this.rw(V.P12));
      this.r_CD3C();
      const h = this.rw(V.P14);
      if (isNull(h)) continue;
      const id = m[h];
      if (M(id, 0x24) || P(id, 0x26)) continue;
      m[0x9940] = 1;
    }
    this.ww(V.P14, this.rw(0xC78B));
    return m[0x9940] !== 0;
  },

  // $9C0F: a wall may not be placed next to its caster
  r_9C0F() {
    const m = this.m;
    m[0x9C0E] = 0;
    if (m[V.SPELL] !== 0x28) return false;
    this.ww(0xCD3A, 0xCD2A);
    this.ww(0xC78B, this.rw(V.P14));
    for (let i = 0; i < 8; i++) {
      this.ww(V.P14, this.rw(V.P12));
      this.r_CD3C();
      const h = this.rw(V.P14);
      if (isNull(h)) continue;
      const w = u8(m[h] - 0x29);
      if (w & 0x80) continue;
      if (w === m[V.PLAYER]) m[0x9C0E] = 1;
    }
    this.ww(V.P14, this.rw(0xC78B));
    return m[0x9C0E] !== 0;
  },

  // $CD3C: ($AC14) = neighbour of ($AC14) in direction ($CD3A), or 0
  r_CD3C() {
    const m = this.m;
    const yx = this.r_C703(this.rw(V.P14));
    let d = yx >> 8, e = yx & 0xFF;
    const dp = this.rw(0xCD3A);
    let ok = true;
    const nd = u8(m[dp] + d);
    if (nd === 0 || nd === 0x0B) ok = false;
    let ne = 0;
    if (ok) { ne = u8(m[dp + 1] + e); if (ne === 0 || ne === 0x10) ok = false; }
    if (ok) this.ww(V.P14, BOARD + u8(u8(ne - 1) + ((nd - 1) << 4)));
    else this.ww(V.P14, 0);
    this.ww(0xCD3A, dp + 2);
  },

  // $9941: put the spell's creature/object on ($AC12)
  async r_9941() {
    const m = this.m, t = this.rw(V.P12), s = m[V.SPELL];
    if (s !== 0x22 && s !== 0x23) m[t + L5] = m[t];
    m[t] = s;
    m[t + L1] = 1;
    m[t + L2] = 0;
    m[t + L3] = m[V.PLAYER] | (m[V.ILLUSION] ? 0x10 : 0);
    await this.halt();
  },

  // ---- $9975: creature spells (also Gooey Blob and Magic Fire) --------------
  async r_9975() {
    const m = this.m;
    m[0x97CE] = 1;
    if (!m[V.ISCPU]) { await this.r_981A(); return; }
    this.r_C78D();
    m[0xAC03] = P(m[V.SPELL], 0x22) ? 0x0D : 0x03;
    this.r_C955();
    for (;;) {
      const k = this.r_C9DC();
      if (k === 0x4B) { m[V.VALID] = 0; return; }
      if (this.r_980E()) continue;
      if (await this.r_98DB()) continue;
      const t = this.rw(V.P12);
      if (m[t] !== 0 && m[t + L2] !== 4) continue;
      break;
    }
    await this.r_967A();
    await this.r_A18A();
    if (M(m[V.SPELL], 0x22) && M(this.r_BE94(), 2)) m[V.ILLUSION] = 1;
    this.r_9760();
    if (m[V.SUCCESS]) await this.r_9941();
    m[V.ILLUSION] = 0;
    await this.r_97A3();
  },

  // ---- $99F1: Disbelieve ------------------------------------------------------
  async r_99F1() {
    const m = this.m;
    if (m[V.ISCPU]) { await this.r_9A95(); return; }
    for (;;) {
      const k = await this.r_BC96();
      if (k === 0x4B) { await this.r_C2F9(0xC2B1); this.ei = true; return; }
      if (k !== 0x53) continue;
      await this.r_BBCC();
      const id = m[this.rw(V.P12)];
      if (id === 0 || P(id, 0x22)) continue;
      await this.r_9A21();
      return;
    }
  },
  async r_9A21() {
    const m = this.m;
    await this.r_A18A();
    const t = this.rw(V.P12);
    m[V.SUCCESS] = 0;
    if (m[t + L3] & 0x10) {
      m[t] = m[t + L4];
      await this.r_9A52();
      m[V.SUCCESS] = 1;
    }
    await this.r_97A3();
    m[t + L3] |= 0x20;
  },
  // $9A52: explosion on ($AC12)
  async r_9A52() {
    const m = this.m;
    this.ww(0xC2F3, 0x9121);
    await this.r_C2F6();
    this.attr(0x46);
    let fr = 0xA345;
    const { h, l } = this.r_E007(this.rw(V.P12));
    this.ei = false;
    for (let i = 0; i < 7; i++) {
      this.sprite(fr, h, l);
      await this.r_C301();
      fr += 0x20;
    }
    this.r_C0DD();
    this.ei = true;
    await this.halt();
  },
  async r_9A95() {
    const m = this.m;
    this.ww(0xC78B, this.rw(V.P14));
    this.r_C7BC();
    this.ww(V.P14, this.rw(0xC78B));
    this.ww(V.CD86, 0xD3F2);
    this.sortList(u8(m[0xC7BB] + 1), 0xD3F2);
    for (;;) {
      const a = this.r_A17E();
      if (a === 0xFF) { m[V.VALID] = 0; return; }
      const t = BOARD + a;
      this.ww(V.P12, t);
      if (P(m[t], 0x22)) continue;
      if (m[t + L3] & 0x20) continue;
      await this.r_967A();
      await this.r_9A21();
      return;
    }
  },
  // $A17E: next square index from the sorted target list
  r_A17E() {
    const h = this.rw(V.CD86) + 1;
    const a = this.m[h];
    this.ww(V.CD86, h + 1);
    return a;
  },

  // ---- $9ADD: Magic Wood, Shadow Wood, Magic Castle, Dark Citadel ------------
  async r_9ADD() {
    const m = this.m;
    m[0x97CE] = P(m[V.SPELL], 0x26) ? 1 : 8;
    if (!m[V.ISCPU]) {
      if (m[V.SPELL] !== 0x24) { await this.r_981A(); return; }
    } else {
      if (P(m[V.SPELL], 0x26)) {
        const here = m[this.rw(V.P12)];
        if (P(here, 0x26) && M(here, 0x28)) { m[V.VALID] = 0; return; }
      }
      await this.r_967A();
    }
    // $9B1F: automatic placement around the caster
    this.ww(0xC8B7, this.rw(V.P14));
    m[0xAC03] = 0x0D;
    this.r_9760();
    let b = m[0x97CE];
    while (b > 0) {
      this.r_C955();
      let k;
      for (;;) {
        k = this.r_C9DC();
        if (k === 0x4B) return;
        if (this.r_980E()) continue;
        if (m[this.rw(V.P12)] !== 0) continue;
        if (this.r_98F1()) continue;
        if (await this.r_98DB()) continue;
        break;
      }
      await this.r_A18A();
      if (!m[V.SUCCESS]) { await this.r_97A3(); return; }
      const t = this.rw(V.P12);
      m[t] = m[V.SPELL];
      m[t + L3] = m[V.PLAYER];
      this.r_C0DD();
      b--;
    }
  },

  // ---- $9B76: Wall ----------------------------------------------------------------
  async r_9B76() {
    const m = this.m;
    m[0x97CE] = 4;
    if (!m[V.ISCPU]) { await this.r_981A(); return; }
    m[0xAC03] = 9;
    this.ww(0xC78B, this.rw(V.P14));
    this.r_C7BC();
    this.ww(V.P14, this.rw(0xC78B));
    this.ww(V.CD86, 0xD3F2);
    this.sortList(u8(m[0xC7BB] + 1), 0xD3F2);
    for (;;) {
      const a = this.r_A17E();
      if (a === 0xFF) { m[V.VALID] = 0; return; }
      const t = BOARD + a;
      this.ww(V.P12, t); this.ww(0xC8B7, t);
      const id = m[t];
      if (!P(id, 0x1E) && !M(id, 0x13)) continue;
      break;
    }
    this.r_9760();
    await this.r_967A();
    for (let b = 4; b > 0; b--) {
      this.r_C955();
      let k, placed = false;
      for (;;) {
        k = this.r_C9DC();
        if (k === 0x4B) break;
        if (this.r_980E()) continue;
        if (m[this.rw(V.P12)] !== 0) continue;
        if (this.r_9C0F()) continue;
        if (await this.r_98DB()) continue;
        placed = true;
        break;
      }
      if (!placed) continue;
      await this.r_A18A();
      if (!m[V.SUCCESS]) { await this.r_97A3(); return; }
      await this.r_9941();
    }
    await this.r_97A3();
  },

  // ---- $9C59: Magic Bolt and Lightning ----------------------------------------
  async r_9C59() {
    const m = this.m;
    if (m[V.ISCPU]) { await this.r_9D8A(); return; }
    for (;;) {
      const k = await this.castKey();
      if (k === 0x4B) { await this.r_C2F9(0xC2B1); this.ei = true; return; }
      if (k !== 0x53) continue;
      const t = this.rw(V.P12);
      if (m[t] === 0) continue;
      if (t === this.rw(V.P14)) continue;
      if (!this.r_9786()) {
        this.r_BED7();
        this.attr(0x45); this.r_BAFB(0x35, 0x16, 0);
        await this.r_BBCC(); await this.r_BBB0();
        continue;
      }
      if (await this.r_98DB()) continue;
      await this.r_9CA9();
      return;
    }
  },
  async r_9CA9() {
    const m = this.m;
    m[0xB60B] = 5;
    this.ww(0xC2F3, 0xC275);
    if (P(m[V.SPELL], 0x2B)) { this.ww(0xC2F3, 0x912B); m[0xB60B] = 6; }
    await this.r_C2F6();
    await this.r_B626();
    this.r_C0DD();
    this.ww(0xC2F3, 0xC29D);
    await this.r_C2F6();
    const t = this.rw(V.P12);
    const { h, l } = this.r_E007(t);
    this.attr(0x47);
    let fr = 0xBFB7;
    for (let i = 0; i < 9; i++) { this.sprite(fr, h, l); await this.r_C301(); fr += 0x20; }
    this.r_C0DD();
    const id = m[t];
    if (id === 0x23 || id === 0x28 || id === 0x27 || id === 0x26) { this.r_C0DD(); return; }
    let def = this.r_BE0A(id, 0x10);
    if (!M(id, 0x29)) {
      const f = m[V.WFLAGS + u8(id - 0x29)] & 0xC0;
      if (f) def = u8(def + ((((f << 2) | (f >> 6)) & 0xFF) + 1));
    }
    def = u8(def + this.r_BE94());
    m[V.SCRATCH] = def;
    let e = u8(this.r_BE94() + 3);
    if (P(m[V.SPELL], 0x2B)) e = u8(e + 3);
    if (M(e, def)) { this.r_C0DD(); return; }
    await this.r_9A52();
    if (P(m[t], 0x29)) { await this.r_B3C9(); this.r_C0DD(); return; }
    this.blank(t);
    const rider = m[t + L4];
    if (rider) { m[t + L4] = 0; m[t] = rider; }
    this.r_C0DD();
  },
  async r_9D8A() {
    const m = this.m;
    this.ww(0xC649, this.rw(V.P14)); this.ww(0xC78B, this.rw(V.P14));
    this.r_CC56();
    for (;;) {
      const a = m[this.rw(V.CD86)];
      if (a === 0xFF) { m[V.VALID] = 0; return; }
      const t = BOARD + a;
      this.ww(V.P12, t);
      const id = m[t];
      let ok = id === 0x25 || P(id, 0x29) || M(id, 0x23);
      if (ok && !this.r_9786()) ok = false;
      if (ok && await this.r_98DB()) ok = false;
      if (ok) break;
      this.ww(V.CD86, this.rw(V.CD86) + 2);
    }
    await this.r_967A();
    await this.r_9CA9();
  },

  // ---- $9DE0: Vengeance, Decree, Dark Power, Justice ---------------------------
  async r_9DE0() {
    const m = this.m;
    if (m[V.ISCPU]) { await this.r_9EF9(); return; }
    this.r_9760();
    if (!m[V.SUCCESS]) { await this.r_97A3(); return; }
    this.r_BED7();
    let b = P(m[V.SPELL], 0x2F) ? 3 : 1;
    while (b > 0) {
      for (;;) {
        const k = await this.r_BC96();
        if (k === 0x4B) { await this.r_C2F9(0xC2B1); this.ei = true; return; }
        if (k !== 0x53) continue;
        const id = m[this.rw(V.P12)];
        if (id === 0) continue;
        if (M(id, 0x29) && P(id, 0x22)) continue;
        break;
      }
      await this.r_9E38();
      b--;
    }
  },
  async r_9E38() {
    const m = this.m, spec = this.spec;
    this.ww(0xC2F3, 0x9135);
    this.r_C0DD();
    await this.halt();
    this.ei = false;
    this.ww(0x5C36, 0xD808);
    await this.r_C2F6();
    for (let i = 0; i < 3; i++) {
      for (let b = 7; b > 0; b--) {
        m[0x5C8D] = u8(b + 0x40);
        m[0x5C8E] = 0;
        const t = this.rw(V.P12);
        this.ww(V.CURSOR, this.r_C703(t));
        spec.chanOpenS();
        const bc = this.r_BC8D(this.rw(V.CURSOR));
        const bb = bc >> 8, cc = bc & 0xFF;
        spec.rst10(0x16); spec.rst10(bb); spec.rst10(cc); spec.rst10(0x20); spec.rst10(0x20);
        spec.rst10(0x16); spec.rst10(bb + 1); spec.rst10(cc); spec.rst10(0x20); spec.rst10(0x20);
        await this.r_C301();
      }
    }
    this.r_C0DD();
    await this.halt();
    m[0x5C8E] = 0xFF;
    const t = this.rw(V.P12);
    const res = this.r_BE0A(m[t], 0x13);
    if (M(this.r_BE94(), u8(res + 1))) { this.r_C0DD(); await this.halt(); return; }
    if (P(m[t], 0x29)) {
      await this.r_9A52();
      m[0xAC00] = u8(m[t] - 0x29);
      await this.r_B4FA();
      this.r_C0DD();
      await this.halt();
      return;
    }
    // $9ED3 (the corpse underneath comes back to life, as in the original)
    const rider = m[t + L4];
    if (rider) { m[t + L4] = 0; m[t] = rider; }
    else m[t] = m[t + L5];
    await this.r_9A52();
    this.r_C0DD();
    await this.halt();
  },
  async r_9EF9() {
    const m = this.m;
    await this.r_967A();
    this.r_9760();
    if (!m[V.SUCCESS]) { await this.r_97A3(); return; }
    let b = P(m[V.SPELL], 0x2F) ? 3 : 1;
    while (b > 0) {
      this.ww(0xC649, this.rw(V.P14)); this.ww(0xC78B, this.rw(V.P14));
      this.r_CC56();
      this.ww(V.CD86, 0xD3F2);
      let found = false;
      for (;;) {
        const a = this.r_A17E();
        if (a === 0xFF) return;
        const t = BOARD + a;
        this.ww(V.P12, t);
        const id = m[t];
        if (id === 0) continue;
        if (M(id, 0x29) && P(id, 0x22)) continue;
        found = true; break;
      }
      if (!found) return;
      await this.r_9E38();
      b--;
    }
  },

  // ---- $9F50: Gooey Blob and Magic Fire spread; castles may vanish ------------
  async r_9F50() {
    const m = this.m;
    this.ww(V.P12, BOARD);
    this.r_A173();
    for (let n = 0; n < 0x9F; n++) {
      await this.spreadOne();
      this.ww(V.P12, this.rw(V.P12) + 1);
    }
    // castles and citadels disappear
    this.ww(V.P12, BOARD);
    for (let n = 0; n < 0x9F; n++) {
      const t = this.rw(V.P12);
      const id = m[t];
      if (P(id, 0x26) && M(id, 0x28) && M(this.r_BE94(), 2)) {
        let w = m[t + L4];
        m[t + L4] = 0;
        if (w === 0) this.blank(t); else m[t] = w;
        await this.r_9A52();
        this.r_C0DD();
      }
      this.ww(V.P12, t + 1);
    }
    this.ww(V.P12, 0xE076); this.ww(V.P14, 0xE076);
    this.ww(V.CURSOR, this.r_C703(0xE076));
  },

  async spreadOne() {
    const m = this.m;
    const src = this.rw(V.P12);
    this.ww(V.P14, src);
    if (m[src + L3] & 0x80) return;
    const sid = m[src];
    if (M(sid, 0x22) || P(sid, 0x24)) return;
    m[V.PLAYER] = m[src + L3] & 7;
    let spread = false;
    if (P(this.r_BE94(), 9) || (m[src] !== 0x23 && P(this.r_BE94(), 8))) {
      // fall through to $A0C6
    } else {
      let dir;
      do { dir = this.r_BE94(); } while (P(dir, 8));
      this.ww(0xCD3A, 0xCD2A + dir * 2);
      this.r_CD3C();
      const t = this.rw(V.P14);
      if (isNull(t)) return;
      this.r_9786();
      if (P(m[0xBEE8], 4)) return;
      const res = await this.spreadInto(src, t);
      if (res === 'skip') return;
      spread = res === 'spread';
    }
    // $A0C6
    if (P(this.r_BE94(), 2)) return;
    if (m[this.rw(V.P14)] !== 0x23 && P(this.r_BE94(), 3)) return;
    // $A0DE: the blob/fire on src goes out
    const trapped = m[src + L4];
    if (trapped) {
      m[src + L4] = 0;
      m[src] = trapped;
      const owner = m[src + L5];
      m[src + L5] = 0;
      m[src + L3] = owner;
    } else {
      this.blank(src);
      m[src + L5] = 0;
    }
    this.r_C0DD();
    await this.r_C2F9(0x9149);
    this.ei = true;
    await this.halt();
  },

  // returns 'skip' ($A114), 'nospread' ($A0C6) or 'spread' (after $A09B)
  async spreadInto(src, t) {
    const m = this.m;
    const tid = m[t];
    let doSpread = false;
    if (tid === 0) doSpread = true;
    else if (P(tid, 0x29)) {
      if (!(await this.burnWizard(src, t, tid))) return 'skip';
      doSpread = true;
    } else if (P(tid, 0x26) || tid === 0x24) return 'nospread';
    else if (m[t + L2] === 4) doSpread = true;
    else if ((m[t + L3] & 7) === m[V.PLAYER]) return 'skip';
    else {
      if (!P(tid, 0x16) && !M(tid, 0x10) && P(m[t + L4], 0x29)) {
        if (!(await this.burnWizard(src, t, m[t + L4]))) return 'skip';
        doSpread = true;
      } else if (m[src] === 0x23) {
        // $A075: Magic Fire attacks the creature
        let d = this.r_BE0A(tid, 0x10);
        d = u8(d + this.r_BE94());
        m[V.SCRATCH] = d;
        if (P(u8(this.r_BE94() + 5), d)) return 'nospread';
        this.ww(0xC2F3, 0x913F);
        doSpread = true;
      } else {
        // Gooey Blob engulfs the creature
        if (P(tid, 0x23)) return 'nospread';
        if (m[t + L2] !== 4) {
          m[t + L4] = tid;
          m[t + L5] = m[t + L3] & 7;
        }
        doSpread = true;
      }
    }
    if (!doSpread) return 'nospread';
    // $A09B
    m[t] = m[src];
    m[t + L2] = 0;
    m[t + L3] = u8(m[V.PLAYER] + 0x80);
    m[(src + 0xA0) & 0xFFFF] |= 0x80;
    this.ww(V.P14, src);
    this.r_C0DD();
    await this.r_C2F6();
    this.ei = true;
    return 'spread';
  },

  // $A011: a wizard (or a wizard riding a mount) is caught by blob/fire
  async burnWizard(src, t, wid) {
    const m = this.m;
    if (u8(wid - 0x29) === m[V.PLAYER]) return false;
    const save = this.rw(V.P12);
    m[t + L4] = 0;
    this.ww(V.P12, t);
    m[t] = wid;
    this.r_C0DD();
    await this.r_B3C9();
    this.ww(V.P12, save);
    return true;
  },

  // $A173: clear the "has acted" bit of every square
  r_A173() { for (let i = 0; i < 0x9F; i++) this.m[0xE200 + i] &= 0x7F; },

  // $A18A: casting animation (beam from caster, then sparkle on target)
  async r_A18A() {
    const m = this.m;
    if (m[this.ix + 2] !== 0) {
      this.ww(0xC2F3, 0x912B);
      await this.r_C2F6();
      m[0xB60B] = 3;
      await this.r_B626();
      this.r_C0DD();
      await this.halt();
    }
    this.ei = false;
    this.attr(0x45);
    this.ww(0xC2F3, 0x910D);
    await this.r_C2F6();
    let tp = 0xA1E8;
    const { h, l } = this.r_E007(this.rw(V.P12));
    for (let i = 0; i < 0x12; i++) {
      this.sprite(this.rw(tp), h, l);
      tp += 2;
      await this.r_C301();
    }
    this.r_C0DD();
    this.ei = true;
    await this.halt();
  },

  // ---- wizard upgrade spells -----------------------------------------------------
  async r_8357() {
    if (this.m[V.ISCPU]) await this.r_967A();
    this.r_9760();
    this.r_97D1();
    await this.r_A18A();
  },
  async upgrade(cpuSkip, sprite, apply) {
    const m = this.m;
    const fa = V.WFLAGS + m[V.PLAYER];
    if (m[V.ISCPU] && cpuSkip(m[fa])) { m[V.VALID] = 0; return; }
    await this.r_8357();
    if (m[V.SUCCESS]) {
      this.ww(0x831F, sprite);
      this.r_8324();
      m[fa] = apply(m[fa]);
    }
    this.r_C0DD();
    await this.r_97A3();
  },
  async r_836A() { await this.upgrade(f => f & 0x80, 0x82A0, f => f | 0xC0); },          // Magic Armour
  async r_839C() { await this.upgrade(f => f & 0x04, 0x8290, f => (f & 0xFC) | 0x04); },  // Magic Sword
  async r_83D0() { await this.upgrade(f => f & 0x07, 0x8298, f => (f & 0xF8) | 0x02); },  // Magic Knife
  async r_8404() { await this.upgrade(f => f & 0x40, 0x82A8, f => (f & 0x7F) | 0x40); },  // Magic Shield
  async r_8438() { await this.upgrade(f => f & 0x20, 0x82B0, f => f | 0x20); },           // Magic Wings
  async r_846A() {                                                                          // Magic Bow
    const m = this.m;
    if (m[V.ISCPU]) {
      this.r_8300();
      if (m[this.rw(0x8321) - 9]) { m[V.VALID] = 0; return; }
    }
    await this.r_8357();
    if (m[V.SUCCESS]) {
      this.ww(0x831F, 0x82B8);
      this.r_8324();
      this.r_8300();
      const h = this.rw(0x8321) - 9;
      m[h] = 3; m[h + 1] = 6;
    }
    this.r_C0DD();
    await this.r_97A3();
  },
  async r_84B0() {                                                                          // Law / Chaos
    if (this.m[V.ISCPU]) await this.r_967A();
    this.r_9760();
    await this.r_97A3();
  },
  async r_84C0() {                                                                          // Shadow Form
    const m = this.m;
    const fa = V.WFLAGS + m[V.PLAYER];
    if (m[V.ISCPU] && (m[fa] & 0x08)) { m[V.VALID] = 0; return; }
    await this.r_8357();
    await this.r_97A3();
    if (!m[V.SUCCESS]) return;
    this.r_8300();
    const h = this.rw(0x8321);
    m[h + 5] = 0;
    m[h + 11] = 0;
    m[fa] |= 0x08;
  },

  // ---- Subversion ($84F7) --------------------------------------------------------
  async r_84F7() {
    const m = this.m;
    if (!m[V.ISCPU]) {
      this.r_BED7();
      m[0x5C91] = 3;
      for (;;) {
        const k = await this.castKey();
        if (k === 0x4B) { await this.r_C2F9(0xC2B1); this.ei = true; return; }
        if (k !== 0x53) continue;
        if (this.r_85EC()) continue;
        const id = m[this.rw(V.P12)];
        if (P(id, 0x22) || id === 0) continue;
        if (!this.r_9786()) continue;
        if (await this.r_98DB()) continue;
        await this.r_859C();
        return;
      }
    }
    this.ww(0xC78B, this.rw(V.P14));
    this.r_C7BC();
    this.ww(V.P14, this.rw(0xC78B));
    this.ww(V.CD86, 0xD3F2);
    this.sortList(u8(m[0xC7BB] + 1), 0xD3F2);
    for (;;) {
      const a = this.r_A17E();
      if (a === 0xFF) { m[V.VALID] = 0; await this.r_96E6(); return; }
      const t = BOARD + a;
      this.ww(V.P12, t);
      if (this.r_85EC()) continue;
      const id = m[t];
      if (P(id, 0x22) || id === 0) continue;
      if (!this.r_9786()) continue;
      if (await this.r_98DB()) continue;
      if (m[t + L3] & 0x20) continue;
      await this.r_859C();
      return;
    }
  },
  async r_859C() {
    const m = this.m;
    if (m[V.ISCPU]) await this.r_967A();
    await this.r_A18A();
    const t = this.rw(V.P12);
    let ok = false;
    if (!(m[t + L3] & 0x10)) {
      m[V.SCRATCH] = u8(this.r_BE0A(m[t], 0x13) + 1);
      ok = M(this.r_904B(), m[V.SCRATCH]);
    }
    if (ok) {
      m[t + L3] = u8((m[t + L3] & 0xF8) + m[V.PLAYER]);
      m[V.SUCCESS] = 1;
    } else m[V.SUCCESS] = 0;
    await this.r_97A3();
  },
  r_85EC() { return this.m[this.rw(V.P12) + L4] !== 0; },

  // ---- Raise Dead ($85F6) ---------------------------------------------------------
  async r_85F6() {
    const m = this.m;
    if (!m[V.ISCPU]) {
      this.r_BED7();
      m[0x5C91] = 3;
      for (;;) {
        const k = await this.castKey();
        if (k === 0x4B) { await this.r_C2F9(0xC2B1); this.ei = true; return; }
        if (k !== 0x53) continue;
        const t = this.rw(V.P12);
        if (m[t] === 0 || m[t + L2] !== 4) continue;
        if (!this.r_9786()) continue;
        if (await this.r_98DB()) continue;
        await this.r_86C3();
        return;
      }
    }
    this.ww(V.CD86, 0xD3F2);
    for (let i = 0; i < 0x9F; i++) {
      const a = BOARD + i;
      this.ww(V.P12, a);
      m[V.SCRATCH] = m[a];
      if (m[a + L2] !== 4) continue;
      const v = this.pieceValue(m[V.SCRATCH]);
      const h = this.rw(V.CD86);
      m[h] = v; m[h + 1] = i;
      this.ww(V.CD86, h + 2);
    }
    this.ww(V.P12, BOARD + 0x9F);
    this.ww(V.CD86, 0xD3F2);
    this.sortList(u8(m[0xC7BB] + 1), 0xD3F2);
    for (;;) {
      const a = this.r_A17E();
      if (a === 0xFF) { m[V.VALID] = 0; return; }
      const t = BOARD + a;
      this.ww(V.P12, t);
      if (m[t] === 0 || m[t + L2] !== 4) continue;
      if (!this.r_9786()) continue;
      if (await this.r_98DB()) continue;
      await this.r_967A();
      await this.r_86C3();
      return;
    }
  },
  async r_86C3() {
    const m = this.m;
    await this.r_A18A();
    this.r_9760();
    if (!m[V.SUCCESS]) return;
    const t = this.rw(V.P12);
    m[t + L2] = 0;
    m[t + L3] = u8(0x60 + m[V.PLAYER]);
    m[t + L5] = 0;
    this.r_C0DD();
    await this.r_97A3();
  },

  // ---- Turmoil ($86EF) ---------------------------------------------------------------
  async r_86EF() {
    const m = this.m;
    if (!m[V.ISCPU]) { await this.r_8741(); return; }
    this.ww(0xC78B, this.rw(V.P14));
    this.r_C7BC();
    this.ww(V.P14, this.rw(0xC78B));
    this.ww(V.CD86, 0xD3F2);
    this.sortList(u8(m[0xC7BB] + 1), 0xD3F2);
    m[V.SCRATCH] = 0;
    // The original does LD HL,($A172) (not LD HL,$A172), so it adds the ROM
    // byte at $2100 ($CD) instead of keeping a running total.
    for (;;) {
      const h = this.rw(V.CD86);
      const a = m[h];
      this.ww(V.CD86, h + 1);
      if (a === 0) { m[V.VALID] = 0; return; }
      if (!M(u8(a + 0xCD), 0x1E)) break;
    }
    await this.r_967A();
    await this.r_8741();
  },
  async r_8741() {
    const m = this.m;
    this.r_9760();
    if (!m[V.SUCCESS]) { await this.r_97A3(); return; }
    this.r_A173();
    for (let i = 0; i < 0x9F; i++) {
      const s = BOARD + i;
      this.ww(V.P14, s);
      if (m[s] === 0) continue;
      if (m[s + L3] & 0x80) continue;
      const id = m[s], f = m[s + L2], o = m[s + L3], u4 = m[s + L4], u5 = m[s + L5];
      // The squares below are the only ones the loop can pick. When they are
      // all taken it would never end (the original hangs then too, and far
      // sooner: its R-register numbers fall into short cycles), so the piece
      // stays where it is.
      if (!TURMOIL_SQUARES.some(i => m[BOARD + i] === 0)) continue;
      let t;
      for (;;) {
        const r = u8(this.r_904B() + m[0x907A]);
        if (P(r, 0x9F)) continue;
        t = BOARD + r;
        this.ww(V.P12, t);
        if (m[t] !== 0) continue;
        if (this.r_980E()) continue;
        break;
      }
      await this.r_A18A();
      m[t] = id; m[t + L2] = f; m[t + L3] = o | 0x80; m[t + L4] = u4; m[t + L5] = u5;
      m[s] = 0; m[s + L4] = 0; m[s + L5] = 0;
      this.r_C0DD();
      await this.halt(2);
    }
    this.ww(V.P14, BOARD + 0x9F);
    await this.r_97A3();
  },
};
