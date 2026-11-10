"""Replace only four turf prototypes in a CAP17 Blender project and verify its planting.

blender -b original.blend -P replace_meadow_blades.py -- meadow-full.glb result.blend receipt.json
"""
import hashlib
import json
from pathlib import Path
import sys

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from import_meadow import axis, parse_glb, set_color


def sha(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def array_hash(values):
    return hashlib.sha256(np.ascontiguousarray(values).tobytes()).hexdigest()


def mesh_values(mesh, attribute, field, channels):
    result = np.empty((len(mesh.vertices), channels), np.float32)
    attribute.foreach_get(field, result.ravel())
    return result


arguments = sys.argv[sys.argv.index('--') + 1:]
update_light = '--update-instance-light' in arguments
source, target, receipt = map(Path, (arg for arg in arguments if arg != '--update-instance-light'))
base = Path(bpy.data.filepath)
if base.resolve() == target.resolve():
    raise ValueError('Output must be distinct from the base project')
doc, read = parse_glb(source)
results = []
for node in doc['nodes']:
    ext = node.get('extensions', {}).get('EXT_mesh_gpu_instancing')
    if not ext:
        continue
    cloud = bpy.data.objects[node['name']]
    count = len(cloud.data.vertices)
    geom, = doc['meshes'][node['mesh']]['primitives']
    attrs = ext['attributes']
    expected = np.array(read(attrs['TRANSLATION']), np.float32)[:, [0, 2, 1]].copy()
    expected[:, 1] *= -1
    actual = mesh_values(cloud.data, cloud.data.vertices, 'co', 3)
    if not np.array_equal(actual, expected):
        raise ValueError('Tuft root changed in ' + cloud.name)
    incident = mesh_values(cloud.data, cloud.data.color_attributes['meadow_irradiance'].data, 'color', 4)
    scale = mesh_values(cloud.data, cloud.data.attributes['meadow_scale'].data, 'vector', 3)
    euler = mesh_values(cloud.data, cloud.data.attributes['meadow_euler'].data, 'vector', 3)
    rot = np.array(read(attrs['ROTATION']), np.float32)
    archived_tint = np.array(read(attrs['_COLOR_0']), np.float32)
    expected_scale = np.array(read(attrs['SCALE']), np.float32)[:, [0, 2, 1]]
    if not np.array_equal(scale, expected_scale):
        raise ValueError('Tuft scale changed')
    if not np.array_equal(incident[:, :3], archived_tint[:, :3]):
        if not update_light:
            raise ValueError('Instance light differs; request the explicit calibration override')
        incident[:, :3] = archived_tint[:, :3]
        cloud.data.color_attributes['meadow_irradiance'].data.foreach_set('color', incident.ravel())
        cloud.data.update()
        stored = mesh_values(cloud.data, cloud.data.color_attributes['meadow_irradiance'].data, 'color', 4)
        if not np.array_equal(stored, incident):
            raise ValueError('Stored grass incident field differs from the public GLB')
    if np.max(abs(euler[:, 2] - 2*np.arctan2(rot[:, 1].astype(float), rot[:, 3].astype(float)))) > 4.e-7:
        raise ValueError('Tuft yaw changed')
    group = cloud.modifiers[0].node_group
    info, = [n for n in group.nodes if n.bl_idname == 'GeometryNodeObjectInfo']
    prototype = info.inputs['Object'].default_value
    old = prototype.data
    mat, = list(old.materials)
    mesh = bpy.data.meshes.new(old.name + ' curved lamina')
    vertices = [axis(v) for v in read(geom['attributes']['POSITION'])]
    indices = [i for i, in read(geom['indices'])]
    mesh.from_pydata(vertices, [], list(zip(indices[::3], indices[1::3], indices[2::3])))
    mesh.update()
    mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
    mesh.normals_split_custom_set_from_vertices([axis(v) for v in read(geom['attributes']['NORMAL'])])
    set_color(mesh, 'blade_albedo', read(geom['attributes']['COLOR_0']))
    mesh.materials.append(mat)
    prototype.data = mesh
    if old.users == 0:
        bpy.data.meshes.remove(old)
    results.append({'group': cloud.name, 'tufts': count, 'groupCoordinateSha256': array_hash(actual),
                    'groupOrientationSha256': array_hash(euler), 'groupScaleSha256': array_hash(scale),
                    'groupIncidentLightSha256': array_hash(incident), 'bladesPerTuft': geom['extras']['bladesPerTuft'],
                    'templateVertices': len(vertices), 'templateTriangles': len(indices)//3})
if len(results) != 4 or sum(r['tufts'] for r in results) != 510687:
    raise ValueError('Full, four-template grass input required')
bpy.context.scene['capture17_meadow_blades'] = 'Metre-scale, bent and sometimes mown laminae, shared with interactive mesh. Species and blade measurements are engineering priors.'
bpy.context.view_layer.update()
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(target.resolve()), compress=True, copy=True)
receipt.write_text(json.dumps({'baseBlendSha256': sha(base), 'fullMeadowGlbSha256': sha(source),
                               'candidateBlendSha256': sha(target), 'copiedIncidentField': update_light, 'groups': results}, indent=2)+'\n')
