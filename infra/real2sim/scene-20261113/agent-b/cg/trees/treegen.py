"""Agent B (Opus 5.5) — individual tree generator (space colonisation + pipe model + instanced leaf cards).

Each tree is generated from a parameter dict (see TreeParams in trees.json) measured per individual from the
video reconstruction: root-collar position, height, crown base, an azimuth x height crown radius profile
(envelope), lean, foliage colour palette and density. Species-level priors (branch angle, leaf shape/size,
bark) come from cg/trees/species.json.  Output: Part meshes  trunk_branches (bark material) + leaves
(leaf material, per-leaf tint in vertex colour), local frame: origin = root collar, +Z up, metres.
"""
import json, math, numpy as np
from scipy.spatial import cKDTree
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from common.meshio import Part

def envelope_radius(p, z, az):
    """crown radius at height z (m) and azimuth az (rad) from profile grid prof[nz][na] over [crown_base, height]."""
    prof = np.asarray(p["crown_profile"], np.float64)  # (nz, na) radii in metres
    nz, na = prof.shape
    t = (z - p["crown_base"]) / max(p["height"] - p["crown_base"], 1e-3) * (nz - 1)
    a = (az % (2 * np.pi)) / (2 * np.pi) * na
    t = np.clip(t, 0, nz - 1); i0 = np.clip(np.floor(t).astype(int), 0, nz - 2); ft = t - i0
    j0 = np.floor(a).astype(int) % na; j1 = (j0 + 1) % na; fa = a - np.floor(a)
    r = (prof[i0, j0] * (1 - fa) + prof[i0, j1] * fa) * (1 - ft) + (prof[i0 + 1, j0] * (1 - fa) + prof[i0 + 1, j1] * fa) * ft
    return r

def sample_attractors(p, rng, n):
    cx, cy = p.get("crown_offset", [0, 0]); pts = []
    zb, zt = p["crown_base"], p["height"]; rmax = np.max(p["crown_profile"])
    # clumped density: random "foliage clouds" -> natural gaps & layering
    nclouds = int(p.get("foliage_clouds", 40)); cr = p.get("cloud_radius", 0.28)
    while sum(len(a) for a in pts) < n:
        q = rng.uniform([-rmax, -rmax, zb], [rmax, rmax, zt], (n * 4, 3))
        q[:, :2] += [cx * 0, cy * 0]
        az = np.arctan2(q[:, 1] - cy, q[:, 0] - cx); rr = np.hypot(q[:, 0] - cx, q[:, 1] - cy)
        ok = rr < envelope_radius(p, q[:, 2], az)
        pts.append(q[ok])
    q = np.concatenate(pts)
    if nclouds > 0:
        C = q[rng.choice(len(q), nclouds, replace=False)]
        R = cr * rmax * rng.uniform(0.6, 1.4, nclouds)
        d = np.linalg.norm(q[:, None, :] - C[None], axis=2) / R[None]
        w = np.exp(-np.min(d, 1) ** 2 * 1.5)
        keep = rng.random(len(q)) < (p.get("foliage_fill", 0.35) + (1 - p.get("foliage_fill", 0.35)) * w)
        q = q[keep]
    return q[:n]

def grow(p, rng):
    S = p.get("step", 0.22); DI = p.get("influence", 1.6); DK = p.get("kill", 0.45)
    A = sample_attractors(p, rng, int(p.get("attractors", 2500)))
    lean = np.array(p.get("lean", [0, 0]) + [1.0]); lean /= np.linalg.norm(lean)
    # trunk: straight-ish chain up to crown base (with slight sinuosity), possibly forks into leaders
    nodes = [np.zeros(3)]; parent = [-1]
    ztrunk = p["crown_base"] + p.get("trunk_into_crown", 0.25) * (p["height"] - p["crown_base"])
    z = 0.0
    while z < ztrunk:
        d = lean + rng.normal(0, p.get("trunk_wiggle", 0.04), 3); d[2] = abs(d[2]); d /= np.linalg.norm(d)
        nodes.append(nodes[-1] + d * S); parent.append(len(nodes) - 2); z = nodes[-1][2]
    nodes = [np.array(n) for n in nodes]
    trop = np.array([0, 0, p.get("phototropism", 0.25)])
    for it in range(int(p.get("iterations", 160))):
        if len(A) == 0: break
        N = np.array(nodes); tree = cKDTree(N)
        d, idx = tree.query(A, distance_upper_bound=DI)
        valid = np.isfinite(d)
        if not valid.any():
            # stretch nearest node toward closest attractor cloud (bridge gaps)
            d2, i2 = tree.query(A); k = np.argmin(d2); v = A[k] - N[i2[k]]; v /= np.linalg.norm(v)
            nodes.append(N[i2[k]] + v * S); parent.append(int(i2[k])); continue
        dirs = A[valid] - N[idx[valid]]; dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
        acc = np.zeros((len(N), 3)); cnt = np.zeros(len(N))
        np.add.at(acc, idx[valid], dirs); np.add.at(cnt, idx[valid], 1)
        grew = 0
        for i in np.nonzero(cnt)[0]:
            v = acc[i] / np.linalg.norm(acc[i]) + trop + rng.normal(0, p.get("wiggle", 0.12), 3)
            v[2] -= p.get("gravitropism", 0.0) * (N[i][2] / p["height"])
            v /= np.linalg.norm(v)
            new = N[i] + v * S
            if np.min(np.linalg.norm(N[max(0, len(N) - 400):] - new, axis=1)) < S * 0.3 and grew > 0: continue
            nodes.append(new); parent.append(int(i)); grew += 1
        N = np.array(nodes); dk, _ = cKDTree(N).query(A)
        A = A[dk > DK]
        if grew == 0: break
    return np.array(nodes), np.array(parent)

