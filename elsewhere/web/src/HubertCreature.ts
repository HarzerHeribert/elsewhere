import * as THREE from 'three';
import appearance from '../../../characters/hubert/appearance.json';
import { ResourceScope } from './sceneResources';

export const HUBERT_APPEARANCE = appearance;
export interface CreaturePose {
  dt: number;
  worldTime: number;
  paused: boolean;
  resting: boolean;
  gaze?: THREE.Vector3;
}

/** Hubert is an original, unclassified little creature. Its anchor stays owned by the world. */
export function createHubertCreature() {
  const root = new THREE.Group();
  root.name = 'Hubert — unclassified Elsewhere creature';
  root.userData.characterId = 'hubert';
  root.userData.modelKind = 'elsewhere-creature';
  root.userData.stepPhase = 0;
  const resources = new ResourceScope();
  const palette = appearance.palette;
  const bodyPose = new THREE.Group();
  root.add(bodyPose);
  const material = (color: THREE.ColorRepresentation, roughness = 0.86) => {
    const result = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    resources.own(result);
    return result;
  };
  const moss = material(palette.moss, 0.78),
    ochre = material(palette.ochre, 0.8);
  const leafMaterial = material(palette.moss, 0.72);
  const eyeMaterial = new THREE.MeshPhysicalMaterial({
    color: palette.eyes,
    roughness: 0.16,
    metalness: 0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.13,
  });
  resources.own(eyeMaterial);
  const glintMaterial = new THREE.MeshBasicMaterial({ color: palette.highlight });
  resources.own(glintMaterial);
  function ellipsoid(
    parent: THREE.Object3D,
    mat: THREE.Material,
    size: [number, number, number],
    position: [number, number, number],
  ) {
    const geometry = new THREE.SphereGeometry(1, 24, 16);
    resources.own(geometry);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.scale.set(...size);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  // Paint is a skin pattern on one continuous body, not a separate head, garment or torso.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const context = canvas.getContext('2d')!;
  context.fillStyle = palette.body;
  context.fillRect(0, 0, 1024, 1024);
  context.save();
  context.translate(256, 620);
  context.scale(0.76, 1.12);
  const belly = context.createRadialGradient(0, 0, 25, 0, 0, 260);
  belly.addColorStop(0, palette.belly);
  belly.addColorStop(0.62, palette.belly);
  belly.addColorStop(1, 'rgba(239,240,214,0)');
  context.fillStyle = belly;
  context.fillRect(-280, -280, 560, 560);
  context.restore();
  context.save();
  context.translate(745, 520);
  context.scale(1, 0.8);
  const back = context.createRadialGradient(0, 0, 10, 0, 0, 170);
  back.addColorStop(0, 'rgba(102,129,104,.28)');
  back.addColorStop(1, 'rgba(102,129,104,0)');
  context.fillStyle = back;
  context.fillRect(-180, -180, 360, 360);
  context.restore();
  let seed = 1907;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 26; i++) {
    const x = 120 + random() * 260,
      y = 400 + random() * 260;
    context.fillStyle = i % 4 ? 'rgba(102,129,104,.26)' : 'rgba(212,170,104,.46)';
    context.beginPath();
    context.ellipse(x, y, 2 + random() * 4, 2 + random() * 3, random(), 0, Math.PI * 2);
    context.fill();
  }
  const skin = new THREE.CanvasTexture(canvas);
  skin.colorSpace = THREE.SRGBColorSpace;
  skin.anisotropy = 4;
  resources.own(skin);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    map: skin,
    roughness: 0.9,
    metalness: 0,
    envMapIntensity: 0.55,
  });
  resources.own(bodyMaterial);
  const bodyGeometry = new THREE.SphereGeometry(1, 40, 28);
  resources.own(bodyGeometry);
  const positions = bodyGeometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i),
      t = (y + 1) / 2;
    const radius = 0.34 * (1.05 - 0.5 * t);
    positions.setXYZ(
      i,
      x * radius - 0.065 * t * t,
      0.08 + Math.pow(t, 1.25) * 0.96,
      z * radius * 0.82 + 0.014 * t,
    );
  }
  positions.needsUpdate = true;
  bodyGeometry.computeVertexNormals();
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  bodyPose.add(body);

  // Three broad, small paddles give it a distinctive shuffling silhouette.
  const feet: THREE.Group[] = [];
  const footOrigins = [
    new THREE.Vector3(-0.17, 0.085, 0.13),
    new THREE.Vector3(0.17, 0.085, 0.13),
    new THREE.Vector3(0.015, 0.08, -0.17),
  ];
  footOrigins.forEach((position, index) => {
    const foot = new THREE.Group();
    foot.position.copy(position);
    root.add(foot);
    ellipsoid(
      foot,
      index === 2 ? ochre : moss,
      [index === 1 ? 0.095 : 0.088, 0.053, 0.14],
      [0, 0, 0.015],
    );
    foot.rotation.y = index === 0 ? -0.18 : index === 1 ? 0.15 : Math.PI;
    feet.push(foot);
  });

  // Soft, deliberately unequal eyes are embedded directly into the bean-shaped body.
  const eyes: Array<{ group: THREE.Group; restScale: number }> = [];
  for (const [x, y, z, size] of [
    [-0.14, appearance.eyeHeight, 0.171, 1],
    [0.075, appearance.eyeHeight + 0.012, 0.177, 1.08],
  ] as const) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    bodyPose.add(group);
    ellipsoid(group, eyeMaterial, [0.082 * size, 0.108 * size, 0.047], [0, 0, 0]);
    ellipsoid(group, glintMaterial, [0.014, 0.019, 0.007], [-0.022, 0.037, 0.043]);
    ellipsoid(group, glintMaterial, [0.006, 0.007, 0.004], [0.025, -0.027, 0.046]);
    eyes.push({ group, restScale: 1 });
  }
  const smileCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.035, 0.59, 0.22),
    new THREE.Vector3(-0.005, 0.578, 0.224),
    new THREE.Vector3(0.025, 0.588, 0.22),
  );
  const smileGeometry = new THREE.TubeGeometry(smileCurve, 12, 0.0038, 5, false);
  resources.own(smileGeometry);
  bodyPose.add(new THREE.Mesh(smileGeometry, material(palette.deepMoss)));

  // Leaf-like feelers are attached to the off-centre crown, with no human ears or hat.
  const feelers: Array<{ group: THREE.Group; angle: number }> = [];
  for (const [x, y, length, angle] of [
    [-0.075, 1.015, 0.205, 0.35],
    [0.012, 0.993, 0.145, -0.58],
  ] as const) {
    const group = new THREE.Group();
    group.position.set(x, y, -0.01);
    group.rotation.z = angle;
    bodyPose.add(group);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(0.06, length * 0.25, 0.065, length * 0.72, 0, length);
    shape.bezierCurveTo(-0.065, length * 0.72, -0.05, length * 0.23, 0, 0);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.018,
      bevelEnabled: true,
      bevelSize: 0.006,
      bevelThickness: 0.004,
      bevelSegments: 2,
      steps: 1,
    });
    resources.own(geometry);
    const leaf = new THREE.Mesh(geometry, leafMaterial);
    leaf.position.z = -0.009;
    leaf.castShadow = true;
    group.add(leaf);
    const veinCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, 0.018, 0.015),
      new THREE.Vector3(0.01, length * 0.55, 0.017),
      new THREE.Vector3(0, length - 0.014, 0.015),
    );
    const veinGeometry = new THREE.TubeGeometry(veinCurve, 10, 0.0025, 4, false);
    resources.own(veinGeometry);
    group.add(new THREE.Mesh(veinGeometry, material(palette.ochre)));
    feelers.push({ group, angle });
  }

  let previousPosition: THREE.Vector3 | null = null,
    step = 0,
    movement = 0;
  const localGaze = new THREE.Vector3();
  const feelerSway = [0, 0];
  function update({ dt, worldTime, paused, resting, gaze }: CreaturePose) {
    if (!previousPosition) previousPosition = root.position.clone();
    const distance = root.position.distanceTo(previousPosition);
    previousPosition.copy(root.position);
    if (!paused) {
      step += distance * 19;
      movement = THREE.MathUtils.lerp(
        movement,
        Math.min(1, distance / Math.max(dt, 0.001) / 1.5),
        Math.min(1, dt * 12),
      );
    }
    const seconds = worldTime / 1000;
    const settling = resting ? 0.92 : 1;
    const motionWeight = resting ? 0 : movement;
    const smoothing = paused ? 1 : Math.min(1, dt * 5);
    const squash = 1 - Math.abs(Math.sin(step)) * motionWeight * 0.025;
    bodyPose.scale.set(
      1 + (1 - settling) * 0.22 + motionWeight * 0.008,
      settling * squash,
      1 + (1 - settling) * 0.15,
    );
    bodyPose.position.y = Math.abs(Math.sin(step)) * motionWeight * 0.012;
    const birdAttention = Boolean(gaze);
    if (gaze)
      localGaze
        .copy(gaze)
        .sub(root.position)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), -root.rotation.y)
        .normalize();
    else localGaze.set(0, 0, 0);
    bodyPose.rotation.z = THREE.MathUtils.lerp(
      bodyPose.rotation.z,
      birdAttention
        ? THREE.MathUtils.clamp(-localGaze.x * 0.07, -0.07, 0.07)
        : Math.sin(step) * motionWeight * 0.018,
      smoothing,
    );
    bodyPose.rotation.x = THREE.MathUtils.lerp(
      bodyPose.rotation.x,
      resting
        ? 0.035
        : birdAttention
          ? THREE.MathUtils.clamp(-localGaze.y * 0.055, -0.045, 0.045)
          : motionWeight * 0.025,
      smoothing,
    );
    if (!paused)
      feet.forEach((foot, index) => {
        const wave = Math.sin(step + (index * Math.PI * 2) / 3),
          origin = footOrigins[index]!;
        foot.position.set(
          origin.x,
          origin.y + Math.max(0, wave) * motionWeight * 0.035,
          origin.z + wave * motionWeight * 0.028,
        );
        foot.rotation.x = wave * motionWeight * 0.13;
      });
    const blinkPhase = (seconds + 3.4) % 11.7,
      blink = blinkPhase < 0.24 ? Math.sin((blinkPhase / 0.24) * Math.PI) : 0;
    if (!paused) for (const eye of eyes) eye.group.scale.y = eye.restScale * (1 - blink * 0.94);
    feelers.forEach((feeler, index) => {
      if (!paused) feelerSway[index] = Math.sin(seconds * 0.8 + index) * 0.018;
      feeler.group.rotation.z =
        feeler.angle +
        (feelerSway[index] ?? 0) +
        (resting ? (index ? -0.15 : 0.15) : 0) +
        (birdAttention ? -localGaze.x * 0.07 : 0);
      feeler.group.rotation.x = birdAttention
        ? THREE.MathUtils.clamp(-localGaze.y * 0.12, -0.1, 0.1)
        : motionWeight * 0.035;
    });
  }
  return {
    root,
    eyeHeight: appearance.eyeHeight,
    update,
    dispose() {
      root.removeFromParent();
      resources.dispose();
    },
  };
}
