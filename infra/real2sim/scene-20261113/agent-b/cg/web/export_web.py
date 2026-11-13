"""Agent B (Opus 5.5) — export the web edition into the site checkout.
  assets/web/*.gltf (Blender web LOD) -> textures downscaled -> gltfpack (meshopt -cc, GPU instancing -mi,
  keep names/materials/extras) -> <site>/public/real2sim/scene-20261113/agent-b/assets/<asset_id>.glb
  + manifest.json (assets, instances in glTF Y-up, reference cameras, intrinsics, lighting, provenance)
  + refs/<frame>.jpg (undistorted video frames) + renders/<frame>.jpg (same-camera Cycles renders)
  + sky.jpg (video sky dome) + vendor/ (three r180 from the repo's node_modules)
Usage: envs/da3/bin/python cg/web/export_web.py [render_iter_tag]
"""
import json, sys, shutil, subprocess, pathlib, math, re, numpy as np
from PIL import Image
B = pathlib.Path(__file__).resolve().parents[2]
SITE = B / "repo/site"; OUT = SITE / "public/real2sim/scene-20261113/agent-b"
GLTFPACK = B / "envs/node/node_modules/.bin/gltfpack"
TAG = sys.argv[1] if len(sys.argv) > 1 else None
CFG = json.load(open(B / "scenes/scene_agentb.json"))
M = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)  # z-up world -> glTF y-up
def g(v): return (M @ np.asarray(v, float)).round(4).tolist()
for d in ("assets", "refs", "renders", "vendor/jsm/controls", "vendor/jsm/loaders", "vendor/jsm/utils", "vendor/jsm/libs"): (OUT / d).mkdir(parents=True, exist_ok=True)
# ---- vendor three
T = SITE / "node_modules/three"
for src, dst in [("build/three.module.js", "vendor/three.module.js"), ("build/three.core.js", "vendor/three.core.js"),
                 ("examples/jsm/controls/OrbitControls.js", "vendor/jsm/controls/OrbitControls.js"),
                 ("examples/jsm/loaders/GLTFLoader.js", "vendor/jsm/loaders/GLTFLoader.js"),
                 ("examples/jsm/utils/BufferGeometryUtils.js", "vendor/jsm/utils/BufferGeometryUtils.js"),
                 ("examples/jsm/libs/meshopt_decoder.module.js", "vendor/jsm/libs/meshopt_decoder.module.js")]:
    shutil.copy(T / src, OUT / dst)
for f in ("index.html", "viewer.js", "style.css"): shutil.copy(B / "web" / f, OUT / f)
# ---- textures: downscale shared web textures once
WT = B / "assets/web/textures"; WT2 = B / "runs/web_textures"; WT2.mkdir(parents=True, exist_ok=True); remap = {}
for p in WT.glob("*"):
    im = Image.open(p); has_a = im.mode in ("RGBA", "LA") and np.asarray(im.convert("RGBA"))[..., 3].min() < 250
    lim = 512 if re.match(r"(bark|leaf|twig)", p.name) else 1024
    if max(im.size) > lim: im.thumbnail((lim, lim), Image.LANCZOS)
    if has_a: name = p.stem + ".png"; im.save(WT2 / name, optimize=True)
    else: name = p.stem + ".jpg"; im.convert("RGB").save(WT2 / name, quality=86, optimize=True)
    remap[p.name] = name
# ---- per-asset packing
assets = {}; sizes = {}
def meta_of(aid):
    for cat in ("trees", "ground", "buildings", "props"):
        j = B / "assets" / cat / aid / f"{aid}_web.json"
        if j.exists(): return cat, json.load(open(j))
    return None, {}
