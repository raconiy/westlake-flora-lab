import * as THREE from 'three';
import { woodSections, type WoodSection } from './wood-loads.ts';

/** Ranges use the original vertex table AND the rendered index stream, never
 * the old triangle-expanded firstVertex convention. userData is source-local;
 * nested support ranges must be interpreted within these enclosing ranges. */
export interface WoodGeometrySourceRange {
  sourceIndex: number;
  firstVertex: number;
  vertexCount: number;
  firstIndex: number;
  indexCount: number;
  firstWoodSection: number;
  woodSectionCount: number;
  userData: THREE.BufferGeometry['userData'];
}

const attributeTypes = new Set<Function>([
  THREE.BufferAttribute, THREE.Int8BufferAttribute, THREE.Uint8BufferAttribute,
  THREE.Uint8ClampedBufferAttribute, THREE.Int16BufferAttribute, THREE.Uint16BufferAttribute,
  THREE.Int32BufferAttribute, THREE.Uint32BufferAttribute, THREE.Float16BufferAttribute,
  THREE.Float32BufferAttribute,
]);
const fail = (message: string): never => { throw new Error(`mergeWoodGeometries: ${message}`); };

function vertexAttribute(value: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, name: string) {
  if (!(value instanceof THREE.BufferAttribute) || !attributeTypes.has(value.constructor)) {
    fail(`unsupported attribute ${name} (interleaved, instanced, GPU-only or custom attributes require an explicit adapter)`);
  }
  const attribute = value as THREE.BufferAttribute;
  if (!Number.isInteger(attribute.itemSize) || attribute.itemSize < 1 || !Number.isInteger(attribute.count)) {
    fail(`invalid attribute layout ${name}`);
  }
  return attribute;
}

/** Consume full, single-material triangle geometries on SUCCESS only. No vertex
 * welding, normal recomputation, UV wrapping or triangle reordering. Compatible
 * CPU attributes retain their raw storage, normalization and GPU interpretation.
 * Unsupported rendering contracts reject before any input is disposed.
 *
 * Actual wood sections are read once per unique final source (after all baked
 * transforms), before releasing temporary parts. Metadata objects are retained
 * by reference, not JSON-cloned or rewritten into ambiguous vertex offsets.
 * Materials/textures belong to the caller and are never disposed here. */
export function mergeWoodGeometries(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (!parts.length) fail('expected at least one geometry');
  const names = Object.keys(parts[0].attributes).sort();
  if (!names.includes('position')) fail('position attribute is required');
  const templates = new Map(names.map(name => [name, vertexAttribute(parts[0].attributes[name], name)]));
  if (templates.get('position')!.itemSize !== 3) fail('position must have itemSize 3');
  let vertexCount = 0, indexCount = 0;
  for (const part of parts) {
    if (Object.keys(part.morphAttributes).length || part.morphTargetsRelative) fail('morph targets are unsupported');
    if (part.groups.length) fail('material groups are unsupported; supply full single-material parts');
    const partNames = Object.keys(part.attributes).sort();
    if (partNames.length !== names.length || partNames.some((name, i) => name !== names[i])) fail('incompatible attribute names');
    const count = part.attributes.position.count;
    for (const name of names) {
      const a = vertexAttribute(part.attributes[name], name), t = templates.get(name)!;
      if (a.count !== count || a.itemSize !== t.itemSize || a.array.constructor !== t.array.constructor ||
          a.normalized !== t.normalized || a.gpuType !== t.gpuType || a.usage !== t.usage || a.name !== t.name ||
          (a instanceof THREE.Float16BufferAttribute) !== (t instanceof THREE.Float16BufferAttribute)) {
        fail(`incompatible attribute ${name}`);
      }
    }
    const elements = part.index?.count ?? count;
    if (elements % 3) fail('triangle stream must contain complete triangles');
    if (part.drawRange.start !== 0 || (part.drawRange.count !== Infinity && part.drawRange.count !== elements)) {
      fail('partial drawRange is unsupported');
    }
    if (part.index) {
      const index = vertexAttribute(part.index, 'index');
      if (index.itemSize !== 1 || index.normalized || index instanceof THREE.Float16BufferAttribute ||
          !(index.array instanceof Uint8Array || index.array instanceof Uint16Array || index.array instanceof Uint32Array)) {
        fail('index must contain unsigned integer scalar vertex IDs');
      }
      const restart = index.array instanceof Uint8Array ? 255 : index.array instanceof Uint16Array ? 65535 : 0xffffffff;
      for (const id of index.array) {
        if (id === restart) fail('primitive restart indices are unsupported');
        if (id >= count) fail('index is outside its source vertex table');
      }
    }
    vertexCount += count; indexCount += elements;
    // 0xffffffff is WebGL2's fixed primitive restart index, not a vertex ID.
    if (!Number.isSafeInteger(vertexCount) || vertexCount > 0xffffffff || !Number.isSafeInteger(indexCount)) fail('geometry exceeds index capacity');
  }

  const sections: WoodSection[] = [], sources: WoodGeometrySourceRange[] = [];
  const captured = new Map<THREE.BufferGeometry, WoodSection[]>();
  let firstVertex = 0, firstIndex = 0;
  for (const [sourceIndex, part] of parts.entries()) {
    let actual = captured.get(part);
    if (!actual) { actual = woodSections(part); captured.set(part, actual); }
    sources.push({ sourceIndex, firstVertex, vertexCount: part.attributes.position.count,
      firstIndex, indexCount: part.index?.count ?? part.attributes.position.count,
      firstWoodSection: sections.length, woodSectionCount: actual.length, userData: part.userData });
    for (const section of actual) sections.push(section);
    firstVertex += part.attributes.position.count;
    firstIndex += part.index?.count ?? part.attributes.position.count;
  }

  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const template = templates.get(name)!;
    const ArrayType = template.array.constructor as THREE.TypedArrayConstructor;
    const array = new ArrayType(vertexCount * template.itemSize);
    let offset = 0;
    for (const part of parts) {
      const source = (part.attributes[name] as THREE.BufferAttribute).array;
      array.set(source, offset); offset += source.length;
    }
    // Float16 stores uint16 bits but has distinct accessors/GPU semantics.
    const attribute = template instanceof THREE.Float16BufferAttribute
      ? new THREE.Float16BufferAttribute(array, template.itemSize, template.normalized)
      : new THREE.BufferAttribute(array, template.itemSize, template.normalized);
    attribute.name = template.name; attribute.gpuType = template.gpuType; attribute.setUsage(template.usage);
    out.setAttribute(name, attribute);
  }
  // Reserve 65535 for primitive restart, as Three's own setIndex does.
  const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let offset = 0;
  for (const [i, part] of parts.entries()) {
    const base = sources[i].firstVertex, count = sources[i].indexCount;
    for (let j = 0; j < count; j++) indices[offset++] = base + (part.index ? part.index.array[j] : j);
  }
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  out.userData.woodSections = sections;
  out.userData.woodGeometrySources = sources;
  for (const part of new Set(parts)) part.dispose();
  return out;
}
