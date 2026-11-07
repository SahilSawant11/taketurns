"""
The industrial estate around the scrubber, built in Blender.

Run headless from the repo root:

    blender -b -P scripts/blender/estate.py -- /tmp/estate.glb public/models/estate-trees.json

A planned estate: our plant in a walled compound at the centre, ring roads
round it, and an even road grid beyond (one road every 62 m). Blocks hold
one large factory or two plots side by side, in a set rhythm, each building
filling most of its plot on a lawn, in a few muted roof and wall tones.
Mature avenue trees line every road, a dense belt rings the estate, and
groves fill a few plots. Building types are those of an Indian industrial estate:
portal-frame sheds with ridge ventilators and skylight strips, north-light
sawtooth factories, flat-roofed RCC blocks with parapets and black rooftop
water tanks, container yards, and compound walls. Around the scrubber:
the FRP tank farm, the glass-fused-to-steel tanks, the pipe rack, the
neighbours' brick chimneys and the process building (positions match
src/scripts/three/plant.ts: pins and plumes depend on them).

The ground is painted (roads, plots, grass), then baked with Cycles under
a sun matching the three.js one: the texture carries every building's
shadow and contact shading, so the whole estate is shaded at the cost of
one unlit texture. Trees aren't exported (three.js instances them); their
positions go to a JSON file, and they're in the bake so their shadows are.

Coordinates: plans are written in three.js terms (x, z with y up); in
Blender that's (x, -z, y), and the glTF exporter converts back.
"""
import json
import math
import random
import sys

import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import Acc, hexc, material, srgb_to_lin  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = args[0] if args else "estate.glb"
TREES_OUT = args[1] if len(args) > 1 else "estate-trees.json"

HALF = 210  # baked ground covers x, z in [-HALF, HALF]
TEX = 2048
SUN = Vector((0.55, -0.5, 0.62)).normalized()  # three's (0.55, 0.62, 0.5)

ROAD_W = 7
PLANT = (-66, 88, -60, 28)  # our plant's walled compound: x0, x1, z0, z1
# an even grid: ring roads hugging the compound, then one road every 62 m
ROADS_X = [-136, -74, 96, 158]
ROADS_Z = [-130, -68, 36, 98, 160]
GATE_X = 60  # the compound's gate, on its south wall
CHIMNEYS = [(-105, -6, 30, 1.3), (127, -22, 26, 1.1), (127, 66, 24, 1.0), (-38, -100, 34, 1.5)]  # in neighbours' plots
TANK_FARM = (-34, -12)
GLS_AT = (26, -34)
RACK = (26, 14, 100)  # centre x, z, length
PROCESS = (19, 3, 11, 14, 9)  # centre x, z, width (x), depth (z), height
KEEP_OUT = [  # our plant's features (x0, x1, z0, z1) in three terms
    (-24, 28, -19, 19),  # the scrubber's yard and the process building
    (-56, -12, -28, 4),  # tank farm
    (6, 44, -50, -18),  # GLS tanks
    (-28, 80, 9, 19),  # pipe rack
]
CHIMNEY_BOXES = [(x - 9, x + 9, z - 9, z + 9) for x, z, _, _ in CHIMNEYS]

rnd = random.Random(21)


def B(x, z, y=0.0):
    """three.js (x, y, z) → Blender."""
    return Vector((x, -z, y))


def overlaps(r, boxes):
    x0, x1, z0, z1 = r
    return any(x0 < b[1] and x1 > b[0] and z0 < b[3] and z1 > b[2] for b in boxes)


# ---------------------------------------------------------------- geometry accumulators
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


ACC = {
    "wall": (Acc("estate_walls"), material("wall", 0.85)),
    "roof": (Acc("estate_roofs"), material("roof", 0.45, metal=0.35)),
    "glass": (Acc("estate_glass"), material("glass", 0.15, metal=0.2)),
    "concrete": (Acc("estate_concrete"), material("concrete", 0.9)),
    "metal": (Acc("estate_metal"), material("metal", 0.5, metal=0.3)),
    "frp": (Acc("estate_frp"), material("frp", 0.35, coat=0.7)),
    "gls": (Acc("estate_gls"), material("gls", 0.18, coat=1.0)),
    "brick": (Acc("estate_brick"), material("brick", 0.85)),
}


def acc(k):
    return ACC[k][0]


# palette
WALLS = ["#c4bfb2", "#b4b7b1"]  # two wall tones
ROOFS = ["#8f969a", "#8f969a", "#5b7083", "#c2c3bd"]  # galvalume (most), slate blue, off-white
CONTAINERS = ["#a03a2a", "#2a5f8f", "#c47a1e", "#2f6b4a", "#8a8f93", "#6a3d6e"]
CONCRETE = "#a6a296"
DARK_GLASS = "#3d5566"
SKYLIGHT = "#e4ebe8"
BLACK = "#1c1d1e"
GALV = "#a7adb2"
STEEL = "#6f767c"
YELLOW = "#d9a722"
FRP = "#1d7a4c"
FRP_PALE = "#d9ddd2"
GLS = "#2a5f8f"
BRICK = "#8a5544"

