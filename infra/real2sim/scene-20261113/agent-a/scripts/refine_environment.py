"""Editable lighting study: approximate overcast sky, not a captured HDRI."""

# Portable package root; override only when using another runtime directory.
import os as _real2sim_os
from pathlib import Path as _Real2SimPath
_REAL2SIM_ROOT = _Real2SimPath(_real2sim_os.environ.get(
    'REAL2SIM_ROOT', str(_Real2SimPath(__file__).resolve().parents[1])
)).expanduser().resolve()

import bpy
from pathlib import Path
ROOT=Path(str(_REAL2SIM_ROOT))
def refine():
    scene=bpy.context.scene
    world=scene.world
    world.use_nodes=True
    ns=world.node_tree.nodes;ns.clear()
    t=ns.new('ShaderNodeTexEnvironment')
    t.image=bpy.data.images.load(str(ROOT/'assets/textures/environment.jpg'),check_existing=True)
    t.image.colorspace_settings.name='sRGB'
    bg=ns.new('ShaderNodeBackground');bg.inputs['Strength'].default_value=.8
    out=ns.new('ShaderNodeOutputWorld')
    world.node_tree.links.new(t.outputs['Color'],bg.inputs['Color']);world.node_tree.links.new(bg.outputs[0],out.inputs[0])
    for m in bpy.data.materials:
        if m.use_nodes and 'glass' in m.name.lower():
            p=m.node_tree.nodes.get('Principled BSDF')
            if p:
                p.inputs['Base Color'].default_value=(.065,.085,.09,1)
                p.inputs['Roughness'].default_value=.12
                p.inputs['Metallic'].default_value=.65
    for ob in bpy.data.objects:
        if ob.type=='LIGHT' and ob.data.type=='SUN':
            ob.data.energy=1.4;ob.data.angle=.16
    scene.view_settings.exposure=.65
