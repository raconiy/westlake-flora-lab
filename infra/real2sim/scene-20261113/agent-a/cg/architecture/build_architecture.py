"""Architectural assets for the real2sim outdoor campus scene.

The module is deliberately side-effect free on import.  ``build`` creates two
independent roots: a curved glazed colonnade and a long ribbon academic block.
All dimensions are approximate scene metres; the assets are intended to be
placed by the scene compositor rather than used as a survey.
"""

from __future__ import annotations

import math
from typing import Iterable, List, Sequence, Tuple

import bpy


Vec3 = Tuple[float, float, float]


def _material(name: str, color: Tuple[float, float, float, float], roughness: float,
              metallic: float = 0.0) -> bpy.types.Material:
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.42
    return mat


def _root(name: str, asset_id: str, category: str) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj["asset_id"] = asset_id
    obj["category"] = category
    obj["source"] = "procedural architectural approximation"
    return obj


def _parent(obj: bpy.types.Object, parent: bpy.types.Object) -> bpy.types.Object:
    obj.parent = parent
    return obj


def _mesh(name: str, vertices: Sequence[Vec3], faces: Sequence[Sequence[int]],
          material: bpy.types.Material, parent: bpy.types.Object) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(list(vertices), [], [tuple(f) for f in faces])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    _parent(obj, parent)
    return obj


def _cube(name: str, loc: Vec3, dimensions: Vec3, material: bpy.types.Material,
          parent: bpy.types.Object, rotation_z: float = 0.0,
          bevel: float = 0.0) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=(0.0, 0.0, rotation_z))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    _parent(obj, parent)
    if bevel > 0.0:
        mod = obj.modifiers.new("soft architectural edges", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    return obj


def _cylinder(name: str, loc: Vec3, radius: float, depth: float,
              material: bpy.types.Material, parent: bpy.types.Object,
              vertices: int = 16) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    _parent(obj, parent)
    return obj


def _ellipse_point(cx: float, cy: float, rx: float, ry: float, theta: float,
                   wobble: float = 0.0) -> Tuple[float, float]:
    # Small deterministic deviation keeps the roof edge from looking CAD-perfect.
    scale = 1.0 + wobble * (0.45 * math.sin(3.0 * theta) + 0.25 * math.sin(7.0 * theta))
    return cx + rx * scale * math.cos(theta), cy + ry * scale * math.sin(theta)


def _ellipse_ring(name: str, cx: float, cy: float, outer: Tuple[float, float],
                  inner: Tuple[float, float], z0: float, z1: float,
                  material: bpy.types.Material, parent: bpy.types.Object,
                  segments: int = 96, wobble: float = 0.0) -> bpy.types.Object:
    verts: List[Vec3] = []
    for z in (z0, z1):
        for radius in (outer, inner):
            for i in range(segments):
                p = _ellipse_point(cx, cy, radius[0], radius[1], 2.0 * math.pi * i / segments, wobble)
                verts.append((p[0], p[1], z))
    # index layer: z * 2*segments + radial * segments + i
    n = segments
    ob = 0
    ib = n
    ot = 2 * n
    it = 3 * n
    faces: List[Tuple[int, ...]] = []
    for i in range(n):
        j = (i + 1) % n
        faces.extend([
            (ob + i, ob + j, ot + j, ot + i),
            (ib + j, ib + i, it + i, it + j),
            (ot + i, ot + j, it + j, it + i),
            (ob + j, ob + i, ib + i, ib + j),
        ])
    return _mesh(name, verts, faces, material, parent)


def _ellipse_solid(name: str, cx: float, cy: float, radii: Tuple[float, float],
                   z0: float, z1: float, material: bpy.types.Material,
                   parent: bpy.types.Object, segments: int = 96,
                   wobble: float = 0.0) -> bpy.types.Object:
    verts: List[Vec3] = [(cx, cy, z0), (cx, cy, z1)]
    for z in (z0, z1):
        for i in range(segments):
            p = _ellipse_point(cx, cy, radii[0], radii[1], 2.0 * math.pi * i / segments, wobble)
            verts.append((p[0], p[1], z))
    b = 2
    t = 2 + segments
    faces: List[Tuple[int, ...]] = []
    for i in range(segments):
        j = (i + 1) % segments
        faces.extend([(0, b + j, b + i), (1, t + i, t + j), (b + i, b + j, t + j, t + i)])
    return _mesh(name, verts, faces, material, parent)


def _ellipse_sector(name: str, cx: float, cy: float, inner: Tuple[float, float],
                    outer: Tuple[float, float], a0: float, a1: float,
                    z0: float, z1: float, material: bpy.types.Material,
                    parent: bpy.types.Object) -> bpy.types.Object:
    points = []
    for z in (z0, z1):
        for rx, ry in (inner, outer):
            for a in (a0, a1):
                points.append((*_ellipse_point(cx, cy, rx, ry, a), z))
    # [inner0, inner1, outer0, outer1] for each z layer
    faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 4, 6, 2), (1, 3, 7, 5),
             (0, 1, 5, 4), (2, 6, 7, 3)]
    return _mesh(name, points, faces, material, parent)


