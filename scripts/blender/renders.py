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


def frp_gelcoat(axis="Z", colour="#2b6a4a"):
    """Gel-coated filament-wound FRP: hoop bands round `axis` just visible in the surface, a faint crossing helix."""

    def bump(nt, p):
        tc = nt.nodes.new("ShaderNodeTexCoord")
        hoop = nt.nodes.new("ShaderNodeTexWave")
        hoop.wave_type = "BANDS"
        hoop.bands_direction = axis
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

    return mat(f"frp_gelcoat_{axis}_{colour}", colour, rough=0.38, coat=0.3, bump=bump)


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
def studio(target, cam_from, lens=58, key=420, rim=800, fill=60, floor="#101211", frame=None, cards=0.0):
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

    if cards:
        # reflector cards for polished metal and gloss: large soft white panels the camera never
        # sees, so stainless and enamel reflect studio gradients instead of the black backdrop
        em = bpy.data.materials.new("card")
        em.use_nodes = True
        nt = em.node_tree
        nt.nodes.remove(nt.nodes["Principled BSDF"])
        e = nt.nodes.new("ShaderNodeEmission")
        e.inputs["Strength"].default_value = cards
        nt.links.new(e.outputs["Emission"], nt.nodes["Material Output"].inputs["Surface"])
        for k, (where, w, h) in enumerate(((left * 6 + side * 1.5, 3.0, 6.0), (-left * 6 + side * 0.5, 2.0, 6.0), (-side * 7 + left * 1.5, 7.0, 4.0))):
            bpy.ops.mesh.primitive_plane_add(size=1, location=t + where + Vector((0, 0, 1.0)))
            c = bpy.context.active_object
            c.name = f"card{k}"
            c.scale = (w, h, 1)
            c.data.materials.append(em)
            c.visible_camera = False
            c.visible_shadow = False
            tc = c.constraints.new("TRACK_TO")
            aim = bpy.data.objects.new(f"card{k}_aim", None)
            aim.location = target
            sc.collection.objects.link(aim)
            tc.target = aim
            tc.track_axis, tc.up_axis = "TRACK_Z", "UP_Y"

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


# ---------------------------------------------------------------- more helpers
def rot_to(ob, d):
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector(d).normalized())


def studs(name, points, r, m, segs=6):
    """Many small bolt heads as one mesh (a GLS tank has a thousand): (position, outward normal) pairs."""
    import bmesh
    from mathutils import Matrix

    bm = bmesh.new()
    for p, n in points:
        q = Vector((0, 0, 1)).rotation_difference(Vector(n))
        mt = Matrix.Translation(Vector(p) + Vector(n) * r * 0.4) @ q.to_matrix().to_4x4()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r * 0.75, depth=r * 0.9, matrix=mt)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me), m)


def handwheel(name, centre, normal, r, m):
    n = Vector(normal).normalized()
    u = n.cross(Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))).normalized()
    v = n.cross(u)
    tube(name + "_rim", arc(centre, r, 0, math.tau, 40, u, v), r * 0.09, m, closed=True)
    for k in range(3):
        a = k / 3 * math.tau
        tube(f"{name}_spoke{k}", [tuple(Vector(centre)), tuple(Vector(centre) + (u * math.cos(a) + v * math.sin(a)) * r)], r * 0.06, m)
    cyl(name + "_hub", r * 0.16, r * 0.25, m, Vector(centre) - n * r * 0.1, n)


