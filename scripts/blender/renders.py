"""
Product illustrations for the site (public/renders/*.jpg), rendered in Cycles
in one studio look: a dark seamless backdrop, a big soft key from the left,
a rim from behind right, and a little fill.

Run headless from the repo root, naming the shots to render (or none for all):

    blender -b -P scripts/blender/renders.py -- public/renders frp-tank

Each image is 1600x1200 and framed with room round the equipment, so the
pages' crops (3:2, 16:10, 4:3, 5:4; object-fit: cover) never cut into it.
These are labelled 3D illustrations on the site, not project photos.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.append(os.path.dirname(__file__))
from kit import hexc, srgb_to_lin  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = args[0] if args else "public/renders"
WANT = set(args[1:])
SAMPLES = int(os.environ.get("RENDER_SAMPLES", "160"))


# ---------------------------------------------------------------- materials
def mat(name, base, rough=0.4, metal=0.0, coat=0.0, coat_rough=0.12, bump=None):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*srgb_to_lin(hexc(base)), 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if coat:
        p.inputs["Coat Weight"].default_value = coat
        p.inputs["Coat Roughness"].default_value = coat_rough
    if bump:
        bump(nt, p)
    return m


def frp_gelcoat():
    """Gel-coated filament-wound FRP: hoop bands just visible in the surface, a faint crossing helix."""

    def bump(nt, p):
        tc = nt.nodes.new("ShaderNodeTexCoord")
        hoop = nt.nodes.new("ShaderNodeTexWave")
        hoop.wave_type = "BANDS"
        hoop.bands_direction = "Z"
        hoop.inputs["Scale"].default_value = 9.0
        hoop.inputs["Distortion"].default_value = 0.6
        hoop.inputs["Detail"].default_value = 1.0
        nt.links.new(tc.outputs["Object"], hoop.inputs["Vector"])
        helix = nt.nodes.new("ShaderNodeTexWave")
        helix.wave_type = "RINGS"  # rings round a tilted axis read as a shallow helix on a cylinder
        helix.inputs["Scale"].default_value = 3.0
        helix.inputs["Distortion"].default_value = 0.4
        nt.links.new(tc.outputs["Object"], helix.inputs["Vector"])
        mix = nt.nodes.new("ShaderNodeMath")
        mix.operation = "MULTIPLY_ADD"
        mix.inputs[1].default_value = 0.35
        nt.links.new(helix.outputs["Fac"], mix.inputs[0])
        nt.links.new(hoop.outputs["Fac"], mix.inputs[2])
        b = nt.nodes.new("ShaderNodeBump")
        b.inputs["Strength"].default_value = 0.05
        b.inputs["Distance"].default_value = 0.002
        nt.links.new(mix.outputs["Value"], b.inputs["Height"])
        nt.links.new(b.outputs["Normal"], p.inputs["Normal"])
        # and the same bands as the faintest shift in colour
        ramp = nt.nodes.new("ShaderNodeMapRange")
        ramp.inputs["To Min"].default_value = 0.92
        ramp.inputs["To Max"].default_value = 1.04
        nt.links.new(hoop.outputs["Fac"], ramp.inputs["Value"])
        tint = nt.nodes.new("ShaderNodeMix")
        tint.data_type = "RGBA"
        tint.blend_type = "MULTIPLY"
        tint.inputs["Factor"].default_value = 1.0
        tint.inputs["A"].default_value = p.inputs["Base Color"].default_value
        nt.links.new(ramp.outputs["Result"], tint.inputs["B"])
        nt.links.new(tint.outputs["Result"], p.inputs["Base Color"])

    return mat("frp_gelcoat", "#2b6a4a", rough=0.38, coat=0.3, bump=bump)


def concrete():
    def bump(nt, p):
        n = nt.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = 40
        b = nt.nodes.new("ShaderNodeBump")
        b.inputs["Strength"].default_value = 0.15
        nt.links.new(n.outputs["Fac"], b.inputs["Height"])
        nt.links.new(b.outputs["Normal"], p.inputs["Normal"])

    return mat("concrete", "#5d5b57", rough=0.85, bump=bump)


# ---------------------------------------------------------------- geometry helpers
def link(ob, m=None, smooth=True, bevel=0.0):
    if ob.name not in bpy.context.scene.collection.objects and not ob.users_collection:
        bpy.context.scene.collection.objects.link(ob)
    if m:
        ob.data.materials.clear()
        ob.data.materials.append(m)
    if smooth and hasattr(ob.data, "polygons"):
        for p in ob.data.polygons:
            p.use_smooth = True
        ob.data.shade_smooth() if hasattr(ob.data, "shade_smooth") else None
    if bevel:
        bv = ob.modifiers.new("bevel", "BEVEL")
        bv.width = bevel
        bv.segments = 2
        bv.limit_method = "ANGLE"
        wn = ob.modifiers.new("wn", "WEIGHTED_NORMAL")
        wn.keep_sharp = True
    return ob


def lathe(name, profile, m, segs=96, bevel=0.0):
    """Spin an (r, z) profile round the z axis."""
    me = bpy.data.meshes.new(name)
    verts, faces = [], []
    n = len(profile)
    for i in range(segs):
        a = i / segs * math.tau
        for r, z in profile:
            verts.append((r * math.cos(a), r * math.sin(a), z))
    for i in range(segs):
        j = (i + 1) % segs
        for k in range(n - 1):
            faces.append((i * n + k, j * n + k, j * n + k + 1, i * n + k + 1))
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    return link(ob, m, bevel=bevel)


def cyl(name, r, depth, m, at=(0, 0, 0), dirn=(0, 0, 1), segs=48, bevel=0.0):
    """A capped cylinder from `at` along `dirn`."""
    d = Vector(dirn).normalized()
    centre = Vector(at) + d * depth / 2
    bpy.ops.mesh.primitive_cylinder_add(vertices=segs, radius=r, depth=depth, location=centre)
    ob = bpy.context.active_object
    ob.name = name
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)
    return link(ob, m, bevel=bevel)


def box(name, size, at, m, rot_z=0.0, bevel=0.004):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    ob.rotation_euler.z = rot_z
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return link(ob, m, smooth=False, bevel=bevel)


def tube(name, pts, r, m, closed=False):
    """A pipe or bar along a path (a bevelled curve), e.g. a gooseneck or a ladder rail."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r
    cu.bevel_resolution = 4
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, c in zip(sp.points, pts):
        p.co = (*c, 1)
    sp.use_cyclic_u = closed
    ob = bpy.data.objects.new(name, cu)
    return link(ob, m, smooth=False)


