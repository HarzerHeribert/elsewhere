import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { worldAssetLoader } from './worldAssets';
import { releaseObjectResources } from './sceneResources';

function triangleGLB() {
  const binary = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json = JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [{ buffer: 0, byteLength: binary.byteLength }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
  });
  const jsonBytes = new TextEncoder().encode(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
  const buffer = new ArrayBuffer(12 + 8 + jsonBytes.length + 8 + binary.byteLength),
    view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20, jsonBytes.length).set(jsonBytes);
  const offset = 20 + jsonBytes.length;
  view.setUint32(offset, binary.byteLength, true);
  view.setUint32(offset + 4, 0x004e4942, true);
  new Uint8Array(buffer, offset + 8).set(new Uint8Array(binary.buffer));
  return buffer;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('world asset ownership', () => {
  it('shares cached GLB geometry and keeps it alive when one model is detached', async () => {
    const fetch = vi.fn(async () => new Response(triangleGLB()));
    vi.stubGlobal('fetch', fetch);
    const scene = new THREE.Scene(),
      first = new THREE.Group(),
      second = new THREE.Group();
    scene.add(first, second);
    const attach = worldAssetLoader(scene, () => true);
    attach(first, '/triangle.glb', 1);
    attach(second, '/triangle.glb', 1);
    await vi.waitFor(() => expect(first.children.length).toBe(1));
    const mesh = first.children[0]!.children[0] as THREE.Mesh;
    const other = second.children[0]!.children[0] as THREE.Mesh;
    expect(other.geometry).toBe(mesh.geometry);
    expect(fetch).toHaveBeenCalledTimes(1);
    const dispose = vi.spyOn(mesh.geometry, 'dispose');
    attach.detach(first);
    releaseObjectResources(first);
    first.removeFromParent();
    expect(dispose).not.toHaveBeenCalled();
    attach.dispose();
    attach.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('releases an asset that finishes parsing after scene teardown', async () => {
    let respond!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            respond = resolve;
          }),
      ),
    );
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const scene = new THREE.Scene(),
      parent = new THREE.Group();
    scene.add(parent);
    const attach = worldAssetLoader(scene, () => true);
    attach(parent, '/late.glb', 1);
    attach.dispose();
    respond(new Response(triangleGLB()));
    await vi.waitFor(() => expect(geometryDispose).toHaveBeenCalledTimes(1));
    expect(parent.children).toHaveLength(0);
  });
});
