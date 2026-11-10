"""Generate a two-view canopy discrepancy map using reviewed, empirically tested scalar programs.
Usage: review_crown_trial.py CAPTURE AB_RENDER_FOLDER ASSET_RULE_FOLDER GAP_RULE_FOLDER OUT
"""
import json
import hashlib
from pathlib import Path
import sys
import numpy as np
from PIL import Image, ImageDraw
from registered_crown_masks import space, classify, KEYS, H, W
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'research'))
import asset_rules, gap_rules

def read_rules(root,spec):
    rules={};trace={}
    for role,(name,fields,_) in spec.CONTRACTS.items():
        found=[json.loads(p.read_text()) for p in root.glob(role+'-*.json')]
        r=next(row for row in found if row['state']=='tested')
        assert hashlib.sha256(r['modelOutput'].encode()).hexdigest()==r['outputSha256']
        source=json.loads(r['modelOutput'])['expression']
        assert spec.test_rule(role,source)==r['testsPassed']
        rules[role]=asset_rules.compile_rule(source,fields)
        trace[role]={'function':name,'source':source,'sourceSha256':r['outputSha256'],'tests':r['testsPassed'],'taskId':r['taskId']}
    return rules,trace

def main(capture,ab,a_path,g_path,out):
    out.mkdir(parents=True,exist_ok=True)
    a,ta=read_rules(a_path,asset_rules);g,tg=read_rules(g_path,gap_rules)
    geo=json.loads((ab/'render-evidence.json').read_text());metrics=json.loads((ab/'crown-ab-metrics.json').read_text())
    for r in geo['renders']:
        assert hashlib.sha256((ab/r['file']).read_bytes()).hexdigest()==r['sha256']==metrics['inputSha256'][r['file']]
    assert geo['sourceSha256']==geo['sourceSha256After']
    assert a['infra'](required=4,verified=len({r['file'] for r in geo['renders']}),pending=0,failed=0,already_done=False)
    drift=max(x['maxFixedVertexDriftM'] for x in geo['changed'].values());anchor_count=sum(x['leaves'] for x in geo['changed'].values())
    assert a['physics'](axis=0,edge=drift,factor=1.1,is_edge=False)==drift
    fixed=g['physics'](moved=int(drift!=0),anchors=anchor_count,max_error=drift,changed_wood=int(geo['baseNodes']!=geo['candidateNodes']))
    all_rows=[];regions=[];panels=[]
    for view in ('01','13'):
        photo,polys,sky=space(view,capture)
        images=[photo]+[Image.open(ab/(var+'-'+view+'.png')).convert('RGB') for var in ('A','B')]
        labels=[classify(im) for im in images];cnt=sum(poly.astype(int) for poly in polys)
        # Display heat over the rendered candidate, never a substitute photograph.
        panel=images[2].convert('RGBA');layer=Image.new('RGBA',(W,H));draw=ImageDraw.Draw(layer)
        for poly,tree in zip(polys,KEYS):
            r=metrics['sample'][view][tree]; row=r['primaryExclusiveSkyBackedROI']
            p,x,y=[row[k]['gapPct']/100 for k in ('photo','A','B')]
            gain=a['scene'](photo=p,baseline=x,candidate=y)
            iou=r['imageSpaceCrownIoUOnJointlyConfidentPx']
            regions.append({'view':view,'tree':tree,'gapGain':gain,'photoGap':p,'candidateGap':y,
              'candidateResidual':p-y,'candidateLocalPass':a['qa'](mask_gain=iou['B']-iou['A'],coverage_gain=gain,anchor_error=drift,pair_complete=True),
              'priorWidthProbeOnly':a['botany'](photo=1-p,render=1-x,gain=1.0)})
            mask=poly&sky&(cnt==1)
            for top in range(0,H,64):
                for left in range(0,W,64):
                    sl=np.s_[top:top+64,left:left+64];m=mask[sl];area=int(m.sum())
                    k=m&~labels[0]['unknown'][sl]&~labels[2]['unknown'][sl];known=int(k.sum())
                    if not g['infra'](exclusive_pixels=area,total_pixels=m.size,jointly_known=known,min_coverage=.5,min_known=.65):continue
                    # Score only jointly classified pixels. Input denominators always match the counted pixels.
                    nphoto,nsim=[int((l['gap'][sl]&k).sum()) for l in (labels[0],labels[2])]
                    err=g['botany'](photo_gap=nphoto,sim_gap=nsim,area=known)
                    score=g['scene'](residual=err,known_fraction=known/area,min_known=.65)
                    rec={'view':view,'tree':tree,'x':left,'y':top,'width':64,'height':64,'pixelsKnown':known,
                         'signedGapFraction':round(err,5),'priority':round(score,5)}
                    all_rows.append(rec)
                    if score>=.08:
                        color=(255,128,35) if err>0 else (95,213,255)
                        draw.rectangle((left+1,top+1,left+62,top+62),fill=(*color,round(55+130*min(1,score))),outline=(*color,230),width=2)
        panels.append(Image.alpha_composite(panel,layer).convert('RGB'))
    keep=g['qa'](worst_gap_gain=min(x['gapGain'] for x in regions),max_residual=max(abs(x['candidateResidual']) for x in regions),
          all_anchors_fixed=fixed,tolerance=.005,max_allowed=.05)
    all_rows.sort(key=lambda r:-r['priority'])
    result={'candidate':'leaf width only: foreground *0.90 / left *1.10','renderInputsSha256':metrics['inputSha256'],
       'retain':keep,'anchorsUnchanged':fixed,'regions':regions,'tileCount':len(all_rows),'tiles':all_rows,
       'engineeringGate':'For this trial: maximum remaining gap error 5 percentage points; worst-region regression <=0.5 pp; unchanged attachments.',
       'limits':'Ranked image-plane observations. One tile is not a located branch or a species diagnosis. Two same-side views do not resolve the back.',
       'ruleSources':{'first':ta,'second':tg}}
    (out/'gap-review.json').write_text(json.dumps(result,indent=2)+'\n')
    board=Image.new('RGB',(W*2,H+42),'#18231e');d=ImageDraw.Draw(board)
    d.text((12,8),'VIEW 01  |  Orange: render blocks real sky. Blue: excess sky in render.',fill='#ffffff')
    d.text((W+12,8),'VIEW 13  |  Only mutually visible, sky-backed regions scored.',fill='#ffffff')
    for i,panel in enumerate(panels):board.paste(panel,(W*i,42))
    board.thumbnail((1536,640));board.save(out/'gap-map.jpg',quality=90)
    print(json.dumps({'candidateAccepted':keep,'qualifiedTiles':len(all_rows),'pairs':len(regions),'anchorsVerified':fixed}))
if __name__=='__main__':main(*map(Path,sys.argv[1:]))