# ---------------------------------------------------------------- buildings
def shed(x0, x1, z0, z1, h):
    """Portal-frame shed: pitched roof along the long axis, ridge ventilators, skylight strips."""
    w, d = x1 - x0, z1 - z0
    along_x = w >= d
    wall = hexc(rnd.choice(WALLS))
    roof = hexc(rnd.choice(ROOFS))
    acc("wall").box(B((x0 + x1) / 2, (z0 + z1) / 2, h / 2), (w, d, h), wall)
    span = d if along_x else w
    rise = span / 2 * math.tan(math.radians(10))
    o = 0.6  # eaves overhang
    # roof: two slopes and two gables, in Blender coords
    if along_x:
        a0, a1 = x0 - o, x1 + o
        e0, e1, mid = z0 - o, z1 + o, (z0 + z1) / 2
        P = lambda a, e, y: B(a, e, y)
    else:
        a0, a1 = z0 - o, z1 + o
        e0, e1, mid = x0 - o, x1 + o, (x0 + x1) / 2
        P = lambda a, e, y: B(e, a, y)
    ridge = h + rise + 0.05
    acc("roof").poly([P(a0, e0, h - 0.05), P(a1, e0, h - 0.05), P(a1, mid, ridge), P(a0, mid, ridge)], roof)
    acc("roof").poly([P(a0, mid, ridge), P(a1, mid, ridge), P(a1, e1, h - 0.05), P(a0, e1, h - 0.05)], roof)
    for a in (a0 + o, a1 - o):
        acc("wall").poly([P(a, e0 + o, h), P(a, mid, h + rise), P(a, e1 - o, h)], wall)
    # skylight strips on both slopes
    length = a1 - a0
    n = max(1, int(length / 9))
    for i in range(n):
        ac = a0 + (i + 0.5) * length / n
        for side in (-1, 1):
            t = 0.45  # fraction from ridge to eaves
            ec = mid + side * (span / 2 + o) * t
            yc = ridge - (ridge - h) * t + 0.08
            sz = (1.6, (span / 2) * 0.35, 0.06) if along_x else ((span / 2) * 0.35, 1.6, 0.06)
            acc("glass").box(P(ac, ec, yc), sz, hexc(SKYLIGHT), rot=0)
    # turbo ventilators along the ridge
    for i in range(max(2, int(length / 7))):
        ac = a0 + (i + 0.5) * length / max(2, int(length / 7))
        acc("metal").cyl(P(ac, mid, ridge - 0.05), 0.35, 0.55, hexc(GALV), segs=12, r2=0.42)
    # a loading door on a long side
    if along_x:
        acc("glass").box(B(x0 + w * 0.3, z1 + 0.05, 2.2), (4, 0.1, 4.2), hexc("#5c6166"))
    else:
        acc("glass").box(B(x1 + 0.05, z0 + d * 0.3, 2.2), (0.1, 4, 4.2), hexc("#5c6166"))


def sawtooth(x0, x1, z0, z1, h):
    """North-light factory: vertical glazing faces north (-z in three terms), sloped roofs south."""
    w, d = x1 - x0, z1 - z0
    wall = hexc(rnd.choice(WALLS))
    roof = hexc(rnd.choice(ROOFS))
    acc("wall").box(B((x0 + x1) / 2, (z0 + z1) / 2, h / 2), (w, d, h), wall)
    n = max(3, int(d / 6))
    step = d / n
    th = step * 0.55
    for i in range(n):
        za = z0 + i * step  # glazing side
        zb = za + step
        acc("glass").poly([B(x0, za, h), B(x1, za, h), B(x1, za, h + th), B(x0, za, h + th)], hexc(DARK_GLASS))
        acc("roof").poly([B(x0, za, h + th), B(x1, za, h + th), B(x1, zb, h), B(x0, zb, h)], roof)
        for x in (x0, x1):
            acc("wall").poly([B(x, za, h), B(x, za, h + th), B(x, zb, h)], wall)


def block(x0, x1, z0, z1, h):
    """Flat-roofed RCC block: window bands per floor, parapet, stair head, black water tanks."""
    w, d = x1 - x0, z1 - z0
    wall = hexc(rnd.choice(["#d9d3c5", "#cfc8b6", "#e0dccf", "#bfc6c4", "#d6c7a8"]))
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    acc("wall").box(B(cx, cz, h / 2), (w, d, h), wall)
    floors = int(h / 3.4)
    for f in range(floors):
        y = 1.9 + f * 3.4
        acc("glass").box(B(cx, cz, y), (w + 0.06, d + 0.06, 1.3), hexc(DARK_GLASS))
    # parapet
    for (a, b, c, dd) in ((cx, z0 + 0.15, w, 0.3), (cx, z1 - 0.15, w, 0.3), (x0 + 0.15, cz, 0.3, d), (x1 - 0.15, cz, 0.3, d)):
        acc("wall").box(B(a, b, h + 0.5), (c, dd, 1.0), wall)
    acc("concrete").box(B(cx, cz, h + 0.02), (w - 0.6, d - 0.6, 0.04), hexc("#9a988f"))
    # stair head and water tanks (the black plastic kind)
    sx, sz = x0 + w * 0.25, z0 + d * 0.3
    acc("wall").box(B(sx, sz, h + 1.4), (4, 3.5, 2.8), wall)
    for i in range(rnd.randint(1, 3)):
        acc("concrete").cyl(B(x0 + w * (0.55 + 0.12 * i), z0 + d * 0.65, h), 0.75, 1.5, hexc(BLACK), segs=16)


