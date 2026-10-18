# Chaos game mechanics

This describes how Chaos plays, as worked out from the ZX Spectrum original
(`re/chaos.z80`, disassembled in `re/chaos.skool`). Chaos Online's engine
(`server/game/static/game/js/engine/`) follows the original routine by routine,
so everything here applies to both. Addresses in brackets are the original's
routines, for anyone who wants to check the code.

Numbers and dice:

- Almost every roll in the game is a random number from 0 to 9 ("a roll" below).
  A test like "succeeds if a roll is below N" has an N in 10 chance.
- Distances use the game's own measure: **2 × the larger of the two offsets +
  the smaller** (`$BEEF`). One square straight is 2, one diagonal is 3, two
  squares straight is 4, and so on. Spell and flying ranges are limits on this
  number. The game shows them halved, as squares, so "range 6" means a distance
  of up to 13: 6 squares in a straight line, or 4 diagonally.

## Contents

1. [The game and its turns](#the-game-and-its-turns)
2. [Wizards](#wizards)
3. [Creatures and other pieces](#creatures-and-other-pieces)
4. [Casting spells](#casting-spells)
5. [The spells](#the-spells)
6. [Movement](#movement)
7. [Combat](#combat)
8. [Death, corpses and the undead](#death-corpses-and-the-undead)
9. [Fire, blobs, woods and castles](#fire-blobs-woods-and-castles)
10. [Computer wizards](#computer-wizards)
11. [Quirks of the original](#quirks-of-the-original)
12. [Left out of the original](#left-out-of-the-original)

## The game and its turns

The board is 15 squares across and 10 down. Two to eight wizards play, each human
or computer controlled. Computer wizards share one difficulty level, 1 to 8 (0-7
internally), chosen at the start. The wizards start on fixed squares that depend
on how many are playing (table at `$909F`).

A game lasts **2 × wizards + 15 turns** (19 turns for two wizards, 31 for
eight). If more than one wizard is still alive at the end, the contest is drawn.
It ends early, with a winner, as soon as only one wizard is left.

Each turn (`$8E55`) has these steps:

1. **Choosing spells** (`$9168`). Each living human wizard picks one spell from
   their list, or none. For a creature spell they also say whether to cast it
   as an illusion. They can also look over the board and the spells' details.
2. **Casting** (`$95C7`). In seat order, every wizard casts the spell they
   chose (computer wizards choose theirs now).
3. *(The game checks whether only one wizard is left.)*
4. **Spreading** (`$9F50`). Gooey Blobs and Magic Fire spread and die out;
   castles may vanish.
5. **Magic Wood** (`$8F9A`). A wizard sheltering in a Magic Wood may be given
   a new spell.
6. **Movement** (`$AC36`). In seat order, each wizard moves and fights with
   their wizard and every piece they own. Pieces cast this turn can move too.
7. *(The game checks whether only one wizard is left again.)*

## Wizards

### Starting statistics

Each wizard's statistics are rolled at the start (`$8CF2`). "Bonus" is the
computer level (0-7) for computer wizards and 0 for humans; halves round down.

| Statistic | Human | Computer at level L |
|---|---|---|
| Combat | 1-5 | 1-5 + L/2 |
| Ranged combat, range | none | none |
| Defence | 1-5 | 1-5 + L/2 |
| Movement | 1 | 1 |
| Manoeuvre | 3-7 | 3-7 + L/4 |
| Magic resistance | 6-8 | 6-8 |
| Number of spells | 11-15 (+ Disbelieve) | 11-15 + L, at most 20 (+ Disbelieve) |
| Ability | 0-2 (0 most often) | 0-2, more often above 0 |

### Ability

**Ability** is a wizard's skill at magic. It is a number from 0 to 2, fixed for
the whole game; nothing in the game changes it. To see it, examine a wizard: the
information screen shows "Ability" next to "Spells".

The ability is added to the base casting chance of **every** spell the wizard
casts (`$92F9`), before the cap of 100%. Each point is worth 10%. So:

- a wizard with ability 2 casts a Green Dragon (base 10%) with a 30% chance;
- the same wizard casts Magic Armour (base 40%) with a 60% chance.

Ability helps with every spell: creatures, Law and Chaos alike. The spell lists
and spell information screens show the chance with the ability already
included, so a wizard with ability sees higher chances than the table in
[The spells](#the-spells).

**How it's rolled** (`$8D5B`):

1. A wizard gets a chance at ability if a roll is above 5 − bonus/2. For humans
   that is 4 in 10; at computer level 8 (bonus 7) it is 7 in 10.
2. If they pass, the ability is a second roll divided by 4, rounded down:
   - 0 with 4 in 10;
   - 1 with 4 in 10;
   - 2 with 2 in 10.

Overall, a human wizard starts with ability 0 about 76% of the time, 1 about
16%, and 2 about 8%.

### The spell list

Every wizard's first spell is **Disbelieve**, which is never used up. The rest
are drawn at random from spell numbers 2-63 (`$8D9F`). Magic Bolt, Lightning,
Subversion and Raise Dead each have two numbers, so they turn up twice as often
as other spells. Turmoil's two numbers are 64 and 65, so a wizard never starts
with Turmoil: the only way to get it is as a gift from a Magic Wood. The same
spell can be drawn more than once.

Every other spell is removed from the list once it is cast, whether it works or
not, and even if the player then cancels its targeting.

### Upgrades

Several spells improve the wizard who casts them, and change their sprite:

| Spell | Effect |
|---|---|
| Magic Knife | +2 combat; the wizard can attack undead |
| Magic Sword | +4 combat; the wizard can attack undead |
| Magic Shield | +2 defence |
| Magic Armour | +4 defence (replaces the shield's +2) |
| Magic Bow | Ranged combat 3, range 6; the wizard can attack undead |
| Magic Wings | The wizard flies, up to 6 squares |
| Shadow Form | +3 defence and moves 3 squares, until the wizard next attacks |

A weapon's bonus also counts when the wizard shoots with a Magic Bow. Defence
bonuses count against combat and against Magic Bolt and Lightning, but not
against Vengeance, Decree, Dark Power or Justice, nor against fire or blobs.

A wizard has only one weapon slot: casting Magic Knife after Magic Sword swaps
the sword for the knife. Shadow Form makes the wizard flicker (two of their four
animation frames go blank). It ends the moment they attack.

## Creatures and other pieces

Each piece's record (pointer table at `$E3E0`) holds its statistics. The table
below lists every creature. **Chance** is the spell's base casting chance;
**Align** is its alignment (positive Law, negative Chaos); **Value** is how
highly computer wizards rate the creature (`$C6D4`).

| Creature | Combat | Ranged | Range | Defence | Move | Manoeuvre | Magic res. | Chance | Align | Value | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| King Cobra | 4 | - | - | 1 | 1 | 6 | 1 | 90% | +1 | 8 | |
| Dire Wolf | 3 | - | - | 2 | 3 | 7 | 2 | 90% | −1 | 11 | |
| Goblin | 2 | - | - | 4 | 1 | 4 | 4 | 90% | −1 | 7 | |
| Crocodile | 5 | - | - | 6 | 1 | 2 | 2 | 80% | 0 | 9 | |
| Faun | 3 | - | - | 2 | 1 | 7 | 8 | 80% | −1 | 9 | |
| Lion | 6 | - | - | 4 | 4 | 8 | 3 | 60% | +1 | 15 | |
| Elf | 1 | 2 | 6 | 2 | 1 | 5 | 7 | 70% | +2 | 14 | |
| Orc | 2 | - | - | 1 | 1 | 4 | 4 | 100% | −1 | 6 | |
| Bear | 6 | - | - | 7 | 2 | 6 | 2 | 60% | +1 | 14 | |
| Gorilla | 6 | - | - | 5 | 1 | 4 | 2 | 70% | 0 | 11 | |
| Ogre | 4 | - | - | 7 | 1 | 3 | 6 | 70% | −1 | 10 | |
| Hydra | 7 | - | - | 8 | 1 | 4 | 6 | 50% | −1 | 13 | |
| Giant Rat | 1 | - | - | 1 | 3 | 8 | 2 | 100% | 0 | 9 | |
| Giant | 9 | - | - | 7 | 2 | 6 | 5 | 40% | +1 | 16 | |
| Horse | 1 | - | - | 3 | 4 | 8 | 1 | 90% | +1 | 11 | Mount |
| Unicorn | 5 | - | - | 4 | 4 | 9 | 7 | 60% | +2 | 15 | Mount |
| Centaur | 1 | 2 | 4 | 3 | 4 | 5 | 5 | 70% | +1 | 15 | Mount |
| Pegasus | 2 | - | - | 4 | 5 | 6 | 7 | 60% | +2 | 15 | Mount, flies |
| Gryphon | 3 | - | - | 5 | 5 | 5 | 6 | 60% | +1 | 16 | Mount, flies |
| Manticore | 3 | 1 | 3 | 6 | 5 | 6 | 8 | 40% | −1 | 21 | Mount, flies |
| Bat | 1 | - | - | 1 | 5 | 9 | 4 | 80% | −1 | 15 | Flies |
| Green Dragon | 5 | 4 | 6 | 8 | 3 | 4 | 4 | 10% | −1 | 25 | Flies, breathes fire |
| Red Dragon | 7 | 3 | 5 | 9 | 3 | 4 | 5 | 10% | −2 | 25 | Flies, breathes fire |
| Golden Dragon | 9 | 5 | 4 | 9 | 3 | 5 | 5 | 10% | +2 | 27 | Flies, breathes fire |
| Harpy | 4 | - | - | 2 | 5 | 8 | 5 | 60% | −1 | 17 | Flies |
| Eagle | 3 | - | - | 3 | 6 | 8 | 2 | 70% | +1 | 18 | Flies |
| Vampire | 6 | - | - | 8 | 4 | 6 | 5 | 20% | −2 | 19 | Undead, flies |
| Ghost | 1 | - | - | 3 | 2 | 9 | 6 | 50% | −1 | 13 | Undead, flies, see-through |
| Spectre | 4 | - | - | 2 | 1 | 6 | 4 | 60% | −1 | 9 | Undead |
| Wraith | 5 | - | - | 5 | 2 | 4 | 5 | 50% | −1 | 11 | Undead, see-through |
| Skeleton | 3 | - | - | 2 | 1 | 3 | 4 | 70% | −1 | 7 | Undead |
| Zombie | 1 | - | - | 1 | 1 | 2 | 3 | 90% | −1 | 4 | Undead |

The other pieces:

| Piece | Combat | Defence | Magic res. | Notes |
|---|---|---|---|---|
| Gooey Blob | 0 | 0 | 0 | Spreads, engulfs creatures, kills wizards |
| Magic Fire | 0 | 0 | 0 | Spreads, burns creatures, kills wizards; cannot be attacked; see-through |
| Magic Wood | 0 | 5 | 9 | A wizard can shelter in it |
| Shadow Wood | 2 | 4 | 9 | Never moves, but attacks a neighbouring enemy |
| Magic Castle, Dark Citadel | 0 | 0 | 0 | Its owner can shelter in it; cannot be attacked |
| Wall | 0 | 0 | 0 | Blocks movement and sight; cannot be attacked |

Groups the rules refer to:

- **Mounts** (a wizard can ride them): Horse, Unicorn, Centaur, Pegasus,
  Gryphon, Manticore.
- **Flyers**: Pegasus, Gryphon, Manticore, Bat, the three dragons, Harpy,
  Eagle, Vampire, Ghost.
- **Undead**: Vampire, Ghost, Spectre, Wraith, Skeleton, Zombie, and any
  creature raised by Raise Dead.

## Casting spells

### Casting chance

A spell's chance is worked out when it is cast (`$92F9`), from:

- the spell's base chance, 0-9 (shown as 10%-100%);
- plus the **world balance** bonus: if the world leans to Law and the spell is
  lawful, or the world leans to Chaos and the spell is chaotic, add a quarter of
  the balance (rounded down);
- plus the wizard's ability;
- capped at 9 (100%).

The spell works if a roll is at most the chance, that is with (chance + 1) in
10. Neutral spells never get a balance bonus, and a spell of the other
alignment is not penalised.

### The world balance

The balance starts at 0. Every spell that works adds its alignment to the
balance:

- −2 to +2 for creatures and most spells;
- +2 for Law-1 and +4 for Law-2;
- −2 for Chaos-1 and −4 for Chaos-2.

The spell menu shows the balance as one symbol per 4 points: "LAW" with ↑s, or
"CHAOS" with ∗s. In the spell lists, ↑ marks a lawful spell, ∗ a chaotic one
and − a neutral one. The colour of each spell's name shows its current chance.

### Illusions

A human can cast any creature as an **illusion**. An illusion always works, and
moves and fights like the real thing. But:

- Disbelieve destroys it;
- Subversion always fails on it;
- it leaves no corpse when it dies.

A computer wizard casts a creature as an illusion 2 times in 10.

### Range and line of sight

Spells that pick a target must be cast within the spell's range (see the
distance measure at the top). Most also need **line of sight** (`$98DB`). The
game draws a straight line, pixel by pixel, from the centre of the caster's
square to the centre of the target's. Sight is blocked if the line crosses a
lit pixel of any other piece's sprite (its first animation frame).

So a thin creature blocks less than a bulky one, and a line can slip past a
piece through gaps in its sprite. These pieces never block sight:

- Magic Fire;
- the Ghost and the Wraith;
- corpses.

## The spells

The table lists every spell. "Range" is in squares, as the game shows it.
"Chance" is the base chance before the balance and ability. "Prio." is the
priority that computer wizards use to choose spells (higher first).

| Spell | Chance | Range | Align | Prio. | Effect |
|---|---|---|---|---|---|
| Disbelieve | 100% | any | 0 | 12-21 | Destroys an illusion |
| *Creatures* | see above | 1 | see above | 18 | Puts a creature on an adjacent square |
| Gooey Blob | 90% | 6 | −1 | 18 | Puts a blob on a square |
| Magic Fire | 80% | 6 | −1 | 18 | Puts a fire on a square |
| Magic Wood | 80% | 8 | +1 | 17 | Up to 8 trees, placed automatically |
| Shadow Wood | 40% | 8 | −1 | 18 | Up to 8 trees, placed by the caster |
| Magic Castle | 50% | 8 | +1 | 23 | One castle |
| Dark Citadel | 50% | 8 | −1 | 23 | One citadel |
| Wall | 80% | 6 | 0 | 12 | Up to 4 wall squares |
| Magic Bolt | 100% | 6 | 0 | 18 | Attacks one piece (strength 3) |
| Lightning | 100% | 4 | 0 | 18 | Attacks one piece (strength 6) |
| Vengeance | 80% | any | −1 | 12 | Destroys one creature, or a wizard's creations |
| Decree | 80% | any | +1 | 12 | As Vengeance |
| Dark Power | 50% | any | −2 | 11 | As Vengeance, three times |
| Justice | 50% | any | +2 | 11 | As Vengeance, three times |
| Magic Shield | 70% | self | +1 | 23 | +2 defence |
| Magic Armour | 40% | self | +1 | 23 | +4 defence |
| Magic Sword | 40% | self | +1 | 16 | +4 combat, can hit undead |
| Magic Knife | 70% | self | +1 | 16 | +2 combat, can hit undead |
| Magic Bow | 50% | self | +1 | 17 | Ranged combat 3, range 6 |
| Magic Wings | 50% | self | 0 | 14 | Fly up to 6 squares |
| Shadow Form | 70% | self | 0 | 18 | +3 defence, move 3, until the next attack |
| Law-1 | 80% | self | +2 | 5 | Shifts the balance to Law |
| Law-2 | 60% | self | +4 | 6 | Shifts the balance further to Law |
| Chaos-1 | 80% | self | −2 | 5 | Shifts the balance to Chaos |
| Chaos-2 | 60% | self | −4 | 6 | Shifts the balance further to Chaos |
| Subversion | 100% | 7 | 0 | 18 | Takes over an enemy creature |
| Raise Dead | 50% | 4 | −1 | 18 | Brings a corpse back as your undead creature |
| Turmoil | 100% | self | −1 | 17 | Scatters every piece on the board |

### Creature spells (`$9975`)

The creature appears on a square next to the caster (range 1, diagonals
included). The square must be empty or hold a corpse, and must be in sight. A
creature cast on a corpse stands on it; the corpse comes back into view if the
creature later dies without leaving a corpse of its own.

**Gooey Blob** and **Magic Fire** are cast the same way, but up to 6 squares
away.

### Disbelieve (`$99F1`)

Target any creature, anywhere: no range or sight needed. If it is an illusion,
it explodes and the spell succeeds; if it is real, the spell fails. Either way
the creature is marked as tested, so computer wizards won't try to disbelieve it
again. Disbelieve is never used up.

### Magic Wood, Shadow Wood, Magic Castle and Dark Citadel (`$9ADD`)

**Magic Wood** places up to 8 trees automatically, on the free squares
nearest the caster that are in range and in sight. **Shadow Wood**'s 8 trees are
placed by hand.

For both woods, a tree:

- must go on an empty square;
- cannot go next to another tree of either kind.

**Magic Castle** and **Dark Citadel** place one building on an empty square in
range and in sight.

### Wall (`$9B76`)

Up to 4 wall squares, each on an empty square in range and in sight. A wall
cannot go next to the caster.

### Magic Bolt and Lightning (`$9C59`)

Target any piece but the caster, in range and in sight. The hit kills if:

> 3 (Magic Bolt) or 6 (Lightning) + a roll ≥ the target's defence + a roll

A wizard's shield or armour counts towards their defence. These pieces are
immune:

- Magic Fire;
- castles and citadels;
- walls.

A wizard hit this way dies. A creature or tree hit this way vanishes, leaving no
corpse. If a wizard was riding it or sheltering in it, that wizard is left
standing on the square. Bolts work on undead as well.

### Vengeance, Decree, Dark Power and Justice (`$9DE0`)

These first need the casting roll. Then the caster picks a target (three
targets for Dark Power and Justice): any creature or wizard on the board. No
range or line of sight is needed, but objects can't be picked (blobs, fire,
trees, castles, walls).

Each target resists if a roll is at most its magic resistance, that is with
(magic resistance + 1) in 10. If it doesn't resist:

- a **creature** is destroyed, with no corpse. If it was standing on a corpse,
  the corpse rises in its place, as a living creature with the destroyed
  creature's owner. A wizard riding it is left on the square.
- a **wizard** survives, but every creature and object they own vanishes.

### Upgrades: Shield, Armour, Sword, Knife, Bow, Wings, Shadow Form

These affect only the caster; see [Upgrades](#upgrades). A computer wizard
won't cast one they already have.

### Law and Chaos (`$84B0`)

These spells do nothing but move the world balance when they work.

### Subversion (`$84F7`)

Target an enemy creature in range and in sight, with no wizard riding it. The
spell's own casting chance doesn't matter. The creature changes sides if a roll
is at most its magic resistance, that is with (magic resistance + 1) in 10. So
the *more* magic resistance a creature has, the easier it is to subvert (see
[Quirks](#quirks-of-the-original)). Illusions can never be subverted.

### Raise Dead (`$85F6`)

Target a corpse in range and in sight. If the spell works, the creature comes
back to life, owned by the caster, with its full statistics. It is now
**undead**: only the undead and wizards with magic weapons can attack it, and
it leaves no corpse when it dies.

### Turmoil (`$8741`)

If it works, every piece on the board moves to a random empty square: wizards,
creatures, corpses, trees, castles, walls, blobs and fires alike. Each piece
moves once. The random squares are only ever the 64 squares in every other
column of rows 3-10.

In the original the spell often hangs the game. Chaos Online doesn't; see
[TURMOIL_BUG.md](TURMOIL_BUG.md).

## Movement

During their movement phase, a wizard selects their pieces one at a time. Each
piece can move once a turn. A wizard can select:

- their wizard;
- any creature they own;
- their Shadow Wood trees.

Blobs, fire, Magic Wood, castles and walls never move.

### Walking (`$AE50`)

A walking piece has **movement × 2** points:

- a step along a row or column costs 2;
- a diagonal step costs 3.

The piece keeps going while it has points left, and it may always take a step
that costs more than it has left. So a piece with movement 1 takes one step in
any direction. One with movement 3 can take 3 straight steps, 2 diagonal ones,
or a mix.

### Flying (`$B0A8`)

A flyer, or a wizard with Magic Wings, instead picks any square within
**movement × 2 + 1** (13 for wings, which is 6 squares) and goes straight there,
over anything in the way. Its move ends when it lands.

### Engagement

When a piece is selected next to an enemy creature or wizard, it is
**engaged** unless it passes a manoeuvre test. It breaks free if a roll + 2 is
below its manoeuvre, that is with (manoeuvre − 2) in 10. A piece with
manoeuvre 2 or less never breaks free.

- An engaged piece can't move. It can only attack a neighbouring enemy, or stop.
- A walking piece that steps next to an enemy becomes engaged at once, with no
  test. Its walk ends there, but it may still attack.
- A mount carrying a wizard skips the test when selected.

### What a piece can move into

| Destination | Result |
|---|---|
| Empty square, or a corpse | The piece moves there |
| Enemy creature, wizard or Shadow Wood | Attack |
| Enemy Gooey Blob | Attack |
| Magic Wood | A wizard on foot shelters in it if it is empty; otherwise attack |
| Your own mount, with no rider | Your wizard climbs on |
| Your own Magic Castle or Dark Citadel | Your wizard shelters in it |
| Anything else | The move isn't allowed |

"Anything else" includes:

- your own pieces;
- walls;
- Magic Fire;
- other wizards' castles.

### Riding and sheltering

A mount carries its rider. The mount moves, with its own movement and flying,
and the wizard goes with it.

When you select a mount your wizard is riding, the game asks "Dismount wizard?".
- Yes: the wizard steps off one square.
- No: the mount moves with the wizard on it.

A wizard in a wood or castle leaves by being selected, and moves out one square.

While riding or sheltering, the wizard is hidden. Attacks hit the mount, tree or
castle. If that is destroyed, the wizard is left standing on the square,
unhurt.

## Combat

### Close combat (`$B168`)

A piece attacks by moving into an enemy. The attack kills if:

> attacker's combat + weapon bonus + a roll  >  defender's defence + armour bonus + a roll

The "bonus" terms apply only to wizards:
- the weapon bonus is +2 for a Magic Knife and +4 for a Magic Sword;
- the armour bonus is +2 for a Magic Shield or +4 for Magic Armour, plus 3 more
  in Shadow Form.

The defender never strikes back.

Chance to kill, by attack minus defence:

| Attack − defence | −6 | −5 | −4 | −3 | −2 | −1 | 0 | +1 | +2 | +3 | +4 | +5 | +6 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Chance | 6% | 10% | 15% | 21% | 28% | 36% | 45% | 55% | 64% | 72% | 79% | 85% | 90% |

- **If the attack kills**, the attacker moves into the square (Shadow Wood stays
  put), and its move ends.
  - If the target was carrying a wizard, or sheltering one, the wizard is
    revealed and the attacker stays where it was.
  - If the target was a Gooey Blob that had engulfed a creature, that creature
    is set free.
- **If the attack fails**, the attacker's move ends where it is.

Either way, a piece with a ranged attack may then shoot.

**Undead**: a piece that isn't undead can't attack an undead piece ("Undead -
cannot be attacked"), unless it is a wizard with a Magic Knife, Sword or Bow.
Undead can attack anything.

### Ranged combat (`$B8DD`)

After a piece with a ranged attack finishes moving (or chooses not to move), it
may shoot once.

The target must be within **range × 2** (the distance measure) and in line of
sight. The shot uses the same formula as close combat, with ranged combat in
place of combat. The shooter never moves into the square.

How each shooter's shot looks:

- dragons breathe fire;
- the Manticore shoots spines;
- everything else fires an arrow or bolt.

Only these pieces can be harmed by a shot:
- creatures, including a Gooey Blob;
- trees;
- wizards.

Shooting at a corpse, Magic Fire, a castle or a wall does nothing. The undead
rule above applies to shots too.

## Death, corpses and the undead

### Corpses

When a creature is killed in combat, it leaves a **corpse** on its square,
which blocks nothing. These creatures leave no corpse:

- illusions;
- undead (Vampire to Zombie, and raised creatures).

A creature killed by a spell or by fire leaves no corpse either.

A corpse can be:

- walked over;
- covered by a new creature, blob or fire;
- raised with Raise Dead.

### A wizard's death (`$B3C9`, `$B4FA`)

A wizard dies when:

- they lose a combat;
- a Magic Bolt or Lightning gets through;
- a Gooey Blob or Magic Fire spreads onto them (on foot, or on a mount), with no
  roll to survive.

When a wizard dies, everything they own vanishes:

- creatures, woods, castles, walls, blobs and fires;
- creatures they have raised from the dead.

Corpses stay. Wizards riding or sheltering in a vanished piece are revealed.
Creatures trapped in the dead wizard's blobs go free. Their own creatures
trapped in other wizards' blobs vanish.

The same disappearance happens when Vengeance, Decree, Dark Power or Justice
gets through to a wizard, but that wizard lives on.

## Fire, blobs, woods and castles

### Spreading (`$9F50`)

Each turn, before the movement phase, every Gooey Blob and Magic Fire square
that wasn't created by spreading this turn gets a turn.

**1. It tries to spread.** A fire tries 9 times in 10. A blob tries 72 times
in 100: 9 in 10, and then 8 in 10. It picks one of the 8 neighbouring squares at
random. What happens depends on what is there:

| Neighbour | Result |
|---|---|
| Empty square or corpse | Spreads onto it (a corpse there is lost) |
| An enemy wizard, on foot or riding | The wizard dies; it spreads onto the square |
| The owner's own wizard, or one of the owner's pieces | Nothing, and step 2 is skipped |
| Magic Wood, castle, citadel, wall, fire | No spread |
| An enemy creature, for fire | The creature burns if 5 + a roll < its defence + a roll; then it spreads |
| An enemy creature, for a blob | The blob engulfs it; it spreads |
| The edge of the board | Nothing, and step 2 is skipped |

An engulfed creature isn't killed. It waits under the blob, out of play, and
comes back, still owned by its owner, when:

- the blob dies out;
- the blob is killed;
- the blob's owner dies.

**2. It may die out.**

- A fire disappears 2 times in 10.
- A blob disappears 6 times in 100: 2 in 10, and then 3 in 10.

Whatever was under it (an engulfed creature) is left behind.

### Magic Wood gifts (`$8F9A`)

Each turn, every wizard sheltering in a Magic Wood has a 4 in 10 chance of a
new random spell, which can be Turmoil. When it happens, that tree disappears
and the wizard is left standing on its square.

### Castles and citadels

Each turn every Magic Castle and Dark Citadel has a 2 in 10 chance of
vanishing, leaving any wizard in it on the square. A wizard in a castle can't be
attacked or hit by any spell.

### Woods

**Magic Wood** has defence 5. It can be attacked, and a Magic Bolt or Lightning
can destroy it. While a tree shelters a wizard, enemies attack the tree.

**Shadow Wood** has combat 2 and defence 4. It never moves, but each turn its
owner can make each tree attack a neighbouring enemy. Neither kind of tree can
be targeted by Vengeance, Decree, Dark Power or Justice.

## Computer wizards

Computer wizards (`$96F3`, `$C63D`-`$CDD2`) play by these rules.

**Choosing a spell.** At the start of each casting phase, Disbelieve gets a
fresh random priority (12-21). The spell list is sorted by priority, and the
computer tries each spell in turn, casting the first one it can find a use for:

- a creature or blob needs a free square near its chosen target;
- a Magic Bolt needs a target in range and in sight;
- an upgrade needs to be one the wizard doesn't already have;
- a castle needs the wizard not to be in one already;
- and so on.

Woods and walls are placed on the squares nearest the wizard, or nearest the
target.

**Choosing targets.** The computer scores enemy pieces by their value (the
table above), with nearer pieces scoring higher. It scores enemy wizards by the
total value of their armies.

- Creatures and attack spells go for the best-scoring target.
- Subversion and Disbelieve skip creatures they have already tested.
- A shooter goes for the best target its shot can harm. Unless it is a wizard,
  it won't shoot at undead.

**Moving.** The computer moves its wizard first, then every piece it owns, in
board order (left to right, top to bottom).

- A computer wizard that still has creatures moves defensively. It steps into a
  castle or a Magic Wood if one is next to it, otherwise onto its own free
  mount, otherwise to the neighbouring square with the least danger around it.
  The danger is the total score of the enemies near that square.
- A wizard on a flying mount, or with wings, flies to the safest square in
  reach.
- Its creatures head for the most attractive enemy creature. If that
  creature's wizard is nearer, they go for the wizard instead.
- From the 7th turn on, a computer wizard with no creatures left goes on the
  attack. Its wizard and anything it still has head for the strongest enemy
  wizard.

The computer level only affects the wizards' starting statistics and number of
spells (see [Wizards](#wizards)). It doesn't change how they think.

## Quirks of the original

These are part of how Chaos plays, and Chaos Online keeps them (apart from the
Turmoil hang):

- **Humans roll twice for many spells.** A human's chosen spell gets its casting
  roll at the start of the casting step (`$9635`). Many spell routines then roll
  again (`$9760`), and the second roll decides:
  - upgrades;
  - Law and Chaos;
  - Magic Wood;
  - Vengeance, Decree, Dark Power and Justice;
  - Raise Dead;
  - Turmoil.

  The chance of success is the same, but each successful roll moves the world
  balance. So a human's Law-2 that passes both rolls moves it by 8, not 4.
  Computer wizards roll once.
- **Subversion favours magic resistance.** The test is "a roll below magic
  resistance + 1", the same test Vengeance uses to *resist*. A Faun (8) or
  Manticore (8) is easy to subvert, and a Horse (1) is hard.
- **Fire burns the strong.** Magic Fire consumes a creature only when 5 + a roll
  is *below* the creature's defence + a roll. It burns a creature with defence 1
  only about 1 time in 7, but a Dragon (defence 8-9) about 3 times in 4. Wizards
  in its way die regardless.
- **Vengeance raises the dead.** A creature that Vengeance (or Decree, Dark
  Power, Justice) destroys while standing on a corpse is replaced by the
  corpse's creature, alive, with the destroyed creature's owner.
- **No Turmoil at the start.** Spell numbers at the start are drawn from 2-63,
  so Turmoil (64-65) only comes from Magic Wood.
- **Turmoil hangs.** See [TURMOIL_BUG.md](TURMOIL_BUG.md).
- **The balance is one byte.** The world balance runs from −128 to +127. Pushing
  it past either end flips it to the other side. Reaching that takes dozens of
  Law or Chaos spells.
- **The computer's Turmoil test reads the wrong byte.** When deciding whether to
  cast Turmoil, the computer adds the ROM byte at `$2100` to each target's score
  instead of keeping a running total (`LD HL,($A172)` for `LD HL,$A172`).
- **Army values are off by two.** When it rates a wizard's army, the computer
  looks up each piece's value two entries along the table (`$C859`). So, for
  example, a Goblin counts as a Faun would.

## Left out of the original

The original's memory holds a creature and several spells that never made it
into the game. Nothing in the code uses them, so they never appear in Chaos, or
in a normal Chaos Online game. A Chaos Online custom game can add the Troll: it
is then one of the spells a wizard may start with or get from a Magic Wood, and
plays with the statistics and graphics below.

- **The Troll.** A complete piece record (`$E70D`) that the piece table
  (`$E3E0`) never points to, so it can't be cast or appear. Its statistics:

  | Combat | Ranged | Range | Defence | Movement | Manoeuvre | Magic res. | Chance | Align. |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | 4 | 0 | 0 | 8 | 1 | 1 | 4 | 6 | −1 |

  It has its own graphics too: three animation frames of a figure swinging a
  weapon and a corpse (`$F433`-`$F4B2`), in the gap between the Manticore's and
  the Unicorn's.
- **Eight spells.** The spell-name messages include Blind, Tempest, Teleport,
  Dead Revenge, Consecration, Dispel, Counter Spell and Magic Sleep. None has an
  entry in the spell table (`$7D60`) or any code behind it.
- **Sleep.** The square-information line can show "(ASLEEP)" after a creature's
  name, when bit 3 of its owner byte is set. Nothing ever sets that bit, so this
  is presumably what was left of Magic Sleep.

Memory also holds over a hundred of the assembler's labels (such as `WALKY`,
`RAISD` and `GETPL`, around `$A3BE`-`$ABBF`). They aren't part of the game.
