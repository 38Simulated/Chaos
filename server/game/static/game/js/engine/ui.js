// Cursor, information screen, beams and line of sight ($B60D-$BEE7, $C3B3).
import { BOARD, L1, L2, L3, L4, L5, V, M, P, u8, s8 } from './core.js';
import { SV } from '../spectrum.js';

// frames to wait for a key in one pass of the cursor loop (the original's
// pass takes ~0.12s: a delay loop plus three HALTs)
const CURSOR_PASS_FRAMES = 6;

export const UiMixin = {
  // ---- $BC96: one pass of the cursor loop; returns the key read --------------
  async r_BC96() {
    const m = this.m;
    let k = await this.poll(CURSOR_PASS_FRAMES);
    if (k === 0x49) {
      await this.r_C3B3();
      await this.halt();
      k = 0xFF;
    } else if (k !== 0xFF && !P(k, 0x39) && !M(k, 0x31) && M(u8(k - 0x31), m[V.NWIZ])) {
      // show a wizard's creations while the number key is held
      m[0xD391] = u8(k - 0x31);
      this.r_C0DD();
      await this.halt();
      do {
        this.r_D392();
        this.attr(0x46);
        const c = this.r_BAFB(u8(m[0xD391] + 0x29), 0x16, 0);
        this.r_BAFB(0x5F, 0x16, c);
      } while (!(await this.input.pollRelease(this.who(), 1, this.fast)));
      this.r_BED7();
      this.r_C0DD();
      await this.halt();
      k = 0xFF;
    }
    // $BCE5
    const old = this.rw(V.CURSOR);
    const bc = await this.r_BBE7(old, k);
    if (bc !== old) this.r_BED7();
    this.ww(V.CURSOR, bc);
    this.r_BDA5();
    const sq = this.r_BDD1(bc);
    this.ww(V.P12, sq);
    m[0xAC10] = m[sq + L3];
    this.attr(0x45);
    if (m[sq] !== 0) {
      let c = this.r_BAFB(m[sq], 0x16, 0);
      this.attr(0x44);
      if (m[0xAC10] & 0x08) {
        this.r_BAFB(0x31, 0x16, c);
      } else if (m[sq + L2] === 4) {
        this.r_BAFB(0x32, 0x16, c);
      } else {
        this.attr(0x47);
        if (m[sq + L4] !== 0) c = this.r_BAD6(0x23, 0x16, c);
        else if (m[sq + L5] !== 0) { this.attr(0x43); c = this.r_BAD6(0x23, 0x16, c); }
        if (M(m[sq], 0x29)) {
          this.attr(0x46);
          c = this.r_BAD6(0x28, 0x16, c);
          c = this.r_BAFB(u8((m[sq + L3] & 7) + 0x29), 0x16, c);
          this.r_BAD6(0x29, 0x16, c);
        }
      }
    }
    // $BD88
    await this.delayT(0x3C * (0xF8 * 13 + 26));
    this.r_BDA5();
    if (m[sq] !== 0) {
      await this.halt(3);
      m[sq + L1] = 1;
    }
    return k;
  },

  // $BBE7: move the cursor BC according to the key (or the AI's key)
  async r_BBE7(bc, k) {
    const m = this.m;
    m[SV.FLAGS2] = 8;
    if (m[V.ISCPU]) k = this.r_CDC0();
    m[0xAC32] = k;
    if (k === 0x4E && this.selecting && this.rules.nextKey && !m[V.ISCPU]) return this.nextUnmoved(bc);
    let b = bc >> 8, c = bc & 0xFF;
    const up = () => { b--; if (b === 0) b++; };
    const dn = () => { b++; if (b === 0x0B) b--; };
    const lf = () => { c--; if (c === 0) c++; };
    const rt = () => { c++; if (c === 0x10) c--; };
    if (k === 0x57) { m[0xAC02] = 2; up(); }
    if (k === 0x58) { m[0xAC02] = 2; dn(); }
    if (k === 0x41) { m[0xAC02] = 2; lf(); }
    if (k === 0x44) { m[0xAC02] = 2; rt(); }
    if (k === 0x51) { m[0xAC02] = 3; lf(); up(); }
    if (k === 0x45) { m[0xAC02] = 3; rt(); up(); }
    if (k === 0x5A) { m[0xAC02] = 3; dn(); lf(); }
    if (k === 0x43) { m[0xAC02] = 3; rt(); dn(); }
    return ((b & 0xFF) << 8) | (c & 0xFF);
  },

  // ---- $C3B3: information screen for the object on ($AC12) ---------------------
  async r_C3B3() {
    const m = this.m;
    const saveEi = this.ei;
    this.ei = false;
    const sq = this.rw(V.P12);
    const id0 = m[sq];
    if (id0 === 0) { this.ei = true; return; }
    m[0xC39F] = id0;
    m[0xC39E] &= ~0x02;
    if (P(id0, 0x29)) m[0xC39E] |= 0x02;
    const under = m[sq + L4];
    if (under) { m[0xC39D] = under; m[0xC39E] |= 0x04; }
    for (;;) {
      // $C3E2
      this.r_C5EE();
      await this.r_C2F9(0xC2E3);
      this.attr(0x44); this.r_BB57();
      this.attr(0x60); this.r_BAFB(0x3D, 0x16, 0);
      this.attr(0x46);
      let c = this.r_BAFB(m[0xC39F], 0x02, 0x04);
      let b = 0x02;
      m[0xC3A0] = 0;
      const item = (n) => {
        if (m[0xC3A0]) c = this.r_BAD6(0x2C, b, c);
        c = this.r_BAFB(n, b, c);
        m[0xC3A0] = 1;
      };
      const id = m[0xC39F];
      if (m[0xC39E] & 0x02) {
        b = 0x04; c = 0x04;
        const f = m[V.WFLAGS + u8(id - 0x29)];
        m[0xC3A1] = f;
        if (f & 0x02) item(0x3E);
        if (f & 0x04) item(0x3F);
        if ((f & 0xC0) === 0xC0) item(0x40);
        if ((f & 0xC0) === 0x40) item(0x41);
        if (f & 0x20) item(0x42);
        if (f & 0x08) item(0x43);
      } else {
        c = u8(c + 1);
        const al = this.r_BE0A(id, 0x15);
        if (al !== 0) {
          if (!(al & 0x80)) {
            this.attr(0x45);
            c = this.r_BAFB(0x47, b, c);
            c = this.r_BAD6(u8(al + 0x30), b, c);
          } else {
            this.attr(0x43);
            c = this.r_BAFB(0x46, b, c);
            c = this.r_BAD6(u8(-al + 0x30), b, c);
          }
          c = this.r_BAD6(0x29, b, c);
        }
        this.attr(0x44);
        b = 0x04; c = 0x04;
        if (!M(id, 0x10) && M(id, 0x16)) item(0x44);
        if (m[0xC39D]) {
          c = this.r_BAD6(0x28, b, c);
          c = this.r_BAFB(m[0xC39D], b, c);
          c = this.r_BAD6(0x29, b, c);
          m[0xC3A0] = 1;
        }
        if (!M(id, 0x13) && M(id, 0x1E)) item(0x42);
        if ((m[this.rw(V.P12) + L3] & 0x40) || (!M(id, 0x1C) && M(id, 0x22))) item(0x45);
      }
      // $C51B: the seven stats
      this.attr(0x45);
      m[0xC3A3] = 0x48; m[0xC3A2] = 0x0D;
      for (let i = 0; i < 7; i++) {
        const cc = m[0xC3A5 + 2 * i], bb = m[0xC3A6 + 2 * i];
        const cx = this.r_BAFB(m[0xC3A3], bb, cc);
        m[0xC3A3]++;
        this.attr(0x47);
        this.r_BAD6(u8(this.r_BE0A(m[0xC39F], m[0xC3A2]) + 0x30), bb, cx);
        m[0xC3A2]++;
        this.attr(0x45);
      }
      if (m[0xC39E] & 0x01) {
        this.attr(0x45);
        let cx = this.r_BAFB(0x4F, 0x12, 0x04);
        const ch = u8(m[0xFFFF] + 1);
        if (ch === 0x0A) cx = this.r_BAFB(0x50, 0x12, cx);
        else cx = this.r_BAD6(u8(ch + 0x30), 0x12, cx);
        cx = this.r_BAD6(0x30, 0x12, cx);
        this.r_BAD6(0x25, 0x12, cx);
      }
      if (m[0xC39E] & 0x02) {
        this.attr(0x46);
        let cx = this.r_BAFB(0x51, 0x12, 0x04);
        let a = this.r_BE0A(m[0xC39F], 0x14);
        if (!M(a, 0x0A)) {
          if (a === 0x14) { cx = this.r_BAD6(0x32, 0x12, cx); a = 0; }
          else { a = u8(a - 0x0A); cx = this.r_BAD6(0x31, 0x12, cx); }
        }
        this.r_BAD6(u8(a + 0x30), 0x12, cx);
        cx = this.r_BAFB(0x52, 0x12, 0x0E);
        this.r_BAD6(u8(this.r_BE0A(m[0xC39F], 0x15) + 0x30), 0x12, cx);
      }
      if (m[0xC39D]) {
        m[0xC39E] &= ~0x02;
        m[0xC39F] = m[0xC39D];
        m[0xC39D] = 0;
        await this.r_BBCC();
        await this.r_BBB0();
        continue;
      }
      break;
    }
    await this.r_BBCC();
    await this.r_BBB0();
    this.r_C5EE();
    this.r_C0DD();
    this.ei = true;
  },

  // ---- $B60D: board address -> PLOT coordinates (H=y, L=x) --------------------
  r_B60D(addr) {
    const l = (addr - BOARD) & 0xFF;
    const x = u8(((l & 0x0F) + 1) << 4);
    const y = u8(0xA0 - (l & 0xF0));
    return { x, y };
  },

  // $B626: draw a line from ($AC14) to ($AC12). Mode ($B60B) 0 tests line of
  // sight; 1-6 draw the various spell/missile beams.
  async r_B626() {
    const m = this.m;
    m[SV.MASK_T] = 0; m[SV.P_FLAG] = 0; m[0xB60C] = 0;
    const mode = m[0xB60B];
    if (mode === 1) { m[0xB844] = 1; m[0xB769] = 0x2A; this.attr(0x47); }
    if (mode === 2) { m[0xB844] = 2; m[0xB769] = 0x0E; this.attr(0x46); }
    if (mode === 3) { m[0xB844] = 3; m[0xB769] = 0x3C; this.attr(0x45); }
    if (mode === 4) { m[0xB844] = 3; this.attr(0x46); m[0xB769] = 0x64; }
    if (mode === 5) { m[0xB844] = 3; this.attr(0x46); m[0xB769] = 0x08; }
    if (mode === 6) { m[0xB844] = 3; this.attr(0x47); m[0xB769] = 0x64; }
    this.ei = false;
    m[0xB76A] = 0;
    const src = this.r_B60D(this.rw(V.P14));
    m[SV.COORDS] = src.x; m[SV.COORDS + 1] = src.y;
    const dst = this.r_B60D(this.rw(V.P12));
    m[0xB76B] = dst.x; m[0xB76C] = dst.y;
    const pts = this.linePoints(src.x, src.y, dst.x, dst.y);
    for (const [y, x] of pts) {
      m[SV.COORDS] = x; m[SV.COORDS + 1] = y;
      if (mode === 0) this.r_B755(x, y);
      else await this.r_B7D3(y, x);
    }
    this.ei = true;
    m[SV.P_FLAG] = 3; m[SV.MASK_T] = 0xFF;
  },

  // The ROM DRAW-LINE stepping used by $B6C5-$B721; yields [y, x] points.
  linePoints(sx, sy, tx, ty) {
    const pts = [];
    let b, c, dy, dx;
    if (sy < ty) { b = ty - sy; dy = 1; } else { b = sy - ty; dy = 0xFF; }
    if (sx < tx) { c = tx - sx; dx = 1; } else { c = sx - tx; dx = 0xFF; }
    let l, major, diag = [dy, dx], straight;
    if (c < b) { l = c; major = b; straight = [dy, 0]; }
    else {
      if ((c | b) === 0) return pts;
      l = b; major = c; straight = [0, dx];
    }
    const h = major;
    let a = major >> 1;
    let cy = sy, cx = sx;
    for (let n = major; n > 0; n--) {
      let step;
      a += l;
      if (a > 0xFF || a >= h) { a = (a - h) & 0xFF; step = diag; }
      else step = straight;
      cy = (cy + step[0]) & 0xFF;
      cx = (cx + step[1]) & 0xFF;
      pts.push([cy, cx]);
    }
    return pts;
  },

  // $B755: line-of-sight pixel test (uses the deterministic LOS bitmap)
  r_B755(x, y) {
    if (this.losBitmap && this.losBitmap[(175 - y) * 256 + x]) this.m[0xB754] = 1;
  },

  // $B7D3: plot one point of a beam with its fading trail
  async r_B7D3(y, x) {
    const m = this.m, spec = this.spec;
    m[0xB76D] = x; m[0xB76E] = y;
    this.beamShape(y, x, false);
    if (m[0xB76B] === x && m[0xB76C] === y) {
      // $B81C: erase the rest of the trail
      const len = m[0xB76A];
      let n = (len >> 1) + 2;
      let hl = 0xB76D + len;
      while (n--) {
        this.beamShape(m[hl + 1], m[hl], true);
        await this.r_C301();
        hl -= 2;
      }
      return;
    }
    m.copyWithin(0xB76F, 0xB76D, 0xB76D + 0x64);
    this.busy(2300);   // the LDDR that shifts the trail, and the rest of $B7D3
    if (m[0xB76A] !== m[0xB769]) m[0xB76A] = u8(m[0xB76A] + 2);
    const o = 0xB76D + m[0xB76A];
    this.beamShape(m[o + 1], m[o], true);
    m[SV.COORDS] = m[0xB76D]; m[SV.COORDS + 1] = m[0xB76E];
    await this.r_C301();
  },

  // $B845/$B84D: plot (or erase) the beam's point shape at y, x
  beamShape(y, x, erase) {
    const m = this.m;
    const style = m[0xB844] & 0x7F;
    // time per shape on the original: about 670 T a point to plot, 410 to erase
    let points = 0;
    const pt = (yy, xx) => {
      points++;
      yy &= 0xFF; xx &= 0xFF;
      if (erase) this.spec.unplot(xx, yy);
      else if ((m[0xB60B] & 4) && (m[0xB60C] & 7)) { /* skip */ }
      else this.spec.plot(xx, yy);
    };
    if (style !== 3) pt(y, x);
    else {
      pt(y, x); pt(y + 1, x); pt(y - 1, x); pt(y, x + 1); pt(y, x - 1);
      if (m[0xB60B] & 4) {
        pt(y + 2, x - 2); pt(y + 3, x); pt(y + 2, x + 2); pt(y, x + 3);
        pt(y - 2, x + 2); pt(y - 3, x); pt(y - 2, x - 2); pt(y, x - 3);
      }
    }
    m[SV.COORDS] = x; m[SV.COORDS + 1] = y;
    m[0xB60C] = u8(m[0xB60C] + 1);
    this.busy(erase ? 190 + 410 * points : 140 + 670 * points);
  },

  // ---- line of sight ($98DB/$B98B): BA77 blanks + pixel walk ------------------
  // Squares that never block: Magic Fire, Ghost, Wraith, corpses, both ends.
  losTransparent(i) {
    const m = this.m, a = BOARD + i;
    const id = m[a];
    return id === 0x23 || id === 0x1D || id === 0x1F || m[a + L2] === 4 ||
      a === this.rw(V.P12) || a === this.rw(V.P14);
  },
  // $BA77: blank the non-blocking squares on screen (visual only here)
  r_BA77() {
    // test mode: the original's interrupt keeps redrawing during the long
    // computations before this point, so let the display catch up first
    if (this.losFromScreen) for (let i = 0; i < 64; i++) this.r_DF72();
    if (this.onLos) this.onLos();
    for (let i = 0; i < 0x9F; i++) {
      if (!this.losTransparent(i)) continue;
      const { h, l } = this.r_E007(BOARD + i);
      this.sprite(0xEB51, h, l);
    }
  },
  // Build a bitmap of the board as the original would see it (every creature
  // in its first animation frame) and walk the line over it.
  lineOfSight() {
    const m = this.m;
    const bmp = new Uint8Array(256 * 192);
    if (this.losFromScreen) {
      // test mode: use the real screen exactly as the original does
      for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) {
        const a = 0x4000 | ((y & 0xC0) << 5) | ((y & 7) << 8) | ((y & 0x38) << 2) | (x >> 3);
        if (m[a] & (0x80 >> (x & 7))) bmp[y * 256 + x] = 1;
      }
    } else
    for (let i = 0; i < 0x9F && !this.losFromScreen; i++) {
      if ((i & 0x0F) === 0x0F) continue;
      const a = BOARD + i, id = m[a];
      if (id === 0 || this.losTransparent(i)) continue;
      const rec = this.record(id);
      const spr = this.rw(rec + 0x17);
      const row = ((i >> 4) * 2 + 1) * 8, col = ((i & 15) * 2 + 1) * 8;
      for (let q = 0; q < 4; q++) {
        const oy = row + (q >> 1) * 8, ox = col + (q & 1) * 8;
        for (let r = 0; r < 8; r++) {
          const byte = m[(spr + q * 8 + r) & 0xFFFF];
          for (let bit = 0; bit < 8; bit++) if (byte & (0x80 >> bit)) bmp[(oy + r) * 256 + ox + bit] = 1;
        }
      }
    }
    this.losBitmap = bmp;
    m[0xB754] = 0;
    m[SV.MASK_T] = 0; m[SV.P_FLAG] = 0; m[0xB76A] = 0;
    const src = this.r_B60D(this.rw(V.P14)), dst = this.r_B60D(this.rw(V.P12));
    for (const [y, x] of this.linePoints(src.x, src.y, dst.x, dst.y)) {
      m[SV.COORDS] = x; m[SV.COORDS + 1] = y;
      this.r_B755(x, y);
    }
    this.losBitmap = null;
    m[SV.P_FLAG] = 3; m[SV.MASK_T] = 0xFF;
    this.ei = true;
    return m[0xB754] !== 0;
  },
};
