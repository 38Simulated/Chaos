// Custom rules: optional changes to the original game, chosen when a custom
// game is created and the same for every browser (they are part of the game,
// like the seed). With no rules the engine plays exactly as the original.
//
//   turns     number of turns (default: 2 x wizards + 15)
//   nextKey   N moves the cursor to the next piece that hasn't moved
//   ranges    show how far the piece being moved, or shooting, can reach
//   turmoil   Turmoil can be among a wizard's starting spells
//   ability   every wizard's ability (0-3) instead of the random one
//   spells    every wizard's number of spells (11-20) besides Disbelieve
//   stats     'equal' (one random set for all), 'max' or 'min': combat,
//             defence, manoeuvre and magic resistance, without the computer
//             level's bonus
//   statsFor  who the stats rule applies to: 'all', 'human' or 'computer'
import { BOARD, L2, L3, L4, V, u8 } from './core.js';

// the rolls ($904B, 0-9) that give the lowest and highest stats
const STAT_ROLLS = { min: [0, 0, 0, 0], max: [9, 9, 9, 9] };

// Squares (0-159) that `fn(index)` picks, as a 160-byte mask; column 15 of the
// board's 16-wide layout is never a square.
function squares(fn) {
  const mask = new Uint8Array(160);
  for (let i = 0; i < 160; i++) if ((i & 0x0F) !== 0x0F && fn(i)) mask[i] = 1;
  return mask;
}

// The original's distance ($BEEF): twice the larger offset plus the smaller.
export function distance(i, j) {
  const dx = Math.abs((i & 0x0F) - (j & 0x0F)), dy = Math.abs((i >> 4) - (j >> 4));
  return 2 * Math.max(dx, dy) + Math.min(dx, dy);
}

export const RulesMixin = {
  // ---- stats -------------------------------------------------------------------
  // Does the stats rule apply to the wizard being set up ($AC2E: computer)?
  statsRuleApplies() {
    const r = this.rules;
    if (!r.stats) return false;
    const cpu = !!this.m[V.ISCPU];
    return r.statsFor === 'human' ? !cpu : r.statsFor === 'computer' ? cpu : true;
  },
  // The four rolls for combat, defence, manoeuvre and magic resistance under
  // the stats rule. 'equal' uses the rolls of the first wizard it applies to
  // (genStats keeps them in sharedRolls).
  statRolls() {
    return STAT_ROLLS[this.rules.stats] || this.sharedRolls;
  },

  // ---- N: next piece that hasn't moved -------------------------------------------
  // The cursor position (BC) of the current player's next piece after the
  // cursor, in board order, that can still move this turn; or BC unchanged.
  nextUnmoved(bc) {
    const m = this.m, p = m[V.PLAYER], wiz = u8(p + 0x29);
    const from = (((bc >> 8) - 1) << 4) + ((bc & 0xFF) - 1);
    for (let k = 1; k <= 160; k++) {
      const i = (from + k) % 160;
      if ((i & 0x0F) === 0x0F) continue;
      const a = BOARD + i, id = m[a];
      if (id === 0 || m[a + L2] === 4 || (m[a + L3] & 0x80)) continue;
      const mine = id === wiz || m[a + L4] === wiz ||
        ((m[a + L3] & 7) === p && ((id >= 2 && id <= 0x21) || id === 0x25));
      if (mine) return (((i >> 4) + 1) << 8) | ((i & 0x0F) + 1);
    }
    return bc;
  },

  // ---- range indicators (display only: nothing here feeds back into the game) ----
  clearRange() { this.rangeHint = null; },
  // Flying ($B0A8) and shooting ($B8DD): every square within `reach` of `from`.
  showReach(from, reach) {
    if (!this.rules.ranges) return;
    const f = (from - BOARD) & 0xFF;
    this.rangeHint = squares(i => i !== f && distance(f, i) <= reach);
  },
  // Walking: squares the piece on `from` can step to with `points` movement
  // points left ($AC01: 2 for a straight step, 3 for a diagonal one; it may
  // step while it has any left). It walks through empty squares and corpses,
  // and may end on an occupied one (an attack).
  showWalk(from, points, engaged) {
    if (!this.rules.ranges) return;
    const m = this.m, f = (from - BOARD) & 0xFF;
    const UNREACHED = -100;
    const left = new Int16Array(160).fill(UNREACHED);   // most points left on arrival
    left[f] = points;
    const queue = [f];
    while (queue.length) {
      const i = queue.shift();
      // no points left, engaged (it can only attack next to it), or an
      // occupied square it would attack rather than walk through
      if (left[i] <= 0 || (engaged && i !== f)) continue;
      if (i !== f && m[BOARD + i] !== 0 && m[BOARD + i + L2] !== 4) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = (i & 0x0F) + dx, y = (i >> 4) + dy;
          if ((!dx && !dy) || x < 0 || x > 14 || y < 0 || y > 9) continue;
          const j = (y << 4) | x, l = left[i] - (dx && dy ? 3 : 2);
          if (l > left[j]) { left[j] = l; queue.push(j); }
        }
      }
    }
    const occupied = i => m[BOARD + i] !== 0 && m[BOARD + i + L2] !== 4;
    this.rangeHint = squares(i => i !== f && left[i] !== UNREACHED && (!engaged || occupied(i)));
  },
};
