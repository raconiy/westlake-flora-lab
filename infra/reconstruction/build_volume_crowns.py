"""Fit connected leafy shoots to observed Yungu crowns in the released v2 Blender file.
Run with Blender 4.5, passing the v2 assets directory and crown-stereo.bin after --.
Input tree species and angles hidden from all cameras are unresolved.
"""
from pathlib import Path
import json
import math
import os
import sys
import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

assets_path, stereo_path, output_path = map(Path, sys.argv[sys.argv.index('--') + 1:][:3])
surfaces = np.load(assets_path / 'crown-surfaces.npz')
points = np.fromfile(stereo_path, dtype=[('p','<f4',(3,)),('rgb','u1',(3,)),('tree','u1')])
output_path.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
scene.frame_set(1)
up = np.array([0.,0.,1.])
variants = (
    ('foreground','tree.foreground.forked',1,17,14,.130,.47,1.4),
    ('middle','tree.mid-fork',2,29,19,.102,.53,2.0),
    ('left','tree.left-spreading',3,43,12,.133,.40,1.7),
)
report = {}
def norm(v):
    return v / max(np.linalg.norm(v),1e-8)
def to_blender(p):
    return p[..., [0,2,1]] * np.array([1.,-1.,1.])
def make_material(name, color, rough):
    mat=bpy.data.materials.new(name)
    mat.use_nodes=True
    mat.diffuse_color=(*color,1.)
    node=mat.node_tree.nodes['Principled BSDF']
    node.inputs['Base Color'].default_value=(*color,1.)
    node.inputs['Roughness'].default_value=rough
    return mat
def linear(c):
    return np.where(c < .04045, c/12.92, ((c+.055)/1.055)**2.4)
leaf_material = make_material('Living broadleaf blades',(.17,.23,.055),.64)
nt=leaf_material.node_tree
col=nt.nodes.new('ShaderNodeVertexColor')
col.layer_name='Blade pigments'
nt.links.new(col.outputs['Color'],nt.nodes['Principled BSDF'].inputs['Base Color'])
twig_material = make_material('Branchlets and petioles',tuple(linear(np.array([.34,.31,.19]))),.84)
def mesh(name, vertices, faces, material, parent, colors=None):
    data=bpy.data.meshes.new(name)
    data.from_pydata(vertices,[],faces)
    data.materials.append(material)
    if colors is not None:
        a=data.color_attributes.new(name='Blade pigments',type='BYTE_COLOR',domain='POINT')
        data.color_attributes.active_color=a
        a.data.foreach_set('color_srgb',np.column_stack([colors,np.ones(len(colors))]).astype('f').ravel())
    else:
        data.polygons.foreach_set('use_smooth',np.full(len(data.polygons),True))
    data.update()
    ob=bpy.data.objects.new(name,data)
    scene.collection.objects.link(ob)
    ob.parent=parent
    return ob
def scaffold_path(j):
    # Original tube rings contain a duplicated UV seam vertex. Average only unique ring vertices.
    ob=next(c for c in j.children if '.wood.' in c.name)
    p=np.array([list(v.co) for v in ob.data.vertices])
    ends=np.flatnonzero(np.linalg.norm(p[1:]-p[0],axis=1)<1e-5)
    if len(ends)==0:
        raise ValueError(f'{ob.name}: missing authored bark seam')
    ring=int(ends[0]+2)
    if len(p)%ring:raise ValueError(f'{ob.name}: incomplete bark ring')
    return p.reshape(-1,ring,3)[:,:-1].mean(axis=1)
