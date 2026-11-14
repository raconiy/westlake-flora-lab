#!/usr/bin/env python3
"""Merge the complete scene GLB with the server-produced refine layers.

The original refine export intentionally selected render-visible meshes. The
source scene also contains authored vegetation and site assets whose Blender
render flags are disabled, so that filter is unsafe for the web deliverable.
This publisher keeps the complete pre-refine scene and appends only the refine
layers that are independent additions: secondary canopy, grass tufts and the
inferred distant wing. It preserves both GLB buffer payloads and remaps all
standard glTF indices, including Draco buffer views.
"""
from __future__ import annotations

import copy
import hashlib
import json
import struct
import sys
from pathlib import Path


JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def read_glb(path: Path):
    payload = path.read_bytes()
    magic, version, length = struct.unpack_from("<4sII", payload, 0)
    if magic != b"glTF" or version != 2 or length != len(payload):
        raise ValueError(f"invalid GLB header: {path}")
    offset = 12
    document = None
    binary = b""
    while offset < len(payload):
        size, kind = struct.unpack_from("<II", payload, offset)
        offset += 8
        chunk = payload[offset:offset + size]
        offset += size
        if kind == JSON_CHUNK:
            document = json.loads(chunk.decode("utf-8"))
        elif kind == BIN_CHUNK:
            binary = chunk
    if document is None:
        raise ValueError(f"GLB has no JSON chunk: {path}")
    return document, binary


def align4(data: bytes) -> bytes:
    return data + b"\0" * ((4 - len(data) % 4) % 4)


def remap_value(value, delta: int):
    if isinstance(value, dict):
        return {key: remap_value(item, delta) for key, item in value.items()}
    if isinstance(value, list):
        return [remap_value(item, delta) for item in value]
    return value


def remap_texture_indices(material: dict, delta: int):
    """All integer `index` fields in a glTF material are texture indices."""
    if not delta:
        return

    def visit(value):
        if isinstance(value, dict):
            for key, item in list(value.items()):
                if key == "index" and isinstance(item, int):
                    value[key] = item + delta
                else:
                    visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)

    visit(material)


def merge(base_path: Path, refine_path: Path, output_path: Path):
    base, base_bin = read_glb(base_path)
    refine, refine_bin = read_glb(refine_path)

    base_nodes = len(base.get("nodes", []))
    base_meshes = len(base.get("meshes", []))
    base_accessors = len(base.get("accessors", []))
    base_views = len(base.get("bufferViews", []))
    base_materials = len(base.get("materials", []))
    base_images = len(base.get("images", []))
    base_textures = len(base.get("textures", []))
    base_samplers = len(base.get("samplers", []))
    binary_offset = len(align4(base_bin))

    refined = copy.deepcopy(refine)

    # The refined buffer becomes the second segment of the combined buffer.
    for view in refined.get("bufferViews", []):
        view["buffer"] = 0
        view["byteOffset"] = view.get("byteOffset", 0) + binary_offset
    for accessor in refined.get("accessors", []):
        if "bufferView" in accessor:
            accessor["bufferView"] += base_views
        sparse = accessor.get("sparse")
        if sparse:
            for field in ("indices", "values"):
                if field in sparse and "bufferView" in sparse[field]:
                    sparse[field]["bufferView"] += base_views
    for image in refined.get("images", []):
        if "bufferView" in image:
            image["bufferView"] += base_views
    for texture in refined.get("textures", []):
        if "source" in texture:
            texture["source"] += base_images
        if "sampler" in texture:
            texture["sampler"] += base_samplers
    for material in refined.get("materials", []):
        remap_texture_indices(material, base_textures)

    for mesh in refined.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            if "indices" in primitive:
                primitive["indices"] += base_accessors
            if "material" in primitive:
                primitive["material"] += base_materials
            primitive["attributes"] = {
                key: value + base_accessors for key, value in primitive.get("attributes", {}).items()
            }
            if "targets" in primitive:
                primitive["targets"] = [
                    {key: value + base_accessors for key, value in target.items()}
                    for target in primitive["targets"]
                ]
            draco = primitive.get("extensions", {}).get("KHR_draco_mesh_compression")
            if draco and "bufferView" in draco:
                draco["bufferView"] += base_views

    for node in refined.get("nodes", []):
        if "mesh" in node:
            node["mesh"] += base_meshes
        if "skin" in node:
            node["skin"] += len(base.get("skins", []))
        if "camera" in node:
            node["camera"] += len(base.get("cameras", []))
        if "children" in node:
            node["children"] = [child + base_nodes for child in node["children"]]

    # Keep the full authored scene roots. Append only the independent refine
    # layers so the old main building and site are never silently discarded.
    refine_roots = []
    for index, node in enumerate(refined.get("nodes", [])):
        name = str(node.get("name", ""))
        if name.startswith("Foliage_") and "_secondary_" in name:
            refine_roots.append(base_nodes + index)
        elif name.startswith("GrassTuft_") or name.startswith("DistantWing_"):
            refine_roots.append(base_nodes + index)
    if not refine_roots:
        raise ValueError("no refine layer roots found")

    output = copy.deepcopy(base)
    output["buffers"] = copy.deepcopy(base.get("buffers", [{"byteLength": len(base_bin)}]))
    output["buffers"][0]["byteLength"] = binary_offset + len(refine_bin)
    output["scene"] = 0
    output["scenes"] = copy.deepcopy(base.get("scenes", [{"nodes": []}]))
    output["scenes"][0]["nodes"] = list(output["scenes"][0].get("nodes", [])) + refine_roots

    array_keys = (
        "accessors", "bufferViews", "materials", "meshes", "nodes", "images",
        "textures", "samplers", "skins", "cameras", "animations",
    )
    for key in array_keys:
        if key in refined:
            output[key] = copy.deepcopy(base.get(key, [])) + refined[key]
    output["extensionsUsed"] = sorted(set(base.get("extensionsUsed", [])) | set(refine.get("extensionsUsed", [])))
    output["extensionsRequired"] = sorted(set(base.get("extensionsRequired", [])) | set(refine.get("extensionsRequired", [])))

    binary = align4(base_bin) + refine_bin
    document = json.dumps(output, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    document = document + b" " * ((4 - len(document) % 4) % 4)
    result = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(document) + 8 + len(binary))
    result += struct.pack("<II", len(document), JSON_CHUNK) + document
    result += struct.pack("<II", len(binary), BIN_CHUNK) + binary
    output_path.write_bytes(result)
    return {
        "bytes": len(result),
        "sha256": hashlib.sha256(result).hexdigest(),
        "base_nodes": base_nodes,
        "refine_nodes": len(refined.get("nodes", [])),
        "refine_roots": len(refine_roots),
        "total_nodes": len(output.get("nodes", [])),
        "total_meshes": len(output.get("meshes", [])),
    }


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("usage: merge_full_scene.py BASE_GLB REFINE_GLB OUTPUT_GLB")
    print(json.dumps(merge(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])), indent=2))
