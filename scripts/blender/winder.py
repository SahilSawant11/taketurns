"""
The hero's filament-winding machine, built in Blender to replace the
stand-in boxes in src/scripts/winding.ts.

Run headless from the repo root:

    blender -b -P scripts/blender/winder.py -- /tmp/winder.glb /tmp/winder-preview.png
    npx gltfpack -i /tmp/winder.glb -o public/models/winder.glb -cc -kn -km

Three nodes, each modelled in the hero's own coordinates (three.js: x along
the mandrel, y up, z towards the camera; the mandrel's axis is the x axis):

  winder_static    bed, headstock (motor, gearbox, chuck body, pendant
                   housing), tailstock (quill, handwheel), shaft, carriage
                   track (rails, rack, cable chain), feet
  winder_carriage  the carriage, modelled at x = 0 (the page slides it):
                   saddle on its bearing blocks, resin bath tray, doctor
                   blade, guide rollers, column and payout arm, creel
                   uprights and spindle
  winder_jaws      the chuck's three jaws (the page turns them with the mandrel)

The page keeps what it animates or draws itself: the wet-out roller, the
roving package, the resin surface, the payout eye and the live readout.
Materials are named and coloured; the page makes them fade with the machine.
The page adds each node whole (with its child meshes), so the packed quantization is kept.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.append(os.path.dirname(__file__))
from kit import hexc, srgb_to_lin  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = args[0] if args else "winder.glb"
PREVIEW = args[1] if len(args) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def T(x, y, z):
    """three.js (x, y up, z towards camera) → Blender (x, y back, z up)."""
    return Vector((x, -z, y))


MATS = {}


def mat(name, colour, rough, metal=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*srgb_to_lin(hexc(colour)), 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    MATS[name] = m
    return m


POWDER = mat("w_powder", "#1b1c1c", 0.62, 0.1)  # the machine's powder coat
CAST = mat("w_cast", "#232525", 0.55, 0.25)  # cast housings, a shade apart
STEEL = mat("w_steel", "#aeb2b5", 0.32, 1.0)  # machined steel
DARK_STEEL = mat("w_dsteel", "#5b5f62", 0.4, 1.0)
RUBBER = mat("w_rubber", "#0e0e0e", 0.85)
SAFETY = mat("w_safety", "#d9a21b", 0.45)  # yellow: guards, the e-stop collar
RED = mat("w_red", "#b3261e", 0.35)
GREEN = mat("w_accent", "#1f7a4f", 0.4, 0.1)  # a single brand line on the headstock


class Part:
    """Meshes for one exported node, merged at the end (one object per material)."""

    def __init__(self, name):
        self.name = name
        self.obs = []

    def add(self, ob, m, bevel=0.0, smooth=True):
        ob.data.materials.clear()
        ob.data.materials.append(m)
        if smooth:
            for p in ob.data.polygons:
                p.use_smooth = True
        if bevel:
            b = ob.modifiers.new("b", "BEVEL")
            b.width = bevel
            b.segments = 2
            b.limit_method = "ANGLE"
            w = ob.modifiers.new("w", "WEIGHTED_NORMAL")
            w.keep_sharp = True
        self.obs.append(ob)
        return ob

    def box(self, c, size, m, bevel=0.012, rot=(0, 0, 0)):
        """c and size in three.js terms: size = (along x, up, along z)."""
        bpy.ops.mesh.primitive_cube_add(size=1, location=T(*c))
        ob = bpy.context.active_object
        ob.scale = (size[0], size[2], size[1])
        ob.rotation_euler = rot
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        return self.add(ob, m, bevel, smooth=False)

    def cyl(self, c, r, length, axis, m, segs=40, bevel=0.006, r2=None):
        """A cylinder centred at c along three.js axis 'x', 'y' or 'z'."""
        bpy.ops.mesh.primitive_cone_add(vertices=segs, radius1=r, radius2=r if r2 is None else r2, depth=length, location=T(*c))
        ob = bpy.context.active_object
        ob.rotation_euler = {"x": (0, math.pi / 2, 0), "y": (0, 0, 0), "z": (math.pi / 2, 0, 0)}[axis]
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
        return self.add(ob, m, bevel)

    def torus(self, c, R, r, axis, m):
        bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=40, minor_segments=12, location=T(*c))
        ob = bpy.context.active_object
        ob.rotation_euler = {"x": (0, math.pi / 2, 0), "y": (0, 0, 0), "z": (math.pi / 2, 0, 0)}[axis]
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
        return self.add(ob, m)

    def finish(self):
        # apply modifiers, then join per material into one object under an empty named for the node
        for ob in self.obs:
            bpy.context.view_layer.objects.active = ob
            for md in list(ob.modifiers):
                bpy.ops.object.modifier_apply(modifier=md.name)
        root = bpy.data.objects.new(self.name, None)
        scene.collection.objects.link(root)
        by_mat = {}
        for ob in self.obs:
            by_mat.setdefault(ob.data.materials[0].name, []).append(ob)
        for mname, obs in by_mat.items():
            bpy.ops.object.select_all(action="DESELECT")
            for ob in obs:
                ob.select_set(True)
            bpy.context.view_layer.objects.active = obs[0]
            if len(obs) > 1:
                bpy.ops.object.join()
            j = bpy.context.view_layer.objects.active
            j.name = f"{self.name}_{mname}"
            j.parent = root
        return root


# ---------------------------------------------------------------- static: bed, headstock, tailstock, track
S = Part("winder_static")
FY = -1.72  # floor
# bed: two box-section beams with cross members under a machined top plate
for z in (-0.55, 0.55):
    S.box((0, -1.5, z), (10.4, 0.36, 0.22), POWDER, 0.015)
for x in (-4.6, -2.3, 0, 2.3, 4.6):
    S.box((x, -1.52, 0), (0.18, 0.3, 0.9), POWDER, 0.01)
S.box((0, -1.29, 0), (10.6, 0.06, 1.5), CAST, 0.01)
# the bed's ways: two hardened guides along the top for the tailstock to clamp to
for z in (-0.42, 0.42):
    S.box((0.6, -1.235, z), (9.0, 0.05, 0.1), STEEL, 0.006)
# levelling feet
for fx in (-4.9, -1.7, 1.7, 4.9):
    for fz in (-0.55, 0.55):
        S.cyl((fx, FY + 0.04, fz), 0.1, 0.08, "y", RUBBER, 24)
        S.cyl((fx, FY + 0.12, fz), 0.03, 0.12, "y", STEEL, 12)
# bolts along the bed top
for i in range(16):
    bx = -4.9 + i / 15 * 9.8
    for bz in (-0.64, 0.64):
        S.cyl((bx, -1.255, bz), 0.028, 0.02, "y", STEEL, 6, bevel=0.003)

# headstock: a cast housing with ribs, the gearbox nose towards the mandrel, the motor behind
HX = -4.8
S.box((HX, -0.42, 0), (1.25, 2.1, 1.6), CAST, 0.05)
S.box((HX - 0.05, 0.75, 0), (1.1, 0.26, 1.45), CAST, 0.06)  # stepped top
for z in (-0.81, 0.81):
    for k in range(4):
        S.box((HX - 0.45 + k * 0.3, -0.5, z), (0.05, 1.7, 0.04), CAST, 0.008)  # side ribs
S.box((HX + 0.66, -0.05, 0), (0.12, 1.0, 1.1), POWDER, 0.03)  # gearbox front plate
S.cyl((HX + 0.74, 0, 0), 0.3, 0.1, "x", CAST, 48)  # spindle nose housing
S.cyl((-4.05, 0, 0), 0.44, 0.26, "x", DARK_STEEL, 64, bevel=0.01)  # chuck body
S.cyl((-3.91, 0, 0), 0.2, 0.03, "x", STEEL, 48)  # chuck face centre
for k in range(3):
    a = k / 3 * math.tau
    S.box((-3.915, math.cos(a) * 0.3, math.sin(a) * 0.3), (0.02, 0.24, 0.06), RUBBER, 0.002, rot=(-a, 0, 0))  # T-slots
# drive motor on the back, with cooling fins and a terminal box
S.cyl((HX, 0.55, -1.0), 0.36, 0.9, "z", POWDER, 48, bevel=0.02)
for k in range(14):
    a = k / 14 * math.tau
    S.box((HX + math.cos(a) * 0.36, 0.55 + math.sin(a) * 0.36, -1.0), (0.03, 0.04, 0.8), POWDER, 0.004, rot=(0, -a, 0))
S.cyl((HX, 0.55, -1.48), 0.3, 0.06, "z", DARK_STEEL, 40)  # fan cowl
S.box((HX + 0.3, 0.98, -1.0), (0.26, 0.14, 0.3), POWDER, 0.02)  # terminal box
# front face: the green brand line, an e-stop on a yellow collar, the pendant housing
S.box((HX + 0.2, 0.62, 0.805), (0.9, 0.025, 0.01), GREEN, 0.002)
S.cyl((HX + 0.35, 0.2, 0.82), 0.075, 0.03, "z", SAFETY, 32)
S.cyl((HX + 0.35, 0.2, 0.86), 0.05, 0.05, "z", RED, 32, bevel=0.012)
S.box((-4.135, 0.55, 0.15), (0.08, 0.76, 1.1), POWDER, 0.02)  # pendant housing (the page draws the screen at x = -4.085)
S.cyl((-4.11, 0.06, 0.5), 0.035, 0.04, "x", STEEL, 24)  # selector knob
S.box((-4.4, 0.55, 0.15), (0.4, 0.08, 0.08), DARK_STEEL, 0.01)  # pendant arm

# shaft through to the tailstock
S.cyl((0, 0, 0), 0.07, 8.9, "x", STEEL, 32, bevel=0.0)

# tailstock: body on the ways, quill, handwheel, clamp lever
TX = 4.6
S.box((TX, -0.75, 0), (0.85, 0.9, 1.15), CAST, 0.04)
S.box((TX, -0.1, 0), (0.8, 0.5, 0.7), CAST, 0.08)
S.cyl((TX - 0.1, 0, 0), 0.24, 0.6, "x", CAST, 48, bevel=0.02)  # barrel round the quill
S.cyl((4.05, 0, 0), 0.13, 0.7, "x", STEEL, 40)  # quill
S.cyl((3.68, 0, 0), 0.09, 0.08, "x", STEEL, 32, r2=0.03)  # live centre
S.torus((TX + 0.5, 0, 0), 0.22, 0.02, "x", STEEL)
for k in range(3):
    a = k / 3 * math.tau
    S.box((TX + 0.5, math.cos(a) * 0.11, math.sin(a) * 0.11), (0.02, 0.22, 0.025), STEEL, 0.003, rot=(-a, 0, 0))
S.cyl((TX + 0.5, 0, 0), 0.05, 0.12, "x", STEEL, 24)
S.cyl((TX + 0.5, 0.18, 0.17), 0.018, 0.08, "x", RUBBER, 12)  # handwheel knob
S.cyl((TX - 0.2, -0.2, 0.62), 0.02, 0.3, "z", STEEL, 12)  # clamp lever
S.cyl((TX - 0.2, -0.2, 0.78), 0.035, 0.08, "z", RUBBER, 16)

# carriage track in front: a beam on low stands, two round rails, a rack, the cable chain
S.box((0, -1.47, 2.07), (10.4, 0.18, 0.5), POWDER, 0.012)
for x in (-4.9, -2.45, 0, 2.45, 4.9):
    S.box((x, -1.62, 2.07), (0.3, 0.2, 0.6), POWDER, 0.01)
for z in (1.78, 2.36):
    S.box((0, -1.34, z), (10.2, 0.08, 0.06), POWDER, 0.006)  # rail supports
    S.cyl((0, -1.2, z), 0.045, 10.2, "x", STEEL, 32, bevel=0.0)
S.box((0, -1.36, 2.07), (10.2, 0.05, 0.04), DARK_STEEL, 0.004)  # rack
for i in range(170):
    S.box((-5.0 + i * 0.06, -1.325, 2.07), (0.02, 0.02, 0.04), DARK_STEEL, 0.0)  # its teeth
for i in range(46):
    S.box((-4.4 + i * 0.19, -1.18, -0.82), (0.16, 0.12, 0.14), RUBBER, 0.015)  # cable chain on the bed's back

static = S.finish()

# ---------------------------------------------------------------- the carriage, at x = 0
C = Part("winder_carriage")
# saddle: a plate on four bearing blocks riding the rails, a drive pinion box
for x in (-0.33, 0.33):
    for z in (1.78, 2.36):
        C.box((x, -1.12, z), (0.18, 0.12, 0.14), DARK_STEEL, 0.01)
C.box((0, -1.02, 2.07), (0.95, 0.06, 0.95), POWDER, 0.012)
C.box((0.38, -1.12, 2.07), (0.16, 0.14, 0.2), POWDER, 0.01)
# resin bath: an open tray the page fills (its surface at y = -0.715)
TB = (-0.98, -0.72)
for (cx, cz, sx, sz) in ((0, 1.84, 0.74, 0.02), (0, 2.3, 0.74, 0.02), (-0.36, 2.07, 0.02, 0.46), (0.36, 2.07, 0.02, 0.46)):
    C.box((cx, (TB[0] + TB[1]) / 2, cz), (sx, TB[1] - TB[0], sz), STEEL, 0.004)
C.box((0, TB[0] + 0.01, 2.07), (0.74, 0.02, 0.46), STEEL, 0.004)
C.box((0, -0.69, 1.95), (0.64, 0.03, 0.02), STEEL, 0.004)  # doctor blade
for x in (-0.3, 0.3):
    C.box((x, -0.72, 2.07), (0.03, 0.12, 0.08), DARK_STEEL, 0.004)  # roller bearing blocks
# guide rollers between the creel and the bath
for y, z in ((-0.48, 2.5), (-0.62, 2.36)):
    C.cyl((0, y, z), 0.035, 0.5, "x", STEEL, 24)
    for x in (-0.27, 0.27):
        C.box((x, y - 0.06, z), (0.02, 0.16, 0.05), DARK_STEEL, 0.003)
# column and payout arm out to the eye (the page draws the eye at (0, 0.05, 1.5))
C.box((0, -0.38, 2.26), (0.16, 1.24, 0.16), POWDER, 0.02)
C.box((0, 0.05, 1.9), (0.12, 0.12, 0.8), POWDER, 0.02)
C.box((0, 0.05, 2.26), (0.2, 0.2, 0.2), CAST, 0.02)  # the arm's clamp on the column
C.box((0, 0.05, 1.53), (0.06, 0.16, 0.04), STEEL, 0.004)  # eye bracket
# creel: two uprights and the spindle (the page draws the roving package on it)
for sx in (-0.25, 0.25):
    C.box((sx, -0.75, 2.72), (0.035, 0.46, 0.14), POWDER, 0.008)
C.cyl((0, -0.52, 2.72), 0.05, 0.56, "x", STEEL, 24)
C.box((0, -0.99, 2.62), (0.6, 0.04, 0.3), POWDER, 0.008)  # creel shelf to the saddle
# safety: yellow end caps on the saddle
for x in (-0.49, 0.49):
    C.box((x, -1.02, 2.07), (0.02, 0.07, 0.95), SAFETY, 0.003)
carriage = C.finish()

# ---------------------------------------------------------------- the chuck's jaws
J = Part("winder_jaws")
for k in range(3):
    a = k / 3 * math.tau
    # three-step jaws, gripping the shaft
    for s, (h, w) in enumerate(((0.1, 0.32), (0.08, 0.24), (0.06, 0.16))):
        r = 0.22 + s * 0.06
        J.box((-3.88 + s * 0.0, math.cos(a) * r, math.sin(a) * r), (0.16 - s * 0.03, h, w - s * 0.02), DARK_STEEL, 0.008, rot=(-a, 0, 0))
jaws = J.finish()

# ---------------------------------------------------------------- export
for o in scene.objects:
    o.select_set(True)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True, export_apply=True, export_extras=False)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in scene.objects if o.type == "MESH")
print(f"[winder] {tris} tris → {OUT}")

# ---------------------------------------------------------------- preview: roughly the hero's opening shot
if PREVIEW:
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = "GPU"
    except Exception:
        pass
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.02, 0.02, 0.02, 1)
    scene.world = world
    bpy.ops.mesh.primitive_plane_add(size=40, location=T(0, FY, 0))
    floor = bpy.context.active_object
    floor.data.materials.append(mat("floor", "#2a2b2b", 0.8))
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=1.0, depth=5.2, location=T(0.4, 0, 0), rotation=(0, math.pi / 2, 0))
    bpy.context.active_object.data.materials.append(STEEL)  # a stand-in mandrel, for scale
    for name, loc, power, size in (("key", T(-2, 7, 6), 2500, 5), ("rim", T(4, 4, -5), 1200, 3)):
        L = bpy.data.lights.new(name, "AREA")
        L.energy, L.size = power, size
        o = bpy.data.objects.new(name, L)
        o.location = loc
        scene.collection.objects.link(o)
        c = o.constraints.new("TRACK_TO")
        c.target = static
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 32
    cam.location = T(6.4, 2.4, 13.6)
    scene.collection.objects.link(cam)
    aim = bpy.data.objects.new("aim", None)
    aim.location = T(0, -1.25, 0)
    scene.collection.objects.link(aim)
    c = cam.constraints.new("TRACK_TO")
    c.target = aim
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
