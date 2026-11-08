import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import type { createEnvironmentMaterials } from './materials';
import { ResourceScope } from './sceneResources';
import { landscapeHeight } from './landscapeLayout';

const SKY_URL = '/assets/polyhaven/kloofendal_48d_partly_cloudy_puresky_1k.hdr';

/** Local CC0 sky + image-based light; Three's analytic Sky is the loading fallback. */
export function createAtmosphere(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  surfaces: ReturnType<typeof createEnvironmentMaterials>,
) {
  const resources = new ResourceScope();
  let disposed = false;
  const sky = new Sky();
  sky.scale.setScalar(450000);
  const uniforms = sky.material.uniforms;
  uniforms.turbidity!.value = 2.5;
  uniforms.rayleigh!.value = 2;
  uniforms.mieCoefficient!.value = 0.003;
  uniforms.mieDirectionalG!.value = 0.76;
  const sunDirection = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(42),
    THREE.MathUtils.degToRad(225),
  );
  uniforms.sunPosition!.value.copy(sunDirection);
  scene.add(sky);
  const hemisphere = new THREE.HemisphereLight(0xdde9f1, 0x777556, 1);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffe1b2, 3.1);
  sun.position.copy(sunDirection).multiplyScalar(75);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, {
    left: -43,
    right: 43,
    top: 37,
    bottom: -37,
    near: 1,
    far: 160,
  });
  sun.shadow.normalBias = 0.015;
  sun.shadow.bias = -0.0001;
  sun.shadow.radius = 3;
  scene.add(sun);

  const generator = new THREE.PMREMGenerator(renderer);
  let generatorDisposed = false;
  const disposeGenerator = () => {
    if (!generatorDisposed) {
      generatorDisposed = true;
      generator.dispose();
    }
  };
  const environmentScene = new THREE.Scene();
  environmentScene.add(sky.clone());
  let environment = generator.fromScene(environmentScene, 0.02, 0.1, 1000000);
  let skyTexture: THREE.DataTexture | undefined;
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.5;
  scene.fog = new THREE.Fog(0xcddcda, 75, 205);
  renderer.domElement.dataset.sky = 'loading';

  // A single local download and prefilter, never a per-frame environment render.
  new HDRLoader().load(
    SKY_URL,
    (texture) => {
      if (disposed) {
        texture.dispose();
        return;
      }
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const next = generator.fromEquirectangular(texture);
      environment.dispose();
      environment = next;
      skyTexture = texture;
      sky.visible = false;
      scene.background = texture;
      scene.backgroundIntensity = 0.85;
      scene.backgroundBlurriness = 0;
      scene.environment = next.texture;
      // Keep both the visible sky and its reflections at the same orientation.
      // The source sun is 48° high; rotate its azimuth to the north-west key light.
      scene.backgroundRotation.y = 2.95;
      scene.environmentRotation.y = 2.95;
      renderer.domElement.dataset.sky = 'hdri';
      disposeGenerator();
    },
    undefined,
    () => {
      if (disposed) return;
      renderer.domElement.dataset.sky = 'fallback';
      disposeGenerator();
    },
  );

  // Continuous, softly lit terrain beyond the playable boundary. Its centre stays flat.
  const landscape = new THREE.Group();
  scene.add(landscape);
  const radialSegments = 160,
    rings = 12;
  const positions: number[] = [],
    indices: number[] = [];
  for (let ring = 0; ring <= rings; ring++) {
    const radius = 61 + (ring / rings) * 164;
    for (let segment = 0; segment <= radialSegments; segment++) {
      const angle = (segment / radialSegments) * Math.PI * 2;
      positions.push(
        Math.cos(angle) * radius,
        landscapeHeight(radius, angle),
        Math.sin(angle) * radius,
      );
      if (ring < rings && segment < radialSegments) {
        const a = ring * (radialSegments + 1) + segment,
          b = a + radialSegments + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const terrainGeometry = new THREE.BufferGeometry();
  terrainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  terrainGeometry.setIndex(indices);
  terrainGeometry.computeVertexNormals();
  terrainGeometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(
      positions.flatMap((value, index) =>
        index % 3 === 0 ? [value / 3, positions[index + 2]! / 3] : [],
      ),
      2,
    ),
  );
  const terrainMaterial = surfaces.material('grass', { tint: 0xb5c5a2, normalStrength: 0.65 });
  const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrain.receiveShadow = true;
  landscape.add(terrain);

  resources.capture(sky);
  resources.capture(landscape);
  // Scanned trees in forest.ts provide the horizon and playable woodland.

  return {
    // Lighting is deliberately a stable daylight art direction for this prototype.
    update(_worldTime: number) {},
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.environment = null;
      scene.background = null;
      disposeGenerator();
      environment.dispose();
      skyTexture?.dispose();
      resources.dispose();
      landscape.removeFromParent();
      sky.removeFromParent();
      hemisphere.removeFromParent();
      sun.removeFromParent();
      sun.shadow.map?.dispose();
    },
  };
}
