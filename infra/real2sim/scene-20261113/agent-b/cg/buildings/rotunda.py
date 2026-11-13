"""Agent B (Opus 5.5) — parametric rotunda (the large colonnaded drum building).

Measured (runs/layout/rotunda_measured.json): colonnade outer radius 38.83 m, centre, ground level,
cornice ~11 m, eccentric upper louvred drum (R 25.66 m, centre offset ~10 m SW), top ~21.3 m.
Estimated from frames (not measurable directly): pier count 40 (+-4, from apparent pier pitch),
pier section, glass line, spandrel band, plinth steps, fin pitch.  Unseen far side mirrors the seen side (inferred).
Hierarchy (independent sub-objects): plinth, piers (40 instances of one mesh), glass_wall, mullions (instances),
spandrel_wood, soffit, cornice, roof_terrace, upper_drum_core, upper_fins (instances), upper_cap.
Local frame: origin = colonnade centre at plinth bottom (ground), +Z up, metres, world-aligned axes.
Usage: envs/da3/bin/python cg/buildings/rotunda.py
"""
import json, math, sys, pathlib, numpy as np
HERE = pathlib.Path(__file__).resolve().parent; sys.path.insert(0, str(HERE.parent))
from common.meshio import Part, save_parts
B = HERE.parents[1]; M = json.load(open(B / "runs/layout/rotunda_measured.json"))
P = dict(R=M["outer_radius"], n_piers=40, pier_w=1.25, pier_d=2.3, pier_round=0.62, plinth_out=3.2, step_h=0.15, n_steps=3,
         glass_inset=3.8, glass_top=8.7, cornice_bot=10.55, cornice_top=11.6, cornice_overhang=0.35, mullion_pitch=1.6,
         upper_offset=[M["upper_center"][0] - M["center"][0], M["upper_center"][1] - M["center"][1]], upper_R=M["upper_radius"],
         upper_top=M["upper_top_h"] - 0.9, upper_cap=0.9, fin_pitch=0.55, fin_depth=0.35, fin_w=0.08, seg=256)
TEX = json.load(open(B / "assets/textures/textures.json"))
def ring_band(part, r0, r1, z0, z1, seg, cx=0.0, cy=0.0, uvtile=1.2, inward=False):
    """vertical cylinder wall (r0==r1) or horizontal annulus (z0==z1) or a conical band"""
    th = np.linspace(0, 2 * np.pi, seg + 1); V, UV, F = [], [], []
    for (r, z) in ((r0, z0), (r1, z1)):
        for t in th:
            V.append((cx + r * math.cos(t), cy + r * math.sin(t), z))
            UV.append((t * max(r0, r1) / uvtile, (z if z0 != z1 else r) / uvtile))
    for i in range(seg):
        a, b, c, d = i, i + 1, seg + 1 + i + 1, seg + 1 + i
        F += [(a, c, b), (a, d, c)] if inward else [(a, b, c), (a, c, d)]
    part.add(V, F, UV)
def disk(part, r, z, seg, cx=0.0, cy=0.0, down=False, uvtile=2.4):
    th = np.linspace(0, 2 * np.pi, seg + 1)[:-1]
    V = [(cx, cy, z)] + [(cx + r * math.cos(t), cy + r * math.sin(t), z) for t in th]
    F = [(0, i + 1, (i + 1) % seg + 1) if not down else (0, (i + 1) % seg + 1, i + 1) for i in range(seg)]
    part.add(V, F, [(v[0] / uvtile, v[1] / uvtile) for v in V])
def pier_mesh():
    """rounded-front blade pier, local: x = radial (outer face at x=0, extends to -d), y = tangential, z up"""
    w, d, rr, h0, h1 = P["pier_w"], P["pier_d"], P["pier_round"], 0.0, P["cornice_bot"]
    prof = []
    for t in np.linspace(-np.pi / 2, np.pi / 2, 9): prof.append((-rr + rr * math.cos(t) * 1.0, (w / 2) * math.sin(t)))  # rounded front
    prof += [(-d, w / 2 * 0.92), (-d, -w / 2 * 0.92)]
    prof = prof[::-1] if False else prof
    n = len(prof); V, F, UV = [], [], []
    per = np.r_[0, np.cumsum([math.dist(prof[i], prof[(i + 1) % n]) for i in range(n)])]
    for z in (h0, h1):
        for i, (x, y) in enumerate(prof): V.append((x, y, z)); UV.append((per[i] / 1.2, z / 1.2))
    for i in range(n):
        j = (i + 1) % n; F += [(i, n + j, j), (i, n + i, n + j)]
    pm = Part("pier", "white_stone"); pm.add(V, F, UV)
    # caps
    cap = [(x, y, h1) for x, y in prof]; pm.add(cap, [(0, i, i + 1) for i in range(1, n - 1)], [(x, y) for x, y in prof])
    return pm
