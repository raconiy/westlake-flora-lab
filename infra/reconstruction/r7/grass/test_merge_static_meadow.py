import copy
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('merge_static_meadow',Path(__file__).with_name('merge_static_meadow.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


def fixture(xs):
    blob=bytearray();views=[];accessors=[]
    def attribute(values,dims):
        start=len(blob);blob.extend(struct.pack('<'+'f'*len(values),*values))
        views.append({'buffer':0,'byteOffset':start,'byteLength':len(blob)-start})
        accessors.append({'bufferView':len(views)-1,'componentType':5126,'count':len(values)//dims,'type':'VEC'+str(dims)})
        return len(accessors)-1
    shape=attribute([0,0,0,.001,.02,0,-.001,.02,0],3)
    attrs={'TRANSLATION':attribute([v for x in xs for v in [x,0,0]],3),
           'ROTATION':attribute([v for x in xs for v in [0,0,0,1]],4),
           'SCALE':attribute([v for x in xs for v in [1,1,1]],3),
           '_COLOR_0':attribute([v for x in xs for v in [.1,.2,.05]],3)}
    stats={'seed':1,'fieldTufts':2,'tufts':len(xs),'blades':len(xs),'drawCalls':1,'nearBlades':len(xs),'middleBlades':0,'farBlades':0}
    doc={'asset':{'version':'2.0'},'buffers':[{'byteLength':len(blob)}],'bufferViews':views,'accessors':accessors,'materials':[{'doubleSided':True}],
         'meshes':[{'primitives':[{'attributes':{'POSITION':shape},'material':0}]}],
         'nodes':[{'name':'Yungu captured lawn meadow','children':[1],'extras':{'stats':stats}}, {'name':'Turf blades near 1','mesh':0,'extensions':{'EXT_mesh_gpu_instancing':{'attributes':attrs}}}],
         'scenes':[{'nodes':[0]}],'scene':0,'extensionsUsed':['EXT_mesh_gpu_instancing'],'extensionsRequired':['EXT_mesh_gpu_instancing']}
    return doc,bytes(blob)


class SafeMeadowMerge(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.base=self.root/'base.glb';self.light=self.root/'light.glb';self.full=self.root/'full.glb';self.reference=self.root/'reference.glb';self.out=self.root/'out.glb';self.receipt=self.root/'receipt.json'
        for path,xs in [(self.light,[1,2]),(self.full,[1,2]),(self.reference,[1,2])]:
            doc,bits=fixture(xs);path.write_bytes(module.pack(doc,bits))
        doc,bits=fixture([1]);doc['nodes'] += [{'name':'CaptureMeadowStatic','children':[0]}, {'name':'ground sharing old mesh','mesh':0,'translation':[9,8,7]}]
        doc['scenes'][0]['nodes']=[2,3]
        self.base.write_bytes(module.pack(doc,bits))
    def tearDown(self):self.tmp.cleanup()
    def run_merge(self):return module.merge(self.base,self.light,self.full,self.reference,self.out,self.receipt)
    def test_more_lod_roots_replace_stats_without_mutating_shared_geometry(self):
        old,bits=module.unpack(self.base);r=self.run_merge();new,newbits=module.unpack(self.out)
        self.assertEqual(r['previousDistanceTufts'],1);self.assertEqual(r['currentDistanceTufts'],2)
        self.assertEqual(new['nodes'][0]['extras']['stats']['tufts'],2)
        self.assertEqual(old['nodes'][3],new['nodes'][3]);self.assertEqual(old['meshes'][0],new['meshes'][0])
        self.assertEqual(newbits[:len(bits)],bits);self.assertNotEqual(new['nodes'][1]['mesh'],0)
        self.assertEqual(old['scenes'],new['scenes'])
    def test_any_full_root_move_is_rejected(self):
        d,b=fixture([1,3]);self.full.write_bytes(module.pack(d,b))
        with self.assertRaisesRegex(ValueError,'Full planting'):self.run_merge()
        self.assertFalse(self.out.exists())
    def test_unknown_distance_root_is_rejected(self):
        d,b=fixture([1,3]);self.light.write_bytes(module.pack(d,b))
        with self.assertRaisesRegex(ValueError,'unknown root'):self.run_merge()
    def test_shared_node_and_misreported_stats_are_rejected(self):
        original=self.base.read_bytes();d,b=module.unpack(self.base);d['nodes'][3]['children']=[1];self.base.write_bytes(module.pack(d,b))
        with self.assertRaisesRegex(ValueError,'shared'):self.run_merge()
        self.base.write_bytes(original);d,b=module.unpack(self.light);d['nodes'][0]['extras']['stats']['tufts']=20;self.light.write_bytes(module.pack(d,b))
        with self.assertRaisesRegex(ValueError,'summary'):self.run_merge()
    def test_replacing_an_input_file_is_forbidden(self):
        self.out=self.base
        with self.assertRaisesRegex(ValueError,'distinct'):self.run_merge()


if __name__=='__main__':unittest.main()
