import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { WORLD_LIGHT } from './worldStyle';

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Contact shading from the depth buffer alone, so alpha-cut leaves occlude as leaves. */
const OCCLUSION = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 uProjection;
  uniform mat4 uProjectionInverse;
  uniform vec2 uTexel;
  uniform float uRadius;
  varying vec2 vUv;

  vec3 viewPosition(vec2 uv) {
    vec4 clip = vec4(uv * 2.0 - 1.0, texture2D(tDepth, uv).x * 2.0 - 1.0, 1.0);
    vec4 view = uProjectionInverse * clip;
    return view.xyz / view.w;
  }
  void main() {
    if (texture2D(tDepth, vUv).x >= 0.99999) {
      gl_FragColor = vec4(1.0);
      return;
    }
    vec3 p = viewPosition(vUv);
    vec3 right = viewPosition(vUv + vec2(uTexel.x, 0.0)), left = viewPosition(vUv - vec2(uTexel.x, 0.0));
    vec3 above = viewPosition(vUv + vec2(0.0, uTexel.y)), below = viewPosition(vUv - vec2(0.0, uTexel.y));
    vec3 dx = abs(right.z - p.z) < abs(p.z - left.z) ? right - p : p - left;
    vec3 dy = abs(above.z - p.z) < abs(p.z - below.z) ? above - p : p - below;
    vec3 n = normalize(cross(dx, dy));
    // A 4 x 4 rotation pattern; the composite pass averages it away with a 4 x 4 blur.
    vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
    float turn = fract(52.9829189 * fract(dot(cell, vec2(0.06711056, 0.00583715)))) * 6.2831853;
    float reach = uRadius * uProjection[1][1] * 0.5 / max(0.2, -p.z);
    float aspect = uProjection[1][1] / uProjection[0][0];
    float occlusion = 0.0;
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      float r = sqrt((fi + 0.5) / 12.0);
      float a = turn + fi * 2.3999632;
      vec2 offset = vec2(cos(a) / aspect, sin(a)) * r * reach;
      vec3 v = viewPosition(vUv + offset) - p;
      float d2 = dot(v, v);
      float inRange = 1.0 - smoothstep(uRadius * uRadius * 0.7, uRadius * uRadius * 1.6, d2);
      occlusion += inRange * max(0.0, dot(v, n) - 0.012 - 0.0022 * -p.z) / (d2 + 0.006);
    }
    float ao = clamp(1.0 - occlusion * uRadius * 0.21, 0.0, 1.0);
    ao = mix(ao, 1.0, smoothstep(45.0, 95.0, -p.z));
    gl_FragColor = vec4(vec3(ao), 1.0);
  }
`;

/** Keeps what outshines sunlit paper, at half size, as the seed of the glow. */
const GLOW_BRIGHT = /* glsl */ `
  uniform sampler2D tColor;
  uniform vec2 uTexel;
  uniform float uThreshold;
  varying vec2 vUv;

  vec3 bright(vec2 uv) {
    vec3 c = min(texture2D(tColor, uv).rgb, vec3(32.0));
    return c * smoothstep(uThreshold, uThreshold + 0.01, dot(c, vec3(0.2126, 0.7152, 0.0722)));
  }
  void main() {
    // Every glint on a leaf or a ripple keeps its full energy: together they are the haze.
    vec3 sum = bright(vUv + uTexel * vec2(-0.5, -0.5)) + bright(vUv + uTexel * vec2(0.5, -0.5))
      + bright(vUv + uTexel * vec2(-0.5, 0.5)) + bright(vUv + uTexel * vec2(0.5, 0.5));
    gl_FragColor = vec4(sum / 4.0, 1.0);
  }
