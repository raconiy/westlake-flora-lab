"""Fit spatial leaf and pigmentation adjustments to registered images 01/06 only."""
from pathlib import Path
import argparse, json, hashlib
import numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.spatial import cKDTree
from PIL import Image, ImageDraw

ap=argparse.ArgumentParser()
for n in ('capture','renders','scaffolds','output'):ap.add_argument(n,type=Path)
a=ap.parse_args();a.output.mkdir(exist_ok=True,parents=True)
F=json.loads((a.capture/'sfm/refined/asset-frame.json').read_text())['cameras']
polys=json.loads((a.capture/'crowns/manual-rois.json').read_text())
S=json.loads(a.scaffolds.read_text())
D=np.fromfile(a.capture/'revision2/dense/crown-stereo.bin',dtype=[('p','<f4',(3,)),('rgb','u1',(3,)),('tree','u1')])
names=['tree.foreground.forked','tree.mid-fork','tree.left-spreading']
root=[np.zeros(3),np.array([-1.08,0,-11.78]),np.array([-12.75,0,-13.20])]
# UV marks on the visible main trajectories, at the existing scaffold halfway ring.
times={'tree.foreground.forked.wood.00':[[562,267],[612,142]], 'tree.mid-fork.wood.03':[[550,374],[548,266]], 'tree.left-spreading.wood.03':[[157,415],[128,303]]}
out={}; report={'training':['01','06'],'patchHoldout':['10','13'],'originalSceneUsed13':True,'trees':{},'limbs':{}}
views=[]
def cam_data(view):
 c=next(v for k,v in F.items() if k.endswith('/'+view+'.jpg'));m=np.array(c['matrixWorldThreeColumnMajor']).reshape(4,4).T.copy();m[:3,3]*=3.41
 return c,m
def project(x,c,m,radial):
 q=(x-m[:3,3])@m[:3,:3]; uv=q[...,:2]/np.maximum(1e-5,-q[...,2,None])*[1,-1]
 if radial:uv*=1+c['normalizedSimpleRadialK']*np.sum(uv**2,axis=-1,keepdims=True)
 return (uv*c['fxPx']+c['principalPointPx'])*1024/c['width']
def sky(im):
 r,g,b=np.moveaxis(im,-1,0)
 return ((b-r)>25)&((b-g)>12)&(b>105)
def sample(im,uv):
 return map_coordinates(im,np.vstack([uv[:,1],uv[:,0]]),order=1,mode='nearest')
for v in report['training']:
 cam,m=cam_data(v);photo=Image.open(a.capture/'sources'/(v+'.jpg')).convert('RGB')
 x=np.array(photo.resize((1024,768),Image.Resampling.LANCZOS),dtype=np.float32)
 im=np.array(Image.open(a.renders/('R5-'+v+'.png')).convert('RGB').resize((1024,768),Image.Resampling.LANCZOS),np.float32)
 masks=[]
 for region in polys[v]:
  tile=Image.new('L',(1024,768));ImageDraw.Draw(tile).polygon([(p[0]*1024/photo.width,p[1]*768/photo.height) for p in region],fill=255)
  masks.append(np.array(tile,dtype=float)/255.)
 seen=(~sky(x)).astype(float);made=(~sky(im)).astype(float)
 rawG=gaussian_filter(seen,4); modG=gaussian_filter(made,6)
 def hue(rgb,ok):
  # Estimate relative R/G, never sample the blue sky as a leaf pigment.
  weights=ok * (rgb[...,1]>22) * (rgb[...,1]>rgb[...,2]*1.12)
  return gaussian_filter(np.clip(rgb[...,0]/np.maximum(rgb[...,1],1),.35,1.55)*weights,8)/np.maximum(.01,gaussian_filter(weights.astype(float),8))
 views.append((v,cam,m,np.array(masks),rawG,modG,hue(x,seen),hue(im,made)))