def _glazing_panel(name: str, cx: float, cy: float, radii: Tuple[float, float],
                   thickness: float, a0: float, a1: float, z0: float, z1: float,
                   material: bpy.types.Material, parent: bpy.types.Object) -> bpy.types.Object:
    rox, roy = radii
    # A radial inset makes the dark glazing visibly recessed behind the columns.
    rix, riy = rox - thickness, roy - thickness
    p0 = _ellipse_point(cx, cy, rox, roy, a0)
    p1 = _ellipse_point(cx, cy, rox, roy, a1)
    q0 = _ellipse_point(cx, cy, rix, riy, a0)
    q1 = _ellipse_point(cx, cy, rix, riy, a1)
    verts = [(p0[0], p0[1], z0), (p1[0], p1[1], z0), (q1[0], q1[1], z0), (q0[0], q0[1], z0),
             (p0[0], p0[1], z1), (p1[0], p1[1], z1), (q1[0], q1[1], z1), (q0[0], q0[1], z1)]
    faces = [(0, 1, 5, 4), (3, 2, 6, 7), (0, 4, 7, 3), (1, 2, 6, 5),
             (4, 5, 6, 7), (3, 7, 6, 2)]
    return _mesh(name, verts, faces, material, parent)


def _path_ribbon(name: str, cx: float, y0: float, y1: float, width: float,
                 curve_amp: float, z0: float, z1: float,
                 material: bpy.types.Material, parent: bpy.types.Object,
                 samples: int = 48) -> bpy.types.Object:
    """A shallow curved-plan prism used for the west building's horizontal bands."""
    verts: List[Vec3] = []
    half = width * 0.5
    for z in (z0, z1):
        for i in range(samples + 1):
            t = i / samples
            y = y0 + (y1 - y0) * t
            center = cx + curve_amp * math.sin(math.pi * t)
            # Sides stay nearly orthogonal to the long axis; this keeps bands crisp.
            verts.extend([(center - half, y, z), (center + half, y, z)])
    faces: List[Tuple[int, ...]] = []
    row = 2 * (samples + 1)
    for i in range(samples):
        a, b = 2 * i, 2 * (i + 1)
        faces.extend([(a, b, row + b, row + a), (a + 1, row + a + 1, row + b + 1, b + 1),
                      (row + a, row + b, row + b + 1, row + a + 1), (b, a, a + 1, b + 1)])
    faces.extend([(0, row, row + 1, 1), (2 * samples, 2 * samples + 1,
                                        row + 2 * samples + 1, row + 2 * samples)])
    return _mesh(name, verts, faces, material, parent)


