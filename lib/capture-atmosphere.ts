import * as THREE from 'three';

/**
 * Clear-sky daylight for the captured lawn.
 *
 * One sky function supplies the visible dome, the image-based ambient light and
 * the aerial-perspective colour, and the directional sun uses the same vector,
 * so the three stay mutually consistent.
 *
 * The vertical colour profile is anchored to open-sky pixels of photograph 01
 * (elevations 4 to 26 degrees; display sRGB) and extended to the zenith with the
 * usual clear-sky darkening. The circumsolar brightening and everything outside
 * the photographed window are priors. The sun vector is the one the
 * photographed shadows were registered against.
 */
export const captureSunDirection = new THREE.Vector3(-18, 24, 9).normalize();

// Display sRGB anchors: horizon haze, 25 degrees, zenith.
const horizon = new THREE.Color().setRGB(206/255, 229/255, 249/255, THREE.SRGBColorSpace);
const middle = new THREE.Color().setRGB(132/255, 172/255, 233/255, THREE.SRGBColorSpace);
const zenith = new THREE.Color().setRGB(52/255, 104/255, 204/255, THREE.SRGBColorSpace);
const aureole = new THREE.Color(1, .96, .88);
// Sunlit lawn and paving returning light upward into the lower hemisphere.
const groundReturn = new THREE.Color(.21, .26, .09);

// Clear-sky direct to diffuse irradiance on a horizontal surface is roughly 5:1.
// The radiometric scale is relative; exposure maps it to display.
const sunIrradiance = 5, skyRadiance = 2.3;

const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Linear sky colour toward a unit direction, without the solar disc. */
export function captureSkyColour(ray: THREE.Vector3, target = new THREE.Color()) {
  const up = THREE.MathUtils.clamp(ray.y, 0, 1);
  // Optical path grows quickly near the horizon: most of the change happens low.
  const low = 1 - Math.exp(-up * 7.5), high = smooth(.3, 1, up);
  target.copy(horizon).lerp(middle, low).lerp(zenith, high);
  // Forward scattering by haze: a broad, pale aureole around the sun.
  const toSun = Math.max(ray.dot(captureSunDirection), 0);
  const glow = .16 * toSun**6 + .5 * toSun**90;
  target.r += aureole.r * glow; target.g += aureole.g * glow; target.b += aureole.b * glow;
  return target;
}

/** Equirectangular radiance map of the sky function. `ground` fills the lower hemisphere. */
function skyTexture(width: number, height: number, gain: number, ground?: THREE.Color) {
  const data = new Uint16Array(width * height * 4);
  const ray = new THREE.Vector3(), colour = new THREE.Color();
  for (let j = 0; j < height; j++) {
    const elevation = ((j + .5) / height - .5) * Math.PI;
    for (let i = 0; i < width; i++) {
      const azimuth = ((i + .5) / width - .5) * 2 * Math.PI;
      ray.set(Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.sin(azimuth));
      captureSkyColour(ray, colour).multiplyScalar(gain);
      if (ground) colour.lerp(ground, 1 - smooth(-.05, .02, ray.y));
      const k = (j * width + i) * 4;
      data[k] = THREE.DataUtils.toHalfFloat(colour.r);
      data[k + 1] = THREE.DataUtils.toHalfFloat(colour.g);
      data[k + 2] = THREE.DataUtils.toHalfFloat(colour.b);
      data[k + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

export function createCaptureAtmosphere(renderer: THREE.WebGLRenderer, scene: THREE.Scene, shadowMapSize = 4096) {
  // Visible dome: the photographed colours, shown as photographed.
  const domeMap = skyTexture(1024, 512, 1);
  const sky = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.ShaderMaterial({
    uniforms: {map: {value: domeMap}, sunDirection: {value: captureSunDirection}},
    vertexShader: /* glsl */`
      varying vec3 skyRay;
      void main() {
        skyRay = position;
        vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.);
        gl_Position = clip.xyww;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 skyRay;
      uniform sampler2D map;
      uniform vec3 sunDirection;
      void main() {
        vec3 ray = normalize(skyRay);
        // Below the horizon only distant ground haze is ever seen.
        float elevation = asin(clamp(ray.y, 0., 1.));
        vec2 uv = vec2(atan(ray.z, ray.x) * .15915494 + .5, elevation * .31830989 + .5);
        // The azimuth seam would otherwise select a coarse derivative.
        vec3 colour = textureLod(map, uv, 0.).rgb;
        float disc = smoothstep(.99988, .99996, dot(ray, sunDirection));
        gl_FragColor = vec4(mix(colour, vec3(1.), disc), 1.);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
  }));
  sky.name = 'Photographed clear sky';
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  scene.add(sky);

  // Ambient probe: the same function as radiance. It carries no solar disc: the
  // disc is the directional light, and counting it twice doubles every sunlit
  // surface.
  const probeMap = skyTexture(256, 128, skyRadiance, groundReturn);
  probeMap.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(probeMap);
  pmrem.dispose();
  probeMap.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = 1;

  const sun = new THREE.DirectionalLight(new THREE.Color(1, .95, .85), sunIrradiance);
  sun.name = 'Sun';
  sun.position.copy(captureSunDirection).multiplyScalar(46);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, {left: -30, right: 30, top: 28, bottom: -28, near: 1, far: 120});
  sun.shadow.camera.updateProjectionMatrix();
  const size = Math.min(shadowMapSize, renderer.capabilities.maxTextureSize);
  sun.shadow.mapSize.set(size, size);
  sun.shadow.bias = -.00012;
  sun.shadow.normalBias = .018;
  sun.shadow.radius = 2.2;
  scene.add(sun, sun.target);

  // Aerial perspective toward the photographed horizon colour.
  scene.fog = new THREE.FogExp2(horizon.clone().multiplyScalar(.9), .0036);

  return {
    sky, sun,
    dispose() {
      scene.environment = null;
      scene.fog = null;
      environment.dispose();
      domeMap.dispose();
      sky.geometry.dispose();
      sky.material.dispose();
      sun.shadow.dispose();
    },
  };
}