def shoot_targets(v, rng):
    key, name, label, seed, nleaves, leaf_len, width, back_depth=v
    proposal=[]
    for view in ('01','06','13'):
        sample=to_blender(surfaces[key+'_'+view+'_xyz'].mean(axis=1))
        proposal.extend(sample)
    proposal=np.array(proposal)
    support=to_blender(points['p'][points['tree']==label])
    # Use contributions per occupied voxel, so a dense camera direction cannot
    # make a second copy of the same crown. Stereo samples contribute off-plane support.
    select=np.vstack((proposal,support))
    rng.shuffle(select)
    _,indices=np.unique(np.floor(select/.22).astype(int),axis=0,return_index=True)
    outer=select[indices]
    eye=np.array(scene.camera.matrix_world.translation)
    ray=outer-eye
    ray/=np.maximum(1e-5,np.linalg.norm(ray,axis=1,keepdims=True))
    # Where the back was occluded, infer a bounded layer behind the photographed envelope.
    # The lateral spread seen in the registered views constrains a bounded rear lobe.
    # Fill its interior along actual sight lines, with a softer edge on the spread tree.
    width_xy=np.percentile(outer[:,0],95)-np.percentile(outer[:,0],5)
    depth_limit=min(4.2,max(back_depth,width_xy*(.68 if label==2 else .48)))
    back=outer+ray*(rng.uniform(.3,depth_limit,len(outer))[:,None])+rng.normal(0.,.09,outer.shape)
    targets=[outer,back]
    # A photo cut is an observation boundary. Continue only clipped crown margins,
    # tapering them into lobes above the image or to the side.
    for view in ('01','13'):
        xyz=to_blender(surfaces[key+'_'+view+'_xyz'].mean(axis=1))
        uv=surfaces[key+'_'+view+'_uv'].mean(axis=1)
        cropped=xyz[uv[:,1]>.968]
        if len(cropped)>5:
            center=np.median(cropped,axis=0)
            for layer in range(4):
                t=(layer+rng.uniform(.16,.96,len(cropped)))/4
                heights=(2.4+.72*np.sin(cropped[:,0]*1.4)+.48*np.cos(cropped[:,1]*1.8))
                new=cropped.copy();new[:,:2]+=(center[:2]-new[:,:2])*(t**1.45*.52)[:,None]
                new[:,2]+=heights*t
                new+=rng.normal(0.,.12,new.shape)
                targets.extend([new,new+norm(np.mean(ray,axis=0))*rng.uniform(.3,depth_limit,len(new))[:,None]])
        if key=='left' and view=='01':
            edge=xyz[uv[:,0]<.035]
            if len(edge)>2:
                for layer in range(3):
                    t=rng.uniform(.1,1.,len(edge))
                    new=edge.copy();new[:,0]-=t*(1.3+.5*np.cos(edge[:,2]*1.8))
                    new[:,2]+=(np.median(edge[:,2])-edge[:,2])*t*.28
                    targets.append(new+rng.normal(0.,.08,new.shape))
    targets=np.vstack(targets)
    return targets,support
def foliage_color(rgb, label, position, rng):
    val=rgb.astype(float)/255.
    hue=val/max(.025,val.max())
    local=np.sin(position[0]*1.45+position[2]*1.1)+.6*np.cos(position[1]*2.5-position[2])
    warmth=np.clip(((hue[0]/max(.1,hue[1])-.77)*1.7)+(.14*local),0.,1.)
    mix=np.clip(warmth*(.98 if label==1 else .28 if label==2 else .65)
                +(.20 if label==1 else .015 if label==2 else .08),0.,1.)
    green=np.array([.29,.46,.175]) if label!=2 else np.array([.245,.355,.17])
    gold=np.array([.81,.67,.22])
    tone=(green*(1-mix)+gold*mix)*(.86+.18*hue)
    return np.clip(tone*rng.uniform(.83,1.16),.035,.91)
def ground_collar(tree):
    trunk=next(c for c in tree.children if c.type=='MESH' and '.trunk' in c.name)
    p=np.array([list(v.co) for v in trunk.data.vertices])
    ring=int(np.flatnonzero(np.linalg.norm(p[1:]-p[0],axis=1)<1e-5)[0]+2)
    rings=p.reshape(-1,ring,3)
    centers=rings[:,:-1].mean(axis=1)
    # Authored lower rings can be tilted across grade. Preserve trunk position and
    # grain seam, replacing the first few rest cross sections in horizontal planes.
    for i,q in enumerate(rings):
        z=centers[i,2]
        if z>.44:break
        offset=q[:,:2]-centers[i,:2]
        lens=np.linalg.norm(offset,axis=1,keepdims=True)
        fac=1.-np.clip(z/.44,0.,1.)
        radius=tree['stem_radius_prior']*(1.+.34*fac**1.7)
        theta=np.arctan2(offset[:,1],offset[:,0])
        radius=radius*(1+.045*fac*np.sin(5*theta+.41))
        q[:,:2]=centers[i,:2]+offset/np.maximum(lens,.001)*radius[:,None]
        q[:,2]=(-.045 if i==0 else z)
    trunk.data.vertices.foreach_set('co',p.astype('f').ravel())
    trunk.data.update()
