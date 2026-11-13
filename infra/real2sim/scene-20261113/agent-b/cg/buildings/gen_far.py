"""Agent B (Opus 5.5) — surrounding buildings as editable massing assets.
Near (< 40 m from the walk): dense building points; far: multi-view-triangulated sparse SfM points
(far dense depth is unreliable and was rejected).  Each cluster -> footprint polygon from 2-4 m occupancy,
extruded AWAY from the site (observed facade line + inferred depth), height = p95 above ground.
Facade material: 'facade_bands' (floor bands + glazing, world-space UV 4 m per storey).  Background massing
is LOW DETAIL by design and flagged inferred (only facades facing the site are observed, at <= 544 px).
Usage: envs/da3/bin/python cg/buildings/gen_far.py
"""
import json, sys, math, pathlib, numpy as np, triangle
from scipy import ndimage
from shapely.geometry import Polygon, MultiPolygon, box as sbox
from shapely.ops import unary_union
from shapely import affinity
HERE = pathlib.Path(__file__).resolve().parent; sys.path.insert(0, str(HERE.parent))
from common.meshio import Part, save_parts
B = HERE.parents[1]; L = B / "runs/layout"; OUT = B / "assets/buildings"
G = json.load(open(HERE.parent / "ground/ground_config.json")); RC = np.array(G["ring_center"])
rot = json.load(open(L / "rotunda_measured.json"))
rj = json.load(open(L / "raster.json")); zf = np.load(L / "ground_z.npy")
def gz(x, y):
    c = np.clip(((np.asarray(x) - rj["x0"]) / rj["res"]).astype(int), 0, rj["nx"] - 1); r = np.clip(rj["ny"] - 1 - ((np.asarray(y) - rj["y0"]) / rj["res"]).astype(int), 0, rj["ny"] - 1)
    return zf[r, c]
cams = np.load(L / "cams_world.npz"); CW = cams["C"]
def footprint_clusters(Q, cell, min_pts):
    x0, y0 = Q[:, 0].min() - cell, Q[:, 1].min() - cell
    ix = ((Q[:, 0] - x0) / cell).astype(int); iy = ((Q[:, 1] - y0) / cell).astype(int)
    occ = np.zeros((iy.max() + 2, ix.max() + 2), int); np.add.at(occ, (iy, ix), 1)
    good = occ >= min_pts; lab, n = ndimage.label(ndimage.binary_closing(good, iterations=1))
    res = []
    for k in range(1, n + 1):
        cells = np.argwhere(lab == k)
        if len(cells) < 2: continue
        poly = unary_union([sbox(x0 + c * cell, y0 + r * cell, x0 + (c + 1) * cell, y0 + (r + 1) * cell) for r, c in cells]).buffer(cell * 0.3).buffer(-cell * 0.3).simplify(cell * 0.4)
        sel = lab[iy, ix] == k; res.append((poly, Q[sel]))
    return res
def extrude(part, poly, z0, h, depth_dir, depth):
    """extend footprint away from the site by `depth` (Minkowski sweep), then extrude walls + flat roof"""
    swept = unary_union([poly, affinity.translate(poly, *(depth_dir * depth))]).convex_hull if depth > 0 else poly
    swept = swept.intersection(unary_union([poly.buffer(depth + 1), affinity.translate(poly, *(depth_dir * depth)).buffer(1)])).buffer(0)
    if isinstance(swept, MultiPolygon): swept = max(swept.geoms, key=lambda g: g.area)
    ring = np.array(swept.exterior.coords); n = len(ring) - 1
    s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(ring, axis=0), axis=1))]
    V = np.r_[np.c_[ring, np.full(n + 1, z0)], np.c_[ring, np.full(n + 1, z0 + h)]]
    UV = np.r_[np.c_[s / 6.0, np.zeros(n + 1)], np.c_[s / 6.0, np.full(n + 1, h / 4.0)]]
    F = []
    for i in range(n): F += [(i, i + 1, n + 2 + i), (i, n + 2 + i, n + 1 + i)]
    # orientation: make walls face outward (shapely exterior is CCW -> outward normals with this winding)
    part.add(V, F, UV)
    t = triangle.triangulate(dict(vertices=ring[:-1], segments=np.c_[np.arange(n), (np.arange(n) + 1) % n]), "p")
    return swept, t
