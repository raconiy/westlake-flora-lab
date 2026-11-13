"""Agent B (Opus 5.5) — continuous NOVEL-VIEW renders (paths not taken by the video camera).
paths: orbit  = aerial orbit around the whole site (radius 150 m about the ring centre, 30 m high)
       inner  = eye-level walk (1.6 m) through the INNER lawn between the tree ring and the rotunda (r = 80 m)
Usage: blender -b -P cg/blender/render_flythrough.py -- <scene.blend> <path> <outdir> <i0> <i1> <n> [spp] [w] [h]
"""
import bpy, sys, math, json, pathlib
from mathutils import Vector
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import render_setup
a = sys.argv[sys.argv.index("--") + 1:]
blend, path, out, i0, i1, n = a[0], a[1], pathlib.Path(a[2]), int(a[3]), int(a[4]), int(a[5])
spp = int(a[6]) if len(a) > 6 else 32; W = int(a[7]) if len(a) > 7 else 960; H = int(a[8]) if len(a) > 8 else 540
B = pathlib.Path("/root/real2sim/scene-20261113/agent-b"); G = json.load(open(B / "cg/ground/ground_config.json"))
RC = Vector((*G["ring_center"], 0.0)); ROT = Vector((*G["rotunda_center"], 0.0))
bpy.ops.wm.open_mainfile(filepath=blend); sc = bpy.context.scene
render_setup.translucent_leaves(); render_setup.cycles(sc, spp, W, H)
LOOK = json.load(open(B / "cg/scene/look.json")); sc.view_settings.view_transform = LOOK["view_transform"]; sc.view_settings.look = "None"
cam = bpy.data.objects.new("fly_cam", bpy.data.cameras.new("fly_cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 24 if path == "inner" else 30; cam.data.clip_end = 4000
out.mkdir(parents=True, exist_ok=True)
for i in range(i0, min(i1, n)):
    t = i / n
    if path == "orbit":
        ang = math.radians(200) + 2 * math.pi * t; pos = RC + Vector((150 * math.cos(ang), 150 * math.sin(ang), 30)); tgt = RC + Vector((-20, -5, 4))
    else:
        ang = math.radians(150) - 2 * math.pi * 0.62 * t; r = 80
        pos = RC + Vector((r * math.cos(ang), r * math.sin(ang), 1.6))
        fwd = Vector((math.sin(ang), -math.cos(ang), 0)); tgt = pos + fwd * 30 + (ROT - pos).normalized() * 8 + Vector((0, 0, 1.2))
    cam.location = pos; cam.rotation_euler = (tgt - pos).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = str(out / f"{i:04d}.png"); bpy.ops.render.render(write_still=True)
