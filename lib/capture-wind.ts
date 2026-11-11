import * as THREE from 'three';

// The captured branch architecture sets the length, load arm, taper and inertia.
// Field context: https://pmc.ncbi.nlm.nih.gov/articles/PMC6597771/
const woodE = 8e9, woodDensity = 550, airDensity = 1.225, leafMassPerArea = .12;
const windWorld = new THREE.Vector3(1, 0, .23).normalize();
const downWorld = new THREE.Vector3(0, -1, 0);
const maxAngle = .25;
const physicsStep = 1/120;

/**
 * Spatially coherent gust loading, sampled at the branch's resting foliage arm.
 * Nearby foliage shares an air field; separated crowns do not receive exactly
 * the same force at the same instant. These wavelengths, attenuation and periods
 * are engineering priors, not measured campus turbulence or a fluid solver.
 * The field changes aerodynamic load, never the branch angle directly.
 */
export function captureGustMultiplier(point:THREE.Vector3, seconds:number) {
  return .86 + .10*Math.sin(.9*seconds-.17*point.x-.08*point.z)
    + .04*Math.sin(2.3*seconds-.70*point.x-.31*point.z+.19*point.y);
}

// Rest is the photographed branch under its own weight. A test mass adds only
// its incremental gravitational moment. Material constants are engineering priors.
interface AxisResponse { angle: number; velocity: number }
const response = (): AxisResponse => ({angle: 0, velocity: 0});

function advance(state: AxisResponse, target: number, omega: number, zeta: number, dt: number) {
  // Exact underdamped response over a constant-load interval.
  const damp = zeta * omega, frequency = omega * Math.sqrt(1 - zeta*zeta);
  const offset = state.angle - target, velocity = state.velocity;
  const decay = Math.exp(-damp * dt), c = Math.cos(frequency * dt), s = Math.sin(frequency * dt);
  state.angle = target + decay * (offset*c + (velocity + damp*offset)*s/frequency);
  state.velocity = decay * (velocity*c - (damp*velocity + omega*omega*offset)*s/frequency);
}

function beam(node: THREE.Object3D) {
  const m = node.userData;
  const length = Number(m.beam_length_m), base = Number(m.beam_base_radius_m);
  const tip = Number(m.beam_tip_radius_m), leaves = Number(m.leaf_area_m2);
  const offset = m.tip_offset_blender_m;
  if (![length,base,tip].every(v=>Number.isFinite(v) && v>0) || !Number.isFinite(leaves) || leaves<0 ||
    !Array.isArray(offset) || offset.length!==3 || !offset.every(Number.isFinite)) return null;
  const tipVector = new THREE.Vector3(offset[0], offset[2], -offset[1]);
  if (tipVector.lengthSq() < 1e-8) return null;
  const axis = tipVector.clone().normalize();
  const inverseRest = node.getWorldQuaternion(new THREE.Quaternion()).invert();
  const air = windWorld.clone().applyQuaternion(inverseRest);
  const gravity = downWorld.clone().applyQuaternion(inverseRest);
  const airAxis = axis.clone().cross(air), gravityAxis = axis.clone().cross(gravity);
  const leafArm = length * .72;
  // Integrate tapered circular cross-sections. The spring is chosen so the
  // tip travels as far as a cantilever under a point load at the foliage arm.
  let compliance = 0, inertia = leaves * leafMassPerArea * leafArm**2;
  const slices = 24;
  for (let j=0; j<slices; j++) {
    const x = length*(j+.5)/slices, r=base+(tip-base)*x/length;
    const area = Math.PI*r*r, I = area*r*r/4, dx=length/slices;
    inertia += woodDensity*area*x*x*dx;
    if (x<leafArm) compliance += (length-x)*(leafArm-x)*dx/(woodE*I);
  }
  const spring = length*leafArm/compliance;
  const broadsideWood = length*(base+tip)*airAxis.length();
  const airMoment = .5*airDensity*.8*(leaves*leafArm + broadsideWood*.5*length);
  const foliagePoint=node.localToWorld(tipVector.clone().multiplyScalar(.72));
  return {node, rest:node.quaternion.clone(), restTip:tipVector, spring, inertia, omega:Math.sqrt(spring/inertia),
    base, length, foliagePoint, airAxis, gravityAxis, airMoment, wind:response(), load:response()};
}
type Beam = NonNullable<ReturnType<typeof beam>>;