def yard(x0, x1, z0, z1):
    """Open yard with stacked shipping containers."""
    n = rnd.randint(3, 9)
    for i in range(n):
        cx = x0 + 3 + rnd.random() * max(1, (x1 - x0) - 9)
        cz = z0 + 3 + rnd.random() * max(1, (z1 - z0) - 6)
        stack = rnd.choice([1, 1, 2, 2, 3])
        rot = rnd.choice([0.0, math.pi / 2])
        for s in range(stack):
            acc("metal").box(B(cx, cz, 1.3 + s * 2.6), (6.1, 2.44, 2.59), hexc(rnd.choice(CONTAINERS)), rot=rot)


def compound(x0, x1, z0, z1, gate_side, gate_at=None):
    """Compound wall round a plot with a gate gap (centred, or at gate_at along that side)."""
    c = hexc("#cfc9bb")
    t, h = 0.25, 1.8
    edges = {
        "s": ((x0, z1), (x1, z1)),
        "n": ((x0, z0), (x1, z0)),
        "w": ((x0, z0), (x0, z1)),
        "e": ((x1, z0), (x1, z1)),
    }
    for side, ((ax, az), (bx, bz)) in edges.items():
        length = math.hypot(bx - ax, bz - az)
        horiz = az == bz
        if side == gate_side:
            g = gate_at if gate_at is not None else ((ax + bx) / 2 if horiz else (az + bz) / 2)
            lo, hi = (ax, bx) if horiz else (az, bz)
            for (a, b) in ((lo, g - 3.5), (g + 3.5, hi)):
                if b - a < 0.5:
                    continue
                if horiz:
                    acc("concrete").box(B((a + b) / 2, az, h / 2), (b - a, t, h), c)
                else:
                    acc("concrete").box(B(ax, (a + b) / 2, h / 2), (t, b - a, h), c)
        else:
            acc("concrete").box(B((ax + bx) / 2, (az + bz) / 2, h / 2), ((length, t, h) if horiz else (t, length, h)), c)


# ---------------------------------------------------------------- the ground plan
ppm = TEX / (2 * HALF)
albedo = np.zeros((TEX, TEX, 3), dtype=np.float32)
albedo[:] = hexc("#6d7455")  # muted green ground, not pale khaki: less glare between things
noise = np.random.default_rng(3)
albedo *= (0.94 + 0.12 * noise.random((TEX, TEX, 1))).astype(np.float32)


def paint(x0, x1, z0, z1, rgb, jitter=0.0):
    c0, c1 = int((x0 + HALF) * ppm), int((x1 + HALF) * ppm)
    r0, r1 = int((HALF - z1) * ppm), int((HALF - z0) * ppm)  # image row 0 is the bottom (v = 0) = three z = +HALF
    c0, c1, r0, r1 = max(c0, 0), min(c1, TEX), max(r0, 0), min(r1, TEX)
    if c1 <= c0 or r1 <= r0:
        return
    col = np.array(rgb, dtype=np.float32)
    if jitter:
        col = col * (1 - jitter / 2 + jitter * rnd.random())
    albedo[r0:r1, c0:c1] = col * (0.96 + 0.08 * noise.random((r1 - r0, c1 - c0, 1)))


def blob(x, z, r, rgb, a):
    c, rr = (x + HALF) * ppm, (HALF - z) * ppm
    rad = r * ppm
    r0, r1 = int(max(rr - rad, 0)), int(min(rr + rad, TEX))
    c0, c1 = int(max(c - rad, 0)), int(min(c + rad, TEX))
    if r1 <= r0 or c1 <= c0:
        return
    yy, xx = np.mgrid[r0:r1, c0:c1]
    m = np.clip(1 - np.hypot(yy - rr, xx - c) / rad, 0, 1)[..., None] * a
    albedo[r0:r1, c0:c1] = albedo[r0:r1, c0:c1] * (1 - m) + np.array(rgb, dtype=np.float32) * m


# a little unevenness in the grass
for _ in range(160):
    g = rnd.random()
    blob(rnd.uniform(-HALF, HALF), rnd.uniform(-HALF, HALF), rnd.uniform(8, 24), [0.33 + 0.06 * g, 0.4 + 0.06 * g, 0.26], 0.35)

LAWN = hexc("#74805a")
APRON = hexc("#9b988e")  # concrete round a building and its drive: kept tight


def building(kind, x0, x1, z0, z1, gate):
    """One plot: lawn inside a compound wall, the building filling most of it, a drive to the gate."""
    paint(x0, x1, z0, z1, LAWN, jitter=0.06)
    compound(x0, x1, z0, z1, gate)
    m = 3.0
    bx0, bx1, bz0, bz1 = x0 + m, x1 - m, z0 + m, z1 - m
    if bx1 - bx0 < 8 or bz1 - bz0 < 8:
        return
    paint(bx0 - 1.5, bx1 + 1.5, bz0 - 1.5, bz1 + 1.5, APRON, jitter=0.05)
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    if gate in "ns":
        paint(cx - 3, cx + 3, *((z1 - m, z1) if gate == "s" else (z0, z0 + m)), APRON)
    else:
        paint(*((x1 - m, x1) if gate == "e" else (x0, x0 + m)), cz - 3, cz + 3, APRON)
    if kind == "shed":
        shed(bx0, bx1, bz0, bz1, rnd.uniform(7, 10))
    elif kind == "sawtooth":
        sawtooth(bx0, bx1, bz0, bz1, rnd.uniform(6, 8))
    elif kind == "block":
        k = 0.6
        if bx1 - bx0 > bz1 - bz0:
            block(bx0, bx0 + (bx1 - bx0) * k, bz0, bz1, rnd.choice([10.4, 13.8]))
            yard(bx0 + (bx1 - bx0) * k + 2, bx1, bz0, bz1)
        else:
            block(bx0, bx1, bz0, bz0 + (bz1 - bz0) * k, rnd.choice([10.4, 13.8]))
            yard(bx0, bx1, bz0 + (bz1 - bz0) * k + 2, bz1)


