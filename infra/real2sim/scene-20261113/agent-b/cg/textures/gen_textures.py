"""Agent B (Opus 5.5) — procedural texture library (tileable, seeded, colour-calibrated to the video).
Writes assets/textures/<name>_{albedo,normal}.png and assets/textures/textures.json (physical tile sizes).
Calibration: ground/building albedo means from runs/layout/class_colors.json (median sRGB of SAM3 regions
under the overcast light of the video); slab size from the orthophoto measurement (1.30 x 0.60 m, +-8%).
Usage: envs/da3/bin/python cg/textures/gen_textures.py
"""
import json, math, pathlib, numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
B = pathlib.Path("/root/real2sim/scene-20261113/agent-b"); OUT = B / "assets/textures"; OUT.mkdir(parents=True, exist_ok=True)
CC = json.load(open(B / "runs/layout/class_colors.json"))
rng = np.random.default_rng(20261113)
META = {}

def fnoise(n, scales=(4, 8, 16, 32, 64), amps=None, seed=0, aniso=(1, 1)):
    r = np.random.default_rng(seed); out = np.zeros((n, n))
    amps = amps or [1 / (i + 1) for i in range(len(scales))]
    for s, a in zip(scales, amps):
        g = r.normal(0, 1, (n, n)); out += a * ndimage.gaussian_filter(g, (n / s / 4 * aniso[0], n / s / 4 * aniso[1]), mode="wrap")
    out -= out.mean(); return out / (out.std() + 1e-9)
