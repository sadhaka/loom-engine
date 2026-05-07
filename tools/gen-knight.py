#!/usr/bin/env python3
# Loom Engine - placeholder knight walk-cycle generator.
#
# Emits assets/knight/walk.png and assets/knight/walk.json. Programmer
# art - Veil-flavored weaver tones (muted violet body, teal cloak,
# glowing eye-slit) so the demo asset reads as "Loom Engine" rather
# than a generic chrome knight. Re-run any time to regenerate.
#
# Layout: 4 frames of 16x32, packed horizontally into a 64x32 sheet.
# Walk cycle: passing -> right contact -> passing (bob) -> left contact.
#
# Usage:
#   python tools/gen-knight.py
#
# Requires: Pillow (pip install pillow). Tested with Pillow 12.

import json
import os
import sys
from PIL import Image, ImageDraw

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
OUT_PNG = os.path.join(REPO_ROOT, 'assets', 'knight', 'walk.png')
OUT_JSON = os.path.join(REPO_ROOT, 'assets', 'knight', 'walk.json')

FRAME_W = 16
FRAME_H = 32
FRAMES = 4
SHEET_W = FRAME_W * FRAMES
SHEET_H = FRAME_H

# Veil-weaver palette. Muted violet body, teal cloak, dark indigo
# outline, glowing eye-slit. No bright primaries - the silhouette
# should read as "thread-thing in armor" not "shiny paladin".
COL_OUTLINE = (26, 24, 48, 255)        # #1a1830 dark indigo
COL_BODY = (90, 58, 122, 255)          # #5a3a7a muted violet
COL_BODY_DARK = (60, 38, 88, 255)      # #3c2658 violet shadow
COL_CLOAK = (58, 122, 106, 255)        # #3a7a6a teal cloak
COL_CLOAK_DARK = (36, 80, 70, 255)     # #245046 teal shadow
COL_EYE_SLIT = (170, 255, 238, 255)    # #aaffee glowing pale cyan
COL_HELM = (74, 50, 100, 255)          # #4a3264 helm violet
COL_HELM_HIGHLIGHT = (130, 100, 170, 255)  # #8264aa helm rim