def pipe_radii(nodes, parent, p):
    n = len(nodes); ch = [[] for _ in range(n)]
    for i in range(1, n): ch[parent[i]].append(i)
    order = np.argsort(-np.linalg.norm(nodes, axis=1) * 0)  # topological via depth
    depth = np.zeros(n, int)
    for i in range(1, n): depth[i] = depth[parent[i]] + 1
    r = np.zeros(n); e = p.get("pipe_exp", 2.4); rt = p.get("tip_radius", 0.006)
    for i in np.argsort(-depth):
        if not ch[i]: r[i] = rt
        else: r[i] = (sum(r[c] ** e for c in ch[i])) ** (1 / e)
    base = p["dbh"] / 2 * 1.15
    r *= base / r[0]
    r = np.maximum(r, rt)
    return r, ch, depth

def chains(parent, ch):
    """split skeleton into branch chains: list of node index lists; child chain starts at its parent node."""
    out = []; stack = [0]
    while stack:
        s = stack.pop(); cur = [s] if parent[s] < 0 else [parent[s], s]
        i = s
        while True:
            c = ch[i]
            if not c: break
            # continue along thickest child; others start new chains
            c = sorted(c, key=lambda k: -_sub[k])
            for o in c[1:]: stack.append(o)
            i = c[0]; cur.append(i)
        out.append(cur)
    return out
_sub = None

def tube_mesh(part, nodes, r, chain_list, p, rng, part_white=None):
    bark_tile = p.get("bark_tile", 0.6)
    white = p.get("whitewash_height", 0.0)
    for chn in chain_list:
        P = nodes[chn]; R = r[chn]
        if len(P) < 2: continue
        # smooth path (Chaikin-light)
        if len(P) > 3:
            Q = P.copy(); Q[1:-1] = 0.25 * P[:-2] + 0.5 * P[1:-1] + 0.25 * P[2:]; P = Q
        if R[0] < p.get("min_branch_radius", 0.004): continue
        T = np.gradient(P, axis=0); T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-9
        seg = max(5, min(18, int(6 + R[0] * 70)))
        # parallel transport frame
        up = np.array([0, 0, 1.0]) if abs(T[0][2]) < 0.95 else np.array([1.0, 0, 0])
        Nn = np.cross(T[0], up); Nn /= np.linalg.norm(Nn)
        frames = []
        for k in range(len(P)):
            if k > 0:
                b = np.cross(T[k - 1], T[k])
                if np.linalg.norm(b) > 1e-6:
                    b /= np.linalg.norm(b); ang = math.acos(np.clip(T[k - 1] @ T[k], -1, 1))
                    Nn = Nn * math.cos(ang) + np.cross(b, Nn) * math.sin(ang) + b * (b @ Nn) * (1 - math.cos(ang))
            Bn = np.cross(T[k], Nn); frames.append((Nn.copy(), Bn))
        L = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
        circ = 2 * np.pi * R[0]
        ring, uvr = [], []
        for k in range(len(P)):
            Nk, Bk = frames[k]; rv, ru = [], []
            for j in range(seg + 1):
                a = 2 * np.pi * j / seg
                rr = R[k] * (1 + 0.04 * math.sin(a * 7 + L[k] * 3))  # faint bark ridges
                rv.append(P[k] + (Nk * math.cos(a) + Bk * math.sin(a)) * rr)
                ru.append((j / seg * max(circ / bark_tile, 0.25), L[k] / bark_tile))
            ring.append(rv); uvr.append(ru)
        # whitewashed (painted) trunk base -> separate material region, split by ring height
        kw = 0
        while kw < len(P) and P[kw][2] < white: kw += 1
        if white > 0 and kw > 0 and part_white is not None:
            spans = [(0, min(kw, len(P) - 1), part_white), (min(kw, len(P) - 1), len(P) - 1, part)]
        else:
            spans = [(0, len(P) - 1, part)]
        for k0, k1, tgt in spans:
            if k1 <= k0: continue
            V = [v for k in range(k0, k1 + 1) for v in ring[k]]; UV = [u for k in range(k0, k1 + 1) for u in uvr[k]]
            F = []
            for k in range(k1 - k0):
                for j in range(seg):
                    a = k * (seg + 1) + j; b = a + seg + 1
                    F += [(a, b, b + 1), (a, b + 1, a + 1)]
            tgt.add(V, F, UV)