def arc(c, r, a0, a1, n, axis_u, axis_v):
    c, u, v = Vector(c), Vector(axis_u), Vector(axis_v)
    return [tuple(c + (u * math.cos(a0 + (a1 - a0) * i / n) + v * math.sin(a0 + (a1 - a0) * i / n)) * r) for i in range(n + 1)]


def flange(name, at, dirn, r_pipe, m, bolt_m, n_bolts=8, blind=False, neck=0.0):
    """A flanged nozzle: neck out along dirn, a flange with its ring of bolts, open bore or a blind cover."""
    d = Vector(dirn).normalized()
    at = Vector(at)
    rf = r_pipe * 1.75 + 0.03
    t = 0.022 + r_pipe * 0.08
    if neck:
        cyl(name + "_neck", r_pipe, neck, m, at, d, bevel=0.003)
    f0 = at + d * neck
    cyl(name + "_flange", rf, t, m, f0, d, segs=64, bevel=0.004)
    cyl(name + "_mate", rf, t, m if blind else m, f0 + d * t, d, segs=64, bevel=0.004)
    if not blind:
        cyl(name + "_bore", r_pipe * 0.86, 0.003, mat("bore", "#0c1a12", rough=0.8), f0 + d * (2 * t + 0.0005), d)
    # bolts through both flanges, nuts proud on the outer face
    side = d.cross(Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))).normalized()
    up = d.cross(side)
    rb = (rf + r_pipe) / 2 + 0.006
    for i in range(n_bolts):
        a = (i + 0.5) / n_bolts * math.tau
        p = f0 + (side * math.cos(a) + up * math.sin(a)) * rb
        cyl(f"{name}_nut{i}", 0.011 + r_pipe * 0.025, 0.014, bolt_m, p + d * (2 * t), d, segs=6, bevel=0.0015)
        cyl(f"{name}_stud{i}", 0.006 + r_pipe * 0.012, 0.03, bolt_m, p + d * (2 * t), d, segs=10)
    return f0 + d * (2 * t)


