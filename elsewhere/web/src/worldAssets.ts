import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ResourceScope } from './sceneResources';

export const WORLD_ASSETS = {
  tree: '/assets/polyhaven/models/island_tree_02/model-high.glb',
  treeLow: '/assets/polyhaven/models/island_tree_02/model-low.glb',
  forestTree: '/assets/polyhaven/models/tree_small_02/model-high.glb',
  forestTreeLow: '/assets/polyhaven/models/tree_small_02/model-low.glb',
  treeAlternative: '/assets/polyhaven/models/fir_sapling/model-high.glb',
  treeAlternativeLow: '/assets/polyhaven/models/fir_sapling/model-low.glb',
  fern: '/assets/polyhaven/models/fern_02/model-high.glb',
  shrub: '/assets/polyhaven/models/shrub_02/model-high.glb',
  rock: '/assets/polyhaven/models/rock_07/model-high.glb',
  smallRock: '/assets/polyhaven/models/rock_07/model-high.glb',
} as const;
export interface AssetPlacement {
  height: number;
  width?: number;
  depth?: number;
  color?: THREE.ColorRepresentation;
  anchorXZ?: 'origin' | 'bounds';
  minDistance?: number;
  maxDistance?: number;
  shadow?: boolean;
}
export interface AssetInstance {
  x: number;
  y: number;
  z: number;
  height: number;
  rotationY?: number;
}
export type AssetStatus = { url: string; status: 'pending' | 'loaded' | 'failed' };
export type AttachWorldAsset = ((
  parent: THREE.Object3D,
  path: string,
  placement: number | AssetPlacement,
  fallback?: THREE.Object3D,
) => void) & {
  dispose(): void;
  detach(parent: THREE.Object3D): void;
  instances(
    parent: THREE.Object3D,
    path: string,
    placements: AssetInstance[],
    options?: {
      minDistance?: number;
      maxDistance?: number;
      shadow?: boolean;
      anchorXZ?: 'origin' | 'bounds';
    },
  ): void;
  updateVisibility(cameraPosition: THREE.Vector3, frustum?: THREE.Frustum): void;
};

