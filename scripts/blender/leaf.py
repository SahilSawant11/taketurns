"""
The home page's leaf: a peepal (Ficus religiosa) leaf, built in Blender.

Run headless from the repo root:

    blender -b -P scripts/blender/leaf.py -- public/models/leaf /tmp/leaf-preview.png

Paints the leaf's outline and venation (midrib, arching secondaries joined
by an intramarginal vein, a reticulate net between them, petiole), builds a
high-poly blade displaced by that relief, and bakes it with Cycles onto the
flat leaf the page bends in its shader:

  leaf-normal.webp   tangent-space normal map (vein relief)
  leaf-detail.webp   R: albedo variation, G: vein mask (for translucency),
                     B: margin, A: cutout (the silhouette)

The page tints the leaf itself (pale on dark sections, deep green on bone),
so the textures carry detail, not colour. Also renders a still preview.

Leaf space matches src/scripts/leaf.ts: x across (-0.5 … 0.5), y from the
petiole's end (-0.2) to the tip (1.0); the blade's base is at y = 0.
UV: u = x + 0.5, v = (y + 0.2) / 1.2.
"""
import math
import os
import sys

import bpy
import numpy as np

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT_DIR = args[0] if args else "leaf"
PREVIEW = args[1] if len(args) > 1 else None
os.makedirs(OUT_DIR, exist_ok=True)
N = 1024
rng = np.random.default_rng(7)

# ---------------------------------------------------------------- leaf space grid
v, u = np.mgrid[0:N, 0:N].astype(np.float32) / (N - 1)  # row 0 = v 0 = bottom (Blender image order)
X = u - 0.5
Y = v * 1.2 - 0.2
AX = np.abs(X)


