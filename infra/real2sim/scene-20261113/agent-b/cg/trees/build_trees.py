"""Agent B (Opus 5.5) — build every measured tree as an independent asset (research + web LOD).
Inputs : runs/layout/trees_refined.json (per-individual measurements), cg/trees/species.json, cg/trees/assignments.json
Outputs: assets/trees/<asset_id>/<asset_id>_{research,web}.parts.npz/.json  and assets/trees/trees_index.json
Every asset: local frame origin = root collar (ground contact), +Z up, metres, world azimuth preserved
(rotation 0 places it as observed). Seeds: 1000 + index.
Usage: envs/da3/bin/python cg/trees/build_trees.py [only_idx,...]
"""
import json, sys, pathlib, numpy as np
from multiprocessing import Pool
HERE = pathlib.Path(__file__).resolve().parent; sys.path.insert(0, str(HERE.parent)); sys.path.insert(0, str(HERE))
import treegen
from common.meshio import save_parts
B = HERE.parents[1]; OUT = B / "assets/trees"
SP = json.load(open(HERE / "species.json"))
TXJ = json.load(open(HERE.parents[1] / "assets/textures/textures.json")); AS = json.load(open(HERE / "assignments.json"))
TR = json.load(open(B / "runs/layout/trees_refined.json"))
def species_of(i):
    for s, ids in AS["groups"].items():
        if i in ids: return s
    return AS["default"]
