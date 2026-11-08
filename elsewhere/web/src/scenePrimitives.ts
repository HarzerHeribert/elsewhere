import * as THREE from 'three';
import type { createEnvironmentMaterials } from './materials';
import type { EnvironmentMaterial } from './materials';
import type { ResourceScope } from './sceneResources';

export const SCENE_COLORS = {
  forest: 0x31594c,
  moss: 0x87996d,
  paper: 0xf4efdf,
  clay: 0xc58762,
  wood: 0xa5754c,
};

/** Shared primitive styling and cached colors for authored objects and world scenery. */
export function createScenePrimitives({
  scene,
  resources,
  surfaces,
}: {
  scene: THREE.Scene;
  resources: ResourceScope;
  surfaces: ReturnType<typeof createEnvironmentMaterials>;
}) {
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  function material(color: THREE.ColorRepresentation) {
    const key = String(color);
    let m = materials.get(key);
    if (!m) {
      m = resources.own(new THREE.MeshStandardMaterial({ color, roughness: 0.85 }), true);
      materials.set(key, m);
    }
    return m;
  }

  function surface(
    mesh: THREE.Mesh,
    kind: EnvironmentMaterial,
    repeatX: number,
    repeatY: number,
    tint = 0xffffff,
  ) {
    mesh.material = surfaces.material(kind, {
      repeat: [repeatX, repeatY],
      tint,
      normalStrength: kind === 'stone' ? 0.38 : 0.2,
      envMapIntensity: 0.55,
    });
  }

  function box(
    w: number,
    h: number,
    d: number,
    color: THREE.ColorRepresentation,
    x = 0,
    y = 0,
    z = 0,
    parent: THREE.Object3D = scene,
  ) {
    const o = new THREE.Mesh(resources.own(new THREE.BoxGeometry(w, h, d)), material(color));
    o.position.set(x, y + h / 2, z);
    o.castShadow = true;
    o.receiveShadow = true;
    parent.add(o);
    return o;
  }

  function cylinder(
    r: number,
    h: number,
    color: THREE.ColorRepresentation,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = scene,
    sides = 16,
  ) {
    const o = new THREE.Mesh(
      resources.own(new THREE.CylinderGeometry(r, r, h, sides)),
      material(color),
    );
    o.position.set(x, y + h / 2, z);
    o.castShadow = true;
    o.receiveShadow = true;
    parent.add(o);
    return o;
  }

  function sphere(
    r: number,
    color: THREE.ColorRepresentation,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = scene,
  ) {
    const o = new THREE.Mesh(resources.own(new THREE.SphereGeometry(r, 12, 9)), material(color));
    o.position.set(x, y, z);
    o.castShadow = true;
    parent.add(o);
    return o;
  }
  return { material, surface, box, cylinder, sphere };
}
export type ScenePrimitives = ReturnType<typeof createScenePrimitives>;