# ---------------------------------------------------------------- the silhouette
def seg_dist(px_, py_, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = np.clip(((px_ - ax) * dx + (py_ - ay) * dy) / (dx * dx + dy * dy + 1e-9), 0, 1)
    return np.hypot(px_ - (ax + t * dx), py_ - (ay + t * dy))


def polyline_dist(pts):
    out = np.full(X.shape, 9.0, dtype=np.float32)
    for (ax, ay), (bx, by) in zip(pts[:-1], pts[1:]):
        out = np.minimum(out, seg_dist(X, Y, ax, ay, bx, by))
    return out


def catmull(pts, per=12):
    """Smooth a polyline through its points."""
    P = [pts[0]] + pts + [pts[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(per):
            t = k / per
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in (0, 1)))
    out.append(pts[-1])
    return out


# Peepal, right half, from the notch at the petiole round the heart-shaped lobe,
# up the broad body, in along the concave shoulder and out along the long drip tip.
HALF = [
    (0.0, 0.035), (0.05, 0.0), (0.12, -0.03), (0.21, -0.03), (0.30, 0.01), (0.37, 0.08),
    (0.415, 0.17), (0.43, 0.26), (0.415, 0.35), (0.37, 0.44), (0.30, 0.52), (0.22, 0.59),
    (0.13, 0.648), (0.072, 0.705), (0.043, 0.765), (0.027, 0.835), (0.016, 0.9), (0.007, 0.958), (0.0, 1.0),
]
right = catmull(HALF, 14)
left = [(-x * 0.97, y + 0.006 * math.sin(y * 9)) for x, y in reversed(right)]  # a touch of asymmetry
outline = right + left[1:]
# inside test (even-odd) and distance to the outline
inside = np.zeros(X.shape, dtype=bool)
for (ax, ay), (bx, by) in zip(outline, outline[1:] + outline[:1]):
    cond = ((ay > Y) != (by > Y)) & (X < (bx - ax) * (Y - ay) / (by - ay + 1e-12) + ax)
    inside ^= cond
edge = polyline_dist(outline + outline[:1])
d_blade = np.where(inside, -edge, edge)
# petiole: thin, curving a little
sx = X - 0.16 * (Y + 0.2) ** 2 * (Y < 0.05)
d_pet = np.where((Y > -0.2) & (Y < 0.06), np.abs(sx) - (0.007 + 0.006 * np.clip((Y + 0.2) / 0.25, 0, 1)), 1.0)
d = np.minimum(d_blade, d_pet)
px = 1.2 / N
cutout = np.clip(0.5 - d / (1.5 * px), 0, 1)  # antialiased mask

# ---------------------------------------------------------------- venation
# midrib: base to tip, thinning
mid_d = np.where((Y > 0.0) & (Y < 0.995), AX, 9.0)
mid_w = 0.010 * (1 - 0.82 * np.clip(Y, 0, 1)) + 0.0012
midrib = np.clip(1 - mid_d / mid_w, 0, 1)

# secondaries: chevrons rising from the midrib, the basal pair spreading wide into the lobes
sec = np.zeros_like(X)
pairs = [(0.035, 78, 0.40), (0.06, 66, 0.44), (0.12, 56, 0.45), (0.19, 50, 0.44), (0.27, 46, 0.42), (0.35, 43, 0.38), (0.43, 41, 0.33), (0.51, 39, 0.26), (0.58, 37, 0.19)]
for i, (y0, ang, L) in enumerate(pairs):
    th = math.radians(ang)
    for s in (-1, 1):
        pts = []
        for k in range(16):
            t = k / 15
            # straight out at first, then turning up to run towards the margin
            x = s * math.sin(th) * L * t * (1 - 0.18 * t * t)
            y = y0 + math.cos(th) * L * t + 0.16 * L * t * t
            pts.append((x, y))
        dd = polyline_dist(pts)
        width = 0.0045 * (1 - 0.45 * i / len(pairs))
        sec = np.maximum(sec, np.clip(1 - dd / width, 0, 1))
sec *= d_blade < -0.012  # they fade before the margin, into the marginal vein
# intramarginal vein: a loop just inside the margin, joining the secondaries
inner = np.clip(1 - np.abs(d_blade + 0.02) / 0.0026, 0, 1) * (Y > 0.0) * (Y < 0.8)

# reticulate net: Voronoi cell edges (F2 − F1) on a jittered grid
def voronoi_edges(scale, jitter, seed):
    r = np.random.default_rng(seed)
    gx, gy = (u * scale), (v * scale * 1.2)
    ix, iy = np.floor(gx).astype(np.int32), np.floor(gy).astype(np.int32)
    G = int(scale * 1.2) + 4
    off = r.random((G + 2, G + 2, 2)).astype(np.float32) * jitter + (1 - jitter) / 2
    f1 = np.full(X.shape, 9.0, dtype=np.float32)
    f2 = np.full(X.shape, 9.0, dtype=np.float32)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            cx = np.clip(ix + ox, 0, G)
            cy = np.clip(iy + oy, 0, G)
            p = off[cy, cx]
            dd = np.hypot(gx - (cx + p[..., 0]), gy - (cy + p[..., 1]))
            f2 = np.where(dd < f1, f1, np.minimum(f2, dd))
            f1 = np.minimum(f1, dd)
    return f2 - f1


tert = np.clip(1 - voronoi_edges(34, 0.9, 1) / 0.07, 0, 1) ** 1.5
quat = np.clip(1 - voronoi_edges(90, 0.9, 2) / 0.09, 0, 1) ** 2

veins = np.maximum.reduce([midrib, sec * 0.85, inner * 0.6, tert * 0.42, quat * 0.18])
veins *= (d_blade < 0)  # only on the blade
petiole = np.clip(1 - np.abs(sx) / 0.014, 0, 1) * (d_pet < 0)

# ---------------------------------------------------------------- relief and detail
# height: veins stand proud on the underside, the blade puckers gently between them
height = 0.55 * midrib + 0.32 * sec + 0.2 * inner + 0.12 * tert + 0.05 * quat + 0.8 * petiole
pucker = (1 - np.clip(tert * 2, 0, 1)) * 0.03
height = (height + pucker) * cutout

noise = rng.random((N, N)).astype(np.float32)
# soft mottling: blur the noise a little by averaging shifted copies
mot = sum(np.roll(np.roll(noise, a, 0), b, 1) for a in (-6, 0, 6) for b in (-6, 0, 6)) / 9
albedo = 0.86 + 0.1 * (mot - 0.5) + 0.12 * (veins * 0.9) + 0.05 * (Y - 0.4)
margin = np.clip(1 + d_blade / 0.02, 0, 1) * (d_blade < 0)  # 1 at the edge → 0 inside
albedo -= 0.08 * margin
albedo = np.clip(albedo, 0, 1)


def save(name, rgba):
    img = bpy.data.images.new(name, N, N, alpha=True, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(np.clip(rgba, 0, 1).astype(np.float32).ravel())
    img.filepath_raw = os.path.join(OUT_DIR, f"{name}.webp")
    img.file_format = "WEBP"
    scene = bpy.context.scene
    scene.render.image_settings.quality = 92
    img.save()
    return img


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
detail = np.stack([albedo, veins, margin, cutout], axis=-1)
save("leaf-detail", detail)
# height as an image for the displacement
h_img = bpy.data.images.new("leaf-height", N, N, alpha=False, float_buffer=True)
h_img.colorspace_settings.name = "Non-Color"
h_img.pixels.foreach_set(np.stack([height, height, height, np.ones_like(height)], -1).astype(np.float32).ravel())
h_img.pack()

# ---------------------------------------------------------------- high-poly blade, baked onto the flat leaf
def leaf_plane(name, cuts):
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=cuts, y_subdivisions=int(cuts * 1.2), size=1, location=(0, 0.4, 0))
    o = bpy.context.object
    o.name = name
    o.scale = (1, 1.2, 1)
    bpy.ops.object.transform_apply(location=True, scale=True)
    # UVs straight from leaf space
    me = o.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uvl = me.uv_layers.active.data
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uvl[li].uv = (co.x + 0.5, (co.y + 0.2) / 1.2)
    return o


high = leaf_plane("leaf_high", 600)
tex = bpy.data.textures.new("relief", "IMAGE")
tex.image = h_img
tex.extension = "EXTEND"
disp = high.modifiers.new("relief", "DISPLACE")
disp.texture = tex
disp.texture_coords = "UV"
disp.strength = 0.0075
disp.mid_level = 0.0
bpy.ops.object.modifier_apply(modifier="relief")
for p in high.data.polygons:
    p.use_smooth = True

low = leaf_plane("leaf_low", 2)
mat = bpy.data.materials.new("bake")
mat.use_nodes = True
nimg = bpy.data.images.new("leaf-normal", N, N, alpha=False)
nimg.colorspace_settings.name = "Non-Color"
tn = mat.node_tree.nodes.new("ShaderNodeTexImage")
tn.image = nimg
mat.node_tree.nodes.active = tn
low.data.materials.append(mat)
high.data.materials.append(mat)

scene.render.engine = "CYCLES"
scene.cycles.samples = 4
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for dv in prefs.devices:
        dv.use = True
    scene.cycles.device = "GPU"
except Exception:
    pass
for o in scene.objects:
    o.select_set(False)
high.select_set(True)
low.select_set(True)
bpy.context.view_layer.objects.active = low
scene.render.bake.use_selected_to_active = True
scene.render.bake.cage_extrusion = 0.02
scene.render.bake.max_ray_distance = 0.05
bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", margin=8)
nimg.filepath_raw = os.path.join(OUT_DIR, "leaf-normal.webp")
nimg.file_format = "WEBP"
scene.render.image_settings.quality = 92
nimg.save()
print(f"[leaf] wrote textures to {OUT_DIR}")

# ---------------------------------------------------------------- a still preview: the high-poly leaf, lit from behind and front
if PREVIEW:
    bpy.data.objects.remove(low)
    pm = bpy.data.materials.new("leaf")
    pm.use_nodes = True
    nt = pm.node_tree
    p = nt.nodes["Principled BSDF"]
    det = bpy.data.images.load(os.path.join(OUT_DIR, "leaf-detail.webp"))
    det.colorspace_settings.name = "Non-Color"
    td = nt.nodes.new("ShaderNodeTexImage")
    td.image = det
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(td.outputs["Color"], sep.inputs["Color"])
    tint = nt.nodes.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    tint.blend_type = "MULTIPLY"
    tint.inputs["Factor"].default_value = 1.0
    tint.inputs["A"].default_value = (0.05, 0.22, 0.09, 1)
    nt.links.new(sep.outputs["Red"], tint.inputs["B"])
    nt.links.new(tint.outputs["Result"], p.inputs["Base Color"])
    nt.links.new(td.outputs["Alpha"], p.inputs["Alpha"])
    p.inputs["Roughness"].default_value = 0.45
    p.inputs["Subsurface Weight"].default_value = 0.0
    p.inputs["Transmission Weight"].default_value = 0.15
    high.data.materials.clear()
    high.data.materials.append(pm)
    high.rotation_euler = (0, 0, math.radians(-28))
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 1.45
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0.02, 0.38, 3)
    scene.collection.objects.link(cam)
    scene.camera = cam
    for name, rot, energy in (("key", (0.5, -0.4, 0.3), 3.0), ("back", (2.6, 0.5, 0), 2.0)):
        ld = bpy.data.lights.new(name, "SUN")
        ld.energy = energy
        lo = bpy.data.objects.new(name, ld)
        lo.rotation_euler = rot
        scene.collection.objects.link(lo)
    world = bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.86, 0.82, 0.74, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
    scene.cycles.samples = 64
    scene.render.resolution_x = 900
    scene.render.resolution_y = 1000
    scene.render.film_transparent = False
    scene.render.filepath = PREVIEW
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    print(f"[leaf] preview {PREVIEW}")