def build():
    R = P["R"]; seg = P["seg"]; parts = []
    # plinth with steps
    pl = Part("plinth", "paving")
    zt = P["n_steps"] * P["step_h"]
    for k in range(P["n_steps"]):
        r = R + P["plinth_out"] - k * 0.4; z = (k + 1) * P["step_h"]
        ring_band(pl, r, r, z - P["step_h"], z, seg); disk(pl, r, z, seg) if k == P["n_steps"] - 1 else ring_band(pl, r, r - 0.4, z, z, seg)
    parts.append((pl, None, (0, 0, 0)))
    pm = pier_mesh(); pm.instances = []
    for k in range(P["n_piers"]):
        t = 2 * math.pi * (k + 0.5) / P["n_piers"]
        pm.instances.append(((R * math.cos(t), R * math.sin(t), zt), t, (1, 1, 1)))
    parts.append((pm, None, (0, 0, 0)))
    rg = R - P["glass_inset"]
    gl = Part("glass_wall", "glass"); ring_band(gl, rg, rg, zt, P["glass_top"], seg); parts.append((gl, None, (0, 0, 0)))
    mu = Part("mullion", "metal_dark"); mh = P["glass_top"] - zt
    from common.meshio import box
    V, F, UV = box(0, 0, mh / 2, 0.12, 0.08, mh); mu.add(V, F, UV)
    V, F, UV = box(0, 0, 3.0 - zt, 0.1, 0.07, 0.08); mu.add(V, F, UV)  # transom piece per bay (door head height)
    nm = int(2 * math.pi * rg / P["mullion_pitch"]); mu.instances = []
    for k in range(nm):
        t = 2 * math.pi * k / nm; mu.instances.append(((rg * math.cos(t) + 0.05 * math.cos(t), (rg + 0.05) * math.sin(t), zt), t, (1, 1, 1)))
    parts.append((mu, None, (0, 0, 0)))
    sp = Part("spandrel_wood", "wood"); ring_band(sp, rg, rg, P["glass_top"], P["cornice_bot"], seg); parts.append((sp, None, (0, 0, 0)))
    so = Part("soffit", "white_stone"); ring_band(so, rg, R + P["cornice_overhang"], P["cornice_bot"], P["cornice_bot"], seg, inward=True); parts.append((so, None, (0, 0, 0)))
    co = Part("cornice", "white_stone"); ro = R + P["cornice_overhang"]
    ring_band(co, ro, ro, P["cornice_bot"], P["cornice_top"], seg); parts.append((co, None, (0, 0, 0)))
    # roof terrace (annulus between cornice and the eccentric upper drum is a disk; drum sits on it)
    rf = Part("roof_terrace", "white_stone"); disk(rf, ro, P["cornice_top"], seg); ring_band(rf, ro, ro - 0.5, P["cornice_top"], P["cornice_top"], seg)
    parts.append((rf, None, (0, 0, 0)))
    ux, uy = P["upper_offset"]; ur = P["upper_R"]; z0, z1 = P["cornice_top"], P["upper_top"]
    uc = Part("upper_drum_core", "white_stone"); ring_band(uc, ur - P["fin_depth"], ur - P["fin_depth"], z0, z1, seg, ux, uy); parts.append((uc, None, (0, 0, 0)))
    fn = Part("upper_fin", "white_stone"); V, F, UV = box(-P["fin_depth"] / 2, 0, (z1 - z0) / 2, P["fin_depth"], P["fin_w"], z1 - z0); fn.add(V, F, UV)
    nf = int(2 * math.pi * ur / P["fin_pitch"]); fn.instances = []
    for k in range(nf):
        t = 2 * math.pi * k / nf; fn.instances.append(((ux + ur * math.cos(t), uy + ur * math.sin(t), z0), t, (1, 1, 1)))
    parts.append((fn, None, (0, 0, 0)))
    cap = Part("upper_cap", "white_stone")
    # rounded top edge (quarter round 0.9 m) + flat roof
    prev = None
    for k in range(7):
        a = k / 6 * math.pi / 2; r = ur - P["upper_cap"] * (1 - math.cos(a)); z = z1 + P["upper_cap"] * math.sin(a)
        if prev: ring_band(cap, prev[0], r, prev[1], z, seg, ux, uy)
        prev = (r, z)
    disk(cap, prev[0], prev[1], seg, ux, uy); parts.append((cap, None, (0, 0, 0)))
    meta = dict(asset_id="bldg_rotunda", category="building", generator="cg/buildings/rotunda.py", params=P,
                pivot="colonnade centre at ground (plinth bottom), +Z up, metres, world-aligned",
                world_pivot=[M["center"][0], M["center"][1], M["ground_z"]],
                measured=dict(outer_radius=M["outer_radius"], upper_radius=M["upper_radius"], upper_center=M["upper_center"], top_h=M["upper_top_h"]),
                inferred=["pier count 40 (+-4) from apparent pitch", "pier section 1.25x2.3 m", "glass line 3.8 m behind pier faces", "far (NE) side not seen at close range: same rhythm assumed", "doors/entrances not modelled individually"])
    d = B / "assets/buildings/bldg_rotunda"; d.mkdir(parents=True, exist_ok=True)
    save_parts(d / "bldg_rotunda_research", parts, dict(meta, lod="research")); save_parts(d / "bldg_rotunda_web", parts, dict(meta, lod="web"))
    print("rotunda parts", [p[0].name for p in parts], "fins", nf, "mullions", nm)
if __name__ == "__main__": build()
