// Export the game's creature, object and wizard sprites as PNGs.
//
//     node re/tools/sprites.mjs [OUT_DIR]     (default: sprites/)
//
// Every 16x16 sprite is written at its own size and 4x larger (x4/), with
// black paper transparent. Creatures and objects come from their records
// (pointer table $E3E0): animation frames 1-4 at +$17 (3 bytes each: sprite
// pointer, attribute) and, for those that leave one, the corpse after them.
// Wizards: the 8 characters ($90E0) in the 8 colours ($90D7), and the
// sprites the upgrade spells give them ($8290-$82BF).
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { deflateSync } from 'zlib';
import { fileURLToPath } from 'url';

const ROOT = new URL('../../', import.meta.url);
const js = p => new URL('server/game/static/game/js/' + p, ROOT).href;
const { gameImage } = await import(js('engine/image.js'));
const m = gameImage();
const rw = a => m[a] | m[a + 1] << 8;
const out = process.argv[2] || fileURLToPath(new URL('sprites/', ROOT));

// ---- PNG ---------------------------------------------------------------------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;    // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- sprites -----------------------------------------------------------------
// the Spectrum's colours: black, blue, red, magenta, green, cyan, yellow, white
function colour(i, bright) {
  const v = bright ? 0xFF : 0xD7;
  return [i & 2 ? v : 0, i & 4 ? v : 0, i & 1 ? v : 0];
}
// A sprite is four characters: top left, top right, bottom left, bottom right.
function sprite(ptr, attr, scale = 1) {
  const bright = (attr >> 6) & 1, ink = colour(attr & 7, bright), paperIndex = (attr >> 3) & 7;
  const paper = paperIndex ? [...colour(paperIndex, bright), 255] : [0, 0, 0, 0];
  const size = 16 * scale, px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const ch = (y >> 3) * 2 + (x >> 3);
      const on = (m[ptr + ch * 8 + (y & 7)] >> (7 - (x & 7))) & 1;
      const c = on ? [...ink, 255] : paper;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const o = ((y * scale + dy) * size + x * scale + dx) * 4;
          px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = c[3];
        }
      }
    }
  }
  return png(size, size, px);
}
let count = 0;
function save(dir, name, ptr, attr) {
  mkdirSync(join(out, dir, 'x4'), { recursive: true });
  writeFileSync(join(out, dir, name + '.png'), sprite(ptr, attr));
  writeFileSync(join(out, dir, 'x4', name + '.png'), sprite(ptr, attr, 4));
  count++;
}
const slug = s => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
// Animations for sprite_gifs.py: the x4 frames in order, and how long each
// shows. The board interrupt steps a square's frame every (record + $16)
// interrupts, 50 a second.
const animations = [];
const animate = (dir, name, frames, rec) =>
  animations.push({ dir, name, ms: m[rec + 0x16] * 20, frames: frames.map(f => `${dir}/x4/${f}.png`) });

// ---- creatures and other board objects ----------------------------------------
for (let id = 2; id <= 0x28; id++) {
  const rec = rw(0xE3E0 + (id - 1) * 2);
  const name = String.fromCharCode(...m.subarray(rec, rec + 13));
  const dir = id <= 0x21 ? 'creatures' : 'objects';
  const base = slug(name);
  // frames 1-4 as the board animates them; duplicates are kept so the
  // numbering matches the animation
  for (let f = 0; f < 4; f++) {
    const p = rec + 0x17 + 3 * f;
    save(dir, `${base}-${f + 1}`, rw(p), m[p + 2]);
  }
  animate(dir, base, [1, 2, 3, 4].map(f => `${base}-${f}`), rec);
  // the corpse: creatures before the Vampire ($1C) leave one when they die
  // ($B310); the undead don't
  if (id < 0x1C) {
    const p = rec + 0x17 + 12;
    save(dir, `${base}-dead`, rw(p), m[p + 2]);
  }
}

// ---- wizards ------------------------------------------------------------------
const COLOURS = ['red', 'magenta', 'green', 'cyan', 'yellow', 'bright-yellow', 'white', 'bright-white'];
for (let ch = 0; ch < 8; ch++) {
  const ptr = rw(0x90E0 + ch * 2);
  for (let c = 0; c < 8; c++) save('wizards', `wizard-${ch + 1}-${COLOURS[c]}`, ptr, m[0x90D7 + c]);
}
const UPGRADES = [[0x8290, 'magic-sword'], [0x8298, 'magic-knife'], [0x82A0, 'magic-armour'],
  [0x82A8, 'magic-shield'], [0x82B0, 'magic-wings'], [0x82B8, 'magic-bow']];
const wizardRec = rw(0xE3E0 + 0x28 * 2);     // every wizard animates at the same speed
for (const [table, name] of UPGRADES) {
  const seq = [0, 1, 2, 3].map(f => rw(table + f * 2));
  const ptrs = [...new Set(seq)];
  const file = (ptr, c) => `${name}${ptrs.length > 1 ? '-' + (ptrs.indexOf(ptr) + 1) : ''}-${COLOURS[c]}`;
  for (let c = 0; c < 8; c++) {
    for (const ptr of ptrs) save('wizards', file(ptr, c), ptr, m[0x90D7 + c]);
    if (ptrs.length > 1) animate('wizards', `${name}-${COLOURS[c]}`, seq.map(ptr => file(ptr, c)), wizardRec);
  }
}
writeFileSync(join(out, 'animations.json'), JSON.stringify(animations, null, 1));
console.log(`${count} sprites written to ${out}`);
