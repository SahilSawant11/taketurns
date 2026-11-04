"""
The finale's twig: a peepal (Ficus religiosa) twig the home page's leaf comes
to hang from, built in Blender.

Run headless from the repo root:

    blender -b -P scripts/blender/twig.py -- public/models/twig.glb /tmp/twig-preview.png

A short cut sprig, seen whole: a tapering, gently zigzagging twig with
swollen nodes and leaf scars, pale lenticels on the older bark, and the
coppery stipule bud that sheathes a peepal's growing tip. Vertex coloured,
no textures.

Units match the leaf in src/scripts/leaf.ts (blade base to tip = 1), so the
page scales the twig by the leaf's size. Blender's x/z are the screen's x/y
(glTF x/y once exported Y-up). The tip points left; the cut end is at +x.
Empties mark where leaves hang (their petioles' ends):

  node_hero   the leaf that followed the page (at the origin)
  node_b      an older leaf further along
  node_young  a young copper leaf just behind the bud
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.append(os.path.dirname(__file__))
from kit import hexc, material  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = args[0] if args else "twig.glb"
PREVIEW = args[1] if len(args) > 1 else None
random.seed(11)

bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------------------------------------------------------------- the spine
# (x, depth, z): tip on the left, base off to the right. It kinks a little at
# each node, the way a twig zigzags where its leaves grow.
SPINE = [
    (-0.30, 0.00, 0.15), (-0.15, 0.01, 0.06), (0.00, 0.00, 0.00), (0.45, -0.02, 0.05),
    (0.95, -0.01, 0.14), (1.50, 0.02, 0.19), (1.95, 0.00, 0.30), (2.35, -0.01, 0.40),
]
NODES = {"node_young": -0.22, "node_hero": 0.0, "node_b": 1.5}  # by x on the spine


def catmull(pts, per):
    P = [pts[0]] + pts + [pts[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = (Vector(P[j]) for j in (i - 1, i, i + 1, i + 2))
        for k in range(per):
            t = k / per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(Vector(pts[-1]))
    return out


path = catmull(SPINE, 28)
arc = [0.0]
for a, b in zip(path, path[1:]):
    arc.append(arc[-1] + (b - a).length)
L = arc[-1]
node_arc = {name: min(range(len(path)), key=lambda i: abs(path[i].x - x)) for name, x in NODES.items()}


def radius(i):
    s = arc[i] / L  # 0 at the tip → 1 at the base
    r = 0.017 + 0.036 * s ** 0.8
    for name, j in node_arc.items():
        d = (arc[i] - arc[j]) / 0.045
        r *= 1 + (0.35 if name != "node_young" else 0.2) * math.exp(-d * d)  # swollen node
    return r


# bark: greenish tan near the growing tip, grey-brown further back
YOUNG, OLD, SCAR, LENTICEL = (hexc(h) for h in ("#7f7a4f", "#86786a", "#4a3d31", "#c3b79c"))


def mix(a, b, t):
    return [x + (y - x) * t for x, y in zip(a, b)]


def bark(i, k):
    c = mix(YOUNG, OLD, min(1.0, arc[i] / 2.2))
    # leaf scars: a soft dark band just below each node
    for j in node_arc.values():
        d = (arc[i] - arc[j] - 0.012) / 0.014
        c = mix(c, SCAR, 0.55 * math.exp(-d * d))
    # lenticels: small, faint pale flecks on the older bark
    if arc[i] > 0.6 and random.random() < 0.035 * min(1, arc[i] / 2):
        c = mix(c, LENTICEL, 0.4)
    # a fine, uneven darkening along the grain, and a darker underside
    g = 0.94 + 0.06 * math.sin(arc[i] * 37 + k * 1.7) * math.sin(arc[i] * 5.3)
    under = 0.82 + 0.18 * (0.5 + 0.5 * math.sin(k / SEG * math.tau))
    return [x * g * under for x in c]


SEG = 14
bm = bmesh.new()
col = bm.loops.layers.color.new("Col")
rings = []
up = Vector((0, 1, 0))  # depth axis: the frame's reference, so the twig never twists
for i, p in enumerate(path):
    t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
    n = up.cross(t).normalized()
    b = t.cross(n).normalized()
    r = radius(i)
    ring = []
    for k in range(SEG):
        a = k / SEG * math.tau
        v = bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * r)
        ring.append((v, bark(i, k)))
    rings.append(ring)
for i in range(len(rings) - 1):
    for k in range(SEG):
        q = (rings[i][k], rings[i][(k + 1) % SEG], rings[i + 1][(k + 1) % SEG], rings[i + 1][k])
        f = bm.faces.new([v for v, _ in q])
        f.smooth = True
        for loop, (_, c) in zip(f.loops, q):
            loop[col] = (*c, 1.0)
# the cut end: pale wood inside a thin ring of bark
centre = bm.verts.new(path[-1] + (path[-1] - path[-2]).normalized() * 0.004)
WOOD, CAMBIUM = hexc("#d8c7a2"), hexc("#9c8a5e")
for k in range(SEG):
    a, b = rings[-1][(k + 1) % SEG][0], rings[-1][k][0]
    f = bm.faces.new((a, b, centre))
    for loop in f.loops:
        loop[col] = (*(WOOD if loop.vert is centre else CAMBIUM), 1.0)

# ---------------------------------------------------------------- the bud
# The stipule sheathing the growing tip: a slim, slightly curved cone, copper red.
tip, before = path[0], path[3]
d = (tip - before).normalized()
side = up.cross(d).normalized()
BUD_L = 0.17
bud_rings = []
for i in range(13):
    s = i / 12
    c = tip + d * (BUD_L * s) + Vector((0, 0, 1)) * 0.025 * s * s  # curls up a touch
    r = 0.019 * math.sin(math.pi * min(1, 0.15 + s * 0.95)) ** 0.7 * (1 - s) ** 0.35 + 0.0005
    col_s = [a + (b - a) * s for a, b in zip(hexc("#8c4a35"), hexc("#d27a5f"))]
    ring = []
    for k in range(SEG):
        a = k / SEG * math.tau
        ring.append((bm.verts.new(c + (side * math.cos(a) + d.cross(side) * math.sin(a)) * r), col_s))
    bud_rings.append(ring)
for i in range(len(bud_rings) - 1):
    for k in range(SEG):
        q = (bud_rings[i][k], bud_rings[i][(k + 1) % SEG], bud_rings[i + 1][(k + 1) % SEG], bud_rings[i + 1][k])
        f = bm.faces.new([v for v, _ in q])
        f.smooth = True
        for loop, (_, c) in zip(f.loops, q):
            loop[col] = (*c, 1.0)

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
me = bpy.data.meshes.new("twig")
bm.to_mesh(me)
bm.free()
me.color_attributes.active_color_name = "Col"
me.color_attributes.render_color_index = me.color_attributes.find("Col")
twig = bpy.data.objects.new("twig", me)
mat = material("twig_bark", rough=0.82)
twig.data.materials.append(mat)
bpy.context.scene.collection.objects.link(twig)

# ---------------------------------------------------------------- attach points
# Each leaf hangs from the underside of its node.
for name, j in node_arc.items():
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.05
    e.location = path[j] - Vector((0, 0, radius(j) * 0.6))
    bpy.context.scene.collection.objects.link(e)

# ---------------------------------------------------------------- export
for o in bpy.context.scene.objects:
    o.select_set(True)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_apply=True,
    export_extras=False,
)
print(f"twig: {len(me.vertices)} verts → {OUT}")

# ---------------------------------------------------------------- preview
if PREVIEW:
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.samples = 64
    scn.render.resolution_x, scn.render.resolution_y = 1400, 700
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (*[c for c in (0.05, 0.12, 0.08)], 1)
    scn.world = world
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 3.2
    cam.location = (1.0, -6, 0.15)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scn.collection.objects.link(cam)
    scn.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(55), 0, math.radians(-30))
    scn.collection.objects.link(sun)
    scn.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
