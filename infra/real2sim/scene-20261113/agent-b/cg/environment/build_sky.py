"""Agent B (Opus 5.5) — sky dome asset from the video itself.
Every 2nd frame: SAM3 sky pixels (eroded 3 px) -> world ray via solved rotation -> equirectangular bin
(Blender convention: u = atan2(y,-x)/2pi + .5, v = atan2(z, hypot(x,y))/pi + .5), per-bin median of sRGB.
Holes inpainted (Telea), below-horizon filled with a soft horizon colour.  This is an LDR, single-moment sky
(thin altocumulus, 2026-11-13 capture); the clipped sun is replaced by the measured sun lamp at render time.
Output: assets/environment/sky_video_equirect.png (+ .jpg web) and sky.json
Usage: envs/da3/bin/python cg/environment/build_sky.py
"""
import json, pathlib, numpy as np, cv2, pycolmap
from PIL import Image
B = pathlib.Path("/root/real2sim/scene-20261113/agent-b"); L = B / "runs/layout"; OUT = B / "assets/environment"; OUT.mkdir(parents=True, exist_ok=True)
cams = np.load(L / "cams_world.npz"); R = cams["R_c2w"]; names = cams["names"]
rd = pycolmap.Reconstruction(str(B / "runs/sfm_f3/0")); fx0, fy0, cx0, cy0, k1, k2, p1, p2 = list(rd.cameras.values())[0].params
W, H = 4096, 2048
acc = [[] for _ in range(0)]; sumc = np.zeros((H, W, 3)); cnt = np.zeros((H, W)); samples = {}
fx, fy, cx, cy = 444.376, 431.548, 267.0, 470.5
uu, vv = np.meshgrid(np.arange(534) + .5, np.arange(941) + .5); x = (uu - cx) / fx; y = (vv - cy) / fy
r2 = x * x + y * y; rad = 1 + k1 * r2 + k2 * r2 * r2
mapx = (fx0 * (x * rad + 2 * p1 * x * y + p2 * (r2 + 2 * x * x)) + cx0 - .5).astype(np.float32)
mapy = (fy0 * (y * rad + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y) + cy0 - .5).astype(np.float32)
rays = np.stack([x, y, np.ones_like(x)], -1)
stack = {}
for i in range(0, len(names), 2):
    lab = cv2.remap(np.asarray(Image.open(B / "runs/seg_f3/labels" / names[i].replace(".jpg", ".png"))), mapx, mapy, cv2.INTER_NEAREST)
    m = cv2.erode((lab == 1).astype(np.uint8), np.ones((7, 7))) > 0
    if m.sum() < 100: continue
    img = np.asarray(Image.open(B / "runs/undist/images" / names[i]).convert("RGB")).astype(np.float32)
    d = rays[m] @ R[i].T; d /= np.linalg.norm(d, axis=1, keepdims=True)
    u = (np.arctan2(d[:, 1], -d[:, 0]) / (2 * np.pi) + 0.5) * W; v = (np.arctan2(d[:, 2], np.hypot(d[:, 0], d[:, 1])) / np.pi + 0.5) * H
    ui = np.clip(u.astype(int), 0, W - 1); vi = np.clip((H - 1 - v).astype(int), 0, H - 1)
    np.add.at(sumc, (vi, ui), img[m]); np.add.at(cnt, (vi, ui), 1)
pano = sumc / np.maximum(cnt, 1)[..., None]
known = cnt > 0
# fill: inpaint at reduced size, then upsample into holes
# normalized convolution (wrap in azimuth) for small gaps, then smooth row-wise extrapolation to the zenith
sw, shh = 1024, 512
small = cv2.resize((pano * known[..., None]).astype(np.float32), (sw, shh), interpolation=cv2.INTER_AREA)
ks = cv2.resize(known.astype(np.float32), (sw, shh), interpolation=cv2.INTER_AREA)
def blur_wrap(a, s):
    pad = int(3 * s); a2 = np.concatenate([a[:, -pad:], a, a[:, :pad]], 1)
    return cv2.GaussianBlur(a2, (0, 0), s)[:, pad:-pad]
num = blur_wrap(small, 18); den = blur_wrap(ks, 18)
fill = num / np.maximum(den, 1e-4)[..., None]
rowc = np.array([small[r][ks[r] > .3].mean(0) / max(ks[r][ks[r] > .3].mean(), 1e-3) if (ks[r] > .3).sum() > 20 else [np.nan] * 3 for r in range(shh)])
top_known = np.nonzero(np.isfinite(rowc[:, 0]))[0].min()
zen = rowc[top_known] * np.array([1.0, 1.0, 1.02])  # zenith slightly deeper blue (inferred)
for r in range(shh):
    if den[r].mean() < 0.15 and r < top_known + 20:
        t = r / max(top_known, 1); target = zen * (1 - t) + rowc[top_known] * t
        w = np.clip(den[r] / 0.15, 0, 1)[:, None]; fill[r] = fill[r] * w + target * (1 - w)
fill = cv2.GaussianBlur(fill, (0, 0), 3)
up = cv2.resize(fill, (W, H), interpolation=cv2.INTER_CUBIC).astype(np.float32)
smooth_known = cv2.GaussianBlur(known.astype(np.float32), (0, 0), 3)
pano = pano * smooth_known[..., None] * known[..., None] + up * (1 - smooth_known[..., None] * known[..., None])
# below horizon: horizon colour fading to ground grey (never seen as sky; hidden by terrain)
hz = H // 2; horizon = np.median(pano[hz - 40:hz - 5][known[hz - 40:hz - 5]], axis=0) if known[hz - 40:hz - 5].any() else np.array([200, 205, 210.])
for r in range(hz, H): pano[r] = horizon * (1 - 0.4 * min(1, (r - hz) / (H / 4)))
img = Image.fromarray(np.clip(pano, 0, 255).astype(np.uint8)); img.save(OUT / "sky_video_equirect.png")
img.resize((2048, 1024), Image.LANCZOS).save(OUT / "sky_video_equirect_web.jpg", quality=88)
json.dump(dict(asset_id="env_sky_video", type="equirectangular LDR sRGB", convention="Blender: u=atan2(y,-x)/2pi+.5, v=elevation", coverage=float(known[:H // 2].mean()),
               provenance="median of SAM3 sky pixels from 430 video frames reprojected with solved camera rotations; holes inpainted (inferred)",
               files=["sky_video_equirect.png", "sky_video_equirect_web.jpg"]), open(OUT / "sky.json", "w"), indent=1)
print("upper hemisphere coverage", known[:H // 2].mean().round(3))
