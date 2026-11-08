import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createEnvironmentMaterials } from './materials';
import { ResourceScope, releaseObjectResources } from './sceneResources';

function fakeLoader() {
  const requests = new Map<string, (texture: THREE.Texture) => void>();
  const load = vi.fn((url: string, onLoad?: (texture: THREE.Texture) => void) => {
    requests.set(url, onLoad!);
    return new THREE.Texture();
  });
  return { loader: { load } as Pick<THREE.TextureLoader, 'load'>, requests };
}
const renderer = { capabilities: { getMaxAnisotropy: () => 16 } } as Pick<
  THREE.WebGLRenderer,
  'capabilities'
>;

describe('shared environment surfaces', () => {
  it('loads terrain channels once, preserves color spaces, and keeps surface UV scales independent', async () => {
    const { loader, requests } = fakeLoader();
    const surfaces = createEnvironmentMaterials(renderer, { loader });
    const ground = surfaces.material('grass', { repeat: [32, 26] });
    const hills = surfaces.material('grass', { repeat: [1, 1], normalStrength: 0.65 });
    expect(loader.load).toHaveBeenCalledTimes(3);
    for (const resolve of requests.values()) resolve(new THREE.Texture());
    await surfaces.ready();
    expect(ground.map!.source).toBe(hills.map!.source);
    expect(ground.map!.repeat.toArray()).toEqual([32, 26]);
    expect(hills.map!.repeat.toArray()).toEqual([1, 1]);
    expect(ground.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(ground.normalMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(ground.roughnessMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(ground.map!.anisotropy).toBe(8);
    surfaces.dispose();
  });

  it('does not attach late textures to a removed object and disposes each image once after teardown', async () => {
    const { loader, requests } = fakeLoader();
    const surfaces = createEnvironmentMaterials(renderer, { loader });
    const material = surfaces.material('timber');
    const root = new THREE.Mesh(new THREE.BoxGeometry(), material);
    const scope = new ResourceScope();
    scope.capture(root);
    const materialDispose = vi.spyOn(material, 'dispose');
    releaseObjectResources(root);
    const textures = [...requests.values()].map((resolve) => {
      const texture = new THREE.Texture();
      vi.spyOn(texture, 'dispose');
      resolve(texture);
      return texture;
    });
    await surfaces.ready();
    expect(material.map).toBeNull();
    expect(materialDispose).toHaveBeenCalledTimes(1);
    surfaces.dispose();
    scope.dispose();
    for (const texture of textures) expect(texture.dispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });

  it('disposes textures that finish loading after the scene is gone', async () => {
    const { loader, requests } = fakeLoader();
    const surfaces = createEnvironmentMaterials(renderer, { loader });
    const material = surfaces.alphaMaterial('/leaves.png', {
      alphaTest: 0.45,
      side: THREE.DoubleSide,
    });
    surfaces.dispose();
    const texture = new THREE.Texture();
    const dispose = vi.spyOn(texture, 'dispose');
    requests.get('/leaves.png')!(texture);
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(material.map).toBeNull();
  });
});
