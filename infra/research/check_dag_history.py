"""Read-only check for previously recorded private-coordinator research tasks."""
import argparse
import hashlib
import json
from pathlib import Path

from research_dag import recovered, snapshot

def verify(expected):
    if not 1<=len(expected)<=64:raise ValueError('supply known historical task identities')
    keys=[x['requestKey'] for x in expected]
    if len(set(keys))!=len(keys):raise ValueError('duplicate historical key')
    result={}
    for read_number in (1,2):
        stored,_=snapshot(keys)
        for item in expected:
            k=item['requestKey'];row=stored[k]
            if row['id']!=item['taskId'] or row['role']!=item['role'] or row['kind']!='research':
                raise ValueError('stored request identity mismatch')
            request={f:row[f] for f in ('kind','role','title','prompt','handoffFrom')}
            matched=recovered({**request,'requestKey':k},stored)
            sha=hashlib.sha256(row['result']['modelOutput'].encode()).hexdigest()
            if matched!={'status':'completed','id':item['taskId']} or sha!=item['outputSha256']:
                raise ValueError('stored result or operator receipt mismatch')
            assert read_number==1 or result[k]['taskId']==matched['id']
            result[k]={'taskId':matched['id'],'role':row['role'],'status':matched['status'],'artifactSha256':sha}
    return {'mode':'historical-read-only','independentReads':2,'matchingPriorRequests':len(result),'newSubmissions':0,'usesNetwork':False,'results':list(result.values())}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('known_receipts',type=Path)
    print(json.dumps(verify(json.loads(p.parse_args().known_receipts.read_text())),indent=2))
