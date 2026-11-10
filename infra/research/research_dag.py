"""Dispatch finite, operator-reviewed research DAGs to the private coordinator.
run: root-owned private plan, relative JSON evidence, existing coordinator credential.
replay: same graph and evidence, deterministic in-memory timings, no HTTP or credential.
"""
import argparse
from collections import Counter
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import time
import urllib.error
import urllib.request

ROLES = {'botany', 'physics', 'scene', 'infra', 'qa'}
ACTIVE = {'queued', 'running', 'leased'}
TERMINAL = {'completed', 'failed', 'blocked'}
ID = re.compile(r'[a-z0-9][a-z0-9-]{0,47}', re.ASCII)
HEX = re.compile(r'[a-f0-9]{64}', re.ASCII)
MAX_NODES = 64
STATE = Path('/var/lib/westlake-research-dag')
DB = 'file:/var/lib/westlake-research-coordinator/sessions.sqlite?mode=ro'

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def checked_file(path, root_only, limit):
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    with os.fdopen(os.open(path, flags), 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or (root_only and (info.st_uid != 0 or info.st_mode & 0o022)):
            raise ValueError('input must be an operator-owned file without outside write access')
        raw = stream.read(limit + 1)
        if len(raw) > limit:
            raise ValueError('input exceeds limit')
        return raw

def text(v, limit):
    return isinstance(v, str) and 0 < len(v.strip()) <= limit and v.strip() == v

def validate(plan):
    if set(plan) != {'schema','batch','evidence','nodes'} or plan['schema'] != 1 or not ID.fullmatch(plan['batch']):
        raise ValueError('invalid plan header')
    nodes = plan['nodes']
    if not isinstance(nodes,list) or len(nodes)>MAX_NODES:
        raise ValueError('too many tasks')
    ev = plan['evidence']
    if nodes or ev is not None:
        if not isinstance(ev,dict) or set(ev)!={'file','sha256'} or not re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9._-]{0,90}\.json',ev['file']) or not HEX.fullmatch(ev['sha256']):
            raise ValueError('supply a named, hashed evidence JSON')
    ids = set()
    for n in nodes:
        if set(n)!={'id','role','title','prompt','depends','facts'} or not ID.fullmatch(n['id']) or n['id'] in ids or n['role'] not in ROLES or not text(n['title'],200) or not text(n['prompt'],4000):
            raise ValueError('invalid task')
        ids.add(n['id'])
        ds=n['depends']; fs=n['facts']
        if not isinstance(ds,list) or len(ds)>6 or any(not isinstance(k,str) for k in ds) or len(ds)!=len(set(ds)):
            raise ValueError('invalid dependencies')
        if not isinstance(fs,list) or not 1<=len(fs)<=8 or not all(isinstance(p,str) and re.fullmatch(r'(?:/[A-Za-z0-9_-]{1,70}){1,8}',p) for p in fs):
            raise ValueError('a task needs one to eight scalar evidence pointers')
    if any(set(n['depends'])-ids for n in nodes):
        raise ValueError('missing dependency')
    order=[]; seen=set()
    while len(order)<len(nodes):
        ready=[n for n in nodes if n['id'] not in seen and set(n['depends'])<=seen]
        if not ready: raise ValueError('dependency cycle')
        order.extend(ready); seen.update(n['id'] for n in ready)
    return order

def load_plan(path, evidence_dir, live):
    plan=json.loads(checked_file(path,live,256*1024)); order=validate(plan)
    if not order: return plan,{},order
    ev=plan['evidence']
    raw=checked_file(evidence_dir/ev['file'],live,4*1024*1024)
    if digest(raw)!=ev['sha256']: raise ValueError('evidence digest mismatch')
    data=json.loads(raw); snippets={}
    for n in order:
        facts={}
        for pointer in n['facts']:
            val=data
            for k in pointer[1:].split('/'):
                val=val[int(k)] if isinstance(val,list) and k.isdecimal() else val[k]
            if type(val) not in (float,int,str,bool) or (isinstance(val,str) and not text(val,300)):
                raise ValueError('evidence pointer must resolve to a short scalar')
            facts[pointer]=val
        snippets[n['id']]=json.dumps(facts,ensure_ascii=False,sort_keys=True,allow_nan=False)
    return plan,snippets,order

def key(plan,node):
    return 'dag-v1-'+plan['batch']+':'+node['id']

def body(plan,node,snippet,parents):
    return {'role':node['role'],'title':node['title'],'kind':'research','requestKey':key(plan,node),'handoffFrom':sorted(parents),
            'prompt':node['prompt']+'\n审核材料 '+plan['evidence']['sha256']+'\n'+snippet}

def usable(row):
    r=row.get('result') or {}; a=r.get('artifact'); raw=r.get('modelOutput')
    if not (r.get('kind')=='research_artifact' and r.get('validationStatus')=='research_artifact_received'
            and isinstance(a,dict) and isinstance(a.get('records'),list) and a['records']
            and isinstance(raw,str) and digest(raw.encode())==(r.get('fullOutput') or {}).get('sha256')):
        return False
    try:return json.loads(raw)==a
    except ValueError:return False

def recovered(request,known):
    """Return a matching stored outcome; a non-None return never needs a POST."""
    row=known.get(request['requestKey'])
    if row is None:return None
    if any(row.get(field)!=request[field] for field in ('kind','role','title','prompt','handoffFrom')):
        return {'status':'failed','reason':'existing request key has different contents'}
    state=row['status']
    if state=='completed' and not usable(row):
        return {'status':'failed','id':row['id'],'reason':'artifact validation failed'}
    return {'status':state if state in ACTIVE|{'completed'} else 'failed','id':row['id']}

