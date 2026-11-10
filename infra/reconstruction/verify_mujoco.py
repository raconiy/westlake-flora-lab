"""Run with the official Python MuJoCo binding, no renderer or GPU required."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,math,sys
import numpy as np,mujoco as mj
from xml.etree import ElementTree as ET
p=Path(sys.argv[1]);xml=p/'contact-world.xml';b=json.loads((p/'contact-check.json').read_text())
digest=hashlib.sha256(xml.read_bytes()).hexdigest();assert digest==b['xml_sha256']
m=mj.MjModel.from_xml_path(str(xml));d=mj.MjData(m);mj.mj_forward(m,d)
def ray(start,direction):
 id=np.array([-1],dtype=np.int32);normal=np.empty(3,dtype=np.float64)
 dist=mj.mj_ray(m,d,np.asarray(start,float),np.asarray(direction,float),None,True,-1,id,normal)
 assert dist>=0 and id[0]>=0
 return dist,mj.mj_id2name(m,mj.mjtObj.mjOBJ_GEOM,id[0]),normal.tolist()
l=b['lamps'][0];base=np.asarray(l['base']);axis=np.asarray(l['axis']);side=np.cross(axis,[0,1,0]);side/=np.linalg.norm(side)
profiles={}
for role,h in [('pole',1.0),('collar',2.92),('bowl',3.21),('rim',3.366)]:
 rings=np.asarray(l['profiles_h_radius_m'][role]);expected=float(np.interp(h,rings[:,0],rings[:,1]));checks=[]
 for sign in (1,-1):
  radial=side*sign
  dist,name,n=ray(base+axis*h+radial*(expected+.20),-radial)
  measured=expected+.2-dist
  assert abs(measured-expected)<.003 and ('-'+role) in name,(role,measured,expected,name)
  checks.append({'hit':name,'measuredRadiusM':measured,'absErrorM':abs(measured-expected)})
 profiles[role]={'axisHeightM':h,'expectedRadiusM':expected,'rays':checks}
originalMapHash=digest
drops=[]
for probe in b['probes']:
 target=np.array(probe['target'],float);expected=probe['source_geom']; radius=b['probe_radius_m'];start=target+[0,0,.75]
 direction=np.array([0,0,-1.]);dist,gname,n=ray(start,direction);tip_z=float(start[2]-dist)
 assert gname==expected and abs(tip_z-target[2])<=.002,(gname,expected,tip_z,target)
 tree=ET.fromstring(xml.read_bytes());body=ET.SubElement(tree.find('worldbody'),'body',name='drop-body',pos=' '.join(str(v) for v in start));ET.SubElement(body,'freejoint');ET.SubElement(body,'geom',name='probe',type='sphere',size=str(radius),mass='.1')
 mm=mj.MjModel.from_xml_string(ET.tostring(tree,encoding='unicode'));dd=mj.MjData(mm);sphere=mj.mj_name2id(mm,mj.mjtObj.mjOBJ_GEOM,'probe')
 first=None;maximum_force=0
 for step in range(475):
  mj.mj_step(mm,dd)
  for i,ct in enumerate(dd.contact):
   if sphere not in ct.geom:continue
   partner=int(ct.geom[1] if ct.geom[0]==sphere else ct.geom[0]);other=mj.mj_id2name(mm,mj.mjtObj.mjOBJ_GEOM,partner)
   force=np.zeros(6);mj.mj_contactForce(mm,dd,i,force)
   if first is None:first={'geom':other,'step':step+1,'timeS':float(dd.time),'centerZm':float(dd.geom_xpos[sphere,2]),'firstContactDistM':float(ct.dist)}
   if other==expected:maximum_force=max(maximum_force,float(force[0]))
 assert first and first['geom']==expected and maximum_force>0,(probe,first)
 err=float(abs(first['centerZm']-target[2]-radius))
 assert err<.015,(probe,err)
 drops.append({'surface':probe['surface'],'firstContact':first,'measuredFirstHeightAbsErrorM':err,'maxNormalForceN':maximum_force,'verticalRayHit':gname,'verticalRayHeightM':tip_z})
payload={'generatedAtUtc':datetime.now(timezone.utc).isoformat(),'engine':'MuJoCo '+mj.__version__,'verifiedSourceBlendSha256':b['source_blend_sha256'],'verifiedXmlSha256':digest,'compiledStaticGeoms':int(m.ngeom),'compiledConvexMeshes':int(m.nmesh),'durationPerDropS':475*m.opt.timestep,'radiusChecks':profiles,'drops':drops,'limitations':'The drop probes are temporary dynamic bodies added to copies of the exported static model. Values validate the coarse fitted contact geometry in the chosen scale.'}
(p/'mujoco-check.json').write_text(json.dumps(payload,indent=2)+'\n')
print(json.dumps({k:payload[k] for k in ['generatedAtUtc','engine','compiledStaticGeoms','compiledConvexMeshes','verifiedXmlSha256']}));print([(a['surface'],a['firstContact']['geom'],round(1000*a['measuredFirstHeightAbsErrorM'],3)) for a in drops])