`;

/** Halves a glow level; every level down is a wider, cheaper blur. */
const GLOW_DOWN = /* glsl */ `
  uniform sampler2D tColor;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec3 sum = texture2D(tColor, vUv).rgb * 4.0;
    sum += texture2D(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
    sum += texture2D(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb;
    sum += texture2D(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
    sum += texture2D(tColor, vUv + uTexel * vec2(1.0, 1.0)).rgb;
    gl_FragColor = vec4(sum / 8.0, 1.0);
  }
`;

/** Spreads the wider level below back up and adds this level's own share. */
const GLOW_UP = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tBase;
  uniform vec2 uTexel;
  uniform vec2 uWeight;
  varying vec2 vUv;
  void main() {
    vec2 h = uTexel * 0.5;
    vec3 sum = texture2D(tColor, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
    sum += texture2D(tColor, vUv + vec2(-h.x, h.y)).rgb * 2.0;
    sum += texture2D(tColor, vUv + vec2(0.0, h.y * 2.0)).rgb;
    sum += texture2D(tColor, vUv + vec2(h.x, h.y)).rgb * 2.0;
    sum += texture2D(tColor, vUv + vec2(h.x * 2.0, 0.0)).rgb;
    sum += texture2D(tColor, vUv + vec2(h.x, -h.y)).rgb * 2.0;
    sum += texture2D(tColor, vUv + vec2(0.0, -h.y * 2.0)).rgb;
    sum += texture2D(tColor, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
    gl_FragColor = vec4(texture2D(tBase, vUv).rgb * uWeight.x + sum / 12.0 * uWeight.y, 1.0);
  }
`;

/** Tinted occlusion, the glow, filmic tone mapping and the world's grade, in one pass. */
const GRADE = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tOcclusion;
  uniform sampler2D tGlow;
  uniform vec2 uOcclusionTexel;
  uniform float uExposure;
  uniform float uOcclusion;
  varying vec2 vUv;

  vec3 filmicFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }
  vec3 filmic(vec3 color) {
    const mat3 inputMatrix = mat3(
      vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 outputMatrix = mat3(
      vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    return clamp(outputMatrix * filmicFit(inputMatrix * (color * uExposure / 0.6)), 0.0, 1.0);
  }
  vec3 encode(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  void main() {
    vec3 color = texture2D(tColor, vUv).rgb;
    float ao = 0.0;
    for (int x = 0; x < 4; x++)
      for (int y = 0; y < 4; y++)
        ao += texture2D(tOcclusion, vUv + (vec2(float(x), float(y)) - 1.5) * uOcclusionTexel).r;
    ao = mix(1.0, ao / 16.0, uOcclusion);
    // Creases fall towards a cool sky-shadow, never to flat black.
    color *= mix(vec3(0.16, 0.2, 0.3), vec3(1.0), ao);
    color += texture2D(tGlow, vUv).rgb;
    color = filmic(color);
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luma), color, 1.14);
    color *= mix(vec3(0.95, 0.99, 1.07), vec3(1.05, 1.01, 0.93), smoothstep(0.05, 0.85, luma));
    color = clamp((color - 0.5) * 1.05 + 0.5, 0.0, 1.0);
    vec2 centred = vUv - 0.5;
    color *= 1.0 - 0.3 * smoothstep(0.32, 0.95, dot(centred, centred) * 2.0);
    float grain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    gl_FragColor = vec4(encode(color) + (grain - 0.5) / 255.0, 1.0);
  }
`;

/** How strongly each glow level, from tight to wide, joins the picture. */
const GLOW_LEVELS = [0.36, 0.42, 0.48, 0.54, 0.6, 0.6].map((share) => share * 0.32);
const GLOW_THRESHOLD = 1.1;

function softwareRenderer(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '');
  return /swiftshader|llvmpipe|software/i.test(name);
}

export interface WorldLook {
  /** True when the full light pipeline runs; false on the direct fallback. */
  readonly enabled: boolean;
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

/**
 * The world's light pipeline: HDR scene, depth-only contact shading, a soft glow on
 * sunlit and lamplit surfaces, one filmic grade, then edge smoothing. Every pass after
 * the scene is a single full-screen draw, and the glow works at half size and below, so
 * the whole pipeline costs a fraction of drawing the world itself. Software and WebGL1
 * renderers draw directly with the same exposure, so the world stays usable everywhere.
 */
export function createWorldLook(renderer: THREE.WebGLRenderer): WorldLook {
  // Nothing is multisampled any more, so leaf cards that ask for alpha-to-coverage are cut
  // where they would have been half covered: the same average cover, decided per pixel.
  THREE.ShaderChunk.alphatest_fragment = THREE.ShaderChunk.alphatest_fragment.replace(
    'if ( diffuseColor.a == 0.0 ) discard;',
    'if ( diffuseColor.a < 0.5 ) discard;',
  );
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = WORLD_LIGHT.exposure;
  const direct: WorldLook = {
    enabled: false,
    render: (scene, camera) => renderer.render(scene, camera),
    setSize() {},
    dispose() {},
  };
  if (!renderer.capabilities.isWebGL2 || softwareRenderer(renderer)) return direct;

  const size = renderer.getDrawingBufferSize(new THREE.Vector2()).max(new THREE.Vector2(2, 2));
  const depth = new THREE.DepthTexture(size.x, size.y);
  depth.type = THREE.UnsignedIntType;
  // Edges are smoothed after grading, so the scene itself is drawn without multisampling.
  const sceneTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    depthTexture: depth,
  });
  const occlusionTarget = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });
  const gradedTarget = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });
  const glowTarget = () =>
    new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
  const glowDown = GLOW_LEVELS.map(glowTarget),
    glowUp = GLOW_LEVELS.slice(1).map(glowTarget);
  const occlusion = pass(OCCLUSION, {
    tDepth: { value: depth },
    uProjection: { value: new THREE.Matrix4() },
    uProjectionInverse: { value: new THREE.Matrix4() },
    uTexel: { value: new THREE.Vector2() },
    uRadius: { value: 0.75 },
  });
  const bright = pass(GLOW_BRIGHT, {
    tColor: { value: sceneTarget.texture },
    uTexel: { value: new THREE.Vector2() },
    uThreshold: { value: GLOW_THRESHOLD },
  });
  const down = pass(GLOW_DOWN, {
    tColor: { value: null },
    uTexel: { value: new THREE.Vector2() },
  });
  const up = pass(GLOW_UP, {
    tColor: { value: null },
    tBase: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uWeight: { value: new THREE.Vector2() },
  });
  const grade = pass(GRADE, {
    tColor: { value: sceneTarget.texture },
    tOcclusion: { value: occlusionTarget.texture },
    tGlow: { value: glowUp[0]!.texture },
    uOcclusionTexel: { value: new THREE.Vector2() },
    uExposure: { value: WORLD_LIGHT.exposure },
    uOcclusion: { value: 0.85 },
  });
  const smooth = new THREE.ShaderMaterial({
    vertexShader: FXAAShader.vertexShader,
    // Edges are smoothed at full strength; lone bright pixels are mostly left alone, so
    // sunlit leaves and grass keep their sparkle instead of blurring to a flat green.
    fragmentShader: FXAAShader.fragmentShader
      .replace('_SubpixelBlending = 1.0', '_SubpixelBlending = 0.35')
      .replace('_RelativeThreshold = 0.063', '_RelativeThreshold = 0.125')
      .replace('_ContrastThreshold = 0.0312', '_ContrastThreshold = 0.05'),
    uniforms: {
      tDiffuse: { value: gradedTarget.texture },
      resolution: { value: new THREE.Vector2() },
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const quad = new FullScreenQuad(occlusion);
  function draw(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    quad.material = material;
    renderer.setRenderTarget(target);
    quad.render(renderer);
  }
  function setSize(width: number, height: number) {
    const w = Math.max(2, Math.floor(width)),
      h = Math.max(2, Math.floor(height));
    sceneTarget.setSize(w, h);
    gradedTarget.setSize(w, h);
    occlusionTarget.setSize(w >> 1, h >> 1);
    glowDown.forEach((target, level) =>
      target.setSize(Math.max(2, w >> (level + 1)), Math.max(2, h >> (level + 1))),
    );
    glowUp.forEach((target, level) =>
      target.setSize(glowDown[level]!.width, glowDown[level]!.height),
    );
    occlusion.uniforms.uTexel!.value.set(1 / w, 1 / h);
    bright.uniforms.uTexel!.value.set(1 / w, 1 / h);
    grade.uniforms.uOcclusionTexel!.value.set(1 / (w >> 1), 1 / (h >> 1));
    smooth.uniforms.resolution!.value.set(1 / w, 1 / h);
  }
  setSize(size.x, size.y);

  return {
    enabled: true,
    render(scene, camera) {
      renderer.setRenderTarget(sceneTarget);
      renderer.render(scene, camera);
      occlusion.uniforms.uProjection!.value.copy(camera.projectionMatrix);
      occlusion.uniforms.uProjectionInverse!.value.copy(camera.projectionMatrixInverse);
      draw(occlusion, occlusionTarget);
      draw(bright, glowDown[0]!);
      for (let level = 1; level < glowDown.length; level++) {
        const source = glowDown[level - 1]!;
        down.uniforms.tColor!.value = source.texture;
        down.uniforms.uTexel!.value.set(1 / source.width, 1 / source.height);
        draw(down, glowDown[level]!);
      }
      for (let level = glowUp.length - 1; level >= 0; level--) {
        const widest = level === glowUp.length - 1,
          source = widest ? glowDown[level + 1]! : glowUp[level + 1]!;
        up.uniforms.tColor!.value = source.texture;
        up.uniforms.tBase!.value = glowDown[level]!.texture;
        up.uniforms.uTexel!.value.set(1 / source.width, 1 / source.height);
        up.uniforms.uWeight!.value.set(GLOW_LEVELS[level]!, widest ? GLOW_LEVELS[level + 1]! : 1);
        draw(up, glowUp[level]!);
      }
      draw(grade, gradedTarget);
      draw(smooth, null);
    },
    setSize,
    dispose() {
      for (const target of [sceneTarget, occlusionTarget, gradedTarget, ...glowDown, ...glowUp])
        target.dispose();
      depth.dispose();
      for (const material of [occlusion, bright, down, up, grade, smooth]) material.dispose();
      quad.dispose();
    },
  };
}
