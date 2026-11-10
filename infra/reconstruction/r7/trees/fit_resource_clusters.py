"""Assign shoot resource priors from historical photo support, without new 10/13 tuning."""
from pathlib import Path
import json,sys
import numpy as np
from scipy.spatial import cKDTree

units_path,stereo_path,output=map(Path,sys.argv[1:4])
include_inferred = len(sys.argv)>4 and sys.argv[4]=="inferred"
U=np.load(units_path)
D=np.fromfile(stereo_path,dtype=[('p','<f4',(3,)),('rgb','u1',(3,)),('tree','u1')])
names=('tree.foreground.forked','tree.mid-fork','tree.left-spreading')
rng=np.random.default_rng(71269);result={};report={}
for label,tree in enumerate(names,1):
    keys=[k[:-7] for k in U.files if k.endswith('::world') and k.startswith(tree)]
    positions=np.concatenate([U[k+'::world'][:,-1] for k in keys])
    tracked=D['p'][D['tree']==label]
    kd=cKDTree(positions)
    dist,idx=kd.query(tracked)
    candidates=np.unique(idx[dist<1.1])
    rng.shuffle(candidates)
    selected=[];radii=[]
    # Irregular supports seed contiguous lobes, with distinct lateral/vertical widths.
    axes=np.array([(1.,.73,1.),(1.,.95,1.),(1.35,.51,1.)][label-1])
    for candidate in candidates:
        radius=float(rng.uniform(.52,1.03 if label!=2 else .86))
        p=positions[candidate]
        if selected:
            d=np.linalg.norm((p-np.array(selected))/axes,axis=1)
            if np.any(d<np.array(radii)*.87):continue
        selected.append(p);radii.append(radius)
    observed_lobes=len(selected)
    # Hidden surfaces have only the native connected-shoot support. Treat their
    # unequal lobe sizes as an architectural prior, and count them separately.
    inferred=0
    if include_inferred:
        proposed=rng.permutation(len(positions))
        inferred_limit=(62,38,45)[label-1]
        inferred=0
        for candidate in proposed:
            p=positions[candidate]
            radius=float(rng.uniform(.83,1.48 if label==1 else 1.10))
            distance=np.linalg.norm((p-np.array(selected))/axes,axis=1)
            if np.any(distance<(np.array(radii)+radius)*.78):continue
            selected.append(p);radii.append(radius);inferred+=1
            if inferred>=inferred_limit:break
    centers=np.array(selected);radii=np.array(radii)
    nearest=cKDTree(centers).query(positions,k=min(6,len(centers)))[1]
    vectors=(positions[:,None]-centers[nearest])/axes
    scaled=np.linalg.norm(vectors,axis=2)/radii[nearest]
    resources=np.exp(-1.8*np.min(scaled,axis=1)**3)
    # Occluded geometry has lower confidence and retains a broader support floor.
    observed=cKDTree(tracked).query(positions)[0]
    resources=.16+.84*resources
    offset=0
    for key in keys:
        count=len(U[key+'::world']);r=resources[offset:offset+count]
        result[key+'::resource']=r.astype('f')
        offset+=count
    report[tree]={'nativeGrowthUnits':len(positions),'observedStereoSamples':len(tracked),
                  'leafLobes':len(centers),'stereoSupportedLobes':observed_lobes,'inferredSupportedShootLobes':inferred,'lobeRadiusPriorM':[.52,1.03 if label!=2 else .86],
                  'anisotropyPrior':axes.tolist(),'resourceQuantiles':np.quantile(resources,[0,.25,.5,.75,1]).tolist(),
                  'observation':'Recorded lobe centres come from captured stereo support. Additional lobe centres use the already-connected native shoots on hidden/top surfaces. Both counts are explicit; extent, resource floor and anisotropy are engineering priors.',
                  'supportsNearStereo':int((observed<.5).sum())}
    result[tree+'::lobe-centers']=centers.astype('f')
    result[tree+'::lobe-radii']=radii.astype('f')
result['report']=np.array(json.dumps(report))
np.savez_compressed(output,**result)
output.with_suffix('.json').write_text(json.dumps(report,indent=2))