def near_road_gate(x0, x1, z0, z1):
    """The plot side facing the nearest road."""
    d = {"n": min((abs(z0 - r) for r in ROADS_Z), default=1e9), "s": min((abs(z1 - r) for r in ROADS_Z), default=1e9),
         "w": min((abs(x0 - r) for r in ROADS_X), default=1e9), "e": min((abs(x1 - r) for r in ROADS_X), default=1e9)}
    return min(d, key=d.get)


# blocks between the roads; south of the plant, the boulevard splits the middle column
inset = ROAD_W / 2 + 7  # the verge each side of a road, where the avenue trees stand
xs = [-HALF] + ROADS_X + [HALF]
zs = [-HALF] + ROADS_Z + [HALF]
lots = []  # (x0, x1, z0, z1, kind)
groves = []
for j in range(len(zs) - 1):
    z0, z1 = zs[j] + (inset if j > 0 else 26), zs[j + 1] - (inset if j < len(zs) - 2 else 26)
    xb = list(xs)
    for i in range(len(xb) - 1):
        a, b = xb[i], xb[i + 1]
        x0 = a + (inset if i > 0 else 26)
        x1 = b - (inset if i < len(xb) - 2 else 26)
        if x1 - x0 < 20 or z1 - z0 < 20:
            continue
        if overlaps((x0, x1, z0, z1), [PLANT]):
            continue
        # a set rhythm: one large factory, or two plots side by side along the longer side
        long_side = max(x1 - x0, z1 - z0)
        n = max(2, round(long_side / 34))
        if (i + j) % 3 == 0 and long_side < 60:
            lots.append((x0, x1, z0, z1, "sawtooth" if (i * 7 + j) % 2 else "shed"))
        else:
            parts = []
            for k in range(n):
                if x1 - x0 >= z1 - z0:
                    a = x0 + (x1 - x0) * k / n + (1.5 if k else 0)
                    b = x0 + (x1 - x0) * (k + 1) / n - (1.5 if k < n - 1 else 0)
                    parts.append((a, b, z0, z1))
                else:
                    a = z0 + (z1 - z0) * k / n + (1.5 if k else 0)
                    b = z0 + (z1 - z0) * (k + 1) / n - (1.5 if k < n - 1 else 0)
                    parts.append((x0, x1, a, b))
            for n, pr in enumerate(parts):
                lots.append((*pr, ["shed", "block", "shed", "sawtooth"][(i + j + n) % 4]))

for x0, x1, z0, z1, kind in lots:
    if overlaps((x0, x1, z0, z1), CHIMNEY_BOXES):
        # a works with its chimney: the building takes the half away from the stack
        cx, cz = next(((c[0], c[1]) for c in CHIMNEYS if overlaps((x0, x1, z0, z1), [(c[0] - 9, c[0] + 9, c[1] - 9, c[1] + 9)])))
        paint(x0, x1, z0, z1, LAWN)
        paint(cx - 8, cx + 8, cz - 8, cz + 8, APRON)
        if x1 - x0 >= z1 - z0:
            hx0, hx1 = (cx + 11, x1) if cx - x0 < x1 - cx else (x0, cx - 11)
            if hx1 - hx0 > 12:
                building("sawtooth", hx0, hx1, z0, z1, near_road_gate(hx0, hx1, z0, z1))
        else:
            hz0, hz1 = (cz + 11, z1) if cz - z0 < z1 - cz else (z0, cz - 11)
            if hz1 - hz0 > 12:
                building("sawtooth", x0, x1, hz0, hz1, near_road_gate(x0, x1, hz0, hz1))
        continue
    if rnd.random() < 0.12:  # a few plots are groves
        paint(x0, x1, z0, z1, LAWN, jitter=0.08)
        groves.append((x0, x1, z0, z1))
        continue
    building(kind, x0, x1, z0, z1, near_road_gate(x0, x1, z0, z1))

# our plant's compound: a lawn inside its wall, a service road along the south, the gate on the boulevard
px0, px1, pz0, pz1 = PLANT
paint(px0, px1, pz0, pz1, hexc("#7a8460"))
paint(GATE_X - 3.5, GATE_X + 3.5, 19, ROADS_Z[2], hexc("#5f605c"))  # in through the gate, from the road outside
paint(-30, 84, 7, 21, hexc("#9d9a90"))  # under the pipe rack
compound(px0, px1, pz0, pz1, "s", gate_at=GATE_X)
# the rest of our site, east of the tanks: a finished-goods warehouse and the admin and control block
PLANT_BUILDINGS = [(52, 84, -54, -30), (52, 78, -22, 2), (-62, -30, 6, 24), (-63, -28, -56, -28), (-14, 4, -50, -26), (31, 45, -10, 2), (55, 82, -28.5, -23.5)]
paint(50.5, 85.5, -55.5, -28.5, APRON)
shed(52, 84, -54, -30, 9.5)
paint(50.5, 79.5, -23.5, 3.5, APRON)
block(52, 78, -22, 2, 10.4)
paint(78, 84, -14, -6, APRON)  # its drive to the rack road