export function createCaptureWind(root: THREE.Object3D, options:{gusts?:boolean}={}) {
  root.updateMatrixWorld(true);
  const branches: Beam[] = [];
  root.traverse(o=>{ if (o.userData.wind_joint === true) {const b=beam(o); if(b)branches.push(b);} });
  // Use the foreground tip with the greatest estimated displacement per unit weight.
  const compliance = (b: Beam) => b.gravityAxis.length() * b.length * b.restTip.length() / b.spring;
  const sample = branches.filter(b => /foreground/i.test(b.node.name))
    .sort((a, b) => compliance(b) - compliance(a))[0] ?? branches[0];
  const rotation = new THREE.Quaternion(), tangent = new THREE.Vector3(), moved = new THREE.Vector3();
  const stats = {branchCount:branches.length, maxTipCm:0, testTipCm:0, moving:false, limited:0};
  let accumulated=0, time=0;
  function step(dt: number, speed: number, mass: number) {
    const elapsed = Number.isFinite(dt) ? Math.max(0, Math.min(.2,dt)) : 0;
    const v = Number.isFinite(speed) ? THREE.MathUtils.clamp(speed,-12,12) : 0;
    const load = Number.isFinite(mass) ? THREE.MathUtils.clamp(mass,0,2) : 0;
    accumulated+=elapsed;
    const ticks=Math.floor((accumulated+1e-12)/physicsStep);
    accumulated=Math.max(0,accumulated-ticks*physicsStep);
    // Deterministic integration ticks avoid different gust histories on a
    // 30 Hz phone and a 120 Hz display. A zero-duration read never advances.
    for(let tick=0;tick<ticks;tick++) {
      time+=physicsStep;
      for(const b of branches) {
        const testMass=b===sample?load:0;
        const omega=testMass?Math.sqrt(b.spring/(b.inertia+testMass*b.length*b.length)):b.omega;
        const localWind=v*(options.gusts===false?1:captureGustMultiplier(b.foliagePoint,time));
        const aerodynamic=localWind*Math.abs(localWind)/(1+Math.abs(localWind)/12);
        const windTarget=b.airMoment*aerodynamic/b.spring;
        const weightTarget=testMass*9.81*b.length/b.spring;
        const magnitude=tangent.copy(b.airAxis).multiplyScalar(windTarget).addScaledVector(b.gravityAxis,weightTarget).length();
        const limit=magnitude>maxAngle?maxAngle/magnitude:1;
        advance(b.wind,windTarget*limit,omega,.28,physicsStep);
        advance(b.load,weightTarget*limit,omega,.28,physicsStep);
      }
    }
    stats.maxTipCm=0; stats.testTipCm=0; stats.limited=0;
    // Even after elastic transients decay, a nonzero breeze keeps supplying
    // time-varying load. The view must not freeze at its first equilibrium.
    stats.moving=branches.length>0&&v!==0&&options.gusts!==false;
    for (const b of branches) {
      const testMass = b===sample?load:0;
      const localWind=v*(options.gusts===false?1:captureGustMultiplier(b.foliagePoint,time));
      const aerodynamic = localWind*Math.abs(localWind)/(1+Math.abs(localWind)/12);
      const windTarget = b.airMoment*aerodynamic/b.spring;
      const weightTarget = testMass*9.81*b.length/b.spring;
      const targetMagnitude = tangent.copy(b.airAxis).multiplyScalar(windTarget).addScaledVector(b.gravityAxis,weightTarget).length();
      const scale = targetMagnitude>maxAngle ? maxAngle/targetMagnitude : 1;
      if(scale<1)stats.limited++;
      tangent.copy(b.airAxis).multiplyScalar(b.wind.angle).addScaledVector(b.gravityAxis,b.load.angle);
      const angle=tangent.length();
      if(angle>1e-15) rotation.setFromAxisAngle(tangent.multiplyScalar(1/angle),Math.min(angle,maxAngle));
      else rotation.identity();
      b.node.quaternion.copy(b.rest).multiply(rotation);
      const cm = 100*moved.copy(b.restTip).applyQuaternion(rotation).distanceTo(b.restTip);
      stats.maxTipCm=Math.max(stats.maxTipCm,cm);
      if(b===sample)stats.testTipCm=cm;
      if (Math.abs(b.wind.velocity)+Math.abs(b.load.velocity)>1e-6 ||
        Math.abs(b.wind.angle-windTarget*scale)+Math.abs(b.load.angle-weightTarget*scale)>1e-7) stats.moving=true;
    }
    return stats;
  }
  return {step, stats, sample};
}
