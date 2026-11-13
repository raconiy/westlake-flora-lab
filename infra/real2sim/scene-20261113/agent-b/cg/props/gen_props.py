"""Agent B (Opus 5.5) — street furniture assets (parametric) + their measured placements.
Shared assets (one editable source each, many instances in the scene config):
  prop_lamp_lawn   cone-head lawn lamp (h ~3.6 m measured: median of 41 detections)
  prop_lamp_street tall street lamp (h ~6.4 m measured, 1 detection)
  prop_bin         blue litter bin pair (dimensions estimated from frames)
  prop_planter     concrete planter with clipped shrubs (plaza; dimensions estimated)
Placements: runs/layout/objects_measured.json (SAM3 'street lamp pole' / 'trash can' / 'planter box' points,
>= 3 frames per 0.4 m cell).  Orientation of bins/planters: aligned to the ring tangent (inferred).
Usage: envs/da3/bin/python cg/props/gen_props.py
"""
import json, sys, math, pathlib, numpy as np
HERE = pathlib.Path(__file__).resolve().parent; sys.path.insert(0, str(HERE.parent))
from common.meshio import Part, save_parts, box
B = HERE.parents[1]; L = B / "runs/layout"; OUT = B / "assets/props"; OUT.mkdir(parents=True, exist_ok=True)
G = json.load(open(HERE.parent / "ground/ground_config.json")); RC = np.array(G["ring_center"])
OBJ = json.load(open(L / "objects_measured.json"))
def lathe(part, prof, seg=24, uvs=1.0):
    """surface of revolution around Z from profile [(r,z),...]"""
    V, UV, F = [], [], []; n = len(prof)
    for i, (r, z) in enumerate(prof):
        for j in range(seg + 1):
            t = 2 * math.pi * j / seg; V.append((r * math.cos(t), r * math.sin(t), z)); UV.append((j / seg * uvs, z))
    for i in range(n - 1):
        for j in range(seg):
            a = i * (seg + 1) + j; b = a + seg + 1; F += [(a, a + 1, b + 1), (a, b + 1, b)]
    part.add(V, F, UV)
def lamp_lawn(h):
    pole = Part("pole", "metal_light"); lathe(pole, [(0.11, 0), (0.11, 0.25), (0.065, 0.3), (0.055, h - 0.42), (0.04, h - 0.38)], 20)
    head = Part("head", "metal_light"); lathe(head, [(0.04, h - 0.4), (0.26, h - 0.08), (0.27, h - 0.04), (0.0, h - 0.02)], 32)
    lens = Part("diffuser", "emissive_lamp"); lathe(lens, [(0.0, h - 0.09), (0.255, h - 0.085)], 32)
    return [(pole, None, (0, 0, 0)), (head, None, (0, 0, 0)), (lens, None, (0, 0, 0))]
def lamp_street(h):
    pole = Part("pole", "metal_light"); lathe(pole, [(0.14, 0), (0.12, 0.6), (0.075, h - 0.2), (0.06, h)], 20)
    arm = Part("arm", "metal_light"); V, F, UV = box(0.6, 0, h - 0.15, 1.2, 0.08, 0.08); arm.add(V, F, UV)
    head = Part("head", "metal_light"); V, F, UV = box(1.25, 0, h - 0.2, 0.7, 0.3, 0.12); head.add(V, F, UV)
    return [(pole, None, (0, 0, 0)), (arm, None, (0, 0, 0)), (head, None, (0, 0, 0))]
def bin_pair():
    body = Part("bins", "bin_blue"); lid = Part("lids", "plastic_dark")
    for dx in (-0.3, 0.3):
        V, F, UV = box(dx, 0, 0.45, 0.5, 0.45, 0.9); body.add(V, F, UV); V, F, UV = box(dx, 0, 0.93, 0.54, 0.49, 0.06); lid.add(V, F, UV)
    return [(body, None, (0, 0, 0)), (lid, None, (0, 0, 0))]
def planter(seed):
    r = np.random.default_rng(seed)
    bx = Part("box", "planter_grey"); V, F, UV = box(0, 0, 0.3, 1.8, 0.8, 0.6); bx.add(V, F, UV)
    sh = Part("shrubs", "shrub")
    for k in range(9):  # clipped shrub lumps (low-poly spheres)
        cx, cy = r.uniform(-0.7, 0.7), r.uniform(-0.25, 0.25); rr = r.uniform(0.18, 0.3)
        prof = [(rr * math.sin(a), 0.6 + rr * 0.8 * (1 - math.cos(a))) for a in np.linspace(0, math.pi, 7)]
        lathe(sh, prof, 10); sh.V[-1] = sh.V[-1] + [cx, cy, 0]
    return [(bx, None, (0, 0, 0)), (sh, None, (0, 0, 0))]
lamps = [o for o in OBJ if o["type"] == "lamp"]; lawn_h = float(np.median([o["height"] for o in lamps if o["height"] < 5])) if lamps else 3.6
st = [o for o in lamps if o["height"] >= 5]; st_h = float(np.median([o["height"] for o in st])) if st else 6.5
defs = {"prop_lamp_lawn": (lamp_lawn(lawn_h), dict(height_m=round(lawn_h, 2), height_source="median of detections")),
        "prop_lamp_street": (lamp_street(st_h), dict(height_m=round(st_h, 2))),
        "prop_bin": (bin_pair(), dict(dims_note="0.5x0.45x0.9 m each, estimated")),
        "prop_planter": (planter(7), dict(dims_note="1.8x0.8x0.6 m box, estimated"))}
for aid, (parts, extra) in defs.items():
    d = OUT / aid; d.mkdir(exist_ok=True)
    meta = dict(asset_id=aid, category="prop", generator="cg/props/gen_props.py", pivot="ground contact centre, +Z up, metres", **extra)
    for lod in ("research", "web"): save_parts(d / f"{aid}_{lod}", parts, dict(meta, lod=lod))
idx = []; counts = {}
for o in OBJ:
    aid = {"lamp": "prop_lamp_street" if o["height"] >= 5 else "prop_lamp_lawn", "bin": "prop_bin", "planter": "prop_planter"}.get(o["type"])
    if aid is None: continue
    counts[aid] = counts.get(aid, 0) + 1
    tang = math.degrees(math.atan2(o["y"] - RC[1], o["x"] - RC[0])) + 90
    idx.append(dict(instance_id=f"inst_{aid}_{counts[aid]:02d}", asset_id=aid, position=[o["x"], o["y"], o["ground_z"]], rot_z_deg=round(tang, 1) if o["type"] != "lamp" else 0.0,
                    evidence=dict(n_frames=o["n_frames"], n_points=o["n_points"], measured_height=o["height"], sample_frames=o["frames"])))
json.dump(idx, open(OUT / "props_index.json", "w"), indent=1)
print(counts)
