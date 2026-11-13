"""Agent B (Opus 5.5) — camera solve with pycolmap (SIFT + sequential matching).
Usage: envs/py/bin/python scripts/recon/sfm.py <image_dir> <mask_dir|-> <out_dir>
"""
import sys, pathlib, pycolmap, time
img_dir, mask_dir, out = sys.argv[1], sys.argv[2], pathlib.Path(sys.argv[3])
out.mkdir(parents=True, exist_ok=True)
db = out / "database.db"
if db.exists(): db.unlink()
t = time.time()
ext = pycolmap.FeatureExtractionOptions()
ext.sift.max_num_features = 8192
ext.num_threads = 64
ro = pycolmap.ImageReaderOptions()
ro.camera_model = "OPENCV"
if mask_dir != "-": ro.mask_path = mask_dir
pycolmap.extract_features(db, img_dir, camera_mode=pycolmap.CameraMode.SINGLE, reader_options=ro, extraction_options=ext)
print("extract", time.time()-t, flush=True)
so = pycolmap.SequentialPairingOptions()
so.overlap = 20
so.quadratic_overlap = True
pycolmap.match_sequential(db, pairing_options=so)
print("match", time.time()-t, flush=True)
opts = pycolmap.IncrementalPipelineOptions()
opts.num_threads = 64
maps = pycolmap.incremental_mapping(db, img_dir, out, options=opts)
for k, m in maps.items():
    print(k, m.summary(), flush=True)
print("done", time.time()-t)
