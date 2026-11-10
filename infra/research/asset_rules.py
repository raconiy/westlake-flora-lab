"""Typed, finite scalar functions for the reconstruction pipeline. No model-authored commands."""
import ast
import math
import operator

# The monitored code surface has one expression and named, finite scalar inputs.
BIN = {ast.Add:operator.add, ast.Sub:operator.sub, ast.Mult:operator.mul, ast.Div:operator.truediv}
CMP = {ast.Lt:operator.lt, ast.LtE:operator.le, ast.Gt:operator.gt, ast.GtE:operator.ge, ast.Eq:operator.eq, ast.NotEq:operator.ne}
CALL = {'min':min, 'max':max, 'abs':abs}
MONO = {ast.USub:operator.neg, ast.UAdd:operator.pos, ast.Not:operator.not_}


def finite(v):
    if type(v) not in (int, float, bool) or not math.isfinite(v) or abs(v)>1e12:
        raise ValueError('non-finite or unbounded scalar')
    return v


def compile_rule(source, fields):
    if not isinstance(source,str) or len(source)>600: raise ValueError('expression length')
    expr = ast.parse(source.strip(), mode='eval').body
    if sum(1 for _ in ast.walk(expr))>100: raise ValueError('expression too complex')
    def build(n):
        if isinstance(n,ast.Constant):
            value=finite(n.value)
            return lambda env:value
        if isinstance(n,ast.Name) and n.id in fields: return lambda env:env[n.id]
        if isinstance(n,ast.BinOp) and type(n.op) in BIN:
            a,b,op=build(n.left),build(n.right),BIN[type(n.op)]
            return lambda env:finite(op(a(env),b(env)))
        if isinstance(n,ast.Compare) and len(n.ops)==1 and type(n.ops[0]) in CMP:
            a,b,op=build(n.left),build(n.comparators[0]),CMP[type(n.ops[0])]
            return lambda env:op(a(env),b(env))
        if isinstance(n,ast.BoolOp):
            f=[build(x) for x in n.values]; aggregate=all if isinstance(n.op,ast.And) else any
            return lambda env:aggregate(g(env) for g in f)
        if isinstance(n,ast.UnaryOp) and type(n.op) in MONO:
            f,op=build(n.operand),MONO[type(n.op)]
            return lambda env:finite(op(f(env)))
        if isinstance(n,ast.IfExp):
            a,b,c=build(n.test),build(n.body),build(n.orelse)
            return lambda env:b(env) if a(env) else c(env)
        if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id in CALL and not n.keywords:
            if len(n.args) not in ([1] if n.func.id=='abs' else range(2,7)): raise ValueError('invalid arity')
            f,gs=CALL[n.func.id],[build(x) for x in n.args]
            return lambda env:finite(f(*(g(env) for g in gs)))
        raise ValueError('unsupported syntax: '+type(n).__name__)
    f=build(expr)
    def invoke(**env):
        if set(env)!=set(fields): raise ValueError('unexpected inputs')
        return finite(f({k:finite(v) for k,v in env.items()}))
    return invoke


# Fixed engineering policies. None of these are plant measurements.
CONTRACTS = {
 'botany': ('blade_width_probe',('photo','render','gain'),
   'Plan a reversible leaf-edge probe: take the signed gap of non-sky fraction (photo minus render), multiply by gain, add 1; bound the multiplier to [0.9,1.1]. Do not convert pixels to leaf counts. Neutral=1.'),
 'physics': ('leaf_edge_coordinate',('axis','edge','factor','is_edge'),
   'One coordinate of the lamina update. Only for an edge vertex, scale its signed offset from midrib axis by factor. Otherwise return the original edge coordinate exactly. No movement of anchor or tip.'),
 'scene': ('coverage_error_gain',('photo','baseline','candidate'),
   'Compute absolute baseline non-sky coverage error minus absolute candidate error, in fractions. Positive means better; do not conflate with IoU or leaf count.'),
 'infra': ('ready_for_next_image',('required','verified','pending','failed','already_done'),
   'Boolean readiness for submitting a registered image to the next pipeline stage: required>0, verified==required, no pending or failed prerequisites, no existing output.'),
 'qa': ('retain_trial',('mask_gain','coverage_gain','anchor_error','pair_complete'),
   'Boolean local trial acceptance gate. Require paired evidence, root/midrib error no larger than 0.000001 m in absolute value, positive non-sky IoU gain and coverage error gain >=0. A passing individual view does not imply global publish.')
}


def trials(role):
    if role=='botany':
        for p,b in ((.7787,.8505),(.9222,.9618),(.8657,.6719),(1.,0.),(0.,1.),(.25,.25)):
            for g in (0.,.5,1.,2.):
                yield (p,b,g), min(1.1,max(.9,1+(p-b)*g))
    if role=='physics':
        for a,e in ((1.5,1.8),(-.5,-1),(.003,.005),(0.,0.)):
            for f in (.9,1.,1.1):
                for edge in (True,False):
                    yield (a,e,f,edge),a+(e-a)*f if edge else e
    if role=='scene':
        for p in (.7787,.8657,.9222):
            for b in (.6719,.8505,.9618):
                for c in (p,b,.6,.97):
                    yield (p,b,c), abs(p-b)-abs(p-c)
    if role=='infra':
        import itertools
        for r,v,p,f,d in itertools.product(range(3),range(4),range(2),range(2),(True,False)):
            yield (r,v,p,f,d),r>0 and r==v and p==f==0 and not d
    if role=='qa':
        import itertools
        for m,c,a,ok in itertools.product((-.03,0.,.02),(-.01,0.,.03),(-.1,0.,1e-6,2e-6),(False,True)):
            yield (m,c,a,ok),bool(ok and abs(a)<=1e-6 and m>0 and c>=0)


def test_rule(role,source):
    name,params,_=CONTRACTS[role]; f=compile_rule(source,params)
    n=0
    for args,expected in trials(role):
        got=f(**dict(zip(params,args)))
        if type(expected) is bool:
            passed=(got is expected)
        else:
            passed=type(got) in (int,float) and math.isclose(got,expected,abs_tol=1e-12)
        if not passed: raise ValueError(f'{name}({args}) produced {got}, expected {expected}')
        n+=1
    return n