for gl in sorted((B / "assets/web").glob("*.gltf")):
    aid = gl.stem; doc = json.load(open(gl))
    for im in doc.get("images", []):
        n = pathlib.Path(im["uri"]).name
        if n in remap: im["uri"] = "../../runs/web_textures/" + remap[n]; im["mimeType"] = "image/png" if remap[n].endswith(".png") else "image/jpeg"
    tmp = B / "runs/web_tmp"; tmp.mkdir(exist_ok=True); shutil.copy(gl.with_suffix(".bin"), tmp / gl.with_suffix(".bin").name)
    for im in doc.get("images", []):           # gltfpack needs relative URIs: textures next to the temp glTF
        n = pathlib.Path(im["uri"]).name; shutil.copy(WT2 / n, tmp / n); im["uri"] = n
    tg = tmp / gl.name; json.dump(doc, open(tg, "w"))
    out = OUT / "assets" / f"{aid}.glb"
    r = subprocess.run([str(GLTFPACK), "-i", str(tg), "-o", str(out), "-cc", "-kn", "-km", "-ke", "-mi"], capture_output=True, text=True)
    if r.returncode: print("gltfpack failed", aid, r.stderr[-300:]); continue
    sizes[aid] = out.stat().st_size
    cat, mj = meta_of(aid)
    facts = []
    if mj.get("category") == "tree":
        m = mj["measured"]; facts = [["实测树高", f"{m['height_m']} m（{m['height_source']}）"], ["物种/习性（推断）", mj["species_label"]],
                                     ["生成", f"seed {mj['params']['seed']} · 节点 {mj['stats']['nodes']} · 叶卡 {mj['stats']['leaves']}"], ["参考帧", m.get("ref_frame")]]
    elif mj.get("category") == "building" and "measured" in mj: facts = [[k, str(v)] for k, v in mj["measured"].items()]
    elif mj.get("category") == "ground": facts = [["面积", f"{mj.get('area_m2')} m²"], ["材质", mj.get("material")]]
    elif mj.get("category") == "prop": facts = [[k, str(mj[k])] for k in ("height_m", "dims_note") if k in mj]
    rf = [f"assets/{cat}/{aid}/{aid}_research.blend", f"assets/{cat}/{aid}/{aid}_research.glb", f"assets/{cat}/{aid}/{aid}_research.json"] if cat else []
    assets[aid] = dict(file=f"assets/{aid}.glb", bytes=sizes[aid], category=mj.get("category"), label=mj.get("species_label") or mj.get("kind") or mj.get("lod_note") or aid,
                       short=mj.get("species_preset") or mj.get("kind") or mj.get("category"), pivot=mj.get("pivot"), provenance=mj.get("provenance") or mj.get("generator"),
                       inferred=mj.get("inferred") if isinstance(mj.get("inferred"), list) else ([mj["note"]] if mj.get("note") else []), facts=facts,
                       research_files=[f"server:/root/real2sim/scene-20261113/agent-b/{x}" for x in rf], generator=mj.get("generator"))
# ---- instances
cats = [dict(id="ground", label="地面/道路"), dict(id="building", label="建筑"), dict(id="tree", label="树木"), dict(id="prop", label="设施")]
insts = []
for it in CFG["instances"]:
    if it["asset_id"] not in assets: continue
    rz = it["rotation_euler_deg"]
    insts.append(dict(instance_id=it["instance_id"], asset_id=it["asset_id"], category=it["category"], parent=it["parent"], position_gltf=g(it["position"]),
                      rotation_gltf_euler_deg=[rz[0], rz[2], -rz[1]], scale=[it["scale"][0], it["scale"][2], it["scale"][1]]))
