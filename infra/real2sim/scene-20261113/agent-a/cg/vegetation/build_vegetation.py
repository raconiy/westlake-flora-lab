"""Deterministic editable campus trees: continuous tapered branch tubes and small folded leaves."""
import math,os,random,struct,zlib
import bpy
from mathutils import Vector
_ROOT_DIR=os.path.dirname(os.path.abspath(__file__))
_BARK_TEXTURE=os.path.join(_ROOT_DIR,"bark_microdetail.png")
def _png_gray(path, size=128, seed=24017):
    """Write a tiny deterministic bark-value texture without external packages."""
    if os.path.exists(path):
        return
    rng = random.Random(seed)
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            # Broad vertical streaks plus fine grain, encoded as RGB.
            streak = 12.0 * math.sin((x * 0.27) + math.sin(y * 0.07))
            value = int(max(24, min(235, 128 + streak + rng.uniform(-32, 32))))
            row.extend((value, value, value))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    payload = b"\x89PNG\r\n\x1a\n"
    payload += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    payload += chunk(b"IDAT", zlib.compress(raw, 9))
    payload += chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(payload)



def _materials():
    _png_gray(_BARK_TEXTURE)
    bark=bpy.data.materials.new("veg_refined_bark");bark.use_nodes=True
    n=bark.node_tree.nodes;l=bark.node_tree.links;s=n.get("Principled BSDF")
    s.inputs["Base Color"].default_value=(.19,.17,.13,1);s.inputs["Roughness"].default_value=.88
    tex=n.new("ShaderNodeTexImage");tex.image=bpy.data.images.load(_BARK_TEXTURE,check_existing=True);tex.image.pack()
    bump=n.new("ShaderNodeBump");bump.inputs["Strength"].default_value=.22;bump.inputs["Distance"].default_value=.018
    l.new(tex.outputs["Color"],bump.inputs["Height"]);l.new(bump.outputs["Normal"],s.inputs["Normal"])
    greens=[(.035,.105,.022),(.055,.16,.026),(.085,.21,.032),(.11,.255,.045),(.15,.29,.055),(.19,.32,.075)]
    autumn=[(.23,.07,.025),(.34,.115,.032),(.43,.20,.045),(.30,.19,.035),(.18,.12,.025),(.40,.08,.03)]
    palettes=[]
    for kind,colors in (("green",greens),("autumn",autumn)):
        group=[]
        for i,c in enumerate(colors):
            mat=bpy.data.materials.new("veg_refined_"+kind+"_"+str(i));mat.use_nodes=True
            n=mat.node_tree.nodes;l=mat.node_tree.links;s=n.get("Principled BSDF")
            s.inputs["Roughness"].default_value=.6
            s.inputs["Base Color"].default_value=(*c,1)
            s.inputs["Alpha"].default_value=1.0
            mat.diffuse_color=(*c,1)
            s.inputs["Transmission Weight"].default_value=.08
            geo=n.new("ShaderNodeNewGeometry");mix=n.new("ShaderNodeMixRGB")
            mix.blend_type='MIX';mix.inputs[1].default_value=(*c,1)
            mix.inputs[2].default_value=(*(min(.48,v*1.25+.025) for v in c),1)
            l.new(geo.outputs["Backfacing"],mix.inputs[0]);l.new(mix.outputs[0],s.inputs["Base Color"])
            group.append(mat)
        palettes.append(group)
    return {"bark":bark,"green":palettes[0],"autumn":palettes[1]}

def _mesh(name,vs,fs,uvs,mats,indices=None,smooth=False):
    mesh=bpy.data.meshes.new(name+"_mesh");mesh.from_pydata(vs,[],fs);mesh.update()
    ob=bpy.data.objects.new(name,mesh)
    if indices is not None:
        # Six biological shades live in vertex colors: one foliage material/draw primitive.
        palette=[tuple(mat.diffuse_color) for mat in mats]
        color=mesh.color_attributes.new(name="LeafColor",type="BYTE_COLOR",domain="CORNER")
        for poly in mesh.polygons:
            for li in poly.loop_indices:color.data[li].color=palette[indices[poly.index]]
        mat=bpy.data.materials.get("veg_refined_vertex_leaves")
        if mat is None:
            mat=bpy.data.materials.new("veg_refined_vertex_leaves");mat.use_nodes=True
            mat.diffuse_color=(1,1,1,1)
            n=mat.node_tree.nodes;l=mat.node_tree.links;shader=n.get("Principled BSDF")
            shader.inputs["Base Color"].default_value=(1,1,1,1)
            shader.inputs["Alpha"].default_value=1.
            shader.inputs["Roughness"].default_value=.6
            shader.inputs["Transmission Weight"].default_value=.08
            vertex=n.new("ShaderNodeVertexColor");vertex.layer_name="LeafColor"
            l.new(vertex.outputs["Color"],shader.inputs["Base Color"])
        mesh.materials.append(mat)
    else:
        for mat in mats:mesh.materials.append(mat)
    for p in mesh.polygons:p.use_smooth=smooth
    layer=mesh.uv_layers.new(name="UVMap")
    for loop in mesh.loops:layer.data[loop.index].uv=uvs[loop.vertex_index]
    bpy.context.collection.objects.link(ob)
    return ob

