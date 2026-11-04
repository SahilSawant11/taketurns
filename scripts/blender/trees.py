"""
The estate's trees, seen from the hero's aerial view: three low-poly kinds
the page instances along the roads and green belts (src/scripts/three/plant.ts).

Run headless from the repo root:

    blender -b -P scripts/blender/trees.py -- /tmp/trees.glb /tmp/trees-preview.png
    npx gltfpack -i /tmp/trees.glb -o public/models/trees.glb -cc -kn -km -noq

  tree_round   a broad, rounded shade tree (neem, peepal)
  tree_oval    a taller, narrower crown (ashoka, eucalyptus)
  tree_spread  a wide, flatter umbrella (rain tree)

Each is a trunk with a crown of clumped leaf masses: metaball lobes merged,
roughened with noise, decimated to a few hundred triangles, with ambient
occlusion baked into the vertex colours (dark beneath and between the
clumps, lighter on top) so they read with depth from far off without a
texture. *_lo versions are lighter still, for phones.

Unit size: the crown is about 1 across its radius, centred near 1 up, so the
positions file (scripts/blender/estate.py) scales them as before and they sit
on the tree shadows baked into the ground. Blender z-up; glTF y-up on export.
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.append(os.path.dirname(__file__))
from kit import hexc, material, srgb_to_lin  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = args[0] if args else "trees.glb"
PREVIEW = args[1] if len(args) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------------------------------------------------------------- the kinds
# crown: an ellipsoid (centre height, radius across, radius up) covered in leaf
# clumps (count, clump radius) round a filler core; trunk: (height, base radius, limbs).
KINDS = {
    "tree_round": dict(seed=3, centre=1.05, rx=0.82, rz=0.68, clumps=(20, 0.34), trunk=(0.95, 0.075, 3), leaf="#486a34", tris=560),
    "tree_oval": dict(seed=7, centre=1.3, rx=0.56, rz=0.95, clumps=(20, 0.28), trunk=(0.85, 0.06, 2), leaf="#3c5e31", tris=520),
    "tree_spread": dict(seed=5, centre=1.22, rx=1.12, rz=0.46, clumps=(24, 0.31), trunk=(1.05, 0.085, 4), leaf="#557a3b", tris=620),
}
BARK = srgb_to_lin(hexc("#5e5245"))


def lin_mix(a, b, t):
    return [x + (y - x) * t for x, y in zip(a, b)]


def apply_all(ob):
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def crown(name, k):
    rnd = random.Random(k["seed"])
    mb = bpy.data.metaballs.new(name + "_mb")
    mb.resolution = mb.render_resolution = 0.05
    mb.threshold = 0.6
    c, rx, rz = k["centre"], k["rx"], k["rz"]
    core = mb.elements.new(type="ELLIPSOID")
    core.co = (0, 0, c)
    core.radius = 1.0
    core.size_x = core.size_y = rx * 0.62
    core.size_z = rz * 0.82  # tall enough to fill the ring of clumps on top (no crater)
    n, cr = k["clumps"]
    # clumps spread evenly over the shell (a Fibonacci spiral), fewer underneath
    placed = 0
    i = 0
    while placed < n and i < n * 3:
        i += 1
        u = (i + 0.5) / (n * 1.25)
        z = 1 - 2 * u
        if z < -0.55:
            continue
        r = math.sqrt(max(0, 1 - z * z))
        a = i * math.pi * (3 - math.sqrt(5)) + rnd.uniform(-0.2, 0.2)
        el = mb.elements.new()
        jit = rnd.uniform(0.82, 1.0)
        el.co = (math.cos(a) * r * rx * jit, math.sin(a) * r * rx * jit, c + z * rz * jit)
        el.radius = cr * rnd.uniform(0.85, 1.2) * 1.7
        el.stiffness = 2.4
        placed += 1
    # the crown's top: the spiral leaves the pole open, which reads as a dimple
    el = mb.elements.new()
    el.co = (rnd.uniform(-0.04, 0.04), rnd.uniform(-0.04, 0.04), c + rz * 0.9)
    el.radius = cr * 1.15 * 1.7
    el.stiffness = 2.4
    ob = bpy.data.objects.new(name + "_crown", mb)
    scene.collection.objects.link(ob)
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target="MESH")
    ob = bpy.context.view_layer.objects.active
    # a little unevenness, so no clump is a perfect dome
    tex = bpy.data.textures.new(name + "_rough", "CLOUDS")
    tex.noise_scale = 0.18
    d = ob.modifiers.new("rough", "DISPLACE")
    d.texture = tex
    d.strength = 0.06
    d.texture_coords = "LOCAL"
    apply_all(ob)
    return ob


def trunk(name, k):
    rnd = random.Random(k["seed"] + 100)
    h, r, limbs = k["trunk"]
    bm = bmesh.new()

    def limb(a, b, ra, rb, seg=6):
        d = (b - a).normalized()
        side = d.cross(Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))).normalized()
        up = d.cross(side)
        rings = []
        for p, rad in ((a, ra), (b, rb)):
            rings.append([bm.verts.new(p + (side * math.cos(t) + up * math.sin(t)) * rad) for t in (i / seg * math.tau for i in range(seg))])
        for i in range(seg):
            bm.faces.new((rings[0][i], rings[0][(i + 1) % seg], rings[1][(i + 1) % seg], rings[1][i]))

    fork = Vector((0, 0, h * 0.55))
    limb(Vector((0, 0, -0.05)), fork, r, r * 0.8)
    for i in range(limbs):
        a = i / limbs * math.tau + rnd.uniform(-0.3, 0.3)
        lean = 0.3 if k["rz"] > k["rx"] else 0.6 if k["rx"] > 1 else 0.42  # narrow crowns: upright limbs
        end = fork + Vector((math.cos(a) * lean * h * 0.5, math.sin(a) * lean * h * 0.5, h * 0.5))
        limb(fork, end, r * 0.7, r * 0.3, seg=5)
    me = bpy.data.meshes.new(name + "_trunk")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name + "_trunk", me)
    scene.collection.objects.link(ob)
    return ob


def decimate(ob, tris):
    now = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if now > tris:
        d = ob.modifiers.new("dec", "DECIMATE")
        d.ratio = tris / now
        apply_all(ob)


def colours(ob, leaf, bark_from):
    """Vertex colour: leaf green, lighter towards the top and the sun side; bark below bark_from verts."""
    me = ob.data
    if "Col" not in me.color_attributes:
        me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    col = me.color_attributes["Col"]
    zs = [v.co.z for v in me.vertices]
    z0, z1 = min(zs), max(zs)
    rnd = random.Random(len(me.vertices))
    for v in me.vertices:
        if v.index < bark_from:
            c = BARK
        else:
            t = (v.co.z - z0) / max(z1 - z0, 1e-6)
            c = lin_mix([x * 0.72 for x in leaf], [min(1, x * 1.22) for x in leaf], t ** 0.8)
            c = [x * rnd.uniform(0.94, 1.06) for x in c]
        col.data[v.index].color = (*c, 1.0)
    me.color_attributes.active_color_name = "Col"
    me.color_attributes.render_color_index = me.color_attributes.find("Col")


# ---------------------------------------------------------------- build
built = []
for name, k in KINDS.items():
    for lo in (False, True):
        nm = name + ("_lo" if lo else "")
        c = crown(nm, k)
        decimate(c, k["tris"] // (3 if lo else 1))
        t = trunk(nm, k)
        n_bark = len(t.data.vertices)
        # one mesh: trunk first (so its verts are the bark ones), then the crown
        bpy.ops.object.select_all(action="DESELECT")
        t.select_set(True)
        c.select_set(True)
        bpy.context.view_layer.objects.active = t
        bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = ob.data.name = nm
        for p in ob.data.polygons:
            p.use_smooth = True
        colours(ob, srgb_to_lin(hexc(k["leaf"])), n_bark)
        built.append(ob)

# ---------------------------------------------------------------- bake AO into the vertex colours
# Spread out on a ground plane (it occludes the undersides), bake AO, multiply it in.
scene.render.engine = "CYCLES"
scene.cycles.samples = 64
scene.cycles.device = "CPU"
ground = bpy.data.objects.new("bake_ground", bpy.data.meshes.new("bake_ground"))
gbm = bmesh.new()
bmesh.ops.create_grid(gbm, x_segments=1, y_segments=1, size=40)
gbm.to_mesh(ground.data)
gbm.free()
scene.collection.objects.link(ground)
world = bpy.data.worlds.new("w")
world.use_nodes = True
scene.world = world
mats = {}
for i, ob in enumerate(built):
    ob.location = ((i % 3) * 4.0 - 4.0, (i // 3) * 4.0, 0)
for ob in built:
    tint = ob.data.color_attributes["Col"]
    base = [tuple(d.color) for d in tint.data]
    ao = ob.data.color_attributes.new("AO", "FLOAT_COLOR", "POINT")
    ob.data.color_attributes.active_color_name = "AO"
    m = material(ob.name + "_bake", rough=0.9)
    ob.data.materials.clear()
    ob.data.materials.append(m)
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    scene.render.bake.target = "VERTEX_COLORS"
    bpy.ops.object.bake(type="AO")
    for j, d in enumerate(ao.data):
        a = d.color[0]
        k = 0.42 + 0.58 * a ** 0.9  # never black: light still scatters in under a canopy
        tint.data[j].color = (base[j][0] * k, base[j][1] * k, base[j][2] * k, 1.0)
    ob.data.color_attributes.remove(ao)
    ob.data.color_attributes.active_color_name = "Col"
    ob.data.materials.clear()
    ob.data.materials.append(mats.setdefault("tree", material("tree", rough=0.88)))

# ---------------------------------------------------------------- export (trees only, each at the origin)
bpy.data.objects.remove(ground)
for ob in built:
    ob.location = (0, 0, 0)
bpy.ops.object.select_all(action="DESELECT")
for ob in built:
    ob.select_set(True)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True, export_apply=True, export_extras=False)
for ob in built:
    print(f"[trees] {ob.name}: {sum(len(p.vertices) - 2 for p in ob.data.polygons)} tris")

# ---------------------------------------------------------------- preview: the three side by side from the hero's height
if PREVIEW:
    for i, ob in enumerate(o for o in built if not o.name.endswith("_lo")):
        ob.location = (i * 2.6 - 2.6, 0, 0)
        ob.scale = (1, 1, 1)
    for i, ob in enumerate(o for o in built if o.name.endswith("_lo")):
        ob.location = (i * 2.6 - 2.6, 3.2, 0)
    g = bpy.data.objects.new("ground", bpy.data.meshes.new("ground"))
    gbm = bmesh.new()
    bmesh.ops.create_grid(gbm, x_segments=1, y_segments=1, size=30)
    gbm.to_mesh(g.data)
    gbm.free()
    gm = bpy.data.materials.new("ground")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*srgb_to_lin(hexc("#7d8466")), 1)
    g.data.materials.append(gm)
    scene.collection.objects.link(g)
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.9, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.data.angle = math.radians(4)
    sun.rotation_euler = (math.radians(40), 0, math.radians(-35))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 50
    cam.location = (0, -9, 10)
    scene.collection.objects.link(cam)
    aim = bpy.data.objects.new("aim", None)
    aim.location = (0, 1.6, 0.8)
    scene.collection.objects.link(aim)
    tc = cam.constraints.new("TRACK_TO")
    tc.target = aim
    tc.track_axis, tc.up_axis = "TRACK_NEGATIVE_Z", "UP_Y"
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = 1400, 900
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
