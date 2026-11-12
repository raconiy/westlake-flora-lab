"""Metric depth and sky probability for the 13 registered photographs."""
import sys, glob, numpy as np, torch
from depth_anything_3.api import DepthAnything3
src, out = sys.argv[1], sys.argv[2]
files = sorted(glob.glob(src + '/[0-9][0-9].jpg'))
model = DepthAnything3.from_pretrained('/root/lzr/weights/DA3NESTED-GIANT-LARGE-1.1').to('cuda').eval()
with torch.no_grad():
    p = model.inference(files, process_res=1008)
print('depth', p.depth.shape, 'metric', p.is_metric, 'sky', None if p.sky is None else p.sky.shape, 'scale', p.scale_factor)
for k in range(len(files)):
    d = p.depth[k]
    print(files[k][-6:], 'depth pct', np.percentile(d, [1, 25, 50, 75, 99]).round(2), 'sky frac', None if p.sky is None else float((p.sky[k] > .5).mean()))
np.savez_compressed(out, depth=p.depth.astype(np.float32), sky=None if p.sky is None else p.sky.astype(np.float32),
    intrinsics=p.intrinsics, extrinsics=p.extrinsics, files=np.array([f[-6:] for f in files]))