def _curve_tube(vs,fs,uvs,path,radii,sides):
    """A single connected ring strip per curved branch; no stacked cylinder seams."""
    start=len(vs);previous_u=None;arc=0
    for k,p in enumerate(path):
        tangent=(path[min(k+1,len(path)-1)]-path[max(0,k-1)]).normalized()
        if previous_u is None:
            helper=Vector((1,0,0)) if abs(tangent.z)>.85 else Vector((0,0,1))
            u=tangent.cross(helper).normalized()
        else:
            u=(previous_u-tangent*previous_u.dot(tangent)).normalized()
        v=tangent.cross(u).normalized();previous_u=u
        if k:arc+=(p-path[k-1]).length
        for j in range(sides+1):
            a=j*math.tau/sides
            vs.append(tuple(p+radii[k]*(math.cos(a)*u+math.sin(a)*v)));uvs.append((j/sides,arc))
        if k:
            old=start+(k-1)*(sides+1);now=start+k*(sides+1)
            for j in range(sides):fs.append((old+j,old+j+1,now+j+1,now+j))
    # Fine terminal ring closes to its actual center, never a thick flat-topped pole.
    apex=len(vs);vs.append(tuple(path[-1]));uvs.append((.5,arc))
    end=start+(len(path)-1)*(sides+1)
    for j in range(sides):fs.append((end+j,end+j+1,apex))

def _leaf(vs,fs,uvs,mi,anchor,axis,length,width,rng,material):
    axis=axis.normalized()
    normal=Vector((rng.uniform(-.45,.45),rng.uniform(-.45,.45),rng.uniform(.55,1))).normalized()
    side=normal.cross(axis).normalized();normal=axis.cross(side).normalized()
    base=len(vs)
    # Lanceolate diamond, gently folded midrib: 4 triangles, no rectangular/pyramidal cards.
    points=[anchor,anchor+axis*(length*.44)-side*(width*.5),
            anchor+axis*length,anchor+axis*(length*.44)+side*(width*.5),
            anchor+axis*(length*.46)+normal*(length*.022)]
    vs.extend(tuple(p) for p in points)
    uvs.extend([(.5,0),(0,.44),(.5,1),(1,.44),(.5,.46)])
    fs.extend([(base,base+1,base+4),(base+1,base+2,base+4),(base+2,base+3,base+4),(base+3,base,base+4)])
    mi.extend([material]*4)

