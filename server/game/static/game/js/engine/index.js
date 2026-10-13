// Assemble the Chaos engine from its parts.
import { Chaos, Rng } from './core.js';
import { SetupMixin } from './setup.js';
import { SpellsMixin } from './spells.js';
import { MovementMixin } from './movement.js';
import { UiMixin } from './ui.js';
import { AiMixin } from './ai.js';

Object.assign(Chaos.prototype, SetupMixin, SpellsMixin, MovementMixin, UiMixin, AiMixin);

// Run games forever, as the original does (CALL $7D00 in a loop).
Chaos.prototype.run = async function (seed) {
  for (let game = 0; ; game++) {
    this.rng = this.fixedRng || new Rng((seed + Math.imul(game, 0x9E3779B9)) >>> 0);
    this.onEvent({ type: 'newgame', game });
    await this.r_89F9();
  }
};

export { Chaos };
export * from './core.js';