# an FRP induced-draft cooling tower: three cells, louvred sides, fan stacks on the deck
CT = hexc("#c5ccc2")
paint(-63, -29, 5, 25, APRON)
acc("concrete").box(B(-46, 15, 0.6), (31, 15, 1.2), hexc("#b3afa4"))  # cold-water basin
acc("frp").box(B(-46, 15, 5.2), (30, 13, 8.0), CT)
for side in (-1, 1):
    for k in range(6):
        acc("glass").box(B(-58.5 + k * 5, 15 + side * 6.53, 3.4), (4.2, 0.06, 3.6), hexc("#3d4a4c"))  # air-inlet louvres
acc("frp").box(B(-46, 15, 9.3), (30.4, 13.4, 0.3), CT)  # fan deck
for k in range(3):
    fx = -56 + k * 10
    acc("frp").cyl(B(fx, 15, 9.4), 3.6, 3.2, hexc(FRP), segs=40, r2=3.9)  # fan stacks
    acc("metal").cyl(B(fx, 15, 12.0), 0.5, 0.4, hexc(STEEL), segs=16)
    for a in range(4):
        ang = a / 4 * math.pi + k * 0.4
        acc("metal").box(B(fx + math.cos(ang) * 1.6, 15 + math.sin(ang) * 1.6, 12.1), (3.2, 0.35, 0.08), hexc(STEEL), rot=ang)
for x in (-60, -32):
    acc("metal").bar(B(x, 8.3, 0.3), B(x, 8.3, 9.5), 0.03, hexc(GALV), segs=6)  # access ladders

# effluent treatment: two clarifiers with their bridges, and an aeration basin
paint(-64, -27, -57, -27, APRON)
for cx in (-54, -37):
    acc("concrete").ring(B(cx, -47, 0), 6.5, 7.2, 3.2, hexc("#b9b5aa"), segs=64)
    acc("concrete").cyl(B(cx, -47, 2.4), 6.5, 0.05, hexc("#4b6a62"), segs=64)  # water
    acc("metal").box(B(cx, -47, 3.6), (14.4, 0.9, 0.4), hexc(GALV))  # rotating bridge
    acc("metal").cyl(B(cx, -47, 3.2), 0.9, 1.0, hexc(STEEL), segs=16)
acc("concrete").box(B(-45.5, -32, 1.6), (34, 7, 3.2), hexc("#b9b5aa"))
acc("concrete").box(B(-45.5, -32, 3.21), (32.8, 5.8, 0.02), hexc("#5d746a"))  # aerated water
for k in range(6):
    acc("metal").box(B(-60 + k * 5.8, -32, 3.5), (0.5, 6.4, 0.3), hexc(GALV))  # walkways and diffuser headers

# a bank of horizontal FRP process vessels on saddles, with a header
paint(-15, 5, -51, -25, APRON)
for k, z in enumerate((-46, -38, -30)):
    acc("frp").bar(B(-12, z, 2.3), B(2, z, 2.3), 1.9, hexc(FRP if k != 1 else FRP_PALE), segs=32)
    for sx in (-9, -1):
        acc("metal").box(B(sx, z, 0.8), (0.6, 3.2, 1.6), hexc(STEEL))
    acc("frp").cyl(B(-5, z, 4.1), 0.35, 0.8, hexc(FRP), segs=16)  # top nozzle
acc("frp").bar(B(-13, -42, 5.2), B(3, -42, 5.2), 0.22, hexc(FRP), segs=12)  # header
acc("frp").bar(B(-13, -34, 5.2), B(3, -34, 5.2), 0.22, hexc(FRP_PALE), segs=12)

# a pump house beside the process building, its FRP lines up to the rack
paint(30, 46, -11, 3, APRON)
acc("wall").box(B(38, -4, 2.6), (14, 12, 5.2), hexc("#c6c1b3"))
acc("metal").box(B(38, -4, 5.35), (14.6, 12.6, 0.3), hexc(STEEL))
for k in range(3):
    acc("frp").bar(B(34 + k * 3, 2, 3.0), B(34 + k * 3, 12, 5.8), 0.2, hexc(FRP), segs=10)

# road tankers loading at the warehouse
for tx0 in (56, 69):
    acc("metal").box(B(tx0 + 1.3, -26, 1.7), (2.6, 2.5, 2.4), hexc("#e3e2dc"))  # cab
    acc("metal").box(B(tx0 + 6.5, -26, 0.75), (9.5, 2.3, 0.5), hexc(BLACK))  # chassis
    acc("metal").bar(B(tx0 + 3, -26, 2.1), B(tx0 + 11.6, -26, 2.1), 1.15, hexc(GALV), segs=24)  # tank

# roads on top of everything
ROAD = hexc("#4b4c4a")
KERB = hexc("#9e9b90")
for x in ROADS_X:
    paint(x - ROAD_W / 2, x + ROAD_W / 2, -HALF, HALF, ROAD)
for z in ROADS_Z:
    paint(-HALF, HALF, z - ROAD_W / 2, z + ROAD_W / 2, ROAD)
for x in ROADS_X:
    for s_ in (-1, 1):
        paint(x + s_ * ROAD_W / 2 - 0.25, x + s_ * ROAD_W / 2 + 0.25, -HALF, HALF, KERB)
