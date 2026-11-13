"""Agent B (Opus 5.5) — gravity/scale alignment of the SfM model + labelled 3D points.
Ground plane from SAM3 ground-labelled points (RANSAC); scale from assumed handheld camera height
(CAM_H metres, an ESTIMATE, cross-checked later against DA3 metric depth and road markings).
Writes runs/layout/world.json, points_world.npz, cams_world.npz, topdown.png
"""
import json, pathlib, sys, numpy as np, pycolmap
from PIL import Image
B = pathlib.Path("/root/real2sim/scene-20261113/agent-b")
CAM_H = float(sys.argv[1]) if len(sys.argv) > 1 else 1.45
rec = pycolmap.Reconstruction(str(B / "runs/sfm_f3/0"))
out = B / "runs/layout"; out.mkdir(parents=True, exist_ok=True)
labs = {}
def lab(name):
    if name not in labs: labs[name] = np.asarray(Image.open(B / "runs/seg_f3/labels" / name.replace(".jpg", ".png")))
    return labs[name]
pid, xyz, rgb, cls = [], [], [], []
for p3id, p in rec.points3D.items():
    votes = np.zeros(13, int)
    for el in p.track.elements:
        im = rec.images[el.image_id]; uv = im.points2D[el.point2D_idx].xy
        L = lab(im.name); x, y = int(min(max(uv[0], 0), L.shape[1] - 1)), int(min(max(uv[1], 0), L.shape[0] - 1))
        votes[L[y, x]] += 1
    pid.append(p3id); xyz.append(p.xyz); rgb.append(p.color); cls.append(votes.argmax())
xyz, rgb, cls = np.array(xyz), np.array(rgb), np.array(cls)
C = np.array([im.projection_center() for im in sorted(rec.images.values(), key=lambda i: i.name)])
names = [im.name for im in sorted(rec.images.values(), key=lambda i: i.name)]
R_c2w = np.array([im.cam_from_world().rotation.matrix().T for im in sorted(rec.images.values(), key=lambda i: i.name)])
g = xyz[np.isin(cls, [3, 4, 5, 6])]
rng = np.random.default_rng(0); best = None
for _ in range(3000):
    s = g[rng.choice(len(g), 3, replace=False)]; n = np.cross(s[1] - s[0], s[2] - s[0])
    if np.linalg.norm(n) < 1e-9: continue
    n /= np.linalg.norm(n); d = -n @ s[0]
    thr = 0.01 * np.ptp(C, 0).max(); inl = np.abs(g @ n + d) < thr
    if best is None or inl.sum() > best[0]: best = (inl.sum(), n, d, inl)
_, n, d, inl = best
G = g[inl]; c0 = G.mean(0); _, _, vt = np.linalg.svd(G - c0); n = vt[2]; d = -n @ c0
# camera "up" (-y in image) should agree with n
upcam = -R_c2w[:, :, 1].mean(0)
if n @ upcam < 0: n, d = -n, -d
h = C @ n + d; scale = CAM_H / np.median(h)
# axes: z=up, x = principal direction of trajectory projected
P = C - np.outer(C @ n + d, n); _, _, vt2 = np.linalg.svd(P - P.mean(0)); x = vt2[0] - (vt2[0] @ n) * n; x /= np.linalg.norm(x); y = np.cross(n, x)
Rw = np.stack([x, y, n]); o = P[0]
def tw(X): return (X - o) @ Rw.T * scale
W = tw(xyz); CW = tw(C)
json.dump(dict(R=Rw.tolist(), origin=o.tolist(), scale=float(scale), cam_height_assumed_m=CAM_H, plane_inlier_ratio=float(inl.mean()),
               ground_resid_m=float(np.std(G @ n + d) * scale), cam_height_spread_m=float(np.std(h) * scale), note="scale is an ESTIMATE from assumed camera height"),
          open(out / "world.json", "w"), indent=1)
np.savez_compressed(out / "points_world.npz", xyz=W, rgb=rgb, cls=cls, pid=np.array(pid))
np.savez_compressed(out / "cams_world.npz", C=CW, R_c2w=np.einsum("ij,njk->nik", Rw, R_c2w), names=np.array(names))
print("scale", scale, "ground resid m", np.std(G @ n + d) * scale, "cam h spread", np.std(h) * scale, "extent", np.ptp(W, 0))
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
PAL = np.array([[0,0,0],[120,180,255],[200,60,200],[60,200,60],[170,170,170],[60,60,60],[255,160,0],[0,110,0],[230,200,0],[255,0,0],[0,200,255],[255,120,200],[140,90,40]]) / 255
fig, ax = plt.subplots(figsize=(16, 16)); m = (np.abs(W[:, 2]) < 60) & (cls != 1)
ax.scatter(W[m, 0], W[m, 1], s=0.4, c=PAL[cls[m]]); ax.plot(CW[:, 0], CW[:, 1], "r-", lw=1)
for i in range(0, len(CW), 30): ax.text(CW[i, 0], CW[i, 1], names[i][:5], fontsize=7)
ax.set_aspect("equal"); lim = np.percentile(np.abs(W[m, :2]), 98) ; ax.grid(True, alpha=.3)
fig.savefig(out / "topdown.png", dpi=110, bbox_inches="tight")
