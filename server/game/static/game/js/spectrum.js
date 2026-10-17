// ZX Spectrum display, ROM print/plot emulation and beeper for the Chaos remake.
//
// The game writes straight into screen memory ($4000-$5AFF) and uses a handful
// of ROM routines (RST $10 printing on channel 'S', PLOT, PIXEL-ADD). Those
// are emulated here, operating on the same 64K memory array the game logic
// uses, so the picture is pixel-identical to the original.

export const TSTATES_PER_SECOND = 3500000;
export const TSTATES_PER_FRAME = 69888;

// System variables used by the game
export const SV = {
  CHARS: 0x5C36, UDG: 0x5C7B, COORDS: 0x5C7D, ATTR_P: 0x5C8D, MASK_P: 0x5C8E,
  ATTR_T: 0x5C8F, MASK_T: 0x5C90, P_FLAG: 0x5C91, FLAGS2: 0x5C6A,
};

const PALETTE = [
  [0, 0, 0], [0, 0, 0xD7], [0xD7, 0, 0], [0xD7, 0, 0xD7],
  [0, 0xD7, 0], [0, 0xD7, 0xD7], [0xD7, 0xD7, 0], [0xD7, 0xD7, 0xD7],
  [0, 0, 0], [0, 0, 0xFF], [0xFF, 0, 0], [0xFF, 0, 0xFF],
  [0, 0xFF, 0], [0, 0xFF, 0xFF], [0xFF, 0xFF, 0], [0xFF, 0xFF, 0xFF],
];

export function pixelAddr(row, line, col) {
  // character row 0-23, pixel line within char 0-7, column 0-31
  return 0x4000 | ((row & 0x18) << 8) | (line << 8) | ((row & 7) << 5) | col;
}

export class Spectrum {
  constructor(mem) {
    this.m = mem;
    this.border = 0;
    this.printRow = 0;
    this.printCol = 0;
    this.ctrl = null;      // pending control code state for RST $10
    this.ctrlArgs = [];
  }

  // ---- ROM: CHAN-OPEN stream 2 ('S') -> TEMPS -------------------------------
  chanOpenS() {
    const m = this.m;
    m[SV.ATTR_T] = m[SV.ATTR_P];
    m[SV.MASK_T] = m[SV.MASK_P];
    // TEMPS: copy permanent P-FLAG bits (odd) into temporary (even) positions
    const pf = m[SV.P_FLAG];
    m[SV.P_FLAG] = (pf & 0xAA) | ((pf & 0xAA) >> 1);
  }

  // ---- ROM: PO-ATTR ($0BDB) -------------------------------------------------
  poAttr(attrAddr) {
    const m = this.m;
    const e = m[SV.ATTR_T], d = m[SV.MASK_T];
    let a = ((m[attrAddr] ^ e) & d) ^ e;
    const pf = m[SV.P_FLAG];
    if (pf & 0x40) { a &= 0xC7; if (!(a & 0x04)) a ^= 0x38; }
    if (pf & 0x10) { a &= 0xF8; if (!(a & 0x20)) a ^= 0x07; }
    m[attrAddr] = a;
  }

  // ---- ROM: RST $10 on channel 'S' -----------------------------------------
  rst10(ch) {
    if (this.ctrl !== null) {
      this.ctrlArgs.push(ch);
      if (this.ctrl === 0x16 && this.ctrlArgs.length === 2) {
        this.printRow = this.ctrlArgs[0];
        this.printCol = this.ctrlArgs[1] & 31;
        this.ctrl = null;
      } else if (this.ctrl !== 0x16) {
        this.ctrl = null; // INK/PAPER etc. (unused by the game)
      }
      return;
    }
    if (ch === 0x16 || (ch >= 0x10 && ch <= 0x15)) { this.ctrl = ch; this.ctrlArgs = []; return; }
    if (ch < 0x20) return;
    const glyph = this.glyphFor(ch);
    this.printGlyph(this.printRow, this.printCol, glyph);
    this.printCol++;
    if (this.printCol > 31) { this.printCol = 0; this.printRow++; }
  }

