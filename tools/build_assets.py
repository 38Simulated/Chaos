"""Build the game's memory image from your own copy of the Chaos tape.

The remake reads graphics, fonts and data tables from the original game's
memory (they are not redistributed with this repository). Run:

    python tools/build_assets.py [path/to/chaos.tap|.tzx|.zip|.z80]

With no argument the script looks for a Chaos tape/zip in the project root or
`re/chaos.z80`. It writes `server/game/static/game/chaos.bin` (64K image: the 48K ROM
followed by RAM $4000-$FFFF taken where the loader hands over to the game).
"""
import glob
import hashlib
import os
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'server', 'game', 'static', 'game', 'chaos.bin')
GAME_START = 0x5BB3  # loader finished; game loops CALL $7D00

# Known-good bytes at the game's main entry, used to sanity-check the image.
SIGNATURE = (0x7D00, bytes([0xC3, 0xF9, 0x89]))


def find_source():
    cands = []
    for pat in ('*.tap', '*.tzx', '*.zip'):
        cands += glob.glob(os.path.join(ROOT, pat))
    cands = [c for c in cands if 'chaos' in os.path.basename(c).lower() and 'space' not in c.lower()]
    if cands:
        return cands[0]
    z80 = os.path.join(ROOT, 're', 'chaos.z80')
    if os.path.exists(z80):
        return z80
    return None


def tap_to_z80(src, workdir):
    if src.lower().endswith('.zip'):
        import zipfile
        with zipfile.ZipFile(src) as z:
            names = [n for n in z.namelist() if n.lower().endswith(('.tap', '.tzx'))]
            if not names:
                sys.exit('No .tap/.tzx inside ' + src)
            path = os.path.join(workdir, 'chaos' + os.path.splitext(names[0])[1].lower())
            with z.open(names[0]) as f, open(path, 'wb') as o:
                shutil.copyfileobj(f, o)
            src = path
    out = os.path.join(workdir, 'chaos.z80')
    from skoolkit import tap2sna
    print('Simulating tape load (this takes a few seconds)...')
    import contextlib, io
    # tap2sna treats 'C:\...' as a URL scheme, so work with relative names.
    if os.path.dirname(os.path.abspath(src)) != os.path.abspath(workdir):
        shutil.copy(src, os.path.join(workdir, 'chaos' + os.path.splitext(src)[1].lower()))
        src = os.path.join(workdir, 'chaos' + os.path.splitext(src)[1].lower())
    cwd = os.getcwd()
    os.chdir(workdir)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            tap2sna.main(['-s', str(GAME_START), '-c', 'finish-tape=1', '-c', 'timeout=900',
                          os.path.basename(src), 'chaos.z80'])
    finally:
        os.chdir(cwd)
    return out


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else find_source()
    if not src:
        sys.exit(__doc__)
    from skoolkit.snapshot import Snapshot
    with tempfile.TemporaryDirectory() as tmp:
        z80 = src if src.lower().endswith(('.z80', '.szx', '.sna')) else tap_to_z80(src, tmp)
        snap = Snapshot.get(z80)
        if snap.pc != GAME_START:
            print('Warning: snapshot PC is %04X, expected %04X' % (snap.pc, GAME_START))
        ram = bytes(snap.ram(-1))
    a, sig = SIGNATURE
    if ram[a - 0x4000:a - 0x4000 + len(sig)] != sig:
        sys.exit('This does not look like the Firebird release of Chaos (signature mismatch).')
    # The game occasionally reads the ROM (e.g. stats of object 0 point there),
    # so the image includes the standard 48K ROM shipped with SkoolKit.
    from skoolkit import ROM48, read_bin_file
    rom = bytes(read_bin_file(ROM48))
    image = rom + ram
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'wb') as f:
        f.write(image)
    print('Wrote %s (%d bytes, md5 %s)' % (OUT, len(image), hashlib.md5(image).hexdigest()))


if __name__ == '__main__':
    main()
