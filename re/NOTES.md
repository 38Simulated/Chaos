# Chaos (Firebird re-release) – reverse engineering notes

Snapshot `re/chaos.z80` is taken at PC=$5BB3 just after the loader finishes; the
game loops `CALL $7D00` (→ `JP $89F9`). Game image occupies $7918-$FFFF.

Tooling:
* `re/tools/spec.py` – headless Spectrum (SkoolKit CSimulator) with scripted keys,
  screenshots and execution maps.
* `re/tools/monkey.py` – random-key sessions for coverage; maps in `re/maps/`.
* `re/tools/mem.py ADDR LEN [W]` – hexdump of the snapshot.

## Random numbers
`$904B` returns A=0..9 (also stored at $907A as the raw byte) built from R, FRAMES
and ROM bytes – timing dependent. `$907B` waits for no key and records timing
entropy into a buffer at ($CD86). The remake uses a seeded PRNG.

## Global variables
| addr | meaning |
|------|---------|
| $AC0E | current player (0-7) |
| $AC0F | number of wizards |
| $AC12 | pointer into board layer 0 (current square) |
| $AC14 | |
| $AC16+p | wizard flags: b7 magic armour, b6 shield (armour sets b6+b7), b5 wings, b4 dead, b3 shadow form, b0-2 weapon (2=knife, 4?=sword) |
| $AC1E+p | AI flag (0 / $14) set by $7D04 |
| $AC26+p | computer controlled |
| $AC2E | current player is computer |
| $AC34 | count of dead wizards |
| $7D03 | turn (round) counter |
| $89A7 | computer level (0-7) |
| $9167 | spell succeeded |
| $975F | spell valid/continue flag |
| $C3A4 | |
| $5C8F | ATTR-T used for all printing |

## Board
15x10 board, index 0..159 (stride 16, column 15 unused?). Layers addressed from
$E01F:
* +$000 ($E01F) object id (0 empty; creatures 2..$21?; $24 magic wood; $29+p wizard p)
* +$0A1 ($E0C0)
* +$141 ($E160) frame: 0-3 animation, 4 = dead body
* +$1E1 ($E200) owner b0-2; b3 ?; b4 (prevents subversion – illusion?); b5 (set by raise dead/…, prevents subversion); b6
* +$281 ($E2A0) object underneath (wizard id $29+p when a wizard is in a castle/wood/riding)
* +$321 ($E340)

Object record pointer table at $E3E0 (2 bytes per object id). Record: name(13)
stats(10: combat, ranged, range, defence, move, manoeuvre, magic res, casting
chance, alignment, flags) frames at +$17: 4×(ptr,attr) + dead (ptr,attr).
Wizard records are object ids $28+p in $E3E0 (record+$14 spells?, +$15 ability).

## Messages
`$87EF` prints message A at row/col BC (table at $8809, 4 bytes: ptr, len).
`$02BF` ROM KEYBOARD then LAST-K. `$C5EE` CLS-like. `$BB57` draws border.

## Spell handlers seen
* $836A magic armour, $83D0 magic knife?, $8404 magic shield, $8438 magic wings,
  $846A magic bow (ranged 3 range 6), $84C0 shadow form (zero attrs of frames 1&3)
* $84F7 subversion (target creature, magic resistance roll via $BE0A stat $13)
* $85F6 raise dead (target corpse: frame=4) → frame 0, owner $60+p
* $86C3 raise dead core

## Setup ($89F9)
Titles, wizard count ($89B0 reads key 1-8; $8323 forces ≥2), level, then for each
wizard: name (≤12 chars; letters/space), computer? Y/N, character 1-8 (sprite
table $82C0 + 8*n), colour 1-8 (attr table $90D7).
Stats generated ($8CF5..): see code; spell count = 11 + rnd/2 + level (max 20),
spells drawn from table at $7D60 (7-byte entries) with ids 2..$41.
Wizard start squares table $909F + (n-2)*8.

## Main loop ($8E55)
rounds = 2n+15; each round: $9168, check winner ($AC34+1==n), $9F50, $8F9A
(magic wood new spell 40%), $A173, $AC36, ... After rounds: draw screen.
