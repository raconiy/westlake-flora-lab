"""Agent B (Opus 5.5) — tiny mesh container shared by all CG generators.
A Part = named sub-mesh (object) with vertices, triangle/quad faces, per-corner UV, optional per-vertex colour,
and a material slot name. Generators write <asset>/<asset_id>.parts.npz + .json, the Blender builder turns them
into editable objects (+ .blend + .glb)."""
import json, numpy as np
class Part:
    def __init__(self, name, material):
        self.name, self.material = name, material
        self.V, self.F, self.UV, self.COL = [], [], [], []   # F: list of index tuples (tri) ; UV per vertex
        self.n = 0
    def add(self, V, F, UV=None, COL=None):
        V = np.asarray(V, np.float32); F = np.asarray(F, np.int64)
        self.V.append(V); self.F.append(F + self.n)
        self.UV.append(np.zeros((len(V), 2), np.float32) if UV is None else np.asarray(UV, np.float32))
        self.COL.append(np.ones((len(V), 4), np.float32) if COL is None else np.asarray(COL, np.float32))
        self.n += len(V)
    def arrays(self):
        if not self.V: return None
        return dict(V=np.concatenate(self.V), F=np.concatenate(self.F).astype(np.int32), UV=np.concatenate(self.UV), COL=np.concatenate(self.COL))
def save_parts(path_noext, parts, meta):
    """parts: list of (Part, parent_name or None, local_offset xyz).
    A Part may carry `instances`: list of (location xyz, rotation_z rad, scale xyz) -> the builder creates linked
    duplicates sharing one mesh (exported as glTF node instancing)."""
    arr, desc = {}, []
    for i, (p, parent, off) in enumerate(parts):
        a = p.arrays()
        if a is None: continue
        for k, v in a.items(): arr[f"{i}_{k}"] = v
        d = dict(idx=i, name=p.name, material=p.material, parent=parent, offset=list(map(float, off)), nv=int(len(a["V"])), nf=int(len(a["F"])))
        if getattr(p, "instances", None):
            d["instances"] = [[list(map(float, l)), float(r), list(map(float, s))] for l, r, s in p.instances]
        desc.append(d)
    np.savez_compressed(str(path_noext) + ".parts.npz", **arr)
    meta = dict(meta); meta["parts"] = desc
    json.dump(meta, open(str(path_noext) + ".json", "w"), indent=1, ensure_ascii=False)
def box(cx, cy, cz, sx, sy, sz, uvscale=1.0):
    """axis-aligned box centred at (cx,cy,cz) size (sx,sy,sz) with per-face planar UVs in metres*uvscale. returns V,F,UV"""
    V, F, UV = [], [], []
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    faces = [((1, 0, 0), (0, 1, 0), (0, 0, 1), hx, sy, sz), ((-1, 0, 0), (0, -1, 0), (0, 0, 1), hx, sy, sz),
             ((0, 1, 0), (-1, 0, 0), (0, 0, 1), hy, sx, sz), ((0, -1, 0), (1, 0, 0), (0, 0, 1), hy, sx, sz),
             ((0, 0, 1), (1, 0, 0), (0, 1, 0), hz, sx, sy), ((0, 0, -1), (-1, 0, 0), (0, 1, 0), hz, sx, sy)]
    for n, u, v, d, su, sv in faces:
        n, u, v = map(np.array, (n, u, v)); c = np.array([cx, cy, cz]) + n * d
        k = len(V)
        for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            V.append(c + u * a * su / 2 + v * b * sv / 2); UV.append(((a + 1) / 2 * su * uvscale, (b + 1) / 2 * sv * uvscale))
        F += [(k, k + 1, k + 2), (k, k + 2, k + 3)]
    return np.array(V), np.array(F), np.array(UV)
