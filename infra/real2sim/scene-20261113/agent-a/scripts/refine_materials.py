
# Portable package root; override only when using another runtime directory.
import os as _real2sim_os
from pathlib import Path as _Real2SimPath
_REAL2SIM_ROOT = _Real2SimPath(_real2sim_os.environ.get(
    'REAL2SIM_ROOT', str(_Real2SimPath(__file__).resolve().parents[1])
)).expanduser().resolve()

import bpy, math
from pathlib import Path
from mathutils import Vector
TEXTURES=Path(str(_REAL2SIM_ROOT / 'assets/textures'))
def refine():
    mats={}
    for mat in bpy.data.materials:
        if not mat.use_nodes:continue
        bs=mat.node_tree.nodes.get('Principled BSDF')
        if not bs:continue
        name=mat.name.lower()
        if any(n.type=='TEX_IMAGE' for n in mat.node_tree.nodes):continue
        kind=None
        if any(k in name for k in ['granite','paving','paver','stone','slab','curb','kerb']):kind='limestone'
        elif 'asphalt' in name:kind='asphalt'
        elif any(k in name for k in ['concrete','column','fascia','plaster']):kind='concrete'
        elif 'bark' in name:kind='bark'
        elif 'grass' in name:kind='grass'
        if not kind:continue
        nodes=mat.node_tree.nodes;tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(TEXTURES/(kind+'.jpg')),check_existing=True);tex.image.colorspace_settings.name='sRGB'
        mat.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color']);bs.inputs['Roughness'].default_value=.82
        mats[mat.name]=kind
    for ob in bpy.data.objects:
        if ob.type!='MESH' or not any(m and m.name in mats for m in ob.data.materials):continue
        me=ob.data
        if me.uv_layers:continue
        uv=me.uv_layers.new(name='SurfaceUV')
        for poly in me.polygons:
            normal=poly.normal;axis=max(range(3),key=lambda i:abs(normal[i]));axes=[i for i in range(3) if i!=axis]
            for li in poly.loop_indices:
                co=me.vertices[me.loops[li].vertex_index].co
                uv.data[li].uv=(co[axes[0]]*.6,co[axes[1]]*.6)
    return mats
