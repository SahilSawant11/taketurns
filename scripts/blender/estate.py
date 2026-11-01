"""
The industrial estate around the scrubber, built in Blender.

Run headless from the repo root:

    blender -b -P scripts/blender/estate.py -- /tmp/estate.glb public/models/estate-trees.json

A road grid splits the estate into blocks; blocks split into compound
plots, each with a building type typical of an Indian industrial estate:
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

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = args[0] if args else "estate.glb"
TREES_OUT = args[1] if len(args) > 1 else "estate-trees.json"

HALF = 210  # baked ground covers x, z in [-HALF, HALF]
TEX = 2048
SUN = Vector((0.55, -0.5, 0.62)).normalized()  # three's (0.55, 0.62, 0.5)

ROADS_X = [-90, -30, 30, 90, 160]
ROADS_Z = [-110, -50, 30, 90]
ROAD_W = 7
CHIMNEYS = [(58, -22, 30, 1.3), (-62, 30, 26, 1.1), (80, 40, 22, 1.0), (-20, -70, 34, 1.5)]
TANK_FARM = (-34, -12)
GLS_AT = (26, -34)
RACK = (26, 14, 100)  # centre x, z, length
PROCESS = (19, 3, 11, 14, 9)  # centre x, z, width (x), depth (z), height
KEEP_OUT = [  # (x0, x1, z0, z1) in three terms
    (-24, 28, -19, 19),  # the scrubber's yard and the process building
    (-56, -12, -28, 4),  # tank farm
    (6, 44, -50, -18),  # GLS tanks
    (-28, 80, 9, 19),  # pipe rack
] + [(x - 9, x + 9, z - 9, z + 9) for x, z, _, _ in CHIMNEYS]

rnd = random.Random(21)


def srgb_to_lin(c):
    return [((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c]


def hexc(h):
    return [int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)]


def B(x, z, y=0.0):
    """three.js (x, y, z) → Blender."""
    return Vector((x, -z, y))


def overlaps(r, boxes):
    x0, x1, z0, z1 = r
    return any(x0 < b[1] and x1 > b[0] and z0 < b[3] and z1 > b[2] for b in boxes)


# ---------------------------------------------------------------- geometry accumulators
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


class Acc:
    """One mesh per material, built with bmesh; every face carries a vertex colour (painted as it's made)."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new("Col")

    def _paint(self, faces, rgb, smooth=False):
        c = (*rgb, 1.0)  # byte colour layers take sRGB values as they are
        for f in faces:
            if smooth:
                f.normal_update()
                f.smooth = abs(f.normal.z) < 0.5
            for loop in f.loops:
                loop[self.col] = c

    @staticmethod
    def _faces(verts):
        return {f for v in verts for f in v.link_faces}

    def box(self, c, size, rgb, rot=0.0):
        m = Matrix.Translation(c) @ Matrix.Rotation(rot, 4, "Z") @ Matrix.Diagonal((*size, 1))
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        self._paint(self._faces(r["verts"]), rgb)

    def cyl(self, base, r, h, rgb, segs=24, r2=None, smooth=True, caps=True):
        m = Matrix.Translation(base + Vector((0, 0, h / 2)))
        res = bmesh.ops.create_cone(self.bm, cap_ends=caps, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=h, matrix=m)
        self._paint(self._faces(res["verts"]), rgb, smooth)

    def bar(self, a, b, r, rgb, segs=8):
        a, b = Vector(a), Vector(b)
        d = b - a
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        m = Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4()
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=d.length, matrix=m)
        self._paint(self._faces(res["verts"]), rgb, True)

    def poly(self, pts, rgb):
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        self._paint([f], rgb)

    def ring(self, base, r_in, r_out, h, rgb, segs=48):
        """A short tube (wall ring)."""
        bot_o, bot_i, top_o, top_i = [], [], [], []
        for i in range(segs):
            a = i / segs * math.tau
            c, sn = math.cos(a), math.sin(a)
            bot_o.append(self.bm.verts.new(base + Vector((c * r_out, sn * r_out, 0))))
            bot_i.append(self.bm.verts.new(base + Vector((c * r_in, sn * r_in, 0))))
            top_o.append(self.bm.verts.new(base + Vector((c * r_out, sn * r_out, h))))
            top_i.append(self.bm.verts.new(base + Vector((c * r_in, sn * r_in, h))))
        faces = []
        for i in range(segs):
            j = (i + 1) % segs
            faces.append(self.bm.faces.new((bot_o[i], bot_o[j], top_o[j], top_o[i])))
            faces.append(self.bm.faces.new((top_i[i], top_i[j], bot_i[j], bot_i[i])))
            faces.append(self.bm.faces.new((top_o[i], top_o[j], top_i[j], top_i[i])))
        self._paint(faces, rgb, True)

    def to_object(self, mat):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        # the exporter takes the render colour: make ours both active and render, so it's COLOR_0
        me.color_attributes.active_color_name = "Col"
        me.color_attributes.render_color_index = me.color_attributes.find("Col")
        o = bpy.data.objects.new(self.name, me)
        o.data.materials.append(mat)
        scene.collection.objects.link(o)
        self.bm.free()
        return o


