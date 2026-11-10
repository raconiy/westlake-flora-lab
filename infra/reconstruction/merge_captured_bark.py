"""Insert the source-precision trunk and its new unique image into an existing GLB."""
import copy,json,sys
from pathlib import Path
from restore_luminaire_glb import read_glb,write_glb
base,part,dest=map(Path,sys.argv[1:])
d,b=read_glb(base);s,c=read_glb(part)
b.extend(b'\0'*(-len(b)%4));offset=len(b);b.extend(c)
views,accessors=len(d['bufferViews']),len(d['accessors'])
samplers,images,textures,materials=[len(d.get(k,[])) for k in ['samplers','images','textures','materials']]
for v in s['bufferViews']:
 assert v['buffer']==0 and not v.get('extensions')
 d['bufferViews'].append({**v,'byteOffset':v.get('byteOffset',0)+offset})
for a in s['accessors']:d['accessors'].append({**a,'bufferView':a['bufferView']+views})
d.setdefault('samplers',[]).extend(s.get('samplers',[]))
d.setdefault('images',[]).extend({**i,'bufferView':i['bufferView']+views} for i in s.get('images',[]))
d.setdefault('textures',[]).extend({**t,'source':t['source']+images,'sampler':t.get('sampler',0)+samplers} for t in s.get('textures',[]))
for mat in s['materials']:
 pbr=mat.get('pbrMetallicRoughness',{})
 for holder,key in [(pbr,'baseColorTexture'),(pbr,'metallicRoughnessTexture'),(mat,'normalTexture'),(mat,'occlusionTexture'),(mat,'emissiveTexture')]:
  if key in holder:holder[key]['index']+=textures
 d['materials'].append(mat)
obj=next(n for n in s['nodes'] if n.get('name')=='tree.foreground.trunk')
assert 'mesh' in obj and all(k not in obj for k in ['matrix','rotation','scale','translation'])
mesh=copy.deepcopy(s['meshes'][obj['mesh']])
for p in mesh['primitives']:
 p['attributes']={k:v+accessors for k,v in p['attributes'].items()}
 p['indices']+=accessors;p['material']+=materials
root=next(n for n in d['nodes'] if n.get('name')=='tree.foreground.trunk')
assert len(root['children'])==1
node=d['nodes'][root['children'][0]]
d['meshes'][node['mesh']]=mesh
for k in ['matrix','scale','translation','rotation']:node.pop(k,None)
for ext in s.get('extensionsUsed',[]):
 if ext not in d.setdefault('extensionsUsed',[]):d['extensionsUsed'].append(ext)
d['asset'].setdefault('extras',{})['foregroundBark']='Camera 01 sampled surface; upper and rear estimated'
write_glb(dest,d,b)
print(dest.name)