def s2l(c):
    c = np.asarray(c, np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def reconcile_height(t):
    hs, hd = t["height"], t.get("height_depth_p98", t["height"])
    r = hs / max(hd, 0.1)
    if 0.75 <= r <= 1.3: return hs, "silhouette_median"
    return float(np.sqrt(hs * hd) if r < 0.75 else hd * 1.08), "blend_depth_silhouette"
def params(i):
    t = dict(TR[i]); t.update(AS.get("overrides", {}).get(str(i), {}))
    sp = species_of(i); pr = dict(SP[sp])
    H, hsrc = reconcile_height(t)
    prof = np.array(t["crown_profile"]) * t.get("crown_profile_scale", 1.0)
    prof = np.clip(prof, 0.4, 0.55 * H + 1.0)
    # taper top row to an apex (profile bins are p90 radii of slices; the very top slice is narrower)
    prof = np.vstack([prof, prof[-1:] * 0.35])
    # measured crown colour is RADIANCE (sky light x self-shadowing), not albedo: invert with a mean crown
    # irradiance factor (~0.25) -> leaf albedo, clamped to the physical range of green/autumn leaves
    pal = s2l(t["palette_srgb"]); w_ = np.asarray(t["palette_w"], float)
    lum = pal @ [0.2126, 0.7152, 0.0722]; sat = (pal.max(1) - pal.min(1)) / np.maximum(pal.max(1), 1e-4)
    keep = ~((lum > 0.35) & (sat < 0.35))            # bright, grey clusters = sky leaking through crown masks
    if keep.sum() >= 2: pal, w_, lum = pal[keep], w_[keep], lum[keep]
    mlum = float((lum * w_).sum() / w_.sum()); target = float(np.clip(mlum * 7.2, 0.09, 0.35))   # x7.2: calibrated on same-camera crown brightness (iter05: CG/real ~0.55 linear)
    lum_new = target * (lum / max(mlum, 1e-4)) ** 0.5   # compress the spread (shadowed vs lit clusters)
    pal = pal / np.maximum(lum, 1e-4)[:, None] * lum_new[:, None]
    lum = (pal @ [0.2126, 0.7152, 0.0722])[:, None]; pal = lum + (pal - lum) * 1.6   # undo video haze desaturation
    if sp in ("broadleaf", "camphor", "ginkgo_young"):
        # video crown colours carry a blue cast (sky light through/around leaves): keep hue in the leaf
        # yellow-green..green band (55-115 deg); red maple / purple plum keep their measured hues
        import colorsys
        fixed = []
        for c in np.clip(pal, 0, 1):
            h_, s_, v_ = colorsys.rgb_to_hsv(*c); hd = h_ * 360
            if not (55 <= hd <= 115): hd = 115 if 115 < hd < 240 else 55
            fixed.append(colorsys.hsv_to_rgb(hd / 360, max(s_, 0.35), v_))
        pal = np.array(fixed)
    t = dict(t, palette_w=(w_ / w_.sum()).round(4).tolist())
    p = dict(pr)
    p.update(seed=1000 + i, height=round(H, 2), crown_base=float(min(t["crown_base"], 0.5 * H)), crown_profile=np.round(prof, 3).tolist(),
             dbh=round(pr["dbh_per_m"] * H, 3), leaf_palette=np.clip(pal, 0, 1).round(4).tolist(), leaf_palette_w=t["palette_w"],
             card_coverage={pr["leaf_shape"]: TXJ[f"leaf_{pr['leaf_shape']}"]["alpha_coverage"], "twig": TXJ[f"twig_{pr['leaf_shape']}"]["alpha_coverage"]},
             whitewash_height=1.1 if t.get("whitewash") else 0.0, bark_material=f"bark_{sp}", leaf_material=f"leaf_{sp}")
    # trunk lean from crown offset (crown centroid vs root collar)
    return sp, p, t, hsrc
def build(i):
    sp, p, t, hsrc = params(i)
    aid = f"tree_{i:02d}_{sp}"; d = OUT / aid; d.mkdir(parents=True, exist_ok=True)
    out = {}
    for lod in ("research", "web"):
        q = dict(p); q["leaf_mode"] = "leaf" if lod == "research" else "twig"
        if lod == "web": q["leaf_material"] = f"twig_{sp}"; q["twig_size"] = p["twig_size"] * 2.0   # web budget: 1/4 cards
        wood, leaves, stats, white = treegen.build(q)
        parts = [(wood, None, (0, 0, 0)), (leaves, None, (0, 0, 0))] + ([(white, None, (0, 0, 0))] if white is not None and white.n else [])
        meta = dict(asset_id=aid, lod=lod, category="tree", species_preset=sp, species_label=SP[sp]["label"],
                    generator="cg/trees/treegen.py (space colonisation + pipe model)", params=q, stats=stats,
                    pivot="root collar (ground contact), +Z up, metres", world_azimuth_preserved=True,
                    measured=dict(x=t["x"], y=t["y"], ground_z=t["ground_z"], height_m=p["height"], height_source=hsrc,
                                  height_views=t.get("height_views"), crown_profile_inferred_bins=t.get("crown_profile_inferred_bins"),
                                  ref_frame=t.get("ref_frame"), n_frames=t.get("n_frames")),
                    provenance="position/height/crown envelope/colour measured from video reconstruction; branching, leaves and bark are generated (not recovered from video)",
                    inferred=["species/habit (visual inference)", "branch topology (space colonisation, seeded)", "leaf shape & size (species preset)", "bark texture", "unseen crown sides (profile bins filled from neighbours)"])
        save_parts(d / f"{aid}_{lod}", parts, meta); out[lod] = stats
    return dict(idx=i, asset_id=aid, species=sp, x=t["x"], y=t["y"], z=t["ground_z"], height=p["height"], stats=out)
if __name__ == "__main__":
    ids = [int(a) for a in sys.argv[1].split(",")] if len(sys.argv) > 1 else list(range(len(TR)))
    with Pool(min(32, len(ids))) as pool: res = pool.map(build, ids)
    if len(ids) == len(TR): json.dump(res, open(OUT / "trees_index.json", "w"), indent=1)
    for r in res[:5]: print(r)
    print(len(res), "trees built; total research leaves", sum(r["stats"]["research"]["leaves"] for r in res), "web cards", sum(r["stats"]["web"]["leaves"] for r in res))