LEAF_ASPECT = {"palmate": 1.0, "ovate": 0.62, "lanceolate": 0.32, "fan": 1.0, "compound": 0.7, "needle": 0.2, "twig": 0.85}
def leaf_card(shape):
    """leaf card, local frame: petiole at origin, blade along +Y (length 1), width = aspect, folded along the midrib.
    Full rectangle (2x2 quads) so the alpha-textured blade is never clipped. returns V,F,UV"""
    w = LEAF_ASPECT.get(shape, 0.6); f = 0.12 * w
    V = np.array([[-w / 2, 0, f], [0, 0, 0], [w / 2, 0, f], [-w / 2, 1, f], [0, 1, 0], [w / 2, 1, f]], np.float32)
    F = np.array([[0, 1, 4], [0, 4, 3], [1, 2, 5], [1, 5, 4]])
    UV = np.array([[0, 0], [0.5, 0], [1, 0], [0, 1], [0.5, 1], [1, 1]], np.float32)
    return V, F, UV

def foliage_mass_mesh(part, nodes, r, p, rng):
    """Low frequency inner foliage volume. It closes the gaps between individual cards while
    retaining a separately editable leaf-card layer. Each blob is a small UV sphere with a
    different scale, tilt and vertex tint, so the crown reads as layered foliage rather than
    a repeated billboard shell."""
    prof = np.asarray(p["crown_profile"], float)
    zb, zt = p["crown_base"], p["height"]
    n_target = int(p.get("mass_clusters", 0))
    if n_target <= 0: return 0
    twig = [i for i in range(len(nodes)) if nodes[i][2] > zb * 0.95 and r[i] < p.get("mass_radius_max", 0.045)]
    if not twig: return 0
    # stratified subset avoids a single dense band and follows the measured crown envelope
    rng.shuffle(twig); twig = twig[:min(n_target, len(twig))]
    pal = np.asarray(p.get("leaf_palette", [[0.12,0.25,0.06]]), float)
    col = np.clip(np.mean(pal, axis=0), 0.03, 0.45)
    seg, rings = 8, 4; made = 0
    for i in twig:
        z = float(nodes[i][2]); t = np.clip((z-zb)/max(zt-zb, 1e-3), 0, 1)
        az = float(np.arctan2(nodes[i][1], nodes[i][0])); row = min(len(prof)-1, max(0, int(t*(len(prof)-1))))
        rr = float(np.max(prof[row]))
        s = rng.uniform(0.075, 0.18) * (0.78 + 0.35 * min(rr/3.0, 1.5))
        center = nodes[i] + rng.normal(0, s*0.22, 3)
        scale = np.array([rng.uniform(.85,1.45)*s, rng.uniform(.72,1.25)*s, rng.uniform(.55,.95)*s])
        V=[]; UV=[]; F=[]
        V.append(center + np.array([0,0,scale[2]])); UV.append((.5,1))
        for q in range(1, rings):
            ph=np.pi*q/rings; zc=np.cos(ph); rad=np.sin(ph)
            for j in range(seg):
                a=2*np.pi*j/seg; V.append(center + scale*np.array([rad*np.cos(a),rad*np.sin(a),zc])); UV.append((j/seg,q/rings))
        bot=len(V); V.append(center - np.array([0,0,scale[2]])); UV.append((.5,0))
        for j in range(seg): F.append((0,1+j,1+(j+1)%seg))
        for q in range(1,rings-1):
            a0=1+(q-1)*seg; b0=1+q*seg
            for j in range(seg):
                a=a0+j; b=a0+(j+1)%seg; c=b0+j; d=b0+(j+1)%seg; F += [(a,c,b),(b,c,d)]
        a0=1+(rings-2)*seg
        for j in range(seg): F.append((a0+j,bot,a0+(j+1)%seg))
        tint=np.clip(col*rng.uniform(.72,1.25,3),0,1); COL=np.tile(np.r_[tint,1.0],(len(V),1));
        part.add(np.asarray(V,np.float32),np.asarray(F,np.int32),np.asarray(UV,np.float32),COL); made+=1
    return made

