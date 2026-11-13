"""Agent B (Opus 5.5) — ground assets from the reconstructed top-down class/height rasters.

Regions (each connected component = independent asset, pivot = centroid at ground level, local metres, +Z up):
  plaza (granite slabs, POLAR running-bond UV around the measured ring centre: joints follow the ring
  tangent within 2.5 deg at 3 test patches), paths (light concrete inside lawns), lawns, roads (asphalt),
  curbs (extruded granite kerbs), road markings (crosswalk stripes detected from bright road pixels;
  yellow edge lines generated along road/curb borders), terrain_base (inferred infill: under/around all,
  slightly lower) and the rotunda apron (inferred from end-of-video frames).
Heights: hole-filled, heavily smoothed reconstructed ground height + class offsets (kerb +0.13, road -0.12).
Usage: envs/da3/bin/python cg/ground/build_ground.py
"""
import json, sys, math, pathlib, numpy as np, triangle
from scipy import ndimage
from skimage import measure
from shapely.geometry import Polygon, MultiPolygon, LineString, Point
from shapely.ops import unary_union
from PIL import Image
HERE = pathlib.Path(__file__).resolve().parent; sys.path.insert(0, str(HERE.parent))
from common.meshio import Part, save_parts
B = HERE.parents[1]; L = B / "runs/layout"; OUT = B / "assets/ground"; OUT.mkdir(parents=True, exist_ok=True)
CFG = json.load(open(HERE / "ground_config.json"))
rj = json.load(open(L / "raster.json")); RES = rj["res"]; X0, Y0, NX, NY = rj["x0"], rj["y0"], rj["nx"], rj["ny"]
cls = np.load(L / "raster_cls.npy"); zf = np.load(L / "ground_z.npy"); rgb = np.asarray(Image.open(L / "raster_rgb.png")).astype(np.float32)
TEX = json.load(open(B / "assets/textures/textures.json"))
RC = np.array(CFG["ring_center"]); ROT = np.array(CFG["rotunda_center"])
zs = ndimage.gaussian_filter(zf, CFG["height_smooth_m"] / RES)
def z_at(x, y):
    c = np.clip((np.asarray(x) - X0) / RES, 0, NX - 1.001); r = np.clip(NY - 1 - (np.asarray(y) - Y0) / RES, 0, NY - 1.001)
    return ndimage.map_coordinates(zs, [r, c], order=1, mode="nearest")
def to_world(rr, cc): return X0 + (cc + .5) * RES, Y0 + (NY - 1 - rr + .5) * RES
# ---------------- class map cleanup + inferred infill ----------------
yy, xx = np.mgrid[0:NY, 0:NX]; WX, WY = to_world(yy, xx)
rad = np.hypot(WX - RC[0], WY - RC[1]); rrot = np.hypot(WX - ROT[0], WY - ROT[1])
c = cls.copy()
c = ndimage.median_filter(c, 5)
known = c > 0
inferred = np.zeros_like(c, bool)
inner = (rad < CFG["plaza_inner_r"] - 1.0) & ~known
c[inner] = 3; inferred |= inner                                              # inner lawn (unobserved) -> lawn
apron = (rrot < CFG["rotunda_radius"] + CFG["rotunda_apron_m"]); c[apron & (c != 5)] = 4; inferred |= apron & ~known
# paving inside the plaza band is plaza; paving elsewhere (in lawn) is path
PLAZA, PATH, LAWN, ROAD, CURB = "plaza", "path", "lawn", "road", "curb"
masks = {ROAD: c == 5, CURB: c == 6, LAWN: c == 3}
pav = c == 4
band = (rad > CFG["plaza_inner_r"]) & (rad < CFG["plaza_outer_r"])
masks[PLAZA] = pav & (band | (rrot < CFG["rotunda_radius"] + CFG["rotunda_apron_m"]) | (WX < CFG["spur_x_max"]))
masks[PATH] = pav & ~masks[PLAZA]
def clean(m, close=3, open_=2, min_m2=4.0):
    m = ndimage.binary_closing(m, iterations=close); m = ndimage.binary_opening(m, iterations=open_)
    lab, n = ndimage.label(m); sz = ndimage.sum(m, lab, range(1, n + 1))
    return np.isin(lab, 1 + np.nonzero(sz * RES * RES >= min_m2)[0])
