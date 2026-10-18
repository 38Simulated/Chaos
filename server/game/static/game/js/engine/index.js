// Assemble the Chaos engine from its parts.
import { Chaos, Rng } from './core.js';
import { SetupMixin } from './setup.js';
import { SpellsMixin } from './spells.js';
import { MovementMixin } from './movement.js';
import { UiMixin } from './ui.js';
import { AiMixin } from './ai.js';
import { RulesMixin } from './rules.js';

Object.assign(Chaos.prototype, SetupMixin, SpellsMixin, MovementMixin, UiMixin, AiMixin, RulesMixin);

// Play one game. The original starts the next game straight after the
// result screen (CALL $7D00 in a loop); online, a finished room stays
// finished and players start a new game from the lobby.
Chaos.prototype.run = async function (seed, game = 0) {
  this.rng = this.fixedRng || new Rng((seed + Math.imul(game, 0x9E3779B9)) >>> 0);
  this.onEvent({ type: 'newgame', game });
  this.applyRules();
  await this.r_89F9();
  this.onEvent({ type: 'ended' });
};

export { Chaos };
export * from './core.js';
