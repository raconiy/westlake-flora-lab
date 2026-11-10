"""Apply the root-constrained forked broadleaf and clear grass at its base.

blender -b SCENE.blend -P install_secondary_blender.py -- secondary-grounded.blend contact-fit.json grounded-collisions.json OUTPUT.blend RECEIPT.json
"""

from pathlib import Path
import json, sys
import bpy
import numpy as np
from mathutils import Matrix, Vector

asset, fitfile, collisions, result, receipt = map(
    Path, sys.argv[sys.argv.index("--") + 1 :]
)
fit = json.loads(fitfile.read_text())
segment = json.loads(collisions.read_text())["segments"][0]
old = bpy.data.objects["tree.right-group"]
old_parent = old.parent
collections = list(old.users_collection)
for obj in list(old.children_recursive):
    bpy.data.objects.remove(obj, do_unlink=True)
bpy.data.objects.remove(old, do_unlink=True)
with bpy.data.libraries.load(str(asset.resolve()), link=False) as (available, loaded):
    loaded.objects = [
        n
        for n in available.objects
        if n == "tree.right-group" or n.startswith("tree.right-group.")
    ]
for obj in loaded.objects:
    for collection in collections:
        collection.objects.link(obj)
root = bpy.data.objects["tree.right-group"]
root.parent = old_parent
x, y, z = fit["rootThreeM"]
root.matrix_world = Matrix.Translation((x, -z, y))
root["groundClearance"] = (
    "Contact at nominal y=0; free triangulation yields y=-0.674 m."
)
q = segment["endM"]
col = bpy.data.objects.new("tree.right-group.collider.stem", None)
collections[0].objects.link(col)
col.parent = root
col["shape"] = "capsule"
col["radius"] = segment["radiusM"]
col["end_local"] = [q[0], -q[2], q[1]]
col["use"] = "static lower stem, nominal radius"
root["wind_speed_m_s"] = 0.0
root.id_properties_ui("wind_speed_m_s").update(
    min=0.0,
    max=12.0,
    description="Illustrative crown wind input in metres per second, no measured stiffness",
)
joints = [o for o in root.children_recursive if o.get("wind_joint")]
for i, obj in enumerate(joints):
    f = obj.driver_add("rotation_euler", 1)
    driver = f.driver
    var = driver.variables.new()
    var.name = "speed"
    var.type = "SINGLE_PROP"
    var.targets[0].id_type = "OBJECT"
    var.targets[0].id = root
    var.targets[0].data_path = '["wind_speed_m_s"]'
    driver.expression = f"{.008+(i%5)*.002:.3f}*min(max(speed,0),12)/6*(sin(frame*0.081+{i*.57:.4f})+0.31*sin(frame*0.153+{i:.3f}))"
radius = fit["rootRadiusM"] + 0.108 + 0.025
m = bpy.data.collections.get("Capture17 supplemental meadow")
assert m
removed = 0
total = 0
for obj in m.objects:
    if obj.type != "MESH" or "persistent_tufts" not in obj:
        continue
    oldmesh = obj.data
    n = len(oldmesh.vertices)
    assert not len(oldmesh.edges) and not len(oldmesh.polygons)
    coords = np.empty((n, 3), np.float32)
    oldmesh.vertices.foreach_get("co", coords.ravel())
    keep = (coords[:, 0] - x) ** 2 + (coords[:, 1] + z) ** 2 > radius**2
    n2 = int(keep.sum())
    total += n2
    if n2 == n:
        continue
    removed += n - n2
    new = bpy.data.meshes.new(oldmesh.name + ".refit")
    new.vertices.add(n2)
    new.vertices.foreach_set("co", np.ascontiguousarray(coords[keep]).ravel())
    for a in list(oldmesh.attributes):
        if not len(a.data) or a.is_internal or a.name.startswith(".") or a.name == "position":
            continue
        assert a.domain == "POINT" and a.data_type in (
            "FLOAT_VECTOR",
            "FLOAT_COLOR",
            "FLOAT",
        ), (a.name, a.data_type, a.domain)
        dims, field = {
            "FLOAT_VECTOR": (3, "vector"),
            "FLOAT_COLOR": (4, "color"),
            "FLOAT": (1, "value"),
        }[a.data_type]
        values = np.empty((n, dims), np.float32)
        a.data.foreach_get(field, values.ravel())
        b = new.attributes.new(a.name, a.data_type, a.domain)
        b.data.foreach_set(field, np.ascontiguousarray(values[keep]).ravel())
    new.update()
    obj.data = new
    obj["persistent_tufts"] = n2
    if not oldmesh.users:
        bpy.data.meshes.remove(oldmesh)
if removed not in (0, 4, 60):
    raise RuntimeError(f"Unexpected turf mask: {removed} removed")
m["attachment_tufts"] = total
m["full_field_tufts"] = 510627
bpy.context.view_layer.update()
source = bpy.data.objects.get("tree.right-group.trunk")
assert (
    source
    and len(joints) >= 12
    and min((source.matrix_world @ v.co).z for v in source.data.vertices) > -1.0e-5
)
bpy.ops.wm.save_as_mainfile(filepath=str(result.resolve()), compress=True)
receipt.write_text(
    json.dumps(
        {
            "rootThreeM": [x, y, z],
            "windJoints": len(joints),
            "removedTufts": removed,
            "remainingNativeTufts": total,
            "clearedRadiusM": radius,
            "oldScarPreserved": True,
            "colliderEndLocalBlender": col["end_local"][:],
        },
        indent=2,
    )
)