def _main_colonnade(root: bpy.types.Object, mats: dict) -> None:
    cx, cy = 4.0, 36.0
    outer = (26.0, 12.0)

    # Fine stone apron: alternating sectors read as large pale paving slabs.
    for i in range(36):
        a0 = 2.0 * math.pi * i / 36.0
        a1 = 2.0 * math.pi * (i + 0.92) / 36.0
        _ellipse_sector("colonnade_apron_slab_%02d" % i, cx, cy, (26.2, 12.2),
                        (29.5, 16.2), a0, a1, 0.015, 0.10,
                        mats["stone_a" if i % 3 else "stone_b"], root)
    _ellipse_ring("colonnade_plinth", cx, cy, (26.3, 12.3), (24.8, 10.8),
                  0.12, 0.48, mats["concrete"], root, 96)

    # Recessed glazing and its narrow mullions.
    count = 46
    glass_radii = (23.8, 9.85)
    for i in range(count):
        a0 = 2.0 * math.pi * i / count + 0.012
        a1 = 2.0 * math.pi * (i + 0.98) / count - 0.012
        _glazing_panel("colonnade_glass_%02d" % i, cx, cy, glass_radii, 0.20,
                       a0, a1, 0.66, 7.86, mats["glass"], root)
        a = 2.0 * math.pi * i / count
        x, y = _ellipse_point(cx, cy, glass_radii[0] + 0.03, glass_radii[1] + 0.03, a)
        _cube("colonnade_mullion_%02d" % i, (x, y, 4.26), (0.13, 0.13, 7.32),
              mats["silver"], root, rotation_z=a + math.pi * 0.5, bevel=0.018)

    # Subtle horizontal glazing rails, kept as elliptical ribbons rather than a blank wall.
    for j, z in enumerate((2.72, 5.38, 7.78)):
        _ellipse_ring("colonnade_glass_rail_%02d" % j, cx, cy,
                      (23.95, 10.0), (23.79, 9.84), z - 0.045, z + 0.045,
                      mats["silver"], root, 96)

    # Detached round columns, capitals and foot blocks around the outer ellipse.
    for i in range(count):
        a = 2.0 * math.pi * i / count
        x, y = _ellipse_point(cx, cy, 25.05, 11.05, a, 0.002)
        r = 0.39 + (0.045 if i % 7 == 0 else 0.0)
        _cylinder("colonnade_column_%02d" % i, (x, y, 4.25), r, 7.52,
                  mats["concrete" if i % 5 else "concrete_light"], root, 16)
        _cylinder("colonnade_column_base_%02d" % i, (x, y, 0.58), r * 1.20, 0.22,
                  mats["concrete_light"], root, 16)
        _cylinder("colonnade_column_cap_%02d" % i, (x, y, 8.03), r * 1.22, 0.18,
                  mats["concrete_light"], root, 16)

    # Layered roof fascia and the slightly raised central elliptical roof mass.
    _ellipse_ring("colonnade_roof_fascia", cx, cy, outer, (24.75, 10.75),
                  8.18, 8.78, mats["concrete_light"], root, 112, 0.006)
    _ellipse_ring("colonnade_roof_shadow_joint", cx, cy, (25.85, 11.85),
                  (24.95, 10.95), 8.10, 8.22, mats["shadow_concrete"], root, 112)
    _ellipse_ring("colonnade_roof_upper_trim", cx, cy, (25.3, 11.3),
                  (24.3, 10.3), 8.77, 8.98, mats["silver"], root, 112, 0.004)
    _ellipse_solid("colonnade_raised_roof", cx, cy + 0.2, (19.2, 6.55),
                   8.84, 9.70, mats["concrete"], root, 96, 0.010)
    _ellipse_ring("colonnade_roof_inner_line", cx, cy + 0.2, (18.85, 6.2),
                  (18.45, 5.8), 9.64, 9.77, mats["concrete_light"], root, 96)

    # A recessed entrance on the south face, with three glazed leaves and a deep lintel.
    front_y = cy - 9.66
    _cube("colonnade_entry_reveal", (cx, front_y + 0.03, 3.35), (13.8, 0.18, 6.0),
          mats["glass"], root)
    for i in range(5):
        x = cx - 6.4 + i * 3.2
        _cube("colonnade_entry_frame_%02d" % i, (x, front_y - 0.08, 3.42),
              (0.11, 0.22, 6.25), mats["silver"], root, bevel=0.012)
    _cube("colonnade_entry_head", (cx, front_y - 0.08, 6.53), (13.0, 0.22, 0.15),
          mats["silver"], root)
    _cube("colonnade_entry_step", (cx, front_y - 0.62, 0.18), (15.0, 1.5, 0.20),
          mats["stone_b"], root, bevel=0.035)
    _cube("colonnade_entry_step_upper", (cx, front_y - 0.33, 0.34), (14.3, 0.62, 0.12),
          mats["stone_a"], root, bevel=0.02)


