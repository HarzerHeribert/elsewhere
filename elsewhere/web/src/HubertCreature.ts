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

const { palette } = appearance;
const smooth = THREE.MathUtils.smoothstep;
const axisY = new THREE.Vector3(0, 1, 0);

// A wonky clay-colored body: the pale patch sits on the belly, away from the deadpan face.
function seedBody() {
  const geometry = new THREE.SphereGeometry(1, 80, 56);
  const positions = geometry.getAttribute('position');
  const colors = [];
  const coat = new THREE.Color(palette.body);
  const gold = new THREE.Color(palette.ochre);
  const cream = new THREE.Color(palette.belly);
  const umber = new THREE.Color(palette.markings);
  const color = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    const t = (y + 1) / 2;
    const width = 0.455 * (1.13 - 0.28 * t);
    positions.setXYZ(i, x * width - 0.085 * t * t, 0.098 + t * 0.93, z * width * 0.87);
    const face = smooth(z - 0.5 * y, 0.75, 0.96) * (1 - smooth(y, -0.2, 0.1));
    color
      .copy(coat)
      .lerp(gold, smooth(y, -0.2, 1) * 0.65)
      .lerp(cream, face);
    // Three little ovals echo the broken nape markings on the cream breast.
    const breast = Math.hypot((Math.abs(x) - 0.27) / 0.09, (y + 0.22 + Math.abs(x) * 0.24) / 0.05);
    const bib = Math.hypot(x / 0.085, (y + 0.39) / 0.065);
    if (z > 0.7) color.lerp(gold, (1 - smooth(Math.min(breast, bib), 0.1, 1)) * 0.85);
    // Paired broken stripes on the nape remain visible from the overhead camera.
    const stripe = Math.cos((y + 0.15 * Math.abs(x)) * 22);
    const nape = smooth(-z + 0.4 * y, 0.5, 1.15) * smooth(y, -0.35, 0.15);
    color.lerp(umber, nape * smooth(stripe, 0.55, 0.96) * 0.78);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// The listening feelers resemble winged seeds. A curved midrib folds each blade into a cupped sail.
function listeningLeaf(side: number, length: number, lift: number) {
  const geometry = new THREE.SphereGeometry(1, 40, 28);
  const positions = geometry.getAttribute('position');
  const colors = [];
  const green = new THREE.Color(palette.moss);
  const midrib = new THREE.Color(palette.deepMoss);
  const tip = new THREE.Color(palette.leafTip);
  const color = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    const t = (y + 1) / 2;
    positions.setXYZ(
      i,
      side * length * t,
      lift * t + 0.08 * Math.sin(t * Math.PI) + side * x * 0.095 + z * 0.03,
      -0.09 * t + side * x * 0.13 - 0.028 * x * x - z * 0.021,
    );
    const flank = Math.abs(x);
    color.copy(green).lerp(tip, smooth(t, 0.52, 0.9));
    const ribs = Math.cos((t - flank * 0.33) * Math.PI * 9);
    color.lerp(midrib, 0.29 * smooth(ribs, 0.4, 1) * smooth(flank, 0, 0.35));
    color.lerp(tip, 0.75 * (1 - smooth(flank, 0.02, 0.075)));
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function createHubertCreature() {
  const root = new THREE.Group();
  root.name = 'Hubert — unclassified Elsewhere creature';
  root.userData.characterId = 'hubert';
  root.userData.modelKind = 'elsewhere-creature';
  root.userData.stepPhase = 0;
  const resources = new ResourceScope();
  const bodyPose = new THREE.Group();
  root.add(bodyPose);

  const round = resources.own(new THREE.SphereGeometry(1, 24, 16));
  const painted = resources.own(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }),
  );
  const leafMaterial = resources.own(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.74,
      emissive: palette.moss,
      emissiveIntensity: 0.15,
    }),
  );
  const material = (color: string, roughness = 0.84) =>
    resources.own(new THREE.MeshStandardMaterial({ color, roughness }));
  const bark = material(palette.markings);
  const moss = material(palette.moss);
  const eyeWhite = material(palette.highlight);
  const eyelid = material(palette.ochre);
  const eye = resources.own(
    new THREE.MeshPhysicalMaterial({
      color: palette.eyes,
      roughness: 0.9,
      clearcoat: 0,
    }),
  );
  function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, mat: THREE.Material) {
    const part = new THREE.Mesh(geometry, mat);
    part.castShadow = part.receiveShadow = true;
    parent.add(part);
    return part;
  }
  function oval(
    parent: THREE.Object3D,
    mat: THREE.Material,
    size: [number, number, number],
    center: [number, number, number],
  ) {
    const part = mesh(parent, round, mat);
    part.scale.set(...size);
    part.position.set(...center);
    return part;
  }
  mesh(bodyPose, resources.own(seedBody()), painted);

  // The sun's village-wide shadow map cannot resolve contact under the tiny paddles.
  const contactGeometry = resources.own(new THREE.CircleGeometry(1, 40));
  const contactColors = new Float32Array(contactGeometry.getAttribute('position').count * 4);
  const shade = new THREE.Color(0x3d3024);
  for (let i = 0; i < contactColors.length / 4; i++) {
    contactColors.set([shade.r, shade.g, shade.b, i === 0 ? 0.53 : 0], i * 4);
  }
  contactGeometry.setAttribute('color', new THREE.BufferAttribute(contactColors, 4));
  const contact = new THREE.Mesh(
    contactGeometry,
    resources.own(
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    ),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.set(0, 0.058, 0.015);
  contact.scale.set(0.55, 0.46, 1);
  contact.renderOrder = 1;
  contact.raycast = () => {};
  root.add(contact);

  const feet: THREE.Group[] = [];
  const footOrigins = [
    new THREE.Vector3(-0.21, 0.093, 0.138),
    new THREE.Vector3(0.21, 0.093, 0.138),
    new THREE.Vector3(0.018, 0.093, -0.205),
  ];
  footOrigins.forEach((position, index) => {
    const foot = new THREE.Group();
    foot.position.copy(position);
    foot.rotation.y = [-0.29, 0.29, Math.PI][index]!;
    root.add(foot);
    oval(foot, moss, [index === 0 ? 0.19 : 0.17, 0.063, 0.215], [0, 0, 0.05]);
    feet.push(foot);
  });

  const eyes: THREE.Group[] = [];
  const pupils: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(-0.04 + side * 0.15, appearance.eyeHeight - side * 0.027, 0.275);
    eyeGroup.rotation.y = side * 0.33;
    eyeGroup.rotation.x = -0.24;
    bodyPose.add(eyeGroup);
    const eyeSize = side < 0 ? 1.12 : 0.87;
    oval(eyeGroup, eyeWhite, [0.101 * eyeSize, 0.119 * eyeSize, 0.08], [0, 0, 0.018]);
    const pupil = oval(
      eyeGroup,
      eye,
      [0.025, 0.039, 0.016],
      [side < 0 ? 0.028 : -0.018, -0.025, 0.098],
    );
    pupils.push(pupil);
    const lid = oval(
      eyeGroup,
      eyelid,
      [0.107 * eyeSize, 0.073 * eyeSize, 0.086],
      [0, 0.065, 0.029],
    );
    lid.rotation.z = side * -0.13;
    eyes.push(eyeGroup);
    for (const [dx, dy, dz, radius] of [
      [0.248, 0.659, 0.3, 0.01],
      [0.273, 0.638, 0.29, 0.007],
      [0.228, 0.631, 0.328, 0.008],
    ] as const) {
      const freckle = oval(
        bodyPose,
        bark,
        [radius, radius, radius * 0.55],
        [side * dx - 0.014, dy, dz],
      );
      freckle.rotation.y = side * 0.5;
      freckle.castShadow = false;
    }
  }
  const mouth = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.085, 0.603, 0.378),
    new THREE.Vector3(-0.018, 0.604, 0.395),
    new THREE.Vector3(0.057, 0.594, 0.375),
  );
  mesh(bodyPose, resources.own(new THREE.TubeGeometry(mouth, 12, 0.007, 7, false)), bark);
  oval(bodyPose, material(palette.body), [0.105, 0.056, 0.075], [0.035, 0.666, 0.358]);
  const tooth = mesh(bodyPose, resources.own(new THREE.BoxGeometry(0.033, 0.045, 0.024)), eyeWhite);
  tooth.position.set(-0.008, 0.58, 0.386);
  tooth.rotation.z = 0.1;
  for (const side of [-1, 1]) {
    const arm = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.34, 0.54, 0.16),
      new THREE.Vector3(side * 0.43, 0.37, 0.18),
      new THREE.Vector3(side * 0.39, 0.31, 0.22),
    ]);
    mesh(bodyPose, resources.own(new THREE.TubeGeometry(arm, 12, 0.017, 7, false)), moss);
  }
  const feelers: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const group = new THREE.Group();
    group.position.set(side * 0.1 - 0.028, 0.968, -0.038);
    group.scale.y = 0.85;
    bodyPose.add(group);
    const tip = new THREE.Vector3(side * 0.25, side < 0 ? 0.27 : 0.24, -0.045);
    const stalk = new THREE.CatmullRomCurve3(
      [new THREE.Vector3(), new THREE.Vector3(side * 0.18, side < 0 ? 0.16 : 0.39, -0.025), tip],
      false,
      'catmullrom',
      0.15,
    );
    mesh(group, resources.own(new THREE.TubeGeometry(stalk, 14, 0.015, 7, false)), moss);
    const blade = mesh(
      group,
      resources.own(listeningLeaf(side, side < 0 ? 0.2 : 0.13, side < 0 ? 0.025 : -0.075)),
      leafMaterial,
    );
    blade.position.copy(tip);
    blade.scale.set(1, 0.6, 0.6);
    feelers.push(group);
  }

  let previousPosition: THREE.Vector3 | null = null,
    step = 0,
    movement = 0;
  const direction = new THREE.Vector3();
  function update({ dt, worldTime, paused, resting, gaze }: CreaturePose) {
    if (!previousPosition) previousPosition = root.position.clone();
    const distance = root.position.distanceTo(previousPosition);
    previousPosition.copy(root.position);
    if (paused) return;
    const seconds = worldTime / 1000;
    const smoothing = 1 - Math.exp(-dt * 8);
    step += Math.min(distance, 0.3) * 16;
    movement = THREE.MathUtils.lerp(
      movement,
      resting ? 0 : Math.min(1, distance / Math.max(dt, 0.001)),
      smoothing,
    );
    if (gaze)
      direction.copy(gaze).sub(root.position).applyAxisAngle(axisY, -root.rotation.y).normalize();
    else direction.set(0, 0, 0);
    const sway = Math.sin(step) * movement;
    const breath = Math.sin(seconds * 1.8) * (resting ? 0.008 : 0.012);
    const height = (resting ? 0.91 : 1) + breath - Math.abs(sway) * 0.024;
    bodyPose.scale.set(1 + (1 - height) * 0.34, height, 1 + (1 - height) * 0.23);
    bodyPose.position.y = Math.abs(sway) * 0.012;
    bodyPose.rotation.z = THREE.MathUtils.lerp(
      bodyPose.rotation.z,
      -0.035 - direction.x * 0.14 + sway * 0.085,
      smoothing,
    );
    bodyPose.rotation.x = THREE.MathUtils.lerp(
      bodyPose.rotation.x,
      (resting ? 0.045 : movement * 0.055) - direction.y * 0.1,
      smoothing,
    );
    feet.forEach((foot, index) => {
      const wave = Math.sin(step + (index * Math.PI * 2) / 3 + (index === 2 ? 0.4 : 0));
      const origin = footOrigins[index]!;
      foot.position.set(
        origin.x,
        origin.y + Math.max(0, wave) * movement * 0.052,
        origin.z + wave * movement * 0.048,
      );
      foot.rotation.x = wave * movement * 0.16;
    });
    eyes.forEach((group, index) => {
      const blinkPhase = (seconds + 3.4 - index * 0.13) % 7.3;
      const blink = blinkPhase < 0.3 ? Math.sin((blinkPhase / 0.3) * Math.PI) : 0;
      group.scale.y = (resting ? 0.73 : 1) * (1 - blink * 0.94);
      pupils[index]!.position.x = (index === 0 ? 0.028 : -0.018) + direction.x * 0.021;
    });
    feelers.forEach((group, index) => {
      const side = index === 0 ? -1 : 1;
      group.rotation.z =
        side *
          ((resting ? -0.2 : 0) + Math.sin(seconds * 1.65 + index * 1.9) * 0.044 + sway * 0.1) -
        direction.x * 0.13;
      group.rotation.x = direction.y * 0.15 + Math.sin(seconds * 1.32 + index) * 0.052;
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
