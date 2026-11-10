"""Blender 4.5. Keep the source terrain, surveyed cut-outs, captured lighting and grass; patch reflectance and UVs only."""
import bpy
import hashlib,json,sys
from pathlib import Path
import numpy as np

args=sys.argv[sys.argv.index('--')+1:]
texture,destination,receipt=map(Path,args)
s=bpy.context.scene
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
source=Path(bpy.data.filepath)
if source.resolve()==destination.resolve():raise ValueError('Use a separate output scene')
expected='4e0f7543105e57aad27e4ec2a39ff1e6503e0988d05b02730888eaf1f5e71ab3'
if sha(source)!=expected:raise ValueError('Input is not the released R3 scene')
names={'Turf.PhotoAlbedo','Turf.RegisteredDiffuse'}
def vertex_coordinates(mesh):
    a=np.empty((len(mesh.vertices),3),np.float32)
    mesh.vertices.foreach_get('co',a.ravel())
    return a
def digest():
    h=hashlib.sha256();locations=hashlib.sha256();count=0
    for ob in sorted(s.objects,key=lambda o:o.name):
        locations.update(ob.name.encode());locations.update(np.array(ob.matrix_world,np.float32).tobytes())
        if ob.type=='MESH':
            count+=1;h.update(ob.name.encode());h.update(vertex_coordinates(ob.data).tobytes())
            ids=np.empty(len(ob.data.loops),np.int32);ob.data.loops.foreach_get('vertex_index',ids)
            h.update(ids.tobytes())
    return {'meshCount':count,'shapeAndTopologySha256':h.hexdigest(),'worldTransformsSha256':locations.hexdigest()}
before=digest();image=bpy.data.images.load(str(texture),check_existing=False)
image.name='Turf continuous world UV R4';image.colorspace_settings.name='sRGB';image.pack()
for name in sorted(names):
    mat=bpy.data.materials[name]
    nt=mat.node_tree
    photos=[node for node in nt.nodes if node.type=='TEX_IMAGE']
    assert len(photos)==1 and any(node.type=='VERTEX_COLOR' and node.layer_name=='CapturedIncident' for node in nt.nodes)
    photos[0].image=image;photos[0].extension='REPEAT'
    nt.nodes['Principled BSDF'].inputs['Roughness'].default_value=.945
    mat['reflectance_source']='Registered source reflectance plus measured neutral grass microtexture; retained separate CapturedIncident channel'
rows=[]
for ob in s.objects:
    if ob.type!='MESH' or not any(x and x.name in names for x in ob.data.materials):continue
    mesh=ob.data
    if not all(x and x.name in names for x in mesh.materials):raise ValueError('Unexpected material shared on turf mesh')
    uv=mesh.uv_layers.active
    assert uv and mesh.color_attributes.get('CapturedIncident') and mesh.color_attributes.active_color.name=='CapturedIncident'
    pts=vertex_coordinates(mesh);m=np.array(ob.matrix_world);world=pts@m[:3,:3].T+m[:3,3]
    if np.max(np.abs(world[:,2]))>.001: raise ValueError('Selected mesh contains unrelated raised matter')
    ids=np.empty(len(mesh.loops),np.int32);mesh.loops.foreach_get('vertex_index',ids)
    newUV=(world[ids,:2]+np.array([20.,10.]))/44.
    uv.data.foreach_set('uv',newUV.astype('f').ravel())
    coords=np.empty(newUV.shape,np.float32);uv.data.foreach_get('uv',coords.ravel())
    err=float(np.max(np.abs(coords-newUV)))
    assert err<1e-6
    rows.append({'mesh':ob.name,'loops':len(ids),'worldUVError':err})
    mesh.update()
assert len(rows)==9 and before==digest()
s['turf_field_revision']='R4: one continuous world XY 44m colour field; source daylight and measured foreground incident light remain independent.'
bpy.context.preferences.filepaths.save_version=0
destination.parent.mkdir(exist_ok=True,parents=True)
bpy.ops.wm.save_as_mainfile(filepath=str(destination.resolve()),copy=True,compress=True)
assert before==digest() and sha(source)==expected
receipt.write_text(json.dumps({'sourceSha256':expected,'candidateBlendSha256':sha(destination),'textureSha256':sha(texture),'geometryInvariant':before,
                             'materials':sorted(names),'uvUpdates':rows,'lighting':'CapturedIncident RGB, source sun, camera poses and shadow-producing geometry unmodified'},indent=2)+'\n')
