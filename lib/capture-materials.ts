import * as THREE from 'three';

/**
 * Appearance models for captured organs. They change shading only: no vertex,
 * attachment or collision geometry moves, so the mechanics read the same mesh.
 */

const leafGain = new THREE.Color(2.6, 2.2, 1.2);
const dirBlock = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
const dirCall = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

/** Insert GLSL after the directional-light evaluation of the stock light loop. */
function afterSunLight(extra: string) {
  const source = THREE.ShaderChunk.lights_fragment_begin;
  const block = source.indexOf(dirBlock), call = source.indexOf(dirCall, block);
  if (block < 0 || call < 0) throw new Error('Unsupported three.js light loop');
  return source.slice(0, call + dirCall.length) + extra + source.slice(call + dirCall.length);
}

const noise = /* glsl */`
  float captureHash(vec3 p) {
    p = fract(p * .3183099 + vec3(.71, .113, .419));
    p *= 17.;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float captureNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3. - 2. * f);
    return mix(mix(mix(captureHash(i), captureHash(i + vec3(1,0,0)), f.x),
                   mix(captureHash(i + vec3(0,1,0)), captureHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(captureHash(i + vec3(0,0,1)), captureHash(i + vec3(1,0,1)), f.x),
                   mix(captureHash(i + vec3(0,1,1)), captureHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
`;

/**
 * Broadleaf lamina. A leaf is a thin scattering sheet: of the sunlight it does
 * not reflect, a comparable fraction leaves through the far face, shifted toward
 * yellow-green because chlorophyll absorbs blue and red. The stock two-sided
 * surface shades a backlit blade black. The transmitted lobe here is diffuse
 * and is attenuated by the same shadow as the reflected lobe.
 *
 * `transmission` is the ratio of transmitted to reflected diffuse albedo per
 * channel. Values follow the shape of broadleaf spectra (PROSPECT family);
 * they are not measured on the campus trees.
 */
