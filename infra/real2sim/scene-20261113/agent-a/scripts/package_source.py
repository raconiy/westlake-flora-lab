#!/usr/bin/env python3
"""Synchronize the latest CG sources and create the public source-only ZIP.

Run from the server after the final CG edits. This tool never edits its input
CG modules, the application, or the viewer. REAL2SIM_ROOT defaults to this
script's package root; --source-root and --repo can override the two locations.
"""
from __future__ import annotations

import argparse
import ast
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import zipfile

SCENE = "scene-20261113"
AGENT = "agent-a"
MODULES = {
    "architecture": "build_architecture.py",
    "terrain": "build_ground.py",
    "vegetation": "build_vegetation.py",
}
SCRIPT_NAMES = (
    "assemble_scene.py", "refine_architecture.py", "refine_materials.py",
    "create_textures.py", "render_scene.py", "prepare_web.py",
    "package_source.py",
)
OPTIONAL_SCRIPTS = ("refine_environment.py",)
VIEWER_NAMES = ("index.html", "style.css", "viewer.js")
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
MODULE_SUFFIXES = IMAGE_SUFFIXES | {".py", ".json"}
SECRET_PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b"),
    re.compile(r'''(?i)["']?(?:api[_-]?key|access[_-]?token|password|client[_-]?secret)["']?\s*[:=]\s*["'][^"'\r\n]{8,}["']'''),
)
TEXT_SUFFIXES = {".py", ".json", ".md", ".gitignore", ".html", ".css", ".js"}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def checked_read(path, source_root):
    if path.is_symlink():
        raise ValueError(f"Refusing symlink: {path.relative_to(source_root)}")
    if not path.is_file():
        raise FileNotFoundError(f"Missing required source: {path.relative_to(source_root)}")
    if not path.resolve().is_relative_to(source_root):
        raise ValueError("Source escapes the selected root")
    data = path.read_bytes()
    if not data:
        raise ValueError(f"Empty source file: {path.relative_to(source_root)}")
    return data


def inspect_text(data, relative_path):
    text = data.decode("utf-8")
    for pattern in SECRET_PATTERNS:
        if pattern.search(text):
            raise ValueError(f"Possible embedded credential in {relative_path}; packaging stopped")
    return text


def portable_python(text, relative_path, source_root):
    """Rewrite only literal paths in the copy, preserving source formatting."""
    tree = ast.parse(text, filename=str(relative_path))
    lines = text.splitlines(keepends=True)
    starts = [0]
    for line in lines:
        starts.append(starts[-1] + len(line.encode("utf-8")))
    encoded = text.encode("utf-8")
    replacements = []
    prefix = str(source_root)
    for node in ast.walk(tree):
        if not isinstance(node, ast.Constant) or not isinstance(node.value, str):
            continue
        if node.value == prefix:
            expression = "str(_REAL2SIM_ROOT)"
        elif node.value.startswith(prefix + "/"):
            expression = f"str(_REAL2SIM_ROOT / {node.value[len(prefix) + 1:]!r})"
        else:
            continue
        a = starts[node.lineno - 1] + node.col_offset
        b = starts[node.end_lineno - 1] + node.end_col_offset
        replacements.append((a, b, expression.encode("utf-8")))
    if not replacements:
        return text
    for a, b, replacement in sorted(replacements, reverse=True):
        encoded = encoded[:a] + replacement + encoded[b:]
    text = encoded.decode("utf-8")
    # Insert after a module docstring and __future__ imports, when present.
    tree = ast.parse(text)
    insertion_line = 0
    for i, node in enumerate(tree.body):
        if i == 0 and isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            insertion_line = node.end_lineno
        elif isinstance(node, ast.ImportFrom) and node.module == "__future__":
            insertion_line = node.end_lineno
        else:
            break
    parent_index = len(relative_path.parts) - 1
    helper = (
        "\n# Portable package root; override only when using another runtime directory.\n"
        "import os as _real2sim_os\n"
        "from pathlib import Path as _Real2SimPath\n"
        "_REAL2SIM_ROOT = _Real2SimPath(_real2sim_os.environ.get(\n"
        f"    'REAL2SIM_ROOT', str(_Real2SimPath(__file__).resolve().parents[{parent_index}])\n"
        ")).expanduser().resolve()\n\n"
    )
    lines = text.splitlines(keepends=True)
    text = "".join(lines[:insertion_line]) + helper + "".join(lines[insertion_line:])
    ast.parse(text, filename=str(relative_path))
    return text


