"""Play the same key script on the original (emulated) and the JS port, with
both driven by the same "random tape", then compare game state and screens.

    python compare.py script.json outdir

script.json: {"tape_seed": 1, "keys": "2...", "hold": 4, "max_frames": 200000}
Keys: characters as typed; '\n' = ENTER, '#' = DELETE. Each key is pressed when
the original is next waiting for input.
"""
import json, os, random, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from spec import Spectrum, KEYMAP

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TAPE = 0x6200
TAPE_END = 0x7800
TAPE_PTR = 0x6100
RNG_NEXT = 0x6000

# game code that reads a fresh key (CALL $02BF / KEY-SCAN in "press a key" loops)
INPUT_WAIT = {0x8508, 0x8607, 0x89B1, 0x8B19, 0x8BCA, 0x8EFC, 0x8F83, 0x9275, 0x92DE, 0x9434,
              0x9490, 0x9842, 0x99FB, 0x9C63, 0x9E0C, 0xACD0, 0xAD96, 0xB0F2, 0xB931, 0xBBBA,
              0xBBF6, 0xBC96, 0xBCA3}


def asm_patches(spec):
    m = spec.mem
    code = [
        0xE5,                   # PUSH HL
        0x2A, 0x00, 0x61,       # LD HL,($6100)
        0x7E,                   # LD A,(HL)
        0x23,                   # INC HL
        0xF5,                   # PUSH AF
        0x7C,                   # LD A,H
        0xFE, TAPE_END >> 8,    # CP $78
        0x20, 0x03,             # JR NZ,+3
        0x21, TAPE & 0xFF, TAPE >> 8,  # LD HL,TAPE
        0x22, 0x00, 0x61,       # LD ($6100),HL
        0xF1,                   # POP AF
        0xE1,                   # POP HL
        0xC9,                   # RET
    ]
    for i, b in enumerate(code):
        m[RNG_NEXT + i] = b
    m[TAPE_PTR] = TAPE & 0xFF
    m[TAPE_PTR + 1] = TAPE >> 8
    # $904B: A = 0..9, raw byte at $907A
    p904b = [0xE5, 0xCD, 0x00, 0x60, 0x32, 0x7A, 0x90, 0xE6, 0x0F, 0xFE, 0x0A,
             0xF2, 0x4C, 0x90, 0x06, 0x00, 0xE1, 0xC9]
    for i, b in enumerate(p904b):
        m[0x904B + i] = b
    # $BE94: A = 0..9
    pbe94 = [0xE5, 0xD5, 0xCD, 0x00, 0x60, 0xE6, 0x0F, 0xFE, 0x0A, 0xF2, 0x96, 0xBE, 0xD1, 0xE1, 0xC9]
    for i, b in enumerate(pbe94):
        m[0xBE94 + i] = b
    # $8D9F: spell id = next & $3F, retry if < 2
    p8d9f = [0xCD, 0x00, 0x60, 0xE6, 0x3F, 0xFE, 0x02, 0xFA, 0x9F, 0x8D, 0x2A, 0x86, 0xCD, 0xC3, 0xB8, 0x8D]
    for i, b in enumerate(p8d9f):
        m[0x8D9F + i] = b
    # board animation: keep every creature on frame 0 (so line of sight matches)
    m[0xDFD6] = 0x01      # CP $04 -> CP $01 in $DF72
    if os.environ.get('RACE') != '1':
        # The IM2 handler clobbers $E005 (shared with $C703's coordinate
        # conversion): wrap it so it preserves $E005.
        wrap = [0xE5, 0x2A, 0x05, 0xE0, 0xE5, 0xCD, 0x72, 0xDF, 0xE1, 0x22, 0x05, 0xE0, 0xE1, 0xC9]
        for i, b in enumerate(wrap):
            m[0x6040 + i] = b
        m[0xFE6B] = 0x40; m[0xFE6C] = 0x60      # FE6A: CALL $6040 instead of CALL $DF0C
        # Remove the "object id 1 until the next interrupt" race: write 0
        # instead of 1 wherever a square is blanked (display may show ghosts).
        for a in (0x9D70, 0xA102, 0xA14D, 0xAFBE, 0xB351, 0xC0F5):
            m[a] = 0x00


def make_tape(seed):
    rnd = random.Random(seed)
    return bytes(rnd.randrange(256) for _ in range(TAPE_END - TAPE))


def key_list(text):
    out = []
    for ch in text:
        if ch == '\n':
            out.append(('ENTER',))
        elif ch == ' ':
            out.append(('SPACE',))
        elif ch == '#':
            out.append(('CS', '0'))
        else:
            out.append((ch.lower(),))
    return out


