import * as THREE from 'three';

/** Raycaster ignores visibility, including visibility inherited from a parent. */
export function isVisiblePickTarget(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible || node.userData.decorative) return false;
  }
  return true;
}

export function firstVisibleIntersection(ray: THREE.Raycaster, roots: THREE.Object3D[]) {
  return ray.intersectObjects(roots, true).find((hit) => isVisiblePickTarget(hit.object));
}

export function decorative<T extends THREE.Object3D>(object: T): T {
  object.userData.decorative = true;
  object.raycast = () => {};
  return object;
}
