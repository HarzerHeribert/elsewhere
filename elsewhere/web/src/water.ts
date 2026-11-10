import * as THREE from 'three';
import { windUniforms } from './wind';
import { WORLD_PALETTE } from './worldStyle';

/** A small tileable ripple field, computed once; no image download. */
function rippleNormals(size = 128) {
  const data = new Uint8Array(size * size * 4);
  const waves = [
    [5, 3, 0.3, 1],
    [-4, 7, 1.7, 0.8],
    [8, -5, 4.1, 0.6],
    [-9, -6, 2.6, 0.5],
    [11, 4, 5.2, 0.35],
    [3, -12, 0.9, 0.3],
  ] as const;
  const normal = new THREE.Vector3();
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let dx = 0,
        dy = 0;
      for (const [kx, ky, phase, amplitude] of waves) {
        const slope =
          Math.cos(((kx * x + ky * y) / size) * Math.PI * 2 + phase) * amplitude * 0.035;
        dx += slope * kx;
        dy += slope * ky;
      }
      normal.set(-dx, -dy, 1).normalize();
      const i = (y * size + x) * 4;
      data[i] = (normal.x * 0.5 + 0.5) * 255;
      data[i + 1] = (normal.y * 0.5 + 0.5) * 255;
      data[i + 2] = (normal.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Still, reflective water whose surface drifts with the world's breeze. */
export function createWaterSurface(geometry: THREE.BufferGeometry, tilesAcross = 2) {
  const ripples = rippleNormals();
  ripples.repeat.set(tilesAcross, tilesAcross);
  const material = new THREE.MeshPhysicalMaterial({
    color: WORLD_PALETTE.water,
    roughness: 0.16,
    metalness: 0,
    ior: 1.33,
    reflectivity: 0.7,
    envMapIntensity: 1.25,
    normalMap: ripples,
    normalScale: new THREE.Vector2(0.3, 0.3),
    transparent: true,
    opacity: 0.8,
  });
  const water = new THREE.Mesh(geometry, material);
  water.receiveShadow = true;
  water.onBeforeRender = () => {
    const t = windUniforms.uWindTime.value;
    ripples.offset.set(t * 0.012, t * 0.007);
  };
  return water;
}
