// Movement phase, melee/ranged combat and wizard death ($AC36-$BA75).
//
// $ACED returns the Z80 A register because its caller ($ACC6) compares the
// left-over value with '0' to decide whether the player's turn has ended.
import { BOARD, L1, L2, L3, L4, L5, V, M, P, u8, s8 } from './core.js';

export const MovementMixin = {
  // ---- $AC36: movement phase -----------------------------------------------------
  async r_AC36() {
    const m = this.m;
    for (let p = 0; p < m[V.NWIZ]; p++) {
      m[V.PLAYER] = p;
      m[0xD391] = p;
      if (m[V.WFLAGS + p] & 0x10) continue;
      m[V.ISCPU] = m[V.CPU + p] ? 1 : 0;
      this.attr(0x46);
      this.r_BED7();
      const c = this.r_BAFB(u8(p + 0x29), 0x16, 0);
      this.r_BAFB(0x37, 0x16, c);
      this.onEvent({ type: 'turn', phase: 'move', seat: p });
      this.r_C0DD();
      await this.halt(2);
      m[0xD391] = p;
      this.r_D392();
      await this.delayLoop(0xFF, 0xFF, 31);
      this.r_C0DD();
      await this.r_BBB0();
      if (m[V.ISCPU]) {
        await this.halt(0x3C);
        this.r_BED7();
        await this.r_C710();
      } else {
        this.r_BED7();
        await this.r_ACC6();
        await this.r_BBCC();
      }
    }
    m[0xAC33] = 0;
    this.r_FE60();
  },

  // $ACC6: a human player picks pieces to move until '0' is pressed
  async r_ACC6() {
    const m = this.m;
    for (;;) {
      this.ww(0x5C7B, 0xC33D);
      let a = await this.r_BC96();
      if (a === 0x53) a = await this.r_ACED();
      if (a === 0x30) break;
    }
    this.r_C0DD();
    await this.halt(2);
    this.r_BED7();
    await this.r_C2F9(0xC27F);
    this.ei = true;
  },

  // $BDE7 / $BDED: remember the selected square and load its contents
  r_BDE7() { this.ww(V.P14, this.rw(V.P12)); this.r_BDED(); },
  r_BDED() {
    const m = this.m, a = this.rw(V.P12);
    m[0xAC0C] = m[a];
    m[0xAC10] = m[a + L3];
    m[0xAC09] = m[a + L4];
    m[0xAC08] = m[a + L5];
  },

  // $ACED: move/attack with the piece on ($AC12). Returns A.
  async r_ACED() {
    const m = this.m;
    if (this.debug) this.debug('ACED', { sq: this.rw(V.P12).toString(16), id: m[this.rw(V.P12)], l3: m[this.rw(V.P12) + L3], l4: m[this.rw(V.P12) + L4], p: m[V.PLAYER], ac31: m[0xAC31] });
    const r = await this.r_ACED_();
    if (this.debug) this.debug('ACED ret', { r, sq: this.rw(V.P14).toString(16) });
    return r;
  },
  async r_ACED_() {
    const m = this.m;
    this.r_BDE7();
    m[0xAC11] = 0; m[0xB165] = 0; m[0xAC03] = 0; m[0xAC07] = 0; m[0xAC0D] = 0; m[0xABFC] = 0;
    const mover = m[0xAC0C];
    m[0xAC01] = u8(this.r_BE0A(mover, 0x11) << 1);
    if (!M(mover, 0x13) && M(mover, 0x1E)) m[0xAC03] = u8(m[0xAC01] + 1);
    {
      const w = u8(mover - 0x29);
      if (!(w & 0x80)) {
        const f = m[V.WFLAGS + w];
        if (f & 0x20) m[0xAC03] = 0x0D;
        else if (f & 0x08) { m[0xAC01] = 6; m[0xAC35] = 6; }
      }
    }
    // $AD4A
    if (m[0xAC10] & 0x80) return m[0xAC10];
    if (mover === 0) return 0;
    const p = m[V.PLAYER];
    let w = u8(mover - 0x29);
    if (!(w & 0x80)) {
      if (w !== p) return w;
      m[0xAC0D] = mover;
    } else {
      w = u8(m[0xAC09] - 0x29);
      let handled = false;
      if (!(w & 0x80)) {
        if (w !== p) return w;
        m[0xAC0D] = m[0xAC09];
        if (P(mover, 0x24)) handled = true;
        else {
          this.attr(0x46);
          let dismount = false;
          if (!m[V.ISCPU]) {
            this.r_BAFB(0x33, 0x16, 0);
            for (;;) {
              const k = await this.key();
              if (k === 0x59) { dismount = true; break; }
              if (k === 0x4E) break;
            }
          }
          if (dismount) { m[0xAC03] = 0; m[0xAC01] = 1; handled = true; }
          else m[0xAC0D] = 0;
        }
      }
      if (!handled) {
        // $ADB3
        if (mover !== 0x25 && P(mover, 0x22)) return mover;
        const o = m[0xAC10] & 7;
        if (o !== p) return o;
        if (m[this.rw(V.P12) + L2] === 4) return 4;
      }
    }
    // $ADD2
    this.r_BE21();
    if (m[0xAC06] && !m[0xAC09]) {
      const e = this.r_BE0A(m[0xAC0C], 0x12);
      if (!M(u8(this.r_BE94() + 2), e)) await this.r_BEB2();
    }
    if (m[0xAC33]) await this.r_BEB2();
    if (!m[0xAC07]) {
      this.r_BED7();
      this.attr(0x44);
      let c = this.r_BAFB(0x3A, 0x16, 0);
      this.attr(0x46);
      const who = m[0xAC0D] || m[0xAC0C];
      let e = this.r_BE0A(who, 0x11);
      if (m[0xAC03]) e = m[0xAC03] >> 1;
      this.r_BAD6(u8(e + 0x30), 0x16, c);
      await this.r_C2F9(0xC2CF);
      this.ei = true;
      if (m[V.ISCPU]) {
        if (!m[0xAC31]) this.r_CA92(); else this.r_C78D();
      }
    }
    return this.moveLoop();
  },

  // $AE50: step-by-step movement until the piece stops
  async moveLoop(jumpBC) {
    const m = this.m;
    for (;;) {
      let bc;
      if (jumpBC !== undefined) { bc = jumpBC; jumpBC = undefined; }
      else {
        bc = this.rw(V.CURSOR);
        if (m[0xAC03]) {
          const r = await this.r_B0A8(bc);
          if (r.ret !== undefined) return r.ret;
          bc = r.bc;
        } else {
          if (m[V.ISCPU]) {
            if (!m[0xAC31]) { if (!m[0xAC30]) this.r_CA92(); }
            else if (!m[0xAC30]) this.r_C8C7();
            bc = this.rw(V.CURSOR);
          }
          // $AE77: the original polls the keyboard in a tight loop here; idle
          // iterations change nothing, so waiting for the next key is equivalent.
          bc = await this.r_BBE7(bc, m[V.ISCPU] ? undefined : await this.key());
        }
      }
      // $AE7A
      if (this.debug) this.debug('step', { bc: bc.toString(16), key: m[0xAC32], from: this.rw(V.P14).toString(16), cd86: this.rw(V.CD86).toString(16), ac30: m[0xAC30], ac31: m[0xAC31], ac07: m[0xAC07] });
      this.ww(0xAC0A, bc);
      const t = this.r_BDD1(bc);
      this.ww(V.P12, t);
      this.r_BDED();
      if (m[0xAC32] === 0x49) await this.r_C3B3();
      if (m[0xAC32] === 0x4B) {
        await this.r_C2F9(0xC2B1);
        this.ei = true;
        return this.r_B06F();
      }
      if (t === this.rw(V.P14)) continue;
      const tid = m[0xAC0C];
      const p = m[V.PLAYER];
      let act;   // 'move' | 'attack' | 'block'
      if (tid === 0 || m[t + L2] === 4) act = 'move';
      else if (tid === 0x24) {
        act = (m[0xAC0D] && !m[0xAC09]) ? 'move' : 'attack';
      } else if (tid === 0x25 || !P(tid, 0x23)) {
        if ((m[0xAC10] & 7) !== p) act = 'attack';
        else if (!m[0xAC0D] || M(tid, 0x10) || P(tid, 0x16)) act = 'block';
        else act = 'move';
      } else {
        // $AF0D
        if (P(tid, 0x26) && M(tid, 0x28) && m[0xAC0D] && (m[0xAC10] & 7) === p) act = 'move';
        else if (M(tid, 0x29)) act = 'block';
        else {
          const s = this.rw(V.P14);
          if (P(m[s], 0x29)) act = 'attack';
          else if ((m[s + L3] & 7) !== u8(tid - 0x29)) act = 'attack';
          else act = 'block';
        }
      }
      if (this.debug) this.debug('act', { act, t: t.toString(16), tid, owner: m[t + L3] & 7, l2: m[t + L2], mover: m[this.rw(V.P14)], ac0d: m[0xAC0D], ac09: m[0xAC09], ac10: m[0xAC10] });
      if (act === 'block') continue;
      let r;
      if (act === 'attack') r = await this.r_B168();
      else r = await this.r_AF50();
      if (r.ret !== undefined) return r.ret;
      if (r.next === 'B06F') return this.r_B06F();
      // r.next === 'AE50' -> loop
    }
  },

  // $AF50: move the piece from ($AC14) to ($AC12)
  async r_AF50() {
    const m = this.m;
    if (m[0xAC07]) return { next: 'AE50' };
    m[0xAC30] = 0;
    this.ww(V.CURSOR, this.rw(0xAC0A));
    const s = this.rw(V.P14);
    const sid = m[s];
    if (sid === 0x25) return { next: 'B06F' };
    m[0xAC0C] = sid;
    const wz = m[0xAC0D];
    if (wz !== sid && wz !== 0) {
      m[0xAC0C] = wz;
      m[s + L4] = 0;
    } else if (m[s + L5]) {
      m[s] = m[s + L5];
      m[s + L1] = 1;
      m[s + L2] = 4;
    } else {
      this.blank(s);
      m[s + L1] = 1;
    }
    // $AFA3
    m[0xAC10] = m[s + L3];
    m[0xAC09] = m[s + L4];
    m[s + L4] = 0;
    const t = this.rw(V.P12);
    if (m[t] !== 0 && m[t + L2] !== 4) {
      m[t + L4] = m[0xAC0D];
    } else {
      const old = m[t];
      m[t] = m[0xAC0C];
      m[t + L5] = old;
      m[t + L1] = 1;
      m[t + L2] = 0;
      m[t + L3] = m[0xAC10];
      m[t + L4] = m[0xAC09];
    }
    // $B007
    await this.r_C2F9(0xC261);
    this.ei = true;
    this.ww(V.P14, t);
    if (m[0xB165]) return { next: 'B06F' };
    if (m[t] !== 0x24) {
      this.r_BE21();
      if (m[0xAC06]) await this.r_BEB2();
      await this.r_BBCC();
      if (m[0xAC07]) return { next: 'AE50' };
      if (m[0xAC03]) return { next: 'B06F' };
    }
    // $B039
    await this.r_BBCC();
    const a = u8(m[0xAC01] - m[0xAC02]);
    if ((a & 0x80) || a === 0) return { next: 'B06F' };
    m[0xAC01] = a;
    this.r_BED7();
    this.attr(0x44);
    const c = this.r_BAFB(0x38, 0x16, 0);
    this.attr(0x46);
    this.r_BAD6(u8((s8(u8(a + 1)) >> 1) + 0x30), 0x16, c);
    return { next: 'AE50' };
  },

  // $B06F: the piece has finished moving (then may get a ranged attack)
  async r_B06F() {
    const m = this.m;
    const s = this.rw(V.P14);
    m[s + L3] |= 0x80;
    this.r_BED7();
    if (m[s] === 0x25) return 0x25;
    m[0xAC31] = 1;
    m[0xAC35] = 0; m[0xAC30] = 0; m[0xB165] = 0;
    if (m[s] === 0) return 0;
    const range = this.r_BE0A(m[s], 0x0F);
    if (range === 0) return 0;
    m[0xABFC] = range;
    await this.r_BBCC();
    return this.r_B8DD();
  },

  // $B0A8: flying movement - choose a destination within ($AC03)
  async r_B0A8(bc) {
    const m = this.m;
    if (!m[0xAC11]) {
      this.attr(0x45);
      this.r_BAFB(0x36, 0x16, 0x11);
      await this.r_BBCC();
      await this.r_BBB0();
      if (m[V.ISCPU]) this.r_C955();
    }
    this.r_BED7();
    this.ww(0xAC04, bc);
    if (m[0xAC07]) m[0xAC03] = 3;
    for (;;) {
      let k;
      if (m[V.ISCPU]) k = this.r_C9DC();
      else {
        this.ww(0x5C7B, 0xC35D);
        k = await this.r_BC96();
        m[0xAC32] = k;
      }
      k = m[0xAC32];
      if (k === 0x49) await this.r_C3B3();
      if (k === 0x4B) {
        await this.r_C2F9(0xC2B1);
        this.ei = true;
        this.ww(V.P12, this.rw(V.P14));
        return { ret: await this.r_B06F() };
      }
      if (k !== 0x53) continue;
      this.ww(0xBEE9, this.rw(0xAC04));
      this.ww(0xBEEB, this.rw(V.CURSOR));
      const d = this.r_BEEF();
      if (M(m[0xAC03], d)) {
        this.attr(0x46);
        this.r_BAFB(0x35, 0x16, 0);
        await this.halt(0x14);
        await this.r_BBB0();
        continue;
      }
      await this.r_C2F9(0xC2BB);
      this.ei = true;
      const target = this.rw(V.CURSOR);
      this.ww(V.CURSOR, this.rw(0xAC04));
      m[0xAC11] = 1;
      return { bc: target };
    }
  },

  // $BE21: is the cursor square next to an enemy? ($AC06)
  r_BE21() {
    const m = this.m;
    m[0xAC06] = 0;
    const bc = this.rw(V.CURSOR);
    let b = bc >> 8, c = bc & 0xFF;
    const steps = [[0, -1], [-1, 0], [0, 1], [0, 1], [1, 0], [1, 0], [0, -1], [0, -1]];
    for (const [db, dc] of steps) { b = u8(b + db); c = u8(c + dc); this.r_BE52(b, c); }
  },
  r_BE52(b, c) {
    const m = this.m;
    if (b === 0 || c === 0) return;
    if (M(0x0F, c) || M(0x0A, b)) return;
    const a = this.r_BDD1((b << 8) | c);
    const id = m[a];
    if (id === 0) return;
    if (m[a + L2] === 4) return;
    const me = u8(m[V.PLAYER] + 1);
    let v;
    if (!P(id, 0x22)) {
      v = u8((m[a + L3] & 7) + 1);
      if (v === me) return;
    } else {
      const w = u8(id - 0x29);
      if (w & 0x80) return;
      v = u8(w + 1);
      if (v === me) return;
    }
    m[0xAC06] = v;
  },

  // $BEB2: ENGAGED TO ENEMY
  async r_BEB2() {
    const m = this.m;
    m[0xAC03] = 0;
    m[0xAC07] = 1;
    this.attr(0x46);
    this.r_BED7();
    this.r_BAFB(0x34, 0x16, 0);
    await this.r_C2F9(0xC289);
    this.ei = true;
  },

  // ---- $B168: combat between ($AC14) and ($AC12) ---------------------------------
  // Returns { ret } (return from $ACED/$B8DD with A) or { next }.
  async r_B168() {
    const m = this.m;
    this.r_BED7();
    const t = this.rw(V.P12), s = this.rw(V.P14);
    m[0xB374] = m[t + L5];
    m[0xB161] = 0; m[0xB162] = 0; m[0xB163] = 0; m[0xB164] = 0;
    const att = m[s];
    m[0xAC0C] = att; m[0xB165] = att;
    if (!M(att, 0x1C) && M(att, 0x22)) m[0xB163] = att;
    if (m[s + L3] & 0x40) m[0xB163] = m[s + L3];
    const aw = u8(att - 0x29);
    if (!(aw & 0x80)) {
      const fa = V.WFLAGS + aw;
      m[fa] &= ~0x08;
      const ix = this.rw(0xE3E0 + ((att - 1) * 2 & 0xFF));
      m[ix + 0x1C] = m[ix + 0x19];
      m[ix + 0x22] = m[ix + 0x19];
      const wpn = m[fa] & 7;
      if (wpn) { m[0xB163] = wpn; m[0xB161] = wpn; }
      const rc = this.r_BE0A(att, 0x0E);
      if (rc) m[0xB163] = rc;
    }
    const tid = m[t];
    if (!M(tid, 0x1C) && M(tid, 0x22)) m[0xB164] = tid;
    if (m[t + L3] & 0x40) m[0xB164] = m[t + L3];
    const tw = u8(tid - 0x29);
    if (!(tw & 0x80)) {
      const f = m[V.WFLAGS + tw];
      let a = (((f & 0xC0) << 2) | ((f & 0xC0) >> 6)) & 0xFF;
      if (a) a++;
      m[0xB162] = a;
      if (f & 0x08) m[0xB162] = u8(m[0xB162] + 3);
    }
    // $B23D
    if (m[0xB164] && !m[0xB163]) {
      this.attr(0x45);
      this.r_BAFB(0x39, 0x16, 0);
      await this.r_C2F9(0xC2D9);
      this.ei = true;
      await this.r_BBCC();
      await this.r_BBB0();
      this.r_BED7();
      if (m[0xABFC]) return { ret: m[0xABFC] };
      return { next: 'AE50' };
    }
    // $B26E
    let a = u8(this.r_BE0A(att, m[0xABFC] ? 0x0E : 0x0D) + m[0xB161]);
    const attack = u8(this.r_BE94() + a);
    const def = u8(this.r_BE0A(m[t], 0x10) + m[0xB162]);
    await this.r_BBCC();
    const diff = u8(u8(this.r_BE94() + def) - attack);
    if (!m[0xABFC]) await this.r_B375();
    if (!(diff & 0x80)) return this.r_B302();
    // the defender is killed
    let leaveCorpse = false;
    const under = m[t + L4];
    if (under) {
      m[t + L4] = 0;
      if (m[t] === 0x22) m[t + L3] = m[t + L5];
      m[t] = under;
      m[t + L5] = 0;
      return this.r_B302();
    }
    let acc = m[t], stAddr = t + L3;
    if (P(acc, 0x29)) {
      await this.r_B3C9();
      // A=0 and HL=$E15F on return from $B3C9, so the original tests $E340
      acc = 0; stAddr = 0xE340;
    }
    if (M(acc, 0x1C)) {
      const st = m[stAddr];
      if (!(st & 0x10) && !(st & 0x40)) m[0xB165] = 0xFF;
    }
    // $B310
    m[0xAC07] = 0; m[0xAC01] = 0; m[0xAC0D] = 0;
    if (m[0xB165] === 0xFF) {
      m[t + L1] = 1;
      m[t + L2] = 4;
      await this.halt();
      await this.r_C2F9(0xC293);
      this.ei = true;
    } else {
      if (m[0xB374] === 0) { this.blank(t); m[t + L1] = 1; }
      else { m[t] = m[0xB374]; m[t + L2] = 4; }
      await this.halt();
    }
    if (m[0xAC0C] === 0x25) return this.r_B302();
    if (m[0xABFC]) return { ret: m[0xABFC] };
    return this.r_AF50();
  },
  r_B302() {
    this.ww(V.P12, this.rw(V.P14));
    if (this.m[0xABFC]) return { ret: this.m[0xABFC] };
    return { next: 'B06F' };
  },

  // $B375: melee animation on ($AC12)
  async r_B375() {
    const m = this.m;
    await this.r_C2F9(0xC24D);
    const t = this.rw(V.P12);
    m[t + L1] = 0x32;
    this.attr(0x46);
    const { h, l } = this.r_E007(t);
    this.ei = false;
    for (let i = 0; i < 5; i++) {
      let fr = 0xBF37;
      for (let j = 0; j < 4; j++) { this.sprite(fr, h, l); await this.r_C301(); fr += 0x20; }
    }
    m[t + L1] = 1;
    this.ei = true;
    await this.halt();
  },

  // $B3C9: the wizard on ($AC12) dies
  async r_B3C9() {
    const m = this.m;
    this.ei = false;
    m[V.DEADCOUNT] = u8(m[V.DEADCOUNT] + 1);
    await this.r_C2F9(0xC2A7);
    const sq = this.rw(V.P12);
    const rec = this.rw(0xE3E0 + ((m[sq] - 1) * 2 & 0xFF));
    const spr = this.rw(rec + 0x17);
    this.onEvent({ type: 'wizarddead', seat: u8(m[sq] - 0x29) });
    for (let b = 8; b > 0; b--) {
      const { h, l } = this.r_E007(sq);
      let up = h, dn = h, lf = l, rt = l;
      this.attr(0x40 + b - 1);
      for (let n = 0x1D; n > 0; n--) {
        if (up - 1 !== 0) { up--; this.sprite(spr, up, l); }
        if (dn + 1 !== 0x14) { dn++; this.sprite(spr, dn, l); }
        if (lf - 1 !== 0) { lf--; this.sprite(spr, h, lf); }
        if (rt + 1 !== 0x1E) { rt++; this.sprite(spr, h, rt); }
        if (up !== 1 && lf !== 1) this.sprite(spr, up, lf);
        if (up !== 1 && rt !== 0x1D) this.sprite(spr, up, rt);
        if (dn !== 0x13 && lf !== 1) this.sprite(spr, dn, lf);
        if (dn !== 0x13 && rt !== 0x1D) this.sprite(spr, dn, rt);
        await this.r_C301();
      }
    }
    m[0xAC00] = u8(m[sq] - 0x29);
    m[sq] = 0;
    m[V.WFLAGS + m[0xAC00]] |= 0x10;
    m[sq] = m[sq + L5];
    this.r_C0DD();
    await this.halt();
    this.ei = false;
    await this.r_C2F9(0xC2C5);
    await this.r_B4FA();
  },

  // $B4FA: every creation of wizard ($AC00) disappears
  async r_B4FA() {
    const m = this.m;
    const w = m[0xAC00];
    let fr = 0xBFB7;
    this.attr(0x46);
    for (let b = 9; b > 0; b--) {
      for (let i = 0; i < 0x9F; i++) {
        const a = BOARD + i;
        const id = m[a];
        if (id === 0 || P(id, 0x29)) continue;
        if (m[a + L2] === 4 && !(m[a + L3] & 0x08)) continue;
        const own = (m[a + L3] & 7) === w;
        if (!own) {
          if (id !== 0x22 || m[a + L4] === 0 || m[a + L5] !== w) continue;
        }
        const { h, l } = this.r_E007(a);
        this.sprite(fr, h, l);
        if (b !== 1) continue;
        if (!own) { m[a + L4] = 0; m[a + L5] = 0; continue; }
        if (id === 0x22 && m[a + L4]) {
          const tr = m[a + L4];
          m[a + L4] = 0;
          m[a] = tr;
          m[a + L3] = m[a + L5];
          m[a + L5] = 0;
          continue;
        }
        const u = m[a + L4];
        m[a + L4] = 0;
        if (u) { m[a] = u; continue; }
        m[a] = m[a + L5];
        if (m[a]) m[a + L2] = 4;
      }
      await this.r_C301();
      fr += 0x20;
    }
    this.r_C0DD();
    await this.halt();
  },

  // ---- $B8DD: ranged combat --------------------------------------------------------
  async r_B8DD() {
    const m = this.m;
    this.attr(0x43); this.r_BB57();
    this.attr(0x44);
    const c = this.r_BAFB(0x3B, 0x16, 0);
    this.attr(0x46);
    this.r_BAD6(u8(m[0xABFC] + 0x30), 0x16, c);
    this.ww(0xAC04, this.rw(V.CURSOR));
    await this.r_C2F9(0xC257);
    this.ei = true;
    if (m[V.ISCPU]) this.r_CC56();
    await this.r_BBCC();
    await this.r_BBB0();
    this.ww(0x5C7B, 0xC37D);
    for (;;) {
      let k;
      if (m[V.ISCPU]) k = this.r_CCCB();
      else k = await this.r_BC96();
      if (k === 0x4B) {
        this.attr(0x41); this.r_BB57();
        this.r_BED7();
        const a = await this.r_C2F9(0xC2B1);
        this.ei = true;
        return a;
      }
      if (k !== 0x53) continue;
      if (this.rw(0xAC04) === this.rw(V.CURSOR)) continue;
      this.ww(0xBEE9, this.rw(0xAC04));
      this.ww(0xBEEB, this.rw(V.CURSOR));
      const d = this.r_BEEF();
      if (M(u8(m[0xABFC] << 1), d)) {
        this.attr(0x45);
        this.r_BAFB(0x35, 0x16, 0);
        await this.r_BBCC(); await this.r_BBB0();
        continue;
      }
      m[0xB754] = 0; m[0xB60B] = 0;
      this.r_BA77();
      const blocked = this.lineOfSight();
      this.r_C0D8();
      await this.halt();
      if (blocked) {
        this.attr(0x45);
        this.r_BED7();
        this.r_BAFB(0x3C, 0x16, 0);
        await this.r_BBCC(); await this.r_BBB0();
        continue;
      }
      break;
    }
    // $B9BB
    this.ww(0xC2F3, 0xC275);
    const aid = m[this.rw(V.P14)];
    let mode;
    if (!M(aid, 0x17) && M(aid, 0x1A)) { mode = 4; this.ww(0xC2F3, 0xC26B); }
    else if (aid === 0x15) mode = 2;
    else mode = 1;
    m[0xB60B] = mode;
    await this.r_C2F6();
    await this.r_B626();
    this.r_C0DD();
    await this.halt();
    this.ei = false;
    this.ww(0xC2F3, 0xC29D);
    const t = this.rw(V.P12);
    const { h, l } = this.r_E007(t);
    let fr = 0xBFB7;
    this.attr(0x47);
    if (mode === 4) { this.ww(0xC2F3, 0xC243); fr = 0xC123; this.attr(0x46); }
    await this.r_C2F6();
    for (let i = 0; i < 9; i++) { this.sprite(fr, h, l); await this.r_C301(); fr += 0x20; }
    this.ww(V.CURSOR, this.rw(0xAC04));
    this.ei = true;
    const id = m[t];
    if (id === 0) return 0;
    m[t + L1] = 1;
    if (m[t + L2] === 4) return 4;
    if (id === 0x24 || id === 0x25 || P(id, 0x29) || M(id, 0x23)) {
      const r = await this.r_B168();
      if (r.ret !== undefined) return r.ret;
      // (melee-only continuations are unreachable here since $ABFC != 0)
      return 0;
    }
    return id;
  },
};
