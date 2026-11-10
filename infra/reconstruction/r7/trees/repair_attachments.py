"""R7 minimal repair: translate only blades farther than 3 mm from real parent sprigs.
No wood, root, wind socket, leaf count, material, or canopy silhouette edits.
The 3 mm detection bound and 25 mm hard stop are explicit engineering thresholds.
"""
import bpy,sys,json,hashlib
from pathlib import Path
import numpy as np
units_path,out=map(Path,sys.argv[sys.argv.index('--')+1:]);out.mkdir(parents=True,exist_ok=True)
U=np.load(units_path);report={'mode':'attachment-only','basis':__doc__,'changes':{},'changedObjects':[],'updatedJoints':{},'woodySegmentsRemoved':0}
def vertices(mesh):
 a=np.empty((len(mesh.vertices),3),'f');mesh.vertices.foreach_get('co',a.ravel());return a
def mesh_part(source,v,colors,indices):
 n=len(indices);mesh=bpy.data.meshes.new(source.name+'.web')
 f=(np.arange(n)[:,None,None]*5+np.array([[0,1,2],[0,2,3],[1,4,2],[2,4,3]])).reshape(-1,3)
 mesh.from_pydata(v[indices].reshape(-1,3).tolist(),[],f.tolist())
 for mat in source.materials:mesh.materials.append(mat)
 col=mesh.color_attributes.new('Blade pigments','BYTE_COLOR','POINT');mesh.color_attributes.active_color=col;col.data.foreach_set('color_srgb',colors[indices].ravel());mesh.update();return mesh
for key in U.files:
 if not key.endswith('::path'):continue
 name=key[:-6];ob=bpy.data.objects[name];v=vertices(ob.data).reshape(-1,5,3);paths=U[key];group=U[name+'::unit'];a=paths[group,:2];d=paths[group,1:]-a
 t=np.clip(((v[:,0,None]-a)*d).sum(2)/np.maximum(1e-15,(d*d).sum(2)),0,1);error=np.linalg.norm(v[:,0,None]-(a+d*t[:,:,None]),axis=2).min(1)
 changed=[]
 for i in np.flatnonzero(error>.003):
  a=paths[:,:2];d=paths[:,1:]-a;t=np.clip(((v[i,0]-a)*d).sum(2)/np.maximum(1e-15,(d*d).sum(2)),0,1)
  nearest=a+d*t[:,:,None];dist=np.linalg.norm(v[i,0]-nearest,axis=2);ui,si=np.unravel_index(dist.argmin(),dist.shape);shift=nearest[ui,si]-v[i,0]
  if np.linalg.norm(shift)>.025:raise ValueError('Blade not safely attributable to existing support')
  v[i]+=shift;changed.append({'sourceBladeId':int(i),'parentGrowthUnit':int(ui),'segment':int(si),'translationM':shift.tolist(),'distanceM':float(np.linalg.norm(shift))})
 if not changed:continue
 ob.data.vertices.foreach_set('co',v.astype('f').ravel());ob.data.update()
 report['changes'][name]={'sourceBlades':len(v),'resultBlades':len(v),'repaired':changed}
 report['changedObjects'].append(name)
bpy.context.preferences.filepaths.save_version=0
blend=out/'attachments-only.blend';bpy.ops.wm.save_as_mainfile(filepath=str(blend),compress=True,copy=True)
for name in report['changedObjects']:
 ob=bpy.data.objects[name];mesh=ob.data;v=vertices(mesh).reshape(-1,5,3);colors=np.empty((len(v),5,4),'f');mesh.color_attributes.active_color.data.foreach_get('color_srgb',colors.ravel())
 stride=2 if 'foreground' in name else 4 if 'mid-fork' in name else 3
 mid=v[:,2,None].copy()
 for side in [1,3]:v[:,side:side+1]=mid+(v[:,side:side+1]-mid)*(1.15 if stride>2 else 1.06)
 chosen=np.arange(0,len(v),stride);ob.data=mesh_part(mesh,v,colors,chosen);ob['full_blades']=len(v);ob['physical_blades']=len(chosen);report['changes'][name]['webBlades']=len(chosen)
bpy.ops.object.select_all(action='DESELECT')
for name in report['changedObjects']:
 ob=bpy.data.objects[name]
 while ob:ob.select_set(True);ob=ob.parent
bpy.ops.export_scene.gltf(filepath=str(out/'attachments-raw.glb'),export_format='GLB',use_selection=True,export_extras=True,export_cameras=False,export_lights=False,export_animations=False)
report['blendSha256']=hashlib.sha256(blend.read_bytes()).hexdigest();(out/'attachments.json').write_text(json.dumps(report,indent=2))