class PermanentSubmission(Exception):
    pass

def tick(plan,snippets,order,snapshot,submit,rejections):
    if not order: return {}
    known,active_roles=snapshot([key(plan,n) for n in order])
    busy=Counter(active_roles); states={}
    for n in order:
        name=n['id']; parents=[states[d] for d in n['depends']]
        if name in rejections:
            states[name]={'status':'failed','reason':rejections[name]};continue
        if any(p['status'] in {'failed','blocked'} for p in parents):
            states[name]={'status':'blocked','reason':'prerequisite rejected'};continue
        if any(p['status']!='completed' for p in parents):
            states[name]={'status':'waiting'};continue
        request=body(plan,n,snippets[name],[p['id'] for p in parents])
        prior=recovered(request,known)
        if prior is not None:
            states[name]=prior;continue
        if busy[n['role']] or sum(busy.values())>=5:
            states[name]={'status':'ready'};continue
        try:
            task=submit(request)
        except PermanentSubmission as exc:
            rejections[name]=str(exc);states[name]={'status':'failed','reason':str(exc)};continue
        except (TimeoutError,OSError):
            # Delivery is ambiguous; reserve one slot this tick. Re-read SQLite before resending.
            busy[n['role']]+=1;states[name]={'status':'unconfirmed'};continue
        busy[n['role']]+=1
        states[name]={'status':'queued','id':task}
    return states

def snapshot(keys):
    with sqlite3.connect(DB,uri=True) as db:
        db.execute('BEGIN')
        rows=db.execute('SELECT request_key,id,status,kind,role,title,prompt,handoff_from,result FROM tasks WHERE request_key IN ('+','.join('?' for _ in keys)+')',keys)
        found={k:dict(id=i,status=s,kind=kind,role=r,title=t,prompt=p,handoffFrom=json.loads(h or '[]'),result=json.loads(res) if res else None) for k,i,s,kind,r,t,p,h,res in rows}
        active=[r for (r,) in db.execute("SELECT role FROM tasks WHERE kind='research' AND status IN ('queued','leased','running')")]
    return found,active

def create_submit():
    p=Path(os.environ.get('CREDENTIALS_DIRECTORY','/etc/westlake-swarm'))/'admin-token'
    token=p.read_text().strip()
    class LocalOnly(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args): return None
    client=urllib.request.build_opener(urllib.request.ProxyHandler({}),LocalOnly())
    def submit(payload):
        req=urllib.request.Request('http://127.0.0.1:8788/api/suggestions',data=json.dumps(payload).encode(),
                    headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
        try:
            with client.open(req,timeout=10) as res: return json.load(res)['task']['id']
        except urllib.error.HTTPError as e:
            if 400<=e.code<500 and e.code not in (408,429):
                raise PermanentSubmission('HTTP '+str(e.code)) from None
            raise
    return submit

@contextmanager
def private_lock(root):
    root.mkdir(mode=0o700,parents=True,exist_ok=True)
    info=root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.geteuid() or info.st_mode&0o077:
        raise PermissionError('need an owner-only local state directory')
    with (root/'dispatch.lock').open('a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        yield

def run(plan,snippets,order,root,read,send,poll,timeout):
    if not order: return {}
    fingerprint=digest(json.dumps(plan,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())
    ledger=root/(plan['batch']+'.json');deadline=time.monotonic()+timeout
    while True:
        with private_lock(root):
            entry=json.loads(ledger.read_text()) if ledger.exists() else {'manifestSha256':fingerprint,'rejections':{}}
            if entry['manifestSha256']!=fingerprint:raise ValueError('batch was already pinned to a different manifest')
            # Pin before POST so a crash cannot silently replace an in-progress plan.
            def save():
                temp=ledger.with_suffix('.tmp');temp.write_text(json.dumps(entry,ensure_ascii=False)+'\n');os.replace(temp,ledger)
            if not ledger.exists(): save()
            states=tick(plan,snippets,order,read,send,entry['rejections'])
            if entry.get('states')!=states:
                entry['states']=states;save();print(json.dumps(states,ensure_ascii=False),flush=True)
        if all(x['status'] in TERMINAL for x in states.values()):return states
        if time.monotonic()>=deadline:raise TimeoutError('resume with the same plan; accepted work remains in the coordinator')
        time.sleep(poll)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode',choices=['run','replay']);parser.add_argument('manifest',type=Path)
    parser.add_argument('--evidence-dir',type=Path,required=True)
    parser.add_argument('--timings',type=Path,help='offline per-node duration ticks')
    parser.add_argument('--timeout',type=int,default=900)
    args=parser.parse_args()
    live=args.mode=='run'
    plan,snip,order=load_plan(args.manifest,args.evidence_dir,live)
    if not order:print('{"states":{},"submissions":0}');return
    if live:
        if args.timings or not 1<=args.timeout<=86400:parser.error('invalid live run options')
        states=run(plan,snip,order,STATE,snapshot,create_submit(),2,args.timeout)
        if any(v['status']!='completed' for v in states.values()):raise SystemExit(2)
    else:
        from research_dag_replay import replay
        if not args.timings:parser.error('provide --timings for offline replay')
        print(json.dumps(replay(plan,snip,order,json.loads(args.timings.read_text())),ensure_ascii=False,indent=2))

if __name__=='__main__':main()
