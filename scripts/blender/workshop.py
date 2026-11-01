"""
The workshop around the winding machine, built in Blender.

Run headless from the repo root:

    blender -b -P scripts/blender/workshop.py -- /tmp/workshop.glb

A steel portal-frame shop: I-section columns, Pratt roof trusses, purlins,
dark cladding with high window strips, skylight panels, high-bay lamps and
an overhead travelling crane on runway girders. Over the machine, a
trimmed roof opening with two hatch doors (exported as separate objects,
ws_hatch_l and ws_hatch_r, that three.js slides apart during the lift).
The floor is dressed as a filament-winding shop: racks of glass-roving
packages, resin drums, FRP pipe on cradles, finished duct sections and
walkway lines.

Materials named ws_glow_* are light sources; three.js draws them unlit at
the workshop's light level. Plans are in three.js terms with the floor at
y = 0 (three.js lowers the model to its floor); in Blender that's
(x, -z, y). Opening and roof heights match src/scripts/winding.ts.
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import Acc, hexc, material  # noqa: E402

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "workshop.glb"

HALF_W = 15.0  # columns at x = ±15
EAVE = 11.6  # top chord at the columns
RIDGE = 13.0  # top chord at the ridge (x = 0)
BOTTOM = 10.4  # bottom chord
FRAMES_Z = [-21, -15, -9, -3, 3, 9, 15]
OPEN_X = (-5.0, 2.0)  # roof opening over the machine (between the frames at z = ±3)
OPEN_Z = (-2.6, 2.6)
CURB = 0.35  # upstand round the opening
rnd = random.Random(4)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def W(x, y, z):
    """three.js (x, y, z), floor at 0 → Blender."""
    return Vector((x, -z, y))


def roof_y(x):
    """Top-chord height across the span."""
    return RIDGE - (RIDGE - EAVE) * abs(x) / HALF_W


ACC = {
    "steel": (Acc("ws_steel"), material("ws_steel", 0.6, metal=0.45)),
    "clad": (Acc("ws_clad"), material("ws_clad", 0.8, metal=0.2)),
    "crane": (Acc("ws_crane"), material("ws_crane", 0.55, metal=0.25)),
    "misc": (Acc("ws_misc"), material("ws_misc", 0.7)),
    "frp": (Acc("ws_frp"), material("ws_frp", 0.4, coat=0.5)),
    "floor": (Acc("ws_floor"), material("ws_floor", 0.6)),
    "glow_window": (Acc("ws_glow_window"), material("ws_glow_window", 1.0)),
    "glow_sky": (Acc("ws_glow_sky"), material("ws_glow_sky", 1.0)),
    "glow_lamp": (Acc("ws_glow_lamp"), material("ws_glow_lamp", 1.0)),
}


def acc(k):
    return ACC[k][0]


def box(k, c, size, rgb, rot=0.0):
    """Box with its size in three.js order (width x, height y, depth z)."""
    a = k if isinstance(k, Acc) else acc(k)
    a.box(c, (size[0], size[2], size[1]), rgb, rot=rot)


STEEL = hexc("#2b2e30")
STEEL_LIGHT = hexc("#3a3e41")
CLAD = hexc("#1f2223")
CRANE = hexc("#8a6a1c")
WHITE = [1, 1, 1]


def ibeam(a, b, depth, width, rgb, k="steel", up=None):
    """I-section member from a to b (three coords): two flanges and a web, as thin boxes."""
    a, b = W(*a), W(*b)
    d = b - a
    length = d.length
    fwd = d.normalized()
    up = (up or Vector((0, 0, 1)))
    if abs(fwd.dot(up)) > 0.95:
        up = Vector((0, 1, 0)) if abs(fwd.dot(Vector((0, 1, 0)))) < 0.95 else Vector((1, 0, 0))
    side = fwd.cross(up).normalized()
    up = side.cross(fwd).normalized()
    mid = (a + b) / 2
    rot = Matrix((side, fwd, up)).transposed().to_4x4()
    tf = 0.035
    for off, sz in ((up * (depth / 2 - tf / 2), (width, length, tf)), (-up * (depth / 2 - tf / 2), (width, length, tf)), (Vector(), (0.025, length, depth))):
        m = Matrix.Translation(mid + off) @ rot @ Matrix.Diagonal((*sz, 1))
        r = bmesh.ops.create_cube(acc(k).bm, size=1.0, matrix=m)
        acc(k)._paint(acc(k)._faces(r["verts"]), rgb)


def member(a, b, r, rgb=STEEL, k="steel"):
    """A light truss member (square-ish tube) from a to b."""
    acc(k).bar(W(*a), W(*b), r, rgb, segs=4)


# ---------------------------------------------------------------- frames: columns and trusses
for z in FRAMES_Z:
    for s in (-1, 1):
        x = s * HALF_W
        ibeam((x, 0, z), (x, EAVE, z), 0.5, 0.3, STEEL, up=Vector((1, 0, 0)))
        box("steel", W(x, 0.03, z), (0.7, 0.06, 0.7), STEEL)  # base plate
        # crane runway bracket
        box("steel", W(x - s * 0.55, 8.2, z), (0.8, 0.35, 0.5), STEEL)
    # Pratt truss: top chord following the roof, flat bottom chord, verticals and diagonals
    n = 12
    xs = [-HALF_W + i * (2 * HALF_W / n) for i in range(n + 1)]
    for i in range(n):
        x0, x1 = xs[i], xs[i + 1]
        member((x0, roof_y(x0), z), (x1, roof_y(x1), z), 0.09)
        member((x0, BOTTOM, z), (x1, BOTTOM, z), 0.08)
    for i, x in enumerate(xs):
        member((x, BOTTOM, z), (x, roof_y(x), z), 0.05)
        if 0 < i < n:
            # diagonals lean towards the middle
            xn = xs[i + 1] if x < 0 else xs[i - 1]
            member((x, BOTTOM, z), (xn, roof_y(xn), z), 0.045)

# ---------------------------------------------------------------- runway girders and the crane
for s in (-1, 1):
    x = s * (HALF_W - 0.55)
    ibeam((x, 8.55, FRAMES_Z[0]), (x, 8.55, FRAMES_Z[-1]), 0.7, 0.35, STEEL_LIGHT, up=Vector((0, 0, 1)))
    box("steel", W(x, 8.95, (FRAMES_Z[0] + FRAMES_Z[-1]) / 2), (0.08, 0.08, FRAMES_Z[-1] - FRAMES_Z[0]), STEEL_LIGHT)  # rail
# bridge parked down the bay: twin box girders, end carriages, a trolley with its hoist and hook
cz = -13.5
for dz in (-0.9, 0.9):
    box("crane", W(0, 9.55, cz + dz), (2 * HALF_W - 1.4, 1.1, 0.5), CRANE)
for s in (-1, 1):
    box("crane", W(s * (HALF_W - 0.55), 9.35, cz), (0.7, 0.7, 3.4), CRANE)
box("crane", W(-3.2, 10.35, cz), (2.0, 0.55, 2.4), CRANE)  # trolley
acc("misc").bar(W(-3.8, 10.35, cz), W(-2.6, 10.35, cz), 0.32, hexc("#3a3c3e"), segs=20)  # hoist drum
acc("steel").bar(W(-3.2, 10.0, cz), W(-3.2, 5.6, cz), 0.02, hexc("#1a1a1a"), segs=4)  # rope
box("crane", W(-3.2, 5.35, cz), (0.42, 0.55, 0.32), CRANE)  # hook block
box("misc", W(-3.2, 10.35, cz + 1.25), (0.5, 0.4, 0.08), hexc("#d8c25a"))  # capacity plate

# ---------------------------------------------------------------- purlins, roof sheeting, the opening
def in_open(x0, x1, z0, z1):
    return x0 < OPEN_X[1] and x1 > OPEN_X[0] and z0 < OPEN_Z[1] and z1 > OPEN_Z[0]


purlin_xs = [-HALF_W + 0.4 + i * 1.9 for i in range(int((2 * HALF_W - 0.8) / 1.9) + 1)]
for px in purlin_xs:
    y = roof_y(px) + 0.12
    for z0, z1 in zip(FRAMES_Z, FRAMES_Z[1:]):
        if in_open(px - 0.1, px + 0.1, z0, z1):
            # trimmed: stop at the opening's edges
            for a, b in ((z0, OPEN_Z[0]), (OPEN_Z[1], z1)):
                box("steel", W(px, y, (a + b) / 2), (0.08, 0.22, b - a), STEEL_LIGHT)
            continue
        box("steel", W(px, y, (z0 + z1) / 2), (0.08, 0.22, z1 - z0), STEEL_LIGHT)
# trimmer beams and the curb round the opening
ox0, ox1 = OPEN_X
oz0, oz1 = OPEN_Z
for z in (oz0, oz1):
    ibeam((ox0, roof_y(ox0) + 0.05, z), (ox1, roof_y(ox1) + 0.05, z), 0.35, 0.18, STEEL_LIGHT)
for x in (ox0, ox1):
    ibeam((x, roof_y(x) + 0.05, FRAMES_Z[2] + 6), (x, roof_y(x) + 0.05, FRAMES_Z[4] - 6), 0.35, 0.18, STEEL_LIGHT)
curb_top = roof_y(0) + 0.25 + CURB  # flat top for the hatch doors to run on
for z in (oz0 - 0.1, oz1 + 0.1):
    box("clad", W((ox0 + ox1) / 2, curb_top - 0.5, z), (ox1 - ox0 + 0.4, 1.0, 0.2), CLAD)
for x in (ox0 - 0.1, ox1 + 0.1):
    box("clad", W(x, curb_top - 0.5, 0), (0.2, 1.0, oz1 - oz0 + 0.4), CLAD)
# rails the hatch doors run on, either side of the opening
for z in (oz0 - 0.25, oz1 + 0.25):
    box("steel", W((ox0 + ox1) / 2, curb_top + 0.02, z), (3 * (ox1 - ox0), 0.06, 0.08), STEEL_LIGHT)

# sheeting: panels between frames on each slope, leaving the opening; skylight strips in between
for z0, z1 in zip(FRAMES_Z, FRAMES_Z[1:]):
    for s in (-1, 1):
        n = 6
        for i in range(n):
            xa = s * HALF_W * i / n
            xb = s * HALF_W * (i + 1) / n
            lo, hi = min(xa, xb), max(xa, xb)
            sky = i in (2, 4) and (z0 // 6) % 2 == 0
            k = "glow_sky" if sky else "clad"
            rgb = WHITE if sky else CLAD
            ya, yb = roof_y(xa) + 0.24, roof_y(xb) + 0.24
            if in_open(lo, hi, z0, z1):
                # split round the opening (the opening sits at the ridge between z = ±2.6)
                for za, zb in ((z0, oz0), (oz1, z1)):
                    acc(k).poly([W(xa, ya, za), W(xb, yb, za), W(xb, yb, zb), W(xa, ya, zb)], rgb)
                # beside the opening, across its depth
                ca, cb = max(lo, ox1) if s > 0 else lo, hi if s > 0 else min(hi, ox0)
                if cb > ca:
                    acc(k).poly([W(ca, roof_y(ca) + 0.24, oz0), W(cb, roof_y(cb) + 0.24, oz0), W(cb, roof_y(cb) + 0.24, oz1), W(ca, roof_y(ca) + 0.24, oz1)], rgb)
                continue
            acc(k).poly([W(xa, ya, z0), W(xb, yb, z0), W(xb, yb, z1), W(xa, ya, z1)], rgb)

# ---------------------------------------------------------------- walls: cladding, window strips, a roller door
for s in (-1, 1):
    x = s * (HALF_W + 0.3)
    box("clad", W(x, 2.0, -3), (0.1, 4.0, 36), CLAD)  # lower wall
    box("glow_window", W(x, 5.0, -3), (0.06, 1.6, 34), WHITE)  # window strip
    box("clad", W(x, 8.6, -3), (0.1, 5.6, 36), CLAD)  # upper wall
    for z in FRAMES_Z:  # mullions over the strip
        box("steel", W(x - s * 0.05, 5.0, z), (0.12, 1.7, 0.15), STEEL)
back = FRAMES_Z[0] - 0.3
box("clad", W(0, 6.0, back), (2 * HALF_W + 0.6, 12.0, 0.1), CLAD)
box("misc", W(6.5, 3.0, back + 0.08), (5.0, 6.0, 0.06), hexc("#3d4245"))  # roller shutter
for i in range(24):
    box("steel", W(6.5, 0.2 + i * 0.25, back + 0.12), (5.0, 0.02, 0.02), hexc("#2c3033"))
box("glow_window", W(-4, 9.4, back + 0.06), (18, 1.4, 0.05), WHITE)  # high window strip

# ---------------------------------------------------------------- lamps under the trusses
for z in (-18, -12, -6, 6, 12):
    for x in (-9, 0, 9):
        acc("steel").bar(W(x, BOTTOM, z), W(x, BOTTOM - 0.9, z), 0.012, STEEL, segs=4)
        acc("steel").cyl(W(x, BOTTOM - 1.25, z), 0.42, 0.35, STEEL, segs=20, r2=0.18, smooth=True)
        acc("glow_lamp").cyl(W(x, BOTTOM - 1.27, z), 0.36, 0.02, WHITE, segs=20)

# ---------------------------------------------------------------- the shop floor
YEL = hexc("#b89418")
# walkway lines either side of the machine's bay and across the back
for x in (-7.0, 7.0):
    box("floor", W(x, 0.006, -4), (0.12, 0.01, 30), YEL)
box("floor", W(0, 0.006, -11), (14, 0.01, 0.12), YEL)
for i in range(7):  # hatched keep-clear zone under the parked crane hook
    box("floor", W(-3.2 + (i - 3) * 0.5, 0.007, -13.5), (0.1, 0.01, 2.2), YEL, rot=0.6)

# racking along the back wall: roving packages and boxed stock
rz = -18.6
for i in range(7):
    x = -14 + i * 2.8
    for dz in (-0.55, 0.55):
        box("steel", W(x, 2.8, rz + dz), (0.1, 5.6, 0.1), hexc("#2e4a6a"))
for ly in (0.2, 1.9, 3.6, 5.3):
    for dz in (-0.55, 0.55):
        box("steel", W(-14 + 3 * 2.8, ly, rz + dz), (6 * 2.8, 0.12, 0.08), hexc("#c0581e"))
for i in range(6):
    for ly in (0.26, 1.96, 3.66):
        if rnd.random() < 0.2:
            continue
        x0 = -14 + i * 2.8 + 0.45
        kind = rnd.random()
        if kind < 0.6:  # pallet of roving packages: white cylinders
            box("misc", W(x0 + 0.95, ly + 0.07, rz), (1.9, 0.14, 1.0), hexc("#7a5a3a"))
            for a in range(4):
                for b in range(2):
                    acc("misc").cyl(W(x0 + 0.25 + a * 0.47, ly + 0.14, rz - 0.25 + b * 0.5), 0.2, 0.3, hexc("#e3e1d8"), segs=12)
        else:
            box("misc", W(x0 + 0.95, ly + 0.45, rz), (1.8, 0.9, 0.9), hexc(rnd.choice(["#6b5a45", "#57616a", "#7b6d58"])))

# resin drums by the side wall, some on a spill pallet
for i in range(10):
    x = -13.2 + (i % 5) * 0.7
    z = -6.5 + (i // 5) * 0.75
    acc("misc").cyl(W(x, 0.15, z), 0.29, 0.88, hexc("#1f4f8f" if i % 4 else "#2f6b3a"), segs=16)
box("misc", W(-11.8, 0.075, -6.1), (3.8, 0.15, 1.8), hexc("#c9a21e"))

# FRP pipe stacked on timber cradles, right side
for row in range(3):
    for j in range(4 - row):
        x = 10.2 + j * 0.62 + row * 0.31
        y = 0.45 + row * 0.55
        acc("frp").bar(W(x, y, -8), W(x, y, -2), 0.29, hexc("#2a7d50" if (j + row) % 3 else "#d8dccf"), segs=16)
for z in (-7.2, -2.8):
    box("misc", W(11.2, 0.12, z), (3.2, 0.24, 0.3), hexc("#6b5134"))
# finished duct sections standing on end, flanges up, waiting for dispatch
for (x, z, h) in ((11.5, -14.5, 3.4), (13.3, -15.6, 2.8), (11.0, -16.8, 3.0)):
    acc("frp").cyl(W(x, 0, z), 0.95, h, hexc("#1d7a4c"), segs=32, caps=False)
    for y in (0.07, h - 0.07):
        acc("frp").ring(W(x, y - 0.07, z), 0.9, 1.3, 0.14, hexc("#1a6e44"), segs=32)

# ---------------------------------------------------------------- hatch doors (separate, slid by three.js)
objects = [a.to_object(m) for a, m in ACC.values() if len(a.bm.faces)]
for name, x0, x1 in (("ws_hatch_l", ox0 - 0.2, (ox0 + ox1) / 2), ("ws_hatch_r", (ox0 + ox1) / 2, ox1 + 0.2)):
    a = Acc(name)
    cx = (x0 + x1) / 2
    box(a, W(0, 0.05, 0), (x1 - x0, 0.1, oz1 - oz0 + 0.6), CLAD)
    for i in range(4):  # stiffening ribs on top
        box(a, W(0, 0.14, oz0 + (i + 0.5) * (oz1 - oz0) / 4), (x1 - x0, 0.08, 0.06), STEEL_LIGHT)
    o = a.to_object(ACC["clad"][1])
    o.location = W(cx, curb_top + 0.06, 0)
    objects.append(o)

for o in scene.objects:
    o.select_set(o.name.startswith("ws_"))
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_apply=True,
    export_vertex_color="ACTIVE",
    export_materials="EXPORT",
)
print(f"[workshop] wrote {OUT}; opening top at y = {curb_top:.2f} above the floor")
