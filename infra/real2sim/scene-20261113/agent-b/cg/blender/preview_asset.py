"""Agent B (Opus 5.5) — look-dev preview of single assets (Cycles GPU, overcast sky + soft sun, neutral ground).
Usage: blender -b -P cg/blender/preview_asset.py -- <out_png> <asset.blend> [azimuth_deg=30] [elev_deg=8] [res=640] [spp=96]
"""
import bpy, sys, math, pathlib
from mathutils import Vector
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import render_setup
a = sys.argv[sys.argv.index("--") + 1:]
out, blend = a[0], a[1]; az = float(a[2]) if len(a) > 2 else 30; el = float(a[3]) if len(a) > 3 else 8
res = int(a[4]) if len(a) > 4 else 640; spp = int(a[5]) if len(a) > 5 else 96
bpy.ops.wm.open_mainfile(filepath=blend)
sc = bpy.context.scene
render_setup.translucent_leaves()
render_setup.world_sky(sc)
render_setup.cycles(sc, spp, res, int(res * 1.25))
mins = Vector((1e9,) * 3); maxs = Vector((-1e9,) * 3)
for o in sc.objects:
    if o.type == "MESH":
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c); mins = Vector(map(min, mins, w)); maxs = Vector(map(max, maxs, w))
ctr = (mins + maxs) / 2; size = max((maxs - mins).length, 1.0)
bpy.ops.mesh.primitive_plane_add(size=size * 6, location=(ctr.x, ctr.y, mins.z - 0.002)); g = bpy.context.active_object
gm = bpy.data.materials.new("preview_ground"); gm.use_nodes = True; gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.12, 0.16, 0.06, 1); g.data.materials.append(gm)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 35; d = size * 1.45
cam.location = ctr + Vector((math.cos(math.radians(az)) * math.cos(math.radians(el)), math.sin(math.radians(az)) * math.cos(math.radians(el)), math.sin(math.radians(el)))) * d
cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
sc.render.filepath = out; bpy.ops.render.render(write_still=True)
