"""Trace every RNG call in the original and the JS port for the same key script
and report the first point where they differ.

    python rngtrace.py OUTDIR TAPE_SEED "keys" [max_frames]
"""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compare as C
from spec import Spectrum
from skoolkit.simutils import PC

SP_REG = 12


def orig_trace(keys, seed, maxf):
    spec = Spectrum(os.path.join(C.ROOT, 're', 'chaos.z80'))
    C.asm_patches(spec)
    tape = C.make_tape(seed)
    for i, b in enumerate(tape):
        spec.mem[C.TAPE + i] = b
    m = spec.mem
    calls = []
    sim = spec.sim
    frames = [0]

    def rw(a):
        return m[a] | m[(a + 1) & 0xFFFF] << 8

    def draw(scr, frame, border, keyboard):
        frames[0] += 1
        st['frame_hit'] = True
        return False

    st = {}

    def run_until_event():
        """Run until an RNG call (returns 'rng') or a frame boundary ('frame')."""
        st['frame_hit'] = False
        spec.exec_map = set()
        sim.trace(sim.registers[PC], C.RNG_NEXT, 0, 0, True, draw, spec.exec_map, spec.kb, None, None)
        if sim.registers[PC] == C.RNG_NEXT and not st['frame_hit']:
            return 'rng'
        return 'frame'

    dump_at = int(os.environ.get('DUMPAT', '-1'))

    def record():
        if len(calls) == dump_at:
            open(os.path.join(os.environ.get('DUMPDIR', '.'), 'orig_at.mem'), 'wb').write(bytes(m))
        sp = sim.registers[SP_REG]
        ret = rw(sp)
        tp = rw(C.TAPE_PTR) - C.TAPE
        if 0x904B <= ret < 0x905D:
            kind, caller = '904B', rw(sp + 4)
        elif 0xBE94 <= ret < 0xBEA3:
            kind, caller = 'BE94', rw(sp + 6)
        else:
            kind, caller = '8D9F', ret
        calls.append((tp, kind, '%04X' % caller, m[C.TAPE + tp % (C.TAPE_END - C.TAPE)],
                      '%04X' % rw(0xAC14), m[0xAC0C], '%04X' % rw(0xAC12)))

    klist = C.key_list(keys)
    ki = 0
    state = 'wait'      # wait -> hold -> settle
    hold = 0
    settle = 0
    polled = False
    while frames[0] < maxf:
        ev = run_until_event()
        if ev == 'rng':
            record()
            continue
        hit = bool(spec.exec_map & C.INPUT_WAIT)
        if os.environ.get('DBG') and frames[0] < 200 and frames[0] % 5 == 0:
            print(' f', frames[0], state, hit, '%04X' % sim.registers[PC], spec.kb)
        if state == 'wait':
            if hit:
                if ki >= len(klist):
                    break
                spec.set_keys(*klist[ki]); ki += 1
                if os.environ.get('DBG'):
                    print('press', klist[ki - 1], frames[0], sorted('%04X' % a for a in spec.exec_map & C.INPUT_WAIT))
                state, hold, polled = 'hold', 0, False
        elif state == 'hold':
            hold += 1
            polled = polled or hit
            if (polled and hold >= 2) or hold >= 30:
                spec.set_keys()
                state, settle = 'settle', 6
        elif state == 'settle':
            settle -= 1
            if settle <= 0:
                state = 'wait'
    print('original: frames %d, keys used %d/%d' % (frames[0], ki, len(klist)))
    return calls


def js_trace(keys, seed, outdir):
    tape = C.make_tape(seed)
    tp = os.path.join(outdir, 'tape.bin')
    open(tp, 'wb').write(tape)
    js = {'seed': 1, 'tape': tp, 'noAnim': True, 'losScreen': True, 'noRedrawBlanks': os.environ.get('RACE') != '1', 'rngTrace': True, 'idleLimit': 50,
          'steps': [{'keys': keys.replace('#', '\x0c')}]}
    jp = os.path.join(outdir, 'js_script.json')
    json.dump(js, open(jp, 'w'))
    r = subprocess.run(['node', os.path.join(C.ROOT, 're', 'tools', 'jsharness.mjs'), jp, outdir],
                       capture_output=True, text=True)
    if r.stderr.strip():
        print('JS stderr:', r.stderr.strip()[-2000:])
    return json.load(open(os.path.join(outdir, 'js_rng.json')))


def main():
    out, seed, keys = sys.argv[1], int(sys.argv[2]), sys.argv[3].encode().decode('unicode_escape')
    maxf = int(sys.argv[4]) if len(sys.argv) > 4 else 300000
    os.makedirs(out, exist_ok=True)
    o = orig_trace(keys, seed, maxf)
    j = js_trace(keys, seed, out)
    json.dump(o, open(os.path.join(out, 'orig_rng.json'), 'w'))
    print('original: %d RNG calls, JS: %d' % (len(o), len(j)))
    for i in range(min(len(o), len(j))):
        if o[i][0] != j[i][0] or o[i][1] != j[i][1] or o[i][4:] != j[i][4:]:
            print('first mismatch at call #%d' % i)
            for k in range(max(0, i - 6), min(i + 4, len(o), len(j))):
                print('  %4d orig %-24s js %s' % (k, o[k], j[k]))
            return
    print('all %d common calls match' % min(len(o), len(j)))


if __name__ == '__main__':
    main()
