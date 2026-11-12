import * as THREE from 'three';

type PointFile = {file: string; count: number; diameter: number};

export async function readCrownSamples(media: string, signal: AbortSignal, list = 'crown-samples.json') {
  const index = await fetch(media + list, {signal});
  if (!index.ok) throw new Error('Crown sample index unavailable');
  const files: PointFile[] = await index.json();
  const group = new THREE.Group();
  let count = 0;
  try {
    for (const item of files) {
      const response = await fetch(media + item.file, {signal});
      if (!response.ok) throw new Error('Crown samples unavailable');
      const data = new DataView(await response.arrayBuffer());
      if (data.byteLength !== item.count * 16) throw new Error('Incomplete crown sample file');
      const positions = new Float32Array(item.count * 3);
      const colors = new Float32Array(item.count * 3);
      const color = new THREE.Color();
      for (let i = 0; i < item.count; i++) {
        const offset = i * 16;
        for (let axis = 0; axis < 3; axis++) positions[i * 3 + axis] = data.getFloat32(offset + axis * 4, true);
        color.setRGB(data.getUint8(offset + 12) / 255, data.getUint8(offset + 13) / 255, data.getUint8(offset + 14) / 255, THREE.SRGBColorSpace);
        color.toArray(colors, i * 3);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const material = new THREE.PointsMaterial({size: item.diameter, vertexColors: true, toneMapped: false});
      group.add(new THREE.Points(geometry, material));
      count += item.count;
    }
    return {group, count};
  } catch (error) {
    disposeSamples(group);
    throw error;
  }
}

export function disposeSamples(group: THREE.Group) {
  for (const child of group.children) {
    if (child instanceof THREE.Points) {child.geometry.dispose(); child.material.dispose();}
  }
}
