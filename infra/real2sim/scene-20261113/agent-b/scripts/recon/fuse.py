"""Agent B (Opus 5.5) — fuse DA3 depth + SAM3 labels + colours into a labelled world-space cloud,
and rasterise top-down layers (ground class, ground height, ground orthophoto).
Usage: envs/da3/bin/python scripts/recon/fuse.py [pix_stride=2] [res_m=0.10]
"""
import json, sys, pathlib, numpy as np, pycolmap, cv2
from PIL import Image
B = pathlib.Path("/root/real2sim/scene-20261113/agent-b"); L = B / "runs/layout"
ST = int(sys.argv[1]) if len(sys.argv) > 1 else 2; RES = float(sys.argv[2]) if len(sys.argv) > 2 else 0.10
wj = json.load(open(L / "world.json")); Rw, o, sc = np.array(wj["R"]), np.array(wj["origin"]), wj["scale"]
rd = pycolmap.Reconstruction(str(B / "runs/sfm_f3/0")); cd = list(rd.cameras.values())[0]
fx, fy, cx, cy, k1, k2, p1, p2 = cd.params
ru = pycolmap.Reconstruction(str(B / "runs/undist/sparse")); cu = list(ru.cameras.values())[0]
W, H = cu.width, cu.height; fxu, fyu, cxu, cyu = cu.params
# map undistorted pixel -> distorted pixel (OPENCV model)
uu, vv = np.meshgrid(np.arange(W) + .5, np.arange(H) + .5); x = (uu - cxu) / fxu; y = (vv - cyu) / fyu
r2 = x * x + y * y; rad = 1 + k1 * r2 + k2 * r2 * r2
xd = x * rad + 2 * p1 * x * y + p2 * (r2 + 2 * x * x); yd = y * rad + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y
mapx = (fx * xd + cx - .5).astype(np.float32); mapy = (fy * yd + cy - .5).astype(np.float32)
allp, allc, alll, allf = [], [], [], []; ratios = []
pts3d = {k: v.xyz for k, v in ru.points3D.items()}
for im in sorted(ru.images.values(), key=lambda i: i.name):
    stem = pathlib.Path(im.name).stem; z = np.load(B / "runs/depth" / (stem + ".npz"))
    d = z["depth"].astype(np.float32); cf = z["conf"].astype(np.float32); K = z["K"]
    dh, dw = d.shape
    lab = cv2.remap(np.asarray(Image.open(B / "runs/seg_f3/labels" / (stem + ".png"))), mapx, mapy, cv2.INTER_NEAREST)
    lab = cv2.resize(lab, (dw, dh), interpolation=cv2.INTER_NEAREST)
    col = cv2.resize(np.asarray(Image.open(B / "runs/undist/images" / im.name).convert("RGB")), (dw, dh), interpolation=cv2.INTER_AREA)
    w2c = np.vstack([im.cam_from_world().matrix(), [0, 0, 0, 1]])
    # depth vs sparse check
    P = np.array([pts3d[p.point3D_id] for p in im.points2D if p.has_point3D()])
    if len(P):
        Pc = P @ w2c[:3, :3].T + w2c[:3, 3]; uvp = Pc[:, :2] / Pc[:, 2:] * [K[0, 0], K[1, 1]] + [K[0, 2], K[1, 2]]
        ok = (uvp[:, 0] >= 0) & (uvp[:, 0] < dw - 1) & (uvp[:, 1] >= 0) & (uvp[:, 1] < dh - 1) & (Pc[:, 2] > 0)
        if ok.sum() > 10: ratios.append(np.median(Pc[ok, 2] / d[uvp[ok, 1].astype(int), uvp[ok, 0].astype(int)]))
    vs, us = np.mgrid[0:dh:ST, 0:dw:ST]; dd = d[vs, us]; cc = cf[vs, us]; ll = lab[vs, us]
    keep = (dd > 0) & (ll != 1) & (ll != 9) & (cc > np.percentile(cc, 30))
    # distance-dependent subsample: drop far points (>150 sfm-m) unless building
    xs = (us[keep] + .5 - K[0, 2]) / K[0, 0] * dd[keep]; ys = (vs[keep] + .5 - K[1, 2]) / K[1, 1] * dd[keep]
    Pc = np.stack([xs, ys, dd[keep]], 1); c2w = np.linalg.inv(w2c); Pw = Pc @ c2w[:3, :3].T + c2w[:3, 3]
    allp.append(((Pw - o) @ Rw.T * sc).astype(np.float32)); allc.append(col[vs, us][keep]); alll.append(ll[keep]); allf.append(np.full(keep.sum(), int(stem), np.int16))
P = np.concatenate(allp); Cc = np.concatenate(allc); Lb = np.concatenate(alll); Fr = np.concatenate(allf)
print("points", len(P), "depth/sparse ratio median", np.median(ratios), "p10/p90", np.percentile(ratios, [10, 90]))
np.savez_compressed(L / "dense_world.npz", xyz=P, rgb=Cc, cls=Lb, frame=Fr)
