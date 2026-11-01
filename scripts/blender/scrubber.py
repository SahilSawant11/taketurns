"""
The FRP fume scrubber for the hero's plant scene, built in Blender.

Run headless from the repo root:

    blender -b -P scripts/blender/scrubber.py -- public/models/scrubber.glb

Builds the tower (plinth, sump, flanged body, top cone and the seat flange
the wound stack section lands on), a manway, the gas inlet and spray-header
nozzles, a braced platform with railings, a caged ladder and the
recirculation pump skid. Parts are bevelled, joined by material, given
lightmap UVs, and ambient occlusion is baked with Cycles into one texture
per material, exported as the glTF occlusion map (three.js aoMap).

Dimensions match src/scripts/three/plant.ts (SEAT_Y = 12.3, tower radius
2.1, stack flange radius 1.42). Plant coordinates are three.js (y up); in
Blender that's (x, -z, y), and the glTF exporter converts back.
"""
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "scrubber.glb"
AO_SAMPLES = 96

R = 2.1  # tower body radius
SEAT_Y = 12.3
STACK_R = 1.0
STACK_FLANGE = 1.42
LADDER_A = 0.9  # three.js angle (x = cos, z = sin) of the ladder
INLET_A = math.atan2(1.5, 5.6)  # the duct comes in along this bearing
SPRAY_A = math.pi - math.atan2(1.0, 1.8)
MANWAY_A = 0.25


