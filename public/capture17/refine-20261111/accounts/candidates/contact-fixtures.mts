import { inspectGroundContacts } from "./inspectGroundContacts.mts";
import * as THREE from "three";
import { strict as assert } from "node:assert";

// 1. Translated mesh
{
  const root = new THREE.Group(), g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const m = new THREE.Mesh(g); m.position.y = 1; root.add(m);
  assert.equal(inspectGroundContacts(root, [{ id: "stem", node: m, groundY: 0 }])[0].status, "gap");
}

// 2. Rotated/nonuniform nested parents
{
  const root = new THREE.Group(), a = new THREE.Group(), b = new THREE.Group();
  a.position.y = -3; a.rotation.z = Math.PI / 2; a.scale.set(2, 3, 1);
  b.position.y = .5; b.scale.set(1, 2, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([1, 0, 0], 3));
  const m = new THREE.Mesh(g); b.add(m); a.add(b); root.add(a);
  assert.equal(inspectGroundContacts(root, [{ id: "lamp", node: m, groundY: -1 }])[0].status, "contacting");
}

// 3. InstancedMesh
{
  const root = new THREE.Group(), g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const m = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial(), 2);
  const a = new THREE.Matrix4().makeTranslation(0, 2, 0);
  const b = new THREE.Matrix4().makeTranslation(0, .25, 0);
  m.setMatrixAt(0, a); m.setMatrixAt(1, b); root.add(m);
  assert.equal(inspectGroundContacts(root, [{ id: "stem", node: m, groundY: 0 }])[0].lowestY, .25);
}

// 4. Hidden ancestor
{
  const root = new THREE.Group(), hidden = new THREE.Group(), g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const m = new THREE.Mesh(g); hidden.visible = false; hidden.add(m); root.add(hidden);
  assert.equal(inspectGroundContacts(root, [{ id: "stem", node: m, groundY: 0 }])[0].status, "no-geometry");
}

// 5. NaN vertex
{
  const root = new THREE.Group(), g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, NaN, 0, 0, 1, 0], 3));
  const m = new THREE.Mesh(g); root.add(m);
  const r = inspectGroundContacts(root, [{ id: "stem", node: m, groundY: 0 }])[0];
  assert.equal(r.invalidCount, 1); assert.equal(r.status, "gap");
}

console.log("5 contact fixtures passed");