out_index = []
def emit(aid, poly, Q, near, k):
    g = float(np.median(gz(Q[:, 0], Q[:, 1]))) if near else float(np.median(zf))
    h = float(np.percentile(Q[:, 2], 95) - g); h = max(h, 3.5)
    if h > 3.0 * math.sqrt(poly.area):   # tall & slender (the distant spire): keep height, shrink footprint to a slender tower
        poly = poly.centroid.buffer(max(2.5, 0.06 * h), 4)
    c = np.array(poly.centroid.coords[0]); ddir = (c - RC) / (np.linalg.norm(c - RC) + 1e-9)
    depth = min(18.0, max(6.0, math.sqrt(poly.area)))
    slender = h > 3.0 * math.sqrt(max(poly.area, 1.0)) or poly.area < 120 and h > 30
    if slender:   # distant white spire / obelisk (seen as a thin white needle on the skyline)
        wall = Part("spire", "white_stone"); roof = Part("tip", "white_stone"); b = max(2.5, 0.05 * h)
        V = [(-b, -b, 0), (b, -b, 0), (b, b, 0), (-b, b, 0), (-b * .55, -b * .55, h * .9), (b * .55, -b * .55, h * .9), (b * .55, b * .55, h * .9), (-b * .55, b * .55, h * .9)]
        F = [(0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
        wall.add(np.array(V) + [c[0], c[1], 0], F, [(v[0] / 4 + v[1] / 4, v[2] / 4) for v in V])
        roof.add(np.array([(-b * .55, -b * .55, h * .9), (b * .55, -b * .55, h * .9), (b * .55, b * .55, h * .9), (-b * .55, b * .55, h * .9), (0, 0, h)]) + [c[0], c[1], 0],
                 [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)], [(0, 0), (1, 0), (1, 1), (0, 1), (.5, .5)])
        swept = poly
    else:
        wall = Part("facade", "facade_bands"); roof = Part("roof", "facade_far")
        swept, t = extrude(wall, poly, 0.0, h, ddir, depth)
        roof.add(np.c_[t["vertices"], np.full(len(t["vertices"]), h)], t["triangles"], t["vertices"] / 8.0)
    cen = np.array([c[0], c[1], g])
    for p in (wall, roof):
        for i in range(len(p.V)): p.V[i] = p.V[i] - [c[0], c[1], 0]
    meta = dict(asset_id=aid, category="building", lod_note="background massing", generator="cg/buildings/gen_far.py",
                pivot="footprint centroid at ground, +Z up, metres", world_pivot=cen.round(3).tolist(),
                measured=dict(height_m=round(h, 2), facade_points=int(len(Q)), source="dense" if near else "sparse SfM (multi-view triangulated)"),
                inferred=["building depth away from the site", "roof shape (flat)", "facade pattern (generic floor bands)"], footprint_area_m2=round(swept.area, 1))
    d = OUT / aid; d.mkdir(parents=True, exist_ok=True)
    for lod in ("research", "web"): save_parts(d / f"{aid}_{lod}", [(wall, None, (0, 0, 0)), (roof, None, (0, 0, 0))], dict(meta, lod=lod))
    out_index.append(dict(asset_id=aid, centroid=c.round(2).tolist(), height=round(h, 2), source=meta["measured"]["source"]))
# near: dense points close to the walk (west wing + pavilion)
D = np.load(L / "dense_world.npz"); P, Lb, F = D["xyz"], D["cls"], D["frame"]
dc = np.linalg.norm(P - CW[F.astype(int) - 1], axis=1)
rr = np.hypot(P[:, 0] - rot["center"][0], P[:, 1] - rot["center"][1])
near = (Lb == 2) & (dc < 40) & (rr > rot["outer_radius"] + 5) & (np.hypot(P[:, 0] - RC[0], P[:, 1] - RC[1]) > G["plaza_inner_r"])
k = 0
for poly, Q in footprint_clusters(P[near][::3], 2.0, 25):
    if poly.area < 20: continue
    k += 1; emit(f"bldg_near_{k:02d}", poly, Q, True, k)
# far: sparse points
S = np.load(L / "points_world.npz"); SP, SC = S["xyz"], S["cls"]
rs = np.hypot(SP[:, 0] - RC[0], SP[:, 1] - RC[1])
far = (SC == 2) & (rs > G["plaza_outer_r"] + 15) & (np.hypot(SP[:, 0] - rot["center"][0], SP[:, 1] - rot["center"][1]) > rot["outer_radius"] + 8) & (rs < 700) & (SP[:, 2] > -5) & (SP[:, 2] < 80)
j = 0
for poly, Q in footprint_clusters(SP[far], 6.0, 3):
    if poly.area < 60 or len(Q) < 12: continue
    cpt = np.array(poly.centroid.coords[0])
    if np.min(np.linalg.norm(CW[:, :2] - cpt, axis=1)) < 25: continue      # too close to the walk: would have dense evidence; sparse cluster = clutter
    j += 1; emit(f"bldg_far_{j:02d}", poly, Q, False, j)
json.dump(out_index, open(OUT / "surrounding_index.json", "w"), indent=1)
print("near", k, "far", j, out_index[:6])