def caged_ladder(prefix, angle_deg, R, z0, z1, steel, cage_from=2.2):
    a = math.radians(angle_deg)
    rd = Vector((math.cos(a), math.sin(a), 0))
    tg = Vector((-rd.y, rd.x, 0))
    off = R + 0.2
    for s in (-1, 1):
        base = rd * off + tg * 0.22 * s
        tube(f"{prefix}rail{s}", [tuple(base + Vector((0, 0, z0))), tuple(base + Vector((0, 0, z1)))], 0.022, steel)
        for z in (z0 + 0.6, (z0 + z1) / 2, z1 - 0.9):
            tube(f"{prefix}standoff{s}{z:.1f}", [tuple(base + Vector((0, 0, z))), tuple(rd * (R + 0.01) + tg * 0.22 * s + Vector((0, 0, z)))], 0.014, steel)
    z = z0 + 0.3
    while z < z1 - 0.1:
        tube(f"{prefix}rung{z:.2f}", [tuple(rd * off - tg * 0.22 + Vector((0, 0, z))), tuple(rd * off + tg * 0.22 + Vector((0, 0, z)))], 0.014, steel)
        z += 0.3
    cage_c = rd * (off + 0.36)
    hoops = []
    z = z0 + cage_from
    while z < z1:
        hoops.append(z)
        pts = [tuple(rd * off + tg * 0.22 + Vector((0, 0, z)))] + arc(cage_c + Vector((0, 0, z)), 0.36, -math.pi / 2 - 0.55, math.pi / 2 + 0.55, 18, tg, rd)[::-1] + [tuple(rd * off - tg * 0.22 + Vector((0, 0, z)))]
        tube(f"{prefix}hoop{z:.2f}", pts, 0.012, steel)
        z += 0.6
    if len(hoops) > 1:
        for k in range(5):
            ang = -math.pi / 2 - 0.3 + k / 4 * (math.pi + 0.6)
            q = cage_c + (tg * math.cos(ang) + rd * math.sin(ang)) * 0.36
            tube(f"{prefix}strap{k}", [tuple(q + Vector((0, 0, hoops[0]))), tuple(q + Vector((0, 0, hoops[-1])))], 0.01, steel)


def dished(R, z, h, up=True, n=24):
    """Profile points of a dished head from the shell (r=R) to the axis."""
    sgn = 1 if up else -1
    return [(R * math.cos(a), z + sgn * h * math.sin(a)) for a in [i / n * math.pi / 2 for i in range(1, n + 1)]]


# ---------------------------------------------------------------- FRP pipe spools (marine & brine)
def frp_pipe():
    gel_x = frp_gelcoat("X")
    gel_z = frp_gelcoat("Z")
    steel = mat("galv", "#9aa0a3", rough=0.38, metal=1.0)
    bolt = mat("bolt", "#b9bcbd", rough=0.3, metal=1.0)
    paint = mat("valve_body", "#2c3e57", rough=0.35, coat=0.4)
    r, zc = 0.28, 0.95  # pipe radius and centreline height
    x0, x1 = -3.3, 0.5  # run, then a long-radius elbow up
    er = 0.6
    # straight run in two spools with a flanged joint between, and the elbow + riser
    for name, a, b in (("run_a", x0 + 0.06, -1.3), ("run_b", -1.3 + 0.1, x1 - er)):
        cyl(name, r, b - a, gel_x, (a, 0, zc), (1, 0, 0), segs=64)
    flange("j_end", (x0 + 0.06, 0, zc), (-1, 0, 0), r, gel_x, bolt, n_bolts=12)
    flange("j_mid", (-1.3, 0, zc), (1, 0, 0), r, gel_x, bolt, n_bolts=12)
    elbow_c = Vector((x1 - er, 0, zc + er))
    tube("elbow", arc(elbow_c, er, -math.pi / 2, 0, 40, (0, 0, 1), (1, 0, 0)) if False else [tuple(elbow_c + Vector((math.sin(t) * er, 0, -math.cos(t) * er))) for t in [i / 40 * math.pi / 2 for i in range(41)]], r, gel_z)
    top = zc + er + 2.15
    cyl("riser", r, top - (zc + er), gel_z, (x1, 0, zc + er), (0, 0, 1), segs=64)
    flange("j_top", (x1, 0, top), (0, 0, 1), r, gel_z, bolt, n_bolts=12)
    # a tee off the run, rising to a flanged butterfly valve with a gear operator
    tx = -2.25
    cyl("tee_branch", 0.17, 0.42, gel_z, (tx, 0, zc + r * 0.6), (0, 0, 1), segs=48)
    v0 = flange("tee_fl", (tx, 0, zc + r * 0.6 + 0.42), (0, 0, 1), 0.17, gel_z, bolt, n_bolts=8)
    cyl("valve_wafer", 0.27, 0.09, paint, v0, (0, 0, 1), segs=48, bevel=0.006)
    v1 = v0 + Vector((0, 0, 0.09))
    flange("valve_out", v1, (0, 0, 1), 0.17, gel_z, bolt, n_bolts=8, blind=True)
    cyl("valve_stem", 0.03, 0.22, steel, v0 + Vector((0, -0.27, 0.045)), (0, -1, 0))
    box("gearbox", (0.2, 0.16, 0.2), v0 + Vector((0, -0.55, 0.045)), paint, bevel=0.012)
    handwheel("hw", v0 + Vector((0.18, -0.55, 0.045)), (1, 0, 0), 0.17, steel)
    # pipe supports: a steel stand, a saddle with an FRP wear pad, a U-bolt
    for i, sx in enumerate((-2.85, -0.75)):
        box(f"sup_base{i}", (0.5, 0.36, 0.02), (sx, 0, 0.01), steel)
        box(f"sup_post{i}", (0.12, 0.12, zc - r - 0.1), (sx, 0, (zc - r - 0.1) / 2 + 0.02), steel)
        box(f"sup_beam{i}", (0.16, 0.8, 0.08), (sx, 0, zc - r - 0.05), steel)
        cyl(f"wear_pad{i}", r + 0.012, 0.26, gel_x, (sx - 0.13, 0, zc), (1, 0, 0), segs=64)
        tube(f"ubolt{i}", [(sx, -r - 0.03, zc - r - 0.03)] + [tuple(Vector((sx, 0, zc)) + Vector((0, -math.cos(t), math.sin(t))) * (r + 0.03)) for t in [k / 20 * math.pi for k in range(21)]] + [(sx, r + 0.03, zc - r - 0.03)], 0.012, steel)
    studio(target=(-1.2, 0, 1.5), cam_from=(4.4, -10.6, 3.9), lens=50, frame=(-1.2, 0, 1.75))


