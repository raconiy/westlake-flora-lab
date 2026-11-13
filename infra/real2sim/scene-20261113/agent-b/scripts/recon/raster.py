"""Agent B (Opus 5.5) — top-down rasters from the labelled dense cloud.
Per cell keep the K observations closest to their camera (sharpest), take median colour/height and class vote.
Outputs runs/layout/raster_{rgb,cls,z}.png/npy + raster.json (origin, res)."""
import json, sys, pathlib, numpy as np
from PIL import Image
B = pathlib.Path("/root/real2sim/scene-20261113/agent-b"); L = B / "runs/layout"
RES = float(sys.argv[1]) if len(sys.argv) > 1 else 0.1; KN = 6
D = np.load(L / "dense_world.npz"); P, C, Lb, F = D["xyz"], D["rgb"], D["cls"], D["frame"]
cams = np.load(L / "cams_world.npz"); CW = cams["C"]; names = cams["names"]
fidx = {int(n[:5]): i for i, n in enumerate(names)}
g = np.isin(Lb, [3, 4, 5, 6]) & (np.abs(P[:, 2]) < 4)
P, C, Lb, F = P[g], C[g], Lb[g], F[g]
dist = np.linalg.norm(P - CW[np.vectorize(fidx.get)(F)], axis=1); m = dist < float(sys.argv[2] if len(sys.argv) > 2 else 25); P, C, Lb, dist = P[m], C[m], Lb[m], dist[m]
x0, y0 = np.floor(P[:, :2].min(0)) - 1; nx, ny = (np.ceil((P[:, :2].max(0) - [x0, y0]) / RES) + 2).astype(int)
ix = ((P[:, 0] - x0) / RES).astype(int); iy = ((P[:, 1] - y0) / RES).astype(int); cell = iy * nx + ix
o = np.lexsort((dist, cell)); cell, P, C, Lb = cell[o], P[o], C[o], Lb[o]
u, start, cnt = np.unique(cell, return_index=True, return_counts=True)
rank = np.arange(len(cell)) - np.repeat(start, cnt); k = rank < KN
cell, P, C, Lb = cell[k], P[k], C[k], Lb[k]
u, inv = np.unique(cell, return_inverse=True)
rgb = np.zeros((nx * ny, 3), np.float32); z = np.full(nx * ny, np.nan, np.float32); cls = np.zeros(nx * ny, np.uint8)
n = np.bincount(inv)
for ch in range(3): rgb[u, ch] = np.bincount(inv, C[:, ch].astype(np.float32)) / n
z[u] = np.bincount(inv, P[:, 2]) / n
votes = np.zeros((len(u), 7)); np.add.at(votes, (inv, Lb), 1); cls[u] = votes.argmax(1)
rgb = rgb.reshape(ny, nx, 3)[::-1]; z = z.reshape(ny, nx)[::-1]; cls = cls.reshape(ny, nx)[::-1]
Image.fromarray(rgb.clip(0, 255).astype(np.uint8)).save(L / "raster_rgb.png")
np.save(L / "raster_z.npy", z); np.save(L / "raster_cls.npy", cls)
PAL = np.array([[0,0,0],[0,0,0],[0,0,0],[60,200,60],[190,190,190],[60,60,60],[255,160,0]], np.uint8)
Image.fromarray(PAL[cls]).save(L / "raster_cls.png")
json.dump(dict(x0=float(x0), y0=float(y0), res=RES, nx=int(nx), ny=int(ny), note="row 0 = max y (north up)"), open(L / "raster.json", "w"))
print(nx, ny, "coverage", np.isfinite(z).mean())
