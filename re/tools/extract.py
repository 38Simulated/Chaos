"""Extract game data tables from the Chaos snapshot."""
import json, sys
sys.path.insert(0, r'C:\Development\Chaos\re\tools')
from mem import mem
m = mem()
w = lambda a: m[a] | m[a+1] << 8
def s8(v): return v - 256 if v > 127 else v

def strings_table(base, n):
    out = []
    for i in range(n):
        p = w(base + 4*i); ln = m[base + 4*i + 2]
        out.append((p, ln, bytes(m[p:p+ln]).decode('latin1')))
    return out

if __name__ == '__main__':
    print('== names table $CDD3')
    for i, (p, ln, s) in enumerate(strings_table(0xCDD3, 0x62)):
        print('%02X %04X %2d %r' % (i, p, ln, s))
    print('== messages $8809')
    for i, (p, ln, s) in enumerate(strings_table(0x8809, 0x14)):
        print('%02X %04X %2d %r' % (i, p, ln, s))
    print('== spells $7D60')
    for k in range(1, 0x42):
        a = 0x7D60 + 7*(k-1)
        e = m[a:a+7]
        nm = strings_table(0xCDD3, 0x62)[e[0]][2] if e[0] < 0x62 else '?'
        print('%02X name=%02X %-16s chance=%d range=%d align=%d prio=%d handler=%04X' % (k, e[0], nm.strip(), e[1], e[2], s8(e[3]), e[4], e[5] | e[6] << 8))
