"""Agent B (Opus 5.5) — detect discrete objects (lamps, bins, planters, bikes) and far building massing
from the SAM3-labelled dense cloud.  Writes runs/layout/objects_measured.json and buildings_far_measured.json.
Evidence rule: occupancy cells (0.4 m for props, 2 m for buildings) supported by >= min_frames distinct frames.
"""
import json, pathlib, numpy as np
from scipy import ndimage
B = pathlib.Path("/root/real2sim/scene-20261113/agent-b"); L = B / "runs/layout"
D = np.load(L / "dense_world.npz"); P, C, Lb, F = D["xyz"], D["rgb"], D["cls"], D["frame"]
cams = np.load(L / "cams_world.npz"); CW = cams["C"]
rj = json.load(open(L / "raster.json")); zf = np.load(L / "ground_z.npy")
def gz(x, y):
    c = np.clip(((x - rj["x0"]) / rj["res"]).astype(int), 0, rj["nx"] - 1); r = np.clip(rj["ny"] - 1 - ((y - rj["y0"]) / rj["res"]).astype(int), 0, rj["ny"] - 1)
    return zf[r, c]
dc = np.linalg.norm(P - CW[F.astype(int) - 1], axis=1)
rot = json.load(open(L / "rotunda_measured.json"))
def clusters(mask, cell, min_frames, min_pts, maxdist):
    m = mask & (dc < maxdist); Q, QF, QC = P[m], F[m], C[m]
    if m.sum() < min_pts: return []
    x0, y0 = Q[:, 0].min() - cell, Q[:, 1].min() - cell
    ix = ((Q[:, 0] - x0) / cell).astype(int); iy = ((Q[:, 1] - y0) / cell).astype(int)
    nx, ny = ix.max() + 2, iy.max() + 2; cid = iy * nx + ix
    cnt = np.bincount(cid, minlength=nx * ny).reshape(ny, nx)
    # distinct frames per cell
    key = np.unique(np.c_[cid, QF], axis=0); fcount = np.bincount(key[:, 0], minlength=nx * ny).reshape(ny, nx)
    good = (cnt >= min_pts) & (fcount >= min_frames)
    lab, n = ndimage.label(ndimage.binary_dilation(good, iterations=1))
    out = []
    for k in range(1, n + 1):
        cells = (lab == k) & good
        if not cells.any(): continue
        sel = cells[iy, ix]
        out.append(dict(pts=Q[sel], cols=QC[sel], frames=np.unique(QF[sel]), cells=np.argwhere(cells), x0=x0, y0=y0, cell=cell))
    return out
objs = []
spec = {8: ("lamp", 3, 40, 40), 10: ("bin", 3, 25, 25), 12: ("planter", 3, 40, 30), 11: ("bike", 3, 30, 25)}
for c, (name, mf, mp, md) in spec.items():
    for cl in clusters(Lb == c, 0.4, mf, mp, md):
        Q = cl["pts"]; x, y = np.median(Q[:, 0]), np.median(Q[:, 1]); g = float(gz(np.array([x]), np.array([y]))[0])
        h = float(np.percentile(Q[:, 2], 98) - g); ext = np.ptp(Q[:, :2], 0)
        if name == "lamp" and (h < 2.0 or max(ext) > 3.0): continue
        objs.append(dict(type=name, x=round(float(x), 3), y=round(float(y), 3), ground_z=round(g, 3), height=round(h, 2), extent_xy=np.round(ext, 2).tolist(),
                         n_points=int(len(Q)), n_frames=int(len(cl["frames"])), color_srgb=np.median(cl["cols"], 0).round().tolist(),
                         frames=cl["frames"][::max(1, len(cl["frames"]) // 6)].tolist()))
# merge near-duplicates of same type
merged = []
for o in sorted(objs, key=lambda o: -o["n_points"]):
    if all(not (m["type"] == o["type"] and np.hypot(m["x"] - o["x"], m["y"] - o["y"]) < (1.5 if o["type"] == "lamp" else 1.0)) for m in merged): merged.append(o)
json.dump(merged, open(L / "objects_measured.json", "w"), indent=1)
print({t: sum(o["type"] == t for o in merged) for t in ("lamp", "bin", "planter", "bike")})
print("lamp heights", sorted(o["height"] for o in merged if o["type"] == "lamp"))
# ---- far buildings
bm = (Lb == 2) & (np.hypot(P[:, 0] - rot["center"][0], P[:, 1] - rot["center"][1]) > rot["outer_radius"] + 4)
far = []
for cl in clusters(bm, 2.0, 4, 30, 160):
    Q = cl["pts"]
    if len(cl["cells"]) < 3: continue
    g = float(np.median(gz(Q[:, 0], Q[:, 1])))
    far.append(dict(cells=cl["cells"].tolist(), x0=cl["x0"], y0=cl["y0"], cell=2.0, ground_z=round(g, 2),
                    height=round(float(np.percentile(Q[:, 2], 97) - g), 2), height_p50=round(float(np.percentile(Q[:, 2], 60) - g), 2),
                    color_srgb=np.median(cl["cols"], 0).round().tolist(), n_points=int(len(Q)), n_frames=int(len(cl["frames"])),
                    centroid=[float(np.median(Q[:, 0])), float(np.median(Q[:, 1]))], min_cam_dist=float(np.min(np.linalg.norm(CW[:, :2] - np.median(Q[:, :2], 0), axis=1)))))
json.dump(far, open(L / "buildings_far_measured.json", "w"), indent=1)
print("far building clusters", len(far), [(round(f["centroid"][0]), round(f["centroid"][1]), f["height"], len(f["cells"])) for f in far][:30])