def material(name, rough, metal=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if coat:
        p.inputs["Coat Weight"].default_value = coat
        p.inputs["Coat Roughness"].default_value = 0.15
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], p.inputs["Base Color"])
    return m


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
WALLS = ["#c9c3b4", "#bdbfb8", "#d4cdbd", "#aeb3ad", "#c8b998", "#d8d2c4"]
ROOFS = ["#5f7a8c", "#4d6577", "#8a3f2e", "#7c8486", "#3f6a5a", "#a9adaa", "#2f5d86"]
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


def compound(x0, x1, z0, z1, gate_side):
    """Compound wall round a plot with a gate gap."""
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
            seg = (length - 7) / 2
            for k in (0, 1):
                if horiz:
                    cx = ax + seg / 2 if k == 0 else bx - seg / 2
                    acc("concrete").box(B(cx, az, h / 2), (seg, t, h), c)
                else:
                    cz = az + seg / 2 if k == 0 else bz - seg / 2
                    acc("concrete").box(B(ax, cz, h / 2), (t, seg, h), c)
        else:
            acc("concrete").box(B((ax + bx) / 2, (az + bz) / 2, h / 2), ((length, t, h) if horiz else (t, length, h)), c)


# ---------------------------------------------------------------- the ground plan
ppm = TEX / (2 * HALF)
albedo = np.zeros((TEX, TEX, 3), dtype=np.float32)
albedo[:] = hexc("#8e8b7a")
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


# scrubby grass and dry patches
for _ in range(240):
    g = rnd.random()
    blob(rnd.uniform(-HALF, HALF), rnd.uniform(-HALF, HALF), rnd.uniform(6, 26), [0.36 + 0.1 * g, 0.44 + 0.08 * g, 0.27], 0.5)
for _ in range(80):
    blob(rnd.uniform(-HALF, HALF), rnd.uniform(-HALF, HALF), rnd.uniform(8, 20), hexc("#a39a82"), 0.4)

# plots in each block
xs = [-HALF] + ROADS_X + [HALF]
zs = [-HALF] + ROADS_Z + [HALF]
lots = []


def split(r, depth=0):
    x0, x1, z0, z1 = r
    w, d = x1 - x0, z1 - z0
    if (w < 52 and d < 52 and rnd.random() < 0.35) or (w < 32 and d < 32) or depth > 6:
        lots.append(r)
        return
    if w > d:
        k = x0 + w * rnd.uniform(0.35, 0.65)
        split((x0, k, z0, z1), depth + 1)
        split((k, x1, z0, z1), depth + 1)
    else:
        k = z0 + d * rnd.uniform(0.35, 0.65)
        split((x0, x1, z0, k), depth + 1)
        split((x0, x1, k, z1), depth + 1)


inset = ROAD_W / 2 + 4
for i in range(len(xs) - 1):
    for j in range(len(zs) - 1):
        bx0 = xs[i] + (inset if i > 0 else 0)
        bx1 = xs[i + 1] - (inset if i < len(xs) - 2 else 0)
        bz0 = zs[j] + (inset if j > 0 else 0)
        bz1 = zs[j + 1] - (inset if j < len(zs) - 2 else 0)
        if bx1 - bx0 > 20 and bz1 - bz0 > 20:
            split((bx0, bx1, bz0, bz1))

