"""Agent B (Opus 5.5) — write the scene assembly configuration (instances, transforms, hierarchy, cameras, light).
Inputs: asset indexes written by the generators. Output: scenes/scene_agentb.json
Every instance: instance_id, asset_id, category, parent, position [m], rotation_euler_deg [XYZ], scale, files.
Usage: envs/da3/bin/python cg/scene/make_scene_config.py
"""
import json, pathlib, numpy as np
B = pathlib.Path(__file__).resolve().parents[2]; A = B / "assets"
W = json.load(open(B / "runs/layout/world.json")); cams = np.load(B / "runs/layout/cams_world.npz")
def files(cat, aid):
    d = f"assets/{cat}/{aid}"
    return dict(research_blend=f"{d}/{aid}_research.blend", research_glb=f"{d}/{aid}_research.glb", web_blend=f"{d}/{aid}_web.blend",
                web_gltf=f"assets/web/{aid}.gltf", source_json=f"{d}/{aid}_research.json")
inst = []
groups = [dict(instance_id=g, asset_id=None, category="group", parent=None, position=[0, 0, 0], rotation_euler_deg=[0, 0, 0], scale=[1, 1, 1])
          for g in ("grp_ground", "grp_buildings", "grp_trees", "grp_props")]
for g in json.load(open(A / "ground/ground_index.json")):
    inst.append(dict(instance_id=f"inst_{g['asset_id']}", asset_id=g["asset_id"], category="ground", parent="grp_ground",
                     position=g["pivot"], rotation_euler_deg=[0, 0, 0], scale=[1, 1, 1], files=files("ground", g["asset_id"])))
for bi in sorted((A / "buildings").glob("*/")):
    j = json.load(open(next(bi.glob("*_research.json"))))
    inst.append(dict(instance_id=f"inst_{j['asset_id']}", asset_id=j["asset_id"], category="building", parent="grp_buildings",
                     position=j["world_pivot"], rotation_euler_deg=[0, 0, j.get("world_rotation_z_deg", 0)], scale=[1, 1, 1], files=files("buildings", j["asset_id"])))
for t in json.load(open(A / "trees/trees_index.json")):
    inst.append(dict(instance_id=f"inst_{t['asset_id']}", asset_id=t["asset_id"], category="tree", parent="grp_trees",
                     position=[t["x"], t["y"], t["z"]], rotation_euler_deg=[0, 0, 0], scale=[1, 1, 1], files=files("trees", t["asset_id"]),
                     species_preset=t["species"], height_m=t["height"]))
pi = A / "props/props_index.json"
if pi.exists():
    for p in json.load(open(pi)):
        inst.append(dict(instance_id=p["instance_id"], asset_id=p["asset_id"], category="prop", parent="grp_props",
                         position=p["position"], rotation_euler_deg=[0, 0, p.get("rot_z_deg", 0)], scale=[1, 1, 1], files=files("props", p["asset_id"]),
                         evidence=p.get("evidence")))
names = [str(n) for n in cams["names"]]
cfg = dict(scene_id="real2sim/scene-20261113/agent-b", author="Agent B — Claude Opus 5.5 (claude-opus-5-5)",
           source_video=dict(path="/root/real2sim/scene-20261113/inputs/6e5f0026.../video.mp4",
                             sha256="6e5f00262487a188cd7673340a61fbcd581644d800090dc1050cd7e962275248", resolution=[544, 960], fps=30, duration_s=286.3),
           frame=dict(units="metre", up="+Z", handedness="right", origin="ground under the first video camera (approx.)",
                      scale=dict(method="assumed hand-held camera height 1.51 m, checked against crosswalk stripe period (~1.0 m, GB 5768.3)",
                                 uncertainty="about +-5 %", note="DA3 metric depth suggested +23 %, rejected (inconsistent with road markings)"),
                      gltf_note="web/GLB exports are Y-up (glTF convention): x_gltf = x, y_gltf = z, z_gltf = -y"),
           lighting=dict(sun_elevation_deg=36.6, sun_azimuth_deg_ccw_from_x=54.6, sky="thin high overcast; sun disc visible through cloud",
                         method="sun direction triangulated from the saturated sun blob in 13 frames"),
           camera=dict(model="PINHOLE (undistorted)", width=534, height=941, fx=444.376, fy=431.548, cx=267.0, cy=470.5,
                       solver="pycolmap 4.2 incremental SfM, 859/859 frames registered, 0.54 px mean reprojection error"),
           groups=groups, instances=inst,
           cameras=[dict(frame=n, position=cams["C"][i].round(4).tolist(), R_c2w_colmap=cams["R_c2w"][i].round(6).tolist()) for i, n in enumerate(names)])
(B / "scenes").mkdir(exist_ok=True); json.dump(cfg, open(B / "scenes/scene_agentb.json", "w"), indent=1, ensure_ascii=False)
print(len(inst), "instances;", {c: sum(i["category"] == c for i in inst) for c in ("ground", "building", "tree", "prop")})
