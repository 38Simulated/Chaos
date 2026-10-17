"""Make animated GIFs from the sprites that sprites.mjs exported.

    node re/tools/sprites.mjs
    python re/tools/sprite_gifs.py [SPRITES_DIR]     (default: sprites/)

Reads SPRITES_DIR/animations.json and writes SPRITES_DIR/gifs/<name>.gif at
4x size, looping, at the speed the game animates each sprite. Black paper is
transparent.
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


def pixels(image):
    return image.get_flattened_data() if hasattr(image, 'get_flattened_data') else image.getdata()


def paletted(frames):
    """RGBA frames -> paletted frames sharing one palette; index 0 is transparent."""
    colours = {}
    for f in frames:
        for r, g, b, a in pixels(f):
            if a and (r, g, b) not in colours:
                colours[(r, g, b)] = len(colours) + 1
    palette = [0, 0, 0]
    for rgb in colours:
        palette += rgb
    out = []
    for f in frames:
        p = Image.new('P', f.size)
        p.putpalette(palette + [0] * (768 - len(palette)))
        p.putdata([colours[(r, g, b)] if a else 0 for r, g, b, a in pixels(f)])
        out.append(p)
    return out


def main(sprites):
    animations = json.load(open(os.path.join(sprites, 'animations.json')))
    os.makedirs(os.path.join(sprites, 'gifs'), exist_ok=True)
    for anim in animations:
        frames = paletted([Image.open(os.path.join(sprites, f)).convert('RGBA') for f in anim['frames']])
        frames[0].save(os.path.join(sprites, 'gifs', anim['name'] + '.gif'), save_all=True,
                       append_images=frames[1:], duration=anim['ms'], loop=0, transparency=0, disposal=2)
    print(f"{len(animations)} GIFs written to {os.path.join(sprites, 'gifs')}")


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'sprites'))
