import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import research_dag as d
from research_dag_replay import Timeline,replay

def node(name,role,parents=()):
    return dict(id=name,role=role,depends=list(parents),title='Title '+name,prompt='Return an engineering prior.',facts=['/pixels'])

class OperatorDagTests(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory()
        self.addCleanup(self.t.cleanup)
        self.root=Path(self.t.name)
        self.evidence=self.root/'photometric.json'
        self.evidence.write_bytes(b'{"pixels":567}')
        self.plan=dict(schema=1,batch='test-1',evidence={'file':self.evidence.name,'sha256':hashlib.sha256(self.evidence.read_bytes()).hexdigest()},
                       nodes=[node('slow','physics'),node('fast','scene'),node('other','qa'),node('next','qa',['fast']),node('end','botany',['slow'])])
        self.manifest=self.root/'plan.json'
        self.timings={'slow':8,'fast':1,'other':2,'next':3,'end':1}
    def load(self):
        self.manifest.write_text(json.dumps(self.plan))
        return d.load_plan(self.manifest,self.root,False)
    def test_slow_unrelated_branch_does_not_delay_handoff_and_each_role_has_one_slot(self):
        report=replay(*self.load(),self.timings)
        events=report['events'];submitted={e['node']:e for e in events if e['action']=='submitted'}
        self.assertEqual(submitted['next']['tick'],2)
        self.assertEqual(submitted['next']['parents'],['sim-fast'])
        self.assertEqual(submitted['end']['tick'],8)
        self.assertEqual(report['liveModelRequests'],0)
        roles={};nodes={n['id']:n['role'] for n in self.plan['nodes']}
        for e in events:
            r=nodes[e['node']]
            if e['action']=='submitted':
                self.assertNotIn(r,roles);roles[r]=True;self.assertLessEqual(len(roles),5)
            else:roles.pop(r)
    def test_failed_or_corrupt_branch_only_blocks_its_descendants(self):
        plan,s,order=self.load()
        res=replay(plan,s,order,{**self.timings,'slow':-1})
        self.assertEqual(res['states']['slow']['status'],'failed')
        self.assertEqual(res['states']['end']['status'],'blocked')
        self.assertEqual(res['states']['next']['status'],'completed')
        sim=Timeline(plan,order,self.timings);rejected={}
        d.tick(plan,s,order,sim.read,sim.submit,rejected);sim.now=10
        rows,busy=sim.read([d.key(plan,n) for n in order])
        rows[d.key(plan,order[0])]['result']['fullOutput']['sha256']='invalid'
        result=d.tick(plan,s,order,sim.read,sim.submit,rejected)
        self.assertEqual(result['slow']['status'],'failed')
        self.assertEqual(result['end']['status'],'blocked')
        self.assertEqual(result['next']['status'],'queued')
    def test_empty_plan_neither_connects_nor_submits(self):
        self.plan.update(nodes=[],evidence=None)
        def forbidden(*args): raise AssertionError('unexpected database, credential or inference access')
        plan,s,order=self.load()
        self.assertEqual(d.run(plan,s,order,self.root/'private',forbidden,forbidden,0,0),{})
        self.assertEqual(d.tick(plan,s,order,forbidden,forbidden,{}),{})
        self.assertFalse((self.root/'private').exists())
    def test_reject_invalid_or_unverified_manifest_before_submission(self):
        tests=[lambda:self.plan['nodes'][0]['depends'].append('missing'),
               lambda:self.plan['nodes'][0]['depends'].append('end'),
               lambda:self.plan['nodes'].append(copy.copy(self.plan['nodes'][0])),
               lambda:self.plan['evidence'].update(sha256='0'*64),
               lambda:self.plan['evidence'].update(file='../escape.json'),
               lambda:self.plan['nodes'][2].update(facts=['/absent'])]
        source=copy.deepcopy(self.plan)
        for mutate in tests:
            self.plan=copy.deepcopy(source);mutate()
            with self.assertRaises((ValueError,KeyError)): self.load()
    def test_resume_after_ambiguous_submit_and_completed_restart_are_idempotent(self):
        plan,s,order=self.load();sim=Timeline(plan,order,self.timings)
        def post(req):
            ident=sim.submit(req)
            if req['requestKey'].endswith(':fast'):raise TimeoutError('ack lost')
            return ident
        def step(_):
            sim.now+=1
        with patch('time.sleep',step),patch('builtins.print'):
            out=d.run(plan,s,order,self.root/'private',sim.read,post,0,60)
            before=list(sim.events)
            again=d.run(plan,s,order,self.root/'private',sim.read,post,0,60)
        self.assertEqual(out,again);self.assertEqual(before,sim.events)
        self.assertTrue(all(v['status']=='completed' for v in out.values()))
        self.assertEqual(len(sim.rows),len(order))
        self.plan['nodes'][1]['prompt']='Changed immutable plan.'
        p,s,o=self.load()
        with self.assertRaises(ValueError):d.run(p,s,o,self.root/'private',sim.read,post,0,60)
    def test_other_runs_share_capacity_and_rejected_requests_do_not_rerun(self):
        plan,s,order=self.load()
        def forbidden(req):raise AssertionError('over concurrency limit')
        waiting=d.tick(plan,s,order,lambda keys:({},['botany','physics','scene','infra','qa']),forbidden,{})
        self.assertFalse(any(r['status']=='queued' for r in waiting.values()))
        calls=[];sim=Timeline(plan,order,self.timings);reject={}
        def send(req):
            if req['role']=='physics':
                calls.append(req);raise d.PermanentSubmission('HTTP 400')
            return sim.submit(req)
        d.tick(plan,s,order,sim.read,send,reject)
        out=d.tick(plan,s,order,sim.read,send,reject)
        self.assertEqual(len(calls),1)
        self.assertEqual(out['end']['status'],'blocked')
        self.assertEqual(out['other']['status'],'leased')
    def test_files_are_checked_without_following_symlinks(self):
        source=self.root/'src';self.evidence.rename(source);self.evidence.symlink_to(source)
        with self.assertRaises(OSError):self.load()

if __name__=='__main__':unittest.main()