export function shadeAsLeaf(material: THREE.MeshStandardMaterial,
  options: {transmission?: THREE.Color; gain?: THREE.Color; outline?: boolean; flutter?: {value: THREE.Vector2}} = {}) {
  const transmission = options.transmission ?? new THREE.Color(.92, 1.18, .28);
  const gain = options.gain ?? leafGain, outline = options.outline === true;
  const flutter = options.flutter ?? {value: new THREE.Vector2()};
  if (material.userData.captureLeaf) return;
  material.userData.captureLeaf = true;
  material.side = THREE.DoubleSide;
  material.roughness = Math.min(material.roughness, .52);
  material.metalness = 0;
  const lights = afterSunLight(/* glsl */`
    {
      float leafBack = saturate( dot( -geometryNormal, directLight.direction ) );
      reflectedLight.directDiffuse += leafBack * directLight.color * captureLeafTransmission * material.diffuseColor * RECIPROCAL_PI;
    }
  `);
  material.onBeforeCompile = shader => {
    shader.uniforms.captureLeafTransmission = {value: transmission};
    shader.uniforms.captureLeafGain = {value: gain};
    shader.uniforms.captureLeafFlutter = flutter;
    shader.vertexShader = 'uniform vec2 captureLeafFlutter;\nvarying vec3 vCaptureLeafWorld;\nvarying vec2 vCaptureLeafUv;\n' + shader.vertexShader.replace('#include <project_vertex>', /* glsl */`
      #ifdef USE_INSTANCING
        ${outline ? /* glsl */`{
          // Flutter: the lamina rocks about its petiole end, tip moving most.
          // x is elapsed seconds, y the amplitude in lamina lengths. Each leaf
          // has its own phase and a frequency near 3 Hz from where it stands.
          vec3 seat = instanceMatrix[3].xyz;
          float phase = dot( seat, vec3( 12.9898, 78.233, 37.719 ) );
          float rate = 16. + 9. * fract( phase * .37 );
          float swing = sin( captureLeafFlutter.x * rate + phase ) + .5 * sin( captureLeafFlutter.x * rate * 1.73 + phase * 1.3 );
          transformed.z += swing * captureLeafFlutter.y * uv.y * uv.y;
          transformed.x += swing * captureLeafFlutter.y * .35 * uv.y * ( uv.x - .5 );
        }` : ''}
      #endif
      #include <project_vertex>
      #ifdef USE_INSTANCING
        vCaptureLeafWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
      #else
        vCaptureLeafWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
      #endif
      vCaptureLeafUv = uv;
    `);
    shader.fragmentShader = 'uniform vec3 captureLeafTransmission, captureLeafGain;\nvarying vec3 vCaptureLeafWorld;\nvarying vec2 vCaptureLeafUv;\n' + noise + shader.fragmentShader
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        ${outline ? /* glsl */`{
          // Ovate outline with an acute tip, cut from the lamina quad; the
          // midrib is paler than the blade.
          float along = vCaptureLeafUv.y, across = abs( vCaptureLeafUv.x - .5 );
          float half_ = .5 * pow( sin( 3.14159265 * pow( along, .72 ) ), .8 );
          if ( across > half_ ) discard;
          diffuseColor.rgb *= mix( 1.22, 1., smoothstep( .0, .035, across ) ) * mix( .92, 1.06, along );
        }` : ''}
        {
          // Shoot-to-shoot pigment variation at the scale of a leaf cluster.
          float cluster = captureNoise( vCaptureLeafWorld * 5.5 );
          float crown = captureNoise( vCaptureLeafWorld * .7 + 11. );
          diffuseColor.rgb *= mix( vec3( .78, .82, .70 ), vec3( 1.22, 1.16, 1.10 ), cluster ) * mix( .9, 1.1, crown );
          // The exported blade colours were picked from display pixels and are
          // about a third of the reflectance the photographed crown needs under
          // this sun. Gain per channel from the sunlit crown of photograph 01.
          diffuseColor.rgb = min( diffuseColor.rgb * captureLeafGain, vec3( .74, .66, .34 ) );
        }
      `)
      .replace('#include <lights_fragment_begin>', lights)
      .replace('#include <lights_fragment_end>', /* glsl */`
        #include <lights_fragment_end>
        // Light scattered leaf to leaf inside the crown. A single-bounce ambient
        // term treats each blade as if alone under the sky and leaves the crown
        // interior black; neighbouring foliage returns a green-shifted share.
        reflectedLight.indirectDiffuse += irradiance * captureLeafTransmission * material.diffuseColor * RECIPROCAL_PI * .55;
      `);
  };
  material.customProgramCacheKey = () => 'capture-leaf-v4-' + outline;
  material.needsUpdate = true;
}

/**
 * Bark relief. The exported stems carry either a flat colour or a single
 * photographed crop. Furrowed bark is a height field: plates separated by
 * darker, rougher fissures that run mostly along the axis. The field is
 * evaluated in mesh space so it stays fixed to the wood when a limb sways.
 * Fissure spacing and depth are visual priors, not a bark scan.
 */
export function shadeAsBark(material: THREE.MeshStandardMaterial, options: {photographed?: boolean} = {}) {
  if (material.userData.captureBark) return;
  material.userData.captureBark = true;
  const tint = options.photographed ? 0 : 1;
  material.onBeforeCompile = shader => {
    shader.uniforms.captureBarkTint = {value: tint};
    shader.vertexShader = 'varying vec3 vCaptureBark;\n' + shader.vertexShader.replace('#include <begin_vertex>', /* glsl */`
      #include <begin_vertex>
      // Metres in the mesh frame: quantised meshes carry their scale on the node.
      vCaptureBark = position * length( modelMatrix[0].xyz ) + modelMatrix[3].xyz * .37;
    `);
    shader.fragmentShader = 'uniform float captureBarkTint;\nvarying vec3 vCaptureBark;\n' + noise + /* glsl */`
      float captureBarkHeight(vec3 p) {
        // Long axis-parallel plates, broken by shorter cross cracks.
        vec3 q = p * vec3( 46., 7.5, 46. );
        float warp = captureNoise( p * vec3( 9., 3., 9. ) ) * 2.4;
        float plates = 1. - abs( 2. * captureNoise( q + warp ) - 1. );
        float cracks = 1. - abs( 2. * captureNoise( p * vec3( 120., 34., 120. ) + 7. ) - 1. );
        float grain = captureNoise( p * vec3( 420., 90., 420. ) );
        return smoothstep( .18, .92, plates ) * .72 + cracks * .2 + grain * .08;
      }
    ` + shader.fragmentShader
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        float captureBark = captureBarkHeight( vCaptureBark );
        {
          float patches = captureNoise( vCaptureBark * vec3( 2.6, 1.1, 2.6 ) + 3. );
          float lichen = smoothstep( .58, .8, captureNoise( vCaptureBark * vec3( 6., 4., 6. ) + 19. ) );
          if ( captureBarkTint < .5 ) {
            // A photographed crop keeps the sun and shade of the moment it was
            // taken, and its unseen rear is black. Keep its local contrast but
            // pull the level toward one bark albedo so the scene lights it.
            float level = dot( diffuseColor.rgb, vec3( .2126, .7152, .0722 ) );
            diffuseColor.rgb = mix( diffuseColor.rgb, vec3( .40, .34, .26 ) * clamp( level / .2, .7, 1.3 ), .8 );
          }
          vec3 plain = diffuseColor.rgb * mix( .72, 1.42, patches );
          plain = mix( plain, vec3( .33, .35, .30 ) * mix( .7, 1.1, patches ), lichen * .35 * captureBarkTint );
          diffuseColor.rgb = mix( diffuseColor.rgb, plain, .25 + .75 * captureBarkTint ) * mix( .6, 1.15, captureBark );
        }
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        #include <roughnessmap_fragment>
        roughnessFactor = clamp( roughnessFactor + ( .5 - captureBark ) * .16, .55, 1. );
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        #include <normal_fragment_maps>
        {
          // Screen-space gradient of the height field; fades before it aliases.
          vec3 dpx = dFdx( vCaptureBark ), dpy = dFdy( vCaptureBark );
          float footprint = max( length( dpx ), length( dpy ) );
          float fade = 1. - smoothstep( .004, .03, footprint );
          if ( fade > 0. ) {
            float h0 = captureBark;
            float hx = captureBarkHeight( vCaptureBark + dpx ), hy = captureBarkHeight( vCaptureBark + dpy );
            vec3 sx = dFdx( -vViewPosition ), sy = dFdy( -vViewPosition );
            vec3 r1 = cross( sy, normal ), r2 = cross( normal, sx );
            float det = dot( sx, r1 );
            vec3 gradient = sign( det ) * ( ( hx - h0 ) * r1 + ( hy - h0 ) * r2 );
            // Relief depth in metres; the stock bump-map construction.
            normal = normalize( abs( det ) * normal - .009 * fade * gradient );
          }
        }
      `);
  };
  material.customProgramCacheKey = () => 'capture-bark-v2-' + tint;
  material.needsUpdate = true;
}

const leafName = /broadleaf|foliage|leaf spray|blades/i;
const barkName = /bark|shoots|branchlets|end grain/i;

/** Classify the exported materials of a captured scene and apply organ shading. */
export function applyCaptureMaterials(root: THREE.Object3D, maxAnisotropy: number) {
  const seen = new Set<THREE.Material>();
  let leaves = 0, bark = 0;
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (seen.has(material) || !(material instanceof THREE.MeshStandardMaterial)) continue;
      seen.add(material);
      for (const map of [material.map, material.normalMap, material.roughnessMap]) {
        if (map) { map.anisotropy = Math.min(16, maxAnisotropy); map.needsUpdate = true; }
      }
      if (/tillers|turf/i.test(material.name)) continue;
      if (/granite/i.test(material.name) && material.map) {
        // The paving albedo was sampled from stone lying in open shade, lit only
        // by blue sky. Divide that illuminant out so the stone is neutral again.
        material.color.setRGB(1.1, 1, .8);
        continue;
      }
      if (leafName.test(material.name)) { shadeAsLeaf(material); leaves++; }
      else if (barkName.test(material.name)) { shadeAsBark(material, {photographed: !!material.map}); bark++; }
    }
  });
  return {leaves, bark};
}
