"""Agent B (Opus 5.5) — individual tree extraction from the labelled dense cloud.
1. ground height field from the top-down raster (median ground z, hole-filled)
2. trunk candidates: tree-labelled points 0.3–2.2 m above ground -> 2D density peaks (0.25 m grid)
3. crown points (tree label, > 1.5 m above ground) assigned to nearest trunk in XY (max 9 m)
4. per tree: root collar position, height (p98), crown base (p3 of crown pts), azimuth x height crown radius
   profile (p90 radial distance per bin), crown offset, colour palette (k-means of crown pixel colours),
   whitewash detection (bright trunk pixels near ground), frames that observe it.
Writes runs/layout/trees_measured.json, ground_z.npy (+ debug topdown).
"""
import json, pathlib, numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
B = pathlib.Path("/root/real2sim/scene-20261113/agent-b"); L = B / "runs/layout"
rj = json.load(open(L / "raster.json")); z = np.load(L / "raster_z.npy")
# hole-fill the ground height (nearest valid, then smooth)
valid = np.isfinite(z); idx = ndimage.distance_transform_edt(~valid, return_distances=False, return_indices=True)
zf = z[tuple(idx)]; zf = ndimage.median_filter(zf, 9); zf = ndimage.gaussian_filter(zf, 6)
np.save(L / "ground_z.npy", zf.astype(np.float32))
def gz(x, y):
    c = np.clip(((x - rj["x0"]) / rj["res"]).astype(int), 0, rj["nx"] - 1); r = np.clip(rj["ny"] - 1 - ((y - rj["y0"]) / rj["res"]).astype(int), 0, rj["ny"] - 1)
    return zf[r, c]