def polys(m, simplify=0.08, smooth=0.25, min_area=4.0):
    m = ndimage.gaussian_filter(m.astype(np.float32), 1.0)
    out = []
    lab, n = ndimage.label(m > 0.5)
    for k in range(1, n + 1):
        sub = np.pad(lab == k, 1)
        cs = measure.find_contours(sub.astype(np.float32), 0.5)
        rings = []
        for cc in cs:
            x, y = to_world(cc[:, 0] - 1, cc[:, 1] - 1); p = Polygon(np.c_[x, y])
            if p.is_valid and p.area > 0.5: rings.append(p)
            elif not p.is_valid:
                p = p.buffer(0)
                if p.area > 0.5: rings.append(p)
        if not rings: continue
        rings.sort(key=lambda p: -p.area); P = rings[0]
        for h in rings[1:]:
            if P.contains(h.representative_point()): P = P.difference(h)
        P = P.buffer(smooth).buffer(-smooth).simplify(simplify)
        for g in (P.geoms if isinstance(P, MultiPolygon) else [P]):
            if g.area >= min_area: out.append(g)
    return out
order = [ROAD, CURB, PLAZA, PATH, LAWN]
geo = {}; taken = None
# ---------------- parametric south-west road (only its lawn-side edge was observed) ----------------
SW = CFG["sw_road"]
def polar_band(phi, ra, rb):
    a = np.c_[RC[0] + ra * np.cos(phi), RC[1] + ra * np.sin(phi)]; b = np.c_[RC[0] + rb * np.cos(phi), RC[1] + rb * np.sin(phi)]
    return Polygon(np.r_[a, b[::-1]]).buffer(0)
def polar_road(center, phi_rng, side_w, rmax=None):
    """road band whose lawn/apron-side kerb radius r(phi) (around `center`) is the 15th percentile of
    observed road-edge cells per 1 deg bin; returns dict of band polygons + profile"""
    lawnish = np.isin(c, [3, 4, 6]); edge = (c == 5) & ndimage.binary_dilation(lawnish, iterations=8)
    ER, EC = np.nonzero(edge); ex, ey = to_world(ER, EC)
    eph = np.degrees(np.arctan2(ey - center[1], ex - center[0])); erad = np.hypot(ex - center[0], ey - center[1])
    if rmax is not None: keep = erad < rmax; eph, erad = eph[keep], erad[keep]
    bins = np.arange(phi_rng[0], phi_rng[1] + 0.5, 1.0); rl = np.full(len(bins), np.nan)
    for i, b_ in enumerate(bins):
        s_ = np.abs(((eph - b_ + 180) % 360) - 180) < 0.6
        if s_.sum() > 5: rl[i] = np.percentile(erad[s_], 15)
    ok = np.isfinite(rl); rl = np.interp(bins, bins[ok], rl[ok]); rl = ndimage.gaussian_filter1d(ndimage.median_filter(rl, 7), 3)
    ph = np.radians(np.linspace(bins[0], bins[-1], len(bins) * 4)); r_ = np.interp(np.degrees(ph), bins, rl)
    def band(ra, rb):
        A = np.c_[center[0] + ra * np.cos(ph), center[1] + ra * np.sin(ph)]; B_ = np.c_[center[0] + rb * np.cos(ph), center[1] + rb * np.sin(ph)]
        return Polygon(np.r_[A, B_[::-1]]).buffer(0)
    K, Wr = SW["kerb_w"], SW["road_w"]
    g = dict(kerb=band(r_, r_ + K), road=band(r_ + K, r_ + K + Wr), kerb_far=band(r_ + K + Wr, r_ + 2 * K + Wr),
             sidewalk_far=band(r_ + 2 * K + Wr, r_ + 2 * K + Wr + SW["far_sidewalk_w"]))
    if side_w > 0: g["sidewalk"] = band(r_ - side_w, r_)
    return g, dict(center=list(map(float, center)), phi_deg=bins.tolist(), kerb_radius=np.round(rl, 3).tolist())
