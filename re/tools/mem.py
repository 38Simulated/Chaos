import sys
from skoolkit.snapshot import Snapshot
_m=None
def mem():
    global _m
    if _m is None:
        _m=Snapshot.get(r'C:\Development\Chaos\re\chaos.z80').ram(-1)
        _m=[0]*16384+list(_m)
    return _m
def hexdump(a,n,w=16):
    m=mem()
    for i in range(a,a+n,w):
        row=m[i:i+w]
        print('%04X  %s  %s'%(i,' '.join('%02X'%b for b in row),''.join(chr(b) if 32<=b<127 else '.' for b in row)))
if __name__=='__main__':
    hexdump(int(sys.argv[1],16),int(sys.argv[2],16), int(sys.argv[3]) if len(sys.argv)>3 else 16)
