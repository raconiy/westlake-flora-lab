import bpy,numpy as np,sys,json
from pathlib import Path
base,candidate,units,sky,out=map(Path,sys.argv[sys.argv.index('--')+1:]);U=np.load(units);S=np.load(sky)
def verts(o):
 a=np.empty((len(o.data.vertices),3),'f');o.data.vertices.foreach_get('co',a.ravel());return a.reshape(-1,5,3)
bpy.ops.wm.open_mainfile(filepath=str(base));old={o.name:verts(o) for o in bpy.data.objects if '.volume-leaves.' in o.name}
bpy.ops.wm.open_mainfile(filepath=str(candidate));samples=[]
def project(o,v,view):
 m=np.array(o.matrix_world);world=v@m[:3,:3].T+m[:3,3];world=world[...,[0,2,1]]*[1,1,-1]
 mat=S['matrix_'+view];fx,fy,px,py,k=S['optics_'+view];q=(world-mat[:3,3])@mat[:3,:3];depth=-q[...,2];uv=q[...,:2]/depth[...,None];uv*=1+k*(uv*uv).sum(-1,keepdims=True)
 return np.stack([uv[...,0]*fx+px,-uv[...,1]*fy+py],axis=-1),depth
chosen=set()
for name in old:
 if not ('foreground' in name or 'left-spreading' in name):continue
 tree=name.split('.volume-leaves.')[0]
 if tree in chosen:continue
 ob=bpy.data.objects[name];before=old[name];after=verts(ob);a,da=project(ob,before,'01');b,db=project(ob,after,'01');groups=U[name+'::unit']
 in_bounds=(b[...,0]>1)&(b[...,0]<1022)&(b[...,1]>1)&(b[...,1]<766)&(db>.05)
 oldsky=S['sky_01'][np.rint(a[...,1].clip(0,767)).astype(int),np.rint(a[...,0].clip(0,1023)).astype(int)]>=12
 newsky=(S['sky_01'][np.rint(b[...,1].clip(0,767)).astype(int),np.rint(b[...,0].clip(0,1023)).astype(int)]>=12)&in_bounds
 candidates=np.flatnonzero(np.any(newsky&~oldsky,axis=1))
 if not len(candidates):continue
 chosen.add(tree);i=int(candidates[0]);g=int(groups[i]);ids=np.flatnonzero(groups==g);views={}
 for view in ['01','06']:
  q0,d0=project(ob,before[ids],view);q1,d1=project(ob,after[ids],view);views[view]={'beforePixels':q0.tolist(),'afterPixels':q1.tolist(),'beforeDepth':d0.tolist(),'afterDepth':d1.tolist()}
 samples.append({'mesh':name,'sourceGrowthUnit':g,'bladeIds':ids.tolist(),'nativeLeafTriangles':[[0,1,2],[0,2,3],[1,4,2],[2,4,3]],'views':views})
out.write_text(json.dumps({'case':'Actual R6 vs rejected C before Cguard veto; exact five vertex blade projections with source lens radial terms','viewport':[1024,768],'skyMasks':'Existing free-sky.npz, threshold12px signed distance','samples':samples},indent=2))
