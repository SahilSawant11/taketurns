"""
The finale's still water: the home page's peepal leaf landing on a pond and
floating there, rendered in Blender (Cycles).

Run headless from the repo root:

    blender -b -P scripts/blender/pond.py -- still /tmp/pond.png [samples] [time]
    blender -b -P scripts/blender/pond.py -- frames /tmp/pond/ [samples] [first] [last]
    blender -b -P scripts/blender/pond.py -- empty /tmp/pond-empty.png [samples]

'empty' is the water at frame 0 without the leaf or its rings: the stage's poster, which
the live leaf comes down onto before the render takes over.

A dark, still pond in shade: a real water surface (IOR 1.33) over silty
depths that tint to deep green, reflecting trees and sky (the forest HDRI
that ships with Blender). The leaf (the page's own textures,
public/models/leaf/leaf-*.webp) lies on it, wet and slightly cupped, and
rings spread out from where it touched down: real geometry, not a texture.

The timeline is one function of time, at 24 fps:
  0–5 s  (frames 0–119)    touchdown: three rings and a bob, all gone by 5 s
  5–9 s  (frames 120–215)  afloat: a faint ring every 4 s and a slow rock,
                           periodic, so it loops with no seam
Frame 0 is the leaf at rest, just touching: the page's live leaf hands off
to it there (src/scripts/leaf.ts).

Units: the leaf's blade is 1 long, as in src/scripts/leaf.ts.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
MODE = args[0] if args else "still"
OUT = args[1] if len(args) > 1 else "/tmp/pond.png"
SAMPLES = int(args[2]) if len(args) > 2 else 128
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LEAF_DIR = os.path.join(ROOT, "public", "models", "leaf")
HDRI = os.path.join(os.path.dirname(bpy.app.binary_path), "..", "Resources", f"{bpy.app.version[0]}.{bpy.app.version[1]}", "datafiles", "studiolights", "world", "forest.exr")

FPS = 24
LAND_S = 5.0  # touchdown, then
LOOP_S = 4.0  # the loop afloat
WAVE = 0.3  # a ring's wavelength
SPEED = 0.55  # how fast rings spread (leaf lengths a second)
LEAF_TURN = -32  # degrees, the leaf's heading on the water
# degrees, the forest turned so the bright sky reflects on the far water, not at the frame's sides
SKY_TURN = float(os.environ.get("POND_SKY", 290))
TAU = math.tau

# Rings: (emitted at, height, gone by). The landing's must be gone by LAND_S;
# the faint ones afloat repeat every LOOP_S and live exactly two periods, so
# the state at LAND_S equals the state at LAND_S + LOOP_S.
RINGS = [(0.0, 0.0050, LAND_S), (0.45, 0.0032, LAND_S), (1.05, 0.0018, LAND_S)]
IDLE_H = 0.0011
IDLE_AT = LAND_S - LOOP_S  # 1 s: one faint ring during touchdown, then every 4 s


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


CALM = False  # 'empty': the water before touchdown, no rings yet


def rings_at(t):
    if CALM:
        return []
    out = [(e, a, end) for e, a, end in RINGS]
    n = 0
    while IDLE_AT + n * LOOP_S <= t:
        e = IDLE_AT + n * LOOP_S
        out.append((e, IDLE_H, e + 2 * LOOP_S))
        n += 1
    return out


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def node(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


# ---------------------------------------------------------------- the water surface: rings and swells as geometry
SIZE, RES = 16.0, 1000
xs = np.linspace(-SIZE / 2, SIZE / 2, RES, dtype=np.float32)
gx, gy = np.meshgrid(xs, xs)
gr = np.hypot(gx, gy)
rng = np.random.default_rng(3)
# faint, wide swells from the breeze, so the far water isn't a mirror; each one's
# frequency in time is a whole number of loop periods, so they loop too
SWELLS = [(rng.uniform(1.2, 3.5), rng.uniform(0, TAU), rng.uniform(0, TAU), int(rng.integers(1, 3))) for _ in range(14)]


def surface(t):
    h = np.zeros_like(gr)
    for e, a, end in rings_at(t):
        age = t - e
        if age < 0 or t >= end:
            continue
        R = 0.45 + SPEED * age
        w = 0.16 + 0.05 * age
        amp = a * math.exp(-age * 0.55) * (1 - float(smooth(end - e - 1.6, end - e, age)))
        d = gr - R
        h += amp * np.exp(-((d / w) ** 2)) * np.sin(TAU * d / WAVE)
    for k, th, ph, m in SWELLS:
        h += 0.0007 * np.sin(k * (gx * math.cos(th) + gy * math.sin(th)) + ph - TAU * m * t / LOOP_S)
    return h


me = bpy.data.meshes.new("water")
me.vertices.add(RES * RES)
me.vertices.foreach_set("co", np.stack([gx, gy, np.zeros_like(gx)], -1).ravel())
i = np.arange(RES - 1)
a_ = (i[:, None] * RES + i[None, :]).ravel()
faces = np.stack([a_, a_ + 1, a_ + RES + 1, a_ + RES], -1)
me.loops.add(faces.size)
me.loops.foreach_set("vertex_index", faces.ravel().astype(np.int32))
me.polygons.add(len(faces))
me.polygons.foreach_set("loop_start", np.arange(0, faces.size, 4, dtype=np.int32))
me.polygons.foreach_set("use_smooth", np.ones(len(faces), dtype=bool))
me.update()
water = bpy.data.objects.new("water", me)
scene.collection.objects.link(water)
CO = np.stack([gx, gy, np.zeros_like(gx)], -1).reshape(-1, 3).astype(np.float32)


def set_surface(t):
    CO[:, 2] = surface(t).ravel()
    me.vertices.foreach_set("co", CO.ravel())
    me.update()


wm = bpy.data.materials.new("water")
wm.use_nodes = True
p = wm.node_tree.nodes["Principled BSDF"]
p.inputs["Base Color"].default_value = (1, 1, 1, 1)
p.inputs["Roughness"].default_value = 0.015
p.inputs["IOR"].default_value = 1.333
p.inputs["Transmission Weight"].default_value = 1.0
water.data.materials.append(wm)

# The depth: absorption only, in a block just under the surface. Volume with no
# surface shader is no interface, so the light isn't bent twice (no stray arcs).
bpy.ops.mesh.primitive_cube_add(size=1)
depth = bpy.context.object
depth.name = "depth"
depth.scale = (SIZE, SIZE, 1.6)
depth.location = (0, 0, -0.012 - 0.8)
dm = bpy.data.materials.new("depth")
dm.use_nodes = True
dn = dm.node_tree
dn.nodes.remove(dn.nodes["Principled BSDF"])
vol = node(dn, "ShaderNodeVolumeAbsorption", Color=(0.22, 0.46, 0.33, 1), Density=1.7)  # towards the finale's deep green
dn.links.new(vol.outputs["Volume"], dn.nodes["Material Output"].inputs["Volume"])
depth.data.materials.append(dm)

# the bed: silt and old leaf litter, dark and soft
bpy.ops.mesh.primitive_plane_add(size=SIZE, location=(0, 0, -1.62))
bed = bpy.context.object
bm = bpy.data.materials.new("bed")
bm.use_nodes = True
nb = bm.node_tree
pb = nb.nodes["Principled BSDF"]
noise = node(nb, "ShaderNodeTexNoise", Scale=1.6, Detail=8.0, Roughness=0.62)
ramp = nb.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].color = (0.01, 0.022, 0.014, 1)
ramp.color_ramp.elements[1].color = (0.05, 0.07, 0.035, 1)
nb.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
nb.links.new(ramp.outputs["Color"], pb.inputs["Base Color"])
pb.inputs["Roughness"].default_value = 0.9
bed.data.materials.append(bm)

# ---------------------------------------------------------------- the leaf: the page's textures on a gently cupped blade
NX, NY = 120, 144
lx = np.linspace(-0.5, 0.5, NX + 1, dtype=np.float32)
ly = np.linspace(-0.2, 1.0, NY + 1, dtype=np.float32)
LX, LY = np.meshgrid(lx, ly)
# cupped across the midrib, the base lifted a little, a soft wave along the margin, the tip curling up
LZ = 0.11 * np.abs(LX) ** 1.5 + 0.05 * ((LY - 0.42) / 0.6) ** 2 + 0.006
LZ += 0.012 * np.sin(LY * 17 + LX * 5) * np.abs(LX) * 2 + 0.06 * np.clip(LY - 0.8, 0, None) ** 1.5 * 4
lv = np.stack([LX, LY - 0.42, LZ], -1).reshape(-1, 3)
j = (np.arange(NY)[:, None] * (NX + 1) + np.arange(NX)[None, :]).ravel()
lf = np.stack([j, j + 1, j + NX + 2, j + NX + 1], -1)
lme = bpy.data.meshes.new("leaf")
lme.vertices.add(len(lv))
lme.vertices.foreach_set("co", lv.ravel())
lme.loops.add(lf.size)
lme.loops.foreach_set("vertex_index", lf.ravel().astype(np.int32))
lme.polygons.add(len(lf))
lme.polygons.foreach_set("loop_start", np.arange(0, lf.size, 4, dtype=np.int32))
lme.polygons.foreach_set("use_smooth", np.ones(len(lf), dtype=bool))
uv = lme.uv_layers.new(name="UVMap")
loop_v = lf.ravel()
uv.data.foreach_set("uv", np.stack([LX.ravel()[loop_v] + 0.5, (LY.ravel()[loop_v] + 0.2) / 1.2], -1).ravel())
lme.update()
leaf = bpy.data.objects.new("leaf", lme)
scene.collection.objects.link(leaf)


def set_leaf(t):
    """At rest at t = 0, just touching; it dips and rocks as the first ring leaves it, then floats."""
    land = 1 - float(smooth(LAND_S - 1.5, LAND_S, t))
    ph = TAU * t / LOOP_S
    z = -0.014 * math.exp(-t * 1.6) * math.sin(t * 7.0) * land + 0.0018 * math.sin(ph)
    rx = 0.035 * math.exp(-t * 1.4) * math.sin(t * 6.0 + 0.6) * land + 0.008 * math.sin(ph + 1.0)
    ry = 0.03 * math.exp(-t * 1.3) * math.sin(t * 5.2 + 1.7) * land + 0.007 * math.sin(ph + 2.4)
    rz = math.radians(LEAF_TURN) + math.radians(5) * (1 - math.exp(-t * 1.2)) * land + math.radians(5) * (1 - land) + math.radians(1.2) * math.sin(ph)
    leaf.location = (0, 0, z)
    leaf.rotation_euler = (rx, ry, rz)


lm = bpy.data.materials.new("leaf")
lm.use_nodes = True
nl = lm.node_tree
pl = nl.nodes["Principled BSDF"]
det = bpy.data.images.load(os.path.join(LEAF_DIR, "leaf-detail.webp"))
det.colorspace_settings.name = "Non-Color"
nor = bpy.data.images.load(os.path.join(LEAF_DIR, "leaf-normal.webp"))
nor.colorspace_settings.name = "Non-Color"
td = nl.nodes.new("ShaderNodeTexImage")
td.image = det
tn = nl.nodes.new("ShaderNodeTexImage")
tn.image = nor
sep = nl.nodes.new("ShaderNodeSeparateColor")
nl.links.new(td.outputs["Color"], sep.inputs["Color"])
# colour: a fresh, deep peepal green, lighter along the veins.
# (A Mix node has float, vector and colour sockets of the same names: 6/7 are the colour A/B, output 2 the colour.)
leaf_c = nl.nodes.new("ShaderNodeMix")
leaf_c.data_type = "RGBA"
leaf_c.blend_type = "MULTIPLY"
leaf_c.inputs[0].default_value = 1.0
leaf_c.inputs[6].default_value = (0.03, 0.1, 0.018, 1)
nl.links.new(sep.outputs["Red"], leaf_c.inputs[7])
vein_c = nl.nodes.new("ShaderNodeMix")
vein_c.data_type = "RGBA"
vein_c.inputs[7].default_value = (0.14, 0.24, 0.06, 1)
nl.links.new(leaf_c.outputs[2], vein_c.inputs[6])
vf = node(nl, "ShaderNodeMath", Value_001=0.55)
vf.operation = "MULTIPLY"
nl.links.new(sep.outputs["Green"], vf.inputs[0])
nl.links.new(vf.outputs["Value"], vein_c.inputs[0])
nl.links.new(vein_c.outputs[2], pl.inputs["Base Color"])
nm = nl.nodes.new("ShaderNodeNormalMap")
nl.links.new(tn.outputs["Color"], nm.inputs["Color"])
nm.inputs["Strength"].default_value = 1.2
nl.links.new(nm.outputs["Normal"], pl.inputs["Normal"])
nl.links.new(td.outputs["Alpha"], pl.inputs["Alpha"])
# glossy and wet: sharp reflections from a clear film, not a broad milky sheen
pl.inputs["Roughness"].default_value = 0.32
pl.inputs["Specular IOR Level"].default_value = 0.35
pl.inputs["Coat Weight"].default_value = 0.55
pl.inputs["Coat Roughness"].default_value = 0.035
pl.inputs["Transmission Weight"].default_value = 0.06
leaf.data.materials.append(lm)

# ---------------------------------------------------------------- world: forest light, a soft sun through the canopy
world = bpy.data.worlds.new("forest")
scene.world = world
world.use_nodes = True
wn = world.node_tree
env = wn.nodes.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(os.path.abspath(HDRI))
mapping = wn.nodes.new("ShaderNodeMapping")
mapping.inputs["Rotation"].default_value = (0, 0, math.radians(SKY_TURN))
tc = wn.nodes.new("ShaderNodeTexCoord")
wn.links.new(tc.outputs["Generated"], mapping.inputs["Vector"])
wn.links.new(mapping.outputs["Vector"], env.inputs["Vector"])
bg = wn.nodes["Background"]
bg.inputs["Strength"].default_value = float(os.environ.get("POND_SKY_K", 0.55))  # dim: the reflections read, the edges fall dark
# light under a canopy: a touch green, so the water sits in the finale's green section
tint = wn.nodes.new("ShaderNodeMix")
tint.data_type = "RGBA"
tint.blend_type = "MULTIPLY"
tint.inputs[0].default_value = 1.0
tint.inputs[7].default_value = (0.78, 1.0, 0.84, 1)
wn.links.new(env.outputs["Color"], tint.inputs[6])
wn.links.new(tint.outputs[2], bg.inputs["Color"])

sun = bpy.data.lights.new("sun", "SUN")
sun.energy = 1.1
sun.angle = math.radians(3)
sun.color = (1.0, 0.94, 0.84)
so = bpy.data.objects.new("sun", sun)
so.rotation_euler = (math.radians(38), 0, math.radians(150))
scene.collection.objects.link(so)

# ---------------------------------------------------------------- camera: from above at the finale's angle, the leaf in focus
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 85
cam_data.dof.use_dof = True
cam_data.dof.aperture_fstop = 1.4
cam = bpy.data.objects.new("cam", cam_data)
elev = math.radians(38)
dist = 9.0
cam.location = (0, -dist * math.cos(elev), dist * math.sin(elev))
direction = Vector((0, 0, 0)) - cam.location
cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
cam_data.dof.focus_distance = direction.length
scene.collection.objects.link(cam)
scene.camera = cam

# ---------------------------------------------------------------- render
scene.render.engine = "CYCLES"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 12
scene.cycles.transmission_bounces = 12
scene.cycles.volume_bounces = 1
scene.cycles.seed = 7  # the same noise every frame, so the denoised result doesn't shimmer
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for dv in prefs.devices:
        dv.use = True
    scene.cycles.device = "GPU"
except Exception:
    pass
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.resolution_x = 1600
scene.render.resolution_y = 800  # the finale's stage is wide; phones crop the middle
scene.render.image_settings.file_format = "PNG"
scene.render.fps = FPS


def render(t, path):
    set_surface(t)
    set_leaf(t)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


if MODE == "empty":
    leaf.hide_render = True
    CALM = True
    render(0.0, OUT)
    print(f"[pond] wrote {OUT}")
elif MODE == "still":
    render(float(args[3]) if len(args) > 3 else 1.6, OUT)
    print(f"[pond] wrote {OUT}")
else:
    os.makedirs(OUT, exist_ok=True)
    last_frame = int((LAND_S + LOOP_S) * FPS) - 1
    first = int(args[3]) if len(args) > 3 else 0
    last = int(args[4]) if len(args) > 4 else last_frame
    for f in range(first, last + 1):
        path = os.path.join(OUT, f"{f:04d}.png")
        if os.path.exists(path):
            continue  # resumable
        render(f / FPS, path)
        print(f"[pond] frame {f}/{last_frame}", flush=True)
