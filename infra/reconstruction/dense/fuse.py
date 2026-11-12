"""Fuse per-view metric depth into one coloured point set.

Each kept pixel becomes a point at its measured depth, coloured from the
photograph. Nothing is modelled: surfaces no view saw are absent, and depth is
monocular-network depth made consistent across views, not a survey.

Sky and depth discontinuities (where a pixel straddles a foreground edge and
would float in mid-air) are dropped. Points are thinned on a grid whose cell
grows with range, in three bands written as separate files so the viewer can
draw each at the size of its cell.

usage: fuse.py depth.npz out_dir --images DIR [--scene cameras.json] [--prefix NAME]
  --scene   registered cameras of an existing scene (keys = two-digit photo
            ids): the fused set is placed in that scene's frame by a
            similarity fitted to camera orientations and centres.
  otherwise the set is levelled on its fitted ground plane, Y up, origin at the
  ground point beneath the mean camera.
"""
import sys, json, os, argparse
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('depth'); ap.add_argument('out'); ap.add_argument('--images'); ap.add_argument('--scene'); ap.add_argument('--prefix', default='dense')
ap.add_argument('--budget', type=int, default=3_000_000)
a = ap.parse_args()
z = np.load(a.depth, allow_pickle=True)
depth, K, E, files = z['depth'], z['intrinsics'], z['extrinsics'], [str(f) for f in z['files']]
N, H, W = depth.shape
conf = z['conf'] if 'conf' in z.files and z['conf'].shape != () else None
bands = [(0, 15, .022), (15, 50, .06), (50, 1e9, .14)]

def rot(q):
    x, y, zq, w = q
    return np.array([[1-2*(y*y+zq*zq), 2*(x*y-zq*w), 2*(x*zq+y*w)], [2*(x*y+zq*w), 1-2*(x*x+zq*zq), 2*(y*zq-x*w)], [2*(x*zq-y*w), 2*(y*zq+x*w), 1-2*(x*x+y*y)]])

far = np.percentile(depth, 99.5)
pts, cols, rng = [], [], np.random.default_rng(7)
centres, forwards, ups = [], [], []
u, v = np.meshgrid(np.arange(W) + .5, np.arange(H) + .5)
for k in range(N):
    if 'images' in z.files and a.images is None: im = z['images'][k]
    else: im = np.asarray(Image.open(os.path.join(a.images, files[k])).convert('RGB').resize((W, H), Image.LANCZOS))
    d = depth[k]; R, t = E[k][:3, :3], E[k][:3, 3]
    centres.append(-R.T @ t); forwards.append(R.T @ [0, 0, 1.]); ups.append(R.T @ [0, -1., 0])
    r, g, b = im[..., 0].astype(int), im[..., 1].astype(int), im[..., 2].astype(int)
    sky = (d > .9 * far) & (b > r + 18) & (b > g)
    gy, gx = np.gradient(d)
    edge = np.hypot(gx, gy) > .04 * d
    keep = ~sky & ~edge & (d > .3) & (d < .98 * far)
    if conf is not None: keep &= conf[k] > np.percentile(conf[k], 12)
    x = (u[keep] - K[k][0, 2]) / K[k][0, 0] * d[keep]; y = (v[keep] - K[k][1, 2]) / K[k][1, 1] * d[keep]
    cam = np.stack([x, y, d[keep]], 1)
    pts.append((cam - t) @ R); cols.append(im[keep]); # world = R^T (cam - t)
P = np.concatenate(pts).astype(np.float64); C = np.concatenate(cols); D = np.concatenate([depth[k][m] for k, m in enumerate([None] * 0)]) if False else None
centres, forwards, ups = map(np.array, (centres, forwards, ups))
ranges = np.concatenate([np.full(len(p), 0.) for p in pts])  # filled below
o = 0
for k in range(N):
    n = len(pts[k]); ranges[o:o + n] = np.linalg.norm(pts[k] - centres[k], axis=1); o += n

