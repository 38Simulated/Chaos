"""Replay the original to RNG call N, then single-step and report whenever PC
hits one of the given addresses (up to LIMIT instructions).

    python origwatch.py SEED "keys" RNG_N LIMIT ADDR[,ADDR...] [dump=ADDR:LEN ...]
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compare as C
from origstep import replay
from skoolkit.simutils import PC

seed, keys, n, limit = int(sys.argv[1]), sys.argv[2].encode().decode('unicode_escape'), int(sys.argv[3]), int(sys.argv[4])
addrs = {int(a, 16) for a in sys.argv[5].split(',')}
dumps = [(int(d.split(':')[0], 16), int(d.split(':')[1], 16)) for d in sys.argv[6:]]
spec = replay(seed, keys, n)
m = spec.mem; sim = spec.sim
rw = lambda a: m[a] | m[a + 1] << 8
r = sim.registers
for i in range(limit):
    sim.trace(r[PC], -1, 1, 0, True, None, None, spec.kb, None, None)
    pc = r[PC]
    if pc in addrs:
        print('%04X A=%02X BC=%02X%02X HL=%02X%02X AC12=%04X AC14=%04X CD86=%04X BC94=%04X B754=%02X' % (
            pc, r[0], r[2], r[3], r[6], r[7], rw(0xAC12), rw(0xAC14), rw(0xCD86), rw(0xBC94), m[0xB754]))
        for a, l in dumps:
            print('   %04X: %s' % (a, ' '.join('%02X' % m[a + k] for k in range(l))))
        if os.environ.get('SAVE_AT') and int(os.environ['SAVE_AT'], 16) == pc and not os.path.exists(os.environ['SAVE_TO']):
            open(os.environ['SAVE_TO'], 'wb').write(bytes(m))
        if pc == C.RNG_NEXT:
            break
