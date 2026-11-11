import * as THREE from "three";
export function inspectGroundContacts(
  root: THREE.Object3D,
  targets: { id: string; node: THREE.Object3D; groundY: number }[],
  tolerance = 0.005
): Array<{
  id: string;
  status: "gap" | "penetration" | "contacting" | "invalid" | "no-geometry";
  lowestY: number | null;
  offset: number | null;
  invalidCount: number;
}> {
  root.updateWorldMatrix(true, true);
  const eps = Number.isFinite(tolerance) ? Math.max(0, tolerance) : 0;

  return targets.map((target) => {
    let underRoot = false;
    let inheritedVisible = true;

    for (let p: THREE.Object3D | null = target.node; p; p = p.parent) {
      inheritedVisible = inheritedVisible && p.visible;
      if (p === root) underRoot = true;
    }

    let lowestY: number | null = null;
    let invalidCount = 0;

    if (underRoot) {
      const stack: Array<[THREE.Object3D, boolean]> = [
        [target.node, inheritedVisible],
      ];
      const vertex = new THREE.Vector3();
      const world = new THREE.Matrix4();
      const instance = new THREE.Matrix4();

      while (stack.length) {
        const [obj, parentVisible] = stack.pop()!;
        const visible = parentVisible && obj.visible;
        if (!visible) continue;

        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          const position = mesh.geometry.getAttribute("position") as
            | THREE.BufferAttribute
            | undefined;

          if (position) {
            const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh === true;
            const copies = instanced ? (mesh as THREE.InstancedMesh).count : 1;

            for (let copy = 0; copy < copies; copy++) {
              if (instanced) {
                (mesh as THREE.InstancedMesh).getMatrixAt(copy, instance);
                world.multiplyMatrices(mesh.matrixWorld, instance);
              } else {
                world.copy(mesh.matrixWorld);
              }

              for (let i = 0; i < position.count; i++) {
                vertex.fromBufferAttribute(position, i);
                if (!Number.isFinite(vertex.x) ||
                    !Number.isFinite(vertex.y) ||
                    !Number.isFinite(vertex.z)) {
                  invalidCount++;
                  continue;
                }

                vertex.applyMatrix4(world);
                if (!Number.isFinite(vertex.x) ||
                    !Number.isFinite(vertex.y) ||
                    !Number.isFinite(vertex.z)) {
                  invalidCount++;
                  continue;
                }

                lowestY = lowestY === null ? vertex.y : Math.min(lowestY, vertex.y);
              }
            }
          }
        }

        for (const child of obj.children) stack.push([child, visible]);
      }
    }

    if (!Number.isFinite(target.groundY))
      return { id: target.id, status: "invalid" as const, lowestY, offset: null, invalidCount };
    if (lowestY === null)
      return { id: target.id, status: "no-geometry" as const, lowestY, offset: null, invalidCount };

    const offset = lowestY - target.groundY;
    const status = offset > eps ? "gap" : offset < -eps ? "penetration" : "contacting";
    return { id: target.id, status, lowestY, offset, invalidCount };
  });
}
