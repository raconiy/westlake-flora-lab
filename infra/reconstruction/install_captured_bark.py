"""Install a unique cylindrical bark UV for the photographed foreground trunk."""
from pathlib import Path
import sys,bpy,json,struct
image,asset,*saved = map(Path,sys.argv[sys.argv.index('--')+1:])
o=bpy.data.objects['tree.foreground.trunk']
mesh=o.data
if len(mesh.vertices)!=816:raise ValueError('The source trunk ring topology changed')
material=bpy.data.materials.new('Foreground bark from photograph 01')
material.use_nodes=True
graph=material.node_tree
shader=graph.nodes.get('Principled BSDF')
shader.inputs['Roughness'].default_value=.94
texture=graph.nodes.new('ShaderNodeTexImage')
texture.image=bpy.data.images.load(str(image.resolve()))
if texture.image.size[0] < 128 or texture.image.size[1] < 128:
 raise ValueError('Bark projection lost a texture dimension')
texture.image.pack()
graph.links.new(texture.outputs['Color'],shader.inputs['Base Color'])
# This photograph is diffuse appearance. It contains no tangent-space normal
# measurements, and Blender's exporter cannot turn a Bump node into a valid
# normal texture. Keep the leaf-independent bark roughness and real geometry.
mesh.materials.clear()
mesh.materials.append(material)
height=max(v.co.z for v in mesh.vertices)
for loop,uv in zip(mesh.loops,mesh.uv_layers.active.data):
 v=mesh.vertices[loop.vertex_index]
 uv.uv=(loop.vertex_index%24/23,v.co.z/height)
o['bark_basis']='Photograph 01 projected onto original lower-stem rings; rear repeats observed bark, high fork extrapolated. Diffuse compensation 1.20 is an engineering display estimate; captured lighting remains in the texture. No measured normal map.'
bpy.ops.object.select_all(action='DESELECT')
o.select_set(True);bpy.context.view_layer.objects.active=o
bpy.ops.export_scene.gltf(filepath=str(asset.resolve()),export_format='GLB',
 use_selection=True,export_animations=False,export_cameras=False,export_lights=False,export_extras=True)
raw=asset.read_bytes()
doc=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
for exported in doc['materials']:
 if exported.get('normalTexture') is not None:
  raise ValueError('Diffuse bark exported an unexpected normal texture')
 if 'baseColorTexture' not in exported.get('pbrMetallicRoughness',{}):
  raise ValueError('Bark diffuse texture did not export')
if saved:
 bpy.context.preferences.filepaths.save_version=0
 bpy.ops.wm.save_as_mainfile(filepath=str(saved[0].resolve()),compress=True)