def _geometry(rng,height,radius,shrub=False,dense=True):
    tv,tf,tu,lv,lf,lu,lm=[],[],[],[],[],[],[]
    terminal=[];branch_count=0
    def branch(start,direction,length,rad,depth):
        nonlocal branch_count
        branch_count+=1
        direction=direction.normalized()
        bend=Vector((rng.uniform(-.25,.25),rng.uniform(-.25,.25),rng.uniform(.08,.28)))*length
        steps=7 if depth==0 else 5
        path=[];radii=[]
        for j in range(steps+1):
            t=j/steps
            p=start+direction*(length*t)+bend*(math.sin(math.pi*t*.5)**2)
            path.append(p);radii.append(max(.0007,rad*(1-t)**1.12))
        _curve_tube(tv,tf,tu,path,radii,8 if depth==0 else (6 if depth==1 else 4))
        if depth==2:
            terminal.append((path,direction))
            return
        count=5 if depth==0 else 4
        az=math.atan2(direction.y,direction.x)
        for k in range(count):
            # Child attaches inside its parent's continuously tapered surface.
            fraction=.33+.55*(k+.25)/count
            ix=min(len(path)-2,int(fraction*steps));u=fraction*steps-ix
            anchor=path[ix].lerp(path[ix+1],u)
            phi=az+(k%2*2-1)*rng.uniform(.38,1.2)+rng.uniform(-.18,.18)
            outgoing=Vector((math.cos(phi),math.sin(phi),rng.uniform(.2,.8)))
            outgoing=(outgoing.normalized()*.67+direction*.33).normalized()
            childlen=length*rng.uniform(.48,.68)
            childrad=max(.0025,rad*(1-fraction)**1.12*.66)
            branch(anchor,outgoing,childlen,childrad,depth+1)
    if shrub:
        for i in range(5):
            a=i*math.tau/5+rng.uniform(-.2,.2)
            branch(Vector((0,0,.03)),Vector((math.cos(a)*.5,math.sin(a)*.5,1)),height*.65,.035,1)
    else:
        # One bole remains clear below 3m, then bends and tapers continuously to a fine leader.
        lean=Vector((rng.uniform(-.32,.32),rng.uniform(-.32,.32),0))
        path=[];radii=[];base_radius=.19+height*.005
        for j in range(25):
            t=j/24
            path.append(Vector((lean.x*t+math.sin(t*4)*.06,lean.y*t+math.sin(t*3)*.08,height*.92*t)))
            radii.append(max(.0007,base_radius*(1-t)**1.25))
        _curve_tube(tv,tf,tu,path,radii,12);branch_count+=1
        for i in range(7):
            az=i*2.399963+rng.uniform(-.35,.35)
            attach_z=3.0+(height*.70-3.0)*(i+.2)/7
            t=attach_z/(height*.92);ix=int(t*24);u=t*24-ix
            anchor=path[ix].lerp(path[ix+1],u)
            spread=1.05-.36*(i/7)
            direction=Vector((math.cos(az)*spread,math.sin(az)*spread,rng.uniform(.65,1.05)))
            length=(radius*.60+height*.055)*rng.uniform(.86,1.12)
            rad=base_radius*(1-t)**1.25*rng.uniform(.55,.7)
            branch(anchor,direction,length,rad,0)
    count=(rng.randint(22800,25200) if dense else rng.randint(7800,8800)) if not shrub else rng.randint(1250,1650)
    per=count//len(terminal);extra=count%len(terminal)
    for shoot,(path,direction) in enumerate(terminal):
        leafnum=per+(shoot<extra)
        sprays=[]
        for j in range(6):
            t=.48+j*.085;f=t*(len(path)-1);ix=min(len(path)-2,int(f))
            anchor=path[ix].lerp(path[ix+1],f-ix)
            a=j*2.399963+rng.uniform(-.5,.5)
            spraydir=(Vector((math.cos(a),math.sin(a),rng.uniform(-.15,.6)))+direction*.35).normalized()
            end=anchor+spraydir*rng.uniform(.22,.44)
            middle=anchor.lerp(end,.5)+Vector((0,0,.025))
            _curve_tube(tv,tf,tu,[anchor,middle,end],[.0028,.0015,.0004],3)
            sprays.append((anchor,middle,end,spraydir));branch_count+=1
        for k in range(leafnum):
            a,b,c,direction=sprays[k%6]
            t=rng.uniform(.12,1.0);anchor=a.lerp(c,t)+Vector((0,0,math.sin(t*math.pi)*.025))
            angle=k*2.399963+rng.uniform(-.4,.4)
            axis=Vector((math.cos(angle),math.sin(angle),rng.uniform(-.25,.55))).normalized()
            length=rng.uniform(.14,.18) if not shrub and dense else (rng.uniform(.10,.18) if not shrub else rng.uniform(.07,.12))
            anchor+=axis*rng.uniform(.008,.03)
            _leaf(lv,lf,lu,lm,anchor,axis,length,length*rng.uniform(.55,.68),rng,rng.choices(range(6),[1,3,5,5,2,1])[0])
    if not shrub:
        # Preserve the 3m clear bole while bounding an irregular compact upper crown.
        maxz=max(v[2] for v in tv+lv)
        maxr=max(math.hypot(v[0],v[1]) for v in tv+lv)
        xy_scale=min(1.0,(min(2.91,radius*.94) if dense else radius*.77)/maxr)
        z_scale=(height-3.0)/max(.1,maxz-3.0)
        def bound(v):
            x,y,z=v
            blend=min(1.,max(0.,(z-2.7)/1.4))
            k=1+(xy_scale-1)*blend
            return (x*k,y*k,3.+(z-3.)*z_scale if z>3. else z)
        tv=[bound(v) for v in tv]
        # Move blades with the compacted crown without shrinking their physical size.
        adjusted=[]
        for i in range(0,len(lv),5):
            anchor=Vector(lv[i]);moved=Vector(bound(lv[i]))
            adjusted.extend(tuple(moved+Vector(v)-anchor) for v in lv[i:i+5])
        lv=adjusted
        actual_top=max(v[2] for v in tv+lv)
        normalization=(height-3.0)/(actual_top-3.0)
        def final_height(v):return (v[0],v[1],3.+(v[2]-3.)*normalization if v[2]>3. else v[2])
        tv=[final_height(v) for v in tv];lv=[final_height(v) for v in lv]
    return (tv,tf,tu,lv,lf,lu,lm,count,branch_count)