# ---- reference views
# reference views = exactly the frames rendered in the chosen comparison iteration (so every view has a same-camera CG render)
fr_list = sorted(p.stem + ".jpg" for p in (B / f"renders/compare/{TAG}/cg").glob("*.png")) if TAG else [c["frame"] for c in CFG["cameras"]][9::36]
views = []
for c in CFG["cameras"]:
    if c["frame"] not in fr_list: continue
    stem = c["frame"].replace(".jpg", "")
    Image.open(B / "runs/undist/images" / c["frame"]).convert("RGB").save(OUT / "refs" / f"{stem}.jpg", quality=84)
    Rb = np.array(c["R_c2w_colmap"]) @ np.diag([1, -1, -1]); Rg = M @ Rb
    w = math.sqrt(max(0, 1 + Rg[0, 0] + Rg[1, 1] + Rg[2, 2])) / 2; x = (Rg[2, 1] - Rg[1, 2]) / (4 * w); y = (Rg[0, 2] - Rg[2, 0]) / (4 * w); z = (Rg[1, 0] - Rg[0, 1]) / (4 * w)
    v = dict(frame=stem, image=f"refs/{stem}.jpg", position_gltf=g(c["position"]), quaternion_gltf=[round(x, 6), round(y, 6), round(z, 6), round(w, 6)])
    if TAG and (B / f"renders/compare/{TAG}/cg/{stem}.png").exists():
        Image.open(B / f"renders/compare/{TAG}/cg/{stem}.png").convert("RGB").save(OUT / "renders" / f"{stem}.jpg", quality=84); v["cg_render"] = f"renders/{stem}.jpg"
    views.append(v)
Image.open(B / "assets/environment/sky_video_equirect_web.jpg").save(OUT / "sky.jpg", quality=86)
K = CFG["camera"]; lt = CFG["lighting"]
el, az = math.radians(lt["sun_elevation_deg"]), math.radians(lt["sun_azimuth_deg_ccw_from_x"])
man = dict(schema="agentb-scene-manifest/1", agent="agent-b", agent_label="Agent B · Claude Opus 5.5", model="claude-opus-5-5",
           scene_id=CFG["scene_id"], status="ready", version=json.load(open(B / "cg/VERSION.json"))["version"],
           source_video=CFG["source_video"], coordinate_frame=dict(CFG["frame"], web_axes="glTF Y-up: x_gltf=x, y_gltf=z, z_gltf=-y (source Z-up)"),
           camera_intrinsics=dict(width=K["width"], height=K["height"], fx=K["fx"], fy=K["fy"], cx=K["cx"], cy=K["cy"], vfov_deg=round(math.degrees(2 * math.atan(K["height"] / 2 / K["fy"])), 3), solver=K["solver"]),
           lighting=dict(sky_image="sky.jpg", sun_dir_gltf=g([math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)]), sun_intensity=1.6, env_intensity=1.0, web_exposure=1.0,
                         method=lt["method"]),
           scene_center_gltf=g([150, 0, 0]), categories=cats, assets=assets, instances=insts, reference_views=views,
           totals=dict(assets=len(assets), instances=len(insts), bytes=int(sum(sizes.values()))),
           notes=["Scale is estimated (camera height + crosswalk), about +-5 %.", "Species are visual inferences, not botanical identification.",
                  "Branching, leaves and bark are generated by code; positions, heights, crown envelopes and colours are measured from the video.",
                  "Unobserved areas (inner lawn, far road half, building backs, rotunda far side) are conservatively inferred and flagged per asset.",
                  "Web edition uses twig-card foliage (LOD); research edition (individual leaves, .blend sources) stays on the server."])
json.dump(man, open(OUT / "manifest.json", "w"), indent=1, ensure_ascii=False)
json.dump(dict(scene_id=CFG["scene_id"], groups=CFG["groups"], instances=CFG["instances"], frame=CFG["frame"]), open(OUT / "scene.json", "w"), indent=1, ensure_ascii=False)
tot = sum(sizes.values()) + sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file() and "assets" not in f.parts)
print("exported", len(assets), "assets", len(insts), "instances; asset bytes %.1f MB; total %.1f MB" % (sum(sizes.values()) / 1e6, tot / 1e6))
big = sorted(sizes.items(), key=lambda kv: -kv[1])[:5]; print("largest", [(k, round(v / 1e6, 2)) for k, v in big])
