"""Force-disassemble a range as code: python dis.py START END"""
import subprocess, sys, tempfile, os
s, e = (int(x, 16) for x in sys.argv[1:3])
ctl = tempfile.NamedTemporaryFile('w', suffix='.ctl', delete=False)
ctl.write('c %d\ni %d\n' % (s, e)); ctl.close()
out = subprocess.run(['python', r'C:\Users\steph\AppData\Local\Programs\Python\Python313\Scripts\sna2skool.py', '-H', '-c', ctl.name, '-s', str(s), '-e', str(e),
                      r'C:\Development\Chaos\re\chaos.z80'], capture_output=True, text=True).stdout
os.unlink(ctl.name)
for l in out.split('\n'):
    if l and l[0] not in '@;' and l.strip():
        print(l.rstrip(' ;'))
