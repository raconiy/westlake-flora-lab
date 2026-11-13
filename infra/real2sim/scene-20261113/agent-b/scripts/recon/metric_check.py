"""Agent B (Opus 5.5) — compare DA3 metric depth (no pose input) with SfM-aligned depth x world scale."""
import json, sys, pathlib, numpy as np
from depth_anything_3.api import DepthAnything3
B = pathlib.Path("/root/real2sim/scene-20261113/agent-b"); sc = json.load(open(B / "runs/layout/world.json"))["scale"]
m = DepthAnything3.from_pretrained("/root/lzr/weights/DA3NESTED-GIANT-LARGE-1.1").to("cuda").eval()
res = []
for start in [50, 250, 450, 650, 800]:
    names = [f"{i:05d}.jpg" for i in range(start, start + 8)]
    p = m.inference([str(B / "runs/undist/images" / n) for n in names], process_res=756)
    for j, n in enumerate(names):
        a = np.load(B / "runs/depth" / n.replace(".jpg", ".npz"))["depth"].astype(np.float32) * sc
        d = np.asarray(p.depth[j]);
        if d.shape != a.shape: continue
        ok = (a > 1) & (a < 60); res.append(np.median(d[ok] / a[ok]))
print("metric/est ratio per frame:", np.round(res, 3)); print("median", np.median(res))
