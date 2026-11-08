import * as THREE from 'three';

type Disposable = { dispose(): void };
type Ownership = { owner: ResourceScope; persistent: boolean };
const ownership = new WeakMap<Disposable, Ownership>();

/** Each GPU resource has one owner. Cached resources survive individual model removal. */
export class ResourceScope {
  private resources = new Set<Disposable>();
  private closed = false;

  own<T extends Disposable>(resource: T, persistent = false): T {
    if (ownership.has(resource)) return resource;
    if (this.closed) {
      resource.dispose();
      return resource;
    }
    this.resources.add(resource);
    ownership.set(resource, { owner: this, persistent });
    return resource;
  }

  capture(root: THREE.Object3D, persistent = false) {
    visitResources(root, (resource) => this.own(resource, persistent));
  }

  release(resource: Disposable) {
    if (!this.resources.delete(resource)) return;
    ownership.delete(resource);
    resource.dispose();
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    for (const resource of [...this.resources]) this.release(resource);
  }
}

function visitResources(root: THREE.Object3D, visit: (resource: Disposable) => void) {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      visit(node.geometry);
      const materials = Array.isArray(node.material) ? [...node.material] : [node.material];
      if (node.customDepthMaterial) materials.push(node.customDepthMaterial);
      if (node.customDistanceMaterial) materials.push(node.customDistanceMaterial);
      for (const material of materials) {
        visit(material);
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) visit(value);
      }
      if (node instanceof THREE.InstancedMesh) visit(node);
    } else if (node instanceof THREE.Sprite) {
      visit(node.material);
      if (node.material.map) visit(node.material.map);
    }
  });
}

/** Release unique instance resources without touching cached geometry, colors or images. */
export function releaseObjectResources(root: THREE.Object3D) {
  visitResources(root, (resource) => {
    const entry = ownership.get(resource);
    if (entry && !entry.persistent) entry.owner.release(resource);
  });
}
