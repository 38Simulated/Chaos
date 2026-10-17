"""The original's Turmoil hang (see docs/TURMOIL_BUG.md).

    python turmoil.py boards START COUNT   run Turmoil on random boards
    python turmoil.py squares              squares $904B can give, per seed byte

`boards` runs the original's Turmoil ($874B, after the success roll) on random
boards in the Z80 simulator, with the IM2 board interrupt running every frame
as in the game, and reports a board as hung when no piece has moved for 300
frames (6 seconds). `squares` runs $904B once from each of the 128 values of R
and counts the Turmoil squares the results land on.
"""
import os
import random
import sys

from skoolkit.simulator import Simulator
from skoolkit.simutils import from_snapshot, PC, T, SP, I, IM, IFF, R
from skoolkit.snapshot import Snapshot

SNAPSHOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'chaos.z80')
FRAME = 69888
RET = 0x5CB0        # return address; never executed
BOARD = 0xE01F
LAYERS = [0, 0xA1, 0x141, 0x1E1, 0x281, 0x321]
CREATURES = [2, 5, 8, 0x0C, 0x10, 0x14, 0x18, 0x1C, 0x20]
STUCK = 300         # frames without a piece moving


def simulator():
    return from_snapshot(Simulator, Snapshot.get(SNAPSHOT), {}, {'ay': [None] * 16}, {})


def call(sim, addr):
    m, r = sim.memory, sim.registers
    sp = 0xFF00
    m[sp - 2] = RET & 0xFF
    m[sp - 1] = RET >> 8
    r[SP] = sp - 2
    r[PC] = addr


def random_board(m, rng, nwiz, creatures):
    for i in range(0xA0):
        for k in LAYERS:
            m[BOARD + k + i] = 0
    squares = [i for i in range(0x9F) if (i + 1) % 16]
    rng.shuffle(squares)
    pieces = [(0x29 + w, w) for w in range(nwiz)]
    pieces += [(rng.choice(CREATURES), rng.randrange(nwiz)) for _ in range(creatures)]
    for oid, owner in pieces:
        i = squares.pop()
        m[BOARD + i] = oid
        m[BOARD + LAYERS[3] + i] = owner
        m[BOARD + LAYERS[1] + i] = 1
    m[0xAC0F] = nwiz


def turmoil(seed):
    """(moved, frames, hung) for one random board."""
    rng = random.Random(seed)
    nwiz, creatures = rng.randrange(2, 9), rng.randrange(4, 40)
    sim = simulator()
    m, r = sim.memory, sim.registers
    random_board(m, rng, nwiz, creatures)
    m[0x5C76] = rng.randrange(256)
    r[R] = rng.randrange(256)
    r[I], r[IM], r[IFF] = 9, 2, 1
    call(sim, 0x874B)
    op = sim.opcodes
    t0 = last = r[T]
    next_int = (t0 // FRAME + 1) * FRAME
    moved = 0
    while r[PC] != RET:
        pc = r[PC]
        if pc == 0x87A3:            # found a square for a piece
            last = r[T]
            moved += 1
        elif pc == 0x8756:          # next square of the board
            last = r[T]
        op[m[pc]]()
        if r[T] >= next_int:
            if r[T] < next_int + 32 and r[IFF]:
                sim.accept_interrupt(r, m, pc)
            next_int += FRAME
            if r[T] - last > STUCK * FRAME:
                return nwiz, creatures, moved, (r[T] - t0) / FRAME, True
    return nwiz, creatures, moved, (r[T] - t0) / FRAME, False


def squares():
    sim = simulator()
    m, r = sim.memory, sim.registers
    op = sim.opcodes
    for seed_byte in (0x00, 0x37, 0x5A, 0xA4, 0xFF):
        m[0x5C76] = seed_byte
        found = set()
        for r0 in range(128):
            r[R] = r0
            r[IFF] = 0
            call(sim, 0x904B)
            while r[PC] != RET:
                op[m[r[PC]]]()
            a = (r[0] + m[0x907A]) & 0xFF
            if (a - 0x9F) & 0x80:
                found.add(a)
        print(f'seed byte ${seed_byte:02X}: {len(found)} of the 64 Turmoil squares')


if __name__ == '__main__':
    if sys.argv[1] == 'squares':
        squares()
    else:
        start, count = int(sys.argv[2]), int(sys.argv[3])
        hung = 0
        for seed in range(start, start + count):
            nwiz, creatures, moved, frames, stuck = turmoil(seed)
            hung += stuck
            state = f'HUNG after moving {moved}' if stuck else f'done, moved {moved}'
            print(f'board {seed}: {nwiz} wizards, {creatures} creatures: {state} ({frames:.0f} frames)', flush=True)
        print(f'{hung} of {count} hung')
