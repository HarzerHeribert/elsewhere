import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import type { createEnvironmentMaterials } from './materials';
import { ResourceScope } from './sceneResources';
import { landscapeHeight } from './landscapeLayout';
import { WORLD_LIGHT } from './worldStyle';

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
    THREE.MathUtils.degToRad(WORLD_LIGHT.sunPolar),
    THREE.MathUtils.degToRad(WORLD_LIGHT.sunAzimuth),
  );
  uniforms.sunPosition!.value.copy(sunDirection);
  scene.add(sky);
  const hemisphere = new THREE.HemisphereLight(
    WORLD_LIGHT.sky,
    WORLD_LIGHT.ground,
    WORLD_LIGHT.fillIntensity,
  );
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(WORLD_LIGHT.sun, WORLD_LIGHT.sunIntensity);
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
  sun.shadow.radius = 4;
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
  scene.environmentIntensity = WORLD_LIGHT.environmentIntensity;
  scene.fog = new THREE.Fog(WORLD_LIGHT.haze, WORLD_LIGHT.hazeNear, WORLD_LIGHT.hazeFar);
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
  // A single grid spans the walkable meadow and the whole horizon, with continuous UVs.
  const terrainGeometry = new THREE.PlaneGeometry(460, 460, 156, 156);
  terrainGeometry.rotateX(-Math.PI / 2);
  const vertices = terrainGeometry.getAttribute('position');
  const uvs = terrainGeometry.getAttribute('uv');
  const colors: number[] = [];
  const color = new THREE.Color();
  // The leafy-grass scan is straw coloured; these multipliers bring it to the meadow's green.
  const shadowGreen = new THREE.Color(0.3, 0.72, 0.38),
    sunGreen = new THREE.Color(0.46, 0.96, 0.46);
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i),
      z = vertices.getZ(i);
    vertices.setY(i, landscapeHeight(Math.hypot(x, z), Math.atan2(z, x)));
    uvs.setXY(i, x / 2.8, z / 2.8);
    const patch =
      0.5 +
      0.25 * Math.sin(x * 0.22 + z * 0.09) +
      0.15 * Math.cos(z * 0.35 - x * 0.17) +
      0.1 * Math.cos(x * 0.47 + z * 0.33);
    color.lerpColors(shadowGreen, sunGreen, patch);
    colors.push(color.r, color.g, color.b);
  }
  terrainGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  terrainGeometry.computeVertexNormals();
  const terrainMaterial = surfaces.material('grass', { normalStrength: 0.48 });
  terrainMaterial.vertexColors = true;
  // Grass is matte: without this the valley floor picks up a milky sky sheen at eye level.
  terrainMaterial.envMapIntensity = 0.25;
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
