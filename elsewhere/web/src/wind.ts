import * as THREE from 'three';

/** One breeze for grass, flowers and leaves; advanced once per frame by the scene. */
export const windUniforms = { uWindTime: { value: 0 } };

/**
 * Sways vertices in world space. `weight` is a GLSL float expression over the local
 * `position` (0 = rooted, 1 = free), so stems stay planted while tips move.
 */
export function applyWind<T extends THREE.Material>(
  material: T,
  { weight, strength, key }: { weight: string; strength: number; key: string },
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniforms.uWindTime;
    shader.vertexShader =
      'uniform float uWindTime;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec4 windRoot = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          #else
            vec4 windRoot = modelMatrix * vec4(position, 1.0);
          #endif
          float windWeight = ${weight};
          float gust = sin(uWindTime * 1.3 + windRoot.x * 0.21 + windRoot.z * 0.17);
          float flutter = sin(uWindTime * 3.7 + windRoot.x * 1.9 + windRoot.z * 2.3 + position.y * 4.0);
          float sway = (gust * 0.75 + flutter * 0.25) * windWeight * ${strength.toFixed(4)};
          transformed.x += sway;
          transformed.z += sway * 0.6;
        }`,
      );
  };
  material.customProgramCacheKey = () => `wind:${key}`;
  return material;
}
