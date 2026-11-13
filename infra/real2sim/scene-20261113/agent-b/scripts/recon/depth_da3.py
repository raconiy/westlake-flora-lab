"""Agent B (Opus 5.5) — DA3 dense depth conditioned on COLMAP poses (undistorted PINHOLE images).
Usage: envs/da3/bin/python scripts/recon/depth_da3.py <undist_dir(with sparse/ & images/)> <out_dir> <shard> <nshards> [chunk=32]
Saves <out>/<image_stem>.npz with depth (in SfM units, aligned via input extrinsics), conf, K, w2c.
"""
import sys, pathlib, numpy as np, torch, pycolmap
from depth_anything_3.api import DepthAnything3
ud, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
si, ns = int(sys.argv[3]), int(sys.argv[4]); CH = int(sys.argv[5]) if len(sys.argv) > 5 else 32
rec = pycolmap.Reconstruction(str(ud / "sparse"))
imgs = sorted(rec.images.values(), key=lambda im: im.name)
chunks = [imgs[i:i + CH] for i in range(0, len(imgs), CH)][si::ns]
model = DepthAnything3.from_pretrained("/root/lzr/weights/DA3NESTED-GIANT-LARGE-1.1").to("cuda").eval()
for ch in chunks:
    if all((out / (pathlib.Path(im.name).stem + ".npz")).exists() for im in ch): continue
    files = [str(ud / "images" / im.name) for im in ch]
    ext = np.stack([np.vstack([im.cam_from_world().matrix(), [0, 0, 0, 1]]) for im in ch]).astype(np.float32)
    K = np.stack([rec.cameras[im.camera_id].calibration_matrix() for im in ch]).astype(np.float32)
    with torch.inference_mode():
        p = model.inference(files, extrinsics=ext, intrinsics=K, align_to_input_ext_scale=True, process_res=756)
    d = np.asarray(p.depth); c = np.asarray(p.conf); Kp = np.asarray(p.intrinsics)
    for j, im in enumerate(ch):
        np.savez_compressed(out / (pathlib.Path(im.name).stem + ".npz"), depth=d[j].astype(np.float16), conf=c[j].astype(np.float16), K=Kp[j], w2c=ext[j])
    print("chunk", ch[0].name, d.shape, flush=True)
