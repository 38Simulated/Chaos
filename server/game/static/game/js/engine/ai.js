// Computer wizards ($C63D-$CDD2). The AI works through scratch lists at $D3F2
// (entries of [value, square-or-key]) exactly as the original, including
// reading past the start of a list when it runs out of options.
import { BOARD, L2, L3, L4, V, M, P, u8, TROLL_VALUE } from './core.js';
import { isNull } from './spells.js';

export const AiMixin = {
  // $C63D: Z (true) if ($AC12) is in the unused 16th column
  r_C63D() { return (this.r_C703(this.rw(V.P12)) & 0xFF) === 0x10; },

  // $C67A: attraction of the enemy piece on ($AC12) as seen from ($AC14)
  // how much the computer values piece `id` ($C6D4, indexed from id 2)
  pieceValue(id) { return this.isTroll(id) ? TROLL_VALUE : this.m[0xC6D4 + u8(id - 2)]; },

  r_C67A() {
    const m = this.m, t = this.rw(V.P12);
    const id = m[t];
    if (id === 0) return 0;
    if (m[t + L2] === 4) return 0;
    if ((m[t + L3] & 7) === m[V.PLAYER]) return 0;
    m[0xC679] = this.pieceValue(id);
    const e = this.distance(t, this.rw(V.P14));
    const a = u8(u8(m[0xC679] + 4 + m[0xCC55]) - e);
    return (a & 0x80) ? 0 : a;
  },

  // $CDAA: clear the list ($9E entries of [0, $FF])
  r_CDAA() {
    const m = this.m;
    for (let i = 0; i < 0x9E; i++) { m[0xD3F2 + 2 * i] = 0; m[0xD3F3 + 2 * i] = 0xFF; }
  },
  pushEntry(v, idx) {
    const h = this.rw(V.CD86);
    this.m[h] = v; this.m[(h + 1) & 0xFFFF] = idx;
    this.ww(V.CD86, h + 2);
  },

  // $C7BC: enemy creatures worth targeting from the wizard ($C649)
  r_C7BC() {
    const m = this.m;
    this.ww(V.P14, this.rw(0xC649));
    this.ww(V.CD86, 0xD3F2);
    this.r_CDAA();
    this.ww(V.P12, BOARD);
    m[0xC7BB] = 0;
    for (let i = 0; i < 0x9F; i++) {
      const v = this.r_C67A();
      if (v) {
        m[0xC7BB] = u8(m[0xC7BB] + 1);
        const a = u8(v + 0x14);
        const d = this.distance(this.rw(0xC78B), this.rw(V.P12)) >> 1;
        this.pushEntry(u8(a - d), (this.rw(V.P12) - BOARD) & 0xFF);
      }
      this.ww(V.P12, this.rw(V.P12) + 1);
    }
  },

  // $C825: enemy wizards, scored by the strength of their armies
  r_C825() {
    const m = this.m;
    this.ww(V.CD86, 0xD3F2);
    this.r_CDAA();
    this.ww(V.P12, BOARD);
    for (let i = 0; i < 0x9F; i++) {
      const a = this.rw(V.P12);
      if (P(m[a], 0x29)) this.r_C859(m[a]);
      if (P(m[a + L4], 0x29)) this.r_C859(m[a + L4]);
      this.ww(V.P12, a + 1);
    }
  },
  r_C859(id) {
    const m = this.m;
    const w = u8(id - 0x29);
    m[0xC858] = w;
    if (w === m[V.PLAYER]) return;
    const h = this.rw(V.CD86);
    m[h + 1] = (this.rw(V.P12) - BOARD) & 0xFF;
    for (let i = 0; i < 0x9F; i++) {
      const c = m[BOARD + i];
      if (c === 0 || P(c, 0x26)) continue;
      if ((m[BOARD + i + L3] & 7) !== m[0xC858]) continue;
      // (two entries along the table, as in the original)
      m[h] = u8(m[h] + ((this.isTroll(c) ? TROLL_VALUE : m[0xC6D4 + c]) >> 2));
    }
    m[h] = u8(m[h] + m[0xCC55]);
    this.ww(V.CD86, h + 2);
  },

  // $C8B9: ($C8B7) = square of the best entry
  r_C8B9() { const a = BOARD + this.m[0xD3F3]; this.ww(0xC8B7, a); return a; },

  // $C78D: pick a target for a creature/creation and plan a step towards it
  r_C78D() {
    const m = this.m;
    this.ww(0xC78B, this.rw(V.P14));
    if (M(m[V.AIFLAG + m[V.PLAYER]], 0x0A)) { this.r_CA19(); return; }
    this.r_C7A3();
  },
  r_C7A3() {
    this.r_C825();
    this.sortList(7, 0xD3F2);
    this.r_C8B9();
    this.r_C7B1();
  },
  r_C7B1() {
    this.ww(V.P14, this.rw(0xC78B));
    this.r_C8C7();
  },
  r_CA19() {
    const m = this.m;
    this.r_C7BC();
    this.ww(V.P14, this.rw(0xC78B));
    if (m[0xD3F2] === 0) { this.r_C7A3(); return; }
    this.sortList(u8(m[0xC7BB] + 1), 0xD3F2);
    const tgt = this.r_C8B9();
    const e = m[tgt + L3] & 7;
    let w = -1;
    for (let i = 0; i < 0x9F; i++) {
      const a = BOARD + i;
      if (u8(m[a] - 0x29) === e || u8(m[a + L4] - 0x29) === e) { w = a; break; }
    }
    if (w < 0) { this.r_C7A3(); return; }
    this.ww(0xCA16, w);
    m[0xCA18] = this.r_CA7C(w);
    const dc = this.r_CA7C(this.rw(0xC8B7));
    if (!M(dc, m[0xCA18])) this.ww(0xC8B7, this.rw(0xCA16));
    this.r_C7B1();
  },
  // $CA7C: distance from HL to ($C78B)
  r_CA7C(hl) { return this.distance(hl, this.rw(0xC78B)); },

  // $C8C7: rank the 8 neighbouring steps by distance to the target ($C8B7)
  r_C8C7() {
    const m = this.m;
    this.r_CDAA();
    this.ww(V.CD86, 0xD3F2);
    this.ww(0xCD3A, 0xCD2A);
    this.ww(0xCD90, 0xCD88);
    this.ww(0xC78B, this.rw(V.P14));
    for (let i = 0; i < 8; i++) {
      this.r_CD3C();
      if ((this.rw(V.P14) & 0xFF) !== 0) {
        const d = this.distance(this.rw(0xC8B7), this.rw(V.P14));
        const h = this.rw(V.CD86);
        m[h] = d;
        m[h + 1] = m[this.rw(0xCD90)];
      }
      this.ww(0xCD90, this.rw(0xCD90) + 1);
      this.ww(V.CD86, this.rw(V.CD86) + 2);
      this.ww(V.P14, this.rw(0xC78B));
    }
    this.sortList(7, 0xD3F2);
    m[0xAC30] = 1;
    const s = this.rw(0xC78B);
    this.ww(V.P14, s); this.ww(V.P12, s);
    const yx = this.r_C703(s);
    this.ww(V.CURSOR, yx); this.ww(0xAC0A, yx);
    this.ww(V.CD86, 0xD401);
  },

  // $C955: squares within ($AC03) of ($AC14), ranked by distance to ($C8B7)
  r_C955() {
    const m = this.m;
    this.ww(V.P12, BOARD);
    this.ww(V.CD86, 0xD3F2);
    this.r_CDAA();
    this.ww(0xC78B, this.rw(V.P14));
    m[0xC7BB] = 1;
    for (let i = 0; i < 0x9F; i++) {
      const a = this.rw(V.P12);
      const d = this.r_CA7C(a);
      if (!M(m[0xAC03], d)) {
        const dt = this.distance(this.rw(0xC8B7), a);
        this.pushEntry(dt, (a - BOARD) & 0xFF);
        m[0xC7BB] = u8(m[0xC7BB] + 1);
      }
      this.ww(V.P12, a + 1);
    }
    this.sortList(m[0xC7BB], 0xD3F2);
    m[0xAC30] = 1;
    this.ww(V.CD86, 0xD4E5);
  },

  // $C9DC: next candidate square from the $C955 list ('S'), or 'K' when done
  r_C9DC() {
    const m = this.m;
    for (;;) {
      const h = this.rw(V.CD86);
      if (m[(h - 1) & 0xFFFF] === 0xFE) { m[0xAC32] = 0x4B; return 0x4B; }
      const a = m[h];
      if (a === 0xFF) { this.ww(V.CD86, h - 2); continue; }
      const t = BOARD + a;
      this.ww(V.P12, t);
      if (this.r_C63D()) { this.ww(V.CD86, h - 2); continue; }
      this.ww(V.CURSOR, this.r_C703(t));
      this.ww(V.CD86, h - 2);
      m[0xAC32] = 0x53;
      return 0x53;
    }
  },

  // $CA92: plan the wizard's own move (safest neighbour, or a flight)
  r_CA92() {
    const m = this.m;
    this.r_CDAA();
    for (let i = 0; i < 0x9F; i++) {
      const a = BOARD + i;
      let w = u8(m[a + L4] - 0x29);
      if (w & 0x80) {
        w = u8(m[a] - 0x29);
        if (w & 0x80) continue;
      }
      if (w === m[V.PLAYER]) this.ww(V.P14, a);
    }
    this.ww(0xCD3A, 0xCD2A);
    this.ww(V.CD86, 0xD3F2);
    this.ww(0xCD90, 0xCD88);
    const home = this.rw(V.P14);
    this.ww(0xC649, home);
    const id = m[home];
    if (!M(id, 0x13) && M(id, 0x16)) {
      this.r_CBB9(id);
      m[0xAC31] = 1;
      return this.r_CBA2();
    }
    if (P(id, 0x29) && (m[V.WFLAGS + u8(id - 0x29)] & 0x20)) {
      this.r_CBC7();
      m[0xAC31] = 1;
      return this.r_CBA2();
    }
    for (let i = 0; i < 8; i++) {
      this.r_CD3C();
      const n = this.rw(V.P14);
      if ((n & 0xFF) !== 0) {
        const h = this.rw(V.CD86);
        const nid = m[n];
        if (P(nid, 0x26) && M(nid, 0x28)) m[h] = 0;
        else if (nid === 0x24) m[h] = 1;
        else if (!M(nid, 0x10) && M(nid, 0x16) && (m[n + L3] & 7) === m[V.PLAYER] && m[n + L4] === 0) m[h] = 2;
        else { this.r_CD92(); m[h] = u8(m[h] + 3); }
        m[h + 1] = m[this.rw(0xCD90)];
        this.ww(V.CD86, h + 2);
      }
      this.ww(V.P14, this.rw(0xC649));
      this.ww(0xCD90, this.rw(0xCD90) + 1);
    }
    this.sortList(7, 0xD3F2);
    this.ww(V.P12, this.rw(0xC649)); this.ww(V.P14, this.rw(0xC649));
    this.ww(V.CD86, 0xD401);
    return this.r_CBA2();
  },
  r_CBA2() {
    const yx = this.r_C703(this.rw(0xC649));
    this.ww(V.CURSOR, yx); this.ww(0xAC0A, yx);
    this.m[0xAC30] = 1;
    return yx;
  },
  r_CBB9(id) {
    this.m[0xCBB8] = u8((this.r_BE0A(id, 0x11) << 1) + 1);
    this.r_CBCC();
  },
  r_CBC7() { this.m[0xCBB8] = 0x0D; this.r_CBCC(); },
  r_CBCC() {
    const m = this.m;
    this.r_CDAA();
    m[0xC7BB] = 1;
    this.ww(V.CD86, 0xD3F2);
    this.ww(0xC78B, this.rw(V.P14));
    this.ww(V.P14, BOARD);
    for (let i = 0; i < 0x9E; i++) {
      const a = this.rw(V.P14);
      if ((this.r_C703(a) & 0xFF) !== 0x10) {
        const d = this.distance(a, this.rw(0xC78B));
        if (!M(m[0xCBB8], d)) {
          this.r_CD92();
          const h = this.rw(V.CD86);
          m[h + 1] = (this.rw(V.P14) - BOARD) & 0xFF;
          this.ww(V.CD86, h + 2);
          m[0xC7BB] = u8(m[0xC7BB] + 1);
        }
      }
      this.ww(V.P14, this.rw(V.P14) + 1);
    }
    this.sortList(m[0xC7BB], 0xD3F2);
    let h = 0xD493;
    do { h -= 2; } while (m[h] === 0xFF);
    this.ww(0xC8B7, BOARD + m[h]);
    this.ww(V.P14, this.rw(0xC78B));
  },

  // $CD92: total attraction (danger) of all enemy pieces around ($AC14)
  r_CD92() {
    const m = this.m;
    for (let i = 0; i < 0x9E; i++) {
      this.ww(V.P12, BOARD + i);
      const v = this.r_C67A();
      const h = this.rw(V.CD86);
      m[h] = u8(m[h] + v);
    }
  },

  // $CC56: rank enemy wizards and creatures as targets for attack spells
  r_CC56() {
    const m = this.m;
    this.ww(0xC78B, this.rw(V.P14));
    m[0xCC55] = 0x3C;
    this.r_C825();
    m[0xCC55] = 0x20;
    this.ww(V.P14, this.rw(0xC649));
    this.ww(V.P12, BOARD);
    m[0xC7BB] = 9;
    for (let i = 0; i < 0x9E; i++) {
      const v = this.r_C67A();
      if (v) {
        this.pushEntry(v, (this.rw(V.P12) - BOARD) & 0xFF);
        m[0xC7BB] = u8(m[0xC7BB] + 1);
      }
      this.ww(V.P12, this.rw(V.P12) + 1);
    }
    this.sortList(m[0xC7BB], 0xD3F2);
    this.ww(V.CD86, 0xD3F3);
    this.ww(V.P14, this.rw(0xC78B));
    m[0xCC55] = 0;
  },

  // $CCCB: next ranged-attack target ('S') or give up ('K')
  r_CCCB() {
    const m = this.m;
    for (;;) {
      const h = this.rw(V.CD86);
      const a = m[h];
      if (a === 0xFF) return 0x4B;
      const t = BOARD + a;
      this.ww(V.P12, t);
      const id = m[t];
      let ok;
      if (P(id, 0x29)) ok = true;
      else if (id === 0x24) ok = m[t + L4] !== 0;
      else if (id === 0x25) ok = true;
      else ok = M(id, 0x23);
      if (ok && M(m[this.rw(V.P14)], 0x29) && !M(id, 0x1C) && M(id, 0x22)) ok = false;
      if (!ok) { this.ww(V.CD86, h + 2); continue; }
      this.ww(V.CURSOR, this.r_C703(t));
      this.ww(V.CD86, h + 2);
      return 0x53;
    }
  },

  // $CDC0: the AI's "key press" for $BBE7 - next entry, walking backwards
  r_CDC0() {
    const m = this.m;
    for (;;) {
      const h = this.rw(V.CD86);
      const a = m[h];
      this.ww(V.CD86, (h - 2) & 0xFFFF);
      if (a !== 0xFF) return a;
    }
  },

  // ---- $C710: a computer wizard's movement turn ------------------------------
  async r_C710() {
    const m = this.m;
    const p = m[V.PLAYER];
    if (m[V.AIFLAG + p] === 0) {
      this.r_CA92();
      const h = this.rw(0xC649);
      const id = m[h];
      if (id === 0x24 || id === 0x26 || id === 0x27) {
        m[0xAC31] = 1;
        m[h + L3] |= 0x80;
      } else {
        m[0xAC31] = 0;
        m[0xAC30] = 1;
        this.ww(V.P14, h); this.ww(V.P12, h);
        const yx = this.r_C703(h);
        this.ww(V.CURSOR, yx); this.ww(0xAC0A, yx);
        await this.r_ACED();
      }
    }
    // $C74E
    this.r_C0DD();
    m[0xAC31] = 1;
    await this.halt(3);
    for (let i = 0; i < 0x9F; i++) {
      const a = BOARD + i;
      this.ww(V.P12, a); this.ww(V.P14, a);
      const yx = this.r_C703(a);
      this.ww(V.CURSOR, yx); this.ww(0xAC0A, yx);
      await this.r_ACED();
    }
  },
};