for t,name in enumerate(names):
 lo=root[t]+[-7.,1.,-7.];step=.23
 dims=(67,64,67);index=np.indices(dims,dtype=np.float32).reshape(3,-1).T
 points=lo+step*index; votes=[];color=[];fills=[]
 tracks=D['p'][D['tree']==t+1]; kd=cKDTree(tracks)
 dist,_=kd.query(points,k=1)
 near=np.exp(-.5*(dist/1.05)**2)
 for v,c,m,masks,g,sim,colour,simcolour in views:
  uv=project(points,c,m,True);p2=project(points,c,m,False)
  positive_depth=-(points-m[:3,3])@m[:3,2]>.05
  valid=positive_depth&(uv[:,0]>3)&(uv[:,0]<1020)&(uv[:,1]>3)&(uv[:,1]<(347 if v=='01' else 235))
  only=(masks[t]>0)&(np.sum(masks,axis=0)==1)
  # An edge is an uncertain label. A positively labelled competing canopy is never an empty gap.
  region=sample(gaussian_filter(only.astype(float),3),uv)*valid
  obs=sample(g,uv);model=sample(sim,p2)
  votes.append(np.clip((.50-obs)/.42,0,1)*region)
  fills.append(np.clip((obs-model-.08)*2.1,0,1)*region*near)
  weight=region*np.clip((obs-.35)*2.4,0,1)*np.clip((model-.25)*2,0,1)
  h=np.log(np.maximum(.4,sample(colour,uv))/np.maximum(.4,sample(simcolour,p2)))
  color.append(np.clip(h,-.12,.49)*weight)
 both=np.minimum(*votes); fill=np.maximum(*fills)
 # Two independent sky labels may reduce leaf area; the woody support is retained.
 scale=1-np.clip(both**.7*(1-.23*near)*.84,0,.84)
 width=1+.27*fill
 warm=(sum(color)/2)*(.34+.66*near)
 # Captured autumn warm highlights vary in lobes rather than a single material colour.
 # Values multiply linear pigment channels, independent of scene incident radiance.
 red=np.exp(warm*1.95)
 if t==0:red*=1+.13*near
 if t==1:red*=1+.045*near
 if t==2:red*=1+.07*near
 green=np.ones_like(red);blue=np.exp(-.39*np.maximum(warm,0))
 grid=np.column_stack([scale,width,red,green,blue]).reshape((*dims,5)).astype('<f4')
 out[name+'::bounds']=np.r_[lo,step];out[name+'::field']=grid
 report['trees'][name]={'stereoPoints':len(tracks),'gridStepM':step,'dualSkyGridSamples':int((scale<.6).sum()),'locallyWidenedGridSamples':int((width>1.13).sum())}
for name,marks in times.items():
 tn=next(k for k in names if name.startswith(k));q=np.array(S[tn][name]['points']);mid=q[len(q)//2]
 A=[];B=[]
 for (_,c,m,*_),tgt in zip(views,marks):
  uv=project(mid,c,m,True);jac=np.column_stack([(project(mid+np.eye(3)[j]*.001,c,m,True)-uv)/.001 for j in range(3)])
  A.extend(jac);B.extend(np.array(tgt)-uv)
 shift=np.linalg.solve(np.array(A).T@A+np.eye(3)*1400,np.array(A).T@B)
 length=np.linalg.norm(shift);cap=.72 if tn==names[0] else .48
 if length>cap:shift*=cap/length
 report['limbs'][name]={'start':q[0].tolist(),'mid':mid.tolist(),'end':q[-1].tolist(),'originalLine':q.tolist(),'midShift':shift.tolist(),'marksRaw1024':marks,'basis':'Paired inferred visible centreline marks, regularized in depth; fixed root and distal tip.'}
out['report']=np.array(json.dumps(report));np.savez_compressed(a.output/'crown-fields.npz',**out);(a.output/'fit.json').write_text(json.dumps(report,indent=2))
