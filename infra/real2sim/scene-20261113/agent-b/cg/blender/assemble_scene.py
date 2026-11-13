"""Agent B (Opus 5.5) — assemble the scene from scenes/scene_agentb.json and (optionally) render video cameras.
Assets are appended from their own .blend files (each stays an independent hierarchy under its root Empty),
placed by the instance transform and parented to category group Empties.
Usage:
  blender -b --factory-startup -P cg/blender/assemble_scene.py -- assemble [lod=research]          -> scenes/scene_agentb_<lod>.blend
  blender -b -P cg/blender/assemble_scene.py -- render <scene.blend> <outdir> <frames,comma> [spp] [scale]
"""
import bpy, sys, json, math, pathlib
import numpy as np
from mathutils import Matrix, Vector, Euler
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
B = pathlib.Path("/root/real2sim/scene-20261113/agent-b")
argv = sys.argv[sys.argv.index("--") + 1:]
CFG = json.load(open(B / "scenes/scene_agentb.json"))
LOOK = json.load(open(B / "cg/scene/look.json"))
def assemble(lod):
    bpy.ops.wm.read_factory_settings(use_empty=True); sc = bpy.context.scene
    import materials, render_setup  # noqa (materials ensures consistent ids)
    groups = {}
    for g in CFG["groups"]:
        e = bpy.data.objects.new(g["instance_id"], None); sc.collection.objects.link(e); groups[g["instance_id"]] = e
    cache = {}
    for it in CFG["instances"]:
        f = B / it["files"][f"{lod}_blend"]
        if not f.exists(): print("MISSING", f); continue
        if it["asset_id"] not in cache:
            with bpy.data.libraries.load(str(f), link=False) as (src, dst): dst.objects = src.objects
            objs = [o for o in dst.objects if o is not None]
            for o in objs: sc.collection.objects.link(o)
            root = next(o for o in objs if o.parent is None and o.name.startswith(it["asset_id"]))
            cache[it["asset_id"]] = root
        else:  # second instance of the same asset: linked duplicate of the hierarchy
            src_root = cache[it["asset_id"]]
            def dup(o, parent):
                n = o.copy(); sc.collection.objects.link(n); n.parent = parent
                for c in o.children: dup(c, n)
                return n
            root = dup(src_root, None)
        root.name = it["instance_id"]; root["agentb_asset_id"] = it["asset_id"]; root["agentb_instance_id"] = it["instance_id"]
        root.location = it["position"]; root.rotation_euler = [math.radians(a) for a in it["rotation_euler_deg"]]; root.scale = it["scale"]
        root.parent = groups.get(it["parent"])
    # lights
    lt = CFG["lighting"]; sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun)
    el, az = math.radians(lt["sun_elevation_deg"]), math.radians(lt["sun_azimuth_deg_ccw_from_x"])
    d = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    sun.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler(); sun.data.energy = 1.6; sun.data.angle = math.radians(12)  # soft: thin cloud
    sun.data.color = (1.0, 0.97, 0.92)
    render_setup.world_video_sky(sc, B / "assets/environment/sky_video_equirect.png", strength=LOOK["sky_strength"])
    sun.data.energy = LOOK["sun_strength"]
    out = B / f"scenes/scene_agentb_{lod}.blend"; bpy.ops.wm.save_as_mainfile(filepath=str(out), compress=True)
    print("ASSEMBLED", out, len(CFG["instances"]))
def set_cam(cam, fr):
    c = CFG["camera"]; info = next(x for x in CFG["cameras"] if x["frame"] == fr)
    Rc = np.array(info["R_c2w_colmap"]) @ np.diag([1, -1, -1])
    M = Matrix(np.eye(4));
    for i in range(3):
        for j in range(3): M[i][j] = Rc[i, j]
    M[0][3], M[1][3], M[2][3] = info["position"]; cam.matrix_world = M
    cam.data.sensor_fit = "HORIZONTAL"; cam.data.sensor_width = 36.0; cam.data.lens = c["fx"] / c["width"] * 36.0
    cam.data.shift_x = -(c["cx"] - c["width"] / 2) / c["width"]; cam.data.shift_y = (c["cy"] - c["height"] / 2) / c["width"]
    cam.data.clip_start = 0.1; cam.data.clip_end = 3000
def render(blend, outdir, frames, spp, scale):
    bpy.ops.wm.open_mainfile(filepath=blend); sc = bpy.context.scene
    import render_setup; render_setup.translucent_leaves()
    c = CFG["camera"]; render_setup.cycles(sc, spp, int(c["width"] * scale), int(c["height"] * scale))
    sc.view_settings.view_transform = LOOK["view_transform"]; sc.view_settings.look = "None"; sc.view_settings.exposure = LOOK["exposure"]
    sc.render.pixel_aspect_x = 1.0; sc.render.pixel_aspect_y = c["fx"] / c["fy"]
    cam = bpy.data.objects.get("agentb_cam") or bpy.data.objects.new("agentb_cam", bpy.data.cameras.new("agentb_cam"))
    if cam.name not in sc.collection.objects: sc.collection.objects.link(cam)
    sc.camera = cam; pathlib.Path(outdir).mkdir(parents=True, exist_ok=True)
    for fr in frames:
        set_cam(cam, fr); sc.render.filepath = str(pathlib.Path(outdir) / fr.replace(".jpg", ".png")); bpy.ops.render.render(write_still=True)
if argv[0] == "assemble": assemble(argv[1] if len(argv) > 1 else "research")
elif argv[0] == "render":
    frames = [f if f.endswith(".jpg") else f"{int(f):05d}.jpg" for f in argv[3].split(",")]
    render(argv[1], argv[2], frames, int(argv[4]) if len(argv) > 4 else 64, float(argv[5]) if len(argv) > 5 else 1.0)