  glyphFor(ch) {
    const m = this.m;
    const g = new Uint8Array(8);
    if (ch >= 0x80 && ch <= 0x8F) {
      // block graphics: bits 0..3 = TR, TL, BR, BL quadrant? (ROM PO-GR-1)
      const top = ((ch & 1) ? 0x0F : 0) | ((ch & 2) ? 0xF0 : 0);
      const bot = ((ch & 4) ? 0x0F : 0) | ((ch & 8) ? 0xF0 : 0);
      for (let i = 0; i < 4; i++) { g[i] = top; g[i + 4] = bot; }
      return g;
    }
    let base;
    if (ch >= 0x90) base = (m[SV.UDG] | m[SV.UDG + 1] << 8) + 8 * (ch - 0x90);
    else base = (m[SV.CHARS] | m[SV.CHARS + 1] << 8) + 8 * ch;
    for (let i = 0; i < 8; i++) g[i] = m[(base + i) & 0xFFFF];
    return g;
  }

  // ROM PR-ALL: honours OVER (P-FLAG bit 0) and INVERSE (bit 2), then PO-ATTR
  printGlyph(row, col, glyph) {
    const m = this.m;
    const pf = m[SV.P_FLAG];
    const over = (pf & 0x01) ? 0xFF : 0;
    const inv = (pf & 0x04) ? 0xFF : 0;
    for (let i = 0; i < 8; i++) {
      const a = pixelAddr(row, i, col);
      m[a] = ((over & m[a]) ^ inv ^ glyph[i]) & 0xFF;
    }
    this.poAttr(0x5800 + row * 32 + col);
  }

  // ---- ROM: PIXEL-ADD ($22AA) / PLOT-SUB ($22E5) ---------------------------
  // x = C (0-255), y = B (0-175, origin bottom-left)
  pixelAddress(x, y) {
    const yy = 175 - y;
    const addr = 0x4000 | ((yy & 0xC0) << 5) | ((yy & 0x07) << 8) | ((yy & 0x38) << 2) | (x >> 3);
    return { addr, bit: 7 - (x & 7) };
  }

  plot(x, y) {
    const m = this.m;
    m[SV.COORDS] = x & 0xFF; m[SV.COORDS + 1] = y & 0xFF;
    const { addr, bit } = this.pixelAddress(x, y);
    const pf = m[SV.P_FLAG];
    const mask = 1 << bit;
    let v = m[addr];
    if (pf & 0x01) v ^= mask;            // OVER 1 (temporary bit 0)
    else if (pf & 0x04) v &= ~mask;      // INVERSE 1
    else v |= mask;
    m[addr] = v & 0xFF;
    // PO-ATTR for the cell
    const yy = 175 - y;
    this.poAttr(0x5800 + (yy >> 3) * 32 + (x >> 3));
  }

  unplot(x, y) { // $B733: clear pixel without touching attributes
    const m = this.m;
    m[SV.COORDS] = x & 0xFF; m[SV.COORDS + 1] = y & 0xFF;
    const { addr, bit } = this.pixelAddress(x, y);
    m[addr] &= ~(1 << bit) & 0xFF;
  }

  // ---- direct character write used by the game ($DF0F) ---------------------
  // Prints 8x8 char A from CHARS at char row B, column C with attribute ATTR-T.
  putChar(a, row, col) {
    const m = this.m;
    const chars = m[SV.CHARS] | m[SV.CHARS + 1] << 8;
    let src = (chars + a * 8) & 0xFFFF;
    for (let i = 0; i < 8; i++) m[pixelAddr(row, i, col)] = m[src + i];
    m[0x5800 + (row & 0x1F) * 32 + col] = m[SV.ATTR_T];
  }

  cls() { this.m.fill(0, 0x4000, 0x5B00); }
}