for z in ROADS_Z:
    for s_ in (-1, 1):
        paint(-HALF, HALF, z + s_ * ROAD_W / 2 - 0.25, z + s_ * ROAD_W / 2 + 0.25, KERB)
# ---------------------------------------------------------------- the scrubber's neighbours
paint(-24, 28, -19, 19, hexc("#aeaba0"))  # the scrubber's yard
# process building
px, pz, pw, pd, ph = PROCESS
acc("wall").box(B(px, pz, ph / 2), (pw, pd, ph), hexc("#c6c1b3"))
acc("metal").box(B(px, pz, ph + 0.2), (pw + 0.4, pd + 0.4, 0.4), hexc(STEEL))
for i in range(3):
    acc("metal").box(B(px - 2 + i * 2.6, pz + 3, ph + 1.0), (1.6, 1.6, 1.2), hexc(GALV))
acc("glass").box(B(px, pz + pd / 2 + 0.05, 3), (5, 0.1, 5.5), hexc("#5c6166"))

# tank farm: bunded FRP storage tanks with ladders and a top rail
tx, tz = TANK_FARM
paint(tx - 18, tx + 18, tz - 12, tz + 12, hexc("#b5b1a6"))
acc("concrete").box(B(tx, tz, 0.15), (34, 22, 0.3), hexc("#bdb9ae"))
for (w, d, ox, oz) in ((34, 0.4, 0, -11), (34, 0.4, 0, 11), (0.4, 22, -17, 0), (0.4, 22, 17, 0)):
    acc("concrete").box(B(tx + ox, tz + oz, 0.6), (w, d, 1.2), hexc("#c9c5b9"))
for i in range(4):
    for j in range(2):
        x = tx - 11.5 + i * 7.6
        z = tz - 4.5 + j * 9
        col = hexc(FRP_PALE if (i + j) % 3 == 0 else FRP)
        acc("frp").cyl(B(x, z, 0.3), 2.4, 7.0, col, segs=40)
        acc("frp").cyl(B(x, z, 7.3), 2.45, 0.7, col, segs=40, r2=0.5)
        acc("frp").ring(B(x, z, 0.3), 2.38, 2.6, 0.18, col, segs=40)
        # ladder on the side facing the aisle, and a top handrail ring
        side = -1 if j == 0 else 1
        lx, lz = x + 1.0, z + side * 2.5
        for k in (-0.22, 0.22):
            acc("metal").bar(B(lx + k, lz, 0.3), B(lx + k, lz, 7.9), 0.03, hexc(GALV), segs=6)
        for a in range(10):
            ang = a / 10 * math.tau
            p, q = B(x + math.cos(ang) * 1.6, z + math.sin(ang) * 1.6, 7.6), B(x + math.cos(ang) * 1.6, z + math.sin(ang) * 1.6, 8.5)
            acc("metal").bar(p, q, 0.025, hexc(YELLOW), segs=6)
        acc("metal").ring(B(x, z, 8.45), 1.57, 1.63, 0.06, hexc(YELLOW), segs=24)  # top rail
# a pipe manifold along the aisle
acc("frp").bar(B(tx - 15, tz, 1.2), B(tx + 15, tz, 1.2), 0.18, hexc(FRP), segs=12)
for i in range(4):
    for j in (-1, 1):
        x = tx - 11.5 + i * 7.6
        acc("frp").bar(B(x, tz, 1.2), B(x, tz + j * 2.2, 1.2), 0.12, hexc(FRP), segs=10)

# glass-fused-to-steel tanks: bolted panel rings, cone roofs, spiral-ish stair stringers
gx, gz = GLS_AT
paint(gx - 18, gx + 18, gz - 14, gz + 14, hexc("#b8b4a8"))
for (dx, dz, R, H) in ((-7, 0, 7, 7.2), (9, 3, 5, 6)):
    x, z = gx + dx, gz + dz
    acc("concrete").cyl(B(x, z, 0), R + 0.6, 0.3, hexc("#c3bfb3"), segs=48)
    acc("gls").cyl(B(x, z, 0.3), R, H, hexc(GLS), segs=64)
    for k in range(1, 5):
        acc("metal").ring(B(x, z, 0.3 + H / 5 * k - 0.04), R - 0.01, R + 0.05, 0.08, hexc(GALV), segs=64)
    acc("metal").cyl(B(x, z, H + 0.3), R + 0.12, 1.3, hexc(GALV), segs=64, r2=0.6)
    for a in range(int(R * 3)):
        ang = a / int(R * 3) * math.tau
        acc("metal").bar(B(x + math.cos(ang) * R * 0.9, z + math.sin(ang) * R * 0.9, H + 0.5), B(x + math.cos(ang) * R * 0.9, z + math.sin(ang) * R * 0.9, H + 1.5), 0.025, hexc(YELLOW), segs=5)
    acc("metal").ring(B(x, z, H + 1.45), R * 0.9 - 0.03, R * 0.9 + 0.03, 0.06, hexc(YELLOW), segs=48)  # top rail

# pipe rack: portal frames in two tiers with FRP and steel lines and a cable tray
rx, rz, L = RACK
x0 = rx - L / 2
x = x0
while x <= x0 + L + 0.01:
    for dz in (-1.5, 1.5):
        acc("metal").box(B(x, rz + dz, 2.8), (0.3, 0.3, 5.6), hexc(STEEL))
    for y in (3.6, 5.4):
        acc("metal").box(B(x, rz, y), (0.3, 3.6, 0.3), hexc(STEEL))
    x += 7
