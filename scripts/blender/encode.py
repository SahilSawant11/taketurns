"""
Encode rendered frames for the web with Blender's own FFmpeg (no ffmpeg
install needed).

    blender -b -P scripts/blender/encode.py -- video <frames dir> <first> <last> <out.mp4> [fps]
    blender -b -P scripts/blender/encode.py -- webp <in.png> <out.webp> [quality]

Videos are H.264 in MP4, yuv420p, no audio: they play muted and inline in
every browser.
"""
import os
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1 :]
mode = args[0]
scene = bpy.context.scene

if mode == "webp":
    src, out = args[1], args[2]
    img = bpy.data.images.load(os.path.abspath(src))
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.quality = int(args[3]) if len(args) > 3 else 84
    scene.render.image_settings.color_mode = "RGB"
    img.save_render(os.path.abspath(out), scene=scene)
    print(f"[encode] wrote {out}")
    sys.exit(0)

frames, first, last, out = args[1], int(args[2]), int(args[3]), args[4]
fps = int(args[5]) if len(args) > 5 else 24
names = [f"{f:04d}.png" for f in range(first, last + 1)]
probe = bpy.data.images.load(os.path.join(os.path.abspath(frames), names[0]))
w, h = probe.size

se = scene.sequence_editor_create()
strips = se.strips if hasattr(se, "strips") else se.sequences
strip = strips.new_image("frames", os.path.join(os.path.abspath(frames), names[0]), channel=1, frame_start=1)
for n in names[1:]:
    strip.elements.append(n)
scene.frame_start = 1
scene.frame_end = len(names)
scene.render.fps = fps
scene.render.resolution_x = w
scene.render.resolution_y = h
scene.render.resolution_percentage = 100
# the frames are already graded: pass them through untouched
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.render.use_sequencer = True
im = scene.render.image_settings
if hasattr(im, "media_type"):
    im.media_type = "VIDEO"
im.file_format = "FFMPEG"
im.color_mode = "RGB"
ff = scene.render.ffmpeg
ff.format = "MPEG4"
ff.codec = "H264"
ff.constant_rate_factor = "MEDIUM"
ff.ffmpeg_preset = "BEST"
ff.gopsize = 24
ff.use_max_b_frames = False
ff.audio_codec = "NONE"
scene.render.filepath = os.path.abspath(out)
bpy.ops.render.render(animation=True)
# Blender appends the frame range to the name: move it to the name asked for
made = scene.render.frame_path(frame=scene.frame_start)
if os.path.abspath(made) != os.path.abspath(out) and os.path.exists(made):
    os.replace(made, out)
print(f"[encode] wrote {out} ({os.path.getsize(out) // 1024} KB)")
