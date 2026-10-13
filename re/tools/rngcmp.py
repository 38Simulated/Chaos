"""Re-compare saved traces: python rngcmp.py OUTDIR"""
import json, os, sys
out = sys.argv[1]
o = json.load(open(os.path.join(out, 'orig_rng.json')))
j = json.load(open(os.path.join(out, 'js_rng.json')))
print('original: %d tape bytes, JS: %d' % (len(o), len(j)))
for i in range(min(len(o), len(j))):
    if o[i][0] != j[i][0] or o[i][1] != j[i][1] or o[i][4:] != j[i][4:]:
        print('first mismatch at byte #%d' % i)
        for k in range(max(0, i - 8), min(i + 4, len(o), len(j))):
            print('  %4d orig %-28s js %s' % (k, o[k], j[k]))
        break
else:
    print('all %d common tape reads match' % min(len(o), len(j)))
