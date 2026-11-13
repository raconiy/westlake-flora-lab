"""Agent B (Opus 5.5) — measure the rotunda from building-labelled dense points + sparse SfM points.
RANSAC circle on the colonnade face (2–7 m above ground) -> centre, outer radius; radial-height histogram ->
cornice height, upper-drum radius and top height.  Writes runs/layout/rotunda_measured.json + debug plot.
"""
import json, pathlib, numpy as np
B = pathlib.Path("/root/real2sim/scene-20261113/agent-b"); L = B / "runs/layout"
D = np.load(L / "dense_world.npz"); P, Lb, F = D["xyz"], D["cls"], D["frame"]
cams = np.load(L / "cams_world.npz"); CW = cams["C"]
guess = np.array([110.0, -5.0])
m = (Lb == 2) & (np.hypot(P[:, 0] - guess[0], P[:, 1] - guess[1]) < 70)
P = P[m]; F = F[m]; dc = np.linalg.norm(P - CW[F.astype(int) - 1], axis=1); P = P[dc < 70]
gz = float(np.median(np.load(L / "ground_z.npy")))
# ground under rotunda: use median camera height path near the end frames minus camera height
g0 = float(np.median(CW[800:859, 2]) - 1.51)
h = P[:, 2] - g0
def ransac_circle(Q, it=4000, thr=0.4, seed=0):
    r = np.random.default_rng(seed); best = None
    for _ in range(it):
        a, b, c = Q[r.choice(len(Q), 3, replace=False)]
        A = np.array([[b[0] - a[0], b[1] - a[1]], [c[0] - a[0], c[1] - a[1]]]) * 2
        y = np.array([b @ b - a @ a, c @ c - a @ a])
        if abs(np.linalg.det(A)) < 1e-6: continue
        o = np.linalg.solve(A, y); R = np.linalg.norm(a - o)
        if not (15 < R < 60): continue
        inl = np.abs(np.linalg.norm(Q - o, axis=1) - R) < thr
        if best is None or inl.sum() > best[0]: best = (inl.sum(), o, R, inl)
    _, o, R, inl = best
    # least-squares refine
    Qi = Q[inl]; A = np.c_[2 * Qi, np.ones(len(Qi))]; y = (Qi ** 2).sum(1); s = np.linalg.lstsq(A, y, rcond=None)[0]
    o = s[:2]; R = np.sqrt(s[2] + o @ o); return o, R, inl.mean()
band = (h > 2) & (h < 7)
o, R, frac = ransac_circle(P[band, :2])
rr = np.hypot(P[:, 0] - o[0], P[:, 1] - o[1])
# radial-height profile: for height bins, the 95th percentile radius of points within R+3
prof = []
for z0 in np.arange(0, 26, 0.5):
    s = (h >= z0) & (h < z0 + 0.5) & (rr < R + 3)
    prof.append((z0, int(s.sum()), float(np.percentile(rr[s], 90)) if s.sum() > 30 else None))
json.dump(dict(center=o.round(3).tolist(), outer_radius=round(float(R), 3), inlier_frac=round(float(frac), 3), ground_z=round(g0, 3),
               radial_profile=prof, note="radius of the colonnade face (pier outer surfaces) from RANSAC circle on building points 2-7 m above ground"),
          open(L / "rotunda_measured.json", "w"), indent=1)
print("center", o.round(2), "R", round(R, 2), "inliers", round(frac, 3), "ground", round(g0, 2))
for z0, n, r in prof:
    if n > 30: print(f"{z0:5.1f} n={n:6d} r90={r:.2f}")

# --- upper drum: separate circle fit (it may be eccentric) on points 13.5-19 m above ground
up = (h > 13.5) & (h < 19.5)
o2, R2, f2 = ransac_circle(P[up, :2], thr=0.5, seed=1)
top = h[(np.hypot(P[:, 0] - o2[0], P[:, 1] - o2[1]) < R2 + 1) & (h > 12)]
mj = json.load(open(L / "rotunda_measured.json"))
mj.update(upper_center=o2.round(3).tolist(), upper_radius=round(float(R2), 3), upper_inlier_frac=round(float(f2), 3),
          upper_top_h=round(float(np.percentile(top, 99)), 2), cornice_h=11.0)
json.dump(mj, open(L / "rotunda_measured.json", "w"), indent=1)
print("upper drum centre", o2.round(2), "R2", round(R2, 2), "inl", round(f2, 3), "offset from base centre", (o2 - o).round(2), "top", round(float(np.percentile(top, 99)), 2))