# ---------------------------------------------------------------- the studio
def studio(target, cam_from, lens=58, key=420, rim=800, fill=60, floor="#101211", frame=None):
    sc = bpy.context.scene
    world = bpy.data.worlds.new("studio")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (*srgb_to_lin(hexc("#0d0e0e")), 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35
    sc.world = world
    # seamless backdrop: floor sweeping up into a wall far behind, so there's no horizon line
    prof = [(-14, 0), (6, 0)] + [(6 + 4 * math.sin(a), 4 - 4 * math.cos(a)) for a in [i / 12 * math.pi / 2 for i in range(1, 13)]] + [(10, 14)]
    me = bpy.data.meshes.new("cyc")
    verts = [(x, y, z) for (y, z) in prof for x in (-20, 20)]
    faces = [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(len(prof) - 1)]
    me.from_pydata(verts, [], faces)
    cyc = bpy.data.objects.new("cyc", me)
    link(cyc, mat("floor", floor, rough=0.72))
    # behind the subject from the camera's side: turn the sweep to face it
    t = Vector(target)
    aim = (t - Vector(cam_from)).normalized()
    cyc.rotation_euler.z = math.atan2(aim.y, aim.x) - math.pi / 2

    def area(name, loc, size, power, colour="#ffffff", shape="RECTANGLE", size_y=None, spread=180):
        L = bpy.data.lights.new(name, "AREA")
        L.energy = power
        L.spread = math.radians(spread)  # narrower: the light lands on the subject, not in a pool on the floor
        L.shape = shape
        L.size = size
        L.size_y = size_y or size
        L.color = srgb_to_lin(hexc(colour))
        o = bpy.data.objects.new(name, L)
        o.location = loc
        sc.collection.objects.link(o)
        c = o.constraints.new("TRACK_TO")
        e = bpy.data.objects.new(name + "_aim", None)
        e.location = target
        sc.collection.objects.link(e)
        c.target = e
        return o

    # key: big softbox high on the camera's left; rim: strip behind right; fill: low, front right
    side = Vector(cam_from) - t
    side.z = 0
    side.normalize()
    left = Vector((-side.y, side.x, 0))
    area("key", t + side * 3 + left * 5 + Vector((0, 0, 7)), 4.5, key, "#fff6ea", size_y=3, spread=55)
    area("rim", t - side * 5 - left * 3.5 + Vector((0, 0, 3.5)), 1.2, rim, "#eef4ff", shape="RECTANGLE", size_y=6)
    area("fill", t + side * 6 - left * 4 + Vector((0, 0, 0.5)), 5, fill, "#e9f0ee")

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = lens
    cam.location = cam_from
    sc.collection.objects.link(cam)
    e = bpy.data.objects.new("cam_aim", None)
    e.location = frame or target  # where the camera points (the lights aim at the subject)
    sc.collection.objects.link(e)
    c = cam.constraints.new("TRACK_TO")
    c.target = e
    sc.camera = cam

    sc.render.engine = "CYCLES"
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.device = "CPU"
    if os.environ.get("RENDER_GPU"):  # e.g. RENDER_GPU=METAL on a Mac
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = os.environ["RENDER_GPU"]
        prefs.get_devices()
        for dev in prefs.devices:
            dev.use = True
        sc.cycles.device = "GPU"
    sc.render.resolution_x, sc.render.resolution_y = 1600, 1200
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 88
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    sc.view_settings.exposure = 0.0


# ---------------------------------------------------------------- shots
def frp_tank():
    """FRP / GRP chemical storage tank on a plinth: dished top, flat bottom, the usual nozzles and fittings."""
    gel = frp_gelcoat()
    steel = mat("galv", "#9aa0a3", rough=0.38, metal=1.0)
    bolt = mat("bolt", "#b9bcbd", rough=0.3, metal=1.0)
    R, Z0, H = 1.2, 0.3, 3.3  # radius, top of plinth, straight shell
    ZT = Z0 + H

    lathe("plinth", [(0, 0), (1.5, 0), (1.5, 0.27), (1.47, 0.3), (0, 0.3)], concrete(), segs=96, bevel=0.0)
    # shell: a small knuckle into the flat bottom, straight wall, then a dished (2.5:1 ellipsoidal) top
    prof = [(0, Z0), (R - 0.07, Z0)] + [(R - 0.07 + 0.07 * math.sin(a), Z0 + 0.07 - 0.07 * math.cos(a)) for a in [i / 6 * math.pi / 2 for i in range(1, 7)]]
    prof += [(R, ZT)]
    HD = R / 2.5
    prof += [(R * math.cos(a), ZT + HD * math.sin(a)) for a in [i / 24 * math.pi / 2 for i in range(1, 25)]]
    lathe("shell", prof, gel, segs=128)
    # a slightly proud joint band where the top head is laminated on
    lathe("joint", [(R + 0.0, ZT - 0.06), (R + 0.012, ZT - 0.05), (R + 0.012, ZT + 0.03), (R + 0.0, ZT + 0.04)], gel, segs=128)

    def on_head(rr):
        """Point on the top head at radius rr (along +x before rotating), and its height."""
        return ZT + HD * math.sqrt(max(0, 1 - (rr / R) ** 2))

    def at_angle(rr, deg, z):
        a = math.radians(deg)
        return Vector((rr * math.cos(a), rr * math.sin(a), z))

    # top: a bolted manway with handles, a gooseneck vent, a flanged inlet
    zm = on_head(0.45)
    top = flange("manway", at_angle(0.45, 200, zm - 0.02), (0, 0, 1), 0.25, gel, bolt, n_bolts=16, blind=True, neck=0.14)
    tube("manway_handle", [tuple(top + Vector((-0.12, -0.05, 0))), tuple(top + Vector((-0.12, -0.05, 0.06))), tuple(top + Vector((0.12, -0.05, 0.06))), tuple(top + Vector((0.12, -0.05, 0)))], 0.009, steel)
    zv = on_head(0.15)
    v0 = at_angle(0.15, 20, zv - 0.02)
    cyl("vent_neck", 0.075, 0.42, gel, v0, (0, 0, 1))
    bend_c = v0 + Vector((0.16, 0, 0.42))
    tube("vent_bend", arc(bend_c, 0.16, math.pi, 0, 16, (1, 0, 0), (0, 0, 1)), 0.075, gel)
    cyl("vent_down", 0.075, 0.12, gel, bend_c + Vector((0.16, 0, 0)), (0, 0, -1))
    cyl("vent_screen", 0.078, 0.012, steel, bend_c + Vector((0.16, 0, -0.12)), (0, 0, -1))
    zi = on_head(0.78)
    flange("inlet", at_angle(0.78, 120, zi - 0.03), (0, 0, 1), 0.1, gel, bolt, n_bolts=8, neck=0.2)
    # lifting lugs round the top shoulder
    for i, deg in enumerate((60, 180, 300)):
        a = math.radians(deg)
        p = Vector((math.cos(a) * (R + 0.04), math.sin(a) * (R + 0.04), ZT + 0.05))
        box(f"lug{i}", (0.06, 0.03, 0.16), p, gel, rot_z=a + math.pi / 2)

    # side: a manway low down with its hinge, a bottom outlet with gussets, a level gauge
    def radial(deg, z, extra=0.0):
        a = math.radians(deg)
        return Vector((math.cos(a), math.sin(a), 0)), Vector((math.cos(a) * (R - 0.01 + extra), math.sin(a) * (R - 0.01 + extra), z))

    d, p = radial(-5, Z0 + 0.75)
    face = flange("side_manway", p, d, 0.3, gel, bolt, n_bolts=16, blind=True, neck=0.16)
    hinge_side = Vector((-d.y, d.x, 0))
    box("davit", (0.05, 0.05, 0.36), face + hinge_side * 0.55 - d * 0.06, steel)
    tube("davit_arm", [tuple(face + hinge_side * 0.55 - d * 0.06 + Vector((0, 0, 0.12))), tuple(face + hinge_side * 0.3 + d * 0.02 + Vector((0, 0, 0.12)))], 0.012, steel)
    d, p = radial(35, Z0 + 0.22)
    flange("outlet", p, d, 0.08, gel, bolt, n_bolts=8, neck=0.24)
    for s in (-1, 1):
        g = p + d * 0.08 + Vector((0, 0, -0.07 if s < 0 else 0.07))
        box(f"gusset{s}", (0.18, 0.012, 0.08), g, gel, rot_z=math.atan2(d.y, d.x))
    d, p = radial(5, 0)
    for z in (Z0 + 0.45, ZT - 0.25):
        cyl(f"lg_nozzle{z:.2f}", 0.025, 0.14, gel, p + Vector((0, 0, z)), d)
    lg = p + d * 0.14
    glass = mat("gauge_glass", "#2c3b35", rough=0.08, coat=0.6, coat_rough=0.03)
    cyl("level_gauge", 0.016, ZT - 0.25 - (Z0 + 0.45) + 0.05, glass, lg + Vector((0, 0, Z0 + 0.42)), (0, 0, 1), segs=24)

    # hold-down lugs at the base, bolted to the plinth
    for i in range(6):
        a = (i + 0.5) / 6 * math.tau
        rd = Vector((math.cos(a), math.sin(a), 0))
        tg = Vector((-rd.y, rd.x, 0))
        for s in (-1, 1):
            box(f"hd{i}{s}", (0.14, 0.014, 0.22), rd * (R + 0.07) + tg * 0.05 * s + Vector((0, 0, Z0 + 0.11)), gel, rot_z=a)
        box(f"hdbase{i}", (0.16, 0.14, 0.018), rd * (R + 0.08) + Vector((0, 0, Z0 + 0.009)), steel, rot_z=a)
        cyl(f"anchor{i}", 0.012, 0.05, bolt, rd * (R + 0.11) + Vector((0, 0, Z0 + 0.018)), (0, 0, 1), segs=6)

    # a caged ladder up to the top, galvanised
    a = math.radians(-128)  # on the left edge as seen: the cage reads in silhouette
    rd = Vector((math.cos(a), math.sin(a), 0))
    tg = Vector((-rd.y, rd.x, 0))
    off = R + 0.2
    z1 = ZT + 0.95
    for s in (-1, 1):
        base = rd * off + tg * 0.22 * s
        tube(f"rail{s}", [tuple(base + Vector((0, 0, Z0))), tuple(base + Vector((0, 0, z1)))], 0.022, steel)
        for z in (Z0 + 0.9, ZT - 0.4, ZT + 0.05):
            tube(f"standoff{s}{z:.1f}", [tuple(base + Vector((0, 0, z))), tuple(rd * (R + 0.01) + tg * 0.22 * s + Vector((0, 0, z)))], 0.014, steel)
    z = Z0 + 0.3
    while z < z1 - 0.1:
        tube(f"rung{z:.2f}", [tuple(rd * off - tg * 0.22 + Vector((0, 0, z))), tuple(rd * off + tg * 0.22 + Vector((0, 0, z)))], 0.014, steel)
        z += 0.3
    cage_c = rd * (off + 0.36)
    hoops = []
    z = Z0 + 2.2
    while z < z1:
        hoops.append(z)
        pts = [tuple(rd * off + tg * 0.22 + Vector((0, 0, z)))] + arc(cage_c + Vector((0, 0, z)), 0.36, -math.pi / 2 - 0.55, math.pi / 2 + 0.55, 18, tg, rd)[::-1] + [tuple(rd * off - tg * 0.22 + Vector((0, 0, z)))]
        tube(f"hoop{z:.2f}", pts, 0.012, steel)
        z += 0.6
    for k in range(5):
        ang = -math.pi / 2 - 0.3 + k / 4 * (math.pi + 0.6)
        q = cage_c + (tg * math.cos(ang) + rd * math.sin(ang)) * 0.36
        tube(f"strap{k}", [tuple(q + Vector((0, 0, hoops[0]))), tuple(q + Vector((0, 0, hoops[-1])))], 0.01, steel)
    # a short handrail at the top, round the manway side
    for s in (-1, 1):
        post = rd * off + tg * 0.22 * s
        tube(f"post{s}", [tuple(post + Vector((0, 0, z1))), tuple(post + Vector((0, 0, z1 + 0.15)))], 0.02, steel)

    # frame on the tank and its ladder together (the ladder stands off its left side)
    studio(target=(0, 0, 2.25), cam_from=(7.6, -10.2, 3.9), lens=50, frame=(-0.2, -0.1, 2.3))


SHOTS = {"frp-tank": frp_tank}

for name, build in SHOTS.items():
    if WANT and name not in WANT:
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build()
    sc = bpy.context.scene
    os.makedirs(OUT, exist_ok=True)
    sc.render.filepath = os.path.join(os.path.abspath(OUT), name + ".jpg")
    bpy.ops.render.render(write_still=True)
    print(f"[renders] {name} → {sc.render.filepath}")