// ---- Canvas renderer ---------------------------------------------------------
export class Renderer {
  constructor(canvas, mem, spec) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.m = mem;
    this.spec = spec;
    this.bw = 32; this.bh = 24;           // border size in Spectrum pixels
    canvas.width = 256 + 2 * this.bw;
    canvas.height = 192 + 2 * this.bh;
    this.img = this.ctx.createImageData(canvas.width, canvas.height);
    this.flashFrame = 0;
  }

  frame() {
    this.flashFrame = (this.flashFrame + 1) & 31;
    this.draw();
  }

  draw() {
    const m = this.m, d = this.img.data, W = this.canvas.width;
    const flashOn = this.flashFrame >= 16;
    const bc = PALETTE[this.spec.border & 7];
    for (let i = 0; i < d.length; i += 4) { d[i] = bc[0]; d[i + 1] = bc[1]; d[i + 2] = bc[2]; d[i + 3] = 255; }
    for (let y = 0; y < 192; y++) {
      const third = y >> 6, line = y & 7, crow = (y >> 3) & 7;
      const rowBase = 0x4000 | (third << 11) | (line << 8) | (crow << 5);
      const attrBase = 0x5800 + (y >> 3) * 32;
      let o = ((y + this.bh) * W + this.bw) * 4;
      for (let cx = 0; cx < 32; cx++) {
        const byte = m[rowBase + cx];
        const at = m[attrBase + cx];
        const bright = (at & 0x40) ? 8 : 0;
        let ink = (at & 7) | bright, paper = ((at >> 3) & 7) | bright;
        if ((at & 0x80) && flashOn) { const t = ink; ink = paper; paper = t; }
        const ci = PALETTE[ink], cp = PALETTE[paper];
        for (let b = 7; b >= 0; b--) {
          const c = (byte >> b) & 1 ? ci : cp;
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; o += 4;
        }
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
}

// ---- Beeper -----------------------------------------------------------------
// Sounds that would start more than this late are dropped (seconds).
const MAX_SOUND_LAG = 0.5;

export class Beeper {
  constructor() {
    this.ctx = null;
    this.gain = null;
    this.enabled = true;
    this.volume = 1;      // 0 = silent, 1 = the original loudness, 2 = twice that
    this.nextTime = 0;
  }

  setVolume(v) {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v;
  }

  // A short 1 kHz beep, so the player can hear the volume they picked.
  test() {
    const half = TSTATES_PER_SECOND / 2000, edges = [];
    for (let t = half; t < TSTATES_PER_SECOND / 10; t += half) edges.push(t);
    this.play(edges, TSTATES_PER_SECOND / 10);
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  // edges: array of T-state offsets where the speaker toggles, total: T-states
  play(edges, total, startLevel = 0) {
    // nobody hears a hidden tab, and its sounds would queue up for later
    if (!this.enabled || edges.length === 0 || document.hidden) return;
    const ctx = this.ensure();
    if (!ctx) return;
    // Sounds play back to back. When the engine runs faster than real time
    // (catching up after the tab was hidden or the page was busy), they would
    // pile up and play long after their moves, so skip them until it is back
    // in step.
    if (this.nextTime > ctx.currentTime + MAX_SOUND_LAG) return;
    const rate = ctx.sampleRate;
    const n = Math.max(1, Math.ceil(total / TSTATES_PER_SECOND * rate));
    const buf = ctx.createBuffer(1, n, rate);
    const data = buf.getChannelData(0);
    let level = startLevel, ei = 0;
    const vol = 0.18;
    for (let i = 0; i < n; i++) {
      const t = i / rate * TSTATES_PER_SECOND;
      while (ei < edges.length && edges[ei] <= t) { level ^= 1; ei++; }
      data[i] = level ? vol : -vol;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    const when = Math.max(ctx.currentTime, this.nextTime);
    src.start(when);
    this.nextTime = when + n / rate;
  }
}
