"""Second work package: locate projected canopy errors on supported image tiles."""
import itertools
import math
from asset_rules import compile_rule
CONTRACTS = {
 'botany':('gap_residual',('photo_gap','sim_gap','area'),
 'Observed minus simulated bright sky fraction on one tile. Inputs are pixel counts; divide by area. Never convert this projection to leaf counts. For zero area return 0.'),
 'physics':('unchanged_attachments',('moved','anchors','max_error','changed_wood'),
 'Physical gate: true only for a measured nonempty set of anchors, zero moved anchors, zero changed woody meshes, and maximum absolute coordinate error <= 1e-6 metres.'),
 'scene':('score_tile',('residual','known_fraction','min_known'),
 'Return absolute signed gap residual multiplied by the jointly classified fraction when fraction >= min_known; return 0 otherwise. Used to rank image regions, not to assign hidden geometry.'),
 'infra':('eligible_tile',('exclusive_pixels','total_pixels','jointly_known','min_coverage','min_known'),
 'Select ROI tiles with positive total and exclusive pixel counts, area fraction exclusive_pixels/total_pixels >= min_coverage and fraction jointly_known/exclusive_pixels >= min_known. Short circuit before division by zero.'),
 'qa':('trial_survives',('worst_gap_gain','max_residual','all_anchors_fixed','tolerance','max_allowed'),
 'Publish gate for a trial: no individual view/tree gets worse by more than an absolute tolerance (worst signed gain >= minus tolerance), max absolute remaining gap residual <= max_allowed, and physical anchor checks passed. Inputs are fractions, not percent; use absolute max_residual.')
}
def checks(role):
 if role=='botany':
  for n in (0,1,64,256):
   for p,b in ((0,0),(n,n//2),(n//3,n)):
    yield (p,b,n), (p-b)/n if n else 0.
 if role=='physics':
  for m,a,e,w in itertools.product((0,1),(0,12),(-1e-4,0,1e-6,1e-3),(0,1)):
   yield (m,a,e,w),bool(a>0 and m==0 and w==0 and abs(e)<=1e-6)
 if role=='scene':
  for r,k,b in itertools.product((-.2,0.,.13),(0.,.65,.9),(.5,.65,.95)):
   yield (r,k,b),abs(r)*k if k>=b else 0.
 if role=='infra':
  for total in (0,64,4096):
   for e in (0,total//4,total//2,total):
    for k in (0,e//2,e):
     yield (e,total,k,.5,.65),bool(total and e and e/total>=.5 and k/e>=.65)
 if role=='qa':
  for w,r,p,t,m in itertools.product((-.1,-.005,0,.03),(0,-.2,.05),(False,True),(.005,.01),(.05,.1)):
   yield (w,r,p,t,m),bool(w>=-t and abs(r)<=m and p)
def test_rule(role,source):
 _,fields,_=CONTRACTS[role];f=compile_rule(source,fields)
 n=0
 for args,result in checks(role):
  v=f(**dict(zip(fields,args)))
  if not ((v is result) if type(result) is bool else (type(v) in (int,float) and math.isclose(result,v,abs_tol=1e-12))):
   raise ValueError(f'{args}: expected {result}, received {v}')
  n+=1
 return n
