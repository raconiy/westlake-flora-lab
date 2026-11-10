"""Replace the original midground tree, its grass clearance and contact-world capsule.

Positional arguments are the campus GLB, packed secondary tree GLB,
contact-fit.json, generated grounded-collisions.json, full and web
meadow attachments, previous collision XML and a new output directory.
Input relative transforms and per-instance attributes outside the tree are retained.
"""

from pathlib import Path
import json, struct, sys, copy, hashlib
from xml.etree import ElementTree as ET
import numpy as np


def read(p):
    raw = Path(p).read_bytes()
    magic, version, total, n, key = struct.unpack_from("<4sIIII", raw)
    assert (magic, version, total, key) == (b"glTF", 2, len(raw), 0x4E4F534A)
    return json.loads(raw[20 : 20 + n]), bytearray(raw[28 + n :])


def save(path, d, b):
    b += bytes(-len(b) % 4)
    d["buffers"][0]["byteLength"] = len(b)
    j = json.dumps(d, separators=(",", ":"), ensure_ascii=False).encode()
    j += b" " * (-len(j) % 4)
    path.write_bytes(
        struct.pack("<4sIIII", b"glTF", 2, 28 + len(j) + len(b), len(j), 0x4E4F534A)
        + j
        + struct.pack("<II", len(b), 0x004E4942)
        + b
    )


def append(d, b, t, chunk):
    offset = len(b)
    b.extend(chunk)
    b.extend(bytes(-len(b) % 4))
    mo, ao, vo, ma, no = (
        len(d[k]) for k in ["meshes", "accessors", "bufferViews", "materials", "nodes"]
    )
    fallback = d["buffers"][1]["byteLength"] if len(d["buffers"]) > 1 else None
    for v in t["bufferViews"]:
        ext = v.get("extensions", {}).get("EXT_meshopt_compression")
        if ext:
            if fallback is None or v["buffer"] != 1 or ext["buffer"] != 0:
                raise ValueError("Incompatible meshopt buffer arrangement")
            v["byteOffset"] = fallback + v.get("byteOffset", 0)
            ext["byteOffset"] = offset + ext.get("byteOffset", 0)
        else:
            assert v["buffer"] == 0
            v["byteOffset"] = offset + v.get("byteOffset", 0)
    if len(t["buffers"]) == 2:
        d["buffers"][1]["byteLength"] += t["buffers"][1]["byteLength"]
    for prop in ["extensionsRequired", "extensionsUsed"]:
        d[prop] = list(dict.fromkeys([*d.get(prop, []), *t.get(prop, [])]))
    for a in t["accessors"]:
        a["bufferView"] += vo
    for m in t["meshes"]:
        for p in m["primitives"]:
            p["attributes"] = {k: v + ao for k, v in p["attributes"].items()}
            p["indices"] += ao
            p["material"] += ma
    for n in t["nodes"]:
        if "mesh" in n:
            n["mesh"] += mo
        if "children" in n:
            n["children"] = [i + no for i in n["children"]]
    for k in ["meshes", "accessors", "bufferViews", "materials", "nodes"]:
        d[k].extend(t[k])
    return no + t["scenes"][t.get("scene", 0)]["nodes"][0]


def replace_tree(d, b, asset, fit, coll):
    nodes = d["nodes"]
    (old,) = [i for i, o in enumerate(nodes) if o.get("name") == "tree.right-group"]
    active = [old]
    oldcoll = None
    for i in active:
        s = nodes[i]
        active.extend(s.get("children", []))
        if s.get("name") == "tree.right-group.collider.stem":
            oldcoll = i
    assert oldcoll is not None
    g, f = read(asset)
    new = append(d, b, g, f)
    r = nodes[new]
    r["translation"] = fit["rootThreeM"]
    r["extras"][
        "groundClearance"
    ] = "Physical foot on y=0; unconstrained photograph root is 0.674m below this nominal ground."
    for n in nodes:
        if old in n.get("children", []):
            n["children"] = [new if v == old else v for v in n["children"]]
    for s in d["scenes"]:
        s["nodes"] = [new if v == old else v for v in s["nodes"]]
    for i in active:
        if i != oldcoll:
            nodes[i] = {}
    p = coll["segments"][0]
    e = p["endM"]
    nodes[oldcoll] = {
        "name": "tree.right-group.collider.stem",
        "extras": {
            "shape": "capsule",
            "radius": p["radiusM"],
            "end_local": [e[0], -e[2], e[1]],
            "use": "static lower stem, shared with contact-world.xml",
        },
    }
    r["children"].append(oldcoll)


