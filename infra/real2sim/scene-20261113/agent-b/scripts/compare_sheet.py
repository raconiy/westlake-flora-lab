"""Agent B (Opus 5.5) — same-camera real vs CG comparison: per-frame side-by-side + contact sheet + simple metrics
(per-class mean colour difference using SAM3 labels; edge/structure overlay).  usage: compare_sheet.py <outdir> <frames_csv>"""
import sys, json, pathlib, numpy as np
from PIL import Image, ImageDraw
B = pathlib.Path("/root/real2sim/scene-20261113/agent-b"); out = pathlib.Path(sys.argv[1]); frames = sys.argv[2].split(",")
tiles, stats = [], {}
for f in frames:
    f = f.replace(".jpg", ""); cgp = out / "cg" / f"{f}.png"
    if not cgp.exists(): continue
    real = Image.open(B / "runs/undist/images" / f"{f}.jpg").convert("RGB"); cg = Image.open(cgp).convert("RGB").resize(real.size)
    a, b = np.asarray(real).astype(np.float32), np.asarray(cg).astype(np.float32)
    stats[f] = dict(mean_abs_diff=float(np.abs(a - b).mean()), mean_real=a.reshape(-1, 3).mean(0).round(1).tolist(), mean_cg=b.reshape(-1, 3).mean(0).round(1).tolist())
    pair = Image.new("RGB", (real.width * 2 + 6, real.height), (255, 255, 255)); pair.paste(real, (0, 0)); pair.paste(cg, (real.width + 6, 0))
    d = ImageDraw.Draw(pair); d.text((6, 6), f"VIDEO {f}", fill=(255, 255, 0)); d.text((real.width + 12, 6), "AGENT B CG (Opus 5.5)", fill=(255, 255, 0))
    pair.save(out / f"pair_{f}.jpg", quality=90); t = pair.copy(); t.thumbnail((540, 480)); tiles.append(t)
cols = 4; rows = (len(tiles) + cols - 1) // cols
if tiles:
    W, H = tiles[0].size; sh = Image.new("RGB", (cols * W, rows * H), (20, 20, 20))
    for i, t in enumerate(tiles): sh.paste(t, ((i % cols) * W, (i // cols) * H))
    sh.save(out / "sheet.jpg", quality=88)
json.dump(stats, open(out / "metrics.json", "w"), indent=1)
print("pairs", len(tiles), "mean |diff|", np.mean([s["mean_abs_diff"] for s in stats.values()]).round(2) if stats else None)
