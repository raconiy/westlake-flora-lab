"""Agent B (Opus 5.5) — per-frame semantic labels with SAM3 text prompts.
Usage: envs/sam3/bin/python scripts/recon/segment_sam3.py <frames_dir> <out_dir> <shard_idx> <num_shards> [stride]
Writes <out>/labels/<frame>.png (uint8 class id) and <out>/inst/<frame>_<cls>.npz (instance masks + scores).
"""
import sys, json, pathlib, contextlib
import numpy as np, torch
from PIL import Image
from sam3.model_builder import build_sam3_image_model
from sam3.model.sam3_image_processor import Sam3Processor
CKPT = "/root/lzr/weights/sam3.1_multiplex.pt"
# painting order: later overrides earlier
CLASSES = [  # id, name, prompt, threshold
    (1, "sky", "sky", 0.4),
    (2, "building", "building", 0.4),
    (5, "road", "asphalt road", 0.4),
    (4, "paving", "stone paved plaza ground", 0.35),
    (3, "grass", "grass lawn", 0.4),
    (6, "curb", "curb", 0.4),
    (7, "tree", "tree", 0.4),
    (8, "lamp", "street lamp pole", 0.4),
    (10, "bin", "trash can", 0.45),
    (12, "planter", "planter box", 0.45),
    (11, "bike", "bicycle", 0.45),
    (9, "person", "person", 0.4),
]
INST = {"tree", "lamp", "bin", "person", "planter", "bike"}
def main():
    fd, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    si, ns = int(sys.argv[3]), int(sys.argv[4]); stride = int(sys.argv[5]) if len(sys.argv) > 5 else 1
    files = sorted(fd.glob("*.jpg"))[::stride][si::ns]
    (out / "labels").mkdir(parents=True, exist_ok=True); (out / "inst").mkdir(parents=True, exist_ok=True)
    (out / "classes.json").write_text(json.dumps([dict(id=c[0], name=c[1], prompt=c[2], thr=c[3]) for c in CLASSES], indent=1))
    model = build_sam3_image_model(checkpoint_path=CKPT, load_from_HF=False, device="cuda", compile=False)
    proc = Sam3Processor(model, device="cuda", confidence_threshold=0.3)
    with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
        for f in files:
            if (out / "labels" / (f.stem + ".png")).exists(): continue
            im = Image.open(f).convert("RGB"); w, h = im.size
            st = proc.set_image(im)
            lab = np.zeros((h, w), np.uint8)
            for cid, name, prompt, thr in CLASSES:
                proc.reset_all_prompts(st)
                r = proc.set_text_prompt(prompt=prompt, state=st)
                m = r["masks"].detach().float().cpu().numpy().reshape(-1, h, w) > 0
                s = r["scores"].detach().float().cpu().numpy().reshape(-1)
                keep = s >= thr
                m, s = m[keep], s[keep]
                if len(m): lab[m.any(0)] = cid
                if name in INST and len(m):
                    np.savez_compressed(out / "inst" / f"{f.stem}_{name}.npz", masks=np.packbits(m, axis=-1), scores=s, shape=np.array([h, w]))
            Image.fromarray(lab).save(out / "labels" / (f.stem + ".png"))
            print(f.name, np.bincount(lab.ravel(), minlength=13).tolist(), flush=True)
main()
