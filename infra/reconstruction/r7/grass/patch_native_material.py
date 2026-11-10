"""Match the R7 webpage's small leaf sky-fill term in the native grass material.

After import_meadow.py attaches the R7 full GLB:
blender -b input.blend -P patch_native_material.py -- output.blend receipt.json
No vertices, terrain, camera or sun settings are changed. Wind remains at rest.
The 0.20 gain is an unmeasured engineering display approximation, not emission
from living grass or a calibrated physical scattering coefficient.
"""
import json
from pathlib import Path
import sys
import bpy


def patch():
    selected = []
    for material in bpy.data.materials:
        if not material.name.startswith('Capture17 turf blades') or not material.use_nodes:
            continue
        bsdfs = [n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED']
        if len(bsdfs) != 1:
            raise ValueError('Unexpected grass material topology: ' + material.name)
        bsdf = bsdfs[0]
        links = list(bsdf.inputs['Base Color'].links)
        if len(links) != 1:
            raise ValueError('Missing incident-times-albedo color field')
        socket = links[0].from_socket
        material.node_tree.links.new(socket, bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = .20
        material['r7_sky_fill_prior'] = .20
        material['r7_sky_fill_basis'] = 'Engineering approximation matching browser radiance; not measured plant emission.'
        selected.append(material.name)
    if not selected:
        raise ValueError('No imported Capture17 meadow material found; refusing silent success')
    return selected


if __name__ == '__main__':
    destination, receipt = map(Path, sys.argv[sys.argv.index('--')+1:])
    names = patch()
    bpy.ops.wm.save_as_mainfile(filepath=str(destination.resolve()), compress=True)
    receipt.write_text(json.dumps({'materials': names, 'gain': .20, 'wind': 0,
        'basis': 'engineering display prior', 'geometryChanged': False}, indent=2))
