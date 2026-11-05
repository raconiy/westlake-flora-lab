import * as collar from './root-collar-bridge.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import * as framing from './scene-framing.ts';
import * as engine from './plant-engine.ts';
import * as additional from './additional-species.ts';
import * as roots from './rhizosphere.ts';
import * as beams from './beam-dynamics.ts';
import * as priors from './physical-priors.ts';
import * as ground from './ground-surface.ts';
import * as leaves from './leaf-dynamics.ts';
import * as observation from './leaf-observation.ts';
import {initialScenario} from './species.ts';

const corners = box => Array.from({length: 8}, (_, i) => new THREE.Vector3(
  i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
const direction = new THREE.Vector3(1, .9, 1.65);
function fittedCamera(box, aspect, view = direction) {
  const frame = framing.perspectiveBoundsFrame(box, view, 35, aspect);
  const range = framing.perspectiveCameraRange(box, frame.position, frame.target, frame.distance);
  const camera = new THREE.PerspectiveCamera(35, aspect, range.near, range.far);
  camera.position.copy(frame.position); camera.lookAt(frame.target); camera.updateMatrixWorld(true);
  return {camera, frame, range};
}

test('perspective fit contains centimetre blades, wide translated crowns and large trees at portrait/landscape aspects', () => {
  for (const scale of [.01, 1, 80]) for (const aspect of [.22, .65, 1, 2.4]) {
    const box = new THREE.Box3(new THREE.Vector3(-2, -.1, -.8).multiplyScalar(scale), new THREE.Vector3(3, 2, 1.2).multiplyScalar(scale));
    box.translate(new THREE.Vector3(1.3, -.7, 2));
    for (const view of [direction, new THREE.Vector3(.2, .35, -2.15), new THREE.Vector3(.45, .18, 2.1)]) {
      const {camera, frame, range} = fittedCamera(box, aspect, view);
      assert.ok(framing.cameraContainsBounds(box, camera));
      assert.ok(range.minDistance < frame.distance && range.maxDistance > frame.distance);
      for (const point of corners(box)) {
        const projected = point.project(camera);
        assert.ok(Math.abs(projected.x) < .9 && Math.abs(projected.y) < .9 && Math.abs(projected.z) < 1);
      }
      camera.position.copy(frame.target).addScaledVector(view.clone().normalize(), range.maxDistance);
      camera.lookAt(frame.target); camera.updateMatrixWorld(true);
      assert.ok(framing.cameraContainsBounds(box, camera), 'the orbit zoom-out endpoint remains inside far clip');
      assert.ok(range.near < range.minDistance * .02, 'near clip supports the zoom-in endpoint');
    }
  }
});

test('growth policy fits before interaction regardless of playback; manual ownership persists until explicit reclaim', () => {
  const small = new THREE.Box3(new THREE.Vector3(-.01, 0, -.01), new THREE.Vector3(.01, .02, .01));
  const large = small.clone().expandByScalar(20), {camera} = fittedCamera(small, 1);
  assert.equal(framing.cameraContainsBounds(large, camera), false);
  for (const playing of [false, true]) {
    assert.equal(framing.cameraFrameAction(false, playing, false), 'snap');
    for (const fits of [false, true]) {
      assert.equal(framing.cameraFrameAction(true, playing, fits), 'preserve');
      assert.equal(framing.cameraFrameAction(true, playing, fits, true), 'snap');
    }
  }
  assert.equal(framing.cameraFrameAction(false, true, true), 'ease');
  assert.equal(framing.cameraFrameAction(false, false, true), 'snap');
  const position = new THREE.Vector3(600, 400, 800), target = new THREE.Vector3(100, -20, 80);
  const range = framing.perspectiveCameraRange(small, position, target);
  assert.ok(range.minDistance < position.distanceTo(target) && range.maxDistance > position.distanceTo(target));
  assert.ok(range.far > position.distanceTo(small.getCenter(new THREE.Vector3())));
});

test('empty and flat organ bounds still yield finite camera frames and usable clip ranges', () => {
  for (const box of [new THREE.Box3(), new THREE.Box3(new THREE.Vector3(), new THREE.Vector3())]) {
    const {camera, frame, range} = fittedCamera(box, 1, new THREE.Vector3());
    assert.ok([...frame.position, ...frame.target, ...Object.values(range)].every(Number.isFinite));
    assert.ok(range.near > 0 && range.far > range.near && range.maxDistance > range.minDistance);
    assert.ok(framing.cameraContainsBounds(box, camera));
  }
});

// Execute the component's real effects, real plant builders, real SI dynamics,
// and real OrbitControls. Only React mounting, DOM scheduling and GPU submission
// are replaced so ownership and failure paths can be exercised in Node.
const componentJS = ts.transpileModule(readFileSync(new URL('../app/PlantScene.tsx', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
}).outputText;
function mountScene(overrides = {}) {
  const errors = [], consoleErrors = [], callbacks = new Map(), refs = [], effects = [];
  let width = 900, height = 650, nextRAF = 0, hook = 0, effect = 0, pending = [], renderer, controls, resize, buildFault=false;
  class Surface {
    listeners = new Map(); style = {}; clientWidth = width; clientHeight = height;
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeEventListener(type) { this.listeners.delete(type); }
    getRootNode() { return this; }
    getBoundingClientRect() { return {width, height, left: 0, top: 0}; }
    setPointerCapture() {} releasePointerCapture() {} remove() {}
    emit(type, event) { this.listeners.get(type)?.({preventDefault() {}, ...event}); }
  }
  const container = new Surface(); container.appendChild = () => {};
  class Renderer {
    domElement = new Surface(); shadowMap = {}; debug = {}; renders = 0; renderHook = null;
    constructor() { renderer = this; }
    setPixelRatio() {} setClearColor() {} setSize() {} dispose() {} forceContextLoss() {}
    render(scene, camera) {
      this.scene = scene; this.camera = camera; this.renders++;
      this.renderHook?.(scene, camera);
    }
  }
  class Controls extends OrbitControls {
    constructor(...args) { super(...args); controls = this; }
  }
  const react = {
    useRef(value) { const index = hook++; return refs[index] ??= {current: index === 0 ? container : value}; },
    useEffect(callback, deps) {
      const index = effect++, previous = effects[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        pending.push(() => { previous?.cleanup?.(); effects[index] = {deps, cleanup: callback()}; });
      }
    },
  };
  const imports = {
    react, 'react/jsx-runtime': {jsx: () => null},
    three: {...THREE, WebGLRenderer: Renderer},
    'three/addons/controls/OrbitControls.js': {OrbitControls: Controls},
    '../lib/scene-framing': framing, '../lib/plant-engine': {...engine,buildPlant(...args){if(buildFault)throw Error('injected geometry failure');return engine.buildPlant(...args);}}, '../lib/additional-species': additional,
    '../lib/root-collar-bridge': collar, '../lib/rhizosphere': roots, '../lib/beam-dynamics': beams, '../lib/physical-priors': priors,
    '../lib/ground-surface': ground, '../lib/leaf-dynamics': leaves, '../lib/leaf-observation': observation,
  };
  const module = {exports: {}};
  new Function('require', 'module', 'exports', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'devicePixelRatio', 'console', componentJS)(
    name => { assert.ok(name in imports, `unexpected import ${name}`); return imports[name]; }, module, module.exports,
    callback => { const id = ++nextRAF; callbacks.set(id, callback); return id; }, id => callbacks.delete(id),
    class { constructor(callback) { resize = callback; } observe() {} disconnect() {} }, 1,
    {error: (...args) => consoleErrors.push(args)},
  );
  let props = {scenario: {...initialScenario, species: 'ginkgo', age: .2, wind: 0, gravity: 0}, autoFrame: false,
    organView: 'plant', mode: 'natural', resetKey: 0, motion: false,
    onStats() {}, onRootStats() {}, onPhysicsStats() {}, onError: message => errors.push(message), ...overrides};
  function update(changes = {}) {
    props = {...props, ...changes}; hook = 0; effect = 0;
    module.exports.default(props);
    const jobs = pending; pending = []; jobs.forEach(job => job());
  }
  function tick() {
    const jobs = [...callbacks.values()]; callbacks.clear();
    jobs.forEach(callback => callback(performance.now() + nextRAF * 16));
  }
  update(); tick();
  return {
    renderer, controls, errors, consoleErrors, tick, update, setBuildFault(value){buildFault=value;},
    get camera() { return controls.object; }, get props() { return props; }, get pendingFrames() { return callbacks.size; },
    grow(changes) { update({scenario: {...props.scenario, ...changes}}); },
    resize(w, h) { width = w; height = h; renderer.domElement.clientWidth = w; renderer.domElement.clientHeight = h; resize(); },
    wheel() { renderer.domElement.emit('wheel', {deltaY: -200, deltaMode: 0, clientX: width / 2, clientY: height / 2}); },
    drag() {
      const event = {pointerType: 'mouse', pointerId: 1, button: 0, clientX: 200, clientY: 200, pageX: 200, pageY: 200};
      renderer.domElement.emit('pointerdown', event);
      renderer.domElement.emit('pointermove', {...event, clientX: 270, clientY: 215});
      renderer.domElement.emit('pointerup', event);
    },
    dispose() { for (const entry of effects) entry.cleanup?.(); assert.equal(callbacks.size, 0); },
  };
}
function currentPlant(scene) {
  // The root group and detached detail are hidden in plant view. Some species
  // nest all organs inside fans, so direct-child organ tags are insufficient.
  const plant = scene.renderer.scene.children.find(object => object instanceof THREE.Group && object.visible && object.name !== 'soil-surface:visual-substrate');
  assert.ok(plant); return plant;
}
function assertPlantFits(scene) {
  assert.ok(framing.cameraContainsBounds(framing.modelBounds(currentPlant(scene)), scene.camera), 'full rebuilt plant fits');
}
function assertCameraUnchanged(scene, position, target) {
  assert.ok(scene.camera.position.distanceTo(position) < 1e-8, 'owned position survives');
  assert.ok(scene.controls.target.distanceTo(target) < 1e-8, 'owned target survives');
}

test('component frames age/day changes without playback and immediately frames growth during playback', () => {
  const scene = mountScene();
  try {
    scene.grow({age: 18}); assertPlantFits(scene);
    scene.grow({day: 90}); assertPlantFits(scene);
    assert.equal(scene.props.scenario.age, 18, 'changing day retains age');
    scene.update({autoFrame: true}); scene.grow({age: 40, day: 180}); assertPlantFits(scene);
    scene.resize(240, 900); assertPlantFits(scene);
    scene.tick(); assertPlantFits(scene); assert.deepEqual(scene.errors, []);
  } finally { scene.dispose(); }
});

test('real wheel and drag retain camera through growth, playback, shrinking and resize; reset/species/organ reclaim', () => {
  for (const interaction of ['wheel', 'drag']) {
    const scene = mountScene();
    try {
      scene[interaction]();
      // Let drag damping settle before comparing user-owned camera values.
      for (let i = 0; i < 260; i++) scene.tick();
      const position = scene.camera.position.clone(), target = scene.controls.target.clone();
      scene.grow({age: 18}); scene.tick(); assertCameraUnchanged(scene, position, target);
      scene.update({autoFrame: true, mode: 'wire'}); scene.grow({age: 40});
      scene.resize(250, 900); scene.tick(); assertCameraUnchanged(scene, position, target);
      scene.grow({age: .1}); scene.tick(); assertCameraUnchanged(scene, position, target);
      scene.grow({age: 18}); scene.update({resetKey: 1}); assertPlantFits(scene);
      assert.ok(scene.camera.position.distanceTo(position) > 1);
      scene[interaction](); scene.update({organView: 'leaf'});
      const detail = scene.renderer.scene.children.find(object => object.name === 'source-leaf-observation');
      assert.ok(framing.cameraContainsBounds(framing.modelBounds(detail), scene.camera));
      scene[interaction](); scene.update({organView: 'plant'}); assertPlantFits(scene);
      scene[interaction](); scene.grow({species: 'iris', age: .2}); assertPlantFits(scene);
      assert.deepEqual(scene.errors, []);
    } finally { scene.dispose(); }
  }
});

function patchedMeshes(root) {
  const meshes = []; root.traverse(object => { if (object instanceof THREE.Mesh && object.customDepthMaterial) meshes.push(object); }); return meshes;
}
function shaderFailure(renderer, source) {
  renderer.debug.onShaderError({getShaderSource: () => source}, {}, {}, {});
}

test('confirmed blade shader link failures restore visible and shadow materials, survive a driver throw, and disable future patches', () => {
  for (const driverThrows of [false, true]) {
    const scene = mountScene();
    try {
      const meshes = patchedMeshes(scene.renderer.scene); assert.ok(meshes.length > 1, 'plant and detached detail are patched');
      const materials = meshes.map(mesh => mesh.material); let disposed = 0;
      for (const material of new Set(materials)) material.addEventListener('dispose', () => disposed++);
      scene.renderer.renderHook = () => {
        scene.renderer.renderHook = null;
        const shader = {uniforms: {}, vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>'};
        materials[0].onBeforeCompile(shader, scene.renderer);
        assert.ok(shader.vertexShader.includes('vec2 leafBend('));
        shaderFailure(scene.renderer, shader.vertexShader);
        if (driverThrows) throw new Error('driver failed after link callback');
      };
      scene.tick();
      assert.ok(disposed > 0); assert.equal(patchedMeshes(scene.renderer.scene).length, 0);
      assert.ok(meshes.every((mesh, i) => mesh.material !== materials[i] && !mesh.customDepthMaterial && !mesh.customDistanceMaterial));
      assert.equal(scene.errors.length, 1); assert.match(scene.errors[0], /已回退基础材质/);
      const renders = scene.renderer.renders; scene.tick(); assert.equal(scene.renderer.renders, renders + 1);
      scene.grow({age: .3}); assert.equal(patchedMeshes(scene.renderer.scene).length, 0);
      assert.equal(scene.pendingFrames, 1); assert.deepEqual(scene.consoleErrors, []);
    } finally { scene.dispose(); }
  }
});

test('base shader failure is reported as fatal and does not pretend to recover as a leaf fallback', () => {
  const scene = mountScene();
  try {
    scene.renderer.renderHook = () => shaderFailure(scene.renderer, 'void main() {}');
    scene.tick(); assert.equal(scene.pendingFrames, 0);
    assert.equal(scene.errors.length, 1); assert.match(scene.errors[0], /基础材质着色器编译失败/);
    assert.doesNotMatch(scene.errors[0], /已回退/);
    const renders = scene.renderer.renders; scene.tick(); assert.equal(scene.renderer.renders, renders);
    scene.update({resetKey: 1}); assert.equal(scene.pendingFrames, 0, 'cached invalid base programs require a page reload');
  } finally { scene.dispose(); }
});

test('render exceptions stop the failing loop visibly; explicit reset retries and cleanup cancels the frame', () => {
  const scene = mountScene();
  try {
    scene.renderer.renderHook = () => { throw new Error('injected renderer failure'); };
    scene.tick(); assert.equal(scene.pendingFrames, 0);
    assert.match(scene.errors.at(-1), /三维渲染发生异常/); assert.equal(scene.consoleErrors.length, 1);
    const renders = scene.renderer.renders; scene.tick(); assert.equal(scene.renderer.renders, renders);
    scene.renderer.renderHook = null; scene.update({resetKey: 1}); scene.tick();
    assert.equal(scene.errors.at(-1), ''); assert.equal(scene.renderer.renders, renders + 1); assert.equal(scene.pendingFrames, 1);
  } finally { scene.dispose(); }
});

test('failed model rebuild releases partial scene and explicit reset retries the failed generation',()=>{
 const scene=mountScene();try{scene.setBuildFault(true);scene.grow({age:.3});assert.match(scene.errors.at(-1),/植物几何生成失败/);assert.equal(scene.pendingFrames,0);scene.setBuildFault(false);scene.update({resetKey:1});scene.tick();assert.equal(scene.errors.at(-1),'');assertPlantFits(scene);assert.equal(scene.pendingFrames,1);}finally{scene.dispose();}
});
