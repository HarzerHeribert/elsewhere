import * as THREE from 'three';
import { TRAIL_LINES } from './landscapeLayout';
import type { createEnvironmentMaterials } from './materials';

export function buildVillagePaths(
  scene: THREE.Object3D,
  surfaces: ReturnType<typeof createEnvironmentMaterials>,
) {
  // One continuous dirt surface keeps junctions seamless. UV1 covers the meadow while UV0 tiles the scan.
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 768;
  const ctx = canvas.getContext('2d')!;
  const width = 64,
    depth = 48,
    density = canvas.width / width;
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(density, density);
  ctx.lineJoin = ctx.lineCap = 'round';
  for (const [stroke, size] of [
    ['#303030', 2.32],
    ['#8b8b8b', 1.96],
    ['#ffffff', 1.62],
  ] as const) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = size;
    for (const route of TRAIL_LINES) {
      ctx.beginPath();
      route.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
      ctx.stroke();
    }
  }
  ctx.beginPath();
  ctx.fillStyle = 'white';
  ctx.arc(3, 3, 2.65, 0, Math.PI * 2);
  ctx.fill();
  const mask = new THREE.CanvasTexture(canvas);
  mask.channel = 1;
  const ground = new THREE.PlaneGeometry(width, depth);
  ground.setAttribute('uv1', ground.getAttribute('uv').clone());
  const pathMaterial = surfaces.material('path', {
    repeat: [width / 2.5, depth / 2.5],
    tint: 0xffefd1,
    normalStrength: 0.62,
  });
  pathMaterial.alphaMap = mask;
  pathMaterial.transparent = true;
  pathMaterial.depthWrite = false;
  const paths = new THREE.Mesh(ground, pathMaterial);
  paths.name = 'Meadow footpaths';
  paths.rotation.x = -Math.PI / 2;
  paths.position.y = 0.025;
  paths.receiveShadow = true;
  scene.add(paths);

  // Set small fan-shaped pavers around the meeting point. Stone joints show the earth underneath.
  const positions: number[] = [],
    uv: number[] = [],
    colors: number[] = [];
  const palette = [0xffe3bb, 0xdcc9b4, 0xf4e6ca, 0xcfc1a8, 0xe2ceac].map((c) => new THREE.Color(c));
  for (let band = 0; band < 6; band++) {
    const inner = 0.025 + band * 0.43,
      outer = inner + 0.403;
    const count = Math.max(5, Math.round(((inner + outer) * Math.PI) / 0.55));
    for (let i = 0; i < count; i++) {
      const angle = ((i + 0.45 * (band % 2)) * Math.PI * 2) / count;
      const step = (2 * Math.PI) / count,
        gap = 0.009 / outer;
      const polar = (r: number, a: number) => [3 + Math.cos(a) * r, 3 + Math.sin(a) * r] as const;
      const a = polar(inner, angle + gap),
        b = polar(inner, angle + step - gap);
      const c = polar(outer, angle + step - gap),
        d = polar(outer, angle + gap);
      const color = palette[(i * 7 + band * 3) % palette.length];
      for (const [x, z] of [a, b, d, b, c, d]) {
        positions.push(x, 0.042, z);
        uv.push(x / 2 + i * 0.37, z / 2 + band * 0.51);
        colors.push(color.r, color.g, color.b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const sett = surfaces.material('stone', { normalStrength: 0.25 });
  sett.vertexColors = true;
  const circle = new THREE.Mesh(geometry, sett);
  circle.name = 'Courtyard stone circle';
  circle.receiveShadow = true;
  scene.add(circle);
}
