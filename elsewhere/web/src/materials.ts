import * as THREE from 'three';
import { ResourceScope } from './sceneResources';

/** Native photo-scanned material scale, in metres per complete texture tile. */
export const ENVIRONMENT_MATERIALS = {
  stone: { id: 'stone_wall', tileMetres: 2 },
  timber: { id: 'weathered_planks', tileMetres: 2 },
  roof: { id: 'roof_tiles_14', tileMetres: 1.5 },
  grass: { id: 'leafy_grass', tileMetres: 2 },
  path: { id: 'grass_path_2', tileMetres: 2 },
} as const;

export type EnvironmentMaterial = keyof typeof ENVIRONMENT_MATERIALS;
export interface SurfaceOptions {
  /** Geometry supplies surface UVs; each material keeps its own UV transform. */
  repeat?: readonly [number, number];
  tint?: THREE.ColorRepresentation;
  normalStrength?: number;
  envMapIntensity?: number;
  alphaTest?: number;
  side?: THREE.Side;
  /** Shared by many models: survives the removal of any one of them. */
  shared?: boolean;
}
export type SurfaceTextureStatus = (url: string, status: 'loaded' | 'failed') => void;

/** One image cache for terrain, architecture and alpha leaves, scoped to one scene. */
export function createEnvironmentMaterials(
  renderer: Pick<THREE.WebGLRenderer, 'capabilities'>,
  options: { onTexture?: SurfaceTextureStatus; loader?: Pick<THREE.TextureLoader, 'load'> } = {},
) {
  const loader = options.loader ?? new THREE.TextureLoader();
  const sources = new Map<string, Promise<THREE.Texture | null>>();
  const resources = new ResourceScope();
  const bindings = new Map<THREE.Material, Set<THREE.Texture>>();
  let disposed = false;
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  function load(url: string, color: boolean) {
    let pending = sources.get(url);
    if (!pending) {
      pending = new Promise<THREE.Texture | null>((resolve) => {
        loader.load(
          url,
          (texture) => {
            if (disposed) {
              texture.dispose();
              resolve(null);
              return;
            }
            texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.anisotropy = anisotropy;
            resources.own(texture, true);
            options.onTexture?.(url, 'loaded');
            resolve(texture);
          },
          undefined,
          () => {
            if (!disposed) options.onTexture?.(url, 'failed');
            resolve(null);
          },
        );
      });
      sources.set(url, pending);
    }
    return pending;
  }

  function surfaceMaterial(surface: SurfaceOptions) {
    if (disposed) throw new Error('Environment materials have been disposed');
    const result = resources.own(
      new THREE.MeshStandardMaterial({
        color: surface.tint ?? 0xffffff,
        metalness: 0,
        roughness: 1,
        normalScale: new THREE.Vector2(
          surface.normalStrength ?? 0.8,
          surface.normalStrength ?? 0.8,
        ),
        envMapIntensity: surface.envMapIntensity ?? 1,
        alphaTest: surface.alphaTest ?? 0,
        side: surface.side ?? THREE.FrontSide,
      }),
      surface.shared,
    );
    bindings.set(result, new Set());
    result.addEventListener('dispose', () => {
      const textures = bindings.get(result);
      bindings.delete(result);
      if (textures) for (const texture of textures) resources.release(texture);
    });
    return result;
  }

  function bind(
    result: THREE.MeshStandardMaterial,
    property: 'map' | 'normalMap' | 'roughnessMap',
    url: string,
    surface: SurfaceOptions,
  ) {
    void load(url, property === 'map').then((source) => {
      const textures = bindings.get(result);
      if (!source || disposed || !textures) return;
      const texture = resources.own(source.clone(), surface.shared);
      texture.repeat.set(...(surface.repeat ?? [1, 1]));
      texture.needsUpdate = true;
      textures.add(texture);
      result[property] = texture;
      result.needsUpdate = true;
    });
  }

  function material(kind: EnvironmentMaterial, surface: SurfaceOptions = {}) {
    const result = surfaceMaterial(surface);
    const architectural = kind === 'stone' || kind === 'timber' || kind === 'roof';
    const prefix = `/assets/polyhaven/${architectural ? 'materials/' : ''}${ENVIRONMENT_MATERIALS[kind].id}`;
    const resolution = architectural ? '2k' : '1k';
    for (const [property, suffix] of [
      ['map', 'diff'],
      ['normalMap', 'nor_gl'],
      ['roughnessMap', 'rough'],
    ] as const) {
      bind(result, property, `${prefix}_${suffix}_${resolution}.jpg`, surface);
    }
    return result;
  }

  function alphaMaterial(url: string, surface: SurfaceOptions = {}) {
    const result = surfaceMaterial(surface);
    bind(result, 'map', url, surface);
    return result;
  }

  return {
    material,
    alphaMaterial,
    ready: async () => {
      await Promise.all(sources.values());
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      resources.dispose();
      bindings.clear();
      sources.clear();
    },
  };
}