def build_tree(variant):
    key,name,label,seed,nleaves,leaf_len,width,back_depth=variant
    rng=np.random.default_rng(seed)
    tr=bpy.data.objects[name]
    ground_collar(tr)
    joints=[j for j in tr.children if j.get('wind_joint')]
    removed=0
    for j in joints:
        for ob in list(j.children):
            if any(part in ob.name for part in ('.visible-crown.','.inner-shoots.','.inner-leaves.')):
                bpy.data.objects.remove(ob,do_unlink=True)
                removed+=1
    targets,support=shoot_targets(variant,rng)
    kd=KDTree(len(support))
    for i,p in enumerate(support):kd.insert(Vector(p),i)
    kd.balance()
    colors=points['rgb'][points['tree']==label]
    origins=[np.array(tr.location)+np.array(j.location) for j in joints]
    centerlines=[scaffold_path(j) for j in joints]
    # Separate well-spaced sockets along each persistent woody branch, above the exposed lower bole.
    sockets=[];owners=[]
    for ji,line in enumerate(centerlines):
        for k in np.unique(np.linspace(int(.42*(len(line)-1)),len(line)-1,4).astype(int)):
            sockets.append(line[k]+origins[ji]);owners.append(ji)
    sockets=np.array(sockets);assign=np.argmin(((targets[:,None]-sockets[None])**2).sum(-1),axis=1)
    total_leaves=0;total_shoots=0;total_wood=0;extent=0.
    for ji,joint in enumerate(joints):
        wood_v=[];wood_f=[]; stem_ends=[]; stem_r=[];leaf_v=[];leaf_f=[];leaf_c=[]
        origin=origins[ji]
        def wood(a,b,r0,r1):
            if np.linalg.norm(b-a)<.001:return
            stem_ends.append([a,b]);stem_r.append([r0,r1])
        def sprig(start,target,shade):
            d=norm(target-start)
            side=norm(np.cross(d,up))
            bend=side*rng.uniform(-.025,.025)+up*rng.uniform(-.028,.038)
            middle=start+(target-start)*.52+bend
            wood(start,middle,.0031,.0021);wood(middle,target,.0021,.00085)
            # Each leaf begins on a specific side-shoot and has a folded midrib.
            phase=rng.uniform(-.47,.47); own_len=leaf_len*rng.uniform(.8,1.15)
            count=int(rng.integers(max(6,nleaves-4),nleaves+4))
            t=(np.arange(count)+.5)/count
            root=np.where((t<.52)[:,None],start+(middle-start)*(t/.52)[:,None],middle+(target-middle)*((t-.52)/.48)[:,None])
            az=math.atan2(d[1],d[0])+np.where(np.arange(count)%2==0,1,-1)*rng.uniform(.58,1.36,count)+phase
            tilt=rng.uniform(-.70,.53,count)+d[2]*.38
            forward=np.column_stack((np.cos(az),np.sin(az),tilt));forward/=np.linalg.norm(forward,axis=1)[:,None]
            across=np.column_stack((-np.sin(az),np.cos(az),rng.uniform(-.62,.62,count)))
            length=own_len*rng.uniform(.7,1.15,count)*(1.-.22*t)
            half=(length*width*rng.uniform(.38,.54,count))[:,None]
            length=length[:,None]
            mid=root+forward*length*.50
            ridge=mid+up*length*.055
            tip=root+forward*length-up*length*rng.uniform(.035,.12,(count,1))
            vs=np.stack((root,mid-across*half,ridge,mid+across*half,tip),axis=1)
            leaf_v.append(vs.reshape(-1,3))
            leaf_f.extend(range(count))  # one marker per blade for the final shared index pattern
            pigment=np.clip(shade[None]*rng.uniform(.89,1.10,(count,1)),0.,1.)
            leaf_c.append(np.repeat(pigment,5,axis=0))
        def arbor(anchor, group, cap, depth=0):
            if not len(group):return
            if len(group)<=3 or depth>=12:
                for goal in group:
                    pos,idx,dist=kd.find(Vector(goal+origin))
                    shade=foliage_color(colors[idx],label,goal+origin,rng)
                    axis=norm(goal-anchor)
                    elbow=anchor+(goal-anchor)*rng.uniform(.42,.64)+up*rng.uniform(-.035,.04)
                    wood(anchor,elbow,.006,.004);wood(elbow,goal,.004,.0029)
                    # Several leafy shoots arise at distinct axils on the terminal twig.
                    for k in range(3 if label!=2 else 4):
                        t=rng.uniform(.18,.99);base=elbow+(goal-elbow)*t
                        direction=norm(axis*.34+np.array([rng.normal(),rng.normal(),rng.normal(.08,.5)]))
                        sprig(base,base+direction*rng.uniform(.20,.46),shade)
                return
            mean=group.mean(axis=0)
            delta=mean-anchor
            dist=np.linalg.norm(delta)
            elbow=anchor+delta*rng.uniform(.36,.55)+up*min(.09,dist*.044)
            middle=anchor+(elbow-anchor)*.47+np.cross(norm(elbow-anchor),up)*rng.uniform(-.09,.09)*min(1.,dist)
            # Taper with the number of distal shoots and the local mother branch radius.
            r=min(cap,.0031*math.sqrt(len(group))+.005)
            wood(anchor,middle,r,r*.91);wood(middle,elbow,r*.91,r*.80)
            spread=group.max(axis=0)-group.min(axis=0)
            cut=int(spread.argmax());perm=group[np.argsort(group[:,cut])]
            split=int(np.clip(round(len(perm)*rng.uniform(.38,.62)),1,len(perm)-1))
            arbor(elbow,perm[:split],r*.84,depth+1)
            arbor(elbow,perm[split:],r*.84,depth+1)
        for si,owner in enumerate(owners):
            if owner==ji:arbor(sockets[si]-origin,targets[assign==si]-origin,joint['beam_base_radius_m']*.48)
        if not leaf_v:continue
        leaves=len(leaf_f)
        faces=(np.arange(leaves)[:,None,None]*5+np.array([[0,1,2],[0,2,3],[1,4,2],[2,4,3]])).reshape(-1,3)
        leafob=mesh(name+'.volume-leaves.'+str(ji),np.vstack(leaf_v).tolist(),faces.tolist(),leaf_material,joint,np.vstack(leaf_c))
        leafob['physical_blades']=leaves
        leafob['capture_support']='stereo and registered crown envelopes; unseen depth inferred'
        seg=np.array(stem_ends);axis=seg[:,1]-seg[:,0];axis/=np.maximum(1e-6,np.linalg.norm(axis,axis=1)[:,None])
        ref=np.where((np.abs(axis[:,2])<.9)[:,None],up,np.array([1,0,0]))
        right=np.cross(axis,ref);right/=np.linalg.norm(right,axis=1)[:,None];side=np.cross(axis,right)
        theta=np.arange(4)*math.pi*.5
        around=right[:,None]*np.cos(theta)[None,:,None]+side[:,None]*np.sin(theta)[None,:,None]
        rings=seg[:,:,None,:]+np.array(stem_r)[:,:,None,None]*around[:,None,:,:]
        pat=np.array([[i,(i+1)%4,4+(i+1)%4,4+i] for i in range(4)])
        quads=(np.arange(len(seg))[:,None,None]*8+pat).reshape(-1,4)
        woodob=mesh(name+'.volume-branchlets.'+str(ji),rings.reshape(-1,3).tolist(),quads.tolist(),twig_material,joint)
        woodob['connected_wood_segments']=len(seg)
        total_leaves+=leaves;total_wood+=len(seg);total_shoots+=len(leaf_v)
    report[key]={'oldCrownMeshesRemoved':removed,'physicalLeafBlades':total_leaves,'leafyShoots':total_shoots,'connectedWoodSegments':total_wood,'observedStereoPoints':len(support),'windJoints':len(joints),'terminalTargets':len(targets)}
for variant in variants:
    build_tree(variant)
    print('VOLUME',variant[0],report[variant[0]],flush=True)
bpy.data.orphans_purge(do_recursive=True)
scene.camera=bpy.data.objects['Photo 01 registered']
(output_path/'volume-build.json').write_text(json.dumps(report,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(output_path/'yungu-volume.blend'),compress=True)
bpy.ops.export_scene.gltf(filepath=str(output_path/'volume-raw.glb'),export_format='GLB',export_cameras=True,export_extras=True,export_lights=True,export_animations=True,export_yup=True)
