"""Export the original lamp meshes at object precision and update their daylight finishes.

Run in Blender with -- lamp.glb [output.blend]. The assembled Blender scene is
the input. Keep the surveyed root, camera scale and collision geometry in place.
"""
import argparse
from pathlib import Path
import math
import sys

import bpy

ROOT = 'Lamp.Forecourt.ReferenceB'
# Linear RGB under the registered photograph's lighting. These finishes are
# engineering estimates. Paints retain a diffuse response under the blue sky.
SURFACES = {
    'Lamp.GraphiteSatin': ((.076, .119, .193), .12, .49),
    'Lamp.CharcoalMetal': ((.048, .072, .116), .14, .46),
    'Lamp.RainCapAluminium': ((.111, .147, .198), .34, .39),
    'Lamp.MouldedRib': ((.237, .286, .329), .15, .32),
    'Lamp.DaylightOptic': ((.67, .69, .61), .02, .42),
    'Lamp.ClearMouldedGlass': ((.49, .57, .64), .015, .19),
}

def configure_surfaces(lamp):
    members = {o.name: o for o in lamp.children if o.type == 'MESH'}
    if len(members) != 7:
        raise ValueError(f'Expected the seven source components, got {list(members)}')
    rib = members['Lamp.InternalRibs']
    rib_material = bpy.data.materials.get('Lamp.MouldedRib')
    if rib_material is None:
        rib_material = rib.material_slots[0].material.copy()
        rib_material.name = 'Lamp.MouldedRib'
    rib.material_slots[0].material = rib_material
    for name, (rgb, metallic, roughness) in SURFACES.items():
        material = bpy.data.materials[name]
        bsdf = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
        bsdf.inputs['Metallic'].default_value = metallic
        bsdf.inputs['Roughness'].default_value = roughness
        if name == 'Lamp.ClearMouldedGlass':
            bsdf.inputs['Alpha'].default_value = .62
            bsdf.inputs['Transmission Weight'].default_value = .12
    bowl = members['Lamp.ClearFlaredBowl']
    if not bowl.get('moulded_glass_relief'):
        # The photos show vertical optical ridges, but do not resolve the die
        # profile. Keep the lip and narrow collar fixed; ease relief to zero there.
        for vertex in bowl.data.vertices:
            x, y, z = vertex.co
            t = min(1.0, max(0.0, (z - 2.959) / .431))
            envelope = math.sin(math.pi * t)
            angle = math.atan2(y, x)
            radial = 1.0 + .025 * envelope * math.cos(8 * angle)
            vertex.co.x *= radial
            vertex.co.y *= radial
        bowl.data.update()
        bowl['moulded_glass_relief'] = 'Photo-informed approximation. Eight shallow flutes; profile not surveyed.'
    return list(members.values())

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('lamp_glb', type=Path)
    parser.add_argument('updated_blend', nargs='?', type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    lamp = bpy.data.objects[ROOT]
    members = configure_surfaces(lamp)
    bpy.ops.object.select_all(action='DESELECT')
    for o in [lamp, *members]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = lamp
    bpy.ops.export_scene.gltf(filepath=str(args.lamp_glb.resolve()), export_format='GLB',
        use_selection=True, export_animations=False, export_cameras=False,
        export_lights=False, export_extras=True, export_yup=True)
    if args.updated_blend:
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(args.updated_blend.resolve()), compress=True)

if __name__ == '__main__':
    main()