for (dz, y, pr, c) in ((-1.0, 5.55, 0.32, FRP), (-0.2, 5.55, 0.26, FRP_PALE), (0.65, 5.55, 0.36, FRP), (1.3, 5.55, 0.16, YELLOW), (-0.8, 3.75, 0.22, GALV), (0.4, 3.75, 0.28, FRP)):
    acc("frp" if c in (FRP, FRP_PALE) else "metal").bar(B(x0, rz + dz, y + pr), B(x0 + L, rz + dz, y + pr), pr, hexc(c), segs=14)
acc("metal").box(B(rx, rz + 1.2, 4.1), (L, 0.6, 0.1), hexc(GALV))

# neighbours' brick chimneys with bands, a platform and a ladder
for (x, z, h, r) in CHIMNEYS:
    paint(x - 7, x + 7, z - 7, z + 7, hexc("#b0ab9f"))
    acc("brick").cyl(B(x, z, 0), r * 1.35, 1.2, hexc("#7e4d3e"), segs=24)
    acc("brick").cyl(B(x, z, 1.2), r, h - 1.2, hexc(BRICK), segs=24, r2=r * 0.8)
    for k in range(3):
        y = h - 1 - k * 1.4
        rr = r * (0.8 + 0.2 * (1 - y / h))
        acc("metal" if k == 1 else "brick").ring(B(x, z, y), rr - 0.05, rr + 0.1, 0.45, hexc(STEEL if k == 1 else "#6e4236"), segs=24)
    rr = r * (0.8 + 0.2 * (1 - (h - 5) / h))
    acc("metal").ring(B(x, z, h - 5), rr, rr + 0.9, 0.08, hexc(GALV), segs=24)
    acc("metal").bar(B(x + r + 0.15, z, 1.2), B(x + rr + 0.15, z, h - 0.5), 0.03, hexc(GALV), segs=5)

# ---------------------------------------------------------------- trees (positions for three.js)
# Mature avenue trees: crowns 10-14 m across (three.js draws a tree of scale s about 1.75 s across).
trees = []
BUILT = [(x0 - 1, x1 + 1, z0 - 1, z1 + 1) for x0, x1, z0, z1, _ in lots if (x0, x1, z0, z1) not in groves]


def free_for_tree(x, z, r=2.0):
    if abs(x) > HALF - 3 or abs(z) > HALF - 3:
        return False
    for rx in ROADS_X:
        if abs(x - rx) < ROAD_W / 2 + 1.5:
            return False
    for rzz in ROADS_Z:
        if abs(z - rzz) < ROAD_W / 2 + 1.5:
            return False
    box = (x - r, x + r, z - r, z + r)
    return not overlaps(box, KEEP_OUT + CHIMNEY_BOXES)


def avenue(along, fixed, a0, a1, side_off, spacing=(12, 15), size=(5.0, 6.8)):
    """A row of trees along a road: along='x' runs in x at z=fixed."""
    t = a0 + rnd.uniform(0, 6)
    while t < a1:
        o = side_off + rnd.uniform(-0.6, 0.6)
        x, z = (t, fixed + o) if along == "x" else (fixed + o, t)
        # stand back from the junctions, and from the plant's wall
        near_junction = any(abs((x if along == "x" else z) - c) < ROAD_W / 2 + 7 for c in (ROADS_X if along == "x" else ROADS_Z))
        if along == "x" and abs(x - GATE_X) < 9:
            near_junction = True  # keep the gate clear
        if not near_junction and free_for_tree(x, z) and not overlaps((x - 1, x + 1, z - 1, z + 1), [PLANT]):
            trees.append((x, z, rnd.uniform(*size)))
        t += rnd.uniform(*spacing)


verge = ROAD_W / 2 + 5.5
for rx in ROADS_X:
    for side in (-1, 1):
        avenue("z", rx, -HALF, HALF, side * verge)
for rzz in ROADS_Z:
    for side in (-1, 1):
        avenue("x", rzz, -HALF, HALF, side * verge)
# a dense belt round the estate's edge: three staggered rows
for row in range(3):
    inset_b = 8 + row * 8
    t = -HALF + inset_b
    while t < HALF - inset_b:
        for (x, z) in ((t, -HALF + inset_b), (t, HALF - inset_b), (-HALF + inset_b, t), (HALF - inset_b, t)):
            x += rnd.uniform(-2, 2)
            z += rnd.uniform(-2, 2)
            if free_for_tree(x, z) and not overlaps((x - 3, x + 3, z - 3, z + 3), BUILT):
                trees.append((x, z, rnd.uniform(5.5, 8.0)))
        t += rnd.uniform(9, 12)
# our plant's perimeter: a row inside the wall, clear of its kit
px0, px1, pz0, pz1 = PLANT
for (along, fixed, a0, a1) in (("x", pz0 + 5, px0 + 5, px1 - 5), ("x", pz1 - 4, px0 + 5, px1 - 5), ("z", px0 + 5, pz0 + 5, pz1 - 8), ("z", px1 - 5, pz0 + 5, pz1 - 8)):
    t = a0
    while t < a1:
        x, z = (t, fixed) if along == "x" else (fixed, t)
        at_gate = abs(x - GATE_X) < 8 and z > pz1 - 8
        if free_for_tree(x, z, r=4) and not at_gate and not overlaps((x - 4, x + 4, z - 4, z + 4), PLANT_BUILDINGS):
            trees.append((x, z, rnd.uniform(4.2, 5.6)))
        t += rnd.uniform(11, 14)
