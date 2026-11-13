"""Agent B (Opus 5.5) — per-tree reference crops: project each measured tree into its best frame,
draw base->top line, save crop + contact sheet. Used to verify detections, assign species/habit and
as the per-asset reference image.  Usage: envs/da3/bin/python scripts/recon/tree_crops.py [trees_json]"""
import json, sys, pathlib, numpy as np
from PIL import Image, ImageDraw, ImageFont
B = pathlib.Path("/root/real2sim/scene-20261113/agent-b"); L = B / "runs/layout"
tj = sys.argv[1] if len(sys.argv) > 1 else str(L / "trees_measured.json")
trees = json.load(open(tj)); cams = np.load(L / "cams_world.npz"); CW, R = cams["C"], cams["R_c2w"]; names = cams["names"]
fx, fy, cx, cy = 444.376, 431.548, 267.0, 470.5
def proj(i, X):
    Xc = (X - CW[i]) @ R[i]  # world->cam (R is c2w)
    return np.array([fx * Xc[0] / Xc[2] + cx, fy * Xc[1] / Xc[2] + cy]), Xc[2]
out = L / "tree_crops"; out.mkdir(exist_ok=True); thumbs = []
for k, t in enumerate(trees):
    base = np.array([t["x"], t["y"], t["ground_z"]]); top = base + [0, 0, t["height"]]
    best = None
    for i in range(len(CW)):
        (ub, zb), (ut, zt) = proj(i, base), proj(i, top)
        if zb < 3 or zt < 3: continue
        d = np.linalg.norm(CW[i] - base)
        if not (0 <= ub[0] < 534 and 0 <= ub[1] < 941 and 0 <= ut[1] < 941 and 0 <= ut[0] < 534): continue
        score = abs(ub[0] - 267) / 267 + abs(d - 14) / 14
        if best is None or score < best[0]: best = (score, i, ub, ut)
    if best is None: thumbs.append(None); continue
    _, i, ub, ut = best
    im = Image.open(B / "runs/undist/images" / names[i]).convert("RGB"); dr = ImageDraw.Draw(im)
    dr.line([tuple(ub), tuple(ut)], fill=(255, 0, 0), width=2); dr.ellipse([ub[0] - 4, ub[1] - 4, ub[0] + 4, ub[1] + 4], outline=(255, 255, 0), width=2)
    hh = ub[1] - ut[1]; x0 = max(0, ub[0] - hh * 0.7); x1 = min(534, ub[0] + hh * 0.7)
    c = im.crop((int(x0), int(max(0, ut[1] - 20)), int(x1), int(min(941, ub[1] + 30))))
    c.save(out / f"tree_{k:02d}.jpg"); t["ref_frame"] = str(names[i]); trees[k] = t
    c.thumbnail((200, 260)); thumbs.append(c)
json.dump(trees, open(tj, "w"), indent=1)
cols = 12; rows = (len(thumbs) + cols - 1) // cols; sheet = Image.new("RGB", (cols * 200, rows * 280), (30, 30, 30)); dr = ImageDraw.Draw(sheet)
for k, c in enumerate(thumbs):
    x, y = (k % cols) * 200, (k // cols) * 280
    if c is not None: sheet.paste(c, (x + (200 - c.width) // 2, y + 18))
    dr.text((x + 4, y + 2), f"#{k} h={trees[k]['height']:.1f}", fill=(255, 255, 0))
sheet.save(L / "tree_crops_sheet.jpg", quality=88)
