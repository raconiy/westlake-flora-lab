"""Generate the photographed forked midground tree with native wind joints and collision proxies.

Run Blender 4.5 with -b -P build_constrained.py -- DIRECTORY. DIRECTORY must
contain skeleton.json and contact-fit.json. The model is exported root-local.
The leaf shapes, occluded branch depths and wood properties are estimates.
"""

from pathlib import Path
import bpy, math, random, json, sys
from mathutils import Vector, Quaternion

out = Path(sys.argv[sys.argv.index("--") + 1])
src = json.loads((out / "skeleton.json").read_text())
fit = json.loads((out / "contact-fit.json").read_text())
scale = fit["scale"]
rng = random.Random(61013)
bpy.ops.wm.read_factory_settings(use_empty=True)


def bl(v):
    return Vector((v[0], -v[2], v[1])) * scale


def addmat(name, c):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*c, 1)
    mat.use_nodes = True
    mat.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (
        *c,
        1,
    )
    mat.node_tree.nodes.get("Principled BSDF").inputs["Roughness"].default_value = 0.8
    return mat


mats = [
    addmat("Bark.gray", (0.17, 0.151, 0.112)),
    addmat("Bark.recess", (0.091, 0.082, 0.064)),
]
mats += [
    addmat("Foliage." + str(i), c)
    for i, c in enumerate(
        [
            (0.12, 0.16, 0.044),
            (0.075, 0.102, 0.025),
            (0.16, 0.194, 0.058),
            (0.271, 0.271, 0.068),
            (0.068, 0.085, 0.024),
        ]
    )
]
pr = bpy.data.objects.new("Secondary.ForkedBroadleaf", None)
bpy.context.collection.objects.link(pr)
pr["registeredWorldThreeM"] = src["rootReg"]
pr["localFootM"] = [0.0, 0.0, 0.0]
pr["species"] = "unverified broadleaf"
pr["groundClearance"] = (
    "Registered real ground is 0.674 m below main scene plane"
)
pr["registeredWorldThreeM"] = fit["rootThreeM"]
pr["asset_kind"] = "broadleaf_tree"
pr["root_anchored"] = True
pr["root_collar_local"] = [0.0, 0.0, 0.0]
pr["mechanics"] = "supported woody topology; no field-measured stiffness"
wood = ([], [], [])
leaves = ([], [], [])
collisions = []
leafN = 0


def unit(a):
    return a.normalized()


def per(d):
    return unit(d.cross(Vector((0, 0, 1)) if abs(d.z) < 0.93 else Vector((1, 0, 0))))


def tube(pts, rads, sides=8):
    vs, fs, ms = wood
    st = len(vs)
    for i, (p, rad) in enumerate(zip(pts, rads)):
        direction = unit(pts[min(i + 1, len(pts) - 1)] - pts[max(0, i - 1)])
        a = per(direction) if i == 0 else unit(a - direction * a.dot(direction))
        b = unit(direction.cross(a))
        for k in range(sides):
            t = math.tau * k / sides
            v = p + (a * math.cos(t) + b * math.sin(t)) * rad * (
                1 + 0.045 * math.cos(t * 3)
            )
            if i == 0 and p.length < 1.0e-9:
                v.z = 0.0
            vs.append(tuple(v))
        if i:
            for k in range(sides):
                j = (k + 1) % sides
                fs.append(
                    (
                        st + (i - 1) * sides + k,
                        st + (i - 1) * sides + j,
                        st + i * sides + j,
                        st + i * sides + k,
                    )
                )
                ms.append(int(k % 5 == 2))


def blade(p, vec, L, w, pigment):
    global leafN
    leafN += 1
    f = unit(vec)
    a = per(f)
    a = Quaternion(f, rng.uniform(-0.7, 0.7)) @ a
    v, fa, ms = leaves
    i = len(v)
    mid = p + f * (0.50 * L)
    v.extend(
        map(
            tuple,
            [
                p,
                mid + a * w * 0.53,
                mid + Vector((0, 0, 0.08 * L)),
                mid - a * w * 0.53,
                p + f * L - Vector((0, 0, 0.12 * L)),
            ],
        )
    )
    fa.extend(
        [
            (i, i + 1, i + 2),
            (i, i + 2, i + 3),
            (i + 1, i + 4, i + 2),
            (i + 2, i + 4, i + 3),
        ]
    )
    ms.extend([pigment] * 4)


def obj(name, data, parent=None, pivot=None):
    v, f, ms = data
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(
        [tuple(Vector(pt) - pivot) for pt in v] if pivot is not None else v, [], f
    )
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    o.parent = parent or pr
    for m in mats:
        mesh.materials.append(m)
    mesh.polygons.foreach_set("material_index", ms)
    return o


root = Vector((0, 0, 0))
fork = bl(src["fork"])
left = bl(src["leftFork"])
mid = root.lerp(fork, 0.51) + Vector((-0.035, 0.024, 0))
tube([root, mid, fork], [r * scale for r in (0.228, 0.177, 0.15)], 14)
tube(
    [fork, fork.lerp(left, 0.55) + Vector((0.028, 0, 0)), left],
    [r * scale for r in (0.126, 0.108, 0.092)],
    11,
)
ends = {"fork": fork, "leftFork": left}
baseR = {"central": 0.103, "right": 0.113, "left": 0.089}


