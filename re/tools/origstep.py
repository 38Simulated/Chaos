"""Replay the original (same tape/keys as rngtrace) to RNG call N, then stop at
an address repeatedly and print state.

    python origstep.py SEED "keys" RNG_N STOPADDR COUNT [dump=ADDR:LEN,...]
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compare as C
from spec import Spectrum
from skoolkit.simutils import PC


def replay(seed, keys, target):
    spec = Spectrum(os.path.join(C.ROOT, 're', 'chaos.z80'))
    C.asm_patches(spec)
    tape = C.make_tape(seed)
    for i, b in enumerate(tape):
        spec.mem[C.TAPE + i] = b
    sim = spec.sim
    klist = C.key_list(keys); ki = 0; state = 'wait'; hold = 0; settle = 0; polled = False
    ncalls = 0
    def draw(*a): return False
    while ncalls < target:
        spec.exec_map = set()
        sim.trace(sim.registers[PC], C.RNG_NEXT, 0, 0, True, draw, spec.exec_map, spec.kb, None, None)
        if sim.registers[PC] == C.RNG_NEXT:
            ncalls += 1
            continue
        hit = bool(spec.exec_map & C.INPUT_WAIT)
        if state == 'wait':
            if hit and ki < len(klist):
                spec.set_keys(*klist[ki]); ki += 1; state, hold, polled = 'hold', 0, False
        elif state == 'hold':
            hold += 1; polled = polled or hit
            if (polled and hold >= 2) or hold >= 30: spec.set_keys(); state, settle = 'settle', 6
        elif state == 'settle':
            settle -= 1
            if settle <= 0: state = 'wait'
    return spec


if __name__ == '__main__':
    seed, keys, n, stop, count = int(sys.argv[1]), sys.argv[2].encode().decode('unicode_escape'), int(sys.argv[3]), int(sys.argv[4], 16), int(sys.argv[5])
    dumps = []
    for d in sys.argv[6:]:
        a, l = d.split(':'); dumps.append((int(a, 16), int(l, 16)))
    spec = replay(seed, keys, n)
    m = spec.mem; sim = spec.sim
    rw = lambda a: m[a] | m[a + 1] << 8
    def nodraw(*a): return True
    for i in range(count):
        sim.trace(sim.registers[PC], stop, 0, 0, True, None, None, spec.kb, None, None)
        print('hit %04X  AC0E=%d AC12=%04X AC14=%04X CD86=%04X C8B7=%04X C649=%04X AC03=%02X AC0C=%02X' % (
            stop, m[0xAC0E], rw(0xAC12), rw(0xAC14), rw(0xCD86), rw(0xC8B7), rw(0xC649), m[0xAC03], m[0xAC0C]))
        for a, l in dumps:
            print('  %04X: %s' % (a, ' '.join('%02X' % m[a + k] for k in range(l))))
        sim.trace(sim.registers[PC], -1, 1, 0, True, None, None, spec.kb, None, None)