def paint_frame(img, fx, leg_offset, body_bob):
    """Paint one walk frame at horizontal offset fx in the sheet.

    leg_offset:  -1 left leg forward, 0 passing, +1 right leg forward
    body_bob:    0 base, 1 lifted by one pixel (passing poses)
    """
    px = img.load()
    if px is None:
        raise RuntimeError('PIL image load() returned None')

    # Convenience: write a pixel at frame-local (x, y) into sheet coords.
    def p(x, y, color):
        if 0 <= x < FRAME_W and 0 <= y < FRAME_H:
            px[fx + x, y] = color

    def fill_rect(x0, y0, x1, y1, color):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                p(x, y, color)

    # Vertical body lift for passing-pose bob (1px up).
    by = -body_bob

    # ---- Cloak (drawn first, behind body silhouette) ----
    # Trapezoidal cape behind torso, slight wave per frame.
    cloak_top_y = 12 + by
    cloak_bot_y = 26
    for y in range(cloak_top_y, cloak_bot_y + 1):
        # Cape widens toward the bottom.
        spread = (y - cloak_top_y) // 3
        x0 = 4 - spread
        x1 = 11 + spread
        for x in range(x0, x1 + 1):
            # Subtle vertical shading.
            c = COL_CLOAK if (x + y) % 3 != 0 else COL_CLOAK_DARK
            p(x, y, c)
    # Cloak outline.
    for y in range(cloak_top_y, cloak_bot_y + 1):
        spread = (y - cloak_top_y) // 3
        p(4 - spread, y, COL_OUTLINE)
        p(11 + spread, y, COL_OUTLINE)
    # Cloak hem.
    for x in range(2, 14):
        p(x, cloak_bot_y + 1, COL_OUTLINE)

    # ---- Body (torso) ----
    fill_rect(5, 14 + by, 10, 22 + by, COL_BODY)
    # Side shading.
    for y in range(14 + by, 23 + by):
        p(5, y, COL_BODY_DARK)
        p(10, y, COL_BODY_DARK)
    # Torso outline.
    fill_rect(5, 13 + by, 10, 13 + by, COL_OUTLINE)  # top edge
    p(4, 14 + by, COL_OUTLINE)
    p(11, 14 + by, COL_OUTLINE)
    p(4, 22 + by, COL_OUTLINE)
    p(11, 22 + by, COL_OUTLINE)

    # ---- Helm ----
    fill_rect(5, 6 + by, 10, 11 + by, COL_HELM)
    # Helm rim highlight along the top.
    fill_rect(5, 6 + by, 10, 6 + by, COL_HELM_HIGHLIGHT)
    # Outline.
    fill_rect(4, 6 + by, 4, 11 + by, COL_OUTLINE)
    fill_rect(11, 6 + by, 11, 11 + by, COL_OUTLINE)
    fill_rect(5, 5 + by, 10, 5 + by, COL_OUTLINE)
    # Eye-slit (glowing pale cyan).
    fill_rect(6, 9 + by, 9, 9 + by, COL_EYE_SLIT)

    # ---- Pauldron / shoulder caps ----
    fill_rect(3, 13 + by, 4, 15 + by, COL_HELM)
    fill_rect(11, 13 + by, 12, 15 + by, COL_HELM)
    # Shoulder outlines.
    p(2, 14 + by, COL_OUTLINE)
    p(2, 15 + by, COL_OUTLINE)
    p(13, 14 + by, COL_OUTLINE)
    p(13, 15 + by, COL_OUTLINE)
    p(3, 16 + by, COL_OUTLINE)
    p(12, 16 + by, COL_OUTLINE)

    # ---- Legs (the actual walk-cycle motion) ----
    # Left leg
    if leg_offset == -1:
        # Left forward.
        fill_rect(5, 23 + by, 6, 28, COL_BODY_DARK)
        fill_rect(5, 29, 7, 30, COL_BODY_DARK)  # foot extended
        p(4, 28, COL_OUTLINE)
        p(8, 30, COL_OUTLINE)
    elif leg_offset == 1:
        # Left back.
        fill_rect(5, 23 + by, 6, 30, COL_BODY_DARK)
        fill_rect(4, 30, 6, 30, COL_BODY_DARK)
        p(3, 30, COL_OUTLINE)
    else:
        # Passing.
        fill_rect(5, 23 + by, 6, 30, COL_BODY_DARK)
        p(4, 30, COL_OUTLINE)
        p(7, 30, COL_OUTLINE)

    # Right leg
    if leg_offset == 1:
        # Right forward.
        fill_rect(9, 23 + by, 10, 28, COL_BODY_DARK)
        fill_rect(8, 29, 10, 30, COL_BODY_DARK)
        p(7, 30, COL_OUTLINE)
        p(11, 30, COL_OUTLINE)
    elif leg_offset == -1:
        # Right back.
        fill_rect(9, 23 + by, 10, 30, COL_BODY_DARK)
        fill_rect(9, 30, 11, 30, COL_BODY_DARK)
        p(12, 30, COL_OUTLINE)
    else:
        # Passing.
        fill_rect(9, 23 + by, 10, 30, COL_BODY_DARK)
        p(8, 30, COL_OUTLINE)
        p(11, 30, COL_OUTLINE)

    # ---- Sword on the right hip, swings counter to legs ----
    sword_x = 12 if leg_offset != 1 else 13
    fill_rect(sword_x, 14 + by, sword_x, 24 + by, COL_HELM_HIGHLIGHT)
    p(sword_x, 13 + by, COL_OUTLINE)  # pommel
    p(sword_x - 1, 13 + by, COL_OUTLINE)
    p(sword_x + 1, 13 + by, COL_OUTLINE)


def main():
    img = Image.new('RGBA', (SHEET_W, SHEET_H), (0, 0, 0, 0))

    # Frame 0: passing (right arm forward feel via sword position).
    paint_frame(img, 0, leg_offset=0, body_bob=1)
    # Frame 1: right leg forward (contact).
    paint_frame(img, FRAME_W, leg_offset=1, body_bob=0)
    # Frame 2: passing again (mirror bob phase).
    paint_frame(img, FRAME_W * 2, leg_offset=0, body_bob=1)
    # Frame 3: left leg forward (contact).
    paint_frame(img, FRAME_W * 3, leg_offset=-1, body_bob=0)

    os.makedirs(os.path.dirname(OUT_PNG), exist_ok=True)
    img.save(OUT_PNG, 'PNG')

    manifest = {
        'name': 'knight-walk',
        'image': 'walk.png',
        'frames': [
            {'x': 0,            'y': 0, 'w': FRAME_W, 'h': FRAME_H, 'name': 'walk_pass_a',  'duration_ms': 140},
            {'x': FRAME_W,      'y': 0, 'w': FRAME_W, 'h': FRAME_H, 'name': 'walk_right',   'duration_ms': 140},
            {'x': FRAME_W * 2,  'y': 0, 'w': FRAME_W, 'h': FRAME_H, 'name': 'walk_pass_b',  'duration_ms': 140},
            {'x': FRAME_W * 3,  'y': 0, 'w': FRAME_W, 'h': FRAME_H, 'name': 'walk_left',    'duration_ms': 140},
        ],
        # Bottom-center anchor matches Canvas2DDevice.drawSprite which
        # draws sprites centered horizontally and anchored at the feet.
        'anchor': {'x': FRAME_W // 2, 'y': FRAME_H},
        'fps': 8,
    }
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')

    print('wrote', OUT_PNG, '({} x {})'.format(SHEET_W, SHEET_H))
    print('wrote', OUT_JSON)


if __name__ == '__main__':
    sys.exit(main() or 0)
