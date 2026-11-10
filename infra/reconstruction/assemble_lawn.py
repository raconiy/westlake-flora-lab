"""Combine rooted tree scene, two ground fixtures and instanced turf without flattening nodes.
Usage: python3 assemble_lawn.py trees.glb fixtures.glb meadow.glb result.glb
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

def unpack(path):
    data=Path(path).read_bytes()
    magic,version,length,js,kind=struct.unpack_from('<4sIIII',data)
    assert magic==b'glTF' and version==2 and kind==0x4e4f534a and length==len(data)
    doc=json.loads(data[20:20+js])
    return doc,bytearray(data[28+js:28+js+doc['buffers'][0]['byteLength']])
def align(data):
    data+=bytes((-len(data))%4)
def append(base, blob, path, group):
    addon,bits=unpack(path)
    assert len(addon['buffers'])==1 and not addon.get('animations') and not addon.get('skins')
    named=['bufferViews','accessors','materials','images','textures','samplers','meshes','nodes']
    off={k:len(base.setdefault(k,[])) for k in named}
    align(blob)
    for v in addon['bufferViews']:
        assert v['buffer']==0 and not v.get('extensions')
        v['byteOffset']=v.get('byteOffset',0)+len(blob)
    blob+=bits
    for a in addon['accessors']:
        a['bufferView']+=off['bufferViews']
        assert 'sparse' not in a
    for im in addon.get('images',[]):im['bufferView']+=off['bufferViews']
    for tex in addon.get('textures',[]):
        tex['source']+=off['images']
        if 'sampler' in tex:tex['sampler']+=off['samplers']
    def rebase_textures(obj):
        for k,v in obj.items():
            if k.endswith('Texture') and isinstance(v,dict) and 'index' in v:v['index']+=off['textures']
            elif isinstance(v,dict):rebase_textures(v)
    for mat in addon.get('materials',[]):rebase_textures(mat)
    for m in addon['meshes']:
        for p in m['primitives']:
            for a in p['attributes']:p['attributes'][a]+=off['accessors']
            if 'indices'in p:p['indices']+=off['accessors']
            if 'material'in p:p['material']+=off['materials']
    for n in addon['nodes']:
        if 'mesh' in n:n['mesh']+=off['meshes']
        if 'children' in n:n['children']=[i+off['nodes'] for i in n['children']]
        attrs=n.get('extensions',{}).get('EXT_mesh_gpu_instancing',{}).get('attributes',{})
        for k in attrs:attrs[k]+=off['accessors']
    for k in named:base[k].extend(addon.get(k,[]))
    root={'name':group,'children':[n+off['nodes'] for n in addon['scenes'][addon.get('scene',0)]['nodes']]}
    base['scenes'][base.get('scene',0)]['nodes'].append(len(base['nodes']))
    base['nodes'].append(root)
    for k in ['extensionsUsed','extensionsRequired']:
        if addon.get(k):base[k]=list(dict.fromkeys(base.get(k,[])+addon[k]))
doc,blob=unpack(sys.argv[1])
append(doc,blob,sys.argv[2],'CapturedGroundFixtures')
append(doc,blob,sys.argv[3],'CaptureMeadowStatic')
align(blob);doc['buffers'][0]['byteLength']=len(blob)
doc['asset'].setdefault('extras',{}).update({'captureRevision':3,'treeSourceSha256':hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest(),'crownModel':'Individually anchored solid leaf blades and connected shoot geometry on the three near trees. Hidden branches and scale are estimates.','lawn':'Static instances for GLB clients. The Yungu viewer substitutes distance-dependent turf from the same deterministic layout.'})
js=json.dumps(doc,ensure_ascii=False,separators=(',',':')).encode();js+=b' '*(-len(js)%4)
out=struct.pack('<4sIIII',b'glTF',2,28+len(js)+len(blob),len(js),0x4e4f534a)+js+struct.pack('<II',len(blob),0x004e4942)+blob
Path(sys.argv[4]).write_bytes(out)