def srgb(h):
    """Hex sRGB → linear RGBA for Blender."""
    c = [int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return [((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c] + [1.0]


def bearing(a, r):
    """Point at three.js bearing a, radius r, in Blender XY."""
    return Vector((math.cos(a) * r, -math.sin(a) * r))


# ---------------------------------------------------------------- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

MATS = {}


def material(name, color, rough, metal=0.0, coat=0.0, coat_rough=0.1):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = srgb(color)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if coat:
        p.inputs["Coat Weight"].default_value = coat
        p.inputs["Coat Roughness"].default_value = coat_rough
    MATS[name] = m
    return m


material("frp", "#1d7a4c", 0.34, coat=0.8, coat_rough=0.12)
material("frp_pale", "#d9ddd2", 0.4, coat=0.5, coat_rough=0.2)
material("galv", "#a7adb2", 0.4, metal=0.8)
material("yellow", "#d9a722", 0.55, metal=0.2)
material("concrete", "#bdb9ae", 0.9)
material("steel", "#7d8287", 0.6, metal=0.4)
material("pump", "#2a4f7a", 0.45, metal=0.3)

PARTS = {k: [] for k in MATS}


def finish(obj, mat, bevel=0.0, segments=2, smooth=True):
    obj.data.materials.clear()
    obj.data.materials.append(MATS[mat])
    if bevel:
        b = obj.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = segments
        b.limit_method = "ANGLE"
        b.angle_limit = math.radians(35)
        b.harden_normals = False
    if smooth:
        for poly in obj.data.polygons:
            poly.use_smooth = True
        obj.data.set_sharp_from_angle(angle=math.radians(40))
    PARTS[mat].append(obj)
    return obj


def cyl(r, h, z0, mat, verts=64, bevel=0.02, loc=(0, 0), r2=None, rot=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=(loc[0], loc[1], z0 + h / 2))
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=h, location=(loc[0], loc[1], z0 + h / 2))
    o = bpy.context.object
    if rot:
        o.rotation_euler = rot
    return finish(o, mat, bevel)


def ring(r_in, r_out, t, z, mat, verts=72, bevel=0.012, loc=(0, 0, None), rot=None):
    """Flat annulus of thickness t centred at height z (or at loc if given), axis Z unless rotated."""
    bm = bmesh.new()
    outer = bmesh.ops.create_circle(bm, cap_ends=False, radius=r_out, segments=verts)["verts"]
    inner = bmesh.ops.create_circle(bm, cap_ends=False, radius=r_in, segments=verts)["verts"]
    # bridge the two circles into a face ring, then extrude for thickness
    edges_o = [e for e in bm.edges if all(v in outer for v in e.verts)]
    edges_i = [e for e in bm.edges if all(v in inner for v in e.verts)]
    bmesh.ops.bridge_loops(bm, edges=edges_o + edges_i)
    for v in bm.verts:
        v.co.z -= t / 2
    faces = list(bm.faces)
    ext = bmesh.ops.extrude_face_region(bm, geom=faces)
    for v in [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]:
        v.co.z += t
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("ring")
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("ring", me)
    scene.collection.objects.link(o)
    o.location = (loc[0], loc[1], z if loc[2] is None else loc[2])
    if rot:
        o.rotation_euler = rot
    return finish(o, mat, bevel)


def hexes(points, size, h, mat, axis=None):
    """Hex nuts/bolt heads at each point (Blender coords), all in one mesh. axis: rotation matrix for each."""
    bm = bmesh.new()
    rot = axis or Matrix.Identity(4)
    for p in points:
        bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=size, radius2=size, depth=h, matrix=Matrix.Translation(p) @ rot)
    me = bpy.data.meshes.new("hex")
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("hex", me)
    scene.collection.objects.link(o)
    return finish(o, mat, 0, smooth=False)


def bolt_circle(r, n, z, t, size=0.035):
    pts = []
    for i in range(n):
        a = (i + 0.5) / n * math.tau
        pts.append(Vector((math.cos(a) * r, math.sin(a) * r, z + t / 2 + 0.015)))  # nuts on top; underneath is never seen
    hexes(pts, size, 0.03, "galv")


def bar(a, b, r, mat, verts=10, bevel=0.0):
    """Cylinder from point a to point b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=d.length, location=(a + b) / 2)
    o = bpy.context.object
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return finish(o, mat, bevel)


def box(size, loc, mat, bevel=0.015, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, mat, bevel, smooth=False)


def nozzle(a, z, r_neck, r_from, r_to, flange_r, mat="frp", bolts=12, cover=True):
    """Radial flanged nozzle on the shell at bearing a, height z, from radius r_from out to r_to."""
    rot = (0, math.pi / 2, -a)  # cylinder axis Z → radial direction
    mid = bearing(a, (r_from + r_to) / 2)
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=r_neck, depth=r_to - r_from, location=(mid.x, mid.y, z))
    o = bpy.context.object
    o.rotation_euler = rot
    finish(o, mat, 0.01)
    # reinforcing pad where it meets the shell
    pad = bearing(a, r_from + 0.03)
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=r_neck * 1.45, depth=0.08, location=(pad.x, pad.y, z))
    o = bpy.context.object
    o.rotation_euler = rot
    finish(o, mat, 0.02)
    f = bearing(a, r_to - 0.05)
    ring(r_neck - 0.02, flange_r, 0.1, 0, mat, verts=48, loc=(f.x, f.y, z), rot=rot)
    if cover:
        c = bearing(a, r_to + 0.02)
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=flange_r, depth=0.06, location=(c.x, c.y, z))
        o = bpy.context.object
        o.rotation_euler = rot
        finish(o, mat, 0.012)
    # bolts round the flange face
    m = Matrix.Rotation(-a, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "Y")
    br = (r_neck + flange_r) / 2 + 0.02
    pts = []
    for i in range(bolts):
        t = (i + 0.5) / bolts * math.tau
        local = Vector((math.cos(t) * br, math.sin(t) * br, 0))
        for off in (r_to - 0.12, r_to + (0.06 if cover else 0.0)):
            p = m @ local
            pts.append(Vector((p.x, p.y, p.z + z)) + bearing(a, off).to_3d())
    hexes(pts, 0.028, 0.03, "galv", axis=m)


# ---------------------------------------------------------------- tower
cyl(3.3, 0.4, 0.0, "concrete", verts=8, bevel=0.04, r2=3.2)  # octagonal plinth
cyl(2.35, 1.6, 0.4, "frp", bevel=0.06)  # sump
ring(2.3, 2.5, 0.12, 0.47, "frp")  # sump base flange
cyl(R, 9.4, 2.0, "frp", bevel=0.0)  # body
for z in (2.0, 5.1, 8.2, 11.4):
    ring(R - 0.05, R + 0.22, 0.16, z, "frp")
    bolt_circle(R + 0.12, 28, z, 0.16)
cyl(R, 0.9, 11.4, "frp", r2=STACK_R * 1.02, bevel=0.0)  # top head
ring(STACK_R - 0.04, STACK_FLANGE, 0.14, SEAT_Y - 0.07, "frp")  # the seat
# a stiffening band on each body course
for z in (3.55, 6.65, 9.8):
    ring(R - 0.01, R + 0.06, 0.24, z, "frp", bevel=0.02)

# ---------------------------------------------------------------- nozzles
nozzle(INLET_A, 2.6, 0.76, R - 0.1, 2.9, 0.95, cover=False, bolts=20)  # gas inlet (the duct bolts on)
nozzle(SPRAY_A, 8.6, 0.16, R - 0.1, 2.5, 0.3, cover=False, bolts=8)  # spray header feed
nozzle(MANWAY_A, 3.15, 0.36, R - 0.1, 2.55, 0.5, bolts=16)  # manway, with cover
nozzle(MANWAY_A + 0.5, 1.2, 0.09, 2.3, 2.62, 0.18, bolts=4)  # sump drain
nozzle(-0.5, 6.0, 0.07, R - 0.1, 2.35, 0.15, bolts=4)  # instrument tapping
# manway davit: a bent arm from a bracket on the shell over the cover
mw = lambda r, dz: bearing(MANWAY_A + 0.16, r).to_3d() + Vector((0, 0, 3.15 + dz))
bar(mw(R + 0.05, 0.75), mw(2.7, 0.75), 0.03, "galv")
bar(mw(2.7, 0.75), mw(2.7, 0.0), 0.03, "galv")
box((0.14, 0.14, 0.18), mw(R + 0.1, 0.75), "steel")
# level gauge on the sump
g = bearing(-0.35, 2.52)
bar((g.x, g.y, 0.75), (g.x, g.y, 1.9), 0.035, "frp_pale")
for z in (0.75, 1.9):
    bar(bearing(-0.35, 2.33).to_3d() + Vector((0, 0, z)), (g.x, g.y, z), 0.025, "frp_pale")

# ---------------------------------------------------------------- platform
DECK_Z = 11.0
ring(R + 0.02, R + 1.1, 0.06, DECK_Z, "galv", verts=96, bevel=0.006)
ring(R + 1.06, R + 1.1, 0.14, DECK_Z + 0.08, "yellow", verts=96, bevel=0.004)  # toe board
for zr, rr in ((DECK_Z + 1.1, 0.035), (DECK_Z + 0.55, 0.025)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R + 1.05, minor_radius=rr, major_segments=128, minor_segments=10, location=(0, 0, zr))
    finish(bpy.context.object, "yellow")
for i in range(28):
    a = i / 28 * math.tau
    p = bearing(a, R + 1.05)
    bar((p.x, p.y, DECK_Z), (p.x, p.y, DECK_Z + 1.1), 0.028, "yellow", verts=8)
# knee braces under the deck back to the shell
for i in range(8):
    a = (i + 0.5) / 8 * math.tau
    o = bearing(a, R + 1.0)
    s = bearing(a, R + 0.02)
    bar((s.x, s.y, DECK_Z - 1.1), (o.x, o.y, DECK_Z - 0.04), 0.045, "galv", verts=8)
    bar((s.x, s.y, DECK_Z - 0.04), (o.x, o.y, DECK_Z - 0.04), 0.04, "galv", verts=8)
    box((0.22, 0.22, 0.3), (s.x, s.y, DECK_Z - 1.1), "galv")

# ---------------------------------------------------------------- caged ladder
la = LADDER_A
centre = bearing(la, R + 0.48)
tang = Vector((math.sin(la), math.cos(la)))  # tangent in Blender XY (perpendicular to the bearing)
out = bearing(la, 1.0).normalized()
top = DECK_Z + 1.1
for s in (-0.22, 0.22):
    p = centre + tang * s
    bar((p.x, p.y, 0.4), (p.x, p.y, top), 0.028, "galv", verts=8)
    # stand-off brackets to the shell
    for z in (2.4, 6.0, 9.6):
        q = bearing(la, R + 0.03) + tang * s
        bar((q.x, q.y, z), (p.x, p.y, z), 0.02, "galv", verts=6)
z = 0.7
while z < top - 0.1:
    a, b = centre - tang * 0.22, centre + tang * 0.22
    bar((a.x, a.y, z), (b.x, b.y, z), 0.016, "galv", verts=6)
    z += 0.3
# cage: hoops and vertical straps from 2.4 m up
hc = centre + out * 0.36
z = 2.4
while z < top:
    bpy.ops.mesh.primitive_torus_add(major_radius=0.38, minor_radius=0.016, major_segments=24, minor_segments=6, location=(hc.x, hc.y, z))
    o = bpy.context.object
    # keep only the outer ~240° (the side against the shell is open)
    finish(o, "galv", smooth=False)
    z += 0.75
for t in (-1.0, -0.5, 0.0, 0.5, 1.0):
    ang = math.atan2(out.y, out.x) + t * 1.2
    p = hc + Vector((math.cos(ang), math.sin(ang))) * 0.38
    bar((p.x, p.y, 2.4), (p.x, p.y, top), 0.016, "galv", verts=6)

# ---------------------------------------------------------------- recirculation pump skid
skid = Vector((-3.4, -1.2))  # three.js (-3.4, 1.2)
box((1.8, 1.0, 0.16), (skid.x - 0.3, skid.y, 0.08), "steel")
cyl(0.24, 0.62, 0, "pump", verts=32, bevel=0.02, loc=(skid.x - 0.6, skid.y), rot=(0, math.pi / 2, 0))
bpy.context.object.location = (skid.x - 0.7, skid.y, 0.5)
cyl(0.3, 0.26, 0, "pump", verts=32, bevel=0.03, loc=(skid.x, skid.y), rot=(math.pi / 2, 0, 0))
bpy.context.object.location = (skid.x, skid.y, 0.55)
box((0.5, 0.36, 0.3), (skid.x - 0.25, skid.y, 0.3), "steel")
# suction from the sump, discharge up to the spray header (the riser is in plant.ts)
bar((skid.x, skid.y + 0.25, 0.55), (-2.05, -1.0, 0.95), 0.12, "frp_pale", verts=16)

# ---------------------------------------------------------------- join, unwrap, bake AO
for o in list(scene.objects):
    o.select_set(False)
joined = {}
for mat, objs in PARTS.items():
    objs = [o for o in objs if o.name in scene.objects]
    if not objs:
        continue
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.convert(target="MESH")  # applies the bevels
    bpy.ops.object.join()
    j = bpy.context.object
    j.name = f"scrubber_{mat}"
    j.select_set(False)
    joined[mat] = j

world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (1, 1, 1, 1)
world.light_settings.distance = 1.2

scene.render.engine = "CYCLES"
scene.cycles.samples = AO_SAMPLES
scene.cycles.use_denoising = False
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = "GPU"
except Exception:
    pass

# a ground plane so the AO darkens where things meet the ground (not exported)
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
ground = bpy.context.object
ground.name = "bake_ground"

def gltf_output_group():
    """The node group the glTF exporter reads the occlusion map from."""
    g = bpy.data.node_groups.get("glTF Material Output")
    if g:
        return g
    g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    g.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    return g

for mat, j in joined.items():
    me = j.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name="UVMap")
    for o in scene.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = j
    j.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004)
    bpy.ops.uv.pack_islands(margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    size = 1024 if mat == "frp" else 512  # AO is soft: low resolution is plenty
    img = bpy.data.images.new(f"ao_{mat}", size, size, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    m = MATS[mat]
    nodes = m.node_tree.nodes
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    nodes.active = tex
    bpy.ops.object.bake(type="AO", margin=6)
    img.filepath_raw = f"//ao_{mat}.png"
    img.file_format = "PNG"
    # wire it to the exporter's occlusion input
    sep = nodes.new("ShaderNodeSeparateColor")
    m.node_tree.links.new(tex.outputs["Color"], sep.inputs["Color"])
    grp = nodes.new("ShaderNodeGroup")
    grp.node_tree = gltf_output_group()
    m.node_tree.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])
    j.select_set(False)
    print(f"[scrubber] baked AO for {mat} ({size}px)")

bpy.data.objects.remove(ground)
for o in scene.objects:
    o.select_set(o.name.startswith("scrubber_"))

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_apply=True,
    export_image_format="JPEG",
    export_jpeg_quality=78,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
)
print(f"[scrubber] wrote {OUT}")