def normal_from_height(h, strength):
    gy, gx = np.gradient(h); n = np.stack([-gx * strength, -gy * strength, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True); return ((n * 0.5 + 0.5) * 255).astype(np.uint8)
def save(name, albedo, height=None, strength=4.0, tile_m=None, note=""):
    Image.fromarray(np.clip(albedo, 0, 255).astype(np.uint8)).save(OUT / f"{name}_albedo.png")
    if height is not None: Image.fromarray(normal_from_height(height, strength)).save(OUT / f"{name}_normal.png")
    META[name] = dict(albedo=f"{name}_albedo.png", normal=f"{name}_normal.png" if height is not None else None, tile_m=tile_m, note=note)
def srgb(c): return np.array(c, np.float64)

# ---------------- ground ----------------
def paving():
    L_, W_, J = 1.30, 0.60, 0.007; cols, rows = 3, 6; tw, th = L_ * cols, W_ * rows; px = 2048; ppm = px / tw; H = int(round(th * ppm))
    base = srgb(CC["paving"]["median"]) * 1.06
    img = np.zeros((H, px, 3)); hgt = np.zeros((H, px))
    yy, xx = np.mgrid[0:H, 0:px] / ppm
    row = (yy // W_).astype(int); off = (row % 2) * L_ / 2; xs = (xx + off) % tw; col = (xs // L_).astype(int)
    sid = row * 10 + col; tone = np.random.default_rng(1).normal(0, 0.035, 200)[sid]
    speck = fnoise(px, (64, 128, 256), seed=2)[:H] * 0.03 + fnoise(px, (8, 16), seed=3)[:H] * 0.02
    dj = np.minimum(np.minimum(yy % W_, W_ - yy % W_), np.minimum(xs % L_, L_ - xs % L_))
    joint = np.clip(1 - dj / J, 0, 1)
    v = 1 + tone + speck - 0.45 * joint
    img = base[None, None] * v[..., None]
    hgt = -joint * 2.0 + speck * 0.6
    save("paving_granite", img, hgt, 3.0, [tw, th], "granite slabs 1.30x0.60 m running bond (measured, +-8%); tone variation per slab")
def asphalt():
    n = 1024; base = srgb(CC["road"]["median"]) * 1.02
    a = fnoise(n, (32, 64, 128, 256), seed=5); s = (np.random.default_rng(6).random((n, n)) > 0.985) * 0.18
    v = 1 + 0.06 * a + s - 0.05 * (np.random.default_rng(7).random((n, n)) > 0.97)
    save("asphalt", base * v[..., None], a * 0.5 + s * 3, 2.0, [3.0, 3.0], "dense asphalt, aggregate speckle")
def grass():
    n = 1024; base = srgb(CC["grass"]["median"]) * np.array([1.16, 1.24, 0.35])
    n = 2048; blades = fnoise(n, (128, 256, 512), seed=8, aniso=(3, 0.5)); patch = fnoise(n, (2, 4, 8), seed=9)
    v = 1 + 0.16 * blades + 0.08 * patch
    hue = np.stack([1 + 0.05 * patch, 1 + 0.02 * patch, 1 - 0.1 * patch], -1)
    save("lawn", base * v[..., None] * hue, blades, 3.0, [4.0, 4.0], "mown lawn, calibrated to median video grass colour")
def concrete(name, key, mult, tile=2.0, seed=10):
    n = 1024; base = srgb(CC[key]["median"]) * mult
    a = fnoise(n, (8, 32, 128), seed=seed); b = fnoise(n, (256,), seed=seed + 1)
    save(name, base * (1 + 0.035 * a + 0.025 * b)[..., None], a * 0.3 + b * 0.2, 1.5, [tile, tile], f"calibrated to {key}")
def curb_stone():
    n = 1024; base = srgb(CC["curb"]["median"]) * 1.02
    a = fnoise(n, (64, 128, 256), seed=21); seg = np.zeros((n, n)); seg[:, ::n // 2] = 1; seg = ndimage.maximum_filter(seg, (1, 3))
    save("curb_granite", base * (1 + 0.04 * a - 0.35 * seg)[..., None], -seg * 2 + a * 0.3, 2.0, [1.0, 1.0], "granite kerb, 0.5 m segments")
# ---------------- building ----------------
def cladding():
    n = 1024; base = np.array([232, 232, 226.0])
    a = fnoise(n, (16, 64, 256), seed=31); panel = np.zeros((n, n)); panel[::n // 2, :] = 1; panel = ndimage.maximum_filter(panel, (2, 1))
    save("white_stone", base * (1 + 0.02 * a - 0.18 * panel)[..., None], -panel + a * 0.2, 1.5, [1.2, 1.2], "white stone/aluminium cladding, 0.6 m courses (inferred)")
def wood():
    n = 1024; base = np.array([150, 100, 62.0]); g = fnoise(n, (4, 8, 64, 256), seed=41, aniso=(0.2, 4))
    save("wood_panel", base * (1 + 0.12 * g)[..., None], g * 0.3, 1.0, [1.0, 1.0], "warm timber spandrel (colour from video)")
def slats():
    n = 512; x = np.arange(n) / n; s = 0.5 + 0.5 * np.cos(2 * np.pi * x * 8); s = np.tile(s, (n, 1))
    base = np.array([236, 236, 232.0])
    save("slat_louvre", base * (0.8 + 0.2 * s)[..., None], s * 1.5, 3.0, [0.8, 0.8], "vertical louvre fins, 0.1 m pitch")
def facade_bands():
    """generic modern facade for background massing: tile 6 m x 4 m (one storey): 0.7 m white slab band + glazing, mullions 1.5 m"""
    W_, H_ = 1536, 1024; yy, xx = np.mgrid[0:H_, 0:W_]
    slab = (yy > H_ * (1 - 0.7 / 4)); mull = ((xx % (W_ // 4)) < 10)
    glass = np.array([105, 116, 128.0]); white = np.array([214, 215, 211.0]); mcol = np.array([150, 152, 152.0])
    a = fnoise(1024, (8, 32), seed=81)[:H_, :1024]; a = np.pad(a, ((0, 0), (0, W_ - 1024)), mode="wrap")
    img = np.where(slab[..., None], white, np.where(mull[..., None], mcol, glass * (1 + 0.15 * a[..., None])))
    save("facade_bands", img, slab * 1.0 - mull * 0.5, 2.0, [6.0, 4.0], "generic floor-band facade for background massing (inferred pattern)")
def stone_grey():
    n = 1024; base = np.array([128, 130, 132.0]); a = fnoise(n, (16, 64, 256), seed=51)
    panel = np.zeros((n, n)); panel[::n // 2, :] = 1; panel[:, ::n // 2] = 1; panel = ndimage.maximum_filter(panel, 3)
    save("grey_stone_panel", base * (1 + 0.04 * a - 0.25 * panel)[..., None], -panel + a * 0.2, 2.0, [2.4, 2.4], "dark grey stone panels of the pavilion (colour from video)")
# ---------------- bark ----------------
def bark(name, kind, seed):
    n = 1024
    if kind == "furrowed":
        ridges = fnoise(n, (6, 12, 24), seed=seed, aniso=(4, 0.35)); h = np.tanh(ridges * 1.6)
        h += 0.3 * fnoise(n, (64, 128), seed=seed + 1)
    else:
        h = 0.4 * fnoise(n, (16, 64), seed=seed, aniso=(1.0, 2.0)); lent = fnoise(n, (24,), seed=seed + 2, aniso=(0.15, 4)); h += 0.6 * (lent > 1.8)
    v = 0.78 + 0.12 * h
    save(name, np.stack([v * 255] * 3, -1), h, 5.0, [0.6, 0.6], "neutral bark detail (tinted per species in material)")
# ---------------- leaves ----------------
CELL = 256
def leaf_poly(shape, w, r):
    pts = []
    if shape == "ovate":
        for t in np.linspace(0, 1, 40):
            y = 0.06 + 0.94 * t; hw = w / 2 * (np.sin(np.pi * t) ** 0.75) * (1.05 - 0.25 * t) * r.uniform(0.97, 1.03)
            pts.append((hw, y))
        pts = [(-x, y) for x, y in pts[::-1]] + pts
    elif shape == "palmate":
        c = np.array([0, 0.45]); lobes = 5
        for th in np.linspace(-np.pi, np.pi, 400):
            a = (th - np.pi / 2 + np.pi) % (2 * np.pi) - np.pi      # 0 = towards tip
            if abs(a) > 2.75: rr = 0.08                            # sinus at the petiole
            else:
                ph = (a / (2 * np.pi / lobes)) % 1.0; tri = 1 - abs(ph - 0.5) * 2   # 1 at lobe tip, 0 in sinus
                rr = 0.47 * (0.42 + 0.58 * tri ** 2.2) * (0.8 if abs(a) > 1.9 else 1.0)
                rr *= 1 + 0.03 * np.sin(a * 60)                     # serration
            pts.append((c[0] + rr * np.cos(th) * w, c[1] + rr * np.sin(th) * 1.0))
    elif shape == "fan":
        for th in np.linspace(np.radians(30), np.radians(150), 60):
            notch = 0.12 * np.exp(-((th - np.pi / 2) / 0.06) ** 2)
            rr = 0.95 - notch + 0.02 * np.sin(th * 40); pts.append((np.cos(th) * rr * 0.5 / math.cos(math.radians(30)) * w, 0.03 + np.sin(th) * rr))
        pts = [(0, 0.03)] + pts
    return pts
def draw_leaf(dr, shape, w, cx, cy, sc, ang, r, W, H):
    """draw a single leaf (petiole at cx,cy), rotated by ang, scale sc (fraction of cell height)"""
    if shape == "compound":
        rach = 0.95
        for k in range(5):
            y = 0.18 + k * 0.17; s = 0.24 * (1 - 0.08 * k)
            for side in (-1, 1):
                draw_leaf_rot(dr, "ovate", 0.45, cx, cy, sc, ang, r, W, H, base=(0, y), sub_ang=side * 1.15, sub_sc=s)
        draw_leaf_rot(dr, "ovate", 0.45, cx, cy, sc, ang, r, W, H, base=(0, rach - 0.05), sub_ang=0, sub_sc=0.26)
        line(dr, cx, cy, sc, ang, W, H, (0, 0), (0, rach), 2, 150)
        return
    draw_leaf_rot(dr, shape, w, cx, cy, sc, ang, r, W, H)
def tf(cx, cy, sc, ang, W, H, p):
    x, y = p; ca, sa = math.cos(ang), math.sin(ang); X = x * ca - y * sa; Y = x * sa + y * ca
    return (cx + X * sc * H, cy - Y * sc * H)
def line(dr, cx, cy, sc, ang, W, H, a, b, wd, val):
    dr.line([tf(cx, cy, sc, ang, W, H, a), tf(cx, cy, sc, ang, W, H, b)], fill=(val, val, val, 255), width=wd)
def draw_leaf_rot(dr, shape, w, cx, cy, sc, ang, r, W, H, base=(0, 0), sub_ang=0.0, sub_sc=1.0):
    pts = leaf_poly(shape, w, r)
    ca, sa = math.cos(sub_ang), math.sin(sub_ang)
    pts = [(base[0] + (x * ca - y * sa) * sub_sc, base[1] + (x * sa + y * ca) * sub_sc) for x, y in pts]
    v = int(r.uniform(200, 235))
    dr.polygon([tf(cx, cy, sc, ang, W, H, p) for p in pts], fill=(v, v, v, 255))
    # midrib + veins
    tip = (base[0] - sa * sub_sc, base[1] + ca * sub_sc)
    dr.line([tf(cx, cy, sc, ang, W, H, base), tf(cx, cy, sc, ang, W, H, tip)], fill=(v - 45,) * 3 + (255,), width=max(1, int(sc * H / 90)))
    for k in range(1, 6):
        t = k / 6.5; p0 = (base[0] - sa * sub_sc * t, base[1] + ca * sub_sc * t)
        for side in (-1, 1):
            d = 0.22 * sub_sc * (1 - t * 0.5)
            p1 = (p0[0] + side * d * ca * 0.8 - sa * d * 0.5, p0[1] + side * d * sa * 0.8 + ca * d * 0.5)
            dr.line([tf(cx, cy, sc, ang, W, H, p0), tf(cx, cy, sc, ang, W, H, p1)], fill=(v - 25,) * 3 + (255,), width=1)
def leaf_atlas(shape, w, variants=4):
    S = 4  # supersample
    atlas = Image.new("RGBA", (CELL * variants, CELL), (0, 0, 0, 0))
    for k in range(variants):
        r = np.random.default_rng(100 + k)
        Wp = int(CELL * S * w); Hp = CELL * S
        im = Image.new("RGBA", (max(Wp, 8), Hp), (128, 128, 128, 0)); dr = ImageDraw.Draw(im)
        draw_leaf(dr, shape, w, Wp / 2, Hp, 1.0, r.normal(0, 0.03), r, Wp, Hp)
        im = im.resize((CELL, CELL), Image.LANCZOS); atlas.paste(im, (k * CELL, 0))
    atlas = bleed(atlas); atlas.save(OUT / f"leaf_{shape}.png")
    cov = float((np.asarray(atlas)[..., 3] > 127).mean())
    META[f"leaf_{shape}"] = dict(albedo=f"leaf_{shape}.png", variants=variants, aspect=w, alpha_coverage=round(cov, 3), note="greyscale leaf + alpha; colour from per-leaf vertex tint (measured palette)")
def twig_atlas(shape, w_leaf, variants=4):
    S = 4; w = 0.85
    atlas = Image.new("RGBA", (CELL * variants, CELL), (0, 0, 0, 0))
    for k in range(variants):
        r = np.random.default_rng(200 + k); Wp = int(CELL * S * w); Hp = CELL * S
        im = Image.new("RGBA", (Wp, Hp), (128, 128, 128, 0)); dr = ImageDraw.Draw(im)
        # twig stem
        dr.line([(Wp / 2, Hp), (Wp / 2 + r.normal(0, Wp * 0.03), Hp * 0.1)], fill=(95, 85, 75, 255), width=int(S * 2.5))
        n = 7 if shape != "compound" else 3
        for j in range(n):
            t = 0.15 + 0.8 * j / n; side = -1 if j % 2 else 1
            px_, py_ = Wp / 2, Hp * (1 - t)
            ang = side * r.uniform(0.6, 1.1) + r.normal(0, 0.1)
            sc = (0.28 if shape != "compound" else 0.5) * r.uniform(0.85, 1.05) * (1 - 0.25 * t) * (0.62 / max(w_leaf, 0.62)) ** 0.5
            draw_leaf(dr, shape, w_leaf, px_, py_, sc, ang, r, Wp, Hp)
        draw_leaf(dr, shape, w_leaf, Wp / 2, Hp * 0.12, 0.3 if shape != "compound" else 0.5, r.normal(0, 0.1), r, Wp, Hp)
        im = im.resize((CELL, CELL), Image.LANCZOS); atlas.paste(im, (k * CELL, 0))
    atlas = bleed(atlas); atlas.save(OUT / f"twig_{shape}.png")
    cov = float((np.asarray(atlas)[..., 3] > 127).mean())
    META[f"twig_{shape}"] = dict(albedo=f"twig_{shape}.png", variants=variants, aspect=w, alpha_coverage=round(cov, 3), note="web LOD twig card (~6 leaves); greyscale + alpha")
def bleed(im):
    """dilate RGB under transparent pixels so mip-maps/alpha-clip edges don't fringe"""
    a = np.asarray(im).astype(np.float32); rgb, al = a[..., :3], a[..., 3:] / 255
    m = al[..., 0] > 0.5
    idx = ndimage.distance_transform_edt(~m, return_distances=False, return_indices=True)
    rgb2 = rgb[tuple(idx)]; out = np.concatenate([rgb2, a[..., 3:]], -1)
    return Image.fromarray(out.astype(np.uint8), "RGBA")

if __name__ == "__main__":
    paving(); asphalt(); grass(); concrete("path_concrete", "curb", 1.04, 2.0, 11); curb_stone()
    cladding(); wood(); slats(); stone_grey(); facade_bands()
    bark("bark_furrowed", "furrowed", 61); bark("bark_smooth", "smooth", 71)
    for s, w in [("ovate", 0.62), ("palmate", 1.0), ("fan", 1.0), ("compound", 0.7)]:
        leaf_atlas(s, w); twig_atlas(s, w)
    json.dump(META, open(OUT / "textures.json", "w"), indent=1)
    print(sorted(META))