def leaves_mesh(part, nodes, r, ch, depth, p, rng):
    shape = p["leaf_shape"]; ls = p["leaf_size"]; per = p.get("leaves_per_node", 10); dens = p.get("leaf_density", 1.0)
    if p.get("leaf_mode") == "twig":   # web LOD: one card = a twig carrying ~6 leaves (twig atlas)
        shape = "twig"; ls = p.get("twig_size", 0.45); per = per / 6.0
    V0, F0, UV0 = leaf_card(shape)
    pal = np.asarray(p["leaf_palette"], np.float32); pw = np.asarray(p.get("leaf_palette_w", [1] * len(pal)), np.float64); pw /= pw.sum()
    atlas_n = p.get("atlas_variants", 4)
    # twigs: topological (small subtrees = outer shoots), so sparse skeletons still foliate whatever the trunk scaling
    twig = [i for i in range(len(nodes)) if (_sub[i] <= p.get("twig_subtree_max", 4) or r[i] < p.get("leaf_radius_max", 0.02)) and nodes[i][2] > p["crown_base"] * 0.85]
    if p.get("lai") and twig:
        # physically based density: total one-sided leaf area = LAI x crown projected area;
        # opaque area per card = size^2 x aspect x measured alpha coverage of the atlas
        crown_area = np.pi * float(np.mean(np.max(np.asarray(p["crown_profile"]), 0))) ** 2
        cov = p.get("card_coverage", {}).get(shape, 0.5)
        card_area = ls ** 2 * LEAF_ASPECT.get(shape, 0.6) * cov
        per = p["lai"] * crown_area / card_area / len(twig)
        p["_leaves_per_twig_node"] = round(per, 2)
    cx, cy = p.get("crown_offset", [0, 0])
    Vs, Fs, UVs, Cs = [], [], [], []; k = 0
    for i in twig:
        m = rng.poisson(per * dens)
        if m == 0: continue
        par = nodes[parent_g[i]] if parent_g[i] >= 0 else nodes[i]
        tdir = nodes[i] - par; tdir /= np.linalg.norm(tdir) + 1e-9
        for _ in range(m):
            pos = nodes[i] + rng.normal(0, p.get("leaf_spread", 0.12), 3) + tdir * rng.uniform(0, 0.15)
            out = pos - np.array([cx, cy, pos[2] - 0.0]); out[2] = 0; out = out / (np.linalg.norm(out) + 1e-9)
            # leaf orientation: blade direction ~ outward + down droop, normal ~ up/out
            yv = out * 0.6 + tdir * 0.5 + rng.normal(0, 0.45, 3); yv[2] -= p.get("leaf_droop", 0.3); yv /= np.linalg.norm(yv)
            nv = np.array([0, 0, 1.0]) * 0.7 + out * 0.3 + rng.normal(0, 0.5, 3); nv -= yv * (nv @ yv); nv /= np.linalg.norm(nv) + 1e-9
            xv = np.cross(yv, nv)
            s = ls * rng.uniform(0.7, 1.3)
            Rm = np.stack([xv, yv, nv], 1) * s
            Vs.append(V0 @ Rm.T + pos)
            vi = rng.integers(atlas_n); UVs.append(UV0 * [1.0 / atlas_n, 1] + [vi / atlas_n, 0])
            c = pal[rng.choice(len(pal), p=pw)] * rng.uniform(0.85, 1.12); c = np.clip(c, 0, 1)
            Cs.append(np.tile(np.r_[c, 1.0], (len(V0), 1))); Fs.append(F0 + k * len(V0)); k += 1
    if k:
        part.add(np.concatenate(Vs), np.concatenate(Fs) - 0, np.concatenate(UVs), np.concatenate(Cs))
    return k

parent_g = None
def build(p):
    global _sub, parent_g
    rng = np.random.default_rng(p["seed"])
    nodes, parent = grow(p, rng); parent_g = parent
    r, ch, depth = pipe_radii(nodes, parent, p)
    # subtree size for main-axis selection
    n = len(nodes); _sub = np.ones(n)
    for i in np.argsort(-depth):
        if parent[i] >= 0: _sub[parent[i]] += _sub[i]
    cl = chains(parent, ch)
    wood = Part("trunk_branches", p.get("bark_material", "bark"))
    white = Part("trunk_whitewash", "whitewash") if p.get("whitewash_height", 0) > 0 else None
    tube_mesh(wood, nodes, r, cl, p, rng, white)
    leaves = Part("leaves", p.get("leaf_material", "leaf"))
    nl = leaves_mesh(leaves, nodes, r, ch, depth, p, rng)
    mass = Part("foliage_volume", p.get("mass_material", "leafmass"))
    nmass = foliage_mass_mesh(mass, nodes, r, p, rng)
    stats = dict(nodes=int(n), chains=len(cl), leaves=int(nl), foliage_clusters=int(nmass), max_z=float(nodes[:, 2].max()))
    return wood, leaves, stats, white, mass
