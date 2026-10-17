"""Headless ZX Spectrum harness built on SkoolKit's Z80 simulator.

Used to drive the original Chaos snapshot with scripted key presses, record
which addresses execute (for the SkoolKit control file) and capture reference
screenshots to compare against the JavaScript remake.
"""
import io
import sys

from skoolkit import CSimulator
from skoolkit.simulator import Simulator
from skoolkit.simutils import from_snapshot, PC, T
from skoolkit.snapshot import Snapshot, write_snapshot
from skoolkit.trace import Tracer
from skoolkit.components import get_image_writer
from skoolkit.graphics import Frame, scr_udgs

# key -> (half-row index, bit) ; half-row index i corresponds to port (~(1<<i))<<8|0xFE
ROWS = [
    ['CS', 'z', 'x', 'c', 'v'],
    ['a', 's', 'd', 'f', 'g'],
    ['q', 'w', 'e', 'r', 't'],
    ['1', '2', '3', '4', '5'],
    ['0', '9', '8', '7', '6'],
    ['p', 'o', 'i', 'u', 'y'],
    ['ENTER', 'l', 'k', 'j', 'h'],
    ['SPACE', 'SS', 'm', 'n', 'b'],
]
KEYMAP = {k: (r, 1 << b) for r, row in enumerate(ROWS) for b, k in enumerate(row)}


class Spectrum:
    def __init__(self, snapfile):
        snapshot = Snapshot.get(snapfile)
        cls = CSimulator or Simulator
        self.sim = from_snapshot(cls, snapshot, {}, {'ay': [None] * 16}, {})
        self.tracer = Tracer(self.sim, snapshot.border, 0, 0, [0] * 16, 0, False)
        self.sim.set_tracer(self.tracer)
        self.kb = [0] * 8
        self.tracer.keyboard = self.kb
        self.exec_map = set()
        self.mem = self.sim.memory
        self.frames = 0

    @property
    def pc(self):
        return self.sim.registers[PC]

    def set_keys(self, *keys):
        for i in range(8):
            self.kb[i] = 0
        for k in keys:
            r, b = KEYMAP[k]
            self.kb[r] |= b

    def run(self, frames=1, stop=-1, record=True):
        """Run for a number of 50Hz frames (or until PC hits `stop`)."""
        target = [frames]

        def draw(scr, frame, border, keyboard):
            self.frames += 1
            target[0] -= 1
            return target[0] > 0

        exec_map = self.exec_map if record else None
        sim = self.sim
        if hasattr(sim, 'trace'):
            from skoolkit.simutils import PC as _PC
            sim.trace(sim.registers[_PC], stop, 0, 0, True, draw, exec_map, self.kb, None, None)
        else:
            out, sys.stdout = sys.stdout, io.StringIO()
            try:
                self.tracer.keyboard = self.kb
                self.tracer.run(self.pc, stop, 0, 0, True, draw, exec_map, None, None, '', '02X', '04X')
            finally:
                sys.stdout = out

    def press(self, key, hold=3, after=10):
        """Press and release a key (or tuple of keys simultaneously)."""
        keys = key if isinstance(key, tuple) else (key,)
        self.set_keys(*keys)
        self.run(hold)
        self.set_keys()
        self.run(after)

    def type(self, text, hold=3, after=8):
        for ch in text:
            if ch == '\n':
                self.press('ENTER', hold, after)
            elif ch == ' ':
                self.press('SPACE', hold, after)
            elif ch.isupper():
                self.press(('CS', ch.lower()), hold, after)
            else:
                self.press(ch, hold, after)

    def screenshot(self, path, scale=2):
        udgs = scr_udgs(self.mem, 0, 0, 32, 24)
        frame = Frame(udgs, scale)
        with open(path, 'wb') as f:
            get_image_writer().write_image([frame], f)

    def screen_bytes(self):
        return bytes(self.mem[16384:23296])

    def save(self, path):
        snap = Snapshot.get  # noqa
        regs = self.sim.registers
        from skoolkit.simutils import get_state  # noqa
        import skoolkit.snapshot as s
        ram = self.mem[16384:65536]
        registers = ['a={}'.format(regs[0]), 'f={}'.format(regs[1]),
                     'bc={}'.format(regs[2] * 256 + regs[3]), 'de={}'.format(regs[4] * 256 + regs[5]),
                     'hl={}'.format(regs[6] * 256 + regs[7]), 'ix={}'.format(regs[8] * 256 + regs[9]),
                     'iy={}'.format(regs[10] * 256 + regs[11]), 'sp={}'.format(regs[12]),
                     'pc={}'.format(regs[PC])]
        s.write_snapshot(path, ram, registers, ['border=0'])

    def dump_map(self, path):
        with open(path, 'w') as f:
            for a in sorted(self.exec_map):
                f.write('${:04X}\n'.format(a))


if __name__ == '__main__':
    spec = Spectrum(sys.argv[1])
    spec.run(200)
    spec.screenshot(sys.argv[2])
