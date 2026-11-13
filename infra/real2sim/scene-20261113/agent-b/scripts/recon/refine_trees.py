"""Agent B (Opus 5.5) — refine tree detections: de-duplicate, silhouette-based height and crown width.
For every tree and every frame that sees it at 6–35 m: undistort the SAM3 label map, take the tree-label
pixels in a band around the projected trunk axis, find the top-most pixel connected to the trunk,
intersect its ray with the vertical trunk axis -> height sample; left/right silhouette extents at
mid-crown -> crown half-width sample.  Medians over views replace the depth-percentile estimates.
Usage: envs/da3/bin/python scripts/recon/refine_trees.py
"""
import json, pathlib, numpy as np, cv2, pycolmap
from PIL import Image
from scipy import ndimage
B = pathlib.Path("/root/real2sim/scene-20261113/agent-b"); L = B / "runs/layout"
trees = json.load(open(L / "trees_measured.json"))
# 1) de-duplicate
keep = []
for t in sorted(trees, key=lambda t: -t["n_points"]):
    if all(np.hypot(t["x"] - k["x"], t["y"] - k["y"]) > 1.8 for k in keep): keep.append(t)
trees = sorted(keep, key=lambda t: np.arctan2(t["y"] - 5, t["x"] - 150))
cams = np.load(L / "cams_world.npz"); CW, R = cams["C"], cams["R_c2w"]; names = cams["names"]
rd = pycolmap.Reconstruction(str(B / "runs/sfm_f3/0")); fx0, fy0, cx0, cy0, k1, k2, p1, p2 = list(rd.cameras.values())[0].params
W, H = 534, 941; fx, fy, cx, cy = 444.376, 431.548, 267.0, 470.5
uu, vv = np.meshgrid(np.arange(W) + .5, np.arange(H) + .5); x = (uu - cx) / fx; y = (vv - cy) / fy
r2 = x * x + y * y; rad = 1 + k1 * r2 + k2 * r2 * r2
mapx = (fx0 * (x * rad + 2 * p1 * x * y + p2 * (r2 + 2 * x * x)) + cx0 - .5).astype(np.float32)
mapy = (fy0 * (y * rad + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y) + cy0 - .5).astype(np.float32)
cache = {}
def labels(i):
    if i not in cache:
        cache[i] = cv2.remap(np.asarray(Image.open(B / "runs/seg_f3/labels" / names[i].replace(".jpg", ".png"))), mapx, mapy, cv2.INTER_NEAREST) == 7
    return cache[i]
def proj(i, X):
    Xc = (np.atleast_2d(X) - CW[i]) @ R[i]
    return np.stack([fx * Xc[:, 0] / Xc[:, 2] + cx, fy * Xc[:, 1] / Xc[:, 2] + cy], 1), Xc[:, 2]
for t in trees:
    base = np.array([t["x"], t["y"], t["ground_z"]]); hs, ws = [], []
    d = np.linalg.norm(CW[:, :2] - base[:2], axis=1)
    cand = np.nonzero((d > 6) & (d < 35))[0][::2]
    for i in cand:
        axis = base + np.outer(np.linspace(0, 25, 120), [0, 0, 1]); uv, z = proj(i, axis)
        if z[0] < 2 or not (5 < uv[0, 0] < W - 5 and 0 < uv[0, 1] < H + 200): continue
        M = labels(i); band = max(4, int(0.35 * fx / d[i]))
        top_row, last_ok = None, None
        rows = np.arange(min(H - 1, int(uv[0, 1])), -1, -1)
        if len(rows) == 0: continue
        ax_u = np.interp(rows, uv[::-1, 1], uv[::-1, 0])
        gap = 0
        for rr, au in zip(rows, ax_u):
            a, b = int(au - band), int(au + band)
            if b < 0 or a >= W: break
            if M[rr, max(a, 0):min(b, W)].any(): last_ok = rr; gap = 0
            else:
                gap += 1
                if last_ok is not None and gap > max(6, 0.08 * (uv[0, 1] - rr)): break
        if last_ok is None or last_ok <= 1: continue  # touches image top: unreliable
        # ray of (axis_u, last_ok) intersect vertical axis -> height
        k = np.argmin(np.abs(uv[:, 1] - last_ok)); hz = axis[k, 2] - base[2]
        if hz < 1.5: continue
        hs.append(hz)
        # crown half-width at 60% height
        midz = base + [0, 0, hz * 0.6]; um, zm = proj(i, midz); rr = int(um[0, 1])
        if 0 <= rr < H:
            row = M[rr]; c = int(um[0, 0]);
            if 0 <= c < W and row[c]:
                l = c;
                while l > 0 and row[l - 1]: l -= 1
                r_ = c
                while r_ < W - 1 and row[r_ + 1]: r_ += 1
                if l > 0 and r_ < W - 1: ws.append((r_ - l) / 2 / fx * zm[0])
    if len(hs) >= 3:
        t["height_depth_p98"] = t["height"]; t["height"] = round(float(np.median(hs)), 2); t["height_views"] = len(hs)
        t["height_mad"] = round(float(np.median(np.abs(np.array(hs) - np.median(hs)))), 2)
    if len(ws) >= 3: t["crown_halfwidth_silhouette"] = round(float(np.median(ws)), 2)
    # rescale crown profile vertically consistent with new height; horizontally to silhouette width when available
    if "crown_halfwidth_silhouette" in t:
        prof = np.array(t["crown_profile"]); s = t["crown_halfwidth_silhouette"] / max(np.median(prof), 0.3)
        t["crown_profile_scale"] = round(float(np.clip(s, 0.5, 1.6)), 3)
    t["crown_base"] = round(min(t["crown_base"], 0.45 * t["height"]), 2)
json.dump(trees, open(L / "trees_refined.json", "w"), indent=1)
print(len(trees), "trees"); print([(i, t["height"], t.get("height_depth_p98"), t.get("height_views"), t.get("crown_halfwidth_silhouette")) for i, t in enumerate(trees)])
