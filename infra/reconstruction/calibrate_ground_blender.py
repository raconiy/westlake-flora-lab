"""Apply the same reference-condition shade gain as the GLB and the grass instances."""
import bpy
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

config, output, receipt = map(Path, sys.argv[sys.argv.index('--') + 1:])
scene = bpy.context.scene
if Path(bpy.data.filepath).resolve() == output.resolve() or 'ground_shadow_gain' in scene:
    raise ValueError('Expected a separate destination and uncalibrated ground')
settings = json.loads(config.read_text())
sun, shade = [np.array(settings[k], np.float32) for k in ('sunLinearRgb', 'oldShadeLinearRgb')]
gain = settings['shadeGain']
names = {'Turf.PhotoAlbedo', 'Turf.RegisteredDiffuse'}
count = 0
for ob in scene.objects:
    if ob.type != 'MESH' or not any(m and m.name in names for m in ob.data.materials):
        continue
    if not all(m and m.name in names for m in ob.data.materials):
        raise ValueError('Mixed grass and hardscape')
    layer = ob.data.color_attributes['CapturedIncident']
    rgba = np.empty((len(layer.data), 4), dtype=np.float32)
    layer.data.foreach_get('color', rgba.ravel())
    weight = np.clip((sun[1]-rgba[:, 1]) / (sun[1]-shade[1]), 0, 1)
    rgba[:, :3] = np.clip(rgba[:, :3] + weight[:, None] * shade * (gain-1), 0, 1)
    layer.data.foreach_set('color', rgba.ravel())
    ob.data.update()
    count += 1
if count != 9:
    raise ValueError(f'Expected nine terrain patches, got {count}')
scene['ground_shadow_gain'] = gain
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(output.resolve()), copy=True, compress=True)
with output.open('rb') as file:
    digest = hashlib.file_digest(file, 'sha256').hexdigest()
receipt.write_text(json.dumps({'gain': gain, 'terrainMeshes': count, 'outputSha256': digest}, indent=2)+'\n')
