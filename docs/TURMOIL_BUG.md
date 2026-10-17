# The Turmoil hang in the Spectrum original

On the ZX Spectrum, casting Turmoil often froze the game for good. The board kept
animating, but the game never moved on, and the only way out was to reset the
machine. This note explains why, from the original's code (`re/chaos.z80`) run
in a Z80 simulator, and what Chaos Online does instead.

In short: Turmoil moves every piece to a random empty square, and keeps picking
squares until it finds an empty one. The original's random numbers come from
the Z80's R register, so while Turmoil runs they can only ever reach about 25 of
the squares Turmoil can use. Turmoil fills those squares itself as it moves the
pieces, and once they are all taken it picks occupied squares forever.

## How Turmoil works

Turmoil is the routine at `$8741` (a computer wizard first decides whether to
cast it at `$86EF`). After the success roll it goes through the board square by
square. Every piece that has not moved yet (corpses, trees and castles included)
is moved:

```
$8784 CALL $904B        ; A = random 0-9; the whole random byte is left at $907A
      LD HL,$907A
      ADD A,(HL)        ; A = byte + (byte AND $0F): the target square
      CP $9F
      JP P,$8784        ; off the board: try again
      ...               ; HL = the square
      LD A,(HL)
      OR A
      JR NZ,$8784       ; square taken: try again
      CALL $980E
      JR Z,$8784        ; (never true for these squares)
      CALL $A18A        ; the casting beam, then the piece moves
```

The loop has no way out except finding an empty square.

Two quirks limit which squares Turmoil can ever use:

- **Only even squares.** The random byte's low four bits are 0-9, so adding them
  to the byte doubles them: byte `16h + l` becomes square `16h + 2l`, which is
  always even. Squares are numbered across each row of 16 (15 columns plus an
  unused one), so pieces only land in the 1st, 3rd, 5th ... 15th columns.
- **Never the top two rows.** `CP $9F` / `JP P` tests the sign of `A - $9F`,
  not whether A is below `$9F`. That also rejects `$00`-`$1E`, the top two
  rows.

That leaves 64 squares: every other column of rows 3-10. Chaos Online keeps
both quirks, since they are part of how the spell plays.

## The random numbers

`$904B` makes its numbers from the R register:

```
$904C LD A,R            ; R
      LD HL,$5C76
      ADD A,(HL)        ; + the seed byte
      OR $80
      LD B,A            ; a delay of 128-255 rounds of 15 NOPs
      ... delay ...
      LD A,R
      AND $07
      LD H,A
      LD A,R
      LD L,A            ; HL = a ROM address picked by R
      LD A,R
      ADD A,(HL)
      ADD A,(HL)        ; R + 2 x the ROM byte
      LD HL,$5C76
      ADD A,(HL)        ; + the seed byte
      LD ($907A),A
      AND $0F
      CP $0A
      JP P,$904C        ; 10-15: try again
```

R is a 7-bit counter that the Z80 steps on every instruction fetch. It is not
random: it only counts how many instructions have run. Everything `$904B` does
after its first `LD A,R` follows from that one value, because the length of the
delay, the ROM address and every later read of R depend only on it. The seed
byte at `$5C76` is set from how long a human player takes to press a key
(`$BBB0` and `$BBCC` count while they wait), and no key is read during Turmoil.
So for the whole spell, each call's result depends only on R when it starts,
which has 128 possible values.

Run from each of the 128 values of R, `$904B` reaches only about a third of
Turmoil's 64 squares (`python re/tools/turmoil.py squares`):

| Seed byte | Turmoil squares it can reach |
|-----------|------------------------------|
| `$00`     | 25 of 64                     |
| `$37`     | 22 of 64                     |
| `$5A`     | 28 of 64                     |
| `$A4`     | 29 of 64                     |
| `$FF`     | 25 of 64                     |

During the retry loop R is not even that free. Between one call and the next,
the loop runs a fixed sequence of instructions, so R at the next call follows
from R at this one. The board interrupt (50 times a second) adds its own
instructions, and so stirs R a little, but how many it runs is also fixed by the
board. The loop goes round the same small set of R values.

## Why it hangs

Each piece Turmoil moves lands on one of the few squares the random numbers can
reach, and stays there for the rest of the spell. With every move, fewer of
those squares are free. Once all of them are taken, the loop only ever picks
squares that are off the board or occupied, and never ends. Squares that
are free but out of the random numbers' reach make no difference.

Boards with a couple of dozen pieces or more fill the reachable squares before
every piece has moved. Smaller boards finish.

## Evidence

`re/tools/turmoil.py boards` runs the original's Turmoil on random boards in the
simulator (SkoolKit's Z80), with the board interrupt running every frame as in
the game. It counts a board as hung when no piece has moved for 6 seconds.
Results for boards 0-19, sorted by the number of pieces (wizards and creatures):

| Pieces | Boards | Result |
|--------|--------|--------|
| 7-17   | 1, 2, 6, 7, 10, 15, 18, 19 | all finished |
| 26     | 4, 5, 12, 13 | all finished |
| 30-44  | 0, 3, 8, 9, 11, 14, 16, 17 | all hung, after moving 14-33 pieces |

8 of the 20 boards hung, and every board of 30 or more pieces did. A late-game
board with a few wizards, their creatures, corpses and some Magic Wood easily
has that many.

One hung board was traced for over 2 minutes of game time after it stuck (about
6,500 frames and 3,000 random numbers, with the interrupt running throughout):

- 33 of Turmoil's 64 squares were free.
- R was 77 different values when `$904B` started, and they gave 57 different
  squares. Of those, 24 were Turmoil squares, and all 24 were occupied.
- Not one of the 3,000 random numbers picked a free square.

Given 60 seconds without progress instead of 6, the same board moved 3 more
pieces and then stuck for a full minute. The interrupt's stirring can, rarely,
reach another square, but in practice the game is frozen.

## Chaos Online

Chaos Online uses a seeded random number generator (the same in every player's
browser) instead of R, so every one of Turmoil's 64 squares can come up. On
3,000 random boards, Turmoil never got stuck while a usable square was free.

It could still have looped forever when all 64 squares were taken, at about 56
pieces or more. The original would hang then too. In a shared game that would
be worse than on a Spectrum: every player's browser freezes at the same point,
and reloading replays the game into the same freeze. So when none of the 64
squares is free, the piece stays where it is (`r_8741` in
`server/game/static/game/js/engine/spells.js`). This uses no random numbers,
so every game that did not hang plays out exactly as before.
