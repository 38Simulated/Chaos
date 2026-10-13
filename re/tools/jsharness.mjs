// Headless runner for the JavaScript port (for comparison with the original).
// Usage: node jsharness.mjs <script.json> <outdir>
// script.json: { "seed": 1, "steps": [ {"keys": "2"}, {"shot": "name"}, {"frames": 50}, ... ] }
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..');
const js = p => pathToFileURL(path.join(root, 'server', 'game', 'static', 'game', 'js', p)).href;

globalThis.performance = globalThis.performance || { now: () => Date.now() };
const { Chaos, ANY, HOST } = await import(js('engine/index.js'));

class OutOfInput extends Error {}

// Time is virtual: every frame the engine waits for runs one tick immediately.
import crypto from 'crypto';
const REGIONS = [['L0', 0xE01F, 0xA0], ['L2', 0xE160, 0xA0], ['L3', 0xE200, 0xA0], ['L4', 0xE2A0, 0xA0],
  ['L5', 0xE340, 0xA0], ['spells', 0x7F47, 0x141], ['bal', 0xC3A4, 1], ['round', 0x7D03, 1], ['wiz', 0xEA39, 0x26 * 8]];
function stateHash(m) {
  const h = crypto.createHash('md5');
  for (const [n, a, len] of REGIONS) {
    let b = Buffer.from(m.slice(a, a + len));
    if (n === 'L0') b = Buffer.from([...b].map(v => (v === 1 ? 0 : v)));
    if (n === 'L2') b = Buffer.from([...b].map(v => (v === 4 ? 4 : 0)));
    if (n === 'L3') b = Buffer.from([...b].map(v => v & 0x7F));
    h.update(b);
  }
  return h.digest('hex').slice(0, 8);
}
class HeadlessInput {
  constructor(game) { this.g = game; this.queue = []; this.held = new Set(); this.log = []; }
  note(ev) {
    if (ev.type !== 'down') return;
    this.log.push([String.fromCharCode(ev.code), this.g.tapePos(), stateHash(this.g.m), []]);
    if (this.shotDir) fs.writeFileSync(path.join(this.shotDir, 'j' + String(this.log.length - 1).padStart(3, '0') + '.mem'), Buffer.from(this.g.m));
    if (this.shotDir) fs.writeFileSync(path.join(this.shotDir, 'j%03d.scr'.replace('%03d', String(this.log.length - 1).padStart(3, '0'))), Buffer.from(this.g.m.slice(0x4000, 0x5B00)));
  }
  pushKey(code) { this.queue.push({ type: 'down', code }); this.queue.push({ type: 'up', code }); }
  consume() {
    const ev = this.queue.shift();
    this.note(ev);
    if (ev.type === 'down') this.held.add(ev.code); else this.held.delete(ev.code);
    return ev;
  }
  async getKey() {
    for (;;) {
      if (!this.queue.length) throw new OutOfInput();
      const ev = this.consume();
      if (ev.type === 'down') return ev.code;
    }
  }
  async pollKey(who, frames) {
    for (let i = 0; i < frames; i++) {
      if (this.queue.length) {
        const ev = this.consume();
        if (ev.type === 'down') return ev.code;
      }
      this.g.tick();
    }
    if (!this.queue.length && this.g.idleLimit-- <= 0) throw new OutOfInput();
    return 0xFF;
  }
  async peekKey() {
    for (;;) {
      if (!this.queue.length) throw new OutOfInput();
      if (this.queue[0].type === 'down') return this.queue[0].code;
      this.consume();
    }
  }
  async waitRelease() { while (this.held.size) { if (!this.queue.length) throw new OutOfInput(); this.consume(); } }
  async pollRelease(who, frames) {
    for (let i = 0; i < frames; i++) {
      if (!this.held.size) return true;
      if (this.queue.length) this.consume(); else this.g.tick();
    }
    return !this.held.size;
  }
}