# ---------------------------------------------------------------- dual-laminate vessel, cut away to show the liner
def frp_vessel():
    gel = frp_gelcoat("Z")  # lathed about z, then laid down
    liner = mat("pvdf_liner", "#e9e6dc", rough=0.3, coat=0.2)
    cut_frp = mat("frp_cut", "#9a8d5f", rough=0.7)  # raw laminate where it's cut: glass and resin, not gel coat
    steel = mat("paint_steel", "#2e3236", rough=0.45, metal=0.3)
    bolt = mat("bolt", "#b9bcbd", rough=0.3, metal=1.0)
    R, L, HD, T, TL = 1.0, 3.2, 0.5, 0.06, 0.012  # radius, straight length, head depth, FRP wall, liner
    zc = 1.35

    def wall(name, r_out, r_in, m):
        out = [(0, -L / 2 - HD * (r_out / R))] + [(r_out * math.sin(a), -L / 2 - HD * (r_out / R) * math.cos(a)) for a in [i / 24 * math.pi / 2 for i in range(1, 25)]]
        out += [(r_out, L / 2)] + [(r_out * math.cos(a), L / 2 + HD * (r_out / R) * math.sin(a)) for a in [i / 24 * math.pi / 2 for i in range(1, 25)]]
        inn = [(r_in * math.cos(a), L / 2 + HD * (r_in / R) * math.sin(a)) for a in [i / 24 * math.pi / 2 for i in range(24, 0, -1)]] + [(r_in, L / 2)]
        inn += [(r_in * math.sin(a), -L / 2 - HD * (r_in / R) * math.cos(a)) for a in [i / 24 * math.pi / 2 for i in range(24, 0, -1)]] + [(0, -L / 2 - HD * (r_in / R))]
        ob = lathe(name, out + inn, m, segs=128)
        ob.rotation_euler = (0, math.pi / 2, 0)  # axis along x
        ob.location = (0, 0, zc)
        return ob

    shell = wall("shell", R, R - T, gel)
    lin = wall("liner", R - T, R - T - TL, liner)
    # the cutaway: a quarter wedge out of the near, upper side of the left half
    bpy.ops.mesh.primitive_cube_add(size=1, location=(-L / 2 - 0.3, -0.75, zc + 0.75))
    cutter = bpy.context.active_object
    cutter.scale = (2.0, 1.5, 1.5)
    cutter.display_type = "WIRE"
    cutter.hide_render = True
    for ob in (shell, lin):
        bo = ob.modifiers.new("cut", "BOOLEAN")
        bo.object = cutter
        bo.operation = "DIFFERENCE"
        bo.solver = "EXACT"
        bo.material_mode = "TRANSFER"
    cutter.data.materials.append(cut_frp)
    # inside, the liner's dark interior reads through the opening
    # nozzles on top, a manway on the right head, saddles below
    flange("n1", (0.35, 0, zc + R - 0.02), (0, 0, 1), 0.12, gel, bolt, n_bolts=8, neck=0.3)
    flange("n2", (1.15, 0, zc + R - 0.02), (0, 0, 1), 0.08, gel, bolt, n_bolts=8, neck=0.25)
    flange("mw", (L / 2 + HD - 0.02, 0, zc), (1, 0, 0), 0.28, gel, bolt, n_bolts=16, blind=True, neck=0.12)
    flange("drain", (-0.3, 0, zc - R + 0.02), (0, 0, -1), 0.06, gel, bolt, n_bolts=4, neck=0.18)
    for i, sx in enumerate((-1.05, 1.05)):
        # saddle: a web plate, a curved top plate, a base plate
        box(f"sad_base{i}", (0.32, 1.7, 0.03), (sx, 0, 0.015), steel)
        box(f"sad_web{i}", (0.03, 1.5, zc - R * 0.55), (sx, 0, (zc - R * 0.55) / 2 + 0.03), steel)
        for k in range(-6, 7):
            a = k / 6 * 0.95
            y, z = math.sin(a) * (R + 0.02), zc - math.cos(a) * (R + 0.02)
            box(f"sad_top{i}{k}", (0.3, 0.17, 0.02), (sx, y, z), steel, bevel=0.002).rotation_euler.x = a
        for s in (-1, 1):
            box(f"sad_rib{i}{s}", (0.26, 0.03, 0.5), (sx, s * 0.6, 0.3), steel)
    studio(target=(0, 0, 1.3), cam_from=(-4.2, -8.2, 3.9), lens=50, frame=(0.05, 0, 1.35))


