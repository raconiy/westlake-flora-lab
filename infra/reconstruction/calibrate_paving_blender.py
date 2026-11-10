"""Apply the photographed foreground walk to a loaded Blender campus scene.

Run blender -b campus.blend -P calibrate_paving_blender.py -- field.json result.blend receipt.json
"""
import bpy, json, math, sys, hashlib
from pathlib import Path
from mathutils import Vector

def blend_curve(lo, hi, value):
    x=max(0,min(1,(value-lo)/(hi-lo)))
    return x*x*(3-2*x)

def displacement(cfg,t,d,mat):
    warp=cfg['warp']
    u=max(warp['tFitMin'],min(warp['tFitMax'],t))
    a,b,c=warp['jointPolynomial']; center=a+b*u+c*u*u;half=warp['jointHalfWidthM']
    before=warp['sourceD'];after=(warp['outerM'],center-half,center+half,warp['backM'])
    k=0 if d<=before[1] else 1 if d<=before[2] else 2
    r=(d-before[k])/(before[k+1]-before[k])
    shift=after[k]+r*(after[k+1]-after[k])-d if 0<=r<=1 else 0
    ta,tb,tc,td=cfg['taperM'];w=blend_curve(ta,tb,t)*(1-blend_curve(tc,td,t))
    delta=0 if d<=before[0]+.06 else w*shift
    if abs(d-cfg['jointSeal']['oldJointCenter'])<.062:
        if mat=='Granite.VergeCourse':delta=min(delta,(center-half-d)*w)
        if mat=='Granite.PhotoAlbedo':delta=max(delta,(center+half-d)*w)
    return delta,w,center

def with_receiver(mat,attribute,texture=None):
    clone=mat.copy();clone.name='NearWalk.'+mat.name+'.Calibrated'
    tree=clone.node_tree;shader=next(n for n in tree.nodes if n.type=='BSDF_PRINCIPLED')
    socket=shader.inputs['Base Color'];original=socket.links[0].from_socket if socket.is_linked else None
    rgba=tuple(socket.default_value)
    if texture:
        source_image=next(n for n in tree.nodes if n.type=='TEX_IMAGE')
        source_image.image=texture
    colors=tree.nodes.new('ShaderNodeVertexColor');colors.layer_name=attribute
    mix=tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
    if original:tree.links.new(original,mix.inputs[1])
    else:mix.inputs[1].default_value=rgba
    tree.links.new(colors.outputs['Color'],mix.inputs[2]);tree.links.new(mix.outputs[0],socket)
    return clone

def main(cfg_path,out,receipt):
    cfg=json.loads(cfg_path.read_text());sc=bpy.context.scene
    if sc.get('near_paving_revision'):raise ValueError('Paving calibration already applied')
    photo=bpy.data.images.load(str(cfg_path.parent/cfg['texture']),check_existing=True)
    photo.colorspace_settings.name='sRGB';photo.pack()
    tx,tz=cfg['tangentXZ'];field='NearWalkReceivedSkylight';stats={}
    for name in cfg['ownedNodes']:
        ob=sc.objects[name];mesh=ob.data.copy();ob.data=mesh
        # Keep material indices at shared corner transitions separate. Each rectangular tile
        # already owns its rim and sides in the source scene.
        names=[m.name for m in mesh.materials]
        by_vert=[None]*len(mesh.vertices)
        for poly in mesh.polygons:
            key=names[poly.material_index]
            for v in poly.vertices:
                if by_vert[v] not in (None,key):raise ValueError('One paving point shared two materials')
                by_vert[v]=key
        matrix=ob.matrix_world;inverse=matrix.inverted()
        colors=mesh.color_attributes.new(name=field,type='FLOAT_COLOR',domain='POINT')
        count=0;oldDs=[]
        for idx,vertex in enumerate(mesh.vertices):
            key=by_vert[idx]
            if key not in cfg['materialGain']:raise ValueError(f'Unexpected material {key}')
            pos=matrix @ vertex.co;x,z=pos.x,-pos.y
            t=tx*x+tz*z;d=-tz*x+tx*z
            if abs(t)<2:oldDs.append(d)
            delta,w,center=displacement(cfg,t,d,key)
            pos.x-=tz*delta;pos.y-=tx*delta;vertex.co=inverse@pos
            old=cfg['warp']['sourceD']
            threshold=(old[2]-old[1])/2+.022
            on_joint=key=='Granite.RecessedJoint' and abs(d-(old[1]+old[2])/2)<threshold
            gain=cfg['vergeJointGain'] if on_joint else cfg['materialGain'][key]
            colors.data[idx].color=tuple(1-w+w*m for m in gain)+(1,)
            count+=bool(w)
        for i,material in enumerate(list(mesh.materials)):
            mesh.materials[i]=with_receiver(material,field,photo if names[i]=='Granite.PhotoAlbedo' else None)
        mesh.update();stats[name]={'vertices':len(mesh.vertices),'adjustedOrTransition':count,'observedSourceDRange':(min(oldDs),max(oldDs))}
    seal=cfg['jointSeal'];ta,_,_,td=cfg['taperM'];N=math.ceil((td-ta)*6);verts=[];faces=[]
    for i in range(N+1):
        t=ta+(td-ta)*i/N;old=seal['oldJointCenter']
        _,w,center=displacement(cfg,t,old,'')
        mid=old+(center-old)*w;half=cfg['warp']['jointHalfWidthM']*w
        for s in (-half,half):
            d=mid+s;verts.append((tx*t-tz*d,-(tz*t+tx*d),seal['topYM']))
        if i:
            a=2*(i-1)
            faces.extend(((a,a+1,a+2),(a+2,a+1,a+3)))
    mesh=bpy.data.meshes.new(seal['meshName']);mesh.from_pydata(verts,[],faces);mesh.update()
    ob=bpy.data.objects.new(seal['meshName'],mesh);sc.collection.objects.link(ob)
    mat=bpy.data.materials.new('NearWalk.ExpansionSeal.Recess');mat.use_nodes=True
    bs=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED');bs.inputs['Base Color'].default_value=(*seal['baseLinearRgb'],1);bs.inputs['Roughness'].default_value=1
    mesh.materials.append(mat)
    ob['basis']='Continuous recessed verge seam visible in campus capture. Projective width and support height are engineering estimates.'
    sc['near_paving_revision']=6;bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(out.resolve()),copy=True,compress=True)
    with out.open('rb') as f:sha=hashlib.file_digest(f,'sha256').hexdigest()
    receipt.write_text(json.dumps({'sha256':sha,'owned':stats,'field':field,'seal':ob.name},indent=2)+'\n')
if __name__=='__main__':main(*map(Path,sys.argv[sys.argv.index('--')+1:]))