def _plant(name,position,height,radius,seed,mats,autumn=False,shrub=False):
    rng=random.Random(seed);root=bpy.data.objects.new(name,None);root.location=position
    bpy.context.collection.objects.link(root)
    root["asset_id"]=name.lower().replace(" ","_");root["category"]="vegetation_shrub" if shrub else "vegetation_tree"
    root["seed"]=seed;root["height_m_est"]=height
    root["species_hint"]="campus deciduous broadleaf / camphor-like crown"
    tv,tf,tu,lv,lf,lu,lm,count,branches=_geometry(rng,height,radius,shrub,dense=not autumn)
    trunk=_mesh(name+("_stems" if shrub else "_trunk_branches"),tv,tf,tu,[mats["bark"]],smooth=True)
    leaves=_mesh(name+("_foliage" if shrub else "_leaf_clusters"),lv,lf,lu,mats["autumn" if autumn else "green"],lm)
    trunk.parent=root;leaves.parent=root
    root["leaf_count_est"]=count;root["branch_count"]=branches;root["leaf_length_range_m"]="0.07-0.12" if shrub else "0.10-0.18"
    root["clear_bole_height_m"]=0.0 if shrub else 3.0
    root["triangle_count"]=sum(max(0,len(p.vertices)-2) for ob in (trunk,leaves) for p in ob.data.polygons)
    root["procedural_source"]="build_vegetation.py";root["appearance_pass"]=2
    return root

def _tree_root(name,position,height,radius,seed,mats,autumn=False):
    return _plant(name,position,height,radius,seed,mats,autumn,False)

def _shrub_root(name,position,seed,mats,autumn=False):
    return _plant(name,position,1.15,.65,seed,mats,autumn,True)

def build():
    """Create campus perimeter trees and shrubs; return independent parent Empties."""
    mats = _materials()
    plants = []
    tree_specs = [
        ((-22, -7, 0), 10.4, 4.0), ((-17, 10, 0), 9.4, 3.6), ((-7, 15, 0), 10.8, 4.1),
        ((8, 14, 0), 9.8, 3.5), ((21, 9, 0), 11.0, 4.2), ((23, -8, 0), 9.2, 3.4),
        ((8, -13, 0), 8.8, 3.2), ((-6, -12, 0), 10.1, 3.7), ((-25, 5, 0), 9.0, 3.4),
        ((17, -13, 0), 8.6, 3.1),
    ]
    for i, (pos, height, radius) in enumerate(tree_specs):
        plants.append(_tree_root("Tree_%02d" % (i + 1), pos, height, radius, 8100 + i * 97, mats, autumn=False))
    red_specs = [((-15, 22, 0), 7.0, 2.6), ((-6, 23, 0), 6.6, 2.4), ((8, 24, 0), 7.4, 2.8), ((18, 23, 0), 6.8, 2.5)]
    for i, (pos, height, radius) in enumerate(red_specs):
        plants.append(_tree_root("AutumnTree_%02d" % (i + 1), pos, height, radius, 9200 + i * 131, mats, autumn=True))
    shrub_specs = [((-24, -1, 0), False), ((-20, 16, 0), False), ((25, 2, 0), False), ((14, -17, 0), False), ((-3, 19, 0), True), ((4, -19, 0), False)]
    for i, (pos, autumn) in enumerate(shrub_specs):
        plants.append(_shrub_root("Shrub_%02d" % (i + 1), pos, 11000 + i * 41, mats, autumn=autumn))
    return plants