def clear_grass(d, b, fit, full):
    x, _, z = fit["rootThreeM"]
    radius = fit["rootRadiusM"] + 0.108 + 0.025
    clipped = 0
    bands = {"near": 0, "middle": 0, "far": 0}
    count = 0
    for n in d["nodes"]:
        attrs = (
            n.get("extensions", {}).get("EXT_mesh_gpu_instancing", {}).get("attributes")
        )
        if not attrs or not n.get("name", "").startswith("Turf blades "):
            continue

        def array(idx):
            a = d["accessors"][idx]
            v = d["bufferViews"][a["bufferView"]]
            assert (
                a["componentType"] == 5126
                and v["buffer"] == 0
                and not v.get("extensions")
                and not v.get("byteStride")
            )
            dim = {"VEC3": 3, "VEC4": 4}[a["type"]]
            return np.frombuffer(
                b,
                "<f4",
                count=a["count"] * dim,
                offset=v.get("byteOffset", 0) + a.get("byteOffset", 0),
            ).reshape(-1, dim)

        ps = array(attrs["TRANSLATION"])
        mask = (ps[:, 0] - x) ** 2 + (ps[:, 2] - z) ** 2 > radius**2
        clipped += int((~mask).sum())
        name = n["name"].split()[2]
        pr = d["meshes"][n["mesh"]]["primitives"][0]
        bands[name] += int(mask.sum()) * pr["extras"]["bladesPerTuft"]
        count += int(mask.sum())
        for attr, idx in attrs.items():
            a = d["accessors"][idx]
            v = d["bufferViews"][a["bufferView"]]
            numbers = array(idx)
            selected = numbers[mask].copy()
            numbers[: len(selected)] = selected
            a["count"] = len(selected)
            if "min" in a:
                a["min"] = selected.min(0).tolist()
            if "max" in a:
                a["max"] = selected.max(0).tolist()
        del ps
    for n in d["nodes"]:
        st = n.get("extras", {}).get("stats")
        if st:
            st.update(
                tufts=count,
                fieldTufts=full or count,
                blades=sum(bands.values()),
                **{name + "Blades": v for name, v in bands.items()},
            )
    return {
        "remaining": count,
        "removedInTrunkEnvelope": clipped,
        "perTierBlades": bands,
        "clippingRadiusM": radius,
    }


def xml(source, output, fit, collision):
    """Replace only this tree's static woody proxies. Coordinates in XML are Z-up."""
    tree = ET.parse(source)
    parent = tree.find("worldbody")
    stem_name = "tree.right-group.collider.stem"
    segment_prefix = "tree.right-group.collider.wood."
    original = parent.find(f"geom[@name='{stem_name}']") if parent is not None else None
    if original is None or original.get("type") != "capsule":
        raise ValueError(
            "The original worldbody must contain the named static stem capsule"
        )
    if sum(geom.get("name") == stem_name for geom in tree.iter("geom")) != 1:
        raise ValueError("Expected exactly one stem capsule")
    segments = collision["segments"]
    if len(segments) != 26:
        raise ValueError(
            "The registered secondary skeleton must contain 26 supported segments"
        )
    root = np.asarray(fit["rootThreeM"], dtype=float)
    if root.shape != (3,) or not np.all(np.isfinite(root)) or abs(root[1]) > 1.0e-5:
        raise ValueError("Invalid constrained stem origin")
    attributes = dict(original.attrib)
    insertion = list(parent).index(original)
    for geom in list(parent.findall("geom")):
        name = geom.get("name", "")
        if name == stem_name or name.startswith(segment_prefix):
            parent.remove(geom)
    prior_endpoints = {tuple(segments[0]["startM"])}
    seen = set()
    for index, segment in enumerate(segments):
        local = np.asarray([segment["startM"], segment["endM"]], dtype=float)
        radius = float(segment["radiusM"])
        if (
            local.shape != (2, 3)
            or not np.all(np.isfinite(local))
            or not np.isfinite(radius)
            or radius <= 0
        ):
            raise ValueError(f"Invalid capsule {index}")
        if np.linalg.norm(local[1] - local[0]) <= 2 * radius:
            raise ValueError(f"Degenerate capsule {index}")
        start, end = map(tuple, local)
        edge = tuple(sorted([start, end]))
        if start not in prior_endpoints or edge in seen:
            raise ValueError(f"Disconnected or duplicate segment {index}")
        prior_endpoints.add(end)
        seen.add(edge)
        world = local + root
        xml_coordinates = world[:, [0, 2, 1]] * [1, -1, 1]
        geom = ET.Element("geom", attributes)
        geom.set("name", stem_name if index == 0 else f"{segment_prefix}{index:02d}")
        geom.set("fromto", " ".join(format(x, ".9g") for x in xml_coordinates.flat))
        geom.set("size", format(radius, ".9g"))
        geom.tail = original.tail
        parent.insert(insertion + index, geom)
    tree.write(output, encoding="utf-8")


def main():
    if sys.argv[1:2] == ["--xml-only"]:
        source, fit_path, collision_path, output = map(Path, sys.argv[2:])
        xml(
            source,
            output,
            json.loads(fit_path.read_text()),
            json.loads(collision_path.read_text()),
        )
        return
    src, tree, fitpath, collpath, fullpath, webpath, xmlpath, out = map(
        Path, sys.argv[1:]
    )
    out.mkdir(parents=True, exist_ok=True)
    fit = json.loads(fitpath.read_text())
    coll = json.loads(collpath.read_text())
    report = {}
    for kind, path in [("full", fullpath), ("web", webpath), ("campus", src)]:
        d, b = read(path)
        if kind == "campus":
            replace_tree(d, b, tree, fit, coll)
        report[kind] = clear_grass(
            d, b, fit, report["full"]["remaining"] if "full" in report else None
        )
        dest = (
            out
            / {
                "full": "yungu-meadow-full.glb",
                "web": "yungu-meadow.glb",
                "campus": "yungu-lawn.glb",
            }[kind]
        )
        save(dest, d, b)
        report[kind]["sha256"] = hashlib.sha256(dest.read_bytes()).hexdigest()
    xml(xmlpath, out / "contact-world.xml", fit, coll)
    (out / "installation.json").write_text(json.dumps(report, indent=2))
    print(report)


if __name__ == "__main__":
    main()