# ---------------------------------------------------------------- glass-fused-to-steel bolted tank with a dome
def gls_tank():
    enamel = mat("gls_enamel", "#123c55", rough=0.12, coat=0.9, coat_rough=0.05)
    seam = mat("gls_seam", "#0c2533", rough=0.3, coat=0.5)
    alu = mat("alu", "#c3c7c9", rough=0.32, metal=1.0)
    alu_rib = mat("alu_rib", "#a9aeb1", rough=0.28, metal=1.0)
    steel = mat("galv", "#9aa0a3", rough=0.38, metal=1.0)
    bolt = mat("gls_bolt", "#d4d6d6", rough=0.25, metal=1.0)
    R, Z0, rings, ph = 2.2, 0.32, 4, 0.75  # radius, base, panel rings, panel height
    H = rings * ph
    lathe("base", [(0, 0), (2.55, 0), (2.55, 0.3), (2.5, 0.32), (0, 0.32)], concrete(), segs=128)
    cyl("shell", R, H, enamel, (0, 0, Z0), (0, 0, 1), segs=160)
    pts = []
    per_ring = 14
    for k in range(rings + 1):
        z = Z0 + k * ph
        lathe(f"hseam{k}", [(R + 0.0, z - 0.018), (R + 0.007, z - 0.012), (R + 0.007, z + 0.012), (R, z + 0.018)], seam, segs=160)
        nb = 150
        for i in range(nb):
            a = i / nb * math.tau
            n = Vector((math.cos(a), math.sin(a), 0))
            for dz in (-0.03, 0.03) if 0 < k < rings else ((0.03,) if k == 0 else (-0.03,)):
                pts.append((n * (R + 0.007) + Vector((0, 0, z + dz)), n))
    for k in range(rings):
        off = (k % 2) * 0.5
        for j in range(per_ring):
            a = (j + off) / per_ring * math.tau
            n = Vector((math.cos(a), math.sin(a), 0))
            t = Vector((-n.y, n.x, 0))
            box(f"vseam{k}{j}", (0.012, 0.03, ph - 0.04), n * (R + 0.004) + Vector((0, 0, Z0 + k * ph + ph / 2)), seam, rot_z=a, bevel=0.002)
            for m_ in range(1, 9):
                z = Z0 + k * ph + m_ * ph / 9
                for s in (-1, 1):
                    pts.append((n * (R + 0.006) + t * 0.022 * s + Vector((0, 0, z)), n))
    studs("gls_bolts", pts, 0.011, bolt)
    # stiffener wind ring near the top
    lathe("wind_ring", [(R + 0.0, Z0 + H - 0.2), (R + 0.12, Z0 + H - 0.2), (R + 0.12, Z0 + H - 0.185), (R + 0.01, Z0 + H - 0.185)], steel, segs=160)
    # aluminium geodesic dome: a faceted spherical cap with its strut lattice
    cap_h = 0.75
    rs = (R ** 2 + cap_h ** 2) / (2 * cap_h)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=rs, location=(0, 0, Z0 + H + cap_h - rs))
    dome = bpy.context.active_object
    dome.name = "dome"
    bs = dome.modifiers.new("cap", "BOOLEAN")
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, Z0 + H - 50))
    below = bpy.context.active_object
    below.scale = (100, 100, 100)
    below.hide_render = True
    bs.object = below
    bs.operation = "DIFFERENCE"
    link(dome, alu, smooth=False)
    struts = dome.copy()
    struts.data = dome.data.copy()
    bpy.context.scene.collection.objects.link(struts)
    wf = struts.modifiers.new("wire", "WIREFRAME")
    wf.thickness = 0.03
    wf.offset = 1
    struts.data.materials.clear()
    struts.data.materials.append(alu_rib)
    # handrail round the rim, a caged ladder, a low manway and an overflow
    zr = Z0 + H
    for k in range(24):
        a = k / 24 * math.tau
        if abs(math.atan2(math.sin(a - math.radians(-130)), math.cos(a - math.radians(-130)))) < 0.2:
            continue
        p = Vector((math.cos(a), math.sin(a), 0)) * (R - 0.05)
        tube(f"post{k}", [tuple(p + Vector((0, 0, zr))), tuple(p + Vector((0, 0, zr + 0.85)))], 0.02, steel)
    for hz in (0.45, 0.85):
        tube(f"rail{hz}", arc((0, 0, zr + hz), R - 0.05, 0, math.tau, 96, (1, 0, 0), (0, 1, 0)), 0.022, steel, closed=True)
    caged_ladder("lad_", -130, R, 0.32, zr + 0.85, steel, cage_from=2.3)
    d = Vector((math.cos(math.radians(-60)), math.sin(math.radians(-60)), 0))
    flange("manway", d * (R - 0.01) + Vector((0, 0, Z0 + 0.5)), d, 0.3, enamel, bolt, n_bolts=16, blind=True, neck=0.16)
    d2 = Vector((math.cos(math.radians(-15)), math.sin(math.radians(-15)), 0))
    pipe = mat("gls_pipe", "#1b4a63", rough=0.2, coat=0.6)
    top = d2 * (R + 0.12) + Vector((0, 0, zr - 0.35))
    tube("overflow", [tuple(d2 * (R - 0.01) + Vector((0, 0, zr - 0.35))), tuple(top), tuple(d2 * (R + 0.12) + Vector((0, 0, 0.6)))], 0.07, pipe)
    studio(target=(0, 0, 2.0), cam_from=(9.0, -12.5, 4.2), lens=50, frame=(-0.2, 0, 2.1), cards=1.2)