meta = dict(views=N, basis='Monocular multi-view metric depth fused per pixel; unobserved surfaces are absent')
if a.scene:
    cams = json.load(open(a.scene)); ids = [f[:2] for f in files]
    tgt_c = np.array([cams[i]['t'] for i in ids]); Rg = [rot(cams[i]['q']) for i in ids]
    tgt_f = np.array([r @ [0, 0, -1.] for r in Rg]); tgt_u = np.array([r @ [0, 1., 0] for r in Rg])
    # Rotation from paired view directions (unit vectors, so no scale enters).
    A = np.concatenate([forwards, ups]); B = np.concatenate([tgt_f, tgt_u])
    U, _, Vt = np.linalg.svd(B.T @ A); S = np.diag([1, 1, np.sign(np.linalg.det(U @ Vt))]); Rs = U @ S @ Vt
    ca, cb = centres.mean(0), tgt_c.mean(0)
    s = np.sqrt(((tgt_c - cb) ** 2).sum() / ((centres - ca) ** 2).sum())
    T = cb - s * Rs @ ca
    resid = np.linalg.norm((s * (Rs @ centres.T).T + T) - tgt_c, axis=1)
    ang = np.degrees(np.arccos(np.clip(((Rs @ forwards.T).T * tgt_f).sum(1), -1, 1)))
    P = s * P @ Rs.T + T; ranges *= s
    meta.update(frame='scene', scale=float(s), cameraCentreResidualM=dict(mean=float(resid.mean()), max=float(resid.max())),
        viewDirectionResidualDeg=dict(mean=float(ang.mean()), max=float(ang.max())))
    print('scale', s, 'centre residual m mean/max', resid.mean().round(3), resid.max().round(3), 'direction deg', ang.mean().round(2), ang.max().round(2))
else:
    up = ups.mean(0); up /= np.linalg.norm(up)
    # Ground: the lowest dense layer along the mean camera up, fitted by RANSAC.
    near = P[ranges < np.percentile(ranges, 60)]; h = near @ up
    cand = near[h < np.percentile(h, 25)]; best = (0, None)
    for _ in range(400):
        q = cand[rng.choice(len(cand), 3, replace=False)]; n = np.cross(q[1] - q[0], q[2] - q[0]); ln = np.linalg.norm(n)
        if ln < 1e-9: continue
        n /= ln; n = n if n @ up > 0 else -n
        if n @ up < .8: continue
        inl = (np.abs((cand - q[0]) @ n) < .04).sum()
        if inl > best[0]: best = (inl, (n, q[0]))
    n, p0 = best[1]
    xax = np.cross(forwards.mean(0), n); xax /= np.linalg.norm(xax); zax = np.cross(xax, n)
    Rs = np.stack([xax, n, zax]); foot = centres.mean(0) - ((centres.mean(0) - p0) @ n) * n
    P = (P - foot) @ Rs.T; centres = (centres - foot) @ Rs.T
    meta.update(frame='levelled', groundInlierFraction=float(best[0] / len(cand)), cameraHeightM=float(centres[:, 1].mean()),
        cameras=[[round(float(c), 3) for c in cc] for cc in centres])
    print('ground inliers', best[0] / len(cand), 'camera height', centres[:, 1].mean().round(2))

os.makedirs(a.out, exist_ok=True); index = []; total = 0
for i, (lo, hi, cell) in enumerate(bands):
    m = (ranges >= lo) & (ranges < hi)
    if not m.any(): continue
    p, c = P[m], C[m]
    order = rng.permutation(len(p)); p, c = p[order], c[order]
    key = np.floor(p / cell).astype(np.int64); key = key[:, 0] * 73856093 ^ key[:, 1] * 19349663 ^ key[:, 2] * 83492791
    _, first = np.unique(key, return_index=True); p, c = p[first], c[first]
    index.append([p, c, cell])
count = sum(len(p) for p, _, _ in index); thin = min(1, a.budget / count)
out_index = []
for i, (p, c, cell) in enumerate(index):
    if thin < 1: sel = rng.random(len(p)) < thin; p, c = p[sel], c[sel]
    rec = np.zeros(len(p), dtype=[('xyz', '<f4', 3), ('rgba', 'u1', 4)]); rec['xyz'] = p; rec['rgba'][:, :3] = c; rec['rgba'][:, 3] = 255
    name = f'{a.prefix}-{i}.bin'; rec.tofile(os.path.join(a.out, name))
    out_index.append(dict(file=name, count=int(len(p)), diameter=round(cell * 1.6 / np.sqrt(thin), 4))); total += len(p)
    print(name, len(p), 'bbox', p.min(0).round(1), p.max(0).round(1))
json.dump(out_index, open(os.path.join(a.out, f'{a.prefix}-samples.json'), 'w'))
meta.update(points=total, cellsM=[b[2] for b in bands]); json.dump(meta, open(os.path.join(a.out, f'{a.prefix}.json'), 'w'), indent=1)
print('total', total)