sw_geo, prof1 = polar_road(RC, SW["phi_deg"], SW["sidewalk_w"])
RR = CFG["rotunda_road"]
rot_geo, prof2 = polar_road(ROT, RR["phi_deg"], 0.0, rmax=CFG["rotunda_radius"] + 15)
json.dump(dict(ring_road=prof1, rotunda_road=prof2, widths=SW), open(L / "road_profiles.json", "w"))
taken = unary_union(list(sw_geo.values()) + list(rot_geo.values()))
for k in order:
    ps = polys(clean(masks[k], min_m2=CFG["min_region_m2"][k]), min_area=CFG["min_region_m2"][k])
    if taken is not None: ps = [p.difference(taken) for p in ps]
    flat = []
    for p in ps:
        for g in (p.geoms if hasattr(p, "geoms") else [p]):
            if g.geom_type == "Polygon" and g.area >= CFG["min_region_m2"][k]: flat.append(g)
    geo[k] = flat; u = unary_union(flat) if flat else None
    taken = u if taken is None else (taken.union(u) if u is not None else taken)
SIDEWALK = "sidewalk"; geo[SIDEWALK] = []
for gg in (sw_geo, rot_geo):
    geo[ROAD].append(gg["road"]); geo[CURB] += [gg["kerb"], gg["kerb_far"]]; geo[SIDEWALK] += [gg[k] for k in ("sidewalk", "sidewalk_far") if k in gg]
# ---------------- meshing ----------------
def _clean_ring(coords, tol=0.02):
    out = []
    for c in list(coords)[:-1]:
        if not out or math.dist(out[-1], c) > tol: out.append(c)
    if len(out) > 2 and math.dist(out[0], out[-1]) <= tol: out.pop()
    return out
def tri_polygon(P, max_area):
    """constrained quality triangulation; polygon cleaned first and Steiner points capped so it always terminates"""
    P = P.buffer(0).simplify(0.03)
    if P.geom_type == "MultiPolygon": P = max(P.geoms, key=lambda q: q.area)
    verts, segs, holes = [], [], []
    def add_ring(coords):
        cs = _clean_ring(coords); s = len(verts); verts.extend(cs)
        segs.extend([(s + i, s + (i + 1) % len(cs)) for i in range(len(cs))])
    add_ring(P.exterior.coords)
    for h in P.interiors:
        hp = Polygon(h)
        if hp.area < 0.05: continue
        add_ring(h.coords); rp = hp.representative_point(); holes.append((rp.x, rp.y))
    d = dict(vertices=np.array(verts), segments=np.array(segs))
    if holes: d["holes"] = np.array(holes)
    cap = int(P.area / max_area * 4) + 200
    t = triangle.triangulate(d, f"pq20a{max_area}S{cap}")
    return t["vertices"], t["triangles"]
def uv_for(kind, x, y):
    if kind == SIDEWALK:
        r = np.hypot(x - RC[0], y - RC[1]); ph = np.arctan2(y - RC[1], x - RC[0]); return np.c_[ph * r / 1.0, r / 1.0]
    if kind == PLAZA:  # polar running bond: u along tangent (arc length), v radial
        r = np.hypot(x - RC[0], y - RC[1]); ph = np.arctan2(y - RC[1], x - RC[0])
        tw, th = TEX["paving_granite"]["tile_m"]; return np.c_[ph * CFG["plaza_mid_r"] / tw, r / th]
    tile = {"far": 20.0, PATH: TEX["path_concrete"]["tile_m"][0], LAWN: TEX["lawn"]["tile_m"][0], ROAD: TEX["asphalt"]["tile_m"][0], CURB: 1.0, "base": TEX["lawn"]["tile_m"][0]}[kind]
    return np.c_[x / tile, y / tile]
