"""In-memory, zero-inference rehearsal for the reviewed DAG operator."""
import json
from research_dag import ACTIVE,TERMINAL,digest,key,tick

class Timeline:
    def __init__(self,plan,order,timings):
        self.names={key(plan,n):n['id'] for n in order}
        if set(timings)!=set(self.names.values()) or any(type(v)!=int or not 1<=abs(v)<=100 for v in timings.values()):
            raise ValueError('timing fixtures need 1–100 ticks per task, negative for simulated failure')
        self.timings=timings
        self.now=0
        self.rows={}
        self.events=[]

    def submit(self,req):
        k=req['requestKey'];name=self.names[k]
        if k in self.rows:raise AssertionError('duplicate submission in replay')
        self.rows[k]={**req,'id':'sim-'+name,'status':'leased','finish':self.now+abs(self.timings[name])}
        self.events.append({'tick':self.now,'action':'submitted','node':name,'role':req['role'],'parents':req['handoffFrom']})
        return self.rows[k]['id']

    def read(self,keys):
        for k,r in self.rows.items():
            if r['status'] not in ACTIVE or self.now<r['finish']:continue
            name=self.names[k];r['status']='completed' if self.timings[name]>0 else 'failed'
            if r['status']=='completed':
                artifact={'records':[{'value':'offline replay fixture'}]}
                raw=json.dumps(artifact)
                r['result']={'kind':'research_artifact','validationStatus':'research_artifact_received','modelOutput':raw,'artifact':artifact,'fullOutput':{'sha256':digest(raw.encode())}}
            self.events.append({'tick':self.now,'action':r['status'],'node':name})
        return {k:v for k,v in self.rows.items() if k in keys},[r['role'] for r in self.rows.values() if r['status'] in ACTIVE]

def replay(plan,snippets,order,timings):
    sim=Timeline(plan,order,timings);rejected={}
    for step in range(sum(map(abs,timings.values()))+2):
        sim.now=step
        states=tick(plan,snippets,order,sim.read,sim.submit,rejected)
        if all(v['status'] in TERMINAL for v in states.values()):break
    else:raise RuntimeError('offline simulation did not converge')
    return {'mode':'offline_replay','liveModelRequests':0,'evidenceSha256':plan['evidence']['sha256'] if order else None,'simulatedTicks':sim.now,'events':sim.events,'states':states}
