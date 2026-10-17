"""python runcmp.py OUTDIR TAPE_SEED "keys with \n escapes" [max_frames]"""
import json, os, subprocess, sys
out, seed, keys = sys.argv[1], int(sys.argv[2]), sys.argv[3].encode().decode('unicode_escape')
os.makedirs(out, exist_ok=True)
sc = {'tape_seed': seed, 'keys': keys}
if len(sys.argv) > 4: sc['max_frames'] = int(sys.argv[4])
sc['shots'] = os.environ.get('SHOTS') == '1'
json.dump(sc, open(os.path.join(out, 's.json'), 'w'))
here = os.path.dirname(os.path.abspath(__file__))
subprocess.run([sys.executable, os.path.join(here, 'compare.py'), os.path.join(out, 's.json'), out])
from PIL import Image
a, b = Image.open(os.path.join(out, 'orig.png')).convert('RGB'), Image.open(os.path.join(out, 'js.png')).convert('RGB')
b = b.resize(a.size, Image.NEAREST)
S = Image.new('RGB', (a.width * 2 + 8, a.height), (128, 128, 128)); S.paste(a, (0, 0)); S.paste(b, (a.width + 8, 0))
S.save(os.path.join(out, 'both.png'))