MAT = {"far": "ground_far", "sidewalk": "curb", PLAZA: "paving", PATH: "path_concrete", LAWN: "lawn", ROAD: "asphalt", CURB: "curb", "base": "lawn"}
OFF = CFG["z_offsets"]
index = []
def emit(asset_id, kind, P, extra_meta=None, parts_extra=None):
    V2, T = tri_polygon(P, CFG["max_tri_area"][kind] if kind in CFG["max_tri_area"] else 2.0)
    z = z_at(V2[:, 0], V2[:, 1]) + OFF.get(kind, 0.0)
    cen = np.array([P.centroid.x, P.centroid.y, float(np.median(z))])
    V = np.c_[V2, z] - cen; UV = uv_for(kind, V2[:, 0], V2[:, 1])
    # macro variation (world-space, 12-25 m wavelengths) as vertex colour: breaks texture tiling, survives glTF (COLOR_0)
    amp = {LAWN: 0.14, "base": 0.16, PLAZA: 0.05, PATH: 0.05}.get(kind, 0.0)
    if amp:
        x_, y_ = V2[:, 0], V2[:, 1]
        nz = (np.sin(x_ / 11.0 + 1.3) * np.cos(y_ / 13.0 - 0.7) + 0.6 * np.sin((x_ + y_) / 23.0 + 2.1) + 0.4 * np.cos((x_ - 0.6 * y_) / 7.0)) / 2.0
        tint = np.c_[1 + amp * nz, 1 + amp * nz * 0.9, 1 + amp * nz * (0.4 if kind in (LAWN, "base") else 1.0)]
        COL = np.c_[np.clip(tint, 0, 1.3) / 1.3 * (1.3 / (1 + amp)), np.ones(len(V2))]
    else: COL = None
    part = Part("surface", MAT[kind]); part.add(V, T, UV, COL)
    parts = [(part, None, (0, 0, 0))]
    if kind == CURB or kind in CFG.get("skirted", []):  # side walls down to road level
        h = 0.16 if kind in (CURB, "sidewalk") else 0.06
        side = Part("sides", MAT[kind]); ring = np.array(P.exterior.coords)
        zt = z_at(ring[:, 0], ring[:, 1]) + OFF.get(kind, 0.0); Vt = np.c_[ring, zt] - cen; Vb = Vt - [0, 0, h]
        n = len(ring); SV = np.vstack([Vt, Vb]); F = []
        for i in range(n - 1): F += [(i, i + 1, n + i + 1), (i, n + i + 1, n + i)]
        s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(ring, axis=0), axis=1))]
        side.add(SV, F, np.r_[np.c_[s, np.zeros(n)], np.c_[s, np.full(n, h)]]); parts.append((side, None, (0, 0, 0)))
    if parts_extra: parts += parts_extra
    meta = dict(asset_id=asset_id, category="ground", kind=kind, material=MAT[kind], pivot="region centroid at median ground height, +Z up, metres",
                world_pivot=cen.round(3).tolist(), area_m2=round(P.area, 2), generator="cg/ground/build_ground.py",
                provenance=f"outline from SAM3-labelled dense reconstruction rasterised at {RES} m; heights smoothed {CFG['height_smooth_m']} m",
                inferred_fraction=None)
    if extra_meta: meta.update(extra_meta)
    d = OUT / asset_id; d.mkdir(exist_ok=True)
    save_parts(d / f"{asset_id}_research", parts, dict(meta, lod="research")); save_parts(d / f"{asset_id}_web", parts, dict(meta, lod="web"))
    index.append(dict(asset_id=asset_id, kind=kind, pivot=cen.round(3).tolist(), area_m2=round(P.area, 1)))
inf_frac = lambda P: None
for kind in order + [SIDEWALK]:
    for i, P in enumerate(sorted(geo[kind], key=lambda p: -p.area)):
        # fraction of polygon area that was inferred infill
        b = P.bounds; c0 = int((b[0] - X0) / RES); c1 = int((b[2] - X0) / RES) + 1; r0 = int(NY - 1 - (b[3] - Y0) / RES); r1 = int(NY - 1 - (b[1] - Y0) / RES) + 1
        frac = float(inferred[max(r0, 0):r1, max(c0, 0):c1].mean()) if r1 > r0 and c1 > c0 else 0.0
        emit(f"{kind}_{i + 1:02d}", kind, P, dict(inferred_fraction_bbox=round(frac, 3)))
