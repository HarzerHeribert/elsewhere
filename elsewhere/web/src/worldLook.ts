import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
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

/** Tinted occlusion, filmic tone mapping and the world's grade, in one pass to the screen. */
const GRADE = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tOcclusion;
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

/**
 * The world's light pipeline: HDR scene, depth-only contact shading, a soft bloom on
 * sunlit and lamplit surfaces, then one filmic grade. Software and WebGL1 renderers
 * draw directly with the same exposure, so the world stays usable everywhere.
 */
export function createWorldLook(renderer: THREE.WebGLRenderer): WorldLook {
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
  const sceneTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: 4,
    depthTexture: depth,
  });
  const occlusionTarget = new THREE.WebGLRenderTarget(size.x >> 1, size.y >> 1, {
    depthBuffer: false,
  });
  const occlusion = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: OCCLUSION,
    uniforms: {
      tDepth: { value: depth },
      uProjection: { value: new THREE.Matrix4() },
      uProjectionInverse: { value: new THREE.Matrix4() },
      uTexel: { value: new THREE.Vector2() },
      uRadius: { value: 0.75 },
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const grade = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: GRADE,
    uniforms: {
      tColor: { value: sceneTarget.texture },
      tOcclusion: { value: occlusionTarget.texture },
      uOcclusionTexel: { value: new THREE.Vector2() },
      uExposure: { value: WORLD_LIGHT.exposure },
      uOcclusion: { value: 0.85 },
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.7, 1.1);
  const quad = new FullScreenQuad(occlusion);
  function setSize(width: number, height: number) {
    const w = Math.max(2, Math.floor(width)),
      h = Math.max(2, Math.floor(height));
    sceneTarget.setSize(w, h);
    occlusionTarget.setSize(w >> 1, h >> 1);
    bloom.setSize(w, h);
    occlusion.uniforms.uTexel!.value.set(1 / w, 1 / h);
    grade.uniforms.uOcclusionTexel!.value.set(1 / (w >> 1), 1 / (h >> 1));
  }
  setSize(size.x, size.y);

  return {
    enabled: true,
    render(scene, camera) {
      renderer.setRenderTarget(sceneTarget);
      renderer.render(scene, camera);
      occlusion.uniforms.uProjection!.value.copy(camera.projectionMatrix);
      occlusion.uniforms.uProjectionInverse!.value.copy(camera.projectionMatrixInverse);
      quad.material = occlusion;
      renderer.setRenderTarget(occlusionTarget);
      quad.render(renderer);
      // Adds the glow onto the resolved scene colour.
      bloom.render(renderer, sceneTarget, sceneTarget, 0, false);
      quad.material = grade;
      renderer.setRenderTarget(null);
      quad.render(renderer);
    },
    setSize,
    dispose() {
      sceneTarget.dispose();
      depth.dispose();
      occlusionTarget.dispose();
      occlusion.dispose();
      grade.dispose();
      bloom.dispose();
      quad.dispose();
    },
  };
}
