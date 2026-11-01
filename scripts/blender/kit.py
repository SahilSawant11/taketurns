"""
Shared helpers for the Blender build scripts: per-material mesh accumulators
with vertex colours (built with bmesh), and vertex-coloured materials.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector


def hexc(h):
    """'#rrggbb' → sRGB floats."""
    return [int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)]


def srgb_to_lin(c):
    return [((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c]


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
        bpy.context.scene.collection.objects.link(o)
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


