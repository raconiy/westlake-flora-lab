// Agent B additive refinement layer.
// Loaded after viewer.js. It only adds new objects to window.__agentb.scene.
import * as THREE from 'three';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function sceneReady() {
  while (!window.__agentb?.ready) await sleep(80);
  return window.__agentb.scene;
}

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function horizontalPatch(scene, group, center, radiusX, radiusZ, color, opacity) {
  const geometry = new THREE.CircleGeometry(1, 40);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 1,
    metalness: 0,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });
  const patch = new THREE.Mesh(geometry, material);
  patch.position.set(center[0], center[1], center[2]);
  patch.scale.set(radiusX, 1, radiusZ);
  patch.receiveShadow = true;
  group.add(patch);
}

function grassBladeGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.07, 0, 0,
     0.07, 0, 0,
     0.015, 0.62, 0,
  ], 3));
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  return geometry;
}

function addGrassTufts(group, patches) {
  const geometry = grassBladeGeometry();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const count = patches.reduce((sum, patch) => sum + patch.blades, 0);
  const meshes = [0, 1, 2].map(index => {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = `refine_grass_blades_${index}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    return mesh;
  });
  const random = seeded(0xBEEF2026);
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  const colors = ['#315a35', '#416d38', '#587f3d', '#709449', '#2a4c32'];
  let index = 0;
  for (const patch of patches) {
    for (let i = 0; i < patch.blades; i += 1) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random());
      const x = patch.center[0] + Math.cos(angle) * distance * patch.radiusX;
      const z = patch.center[2] + Math.sin(angle) * distance * patch.radiusZ;
      const width = 0.65 + random() * 0.8;
      const height = 0.55 + random() * 0.65;
      const rotation = random() * Math.PI * 2;
      for (let plane = 0; plane < meshes.length; plane += 1) {
        transform.position.set(x, patch.center[1] + 0.025 + random() * 0.018, z);
        transform.rotation.set((random() - 0.5) * 0.22, rotation + plane * Math.PI / 3, (random() - 0.5) * 0.32);
        transform.scale.set(width, height, width);
        transform.updateMatrix();
        meshes[plane].setMatrixAt(index, transform.matrix);
        color.set(colors[Math.floor(random() * colors.length)]);
        meshes[plane].setColorAt(index, color);
      }
      index += 1;
    }
  }
  for (const mesh of meshes) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }
}

function addUnderstory(group, patches) {
  const shrubGeometry = new THREE.IcosahedronGeometry(0.52, 1);
  const shrubMaterial = new THREE.MeshStandardMaterial({ color: '#547842', roughness: 0.96 });
  const flowerGeometry = new THREE.IcosahedronGeometry(0.11, 1);
  const flowerMaterial = new THREE.MeshStandardMaterial({ color: '#d8a45e', roughness: 0.72 });
  const shrubCount = patches.reduce((sum, patch) => sum + patch.shrubs * 4, 0);
  const flowerCount = patches.reduce((sum, patch) => sum + patch.flowers, 0);
  const shrubs = new THREE.InstancedMesh(shrubGeometry, shrubMaterial, shrubCount);
  const flowers = new THREE.InstancedMesh(flowerGeometry, flowerMaterial, flowerCount);
  shrubs.name = 'refine_understory_shrubs';
  flowers.name = 'refine_low_flowers';
  shrubs.castShadow = true;
  shrubs.receiveShadow = true;
  flowers.castShadow = true;
  const random = seeded(0x51A7E);
  const transform = new THREE.Object3D();
  let shrubIndex = 0;
  let flowerIndex = 0;
  for (const patch of patches) {
    for (let i = 0; i < patch.shrubs; i += 1) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * 0.88;
      const x = patch.center[0] + Math.cos(angle) * distance * patch.radiusX;
      const z = patch.center[2] + Math.sin(angle) * distance * patch.radiusZ;
      for (let leaf = 0; leaf < 4; leaf += 1) {
        transform.position.set(x + (random() - 0.5) * 0.7, patch.center[1] + 0.22 + random() * 0.18, z + (random() - 0.5) * 0.7);
        transform.rotation.set(random() * 0.25, random() * Math.PI, random() * 0.25);
        const scale = 0.34 + random() * 0.42;
        transform.scale.set(scale * (0.85 + random() * 0.35), scale * (0.65 + random() * 0.35), scale * (0.85 + random() * 0.35));
        transform.updateMatrix();
        shrubs.setMatrixAt(shrubIndex++, transform.matrix);
      }
    }
    for (let i = 0; i < patch.flowers; i += 1) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * 0.82;
      const x = patch.center[0] + Math.cos(angle) * distance * patch.radiusX;
      const z = patch.center[2] + Math.sin(angle) * distance * patch.radiusZ;
      transform.position.set(x, patch.center[1] + 0.8 + random() * 0.3, z);
      transform.rotation.set(0, random() * Math.PI, 0);
      const scale = 0.8 + random() * 0.65;
      transform.scale.setScalar(scale);
      transform.updateMatrix();
      flowers.setMatrixAt(flowerIndex++, transform.matrix);
    }
  }
  shrubs.instanceMatrix.needsUpdate = true;
  flowers.instanceMatrix.needsUpdate = true;
  group.add(shrubs, flowers);
}

function addBench(group, position, rotationY) {
  const wood = new THREE.MeshStandardMaterial({ color: '#806443', roughness: 0.84 });
  const dark = new THREE.MeshStandardMaterial({ color: '#343a33', roughness: 0.9 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.12, 0.46), wood);
  const back = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.12, 0.58), wood);
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.52, 0.11), dark);
  seat.position.set(position[0], position[1] + 0.55, position[2]);
  back.position.set(position[0], position[1] + 0.92, position[2] + 0.2);
  back.rotation.x = -0.12;
  seat.rotation.y = rotationY;
  back.rotation.y = rotationY;
  for (const x of [-0.82, 0.82]) {
    const left = leg.clone();
    left.position.set(position[0] + x * Math.cos(rotationY), position[1] + 0.25, position[2] + x * Math.sin(rotationY));
    left.rotation.y = rotationY;
    group.add(left);
  }
  seat.castShadow = true;
  back.castShadow = true;
  group.add(seat, back);
}

function addSmallTrees(group, trees, groundY) {
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#5b4935', roughness: 0.93 });
  const leafMaterials = ['#3e6b3d', '#5d8344', '#78934c'].map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
  trees.forEach((tree, treeIndex) => {
    const treeGroup = new THREE.Group();
    treeGroup.name = `refine_small_tree_${String(treeIndex + 1).padStart(2, '0')}`;
    treeGroup.position.set(tree.position[0], groundY, tree.position[1]);
    const trunkHeight = tree.height * 0.62;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.11, trunkHeight, 7), trunkMaterial);
    trunk.position.y = trunkHeight / 2;
    trunk.castShadow = true;
    treeGroup.add(trunk);
    const crownGeometry = new THREE.IcosahedronGeometry(tree.height * 0.19, 1);
    const crownCount = tree.crown === 'upright' ? 5 : 7;
    for (let i = 0; i < crownCount; i += 1) {
      const crown = new THREE.Mesh(crownGeometry, leafMaterials[(treeIndex + i) % leafMaterials.length]);
      const angle = i / crownCount * Math.PI * 2;
      const radius = tree.height * (tree.crown === 'upright' ? 0.1 : 0.17);
      crown.position.set(Math.cos(angle) * radius, trunkHeight + tree.height * (0.12 + (i % 3) * 0.09), Math.sin(angle) * radius);
      crown.scale.set(1 + (i % 2) * 0.18, 0.82 + (i % 3) * 0.08, 0.9 + (i % 2) * 0.12);
      crown.castShadow = true;
      treeGroup.add(crown);
    }
    group.add(treeGroup);
  });
}

function addFlowerBeds(group, beds, groundY) {
  const random = seeded(0xF10A2026);
  const soilMaterial = new THREE.MeshStandardMaterial({ color: '#514535', roughness: 1 });
  const flowerColors = ['#d28a82', '#e3bc58', '#9f88af', '#dcb98d'];
  beds.forEach((bed, bedIndex) => {
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(bed.radius, bed.radius * 0.94, 0.07, 12), soilMaterial);
    soil.position.set(bed.position[0], groundY + 0.025, bed.position[1]);
    soil.scale.z = 0.68;
    soil.receiveShadow = true;
    group.add(soil);
    for (let i = 0; i < 24; i += 1) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * bed.radius * 0.88;
      const flower = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 1), new THREE.MeshStandardMaterial({ color: flowerColors[(bedIndex + i) % flowerColors.length], roughness: 0.9 }));
      flower.position.set(bed.position[0] + Math.cos(angle) * radius, groundY + 0.135 + random() * 0.15, bed.position[1] + Math.sin(angle) * radius * 0.68);
      flower.scale.set(0.8 + random() * 0.8, 0.7 + random() * 0.9, 0.8 + random() * 0.8);
      flower.castShadow = true;
      group.add(flower);
    }
  });
}

function installToggle(group) {
  const actions = document.querySelector('.bar-actions');
  if (!actions) return;
  const button = document.createElement('button');
  button.id = 'btn-refine-layer';
  button.className = 'on';
  button.type = 'button';
  button.textContent = '细化层';
  button.title = '显示或隐藏 Agent B 的 additive refine 层';
  button.setAttribute('aria-pressed', 'true');
  button.addEventListener('click', () => {
    group.visible = !group.visible;
    button.classList.toggle('on', group.visible);
    button.setAttribute('aria-pressed', String(group.visible));
  });
  actions.append(button);
}

async function addRefinement() {
  const scene = await sceneReady();
  if (scene.getObjectByName('agent_b_refine_layer')) return;
  const config = await fetch(new URL('../refine/refine.json', import.meta.url), { cache: 'no-cache' }).then(response => {
    if (!response.ok) throw new Error(`refine manifest ${response.status}`);
    return response.json();
  });
  const centralZone = config.zones.find(zone => zone.id === 'central-lawn') ?? {
    center: [180.76, -4.995], radius: [30.0, 22.0], ground_y: -0.155,
  };
  const groundY = Number(centralZone.ground_y ?? -0.155);
  const group = new THREE.Group();
  group.name = 'agent_b_refine_layer';
  scene.add(group);

  // Four irregular islands sit inside the large lawn_01 area. The center stays open for sightlines.
  const patches = [
    { center: [centralZone.center[0], groundY, centralZone.center[1]], radiusX: centralZone.radius[0], radiusZ: centralZone.radius[1], blades: 9000, shrubs: 0, flowers: 0, overlay: false },
    { center: [147.5, groundY, -18.0], radiusX: 8.5, radiusZ: 5.1, blades: 1100, shrubs: 22, flowers: 12 },
    { center: [177.0, groundY, -27.0], radiusX: 9.5, radiusZ: 5.6, blades: 1250, shrubs: 24, flowers: 15 },
    { center: [207.0, groundY, 2.0], radiusX: 7.6, radiusZ: 5.0, blades: 980, shrubs: 18, flowers: 11 },
    { center: [160.0, groundY, 20.0], radiusX: 7.2, radiusZ: 4.5, blades: 920, shrubs: 18, flowers: 10 },
  ];
  const patchColors = ['#496f39', '#52783c', '#5d8041', '#466a37'];
  let patchIndex = 0;
  patches.forEach(patch => {
    if (patch.overlay === false) return;
    horizontalPatch(scene, group, patch.center, patch.radiusX, patch.radiusZ, patchColors[patchIndex], 0.68);
    patchIndex += 1;
  });
  addGrassTufts(group, patches);
  addUnderstory(group, patches);
  addSmallTrees(group, config.central_planting.small_trees.slice(0, 3), groundY);
  addFlowerBeds(group, config.central_planting.flower_beds, groundY);
  config.central_planting.benches.forEach(bench => addBench(group, [bench.position[0], groundY, bench.position[1]], bench.rotation));
  installToggle(group);
  window.__agentb.refinement = { version: config.version, patches: patches.length, benches: config.central_planting.benches.length, inferred: true };
}
addRefinement().catch(error => console.warn('[Agent B refine]', error));