def _academic_block(root: bpy.types.Object, mats: dict) -> None:
    cx, y0, y1 = -53.0, -14.0, 58.0
    amp = 3.0
    # Lower plinth and repeated glazed ribbons.  Each band follows the slight plan curve.
    _path_ribbon("academic_plinth", cx, y0, y1, 15.6, amp, 0.0, 0.72, mats["concrete_light"], root)
    glass_bands = [(0.82, 3.20), (3.82, 6.18), (6.80, 9.16), (9.78, 12.14), (12.76, 15.15)]
    for j, (z0, z1) in enumerate(glass_bands):
        _path_ribbon("academic_glass_band_%02d" % j, cx, y0, y1, 14.4, amp,
                     z0, z1, mats["west_glass"], root)
        # Slightly projecting white/silver slab between floors.
        slab_z = z0 - 0.18
        _path_ribbon("academic_floor_slab_%02d" % j, cx, y0 - 0.18, y1 + 0.18,
                     15.1, amp, slab_z, slab_z + 0.34, mats["silver"], root)
    _path_ribbon("academic_roof_fascia", cx, y0 - 0.25, y1 + 0.25, 15.8, amp,
                 15.28, 16.12, mats["concrete_light"], root)
    _path_ribbon("academic_roof_shadow", cx, y0, y1, 15.35, amp, 16.12, 16.40,
                 mats["shadow_concrete"], root)
    _path_ribbon("academic_parapet_cap", cx, y0 - 0.35, y1 + 0.35, 16.0, amp,
                 16.40, 16.72, mats["silver"], root)

    # Side mullions at each floor and along both curved elevations.
    samples = 25
    for j, (z0, z1) in enumerate(glass_bands):
        for i in range(samples):
            t = (i + 0.5) / samples
            y = y0 + (y1 - y0) * t
            center = cx + amp * math.sin(math.pi * t)
            # Tangent direction changes only a few degrees, but rotating the post keeps it seated.
            tangent_x = amp * math.pi * math.cos(math.pi * t) / (y1 - y0)
            angle = math.atan2(1.0, tangent_x)
            for side in (-1.0, 1.0):
                x = center + side * 7.20
                _cube("academic_mullion_%02d_%02d_%s" % (j, i, "l" if side < 0 else "r"),
                      (x, y, (z0 + z1) * 0.5), (0.14, 0.13, z1 - z0 + 0.12),
                      mats["silver"], root, rotation_z=angle, bevel=0.012)

    # End walls make the repeated ribbons read as a real building from the approach road.
    for end_i, y in enumerate((y0 - 0.08, y1 + 0.08)):
        _cube("academic_end_glass_%s" % ("south" if end_i == 0 else "north"),
              (cx, y, 8.45), (14.0, 0.20, 14.9), mats["west_glass"], root)
        for k in range(5):
            _cube("academic_end_frame_%s_%02d" % ("south" if end_i == 0 else "north", k),
                  (cx - 5.4 + k * 2.7, y - 0.14 if end_i == 0 else y + 0.14, 8.45),
                  (0.13, 0.28, 15.1), mats["concrete_light"], root)
        for z in (3.42, 6.44, 9.46, 12.48, 15.38):
            _cube("academic_end_slab_%s_%s" % ("south" if end_i == 0 else "north", str(z)),
                  (cx, y - 0.04 if end_i == 0 else y + 0.04, z), (14.8, 0.30, 0.22),
                  mats["silver"], root)

    # A low continuous service wing behind the ribbon facade gives the west building depth.
    _path_ribbon("academic_rear_service", cx + 0.4, y0 + 1.0, y1 - 1.0, 13.2, amp,
                 0.70, 1.05, mats["concrete"], root)


def build() -> list:
    """Create and return independent architecture asset roots.

    No scene, camera, world, or export settings are changed here.  The caller
    owns placement and GLB export.
    """
    mats = {
        "concrete": _material("ARCH_concrete_pale", (0.64, 0.66, 0.65, 1.0), 0.72),
        "concrete_light": _material("ARCH_concrete_light", (0.78, 0.79, 0.77, 1.0), 0.66),
        "shadow_concrete": _material("ARCH_concrete_shadow", (0.43, 0.46, 0.46, 1.0), 0.68),
        "silver": _material("ARCH_anodized_silver", (0.50, 0.55, 0.56, 1.0), 0.30, 0.42),
        "glass": _material("ARCH_colonnade_glass", (0.055, 0.10, 0.12, 1.0), 0.25, 0.18),
        "west_glass": _material("ARCH_west_blue_glass", (0.075, 0.13, 0.16, 1.0), 0.29, 0.20),
        "stone_a": _material("ARCH_paving_stone_a", (0.62, 0.63, 0.61, 1.0), 0.78),
        "stone_b": _material("ARCH_paving_stone_b", (0.70, 0.70, 0.67, 1.0), 0.76),
    }
    main_root = _root("ARCH_MainColonnade", "architecture.main_colonnade.v1", "architecture")
    west_root = _root("ARCH_WestAcademic", "architecture.west_academic.v1", "architecture")
    _main_colonnade(main_root, mats)
    _academic_block(west_root, mats)
    return [main_root, west_root]


__all__ = ["build"]