def collect(source_root):
    paths = []
    for module, builder in MODULES.items():
        folder = source_root / "cg" / module
        for required in (folder / builder, folder / "metadata.json"):
            checked_read(required, source_root)
        paths.extend(
            p for p in sorted(folder.rglob("*"))
            if p.is_file() and p.suffix.lower() in MODULE_SUFFIXES
            and "__pycache__" not in p.parts
        )
    for name in SCRIPT_NAMES:
        paths.append(source_root / "scripts" / name)
    for name in OPTIONAL_SCRIPTS:
        path = source_root / "scripts" / name
        if path.is_file():
            paths.append(path)
    # Retain the source layout expected by the final prepare_web.py.
    for folder in (source_root / "viewer", source_root / "agents" / "viewer"):
        if folder.is_dir():
            for name in VIEWER_NAMES:
                path = folder / name
                checked_read(path, source_root)
                paths.append(path)
            break
    for relative in ("assets/environment.jpg", "environment.jpg"):
        path = source_root / relative
        if path.is_file():
            paths.append(path)
    texture_files = sorted(
        p for p in (source_root / "assets" / "textures").rglob("*")
        if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES
    )
    if not texture_files:
        raise ValueError("No material textures found")
    paths.extend(texture_files)

    payload, originals = {}, {}
    for path in paths:
        relative = path.relative_to(source_root)
        data = checked_read(path, source_root)
        originals[relative.as_posix()] = sha256(data)
        if path.suffix.lower() in TEXT_SUFFIXES:
            text = inspect_text(data, relative)
            if path.suffix.lower() == ".py":
                text = portable_python(text, relative, source_root)
                ast.parse(text, filename=relative.as_posix())
            elif path.suffix.lower() == ".json":
                json.loads(text)
            if str(source_root) in text:
                raise ValueError(f"Unconverted source-root path in {relative}")
            data = text.encode("utf-8")
        payload[relative.as_posix()] = data

    template = source_root / "scripts" / "source_README.md"
    if not template.is_file():
        template = source_root / "README.md"
    readme = checked_read(template, source_root)
    inspect_text(readme, "README.md")
    payload["README.md"] = readme
    payload["scripts/source_README.md"] = readme
    payload[".gitignore"] = (
        "__pycache__/\n*.py[cod]\n.venv/\n.env*\n"
        "scenes/\nexports/\nrenders/\nframes/\nsource/\n"
        "cache/\nlogs/\nruns/\nenvs/\nnode_modules/\n*.blend*\n*.mp4\n"
    ).encode()
    meta = [
        json.loads(payload[f"cg/{module}/metadata.json"])
        for module in MODULES
    ]
    count = sum(len(item.get("assets") or item.get("asset_ids") or item.get("root_ids") or item.get("plants") or []) for item in meta)
    if count != 28:
        raise ValueError(f"Expected 28 independently managed assets, metadata reports {count}")
    inventory = {
        "schema_version": 1,
        "scene_id": SCENE,
        "agent_id": AGENT,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "asset_count": count,
        "root_environment_variable": "REAL2SIM_ROOT",
        "default_root": "directory containing README.md",
        "exclusions": [
            "API credentials and dispatchers", "dependencies and environments",
            "model weights and caches", "videos and reference frames",
            "event logs", "rendered images", "Blender projects and GLB exports",
        ],
        "files": [
            {
                "path": name, "bytes": len(data), "sha256": sha256(data),
                **({"original_sha256": originals[name]} if name in originals else {}),
            }
            for name, data in sorted(payload.items())
        ],
    }
    payload["source-manifest.json"] = (
        json.dumps(inventory, ensure_ascii=False, indent=2) + "\n"
    ).encode()
    return payload


def archive_bytes(payload):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for relative, data in sorted(payload.items()):
            member = zipfile.ZipInfo(f"{AGENT}/{relative}", date_time=(2026, 11, 13, 0, 0, 0))
            member.compress_type = zipfile.ZIP_DEFLATED
            member.external_attr = 0o100644 << 16
            archive.writestr(member, data)
    data = stream.getvalue()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        bad = archive.testzip()
        if bad is not None:
            raise ValueError(f"Archive integrity failure: {bad}")
        if len(archive.namelist()) != len(payload):
            raise ValueError("Archive member count mismatch")
    return data


def synchronize(payload, target, archive, zipped):
    target.parent.mkdir(parents=True, exist_ok=True)
    archive.parent.mkdir(parents=True, exist_ok=True)
    if target.is_symlink() or archive.is_symlink():
        raise ValueError("Refusing a symlink output")
    staging = Path(tempfile.mkdtemp(prefix=".agent-a-source-", dir=target.parent))
    backup = None
    try:
        for relative, data in payload.items():
            dest = staging / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
        if target.exists():
            backup = Path(tempfile.mkdtemp(prefix=".agent-a-source-backup-", dir=target.parent))
            backup.rmdir()
            target.replace(backup)
        try:
            staging.replace(target)
        except Exception:
            if backup is not None:
                backup.replace(target)
            raise
        if backup is not None:
            shutil.rmtree(backup)
        with tempfile.NamedTemporaryFile(prefix=".source-", suffix=".zip", dir=archive.parent, delete=False) as handle:
            temporary_zip = Path(handle.name)
            handle.write(zipped)
        os.chmod(temporary_zip, 0o644)
        os.replace(temporary_zip, archive)
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def main():
    default_root = Path(os.environ.get("REAL2SIM_ROOT", Path(__file__).resolve().parents[1]))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=default_root)
    parser.add_argument("--repo", type=Path, help="Existing website checkout; defaults to SOURCE_ROOT/repo")
    parser.add_argument("--check-only", action="store_true", help="Validate current inputs and ZIP in memory without writing outputs")
    args = parser.parse_args()
    source_root = args.source_root.expanduser().resolve()
    repo = (args.repo or source_root / "repo").expanduser().resolve()
    if not (repo / "package.json").is_file():
        raise ValueError("--repo must point to the existing website checkout")
    target = repo / "infra" / "real2sim" / SCENE / AGENT
    archive = repo / "public" / "real2sim" / SCENE / AGENT / "source.zip"
    payload = collect(source_root)
    zipped = archive_bytes(payload)
    if not args.check_only:
        synchronize(payload, target, archive, zipped)
    print(json.dumps({
        "status": "validated" if args.check_only else "packaged",
        "files": len(payload), "asset_count": 28,
        "source_directory": str(target), "archive": str(archive),
        "archive_bytes": len(zipped), "archive_sha256": sha256(zipped),
        "original_sources_modified": False,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
