# -*- coding: utf-8 -*-
from pathlib import Path
import numpy as np
from PIL import Image,ImageFilter
import sys,json,hashlib
D=Path(sys.argv[3]);D.mkdir(parents=True,exist_ok=True);repo=Path('/tmp/yungu-pages-release-2BdqRB');T=D.parent/'trees';cap=Path('/tmp/yungu-capture17')
sys.path.insert(0,str(repo/'infra/reconstruction'));import registered_crown_masks as m
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
protocol={'photos':['01','06','10','13'],'training':['01','06'],'newPatchHoldout':['10','13'],'historicalR5Used13':True,'historicalR6Used03And09':True,'registration':'Actual lens model and each source manual 3-tree polygon; transform to exact 1024×768 compare both real 1280×960 Cycles outputs at fixed registration with Lanczos. No outcome-based re-alignment.','support':'All three manual projected ROIs, exclude overlap and edges by 2px. Upper 216 rows only for every camera to reduce distant ground/building occluders. Strong photo-sky or photo-crown interiors 1px eroded. Unknown simulation pixels count as failure on each known photo support. Sky/crown colors from shipped registered_crown_masks.classify and independent per-frame sky-anchor eligibility check; no tuning to holdouts. Photo crown class includes both foliage and wood; no isolated branch label.','nValidRule':'Per tree/class only report n>=64; unobserved is null. Report all windows, both false-blocked sky and photo-crown missed by simulation. Proportion alone differs from positional paired errors.'}
f=D/'crown-protocol.json'
if f.exists():assert json.loads(f.read_bytes())==protocol
else:f.write_text(json.dumps(protocol,ensure_ascii=False,indent=2))
def erode(mask,n):return np.asarray(Image.fromarray(mask.astype('uint8')*255).filter(ImageFilter.MinFilter(2*n+1)))>0
cases=[];meta={}
for v in protocol['photos']:
 m.SKY_BACKED_BOTTOM[v]=99999
 photo,rois,valid=m.space(v,str(cap)); paths=[T/'render'/('R5-'+v+'.png'),T/'render'/('R6-'+v+'.png')]
 if len(sys.argv)>1: paths[-1]=Path(sys.argv[1].replace('{cam}',v))
 if len(sys.argv)>2: paths[0]=Path(sys.argv[2].replace('{cam}',v))
 imgs=[photo]+[Image.open(p).convert('RGB').resize((1024,768),Image.Resampling.LANCZOS) for p in paths]
 masks=[]
 for im in imgs:
  try:maskData=m.classify(im);masks.append(maskData)
  except ValueError as e:masks.append(None)
 meta[v]={'photo':sha(cap/'sources'/(v+'.jpg')),'old':sha(paths[0]),'new':sha(paths[1]),'validSkyAnchors':[z is not None for z in masks]}
 if any(k is None for k in masks):continue
 union=np.sum(rois,axis=0);low=np.arange(768)[:,None]<216
 for k,roi in zip(m.KEYS,rois):
  support=erode(roi.astype(bool)&(union==1)&valid&low,2)
  res={'camera':v,'region':k,'supportedPixels':int(support.sum()),'classes':{}}
  for cl in ['gap','crown']:
   field=erode(masks[0][cl],1)&support;n=int(field.sum())
   res['classes'][cl]=dict(n=n,**{key:float(1-data[cl][field].mean()) if n>=64 else None for key,data in zip(['R6','R7'],masks[1:])})
  cases.append(res)
summary={}
for label,cams in [('training',['01','06']),('holdout',['10','13'])]:
 summary[label]={}
 for cl in ['gap','crown']:
  r=[t['classes'][cl] for t in cases if t['camera']in cams and t['classes'][cl]['R6'] is not None];summary[label][cl]={'eligibleWindows':len(r),'nPixels':sum(a['n'] for a in r),**{k:(float(np.mean([a[k] for a in r])) if r else None) for k in ['R6','R7']}}
out={'renderComparison':'Matched 1280x960 Cycles renders at original shared cameras, resized to registered reference.','scoredViews':['01','06','10','13'],'actualPatchTrainingViews':['01','03','06','09'],'protocolSha256':sha(f),'protocol':protocol,'perCameraSources':meta,'windows':cases,'meanOfEligibleWindows':summary}
(D/'crown.json').write_text(json.dumps(out,indent=2,allow_nan=False));print(summary);print({v:d['validSkyAnchors'] for v,d in meta.items()})