D = np.load(L / "dense_world.npz"); P, C, Lb, F = D["xyz"], D["rgb"], D["cls"], D["frame"]
cams = np.load(L / "cams_world.npz"); CW = cams["C"]
t = Lb == 7; P, C, F = P[t], C[t], F[t]
# only points reasonably near their camera (dense depth less reliable far away)
dc = np.linalg.norm(P - CW[F.astype(int) - 1], axis=1); m = dc < 45; P, C, F, dc = P[m], C[m], F[m], dc[m]
h = P[:, 2] - gz(P[:, 0], P[:, 1])
# --- trunks
tr = (h > 0.3) & (h < 2.2) & (dc < 25)
res = 0.25; x0, y0 = P[:, 0].min(), P[:, 1].min()
gi = ((P[tr, 0] - x0) / res).astype(int); gj = ((P[tr, 1] - y0) / res).astype(int)
H = np.zeros((gi.max() + 3, gj.max() + 3)); np.add.at(H, (gi, gj), 1.0 / np.maximum(dc[tr], 3) ** 0)
# count distinct frames supporting each cell (robust against single-view streaks)
Hs = ndimage.gaussian_filter(H, 1.2)
pk = (Hs == ndimage.maximum_filter(Hs, size=int(2.2 / res))) & (Hs > np.percentile(Hs[Hs > 0], 80)) & (Hs > 3)
pi, pj = np.nonzero(pk); T = np.stack([x0 + (pi + .5) * res, y0 + (pj + .5) * res], 1)
# --- crowns
cr = h > 1.2
kd = cKDTree(T); dd, ass = kd.query(P[cr, :2], distance_upper_bound=9.0)
trees = []
rng = np.random.default_rng(0)
for k, (tx, ty) in enumerate(T):
    sel = np.nonzero(cr)[0][ass == k]
    if len(sel) < 400: continue
    Q = P[sel]; QC = C[sel].astype(np.float32); hq = h[sel]; fr = F[sel]
    gzz = float(gz(np.array([tx]), np.array([ty]))[0])
    # robust height & base
    H98 = float(np.percentile(hq, 98.5)); base = float(np.percentile(hq, 4))
    nfr = len(np.unique(fr))
    if H98 < 2.0 or nfr < 6: continue
    # refine trunk xy: median of low tree points within 1.2 m
    lowm = tr & (np.hypot(P[:, 0] - tx, P[:, 1] - ty) < 1.2)
    if lowm.sum() > 30: tx, ty = np.median(P[lowm, 0]), np.median(P[lowm, 1])
    dx, dy = Q[:, 0] - tx, Q[:, 1] - ty; rr = np.hypot(dx, dy); az = np.arctan2(dy, dx) % (2 * np.pi)
    nz, na = 7, 12
    zb = np.linspace(base, H98, nz + 1); prof = np.zeros((nz, na))
    for i in range(nz):
        for j in range(na):
            mm = (hq >= zb[i]) & (hq < zb[i + 1]) & (az >= j * 2 * np.pi / na) & (az < (j + 1) * 2 * np.pi / na)
            prof[i, j] = np.percentile(rr[mm], 90) if mm.sum() > 15 else np.nan
    # fill missing bins (unobserved sides): per-row median then global smoothing -> flagged as inferred
    inferred = np.isnan(prof)
    for i in range(nz):
        row = prof[i]; row[np.isnan(row)] = np.nanmedian(row) if np.isfinite(row).any() else np.nan
    prof[np.isnan(prof)] = np.nanmedian(prof)
    prof = ndimage.uniform_filter(np.pad(prof, ((0, 0), (1, 1)), mode="wrap"), size=(1, 3))[:, 1:-1]
    prof[0] *= 0.75  # crown base tapers; top row towards apex
    # colour palette (k-means, 5 clusters) of crown points in sRGB
    s = QC[rng.choice(len(QC), min(6000, len(QC)), replace=False)]
    cent = s[rng.choice(len(s), 5, replace=False)]
    for _ in range(15):
        lab = np.argmin(((s[:, None] - cent[None]) ** 2).sum(2), 1)
        cent = np.array([s[lab == q].mean(0) if (lab == q).any() else cent[q] for q in range(5)])
    w = np.bincount(lab, minlength=5) / len(lab)
    # remove sky-like (bright bluish) clusters leaking through crown masks
    keepc = ~((cent[:, 2] > cent[:, 1] + 8) & (cent.mean(1) > 150))
    # whitewash: bright, low saturation trunk points 0.3–1.3 m
    tw = lowm & (h > 0.3) & (h < 1.3) & (np.hypot(P[:, 0] - tx, P[:, 1] - ty) < 0.6)
    white = bool(tw.sum() > 20 and np.median(C[tw].astype(float).mean(1)) > 165)
    trees.append(dict(x=float(tx), y=float(ty), ground_z=gzz, height=round(H98, 2), crown_base=round(max(base, 0.8), 2),
                      crown_profile=np.round(prof, 2).tolist(), crown_profile_inferred_bins=int(inferred.sum()),
                      palette_srgb=np.round(cent[keepc]).tolist(), palette_w=np.round(w[keepc] / w[keepc].sum(), 3).tolist(),
                      whitewash=white, n_points=int(len(sel)), n_frames=int(nfr), frames=sorted(set(int(f) for f in np.unique(fr)))[::5]))
trees.sort(key=lambda t: np.arctan2(t["y"] - 5, t["x"] - 150))
json.dump(trees, open(L / "trees_measured.json", "w"), indent=1)
print(len(trees), "trees;", "heights", sorted(round(t["height"], 1) for t in trees))
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(16, 14)); img = np.load(L / "raster_cls.npy")
ext = [rj["x0"], rj["x0"] + rj["nx"] * rj["res"], rj["y0"], rj["y0"] + rj["ny"] * rj["res"]]
PAL = np.array([[1, 1, 1], [1, 1, 1], [1, 1, 1], [.6, .85, .5], [.85, .85, .85], [.4, .4, .4], [1, .7, .3]])
ax.imshow(PAL[img], extent=ext)
for i, t in enumerate(trees):
    r = np.mean(t["crown_profile"]); ax.add_patch(plt.Circle((t["x"], t["y"]), r, fill=False, color="darkgreen"))
    ax.plot(t["x"], t["y"], "k.", ms=4); ax.text(t["x"] + .5, t["y"] + .5, f"{i}:{t['height']:.0f}", fontsize=7)
ax.plot(CW[:, 0], CW[:, 1], "r-", lw=.6); fig.savefig(L / "trees_topdown.png", dpi=110, bbox_inches="tight")