# ---------------- terrain base (inferred infill, lower, under everything) ----------------
near_site = Point(*RC).buffer(CFG["near_site_radius"]).union(Point(CFG["spur_far"][0], CFG["spur_far"][1]).buffer(30)).convex_hull
emit("terrain_base", "base", near_site, dict(inferred=True, note="conservative infill under/around observed regions; lawn-like; not observed in video"))
far_ring = Point(*RC).buffer(CFG["site_radius"], 64).difference(near_site.buffer(-0.5))
emit("terrain_far", "far", far_ring, dict(inferred=True, note="distant ground to close the horizon (hazy grey-green, inferred)"))
# ---------------- markings ----------------
def bright_components(mask, min_px=6):
    lab, n = ndimage.label(mask); out = []
    for k in range(1, n + 1):
        rr, cc = np.nonzero(lab == k)
        if len(rr) < min_px: continue
        x, y = to_world(rr, cc); out.append(MultiPolygon([Point(a, b).buffer(RES * 0.75, 4) for a, b in zip(x, y)]).buffer(0).minimum_rotated_rectangle)
    return out
road_mask = c == 5; lum = rgb.mean(2); sat = rgb.max(2) - rgb.min(2)
white = road_mask & (lum > CFG["marking_white_lum"]) & (sat < 30)
stripes = [r for r in bright_components(ndimage.binary_opening(white)) if 0.6 < r.area < 6.0]
mk = Part("crosswalk", "paint_white")
for r in stripes:
    V2, T = tri_polygon(r, 1.0); mk.add(np.c_[V2, z_at(V2[:, 0], V2[:, 1]) + OFF[ROAD] + 0.006], T, V2)
ye = Part("edge_lines", "paint_yellow")
curbs = unary_union(geo[CURB]) if geo[CURB] else None; nonroad = unary_union(geo[LAWN] + geo[PLAZA] + geo[PATH] + geo[CURB])
for P in geo[ROAD]:
    inner = P.buffer(-CFG["yellow_offset"])
    for g in (inner.geoms if hasattr(inner, "geoms") else [inner]):
        ln = g.exterior
        segs = [ln.interpolate(t) for t in np.arange(0, ln.length, 0.5)]
        keep = [nonroad.distance(Point(p.x, p.y)) < CFG["yellow_offset"] + 1.2 for p in segs]
        run = []
        for p, k in zip(segs + [None], keep + [False]):
            if k: run.append((p.x, p.y))
            elif len(run) > 4:
                line = LineString(run).buffer(0.075, cap_style=2)
                for gg in (line.geoms if hasattr(line, "geoms") else [line]):
                    V2, T = tri_polygon(gg, 0.5); ye.add(np.c_[V2, z_at(V2[:, 0], V2[:, 1]) + OFF[ROAD] + 0.006], T, V2)
                run = []
            else: run = []
cen = np.array([CFG["spur_far"][0], CFG["spur_far"][1], 0.0])
for p in (mk, ye):
    for k in range(len(p.V)): p.V[k] = p.V[k] - cen
meta = dict(asset_id="road_markings", category="ground", kind="markings", world_pivot=cen.tolist(), generator="cg/ground/build_ground.py",
            provenance=f"crosswalk stripes = rectangles fitted to bright road pixels of the reconstructed orthophoto ({len(stripes)} found); yellow edge lines generated {CFG['yellow_offset']} m inside road edges where they meet kerb/lawn/plaza")
d = OUT / "road_markings"; d.mkdir(exist_ok=True)
save_parts(d / "road_markings_research", [(mk, None, (0, 0, 0)), (ye, None, (0, 0, 0))], dict(meta, lod="research"))
save_parts(d / "road_markings_web", [(mk, None, (0, 0, 0)), (ye, None, (0, 0, 0))], dict(meta, lod="web"))
index.append(dict(asset_id="road_markings", kind="markings", pivot=cen.tolist()))
json.dump(index, open(OUT / "ground_index.json", "w"), indent=1)
print({k: len(v) for k, v in geo.items()}, "stripes", len(stripes), "assets", len(index))
# debug plot
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(16, 14)); colr = {ROAD: "#444", CURB: "#d90", PLAZA: "#bbb", PATH: "#eee", LAWN: "#7c5", "sidewalk": "#dcb"}
for k, ps in geo.items():
    for p in ps:
        ax.fill(*p.exterior.xy, color=colr[k], ec="k", lw=.3)
for r in stripes: ax.fill(*r.exterior.xy, color="w", ec="r", lw=.3)
ax.set_aspect("equal"); fig.savefig(L / "ground_regions.png", dpi=110, bbox_inches="tight")
