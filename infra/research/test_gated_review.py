import copy, hashlib, importlib.util, json, pathlib, unittest
from unittest.mock import patch
root = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('gated_review', root/'run-gated-review.py')
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
class GatedHandoffs(unittest.TestCase):
    def setUp(self):
        self.plan={'batch':'synthetic-a','producers':[{'role':r,'title':'A','prompt':'B'} for r in ('botany','scene')],
                   'review':{'role':'qa','title':'C','prompt':'D'}}
        self.jobs=[]
        self.raw=json.dumps({'records':[{'value':'local fixture'}]})
        self.finished={'status':'completed','result':{'kind':'research_artifact','artifact':json.loads(self.raw),
                       'modelOutput':self.raw,'fullOutput':{'sha256':hashlib.sha256(self.raw.encode()).hexdigest()}}}
    def enqueue(self,job):
        self.jobs.append(job)
        return job['requestKey']
    def test_real_parent_artifacts_and_all_dependencies_required(self):
        wait=[True]
        def states(ids):
            if wait:
                wait.clear()
                return {ids[0]:self.finished,ids[1]:{'status':'leased'}}
            return {i:self.finished for i in ids}
        with patch('builtins.print'):
            child=g.run(self.plan,self.enqueue,states,pause=lambda _: self.assertEqual(len(self.jobs),2))
        self.assertEqual(self.jobs[2]['handoffFrom'],[x['requestKey'] for x in self.jobs[:2]])
        self.assertEqual(child,self.jobs[2]['requestKey'])
    def test_failed_or_unverified_parents_never_request_a_review(self):
        for case in ('failed','bad_hash','changed_records'):
            row=copy.deepcopy(self.finished);self.jobs=[]
            if case=='failed':row['status']='failed'
            if case=='bad_hash':row['result']['fullOutput']['sha256']='wrong'
            if case=='changed_records':row['result']['artifact']['records'][0]['value']='other'
            with self.assertRaises(RuntimeError),patch('builtins.print'):
                g.run(self.plan,self.enqueue,lambda ids:{i:row for i in ids})
            self.assertEqual(len(self.jobs),2)
if __name__=='__main__':unittest.main()
