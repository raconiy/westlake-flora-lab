import bpy,numpy as np,sys,json,hashlib
from pathlib import Path
base,candidate,unit_path,out=map(Path,sys.argv[sys.argv.index('--')+1:]);U=np.load(unit_path)
def vertices(o):
 a=np.empty((len(o.data.vertices),3),'f');o.data.vertices.foreach_get('co',a.ravel());return a
def state():
 return {o.name:{'transform':np.array(o.matrix_world).tolist(),'parent':o.parent.name if o.parent else None,'mesh':hashlib.sha256(vertices(o).tobytes()).hexdigest() if o.type=='MESH' and '.volume-leaves.' not in o.name else None} for o in bpy.data.objects}
bpy.ops.wm.open_mainfile(filepath=str(base));old=state();leaves={o.name:vertices(o).reshape(-1,5,3) for o in bpy.data.objects if '.volume-leaves.' in o.name}
bpy.ops.wm.open_mainfile(filepath=str(candidate));assert old==state(),'Non-leaf objects or root/socket transforms changed'
rows=[];count=0;declared=json.loads((candidate.parent/'attachments.json').read_text())['changes'];webcount=0
for name,before in leaves.items():
 after=vertices(bpy.data.objects[name]).reshape(-1,5,3);assert before.shape==after.shape
 changed=np.any(after!=before,axis=(1,2));ids=np.flatnonzero(changed);count+=len(ids)
 assert set(map(int,ids))<=set(x['sourceBladeId'] for x in declared.get(name,{}).get('repaired',[])),'Unreported blade changed'
 stride=2 if 'foreground' in name else 4 if 'mid-fork' in name else 3;webcount+=int((ids%stride==0).sum())
 assert len(ids)==0 or np.max(np.abs((after-before)[ids]-(after-before)[ids,0,None]))<2e-6,'A blade was deformed rather than translated'
 paths=U[name+'::path'];a=paths[:,:2];d=paths[:,1:]-a;errors=[]
 for i in ids:
  t=np.clip(((after[i,0]-a)*d).sum(2)/np.maximum(1e-15,(d*d).sum(2)),0,1);err=np.linalg.norm(after[i,0]-(a+d*t[:,:,None]),axis=2).min();errors.append(float(err));assert err<2e-6
 rows.append({'mesh':name,'changedBladeIds':ids.tolist(),'unchangedBlades':int((~changed).sum()),'maxFixedAttachmentGapM':max(errors,default=0)})
assert count>0,'No effective repair'
assert sum(len(v['repaired']) for v in declared.values())==85,'Unexpected investigation set'
out.write_text(json.dumps({'baseSha256':hashlib.sha256(base.read_bytes()).hexdigest(),'candidateSha256':hashlib.sha256(candidate.read_bytes()).hexdigest(),'investigatedAttachments':85,'changedBlades':count,'changedWebSelectedBlades':webcount,'alreadyExactAfterExhaustiveAssociation':85-count,'allWoodGroundOtherMeshObjectsAndRootTransformsExact':True,'wholeBladeTranslationOnly':True,'rows':rows},indent=2))
