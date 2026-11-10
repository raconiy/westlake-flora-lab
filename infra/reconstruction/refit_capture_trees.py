"""Calibrate three photographed crowns in a copy of the R5 Blender project."""
import bpy,sys,json,hashlib
from pathlib import Path
import numpy as np
args=sys.argv[sys.argv.index('--')+1:]; field_file,blend,raw,receipt=map(Path,args)
grids=np.load(field_file); fit=json.loads(str(grids['report'])); scene=bpy.context.scene
changed=[]; rows=[];props={}
def vertices(ob):
 p=np.empty((len(ob.data.vertices),3),np.float32);ob.data.vertices.foreach_get('co',p.ravel());return p
def world(p,m):
 v=p@m[:3,:3].T+m[:3,3];return v[:,[0,2,1]]*[1,1,-1]
def local(v,m):
 v=v[:,[0,2,1]]*[1,-1,1];return (v-m[:3,3])@np.linalg.inv(m[:3,:3]).T
def sample(name,p):
 grid=grids[name+'::field'];lo=grids[name+'::bounds'];u=(p-lo[:3])/lo[3];inside=np.all((u>=0)&(u<np.array(grid.shape[:3])-1),axis=1);u=np.clip(u,0,np.array(grid.shape[:3])-1.001);q=u.astype(int);d=u-q;result=np.zeros((len(p),5))
 for dx in (0,1):
  for dy in (0,1):
   for dz in (0,1):
    w=(d[:,0] if dx else 1.-d[:,0])*(d[:,1] if dy else 1.-d[:,1])*(d[:,2] if dz else 1.-d[:,2])
    result+=w[:,None]*grid[q[:,0]+dx,q[:,1]+dy,q[:,2]+dz]
 result[~inside]=1
 return result
def deform(x,r):
 a=np.array(r['start']);c=np.array(r['mid']);b=np.array(r['end']);v=b-a
 t=np.clip(((x-a)@v)/(v@v),0,1);tm=np.clip(((c-a)@v)/(v@v),.2,.8)
 # Cubic response vanishes at both fixed woody attachments; taper off the scaffold.
 u=np.where(t<tm,t/tm,(1.-t)/(1.-tm));w=u*u*(3.-2.*u)
 far=np.linalg.norm(x-(a+t[:,None]*v),axis=1)
 w*=np.exp(-.5*(far/2.6)**2)
 return x+w[:,None]*np.array(r['midShift'])
def surface(v):
 a=v[:,1]-v[:,0];b=v[:,2]-v[:,0];c=v[:,3]-v[:,0];e=v[:,4]-v[:,0]
 return np.linalg.norm(np.cross(a,b),axis=1)+np.linalg.norm(np.cross(b,c),axis=1)+np.linalg.norm(np.cross(e-a,b-a),axis=1)+np.linalg.norm(np.cross(e-b,c-b),axis=1)
