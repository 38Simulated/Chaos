"""Force-disassemble a range as code: python dis.py START END"""
import subprocess, sys, tempfile, os
s, e = (int(x, 16) for x in sys.argv[1:3])
ctl = tempfile.NamedTemporaryFile('w', suffix='.ctl', delete=False)
ctl.write('c %d\ni %d\n' % (s, e)); ctl.close()
snapshot = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'chaos.z80')
sna2skool = 'import sys; from skoolkit import sna2skool; sna2skool.main(sys.argv[1:])'
out = subprocess.run([sys.executable, '-c', sna2skool, '-H', '-c', ctl.name, '-s', str(s), '-e', str(e),
                      snapshot], capture_output=True, text=True).stdout
os.unlink(ctl.name)
for l in out.split('\n'):
    if l and l[0] not in '@;' and l.strip():
        print(l.rstrip(' ;'))