for lot in lots:
    if overlaps(lot, KEEP_OUT):
        continue
    x0, x1, z0, z1 = lot
    w, d = x1 - x0, z1 - z0
    kind = rnd.random()
    if kind < 0.1:  # left green
        continue
    paint(x0 + 0.5, x1 - 0.5, z0 + 0.5, z1 - 0.5, hexc(CONCRETE), jitter=0.12)
    compound(x0 + 0.5, x1 - 0.5, z0 + 0.5, z1 - 0.5, rnd.choice("nsew"))
    m = rnd.uniform(3, 6)
    bx0, bx1, bz0, bz1 = x0 + m, x1 - m, z0 + m, z1 - m
    if bx1 - bx0 < 8 or bz1 - bz0 < 8:
        continue
    if kind < 0.2:
        yard(bx0, bx1, bz0, bz1)
    elif kind < 0.62:
        shed(bx0, bx1, bz0, bz1, rnd.uniform(6, 10.5))
    elif kind < 0.78:
        sawtooth(bx0, bx1, bz0, bz1, rnd.uniform(5.5, 8))
    else:
        # a block takes part of the plot; the rest is parking
        k = rnd.uniform(0.45, 0.7)
        if bx1 - bx0 > bz1 - bz0:
            block(bx0, bx0 + (bx1 - bx0) * k, bz0, bz1, rnd.choice([7, 10.4, 13.8]))
        else:
            block(bx0, bx1, bz0, bz0 + (bz1 - bz0) * k, rnd.choice([7, 10.4, 13.8]))

# roads on top of everything
for x in ROADS_X:
    paint(x - ROAD_W / 2, x + ROAD_W / 2, -HALF, HALF, hexc("#5a5b59"))
for z in ROADS_Z:
    paint(-HALF, HALF, z - ROAD_W / 2, z + ROAD_W / 2, hexc("#5a5b59"))
# kerb lines
for x in ROADS_X:
    for s in (-1, 1):
        paint(x + s * ROAD_W / 2 - 0.25, x + s * ROAD_W / 2 + 0.25, -HALF, HALF, hexc("#b9b6ab"))
for z in ROADS_Z:
    for s in (-1, 1):
        paint(-HALF, HALF, z + s * ROAD_W / 2 - 0.25, z + s * ROAD_W / 2 + 0.25, hexc("#b9b6ab"))

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
trees = []


def free_for_tree(x, z):
    if abs(x) > HALF - 2 or abs(z) > HALF - 2:
        return False
    for rx in ROADS_X:
        if abs(x - rx) < ROAD_W / 2 + 1.5:
            return False
    for rzz in ROADS_Z:
        if abs(z - rzz) < ROAD_W / 2 + 1.5:
            return False
    return not overlaps((x - 2, x + 2, z - 2, z + 2), KEEP_OUT)


for rx in ROADS_X:
    for side in (-1, 1):
        z = -HALF + rnd.uniform(0, 6)
        while z < HALF:
            x = rx + side * rnd.uniform(5.2, 6.4)
            if free_for_tree(x, z):
                trees.append((x, z, rnd.uniform(1.6, 3.0)))
            z += rnd.uniform(6, 11)
for rzz in ROADS_Z:
    for side in (-1, 1):
        x = -HALF + rnd.uniform(0, 6)
        while x < HALF:
            z = rzz + side * rnd.uniform(5.2, 6.4)
            if free_for_tree(x, z):
                trees.append((x, z, rnd.uniform(1.6, 3.0)))
            x += rnd.uniform(6, 11)
# clumps in the green lots
for lot in lots:
    if overlaps(lot, KEEP_OUT) or rnd.random() < 0.85:
        continue
    x0, x1, z0, z1 = lot
    for _ in range(rnd.randint(6, 16)):
        x, z = rnd.uniform(x0 + 2, x1 - 2), rnd.uniform(z0 + 2, z1 - 2)
        if free_for_tree(x, z):
            trees.append((x, z, rnd.uniform(2.0, 3.6)))
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
    bmesh.ops.create_icosphere(tree_bm, subdivisions=1, radius=s, matrix=Matrix.Translation(B(x, z, s * 0.95)) @ Matrix.Diagonal((1, 1, 1.15, 1)))
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
