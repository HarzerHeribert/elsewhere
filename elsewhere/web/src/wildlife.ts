import * as THREE from 'three';
import { SnapshotMotion } from './snapshotMotion';
import type { WorldEntity } from '@elsewhere/character-interfaces';
import type { AttachWorldAsset } from './worldAssets';
import { ResourceScope, releaseObjectResources } from './sceneResources';

type Animal = {
  root: THREE.Group;
  visual: THREE.Group;
  head: THREE.Group;
  wings: THREE.Group[];
  label: THREE.Sprite;
  ring: THREE.Mesh;
  phase: number;
  butterfly: boolean;
  motion: SnapshotMotion;
  behavior: WorldEntity['behavior'];
  observationVersion: number;
};
export const SPARROW_ASSET = '/assets/assetquest/brown-bird.glb';
const TAU = Math.PI * 2;
const speciesType = (entity: WorldEntity) =>
  entity.kind === 'butterfly'
    ? 'butterfly'
    : entity.kind !== 'bird'
      ? 'other'
      : /mallard|duck/i.test(entity.species ?? entity.id)
        ? 'duck'
        : /robin/i.test(entity.species ?? entity.id)
          ? 'robin'
          : 'sparrow';

/** Positions, species and behaviors come exclusively from the authoritative world. */
export function createWildlife(scene: THREE.Scene, attach: AttachWorldAsset) {
  const animals = new Map<string, Animal>(),
    pickables: THREE.Object3D[] = [],
    resources = new ResourceScope();
  const materials = new Map<number, THREE.MeshStandardMaterial>();
  function material(color: number) {
    let value = materials.get(color);
    if (!value) {
      value = new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0 });
      materials.set(color, value);
      resources.own(value, true);
    }
    return value;
  }
  function ellipsoid(
    parent: THREE.Object3D,
    color: number,
    size: [number, number, number],
    position: [number, number, number],
  ) {
    const geometry = new THREE.SphereGeometry(1, 12, 8),
      mesh = new THREE.Mesh(geometry, material(color));
    resources.own(geometry);
    mesh.scale.set(...size);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function box(
    parent: THREE.Object3D,
    color: number,
    size: [number, number, number],
    position: [number, number, number],
  ) {
    const geometry = new THREE.BoxGeometry(...size),
      mesh = new THREE.Mesh(geometry, material(color));
    resources.own(geometry);
    mesh.position.set(...position);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function beak(
    parent: THREE.Object3D,
    color: number,
    length: number,
    width: number,
    position: [number, number, number],
  ) {
    const geometry = new THREE.ConeGeometry(width, length, 5),
      mesh = new THREE.Mesh(geometry, material(color));
    resources.own(geometry);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(...position);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function textLabel(name: string) {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(247,245,233,.93)';
    ctx.beginPath();
    ctx.roundRect(2, 2, 380, 76, 22);
    ctx.fill();
    ctx.font = '27px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#40573f';
    ctx.fillText(name.slice(0, 27), 192, 41);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    resources.own(texture);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    resources.own(mat);
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.35, 0.28, 1);
    const raycast = sprite.raycast.bind(sprite);
    sprite.raycast = (raycaster, intersections) => {
      if (sprite.visible) raycast(raycaster, intersections);
    };
    return sprite;
  }
  function build(entity: WorldEntity): Animal {
    const root = new THREE.Group(),
      visual = new THREE.Group(),
      head = new THREE.Group(),
      wings: THREE.Group[] = [];
    root.name = entity.id;
    root.userData.objectId = entity.id;
    root.userData.entityId = entity.id;
    scene.add(root);
    root.add(visual);
    const kind = speciesType(entity),
      duck = kind === 'duck',
      robin = kind === 'robin',
      butterfly = kind === 'butterfly',
      fallback = new THREE.Group();
    visual.add(fallback);
    if (butterfly) {
      ellipsoid(fallback, 0x4c4434, [0.012, 0.017, 0.1], [0, 0.06, 0]);
      for (const side of [-1, 1]) {
        const wing = new THREE.Group();
        wing.position.set(side * 0.012, 0.06, 0);
        fallback.add(wing);
        ellipsoid(wing, 0xc99554, [0.105, 0.009, 0.095], [side * 0.085, 0, 0.055]);
        ellipsoid(wing, 0xe2bc73, [0.075, 0.008, 0.07], [side * 0.065, 0, -0.065]);
        ellipsoid(wing, 0x6e5637, [0.015, 0.01, 0.02], [side * 0.13, 0.002, 0.065]);
        wings.push(wing);
      }
      visual.scale.setScalar(Math.max(0.6, (entity.height || 0.17) / 0.17));
    } else if (kind === 'other') {
      ellipsoid(fallback, 0x8ba174, [0.12, 0.12, 0.12], [0, 0.12, 0]);
      visual.scale.setScalar(Math.max(0.5, (entity.height || 0.25) / 0.25));
    } else {
      const coat = duck ? 0x8f7961 : robin ? 0x8d8975 : 0x9a8061,
        wingColor = duck ? 0x6f6353 : robin ? 0x6f7560 : 0x75624d;
      ellipsoid(
        fallback,
        coat,
        duck ? [0.12, 0.1, 0.21] : [0.092, 0.105, 0.135],
        duck ? [0, 0.13, 0] : [0, 0.145, 0],
      );
      ellipsoid(
        fallback,
        duck ? 0xc4bda7 : robin ? 0xcd875d : 0xc8bca0,
        duck ? [0.1, 0.065, 0.13] : [0.075, 0.08, 0.075],
        duck ? [0, 0.1, 0.055] : [0, 0.14, 0.08],
      );
      head.position.set(0, duck ? 0.25 : 0.255, duck ? 0.12 : 0.075);
      fallback.add(head);
      ellipsoid(
        head,
        duck ? 0x4b7459 : robin ? 0x8d8975 : 0x8e765b,
        duck ? [0.075, 0.08, 0.085] : [0.066, 0.07, 0.068],
        [0, 0, 0],
      );
      if (robin) ellipsoid(head, 0xcc8058, [0.05, 0.05, 0.025], [0, -0.018, 0.057]);
      for (const side of [-1, 1])
        ellipsoid(
          head,
          0x222b25,
          [0.009, 0.011, 0.009],
          [side * (duck ? 0.065 : 0.057), 0.012, 0.029],
        );
      if (duck) box(head, 0xd8ad57, [0.075, 0.022, 0.085], [0, -0.018, 0.102]);
      else beak(head, 0x74604a, 0.06, 0.022, [0, -0.012, 0.085]);
      const tail = box(fallback, wingColor, duck ? [0.075, 0.028, 0.09] : [0.045, 0.025, 0.1], [
        0,
        0.14,
        duck ? -0.22 : -0.15,
      ]);
      tail.rotation.x = -0.2;
      for (const side of [-1, 1]) {
        const wing = new THREE.Group();
        wing.position.set(side * (duck ? 0.09 : 0.065), duck ? 0.16 : 0.18, -0.015);
        fallback.add(wing);
        ellipsoid(wing, wingColor, duck ? [0.045, 0.065, 0.13] : [0.03, 0.06, 0.1], [
          side * 0.02,
          -0.025,
          -0.01,
        ]);
        wings.push(wing);
        if (!duck) {
          box(fallback, 0x716248, [0.012, 0.06, 0.012], [side * 0.034, 0.038, 0.01]);
          box(fallback, 0x716248, [0.027, 0.009, 0.05], [side * 0.034, 0.01, 0.025]);
        }
      }
      const scale = (entity.height || (duck ? 0.34 : 0.28)) / (duck ? 0.34 : 0.325);
      fallback.scale.setScalar(scale);
      if (kind === 'sparrow') {
        // The shipped CC0 mesh supplies the body; separate hinged wings make flight legible.
        wings.length = 0;
        for (const side of [-1, 1]) {
          const wing = new THREE.Group();
          wing.position.set(side * 0.055, 0.13, 0);
          visual.add(wing);
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(
              [0, 0, 0, side * 0.2, 0, -0.05, side * 0.14, 0, 0.075, 0, 0, 0.04],
              3,
            ),
          );
          geometry.setIndex([0, 1, 2, 0, 2, 3]);
          geometry.computeVertexNormals();
          const mat = new THREE.MeshStandardMaterial({
            color: 0x80694e,
            roughness: 0.9,
            side: THREE.DoubleSide,
          });
          resources.own(geometry);
          resources.own(mat);
          const mesh = new THREE.Mesh(geometry, mat);
          mesh.castShadow = true;
          wing.add(mesh);
          wing.userData.flightOnly = true;
          wings.push(wing);
        }
        attach(visual, SPARROW_ASSET, entity.height || 0.23, fallback);
      }
    }
    const label = textLabel(entity.species ?? entity.name);
    label.position.y = (entity.height || 0.3) + 0.2;
    root.add(label);
    const ringGeometry = new THREE.RingGeometry(0.3, 0.32, 32),
      ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xe1b965,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      }),
      ring = new THREE.Mesh(ringGeometry, ringMaterial);
    resources.own(ringGeometry);
    resources.own(ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    ring.raycast = () => {};
    root.add(ring);
    const animal = {
      root,
      visual,
      head,
      wings,
      label,
      ring,
      phase: entity.id.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0) % 17,
      butterfly,
      motion: new SnapshotMotion(),
      behavior: entity.behavior,
      observationVersion: entity.observationVersion,
    };
    animals.set(entity.id, animal);
    pickables.push(root);
    return animal;
  }
  function update(
    entities: WorldEntity[],
    dt: number,
    worldTime: number,
    selected: string | null,
    viewer: THREE.Vector3,
    overview: boolean,
    now: number,
    stamp: number,
  ) {
    for (const entity of entities) {
      const animal = animals.get(entity.id) ?? build(entity);
      animal.behavior = entity.behavior;
      animal.observationVersion = entity.observationVersion;
      animal.motion.sample(stamp, now, entity.position.x, entity.elevation, entity.position.z);
      const position = animal.motion.position(now)!;
      animal.root.position.set(position.x, position.y, position.z);
      const delta = Math.atan2(
        Math.sin(entity.facing - animal.root.rotation.y),
        Math.cos(entity.facing - animal.root.rotation.y),
      );
      animal.root.rotation.y += delta * (1 - Math.exp(-dt * 12));
      const phase = worldTime / 1000 + animal.phase,
        foraging = entity.behavior === 'foraging',
        flying = entity.behavior === 'flying',
        swimming = entity.behavior === 'swimming';
      animal.visual.rotation.x = foraging ? Math.max(0, Math.sin(phase * 1.7)) * 0.38 : 0;
      animal.visual.rotation.z = swimming ? Math.sin(phase * 1.3) * 0.025 : 0;
      animal.head.rotation.x = foraging ? Math.max(0, Math.sin(phase * 1.7)) * 0.35 : 0;
      for (let i = 0; i < animal.wings.length; i++) {
        const sign = i === 0 ? 1 : -1;
        animal.wings[i]!.visible = !animal.wings[i]!.userData.flightOnly || flying;
        animal.wings[i]!.rotation.z = flying
          ? sign * Math.sin(phase * (animal.butterfly ? 15 : 11)) * (animal.butterfly ? 1.15 : 0.6)
          : sign * 0.08;
      }
      const viewerDistance = viewer.distanceTo(animal.root.position),
        labelWidth = viewerDistance * (overview ? 0.115 : 0.23);
      animal.label.scale.set(labelWidth, (labelWidth * 80) / 384, 1);
      animal.label.visible =
        viewerDistance > 0.75 && ((!overview && viewerDistance < 7.5) || selected === entity.id);
      animal.ring.visible = selected === entity.id;
      animal.ring.position.y = 0.105 - animal.root.position.y;
    }
    for (const [id, animal] of animals)
      if (!entities.some((entity) => entity.id === id)) {
        attach.detach(animal.root);
        releaseObjectResources(animal.root);
        animal.root.removeFromParent();
        pickables.splice(pickables.indexOf(animal.root), 1);
        animals.delete(id);
      }
  }
  return {
    pickables,
    update,
    positions: () =>
      [...animals].map(([id, animal]) => ({
        id,
        behavior: animal.behavior,
        observationVersion: animal.observationVersion,
        x: Number(animal.root.position.x.toFixed(3)),
        y: Number(animal.root.position.y.toFixed(3)),
        z: Number(animal.root.position.z.toFixed(3)),
      })),
    dispose() {
      for (const animal of animals.values()) {
        attach.detach(animal.root);
        animal.root.removeFromParent();
      }
      resources.dispose();
      materials.clear();
      animals.clear();
      pickables.length = 0;
    },
  };
}