def run_original(script, outdir):
    spec = Spectrum(os.path.join(ROOT, 're', 'chaos.z80'))
    asm_patches(spec)
    tape = make_tape(script.get('tape_seed', 1))
    for i, b in enumerate(tape):
        spec.mem[TAPE + i] = b
    hold = script.get('hold', 4)
    frames = 0
    maxf = script.get('max_frames', 200000)
    shots = []

    def wait_input():
        nonlocal frames
        while frames < maxf:
            spec.exec_map = set()
            spec.run(1)
            frames += 1
            if spec.exec_map & INPUT_WAIT:
                return True
        return False

    log = []
    for k in key_list(script['keys']):
        if not wait_input():
            print('original: timed out waiting for input')
            break
        tp = spec.mem[TAPE_PTR] | spec.mem[TAPE_PTR + 1] << 8
        log.append((k, tp - TAPE, state_hash(spec.mem), sorted('%04X' % a for a in spec.exec_map & INPUT_WAIT), '%04X' % spec.pc))
        if script.get('shots'):
            spec.screenshot(os.path.join(outdir, 'o%03d.png' % (len(log) - 1)), 1)
            open(os.path.join(outdir, 'o%03d.mem' % (len(log) - 1)), 'wb').write(bytes(spec.mem))
        spec.set_keys(*k)
        # hold the key until the game has polled the keyboard while it was down
        polled = False
        for f in range(30):
            spec.exec_map = set()
            spec.run(1); frames += 1
            polled = polled or bool(spec.exec_map & INPUT_WAIT)
            if polled and f >= 1:
                break
        spec.set_keys()
        # let the ROM's key slots ($5C00 KSTATE) free up before the next key
        spec.run(6); frames += 6
    wait_input()
    spec.run(script.get('settle', 50))
    spec.screenshot(os.path.join(outdir, 'orig.png'))
    with open(os.path.join(outdir, 'orig_mem.bin'), 'wb') as f:
        f.write(bytes(spec.mem))
    with open(os.path.join(outdir, 'orig_log.json'), 'w') as f:
        json.dump(log, f)
    return bytes(spec.mem), tape


def state_hash(mem):
    import hashlib
    h = hashlib.md5()
    for name, a, n in REGIONS:
        blk = bytes(mem[a:a + n])
        if name == 'board L0':
            blk = bytes(0 if v == 1 else v for v in blk)
        if name == 'board L2':
            blk = bytes(4 if v == 4 else 0 for v in blk)
        if name == 'board L3':
            blk = bytes(v & 0x7F for v in blk)
        if name.startswith('vars'):
            continue
        h.update(blk)
    return h.hexdigest()[:8]


def run_js(script, outdir, tape):
    with open(os.path.join(outdir, 'tape.bin'), 'wb') as f:
        f.write(tape)
    js = {'seed': 1, 'tape': os.path.join(outdir, 'tape.bin'), 'noAnim': True, 'losScreen': True, 'noRedrawBlanks': os.environ.get('RACE') != '1', 'shots': script.get('shots', False),
          'steps': [{'keys': script['keys'].replace('#', '\x0c')}], 'idleLimit': script.get('idle', 50)}
    jpath = os.path.join(outdir, 'js_script.json')
    with open(jpath, 'w') as f:
        json.dump(js, f)
    r = subprocess.run(['node', os.path.join(ROOT, 're', 'tools', 'jsharness.mjs'), jpath, outdir],
                       capture_output=True, text=True)
    if r.stdout.strip():
        print(r.stdout.strip())
    if r.stderr.strip():
        print('JS stderr:', r.stderr.strip()[-3000:])
    with open(os.path.join(outdir, 'mem.bin'), 'rb') as f:
        return f.read()


REGIONS = [
    ('board L0', 0xE01F, 0xA0), ('board L2', 0xE160, 0xA0), ('board L3', 0xE200, 0xA0),
    ('board L4', 0xE2A0, 0xA0), ('board L5', 0xE340, 0xA0),
    ('vars AC00', 0xAC00, 0x36), ('spell lists', 0x7F47, 0x141), ('balance', 0xC3A4, 1),
    ('round', 0x7D03, 1), ('wizard records', 0xEA39, 0x26 * 8),
]


def compare(orig, js):
    ok = True
    for name, a, n in REGIONS:
        o, j = orig[a:a + n], js[a:a + n]
        if name == 'board L0':
            o = bytes(0 if v == 1 else v for v in o)
        if name == 'board L2':
            o = bytes(4 if v == 4 else 0 for v in o)
            j = bytes(4 if v == 4 else 0 for v in j)
        if name == 'board L3':
            o = bytes(v & 0x7F for v in o); j = bytes(v & 0x7F for v in j)
        diffs = [(a + i, o[i], j[i]) for i in range(n) if o[i] != j[i]]
        if diffs:
            ok = False
            print('%-14s %d diffs: %s' % (name, len(diffs), ' '.join('%04X:%02X/%02X' % d for d in diffs[:12])))
    scr = sum(1 for i in range(6912) if orig[0x4000 + i] != js[0x4000 + i])
    print('screen bytes differing: %d' % scr)
    return ok


def main():
    script = json.load(open(sys.argv[1]))
    outdir = sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    orig, tape = run_original(script, outdir)
    js = run_js(script, outdir, tape)
    subprocess.run(['python', os.path.join(os.path.dirname(sys.executable), 'Scripts', 'sna2img.py'),
                    os.path.join(outdir, 'final.scr'), os.path.join(outdir, 'js.png')], capture_output=True)
    ol = json.load(open(os.path.join(outdir, 'orig_log.json')))
    jl = json.load(open(os.path.join(outdir, 'js_log.json'))) if os.path.exists(os.path.join(outdir, 'js_log.json')) else []
    for i in range(max(len(ol), len(jl))):
        o = ol[i] if i < len(ol) else None
        j = jl[i] if i < len(jl) else None
        same = o and j and o[1] == j[1] and o[2] == j[2]
        if not same:
            print('first log mismatch at key #%d: orig=%s js=%s' % (i, o, j))
            break
    ok = compare(orig, js)
    print('MATCH' if ok else 'DIFFERENT')


if __name__ == '__main__':
    main()