# ---------------------------------------------------------------- stainless F&B process vessel
def ss_vessel():
    def brushed(nt, p):
        p.inputs["Anisotropic"].default_value = 0.6
        n = nt.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = 300
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (1, 1, 60)  # stretched along the height: brushed vertically
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
        nt.links.new(mp.outputs["Vector"], n.inputs["Vector"])
        r = nt.nodes.new("ShaderNodeMapRange")
        r.inputs["To Min"].default_value = 0.18
        r.inputs["To Max"].default_value = 0.3
        nt.links.new(n.outputs["Fac"], r.inputs["Value"])
        nt.links.new(r.outputs["Result"], p.inputs["Roughness"])

    ss = mat("ss316", "#c9ccce", rough=0.22, metal=1.0, bump=brushed)
    polished = mat("ss_polished", "#d9dbdc", rough=0.08, metal=1.0)
    clad = mat("ss_clad", "#bfc3c5", rough=0.3, metal=1.0, bump=brushed)
    motor = mat("motor", "#2f4f6f", rough=0.4, coat=0.3)
    glass = mat("sight", "#1d2a2e", rough=0.03, coat=1.0, coat_rough=0.02)
    R, Z0, H, HD = 0.9, 0.85, 2.3, 0.3
    ZT = Z0 + H
    prof = [(0, Z0 - HD)] + [(R * math.sin(a), Z0 - HD * math.cos(a)) for a in [i / 24 * math.pi / 2 for i in range(1, 25)]]
    prof += [(R, ZT)] + dished(R, ZT, HD)
    lathe("vessel", prof, ss, segs=128)
    # jacket + insulation cladding over the lower two thirds, with its seams
    zj0, zj1 = Z0 + 0.15, Z0 + H * 0.68
    lathe("jacket", [(R, zj0 - 0.04), (R + 0.05, zj0), (R + 0.05, zj1), (R, zj1 + 0.04)], clad, segs=128)
    for z in (zj0 + (zj1 - zj0) * k / 3 for k in range(1, 3)):
        lathe(f"clad_seam{z:.2f}", [(R + 0.05, z - 0.006), (R + 0.054, z - 0.004), (R + 0.054, z + 0.004), (R + 0.05, z + 0.006)], polished, segs=128)
    # four legs with ball feet
    for k in range(4):
        a = (k + 0.5) / 4 * math.tau
        n = Vector((math.cos(a), math.sin(a), 0))
        top = n * (R * 0.86) + Vector((0, 0, Z0 + 0.05))
        foot = n * (R * 0.98)
        tube(f"leg{k}", [tuple(top), tuple(foot + Vector((0, 0, 0.08)))], 0.045, polished)
        cyl(f"foot{k}", 0.07, 0.04, polished, foot, (0, 0, 1), segs=32, bevel=0.01)
        cyl(f"foot_rod{k}", 0.018, 0.08, polished, foot + Vector((0, 0, 0.04)), (0, 0, 1))
    # top: agitator drive, hygienic manway with clamp, CIP line to a spray ball, sight glass and light
    zt = ZT + HD
    cyl("drive_flange", 0.2, 0.05, polished, (0, 0, zt - 0.02), (0, 0, 1), segs=48, bevel=0.005)
    cyl("gearbox", 0.15, 0.22, motor, (0, 0, zt + 0.03), (0, 0, 1), segs=48, bevel=0.01)
    cyl("motor", 0.13, 0.38, motor, (0, 0, zt + 0.25), (0, 0, 1), segs=48, bevel=0.02)
    for k in range(10):
        a = k / 10 * math.tau
        box(f"fin{k}", (0.012, 0.03, 0.3), (math.cos(a) * 0.135, math.sin(a) * 0.135, zt + 0.44), motor, rot_z=a)
    cyl("fan_cover", 0.135, 0.07, motor, (0, 0, zt + 0.63), (0, 0, 1), segs=48, bevel=0.02)

    def head_z(r):
        return ZT + HD * math.sqrt(max(0, 1 - (r / R) ** 2))

    mp = Vector((math.cos(math.radians(210)), math.sin(math.radians(210)), 0)) * 0.5
    cyl("manway_neck", 0.22, 0.14, polished, mp + Vector((0, 0, head_z(0.5) - 0.05)), (0, 0, 1), segs=64)
    cyl("manway_lid", 0.25, 0.04, polished, mp + Vector((0, 0, head_z(0.5) + 0.09)), (0, 0, 1), segs=64, bevel=0.012)
    tube("manway_handle", [tuple(mp + Vector((-0.08, 0, head_z(0.5) + 0.13))), tuple(mp + Vector((-0.08, 0, head_z(0.5) + 0.19))), tuple(mp + Vector((0.08, 0, head_z(0.5) + 0.19))), tuple(mp + Vector((0.08, 0, head_z(0.5) + 0.13)))], 0.012, polished)
    sg = Vector((math.cos(math.radians(330)), math.sin(math.radians(330)), 0)) * 0.55
    cyl("sight_ferrule", 0.09, 0.08, polished, sg + Vector((0, 0, head_z(0.55) - 0.03)), (0, 0, 1), segs=48)
    cyl("sight_glass", 0.07, 0.01, glass, sg + Vector((0, 0, head_z(0.55) + 0.05)), (0, 0, 1), segs=48)
    cp = Vector((math.cos(math.radians(80)), math.sin(math.radians(80)), 0)) * 0.6
    tube("cip", [tuple(cp + Vector((0, 0, head_z(0.6) - 0.02))), tuple(cp + Vector((0, 0, zt + 0.45))), tuple(cp * 1.9 + Vector((0, 0, zt + 0.45))), tuple(cp * 1.9 + Vector((0, 0, zt - 1.2)))], 0.03, polished)
    for z in (zt + 0.2,):
        cyl("cip_clamp", 0.045, 0.03, polished, cp + Vector((0, 0, z)), (0, 0, 1), segs=32)
    # side: a temperature sensor port; below: the outlet valve
    d = Vector((math.cos(math.radians(-40)), math.sin(math.radians(-40)), 0))
    cyl("sensor", 0.03, 0.16, polished, d * R + Vector((0, 0, Z0 + H * 0.82)), d, segs=24)
    cyl("sensor_head", 0.045, 0.07, motor, d * (R + 0.16) + Vector((0, 0, Z0 + H * 0.82)), d, segs=24, bevel=0.01)
    zo = Z0 - HD
    tube("outlet", [(0, 0, zo + 0.02), (0, 0, zo - 0.18), (0, -0.0001, zo - 0.19), (0.0, -0.4, zo - 0.19)], 0.035, polished)
    cyl("valve", 0.07, 0.07, polished, (0, -0.22, zo - 0.19), (0, -1, 0), segs=40, bevel=0.01)
    box("valve_actuator", (0.11, 0.11, 0.14), (0, -0.255, zo - 0.07), motor, bevel=0.012)
    studio(target=(0, 0, 1.75), cam_from=(6.6, -9.0, 3.4), lens=50, floor="#121413", frame=(0, 0, 1.95), cards=1.6)


