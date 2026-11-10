"""Reconstruct static near-tree laminae inside a calibrated multi-view visual hull.

The registered photo set can rule out occupied space along a ray of clear sky.
No wood, socket or growth-time event is removed by this operation.
"""
import bpy
import hashlib
import json
import sys
from pathlib import Path
import numpy as np

fields,source_binding,out_blend,out_raw,out_report=map(Path,sys.argv[sys.argv.index('--')+1:])
evidence=np.load(fields)
views=evidence['views'].tolist()
sky=[evidence['sky_'+k] for k in views]
matrix=[evidence['matrix_'+k] for k in views]
optics=[evidence['optics_'+k] for k in views]
branches=json.loads(source_binding.read_text())
eligible=[(a,b) for a in range(len(views)) for b in range(a+1,len(views))
          if np.linalg.norm(matrix[a][:3,3]-matrix[b][:3,3])>=.60]
by_joint=branches['updatedJoints']
counts={}
scene=bpy.context.scene

def read_vertices(mesh):
    v=np.empty((len(mesh.vertices),3),dtype='f')
    mesh.vertices.foreach_get('co',v.ravel())
    return v.reshape(-1,5,3)

def world(v,mat):
    coords=v@mat[:3,:3].T+mat[:3,3]
    return coords[...,[0,2,1]]*[1,1,-1]

def confidence(points,i):
    m=matrix[i]; fx,fy,px,py,k=optics[i]
    local=(points-m[:3,3])@m[:3,:3]
    depth=-local[...,2]
    valid=depth>.05
    xy=local[...,:2]/np.where(valid,depth,1)[...,None]
    xy*=1+k*np.sum(xy*xy,axis=-1,keepdims=True)
    u=xy[...,0]*fx+px;v=-xy[...,1]*fy+py
    inside=valid&(u>=1)&(u<1022)&(v>=1)&(v<766)
    u=np.rint(np.clip(u,0,1023)).astype(int)
    v=np.rint(np.clip(v,0,767)).astype(int)
    return sky[i][v,u]*inside

def keep_laminae(v):
    # Midrib, both blade edges, and tip must be observed inside the sky cone.
    # This preserves leaves crossing a skyline and unstable subpixel gaps.
    samples=v[:,[1,2,3,4]]
    scores=[np.min(confidence(samples,i),axis=1) for i in range(len(views))]
    outside=np.zeros(len(v),bool)
    for a,b in eligible:
        outside|=(scores[a]>=12)&(scores[b]>=12)
    return ~outside

def areas(v):
    faces=((0,1,2),(0,2,3),(1,4,2),(2,4,3))
    vals=np.zeros(len(v))
    for a,b,c in faces:
        vals+=.5*np.linalg.norm(np.cross(v[:,b]-v[:,a],v[:,c]-v[:,a]),axis=1)
    return vals

def filtered_mesh(source,v,rgb,idx,factor=1.):
    selected=v[idx].copy()
    if factor!=1:
        mid=selected[:,2:3].copy()
        for side in (1,3):selected[:,side:side+1]=mid+(selected[:,side:side+1]-mid)*factor
    triangles=(np.arange(len(idx))[:,None,None]*5+np.array([[0,1,2],[0,2,3],[1,4,2],[2,4,3]])).reshape(-1,3)
    me=bpy.data.meshes.new(source.name+'.visual-hull')
    me.from_pydata(selected.reshape(-1,3).tolist(),[],triangles.tolist())
    for mat in source.materials:me.materials.append(mat)
    attr=me.color_attributes.new('Blade pigments','BYTE_COLOR','POINT')
    me.color_attributes.active_color=attr;attr.data.foreach_set('color_srgb',rgb[idx].ravel())
    me.update()
    return me

full={}
for name in branches['changedObjects']:
    if '.volume-leaves.' not in name:continue
    ob=bpy.data.objects[name];mesh=ob.data
    assert not mesh.uv_layers and len(mesh.materials)==1,name
    vertices=read_vertices(mesh)
    rgba=np.empty((len(vertices),5,4),'f')
    mesh.color_attributes.active_color.data.foreach_get('color_srgb',rgba.ravel())
    w=world(vertices,np.array(ob.matrix_world));keep=keep_laminae(w);idx=np.flatnonzero(keep)
    if not len(idx):raise RuntimeError('Canopy completely absent: '+name)
    area=areas(w); retained=float(area[keep].sum()/area.sum())
    joint=ob.parent; joint['leaf_area_m2']=float(joint['leaf_area_m2'])*retained
    by_joint[joint.name]['leaf_area_m2']=joint['leaf_area_m2']
    stride=2 if 'foreground' in name else 4 if 'mid-fork' in name else 3
    # Apply the previous LOD selection by original blade index, irrespective
    # of which other blades the visual hull ruled out.
    web=(idx%stride)==0
    old=len(vertices);ob.data=filtered_mesh(mesh,vertices,rgba,idx)
    full[name]=(web,stride)
    counts[name]={'authoredFull':old,'retainedFull':len(idx),'retainedWeb':int(web.sum()),
                  'areaRetained':retained,'selectionSha256':hashlib.sha256(idx.astype('<u4').tobytes()).hexdigest()}
scene['capture17_visual_hull']='Static crown reconstruction constrained by clear sky in two or more registered photographs with separated viewpoints. Unobserved crown interior retained from source model.'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(out_blend),compress=True,copy=True)
for name,(web,stride) in full.items():
    ob=bpy.data.objects[name];me=ob.data;v=read_vertices(me);rgba=np.empty((len(v),5,4),'f')
    me.color_attributes.active_color.data.foreach_get('color_srgb',rgba.ravel())
    ob.data=filtered_mesh(me,v,rgba,np.flatnonzero(web),1.15 if stride>2 else 1.06)
    ob['full_blades']=len(v);ob['physical_blades']=int(web.sum())
bpy.ops.object.select_all(action='DESELECT')
for name in branches['changedObjects']:
    ob=bpy.data.objects[name]
    while ob is not None:ob.select_set(True);ob=ob.parent
bpy.ops.export_scene.gltf(filepath=str(out_raw),export_format='GLB',use_selection=True,export_extras=True,export_cameras=False,export_lights=False,export_animations=False,export_yup=True)
def digest(path):
    with open(path,'rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
branches.update({'inputBlendSha256':digest(bpy.data.filepath),'blendSha256':digest(out_blend),'skyEvidenceSha256':digest(fields),
                 'visualHull':{'calibrationViews':views,'pairs':eligible,'skyMarginPx':1.5,'minimumParallaxBaselineM':.6,'counts':counts}})
out_report.write_text(json.dumps(branches,indent=2))