for tree in fit['trees']:
 tr=bpy.data.objects[tree]
 for joint in [o for o in tr.children if o.get('wind_joint')]:
  wood=next(o for o in joint.children if '.wood.' in o.name);rule=fit['limbs'].get(wood.name)
  area_before=area_after=0
  for ob in joint.children:
   leaf='.volume-leaves.' in ob.name
   if ob.type!='MESH' or not(leaf or rule):continue
   m=np.array(ob.matrix_world);p=vertices(ob);w=world(p,m)
   if leaf:
    v=w.reshape(-1,5,3).copy();area_before=surface(v).sum()
    f=sample(tree,v[:,0]);anchor=v[:,0:1].copy();mid=v[:,2:3].copy()
    # Each petiole stays attached. The dual-view sky test alters only its lamina;
    # ambiguous, occluded and out-of-view leaves retain their original size.
    for k in [1,3]:v[:,k:k+1]=mid+(v[:,k:k+1]-mid)*f[:,1,None,None]
    v=anchor+(v-anchor)*f[:,0,None,None]
    area_after=surface(v).sum()
    colors=ob.data.color_attributes.active_color
    rgba=np.empty((len(p),4),np.float32);colors.data.foreach_get('color',rgba.ravel())
    rgb=rgba.reshape(-1,5,4);rgb[:,:,:3]=np.clip(rgb[:,:,:3]*f[:,None,2:5],0,1)
    colors.data.foreach_set('color',rgba.ravel());w=v.reshape(-1,3)
    rows.append({'object':ob.name,'leaves':len(v),'dualSkyReduced':int((f[:,0]<.90).sum()),'widthGained':int((f[:,1]>1.04).sum()),'reddened':int((f[:,2]>1.10).sum()),'meanAreaRatio':area_after/max(area_before,1.e-8)})
   if rule:w=deform(w,rule)
   ob.data.vertices.foreach_set('co',local(w,m).astype('f').ravel());ob.data.update();changed.append(ob.name)
  re=joint.get('leaf_area_m2');ba=joint.get('beam_length_m');props[joint.name]={}
  if re is not None and area_before>0:
   value=float(re)*area_after/area_before;joint['leaf_area_m2']=value;props[joint.name]['leaf_area_m2']=value
  if rule and ba is not None:
   p=vertices(wood);e=np.flatnonzero(np.linalg.norm(p[1:]-p[0],axis=1)<1e-5);ring=int(e[0]+2)
   centers=p.reshape(-1,ring,3)[:,:-1].mean(axis=1)
   updated=float(np.linalg.norm(np.diff(centers,axis=0),axis=1).sum())
   # Compare native curved lengths, preserving any original effective-length factor.
   original=float(np.linalg.norm(np.diff(np.array(rule['originalLine']),axis=0),axis=1).sum()) if 'originalLine' in rule else float(ba)
   value=float(ba)*updated/original
   joint['beam_length_m']=value;props[joint.name]['beam_length_m']=value
scene['capture17_three_crown_fit']='Photo 01/06 visible crown regions; ambiguous overlaps excluded. Existing blade sockets, distal scaffold tips and tree bases preserved. Relative pigments are not reflectance measurements.'
bpy.context.view_layer.update();bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(blend.resolve()),compress=True,copy=True)
# Keep the established display density at every joint. Only the subset below
# is exported. Higher-resolution near-tree foliage remains in the source scene.
for name in changed:
 ob=bpy.data.objects[name]
 if '.volume-leaves.' not in name:continue
 source=ob.data; count=len(source.vertices)//5;stride=2 if 'foreground' in name else 4 if 'mid-fork' in name else 3
 idx=np.arange(0,count,stride);v=vertices(ob).reshape(-1,5,3)[idx].copy();mid=v[:,2:3].copy()
 for k in (1,3):v[:,k:k+1]=mid+(v[:,k:k+1]-mid)*(1.15 if stride>2 else 1.06)
 colors=source.color_attributes.active_color;rgba=np.empty((count*5,4),np.float32);colors.data.foreach_get('color_srgb',rgba.ravel())
 fc=(np.arange(len(idx))[:,None,None]*5+np.array([[0,1,2],[0,2,3],[1,4,2],[2,4,3]])).reshape(-1,3)
 me=bpy.data.meshes.new(source.name+'.web');me.from_pydata(v.reshape(-1,3).tolist(),[],fc.tolist());me.materials.append(source.materials[0])
 col=me.color_attributes.new('Blade pigments','BYTE_COLOR','POINT');me.color_attributes.active_color=col;col.data.foreach_set('color_srgb',rgba.reshape(-1,5,4)[idx].ravel());me.update();ob.data=me
 ob['full_blades']=count;ob['physical_blades']=len(idx)
bpy.ops.object.select_all(action='DESELECT')
for name in changed:
 ob=bpy.data.objects[name]
 while ob is not None:ob.select_set(True);ob=ob.parent
bpy.ops.export_scene.gltf(filepath=str(raw.resolve()),export_format='GLB',use_selection=True,export_extras=True,export_cameras=False,export_lights=False,export_animations=False,export_yup=True)
receipt.write_text(json.dumps({'sourceSha256':hashlib.file_digest(open(bpy.data.filepath,'rb'),'sha256').hexdigest(),'blendSha256':hashlib.file_digest(blend.open('rb'),'sha256').hexdigest(),'fieldSha256':hashlib.file_digest(field_file.open('rb'),'sha256').hexdigest(),'changedObjects':changed,'updatedJoints':props,'leaves':rows},indent=2))
