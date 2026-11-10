"""Set the photographed background on camera rays in the existing Cycles world."""
from pathlib import Path
import sys
import bpy

image, output=map(Path,sys.argv[sys.argv.index('--')+1:])
world=bpy.context.scene.world
graph=world.node_tree
out=next(n for n in graph.nodes if n.type=='OUTPUT_WORLD' and n.is_active_output)
mix=out.inputs['Surface'].links[0].from_node
if mix.type!='MIX_SHADER' or mix.inputs[0].links[0].from_socket.name!='Is Camera Ray':
    raise ValueError('Expected the source project camera-ray world mix')
camera=mix.inputs[2].links[0].from_node
if camera.type!='BACKGROUND':raise ValueError('Expected the camera background shader')
env=graph.nodes.new('ShaderNodeTexEnvironment')
env.name='Registered sky from photo 01'
env.image=bpy.data.images.load(str(image.resolve()))
env.image.colorspace_settings.name='sRGB'
env.image.pack()
graph.links.new(env.outputs['Color'],camera.inputs['Color'])
camera.inputs['Strength'].default_value=1.0
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(output.resolve()),compress=True)