export async function runScript(script, outdir) {
  const bin = fs.readFileSync(path.join(root, 'server', 'game', 'static', 'game', 'chaos.bin'));
  const g = new Chaos(bin, { input: null, seed: script.seed || 1 });
  if (script.tape) {
    const tape = fs.readFileSync(script.tape);
    let pos = 0;
    g.fixedRng = { byte: () => { const b = tape[pos]; pos = (pos + 1) % tape.length; return b; } };
    g.tapePos = () => pos;
  }
  g.noAnim = !!script.noAnim;
  g.losFromScreen = !!script.losScreen;
  if (script.noRedrawBlanks) g.noRedrawBlanks = true;
  const rngLog = [];
  if (script.rngTrace) {
    const inner = g.fixedRng.byte;
    const dumpAt = +(process.env.DUMPAT ?? -1);
    g.fixedRng.byte = () => {
      const pos = g.tapePos();
      if (pos === dumpAt && !g._dumped && (g._dumped = true)) fs.writeFileSync(path.join(process.env.DUMPDIR || '.', 'js_at.mem'), Buffer.from(g.m));
      const v = inner();
      const frames = new Error().stack.split('\n').slice(2, 7).map(l => (l.match(/at (?:Chaos\.|Object\.)?(\S+)/) || [])[1]);
      let kind = '8D9F';
      if (frames.includes('r_904B')) kind = '904B'; else if (frames.includes('r_BE94')) kind = 'BE94';
      const callers = frames.filter(f => f && !['r_904B', 'r_BE94', 'rndByte', 'g.fixedRng.byte', 'Object.byte', 'byte'].includes(f));
      const h4 = a => g.rw(a).toString(16).toUpperCase().padStart(4, '0');
      rngLog.push([pos, kind, callers.slice(0, 3).join('<'), v, h4(0xAC14), g.m[0xAC0C], h4(0xAC12)]);
      return v;
    };
  }
  if (process.env.MOVETRACE) {
    const lo = +process.env.MOVETRACE;
    g.debug = (what, o) => { if (g.tapePos() >= lo - 10 && g.tapePos() <= lo + 3) console.log('tape', g.tapePos(), what, JSON.stringify(o)); };
  }
  if (process.env.LOSDUMP) {
    const lo = +process.env.LOSDUMP; let done = false;
    g.onLos = () => { if (!done && g.tapePos() >= lo) { done = true; fs.writeFileSync(process.env.LOSFILE, Buffer.from(g.m)); console.log('LOS dump at tape', g.tapePos(), 'from', g.rw(0xAC14).toString(16), 'to', g.rw(0xAC12).toString(16)); } };
  }
  if (process.env.CBCC) {
    const lo = +process.env.CBCC; const orig = g.r_CBCC;
    let n = 0;
    g.r_CBCC = function () {
      const r = orig.call(this);
      if (g.tapePos() >= lo && n++ < 2) {
        console.log('CBCC C7BB', g.m[0xC7BB], 'C8B7', g.rw(0xC8B7).toString(16), 'C78B', g.rw(0xC78B).toString(16), 'CBB8', g.m[0xCBB8]);
        console.log('  D3F2:', [...g.m.slice(0xD3F2, 0xD3F2 + 0xC0)].map(v => v.toString(16).padStart(2, '0')).join(' '));
      }
      return r;
    };
  }
  if (process.env.C9DC) {
    const lo = +process.env.C9DC; const orig = g.r_C9DC;
    let n = 0;
    g.r_C9DC = function () {
      if (g.tapePos() >= lo && n++ < 3) {
        const h = a => g.rw(a).toString(16).toUpperCase();
        console.log('C9DC AC0E', g.m[0xAC0E], 'AC14', h(0xAC14), 'CD86', h(0xCD86), 'C8B7', h(0xC8B7), 'C649', h(0xC649), 'AC03', g.m[0xAC03].toString(16));
        console.log('  D3F2:', [...g.m.slice(0xD3F2, 0xD3F2 + 64)].map(v => v.toString(16).padStart(2, '0')).join(' '));
      }
      return orig.call(this);
    };
  }
  if (process.env.TRACE) {
    const orig = g.callSpell;
    g.callSpell = async function (a) { console.log('spell', a.toString(16), 'id', this.m[0x937B].toString(16), 'tape', this.tapePos()); await orig.call(this, a); console.log('  -> AC12', this.rw(0xAC12).toString(16), 'valid', this.m[0x975F], 'ok', this.m[0x9167], 'tape', this.tapePos()); };
  }
  const inp = new HeadlessInput(g);
  if (script.shots && outdir) { fs.mkdirSync(outdir, { recursive: true }); inp.shotDir = outdir; }
  g.input = inp;
  g.idleLimit = script.idleLimit ?? 200;
  // virtual time
  g.halt = function (n = 1) { for (let i = 0; i < n; i++) this.tick(); return Promise.resolve(); };
  g.delayT = function (t) { const n = Math.max(0, Math.round(t / 69888)); for (let i = 0; i < n; i++) this.tick(); return Promise.resolve(); };
  for (const st of script.steps) if (st.keys !== undefined) for (const ch of st.keys) inp.pushKey(ch === '\n' ? 0x0D : ch.toUpperCase().charCodeAt(0));
  let err = null;
  try { await g.run(script.seed || 1); } catch (e) { if (!(e instanceof OutOfInput)) err = e; }
  if (outdir) {
    fs.mkdirSync(outdir, { recursive: true });
    fs.writeFileSync(path.join(outdir, 'final.scr'), Buffer.from(g.m.slice(0x4000, 0x5B00)));
    fs.writeFileSync(path.join(outdir, 'mem.bin'), Buffer.from(g.m));
    fs.writeFileSync(path.join(outdir, 'js_log.json'), JSON.stringify(inp.log));
    if (script.rngTrace) fs.writeFileSync(path.join(outdir, 'js_rng.json'), JSON.stringify(rngLog));
  }
  if (err) { console.error(err.stack); process.exitCode = 1; }
  return g;
}

if (process.argv[2]) {
  const script = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  await runScript(script, process.argv[3]);
}
