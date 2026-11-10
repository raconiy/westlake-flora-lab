"""Check registered woody segments, real MuJoCo contacts and nearby free space."""

import hashlib, json, sys
from pathlib import Path
from xml.etree import ElementTree as ET
import numpy as np
import mujoco as mj

xml_path, skeleton_path, fit_path, receipt = map(Path, sys.argv[1:])
doc = ET.parse(xml_path)
source = json.loads(skeleton_path.read_text())["segments"]
root = np.asarray(json.loads(fit_path.read_text())["rootThreeM"])
name = "tree.right-group.collider."
tree = [
    element
    for element in doc.find("worldbody").findall("geom")
    if element.get("name", "").startswith(name)
]
assert len(tree) == len(source) == 26
m = mj.MjModel.from_xml_path(str(xml_path))
d = mj.MjData(m)
mj.mj_forward(m, d)


def geom_name(g):
    return mj.mj_id2name(m, mj.mjtObj.mjOBJ_GEOM, int(g))


def closest(a, b, c, d):
    u = b - a
    v = d - c
    vals = []
    for p, r, s in [(a, c, d), (b, c, d), (c, a, b), (d, a, b)]:
        diff = s - r
        t = np.clip(np.dot(p - r, diff) / np.dot(diff, diff), 0, 1)
        vals.append(np.linalg.norm(p - (r + t * diff)))
    A = np.stack([u, -v], axis=-1)
    ts = np.linalg.lstsq(A, c - a, rcond=None)[0]
    if np.all((ts >= 0) & (ts <= 1)):
        vals.append(np.linalg.norm((a + u * ts[0]) - (c + v * ts[1])))
    return min(vals)


segs = []
rays = []
for i, (elem, s) in enumerate(zip(tree, source)):
    ends = np.asarray([s["startM"], s["endM"]]) + root
    ref = ends[:, [0, 2, 1]] * [1, -1, 1]
    a, b = np.fromstring(elem.get("fromto"), sep=" ").reshape(2, 3)
    r = float(elem.get("size"))
    assert (
        np.max(abs(ref - np.array([a, b]))) < 0.000001
        and abs(s["radiusM"] - r) < 1.0e-7
    )
    assert elem.get("name") == (name + "stem" if i == 0 else name + f"wood.{i:02d}")
    segs.append((a, b, r))
    axis = b - a
    axis /= np.linalg.norm(axis)
    v = np.cross(axis, [1, 0, 0])
    v /= np.linalg.norm(v)
    w = np.cross(axis, v)
    for frac, t in [
        (f, t)
        for f in ((0.25, 0.5, 0.75) if i == 0 else (0.5,))
        for t in (0, np.pi / 2, np.pi, 3 * np.pi / 2)
    ]:
        n = v * np.cos(t) + w * np.sin(t)
        distance = r + 0.013
        start = a + frac * (b - a) + n * distance
        ix = np.array([-1], np.int32)
        hit = mj.mj_ray(m, d, start, -n, None, True, -1, ix)
        assert geom_name(ix[0]) == elem.get("name") and abs(hit - 0.013) < 0.00001, (
            i,
            ix,
            hit,
        )
        rays.append(float(abs(hit - 0.013)))
same_endpoint = disjoint_overlap = 0
nonjoin = []
for i, (a, b, r) in enumerate(segs):
    for j, (c, e, r2) in enumerate(segs[:i]):
        separation = closest(a, b, c, e)
        if min(np.linalg.norm(x - y) for x in [a, b] for y in [c, e]) < 0.000001:
            same_endpoint += 1
            assert separation < 0.00001
        elif separation < r + r2:
            disjoint_overlap += 1
            nonjoin.append([j, i, round(float(separation), 5)])
assert disjoint_overlap == 0, nonjoin
target = 9
a, b, r = segs[target]
axis = (b - a) / np.linalg.norm(b - a)
v = np.cross(axis, [0, 0, 1])
v /= np.linalg.norm(v)
center = (a + b) * 0.5
sphere = 0.025


def trial(pos):
    model_doc = ET.fromstring(ET.tostring(doc.getroot(), encoding="utf-8"))
    body = ET.SubElement(
        model_doc.find("worldbody"),
        "body",
        name="secondary-contact-test",
        pos=" ".join(map(str, pos)),
    )
    ET.SubElement(body, "freejoint")
    ET.SubElement(
        body,
        "geom",
        name="secondary-contact-probe",
        type="sphere",
        size=str(sphere),
        mass=".05",
    )
    model = mj.MjModel.from_xml_string(ET.tostring(model_doc, encoding="unicode"))
    data = mj.MjData(model)
    mj.mj_forward(model, data)
    pairs = []
    probe = mj.mj_name2id(model, mj.mjtObj.mjOBJ_GEOM, "secondary-contact-probe")
    for k, ct in enumerate(data.contact):
        ids = list(ct.geom)
        if probe in ids:
            other = ids[1 - ids.index(probe)]
            force = np.zeros(6)
            mj.mj_contactForce(model, data, k, force)
            pairs.append(
                {
                    "geom": mj.mj_id2name(model, mj.mjtObj.mjOBJ_GEOM, int(other)),
                    "signedDistanceM": float(ct.dist),
                    "normalForceNAtInitialIntersection": float(force[0]),
                }
            )
    return pairs


hit = trial(center + v * (r + sphere - 0.004))
free = trial(center + v * (r + sphere + 0.075))
assert (
    len(hit) == 1
    and hit[0]["geom"] == tree[target].get("name")
    and abs(hit[0]["signedDistanceM"] + 0.004) < 0.00001
    and hit[0]["normalForceNAtInitialIntersection"] > 0
)
assert free == []
result = {
    "mujocoVersion": mj.__version__,
    "xmlSha256": hashlib.sha256(xml_path.read_bytes()).hexdigest(),
    "worldGeomCount": int(m.ngeom),
    "treeCapsules": len(segs),
    "radiusRangeM": [min(x[2] for x in segs), max(x[2] for x in segs)],
    "capsuleCenterlineMaxZUpM": float(max(b[2] for _, b, _ in segs)),
    "adjacentEndpointPairs": same_endpoint,
    "overlapsBetweenSeparateCenterlines": disjoint_overlap,
    "testedRadialSurfaceRays": len(rays),
    "maxRadialErrorM": max(rays),
    "branchProbe": {
        "targetHeightM": float(center[2]),
        "sphereRadiusM": sphere,
        "surfacePenetrationM": 0.004,
        "contacts": hit,
    },
    "nearbyProbe": {"extraClearanceM": 0.075, "contacts": free},
    "limits": "Static registered woody capsules, approximate radii and axial extents. Web wind deformation, foliage and fine twigs have no dynamic MuJoCo collision.",
}
receipt.write_text(json.dumps(result, indent=2))
print(json.dumps(result))
