"""Random-key play sessions against the original game to maximise code coverage."""
import random, sys
sys.path.insert(0, r'C:\Development\Chaos\re\tools')
from spec import Spectrum

KEYS = list('0123456789qwedcxzaskiyn') + ['ENTER', 'SPACE'] + list('qwedcxzasqwedcxzas')

def session(seed, nw, humans, frames, outmap):
    rnd = random.Random(seed)
    s = Spectrum(r'C:\Development\Chaos\re\chaos.z80')
    s.run(200); s.press(str(nw), after=30); s.press(str(rnd.randint(1, 8)), after=100)
    for i in range(nw):
        s.type('P' + chr(65 + i) + '\n', hold=4, after=20); s.run(20)
        s.press('n' if i < humans else 'y', after=40)
        s.press(str(rnd.randint(1, 8)), after=40); s.press(str(i % 8 + 1), after=60)
    done = 0
    while done < frames:
        k = rnd.choice(KEYS)
        hold = rnd.choice([2, 3, 4, 6])
        after = rnd.choice([4, 8, 15, 30])
        s.press(k, hold, after)
        done += hold + after
    s.dump_map(outmap)
    return len(s.exec_map)

if __name__ == '__main__':
    seed, nw, humans, frames, out = sys.argv[1:6]
    print(session(int(seed), int(nw), int(humans), int(frames), out))
