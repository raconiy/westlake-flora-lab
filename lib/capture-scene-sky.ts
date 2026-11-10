import * as THREE from 'three';
import fit from './capture-scene-sky.json' with {type:'json'};

/** World-direction background fitted to open sky in photo 01. */
export function createCaptureSky() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      coeff: {value: fit.srgbDN.map(rgb => new THREE.Vector3().fromArray(rgb))},
      right: {value: new THREE.Vector3().fromArray(fit.right)},
      az: {value: new THREE.Vector2().fromArray(fit.azBounds)},
      elevation: {value: new THREE.Vector2().fromArray(fit.elevationBounds)},
    },
    vertexShader: `
      varying vec3 skyDirection;
      void main() {
        skyDirection = position;
        vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = clip.xyww;
      }`,
    fragmentShader: `
      varying vec3 skyDirection;
      uniform vec3 coeff[4];
      uniform vec3 right;
      uniform vec2 az;
      uniform vec2 elevation;
      void main() {
        vec3 ray = normalize(skyDirection);
        float x = clamp(dot(ray, right), az.x, az.y);
        float y = clamp(ray.y, elevation.x, elevation.y);
        vec3 displayRGB = coeff[0] + x*coeff[1] + y*coeff[2] + y*y*coeff[3];
        gl_FragColor = vec4(clamp(displayRGB / 255.0, 0.0, 1.0), 1.0);
      }`,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const sky = new THREE.Mesh(new THREE.BoxGeometry(2,2,2),material);
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  return sky;
}
