"""Replace the named static-meadow nodes, preserving every non-grass byte/reference.

python merge_static_meadow.py BASE.glb LIGHT.glb FULL.glb OLD_FULL.glb OUT.glb RECEIPT.json
The full attachments prove that root coordinates/orientation/scale/incident color
are unchanged. LIGHT may choose a different subset, never invent a root.
Old binary resources remain as unreachable data to avoid rewriting meshopt trees.
"""
import argparse
import copy
import hashlib
import json
import struct
from pathlib import Path


def unpack(path):
    raw = path.read_bytes()
    magic, version, total, count, kind = struct.unpack_from('<4s4I', raw)
    if (magic, version, total, kind) != (b'glTF', 2, len(raw), 0x4e4f534a):
        raise ValueError('Invalid GLB')
    doc = json.loads(raw[20:20+count])
    length, kind = struct.unpack_from('<II', raw, 20+count)
    if kind != 0x004e4942 or 28+count+length != total:
        raise ValueError('Unexpected binary chunks')
    return doc, raw[28+count:]


def pack(doc, binary):
    binary += bytes(-len(binary) % 4)
    doc['buffers'][0]['byteLength'] = len(binary)
    js = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode()
    js += b' ' * (-len(js) % 4)
    return struct.pack('<4s4I', b'glTF', 2, 28+len(js)+len(binary), len(js), 0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary


def digest(value):
    return hashlib.sha256(value).hexdigest()


def rows(doc, binary, index, dimensions):
    a = doc['accessors'][index]
    v = doc['bufferViews'][a['bufferView']]
    if a['componentType'] != 5126 or a['type'] != 'VEC'+str(dimensions) or a.get('normalized') or a.get('sparse') or v.get('extensions') or v['buffer'] != 0:
        raise ValueError('Expected plain float instance attribute')
    stride = v.get('byteStride',dimensions*4)
    start = v.get('byteOffset',0)+a.get('byteOffset',0)
    end = start + max(0,a['count']-1)*stride+dimensions*4
    if end > v.get('byteOffset',0)+v['byteLength'] or end>len(binary):
        raise ValueError('Accessor exceeds its buffer view')
    return [binary[start+i*stride:start+i*stride+dimensions*4] for i in range(a['count'])]


def instances(doc, binary, allowed=None):
    out = {}
    groups = {}
    for i,n in enumerate(doc['nodes']):
        if allowed is not None and i not in allowed:
            continue
        attrs=n.get('extensions',{}).get('EXT_mesh_gpu_instancing',{}).get('attributes')
        if not attrs:
            continue
        if set(attrs) != {'TRANSLATION','ROTATION','SCALE','_COLOR_0'}:
            raise ValueError('Unexpected instance attributes')
        arrays = [rows(doc,binary,attrs[k],d) for k,d in [('TRANSLATION',3),('ROTATION',4),('SCALE',3),('_COLOR_0',3)]]
        if len({len(a) for a in arrays})!=1:
            raise ValueError('Mismatched instance counts')
        for values in zip(*arrays):
            if values[0] in out:
                raise ValueError('Duplicate planted transform')
            out[values[0]]=b''.join(values[1:])
        groups[n['name']]=len(arrays[0])
    if not out:
        raise ValueError('No instance transforms')
    return out,groups


def subtree(doc, root):
    seen=set()
    def visit(index):
        if index in seen:
            raise ValueError('Shared/cyclic meadow node')
        seen.add(index)
        for child in doc['nodes'][index].get('children',[]):
            visit(child)
    visit(root)
    return seen


def merge(base_path, light_path, full_path, old_full_path, result_path, receipt_path):
    if result_path.resolve() in {p.resolve() for p in [base_path,light_path,full_path,old_full_path]}:
        raise ValueError('Output must be distinct from every input')
    original,bits=unpack(base_path);base=copy.deepcopy(original)
    light,addbits=unpack(light_path);full,fullbits=unpack(full_path);oldfull,oldfullbits=unpack(old_full_path)
    expected,_=instances(full,fullbits);previous,_=instances(oldfull,oldfullbits)
    if expected != previous:
        raise ValueError('Full planting transform or light field changed')
    wrapper, = [i for i,n in enumerate(base['nodes']) if n.get('name')=='CaptureMeadowStatic']
    owned=subtree(base,wrapper)-{wrapper}
    if any(child in owned for i,n in enumerate(base['nodes']) if i not in owned|{wrapper} for child in n.get('children',[])):
        raise ValueError('Meadow child is shared with a non-meadow parent')
    for animation in base.get('animations',[]):
        if any(c['target'].get('node') in owned for c in animation['channels']):
            raise ValueError('Animated meadow replacement unsupported')
    old_light,old_groups=instances(base,bits,owned)
    chosen,new_groups=instances(light,addbits)
    for label,subset in [('old distance',old_light),('new distance',chosen)]:
        if any(expected.get(k)!=v for k,v in subset.items()):
            raise ValueError(label+' representation contains a moved/unknown root, transform or incident field')
    source_roots=light['scenes'][light.get('scene',0)]['nodes']
    if len(source_roots)!=1 or subtree(light,source_roots[0])!=set(range(len(light['nodes']))):
        raise ValueError('Expected one complete meadow tree')
    target_names={base['nodes'][i].get('name'):i for i in owned}
    source_names={n.get('name'):i for i,n in enumerate(light['nodes'])}
    if len(target_names)!=len(owned) or set(target_names)!=set(source_names):
        raise ValueError('Meadow node identities differ')
    if len(light['buffers'])!=1 or any(light.get(k) for k in ['animations','skins','images','textures','samplers','cameras']):
        raise ValueError('Grass addon contains unsupported resources')
    if any(e!='EXT_mesh_gpu_instancing' for e in light.get('extensionsUsed',[])):
        raise ValueError('Unsupported grass extension')
    summary=light['nodes'][source_roots[0]]['extras']['stats']
    if summary['fieldTufts']!=len(expected) or summary['tufts']!=len(chosen) or summary['drawCalls']!=len(new_groups):
        raise ValueError('Light summary differs from actual instance arrays')
    # Appending leaves all compressed geometry/image ranges and fallback-buffer
    # offsets untouched. The old grass resources are unreachable, not rewritten.
    offset=len(bits);newbits=bits+addbits
    offsets={k:len(base.get(k,[])) for k in ['bufferViews','accessors','materials','meshes']}
    for v in copy.deepcopy(light['bufferViews']):
        if v['buffer']!=0 or v.get('extensions'):
            raise ValueError('Compressed addon unsupported')
        v['byteOffset']=offset+v.get('byteOffset',0);base['bufferViews'].append(v)
    for a in copy.deepcopy(light['accessors']):
        if 'sparse' in a:
            raise ValueError('Sparse addon unsupported')
        a['bufferView']+=offsets['bufferViews'];base['accessors'].append(a)
    base['materials'].extend(copy.deepcopy(light.get('materials',[])))
    for mesh in copy.deepcopy(light['meshes']):
        for p in mesh['primitives']:
            if p.get('targets') or p.get('extensions'):
                raise ValueError('Unexpected grass mesh extension/morph')
            p['attributes']={k:v+offsets['accessors'] for k,v in p['attributes'].items()}
            if 'indices' in p:p['indices']+=offsets['accessors']
            if 'material' in p:p['material']+=offsets['materials']
        base['meshes'].append(mesh)
    map_id={i:target_names[n['name']] for i,n in enumerate(light['nodes'])}
    for i,node in enumerate(copy.deepcopy(light['nodes'])):
        if 'mesh' in node:node['mesh']+=offsets['meshes']
        if 'children' in node:node['children']=[map_id[j] for j in node['children']]
        attrs=node.get('extensions',{}).get('EXT_mesh_gpu_instancing',{}).get('attributes',{})
        for k in attrs:attrs[k]+=offsets['accessors']
        base['nodes'][map_id[i]]=node
    base['asset'].setdefault('extras',{})['lawnBladeModel']={
        'basis':'R7 managed fine-turf engineering prior, not campus species/leaf measurement.',
        'meadowAttachmentSha256':digest(light_path.read_bytes()),
        'fullAttachmentSha256':digest(full_path.read_bytes()),
        'geometry':'Arched cut laminae, old basal sockets and complete root distribution preserved.',
        'stats':summary,'staticWind':0}
    # Compare non-meadow objects and every original resource, not just counts.
    for i,n in enumerate(original['nodes']):
        if i not in owned and n!=base['nodes'][i]:raise AssertionError('Non-meadow node mutated')
    for k,count in offsets.items():
        if base[k][:count]!=original.get(k,[]):raise AssertionError('Original resource mutated: '+k)
    for k in set(original)-{'asset','buffers','nodes',*offsets}:
        if base[k]!=original[k]:raise AssertionError('Scene field mutated: '+k)
    if base['buffers'][1:]!=original['buffers'][1:]:raise AssertionError('Fallback buffers changed')
    if newbits[:len(bits)]!=bits:raise AssertionError('Original binary changed')
    out=pack(base,newbits);result_path.write_bytes(out)
    check,checkbits=unpack(result_path)
    measured,_=instances(check,checkbits,owned)
    if measured!=chosen or check['nodes'][map_id[source_roots[0]]]['extras']['stats']!=summary:
        raise AssertionError('Reparsed output differs from supplied grass')
    result={'baseSha256':digest(base_path.read_bytes()),'lightSha256':digest(light_path.read_bytes()),'fullSha256':digest(full_path.read_bytes()),'referenceFullSha256':digest(old_full_path.read_bytes()),'outputSha256':digest(out),'outputBytes':len(out),'unchangedOriginalBinarySha256':digest(bits),'unchangedNonGrassNodes':len(original['nodes'])-len(owned),'unchangedResourceCounts':offsets,'completeRootTransformsUnchanged':len(expected),'previousDistanceTufts':len(old_light),'currentDistanceTufts':len(chosen),'oldGroups':old_groups,'newGroups':new_groups,'stats':summary,'notes':['All original non-grass nodes/resources and BIN bytes retained exactly. Old grass resources are unreachable.','Only meadow subtree descriptors, newly appended grass resources and lawnBladeModel metadata changed.','Full root transforms and stored incident colors exactly match the supplied reference-full asset; only distance LOD subset changed.']}
    receipt_path.write_text(json.dumps(result,indent=2)+'\n')
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser()
    for n in ['base','light','full','reference_full','result','receipt']:p.add_argument(n,type=Path)
    a=p.parse_args()
    print(json.dumps(merge(a.base,a.light,a.full,a.reference_full,a.result,a.receipt)))
