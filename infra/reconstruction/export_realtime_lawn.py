"""Build a lighter interactive LOD from the same rooted full-resolution scene.
Run on yungu-volume.blend. The original editable Blender scene retains every blade.
"""
from pathlib import Path
import struct
import sys
import bpy
import numpy as np

dest=Path(sys.argv[sys.argv.index('--')+1])
for ob in list(bpy.data.objects):
    if 'Turf.NearVergeBlades' in ob.name:
        bpy.data.objects.remove(ob,do_unlink=True)
        continue
    if '.volume-leaves.' not in ob.name: continue
    source=ob.data
    count=source.vertices.__len__()//5
    stride=2 if 'foreground' in ob.name else 4 if 'mid-fork' in ob.name else 3
    # Select a repeatable sample within every short shoot. Preserve each blade's
    # insertion, direction, fold and pigment. Only its rendered width is compensated.
    idx=np.arange(0,count,stride)
    pos=np.zeros((count*5,3),np.float32)
    source.vertices.foreach_get('co',pos.ravel())
    pos=pos.reshape(-1,5,3)[idx].copy()
    mid=pos[:,2,:]
    for side in [1,3]:
        pos[:,side,:]=mid+(pos[:,side,:]-mid)*(1.15 if stride>2 else 1.06)
    rgba=np.zeros((count*5,4),np.float32)
    source.color_attributes.active_color.data.foreach_get('color_srgb',rgba.ravel())
    faces=(np.arange(len(idx))[:,None,None]*5+np.array([[0,1,2],[0,2,3],[1,4,2],[2,4,3]])).reshape(-1,3)
    m=bpy.data.meshes.new(source.name+'.web')
    m.from_pydata(pos.reshape(-1,3).tolist(),[],faces.tolist())
    m.materials.append(source.materials[0])
    a=m.color_attributes.new(name='Blade pigments',type='BYTE_COLOR',domain='POINT')
    m.color_attributes.active_color=a
    a.data.foreach_set('color_srgb',rgba.reshape(-1,5,4)[idx].ravel())
    m.update();ob.data=m;ob['full_blades']=count;ob['physical_blades']=len(idx)
bpy.data.orphans_purge(do_recursive=True)
bpy.ops.export_scene.gltf(filepath=str(dest),export_format='GLB',export_cameras=True,export_extras=True,export_lights=True,export_animations=True,export_yup=True)
