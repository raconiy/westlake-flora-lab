"""Agent B (Opus 5.5) — measure per-class colour statistics from the video (median sRGB of SAM3-labelled pixels)
and render a high-resolution local orthophoto patch for paving slab measurement.
Usage: envs/da3/bin/python scripts/recon/measure_materials.py
Writes runs/layout/class_colors.json, runs/layout/ortho_patch_<frame>.png
"""
import json, pathlib, numpy as np
from PIL import Image
B = pathlib.Path("/root/real2sim/scene-20261113/agent-b"); L = B / "runs/layout"
names = {1: "sky", 2: "building", 3: "grass", 4: "paving", 5: "road", 6: "curb", 7: "tree", 8: "lamp", 10: "bin"}
acc = {k: [] for k in names}
rng = np.random.default_rng(0)
for f in sorted((B / "frames/f3").glob("*.jpg"))[::6]:
    im = np.asarray(Image.open(f).convert("RGB")); lab = np.asarray(Image.open(B / "runs/seg_f3/labels" / (f.stem + ".png")))
    for k in names:
        m = np.argwhere(lab == k)
        if len(m) > 50:
            s = m[rng.choice(len(m), min(400, len(m)), replace=False)]; acc[k].append(im[s[:, 0], s[:, 1]])
out = {}
for k, n in names.items():
    if not acc[k]: continue
    a = np.concatenate(acc[k]).astype(np.float32)
    out[n] = dict(median=np.median(a, 0).round(1).tolist(), p10=np.percentile(a, 10, 0).round(1).tolist(), p90=np.percentile(a, 90, 0).round(1).tolist(), n=int(len(a)))
json.dump(out, open(L / "class_colors.json", "w"), indent=1)
print(json.dumps({k: v["median"] for k, v in out.items()}))

# local 2 cm orthophoto patches around selected cameras (ground points from that frame and neighbours)
D = np.load(L / "dense_world.npz"); P, C, Lb, F = D["xyz"], D["rgb"], D["cls"], D["frame"]
cams = np.load(L / "cams_world.npz"); CW = cams["C"]
for fr in [150, 300, 450, 820]:
    sel = (np.abs(F.astype(int) - fr) <= 3) & np.isin(Lb, [3, 4, 5, 6])
    c = CW[fr - 1]; Q = P[sel]; QC = C[sel]
    d = np.hypot(Q[:, 0] - c[0], Q[:, 1] - c[1]); m = d < 7; Q, QC = Q[m], QC[m]
    res = 0.02; x0, y0 = c[0] - 7, c[1] - 7; n = int(14 / res)
    ix = ((Q[:, 0] - x0) / res).astype(int); iy = ((Q[:, 1] - y0) / res).astype(int)
    img = np.zeros((n, n, 3), np.float32); cnt = np.zeros((n, n))
    np.add.at(img, (iy, ix), QC); np.add.at(cnt, (iy, ix), 1)
    img = (img / np.maximum(cnt, 1)[..., None]).astype(np.uint8)[::-1]
    Image.fromarray(img).save(L / f"ortho_patch_{fr}.png")