# groves, and a few landmark giants at junction corners
for x0, x1, z0, z1 in groves:
    for _ in range(int((x1 - x0) * (z1 - z0) / 140)):
        x, z = rnd.uniform(x0 + 4, x1 - 4), rnd.uniform(z0 + 4, z1 - 4)
        if free_for_tree(x, z):
            trees.append((x, z, rnd.uniform(5.0, 8.0)))
for rx in ROADS_X:
    for rzz in ROADS_Z:
        if rnd.random() < 0.3:
            x, z = rx + rnd.choice((-1, 1)) * (verge + 3), rzz + rnd.choice((-1, 1)) * (verge + 3)
            if free_for_tree(x, z, r=4) and not overlaps((x - 4, x + 4, z - 4, z + 4), BUILT + [PLANT]):
                trees.append((x, z, rnd.uniform(9.0, 10.5)))
print(f"[estate] {len(lots)} plots, {len(groves)} groves")
with open(TREES_OUT, "w") as f:
    json.dump({"trees": [[round(x, 2), round(z, 2), round(s, 2), round(rnd.random(), 3)] for x, z, s in trees]}, f, separators=(",", ":"))
print(f"[estate] {len(trees)} trees → {TREES_OUT}")

# ---------------------------------------------------------------- build objects
objects = [a.to_object(m) for a, m in ACC.values()]

# ground: painted albedo, then baked with the sun and sky
img_albedo = bpy.data.images.new("ground_albedo", TEX, TEX, alpha=False)
rgba = np.concatenate([albedo, np.ones((TEX, TEX, 1), dtype=np.float32)], axis=2)
img_albedo.pixels.foreach_set(np.clip(rgba, 0, 1).ravel())
bpy.ops.mesh.primitive_plane_add(size=2 * HALF, location=(0, 0, 0))
ground = bpy.context.object
ground.name = "estate_ground"
gm = bpy.data.materials.new("ground")
gm.use_nodes = True
gp = gm.node_tree.nodes["Principled BSDF"]
gp.inputs["Roughness"].default_value = 1.0
ta = gm.node_tree.nodes.new("ShaderNodeTexImage")
ta.image = img_albedo
gm.node_tree.links.new(ta.outputs["Color"], gp.inputs["Base Color"])
ground.data.materials.append(gm)

# bake-only stand-ins: the scrubber and the trees (so their shadows land on the ground)
bake_only = []
bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=2.3, depth=17, location=(0, 0, 8.5))
bake_only.append(bpy.context.object)
bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=3.2, depth=0.1, location=(0, 0, 11))
bake_only.append(bpy.context.object)
tree_bm = bmesh.new()
for x, z, s in trees:
    bmesh.ops.create_icosphere(tree_bm, subdivisions=2, radius=s * 0.88, matrix=Matrix.Translation(B(x, z, s * 1.05)) @ Matrix.Diagonal((1, 1, 0.85, 1)))
tree_me = bpy.data.meshes.new("bake_trees")
tree_bm.to_mesh(tree_me)
tree_bm.free()
tree_ob = bpy.data.objects.new("bake_trees", tree_me)
scene.collection.objects.link(tree_ob)
bake_only.append(tree_ob)
leaf = bpy.data.materials.new("leaf")
leaf.use_nodes = True
leaf.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*srgb_to_lin(hexc("#4f6b3a")), 1)
for o in bake_only:
    o.data.materials.append(leaf)

# light: a sun matching three.js, and a pale blue sky
sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 4.2
sun_data.angle = math.radians(1.2)
sun_data.color = (1.0, 0.94, 0.86)
sun = bpy.data.objects.new("sun", sun_data)
scene.collection.objects.link(sun)
sun.rotation_mode = "QUATERNION"
sun.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(SUN)
world = bpy.data.worlds.new("sky")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.9, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9

scene.render.engine = "CYCLES"
scene.cycles.samples = 48
scene.cycles.max_bounces = 3
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = "GPU"
except Exception:
    pass

img_bake = bpy.data.images.new("ground_baked", TEX, TEX, alpha=False)
tb = gm.node_tree.nodes.new("ShaderNodeTexImage")
tb.image = img_bake
gm.node_tree.nodes.active = tb
for o in scene.objects:
    o.select_set(False)
ground.select_set(True)
bpy.context.view_layer.objects.active = ground
scene.render.bake.use_pass_direct = True
scene.render.bake.use_pass_indirect = True
bpy.ops.object.bake(type="COMBINED", margin=4)
print("[estate] baked the ground")

# export: the ground shows its bake (three.js draws it unlit); bake-only parts stay behind
gm.node_tree.links.new(tb.outputs["Color"], gp.inputs["Base Color"])
for o in bake_only:
    bpy.data.objects.remove(o)
for o in scene.objects:
    o.select_set(o.name.startswith("estate_"))
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_apply=True,
    export_image_format="JPEG",
    export_jpeg_quality=82,
    export_vertex_color="ACTIVE",
    export_materials="EXPORT",
)
print(f"[estate] wrote {OUT}")
