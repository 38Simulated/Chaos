import sys
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compare import REGIONS
a = open(sys.argv[1], 'rb').read(); b = open(sys.argv[2], 'rb').read()
for name, s, n in REGIONS + [('C3A4', 0xC3A4, 1), ('9156', 0x9156, 16), ('AC00', 0xAC00, 0x40)]:
    d = [(s + i, a[s + i], b[s + i]) for i in range(n) if a[s + i] != b[s + i]]
    if d: print(name, ' '.join('%04X:%02X/%02X' % x for x in d[:24]))