def collision(a, b, r):
    def to3(p):
        return [round(i, 4) for i in (p.x, p.z, -p.y)]

    return dict(startM=to3(a), endM=to3(b), radiusM=round(r, 4))


collisions = [collision(root, fork, 0.17 * scale), collision(fork, left, 0.095 * scale)]
obj("tree.right-group.trunk", wood)
jointFrames = {"fork": (pr, root), "leftFork": (pr, root)}
pr.name = "tree.right-group"

for n, limb in enumerate(src["limbs"]):
    wood = ([], [], [])
    leaves = ([], [], [])
    priorLeafN = leafN
    ps = [ends[limb["parent"]]] + [bl(v) for v in limb["points"]]
    ps = [p for i, p in enumerate(ps) if i == 0 or (p - ps[i - 1]).length > 0.028]
    segments = []
    for ix, (aa, bb) in enumerate(zip(ps, ps[1:])):
        u = unit(bb - aa)
        perp = per(u)
        sgn = math.sin((n + 1) * 3.1 + ix)
        delta = perp * ((bb - aa).length * 0.10 * sgn)
        segments.extend([aa, aa.lerp(bb, 0.43) + delta])
    ps = segments + [ps[-1]]
    rr = scale * baseR.get(limb["name"], 0.064 if len(ps) >= 4 else 0.038)
    tube(ps, [rr * (1 - 0.78 * i / (len(ps) - 1)) for i in range(len(ps))], 9)
    ends[limb["name"]] = ps[-1]
    if n < 3:
        for a, b in zip(ps[:-1], ps[1:]):
            collisions.append(collision(a, b, rr * 0.65))
    center = ps[-1]
    ex, ey, ez = [r * scale for r in limb["radii"]]
    for j in range(23):
        ang = j * 2.39996 + rng.uniform(-0.25, 0.25)
        z = rng.uniform(-0.78, 1)
        rc = (1 - z * z) ** 0.5 * rng.uniform(0.66, 1.04)
        d = Vector((rc * math.cos(ang) * ex, rc * math.sin(ang) * ey, z * ez))
        end = center + d
        origin = ps[-2].lerp(center, rng.uniform(0.72, 0.99))
        elbow = origin.lerp(end, 0.51) + Vector((0, 0, rng.uniform(-0.11, 0.13)))
        tube([origin, elbow, end], [0.017, 0.011, 0.005], 5)
        for k in range(9):
            u = rng.uniform(0.49, 1)
            start = elbow.lerp(end, u)
            s = unit(
                Vector(
                    (
                        math.cos(ang + rng.uniform(-1.4, 1.4)),
                        math.sin(ang + rng.uniform(-1.4, 1.4)),
                        rng.uniform(-0.72, 0.85),
                    )
                )
            )
            tip = start + s * rng.uniform(0.20, 0.48)
            tube([start, tip], [0.0035, 0.0012], 4)
            sunWeight = (
                9 if limb["name"] in ("sun-tip", "upper-sun", "upper-left-layer") else 2
            )
            pig = rng.choices([2, 3, 4, 5, 6], [4, 2, 4, sunWeight, 1])[0]
            for l in range(11):
                base = start.lerp(tip, (l + 1) / 12)
                axis = Quaternion(s, l * 2.4 + ang) @ per(s)
                blade(
                    base,
                    axis * 0.85 + s * 0.34 + Vector((0, 0, rng.uniform(-0.38, 0.2))),
                    rng.uniform(0.075, 0.146),
                    rng.uniform(0.032, 0.061),
                    pig,
                )
    joint = bpy.data.objects.new("tree.right-group.limb." + str(n).zfill(2), None)
    bpy.context.collection.objects.link(joint)
    joint.parent, parentOrigin = jointFrames[limb["parent"]]
    joint.location = ps[0] - parentOrigin
    jointFrames[limb["name"]] = (joint, ps[0])
    delta = ps[-1] - ps[0]
    joint["wind_joint"] = True
    joint["tip_offset_blender_m"] = list(delta)
    joint["beam_length_m"] = sum((b - a).length for a, b in zip(ps, ps[1:]))
    joint["beam_base_radius_m"] = rr
    joint["beam_tip_radius_m"] = rr * 0.22
    joint["leaf_area_m2"] = (leafN - priorLeafN) * 0.0024
    joint["area_basis"] = "Engineering prior per mesh blade, not measured."
    obj("tree.right-group.wood." + str(n).zfill(2), wood, joint, ps[0])
    f = obj("tree.right-group.leaf-clusters." + str(n).zfill(2), leaves, joint, ps[0])
    f["physical_blades"] = leafN - priorLeafN
(out / "grounded-collisions.json").write_text(
    json.dumps(
        {
            "basis": "root-relative Three metres",
            "geometry": "capsule envelopes; nominal radii, no measured stiffness",
            "segments": collisions,
        },
        indent=2,
    )
)
pr["collisionSegmentsThreeM"] = json.dumps(collisions, separators=(",", ":"))
pr["explicitBladeCount"] = leafN
bpy.ops.wm.save_as_mainfile(
    filepath=str(out / "secondary-grounded.blend"), compress=True
)
bpy.ops.export_scene.gltf(
    filepath=str(out / "secondary-grounded.glb"),
    export_format="GLB",
    export_extras=True,
    export_animations=False,
    export_cameras=False,
    export_lights=False,
)
print("DONE", leafN, len(wood[0]), len(leaves[0]))