/** PBR assets keep their authored material maps, alpha treatment and shared GPU resources. */
export function worldAssetLoader(
  scene: THREE.Scene,
  isAlive: () => boolean,
  onStatus?: (status: AssetStatus) => void,
): AttachWorldAsset {
  const loader = new GLTFLoader(),
    cache = new Map<string, Promise<THREE.Group>>(),
    requests = new AbortController(),
    resources = new ResourceScope(),
    closedImages = new WeakSet<object>(),
    shadowMaterials = new Map<THREE.Material, THREE.MeshDepthMaterial>(),
    tuned = new Map<string, THREE.Material>();
  const singles: Array<{
    object: THREE.Object3D;
    parent: THREE.Object3D;
    distance: number;
    minimum: number;
  }> = [];
  const batches: Array<{
    meshes: THREE.InstancedMesh[];
    matrices: THREE.Matrix4[][];
    positions: THREE.Vector3[];
    radii: number[];
    active: boolean[];
    distance: number;
    minimum: number;
    parent: THREE.Object3D;
  }> = [];
  let closed = false;
  let lastCamera: THREE.Vector3 | null = null;
  let lastFrustum: THREE.Frustum | undefined;
  function track(resource: THREE.BufferGeometry | THREE.Material | THREE.Texture) {
    resources.own(resource, true);
    if (resource instanceof THREE.Texture) {
      const image = resource.image as { close?: () => void } | undefined;
      if (image?.close && !closedImages.has(image)) {
        closedImages.add(image);
        resources.own({ dispose: () => image.close!() }, true);
      }
    }
  }
  function trackMaterial(material: THREE.Material) {
    track(material);
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) track(value);
  }
  function connected(parent: THREE.Object3D) {
    let ancestor: THREE.Object3D | null = parent;
    while (ancestor && ancestor !== scene) ancestor = ancestor.parent;
    return ancestor === scene;
  }
  function load(path: string) {
    let promise = cache.get(path);
    if (!promise) {
      onStatus?.({ url: path, status: 'pending' });
      promise = fetch(path, { signal: requests.signal })
        .then(async (response) => {
          if (!response.ok) throw Error('Asset unavailable');
          return loader.parseAsync(
            await response.arrayBuffer(),
            path.slice(0, path.lastIndexOf('/') + 1),
          );
        })
        .then((gltf) => {
          let meshes = 0;
          gltf.scene.traverse((object) => {
            if (object instanceof THREE.Mesh) {
              meshes++;
              track(object.geometry);
              for (const material of Array.isArray(object.material)
                ? object.material
                : [object.material])
                trackMaterial(material);
            }
          });
          if (!meshes) throw Error('Empty asset');
          bounds(gltf.scene);
          if (!closed) onStatus?.({ url: path, status: 'loaded' });
          return gltf.scene;
        })
        .catch((error) => {
          if (!closed) onStatus?.({ url: path, status: 'failed' });
          throw error;
        });
      cache.set(path, promise);
    }
    return promise;
  }
  function bounds(original: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(original),
      size = box.getSize(new THREE.Vector3()),
      center = box.getCenter(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y < 0.0001 || size.x > 10000 || size.z > 10000)
      throw Error('Invalid asset bounds');
    return { box, size, center };
  }
  function materialFor(source: THREE.Material, path: string, options: AssetPlacement) {
    // Keep authored scans. Blended leaf cards need depth-tested cutouts: a whole
    // instanced grove cannot sort thousands of overlapping transparent leaves.
    const authored = path.includes('/polyhaven/models/');
    const leafCutout =
      authored &&
      source instanceof THREE.MeshStandardMaterial &&
      source.transparent &&
      source.map !== null &&
      /(?:^|_)leaves$/.test(source.name);
    if (authored && options.color === undefined && !leafCutout) return source;
    const colorKey =
        options.color === undefined ? 'authored' : new THREE.Color(options.color).getHexString(),
      key = `${path}:${source.uuid}:${colorKey}`;
    const cached = tuned.get(key);
    if (cached) return cached;
    const material = source.clone();
    trackMaterial(material);
    if (material instanceof THREE.MeshStandardMaterial) {
      // Simple exports can mark organic materials metallic; this compatibility fix is scoped.
      if (!authored) {
        material.metalness = 0;
        material.roughness = material.transparent ? 0.3 : 0.86;
        material.envMapIntensity = 0.65;
      }
      if (leafCutout) {
        material.transparent = false;
        material.alphaTest = source.alphaTest || 0.35;
        material.alphaToCoverage = true;
        material.depthWrite = true;
      }
      if (options.color !== undefined) {
        material.map = null;
        material.color.set(options.color);
      }
    }
    tuned.set(key, material);
    return material;
  }
  function shadowMaterial(mesh: THREE.Mesh) {
    const source = Array.isArray(mesh.material) ? null : mesh.material;
    if (
      source instanceof THREE.MeshStandardMaterial &&
      source.transparent &&
      source.map &&
      source.alphaTest === 0
    ) {
      let depth = shadowMaterials.get(source);
      if (!depth) {
        depth = new THREE.MeshDepthMaterial({
          depthPacking: THREE.RGBADepthPacking,
          map: source.map,
          alphaMap: source.alphaMap,
          alphaTest: 0.35,
          side: source.side,
        });
        shadowMaterials.set(source, depth);
        track(depth);
      }
      mesh.customDepthMaterial = depth;
    }
  }

  const attach = ((
    parent: THREE.Object3D,
    path: string,
    placement: number | AssetPlacement,
    fallback?: THREE.Object3D,
  ) => {
    void load(path)
      .then((original) => {
        if (closed || !isAlive() || !connected(parent)) return;
        const options = typeof placement === 'number' ? { height: placement } : placement,
          { box, size, center } = bounds(original),
          model = original.clone(true);
        const sy = options.height / size.y,
          sx = options.width !== undefined ? options.width / Math.max(0.0001, size.x) : sy,
          sz = options.depth !== undefined ? options.depth / Math.max(0.0001, size.z) : sy;
        model.scale.multiply(new THREE.Vector3(sx, sy, sz));
        model.position.set(
          options.anchorXZ === 'origin' ? 0 : -center.x * sx,
          -box.min.y * sy,
          options.anchorXZ === 'origin' ? 0 : -center.z * sz,
        );
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = options.shadow !== false;
          object.receiveShadow = true;
          object.material = Array.isArray(object.material)
            ? object.material.map((source) => materialFor(source, path, options))
            : materialFor(object.material, path, options);
          shadowMaterial(object);
        });
        parent.add(model);
        if (fallback) fallback.visible = false;
        if (options.maxDistance || options.minDistance)
          singles.push({
            object: model,
            parent,
            distance: options.maxDistance ?? Infinity,
            minimum: options.minDistance ?? 0,
          });
        if (lastCamera) attach.updateVisibility(lastCamera, lastFrustum);
      })
      .catch(() => {
        if (!closed) onStatus?.({ url: path, status: 'failed' });
      });
  }) as AttachWorldAsset;
  attach.instances = (parent, path, placements, options = {}) => {
    if (!placements.length) return;
    void load(path)
      .then((original) => {
        if (closed || !isAlive() || !connected(parent)) return;
        const { box, size, center } = bounds(original),
          sources: THREE.Mesh[] = [];
        original.updateMatrixWorld(true);
        original.traverse((object) => {
          if (object instanceof THREE.Mesh) sources.push(object);
        });
        const meshes: THREE.InstancedMesh[] = [],
          allMatrices: THREE.Matrix4[][] = [];
        for (const source of sources) {
          const mat = Array.isArray(source.material)
              ? source.material.map((value) => materialFor(value, path, { height: 1 }))
              : materialFor(source.material, path, { height: 1 }),
            mesh = new THREE.InstancedMesh(source.geometry, mat, placements.length),
            matrices: THREE.Matrix4[] = [];
          mesh.castShadow = options.shadow !== false;
          mesh.receiveShadow = true;
          shadowMaterial(mesh);
          placements.forEach((placement, index) => {
            const scale = placement.height / size.y,
              normalization = new THREE.Matrix4()
                .makeTranslation(
                  options.anchorXZ === 'origin' ? 0 : -center.x * scale,
                  -box.min.y * scale,
                  options.anchorXZ === 'origin' ? 0 : -center.z * scale,
                )
                .multiply(new THREE.Matrix4().makeScale(scale, scale, scale)),
              matrix = new THREE.Matrix4()
                .makeTranslation(placement.x, placement.y, placement.z)
                .multiply(new THREE.Matrix4().makeRotationY(placement.rotationY ?? 0))
                .multiply(normalization)
                .multiply(source.matrixWorld);
            matrices.push(matrix);
            mesh.setMatrixAt(index, matrix);
          });
          resources.own(mesh);
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
          parent.add(mesh);
          meshes.push(mesh);
          allMatrices.push(matrices);
        }
        if (options.maxDistance || options.minDistance)
          batches.push({
            meshes,
            matrices: allMatrices,
            positions: placements.map((p) => new THREE.Vector3(p.x, p.y + p.height / 2, p.z)),
            radii: placements.map((p) => {
              const x =
                  options.anchorXZ === 'origin'
                    ? Math.max(Math.abs(box.min.x), Math.abs(box.max.x))
                    : size.x / 2,
                z =
                  options.anchorXZ === 'origin'
                    ? Math.max(Math.abs(box.min.z), Math.abs(box.max.z))
                    : size.z / 2;
              return (Math.hypot(x, size.y / 2, z) * p.height) / size.y;
            }),
            active: placements.map(() => true),
            distance: options.maxDistance ?? Infinity,
            minimum: options.minDistance ?? 0,
            parent,
          });
        if (lastCamera) attach.updateVisibility(lastCamera, lastFrustum);
      })
      .catch(() => {
        if (!closed) onStatus?.({ url: path, status: 'failed' });
      });
  };
  const worldPosition = new THREE.Vector3(),
    sphere = new THREE.Sphere();
  attach.updateVisibility = (cameraPosition, frustum) => {
    lastCamera ??= new THREE.Vector3();
    lastCamera.copy(cameraPosition);
    if (frustum) {
      lastFrustum ??= new THREE.Frustum();
      lastFrustum.copy(frustum);
    }
    for (const item of singles) {
      item.parent.getWorldPosition(worldPosition);
      const distance = worldPosition.distanceTo(cameraPosition);
      item.object.visible = distance >= item.minimum && distance < item.distance;
    }
    for (const batch of batches) {
      batch.parent.updateWorldMatrix(true, false);
      let changed = false;
      const indices: number[] = [];
      for (let i = 0; i < batch.positions.length; i++) {
        worldPosition.copy(batch.positions[i]!).applyMatrix4(batch.parent.matrixWorld);
        const distance = worldPosition.distanceTo(cameraPosition);
        sphere.center.copy(worldPosition);
        sphere.radius = batch.radii[i]! * batch.parent.matrixWorld.getMaxScaleOnAxis();
        const visible =
          distance >= batch.minimum &&
          distance < batch.distance &&
          (!frustum || frustum.intersectsSphere(sphere));
        if (visible) indices.push(i);
        if (visible !== batch.active[i]) {
          batch.active[i] = visible;
          changed = true;
        }
      }
      if (changed)
        for (let meshIndex = 0; meshIndex < batch.meshes.length; meshIndex++) {
          const mesh = batch.meshes[meshIndex]!;
          indices.forEach((index, output) =>
            mesh.setMatrixAt(output, batch.matrices[meshIndex]![index]!),
          );
          mesh.count = indices.length;
          mesh.instanceMatrix.needsUpdate = true;
        }
    }
  };

  attach.detach = (parent) => {
    const belongs = (object: THREE.Object3D) => {
      for (let node: THREE.Object3D | null = object; node; node = node.parent)
        if (node === parent) return true;
      return false;
    };
    for (let i = singles.length - 1; i >= 0; i--)
      if (belongs(singles[i]!.parent)) singles.splice(i, 1);
    for (let i = batches.length - 1; i >= 0; i--)
      if (belongs(batches[i]!.parent)) {
        for (const mesh of batches[i]!.meshes) {
          resources.release(mesh);
          mesh.removeFromParent();
        }
        batches.splice(i, 1);
      }
  };
  attach.dispose = () => {
    if (closed) return;
    closed = true;
    requests.abort();
    resources.dispose();
    cache.clear();
    tuned.clear();
    shadowMaterials.clear();
    singles.length = 0;
    batches.length = 0;
  };
  return attach;
}