# ---------------------------------------------------------------- thermoplastic (PP) tank
def thermo_tank():
    pp = mat("pp", "#b9b8ae", rough=0.5, coat=0.1)
    pp_dark = mat("pp_weld", "#a9a89e", rough=0.6)
    steel = mat("galv", "#9aa0a3", rough=0.38, metal=1.0)
    bolt = mat("bolt", "#b9bcbd", rough=0.3, metal=1.0)
    R, Z0, H = 1.05, 0.3, 3.0
    ZT = Z0 + H
    lathe("plinth", [(0, 0), (1.3, 0), (1.3, 0.27), (1.27, 0.3), (0, 0.3)], concrete(), segs=96)
    lathe("shell", [(0, Z0), (R, Z0), (R, ZT), (R - 0.02, ZT + 0.02), (0, ZT + 0.02)], pp, segs=128)
    # welded stiffening rings, and the vertical weld seams between the wound/plate sections
    for k in range(5):
        z = Z0 + 0.35 + k * 0.62
        lathe(f"rib{k}", [(R, z - 0.05), (R + 0.06, z - 0.04), (R + 0.06, z + 0.04), (R, z + 0.05)], pp, segs=128)
        lathe(f"weld{k}", [(R + 0.06, z - 0.004), (R + 0.064, z), (R + 0.06, z + 0.004)], pp_dark, segs=128)
    lathe("top_ring", [(R - 0.05, ZT + 0.02), (R + 0.05, ZT + 0.02), (R + 0.05, ZT + 0.09), (R - 0.05, ZT + 0.09)], pp, segs=128)

    def pp_nozzle(name, at, d, r, neck):
        """Thermoplastic nozzle: a PP stub flange, with a loose galvanised backing flange carrying the bolts."""
        d = Vector(d).normalized()
        at = Vector(at)
        cyl(name + "_neck", r, neck, pp, at, d, segs=48)
        cyl(name + "_stub", r * 1.45, 0.03, pp, at + d * neck, d, segs=48, bevel=0.005)
        back = at + d * (neck - 0.035)
        cyl(name + "_backing", r * 1.75 + 0.03, 0.025, steel, back, d, segs=48, bevel=0.004)
        side = d.cross(Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))).normalized()
        up = d.cross(side)
        for i in range(8):
            a = (i + 0.5) / 8 * math.tau
            p = back + (side * math.cos(a) + up * math.sin(a)) * (r * 1.6 + 0.015)
            cyl(f"{name}_stud{i}", 0.008, 0.1, bolt, p - d * 0.01, d, segs=8)
            cyl(f"{name}_nut{i}", 0.014, 0.014, bolt, p - d * 0.012, -d, segs=6)

    pp_nozzle("top_a", (0.35, -0.2, ZT + 0.02), (0, 0, 1), 0.1, 0.22)
    pp_nozzle("top_b", (-0.4, 0.3, ZT + 0.02), (0, 0, 1), 0.16, 0.18)
    for k, (deg, z, r) in enumerate(((-20, Z0 + 0.2, 0.08), (-60, Z0 + 2.4, 0.06))):
        d = Vector((math.cos(math.radians(deg)), math.sin(math.radians(deg)), 0))
        pp_nozzle(f"side{k}", d * (R - 0.01) + Vector((0, 0, z)), d, r, 0.22)
    # lifting eyes, and a PP pipe off the bottom nozzle with a union ball valve
    for k in range(3):
        a = (k / 3) * math.tau + 0.4
        n = Vector((math.cos(a), math.sin(a), 0))
        box(f"eye{k}", (0.03, 0.12, 0.14), n * (R + 0.02) + Vector((0, 0, ZT + 0.1)), pp, rot_z=a)
    d = Vector((math.cos(math.radians(-20)), math.sin(math.radians(-20)), 0))
    p0 = d * (R + 0.25) + Vector((0, 0, Z0 + 0.2))
    tube("pp_pipe", [tuple(p0), tuple(p0 + d * 0.55)], 0.055, pp)
    cyl("ball_valve", 0.09, 0.2, mat("pvc_valve", "#5d6266", rough=0.45), p0 + d * 0.15, d, segs=32, bevel=0.01)
    box("valve_lever", (0.04, 0.22, 0.03), p0 + d * 0.25 + Vector((0, 0, 0.12)), mat("valve_red", "#a3332b", rough=0.4), rot_z=math.atan2(d.y, d.x) + 0.3)
    studio(target=(0, 0, 1.85), cam_from=(6.2, -8.6, 3.5), lens=50, frame=(0.1, -0.05, 1.85))


SHOTS = {"frp-tank": frp_tank, "frp-pipe": frp_pipe, "frp-vessel": frp_vessel, "gls-tank": gls_tank, "ss-vessel": ss_vessel, "thermo-tank": thermo_tank}

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
