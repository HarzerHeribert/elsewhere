import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { VisitorSessionView, WorldObject } from '@elsewhere/character-interfaces';
import { worldObjectObservationHeight } from '@elsewhere/character-interfaces/spatial';
import type { Snapshot, Position } from './types';
import {
  directWalkTarget,
  predictApprovedPath,
  stepLocalMovement,
  WORLD_PREDICTION_MS,
} from './sceneMotion';
import { worldAssetLoader } from './worldAssets';
import { createCraftKit } from './craft';
import { createWorldLook } from './worldLook';
import { windUniforms } from './wind';
import { createAtmosphere } from './atmosphere';
import { buildVillageArchitecture, type VillageArchitecture } from './architecture';
import { buildGardens } from './gardens';
import { createWildlife } from './wildlife';
import { createHubertCreature } from './HubertCreature';
import { buildForest } from './forest';
import { createEnvironmentMaterials } from './materials';
import { createScenePrimitives, SCENE_COLORS as COLORS } from './scenePrimitives';
import { createWorldObjectModel, type WorldObjectModel } from './worldObjectModels';
import type { WorldControlAction, WorldControlCommand } from './sceneControls';
import { placeActorModel, resetActorPlacement } from './sceneActors';
import { buildMeadowBoundary } from './meadowBoundary';
import { buildVillagePaths } from './villagePaths';
import { staticLayoutKey, villageScenery } from './scenery';
import { ResourceScope, releaseObjectResources } from './sceneResources';
import { firstVisibleIntersection } from './scenePicking';

export type CameraMode = 'overview' | 'visitor' | 'hubert';
export type VisitorView = VisitorSessionView;
export interface SceneControls {
  captureMouse(): Promise<boolean>;
  releaseMouse(): void;
}
type Props = {
  paused?: boolean;
  onStop?: () => void;
  onSelectCharacter?: (id: string) => void;
  onPointerLockChange?: (locked: boolean) => void;
  controlsRef?: MutableRefObject<SceneControls | null>;
  snapshot: Snapshot | null;
  mode: CameraMode;
  selected: string | null;
  onSelect: (id: string) => void;
  resetKey: number;
  visitor: VisitorView | null;
  onMove: (position: Position) => void;
  onLook: (facing: number) => void;
  focus: Position | null;
  control: WorldControlCommand | null;
};
const gazeHeight = (object: WorldObject) =>
  object.observationHeight ??
  ('behavior' in object
    ? (object.elevation ?? 0) + object.height * 0.5
    : worldObjectObservationHeight(object));

export function Scene(props: Props) {
  const container = useRef<HTMLDivElement>(null),
    live = useRef(props);
  live.current = props;
  const [failed, setFailed] = useState(false);
  const world = props.snapshot?.world ?? villageScenery;
  const layoutKey = useMemo(() => staticLayoutKey(world), [world]);
  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      // The light pipeline smooths edges itself, so the canvas needs no multisampling.
      renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setClearColor(0xaacac4);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Shadows are redrawn on their own, slower beat (see the frame loop).
    renderer.shadowMap.autoUpdate = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Several passes draw each frame; statistics are reset once per frame instead.
    renderer.info.autoReset = false;
    const look = createWorldLook(renderer);
    renderer.domElement.dataset.look = look.enabled ? 'graded' : 'direct';
    host.appendChild(renderer.domElement);
    let disposed = false;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.08, 260);
    camera.position.set(39, 46, 53);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0, 0);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.07;
    orbit.minDistance = 5;
    orbit.maxDistance = 125;
    orbit.maxPolarAngle = Math.PI * 0.48;
    orbit.minPolarAngle = 0.1;
    // Development-only handle for inspecting the scene from authored viewpoints.
    if (import.meta.env.DEV)
      (window as unknown as Record<string, unknown>).__elsewhereView = {
        camera,
        orbit,
        scene,
        renderer,
      };
    const resources = new ResourceScope();
    const assetLoaded = new Set<string>(),
      assetFailed = new Set<string>(),
      assetPending = new Set<string>(),
      textureLoaded = new Set<string>(),
      textureFailed = new Set<string>();
    const assetDiagnostics = () => {
      host.dataset.assetsLoaded = JSON.stringify([...assetLoaded].sort());
      host.dataset.assetsFailed = JSON.stringify([...assetFailed].sort());
      host.dataset.assetsPending = String(assetPending.size);
      host.dataset.texturesLoaded = JSON.stringify([...textureLoaded].sort());
      host.dataset.texturesFailed = JSON.stringify([...textureFailed].sort());
    };
    const surfaces = createEnvironmentMaterials(renderer, {
      onTexture: (url, status) => {
        if (status === 'loaded') textureLoaded.add(url);
        else textureFailed.add(url);
        assetDiagnostics();
      },
    });
    const atmosphere = createAtmosphere(scene, renderer, surfaces);
    const attachAsset = worldAssetLoader(
      scene,
      () => !disposed,
      ({ url, status }) => {
        if (status === 'pending') assetPending.add(url);
        else {
          assetPending.delete(url);
          if (status === 'loaded') assetLoaded.add(url);
          else assetFailed.add(url);
        }
        assetDiagnostics();
      },
    );
    const wildlife = createWildlife(scene, attachAsset);
    const primitives = createScenePrimitives({ scene, resources, surfaces });
    const { material, surface, box, cylinder, sphere } = primitives;
    const craft = createCraftKit(surfaces, resources);

    function label(text: string, x: number, z: number) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 80;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, 512, 80);
      ctx.font = '30px Georgia';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#496345';
      ctx.fillText(text, 256, 48);
      const map = new THREE.CanvasTexture(canvas),
        sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, opacity: 0.8 }),
        );
      sprite.position.set(x, 5, z);
      sprite.scale.set(7, 1.1, 1);
      scene.add(sprite);
      resources.capture(sprite);
      return sprite;
    }
    const occluders: THREE.Object3D[] = [];
    const pickObjects: THREE.Object3D[] = [],
      objectModels = new Map<string, WorldObjectModel>();
    const labels: THREE.Sprite[] = [];
    let architecture: VillageArchitecture | null = null;
    let gardens: ReturnType<typeof buildGardens> | null = null;
    let forest: ReturnType<typeof buildForest> | null = null;
    function initializeWorld() {
      const w = live.current.snapshot?.world ?? villageScenery,
        b = w.bounds;
      buildMeadowBoundary(b, scene, surfaces);
      forest = buildForest(w, scene, attachAsset, surfaces);
      const entryGate = new THREE.Group();
      entryGate.position.set(b.maxX, 0, 7);
      entryGate.rotation.y = Math.PI / 2;
      scene.add(entryGate);
      craft.fieldGate(entryGate, 2);
      craft.merge(entryGate);
      for (const place of w.places) {
        if (!place.entryPoint || place.id === 'meadow') continue;
        const post = new THREE.Group();
        post.position.set(place.entryPoint.x + 1.4, 0, place.entryPoint.z + 0.8);
        scene.add(post);
        post.rotation.y = Math.atan2(-place.entryPoint.x, -place.entryPoint.z) * 0.35;
        craft.signpost(post);
        craft.merge(post);
      }
      // The terrain and location labels follow the authoritative world's actual bounds.
      for (const place of w.places) {
        if (place.id === 'meadow') continue;
        const p = place.bounds,
          cx = (p.minX + p.maxX) / 2,
          cz = (p.minZ + p.maxZ) / 2;
        colorPlace(place.id, p.minX, p.maxX, p.minZ, p.maxZ);
        labels.push(label(place.name, cx, cz));
      }
      function colorPlace(id: string, x1: number, x2: number, z1: number, z2: number) {
        if (!['workshop', 'library'].includes(id)) return;
        const width = x2 - x1,
          depth = z2 - z1;
        const floor = new THREE.Mesh(
          new THREE.PlaneGeometry(width, depth),
          id === 'workshop'
            ? surfaces.material('timber', { repeat: [width / 2, depth / 2], normalStrength: 0.65 })
            : surfaces.material('stone', { repeat: [width / 2, depth / 2], normalStrength: 0.7 }),
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.set((x1 + x2) / 2, 0.055, (z1 + z2) / 2);
        floor.receiveShadow = true;
        scene.add(floor);
      }
      // Every visible wall matches the server collision rectangles.
      architecture = buildVillageArchitecture(w, scene, attachAsset, surfaces, craft);
      gardens = buildGardens(w, scene, attachAsset);
      occluders.push(...architecture.occluders);
      for (const obstacle of w.obstacles) {
        if (architecture.renderedObstacleIds.has(obstacle.id) || obstacle.id === 'garden-bed')
          continue;
        if (obstacle.id.includes('trunk')) continue;
        if (obstacle.id.includes('pond') || obstacle.id.includes('water')) continue;
        const wall = box(
          obstacle.maxX - obstacle.minX,
          obstacle.height,
          obstacle.maxZ - obstacle.minZ,
          obstacle.color ?? 0xe5e1d1,
          (obstacle.minX + obstacle.maxX) / 2,
          0,
          (obstacle.minZ + obstacle.maxZ) / 2,
        );
        occluders.push(wall);
        if (obstacle.id.startsWith('library'))
          surface(
            wall,
            'stone',
            Math.max(obstacle.maxX - obstacle.minX, obstacle.maxZ - obstacle.minZ) / 2,
            obstacle.height / 2,
            0xe9e4d3,
          );
      }
      buildVillagePaths(scene, surfaces);

      resources.capture(scene);
    }

    function avatar(color: number, hat: number) {
      const group = new THREE.Group();
      box(0.62, 0.65, 0.42, color, 0, 0.42, 0, group);
      sphere(0.36, COLORS.paper, 0, 1.38, 0, group);
      for (const x of [-0.13, 0.13]) sphere(0.035, 0x293e34, x, 1.42, 0.33, group);
      box(0.13, 0.025, 0.03, COLORS.clay, 0, 1.27, 0.346, group);
      const feet: THREE.Mesh[] = [];
      const arms: THREE.Mesh[] = [];
      for (const x of [-0.18, 0.18]) feet.push(box(0.2, 0.25, 0.3, 0x796951, x, 0.07, 0.03, group));
      group.userData.feet = feet;
      group.userData.stepPhase = 0;
      for (const x of [-0.4, 0.4]) arms.push(box(0.13, 0.42, 0.14, color, x, 0.52, 0, group));
      group.userData.arms = arms;
      cylinder(0.4, 0.08, hat, 0, 1.6, 0, group);
      scene.add(group);
      resources.capture(group);
      return group;
    }
    const creature = createHubertCreature(),
      hubert = creature.root;
    scene.add(hubert);
    hubert.position.set(2, 0, 3);
    pickObjects.push(hubert);
    let worldEpoch = '',
      lastWorldVersion = -1;
    const visitorAvatars = new Map<string, THREE.Group>();
    renderer.domElement.tabIndex = 0;
    const keys = new Set<string>(),
      movementKeys = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown']);
    let yaw = 0,
      pitch = 0,
      modeSeen: CameraMode = 'overview',
      pausedSeen = false,
      resetSeen = live.current.resetKey,
      focusSeen: Position | null = null,
      controlSeen = live.current.control?.serial ?? 0,
      last = performance.now(),
      lastMove = 0,
      stoppingSince = -Infinity,
      lastLook = 0,
      lastDiagnostics = 0,
      frame = 0;
    // An ambient world does not need every display refresh: 60 frames a second while
    // someone steers it or the camera travels, 30 once it has settled. Shadows move
    // slowly enough to be redrawn 30 times a second throughout.
    const ACTIVE_FRAME = 1000 / 60,
      SETTLED_FRAME = 1000 / 30,
      SHADOW_FRAME = 1000 / 30,
      SETTLE_AFTER = 2500;
    let lastFrameAt = -Infinity,
      lastShadowAt = -Infinity,
      lastActive = performance.now();
    const seenCameraPosition = new THREE.Vector3(),
      seenCameraTurn = new THREE.Quaternion();
    const wake = () => {
      lastActive = performance.now();
    };
    const wakeEvents = ['pointerdown', 'wheel', 'keydown', 'touchstart'] as const;
    for (const type of wakeEvents)
      window.addEventListener(type, wake, { capture: true, passive: true });
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let gaitPhase = 0,
      gaitWeight = 0;
    const lastEyePosition = new THREE.Vector3();
    let eyeInitialized = false;
    const viewFrustum = new THREE.Frustum(),
      viewProjection = new THREE.Matrix4();
    const receipts = new Map<string, { stamp: number; at: number }>();
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      Boolean(target.closest('input,textarea,button,[contenteditable="true"],[role="dialog"]'));
    const canWalk = () =>
      live.current.mode === 'visitor' &&
      Boolean(live.current.snapshot && live.current.visitor) &&
      !live.current.paused &&
      !document.hidden &&
      !isTyping(document.activeElement);
    const movementHeld = () => [...keys].some((key) => movementKeys.has(key));
    function halt() {
      stoppingSince = performance.now();
      keys.clear();
      live.current.onStop?.();
    }
    const keydown = (event: KeyboardEvent) => {
      if (!canWalk() || isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (
        ['w', 'a', 's', 'd', 'q', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)
      ) {
        event.preventDefault();
        if (!movementHeld() && movementKeys.has(key)) lastMove = -Infinity;
        keys.add(key);
      }
    };
    const keyup = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase(),
        wasMoving = keys.has(key) && movementKeys.has(key);
      keys.delete(key);
      if (wasMoving && !movementHeld()) halt();
    };
    const blur = () => halt();
    const visibility = () => {
      if (document.hidden) halt();
    };
    const focusin = (event: FocusEvent) => {
      if (live.current.mode === 'visitor' && isTyping(event.target)) halt();
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('focusin', focusin);
    const releaseMouse = () => {
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
    };
    async function captureMouse() {
      if (
        live.current.mode !== 'visitor' ||
        live.current.paused ||
        !renderer.domElement.requestPointerLock
      )
        return false;
      try {
        renderer.domElement.focus({ preventScroll: true });
        await renderer.domElement.requestPointerLock();
        return document.pointerLockElement === renderer.domElement;
      } catch {
        return false;
      }
    }
    const controlsApi: SceneControls = { captureMouse, releaseMouse };
    if (live.current.controlsRef) live.current.controlsRef.current = controlsApi;
    const pointerlockchange = () => {
      const locked = document.pointerLockElement === renderer.domElement;
      live.current.onPointerLockChange?.(locked);
      if (!locked) halt();
    };
    document.addEventListener('pointerlockchange', pointerlockchange);
    let down = { x: 0, y: 0 },
      dragging = false,
      dragLast = { x: 0, y: 0 };
    const pointerdown = (event: PointerEvent) => {
      if (live.current.paused) return;
      renderer.domElement.focus({ preventScroll: true });
      down = { x: event.clientX, y: event.clientY };
      dragLast = down;
      dragging = true;
    };
    const pointermove = (event: PointerEvent) => {
      const locked = document.pointerLockElement === renderer.domElement;
      if ((!dragging && !locked) || live.current.mode !== 'visitor' || live.current.paused) return;
      const dx = locked ? event.movementX : event.clientX - dragLast.x,
        dy = locked ? event.movementY : event.clientY - dragLast.y;
      yaw -= dx * 0.0035;
      pitch = THREE.MathUtils.clamp(pitch - dy * 0.003, -1.15, 1.15);
      dragLast = { x: event.clientX, y: event.clientY };
      if (performance.now() - lastLook > 200) {
        lastLook = performance.now();
        live.current.onLook(yaw);
      }
    };
    const pointerup = (event: PointerEvent) => {
      if (!dragging || live.current.paused) return;
      dragging = false;
      const locked = document.pointerLockElement === renderer.domElement;
      if (!locked && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 7) {
        live.current.onLook(yaw);
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      if (
        !locked &&
        (event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom)
      )
        return;
      const point = locked
          ? new THREE.Vector2(0, 0)
          : new THREE.Vector2(
              ((event.clientX - rect.left) / rect.width) * 2 - 1,
              (-(event.clientY - rect.top) / rect.height) * 2 + 1,
            ),
        ray = new THREE.Raycaster();
      ray.setFromCamera(point, camera);
      const hit = firstVisibleIntersection(ray, [
        ...pickObjects,
        ...wildlife.pickables,
        ...occluders,
      ]);
      if (hit) {
        let node: THREE.Object3D | null = hit.object;
        while (node && !node.userData.objectId && !node.userData.characterId) node = node.parent;
        if (node?.userData.characterId) {
          live.current.onSelectCharacter?.(node.userData.characterId);
          return;
        }
        if (node?.userData.objectId) {
          live.current.onSelect(node.userData.objectId);
          return;
        }
        return;
      }
      if (live.current.visitor && live.current.snapshot) {
        const destination = ray.ray.intersectPlane(
          new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
          new THREE.Vector3(),
        );
        if (destination) {
          stoppingSince = -Infinity;
          live.current.onMove({ x: destination.x, z: destination.z });
        }
      }
    };
    const dblclick = () => {
      if (live.current.mode === 'visitor') void captureMouse();
    };
    renderer.domElement.addEventListener('pointerdown', pointerdown);
    window.addEventListener('pointermove', pointermove);
    window.addEventListener('pointerup', pointerup);
    renderer.domElement.addEventListener('dblclick', dblclick);
    function directMove(forward: number, side: number) {
      const data = live.current,
        visitor = data.visitor;
      if (!visitor || data.paused || !data.snapshot) return;
      const magnitude = Math.hypot(forward, side) || 1,
        scale = 1.25 / magnitude;
      const model = visitorAvatars.get(visitor.visitorId);
      const from = model ? { x: model.position.x, z: model.position.z } : visitor.position;
      const target = directWalkTarget(data.snapshot.world, from, {
        x: from.x + (Math.sin(yaw) * forward - Math.cos(yaw) * side) * scale,
        z: from.z + (Math.cos(yaw) * forward + Math.sin(yaw) * side) * scale,
      });
      if (target) {
        stoppingSince = -Infinity;
        data.onMove(target);
      } else data.onStop?.();
    }
    function nudge(action: WorldControlAction) {
      if (live.current.paused) return;
      if (action === 'stop') {
        halt();
        return;
      }
      if (!live.current.visitor || !live.current.snapshot) return;
      if (action === 'turn-left' || action === 'turn-right') {
        yaw += action === 'turn-left' ? 0.3 : -0.3;
        live.current.onLook(yaw);
        return;
      }
      directMove(
        action === 'forward' ? 1 : action === 'back' ? -1 : 0,
        action === 'right' ? 1 : action === 'left' ? -1 : 0,
      );
    }
    const resize = () => {
      renderer.setSize(host.clientWidth, host.clientHeight);
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      look.setSize(buffer.x, buffer.y);
      camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();
    function predicted(
      id: string,
      position: Position,
      path: Position[],
      stamp: number,
      now: number,
      speed = 0.0032,
      cap = 350,
    ) {
      let receipt = receipts.get(id);
      if (!receipt || receipt.stamp !== stamp) {
        receipt = { stamp, at: now };
        receipts.set(id, receipt);
      }
      return predictApprovedPath(position, path, now - receipt.at, speed, cap);
    }

    let lastObjects: WorldObject[] | undefined;
    const shapeKeys = new Map<string, string>();
    function syncObjects(objects: WorldObject[]) {
      if (objects === lastObjects) return;
      lastObjects = objects;
      const shapes = new Map(
        objects.map((o) => [
          o.id,
          JSON.stringify([o.kind, o.footprint, o.height, o.elevation, o.observationHeight]),
        ]),
      );
      for (const [id, model] of objectModels) {
        if (shapes.get(id) === shapeKeys.get(id)) continue;
        model.dispose();
        objectModels.delete(id);
        shapeKeys.delete(id);
        pickObjects.splice(pickObjects.indexOf(model.root), 1);
      }
      for (const object of objects) {
        let model = objectModels.get(object.id);
        if (!model) {
          model = createWorldObjectModel(object, {
            assets: attachAsset,
            surfaces,
            resources,
            primitives,
            craft,
          });
          scene.add(model.root);
          objectModels.set(object.id, model);
          shapeKeys.set(object.id, shapes.get(object.id)!);
          pickObjects.push(model.root);
        }
        model.root.position.set(object.position.x, object.elevation ?? 0, object.position.z);
      }
    }

    let initialized = false;
    function animate(now: number) {
      if (disposed) return;
      const frameInterval = now - lastActive < SETTLE_AFTER ? ACTIVE_FRAME : SETTLED_FRAME,
        sinceFrame = now - lastFrameAt;
      if (sinceFrame < frameInterval - 1.5) {
        frame = requestAnimationFrame(animate);
        return;
      }
      lastFrameAt = sinceFrame > frameInterval * 1.5 ? now : lastFrameAt + frameInterval;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const data = live.current;
      const scenery = data.snapshot?.world ?? villageScenery;
      if (!initialized) {
        initializeWorld();
        initialized = true;
      }
      if (data.controlsRef && data.controlsRef.current !== controlsApi)
        data.controlsRef.current = controlsApi;
      if (Boolean(data.paused) !== pausedSeen) {
        if (data.paused) {
          halt();
          releaseMouse();
        }
        pausedSeen = Boolean(data.paused);
      }
      if (data.snapshot) {
        const epoch = `${data.snapshot.world.id}:${data.snapshot.world.createdAt}:${data.snapshot.runtime.startedAt}`;
        if (epoch !== worldEpoch || data.snapshot.world.version < lastWorldVersion) {
          resetActorPlacement(hubert);
          for (const model of visitorAvatars.values()) resetActorPlacement(model);
          receipts.clear();
          worldEpoch = epoch;
        }
        lastWorldVersion = data.snapshot.world.version;
      }
      const resident = data.snapshot?.world.residents.find(
        (r) => r.id === data.snapshot?.character.id,
      );
      if (resident) {
        const target = predicted(
          'hubert',
          resident.position,
          resident.path,
          data.snapshot!.world.updatedAt,
          now,
          0.0022 * (data.snapshot?.runtime.simulationRate ?? 1),
          data.snapshot!.runtime.paused ? 0 : WORLD_PREDICTION_MS,
        );
        placeActorModel(hubert, target, dt, data.snapshot?.world, [
          resident.position,
          ...resident.path,
        ]);
        hubert.rotation.y = resident.facing;
      }
      syncObjects(scenery.objects);
      for (const [id, model] of objectModels) model.selectionRing.visible = id === data.selected;
      const visitors = [...(data.snapshot?.world.visitors ?? [])];
      if (data.visitor && !visitors.some((visitor) => visitor.id === data.visitor!.visitorId))
        visitors.push({ id: data.visitor.visitorId, name: 'Visitor', ...data.visitor });
      for (const visitor of visitors) {
        let model = visitorAvatars.get(visitor.id);
        if (!model) {
          model = avatar(0x62869b, 0xb2aa8e);
          model.position.set(visitor.position.x, 0, visitor.position.z);
          visitorAvatars.set(visitor.id, model);
        }
        const own = data.visitor?.visitorId === visitor.id,
          source = own ? data.visitor! : visitor,
          stamp = own ? data.visitor!.observedAt : data.snapshot!.world.updatedAt;
        let target = predicted(
          visitor.id,
          source.position,
          source.path,
          stamp,
          now,
          0.0032,
          own ? 800 : WORLD_PREDICTION_MS,
        );
        const forward =
          (keys.has('w') || keys.has('arrowup') ? 1 : 0) -
          (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
        const side = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
        const localInput =
          own &&
          canWalk() &&
          (forward !== 0 || side !== 0) &&
          now - (receipts.get(visitor.id)?.at ?? now) < 800;
        // Brake immediately while the final stop travels to the server. Reconcile
        // with its stopped position once acknowledged, or after a bounded timeout.
        if (own && !movementHeld() && source.path.length && now - stoppingSince < 800)
          target = { x: model.position.x, z: model.position.z };
        if (localInput && model.userData.placed) {
          target = stepLocalMovement(
            data.snapshot!.world,
            { x: model.position.x, z: model.position.z },
            source.position,
            yaw,
            forward,
            side,
            dt,
          );
        }
        placeActorModel(
          model,
          target,
          dt,
          data.snapshot?.world,
          [source.position, ...source.path],
          Boolean(localInput),
        );
        model.rotation.y = own ? yaw : visitor.facing;
        model.visible = !(data.mode === 'visitor' && own);
      }
      for (const [id, model] of visitorAvatars)
        if (!visitors.some((visitor) => visitor.id === id)) {
          releaseObjectResources(model);
          model.removeFromParent();
          visitorAvatars.delete(id);
          receipts.delete(id);
        }
      if (data.mode !== modeSeen) {
        if (modeSeen === 'visitor') halt();
        else keys.clear();
        releaseMouse();
        if (data.mode === 'visitor') {
          yaw = data.visitor?.facing ?? Math.PI;
          pitch = 0;
          if (!data.paused) renderer.domElement.focus({ preventScroll: true });
        }
        if (data.mode === 'overview') {
          camera.position.set(39, 46, 53);
          orbit.target.set(0, 0, 0);
        }
        eyeInitialized = false;
        gaitWeight = 0;
        modeSeen = data.mode;
      }
      if (data.resetKey !== resetSeen) {
        resetSeen = data.resetKey;
        camera.position.set(39, 46, 53);
        orbit.target.set(0, 0, 0);
      }
      if (data.focus !== focusSeen && data.focus) {
        focusSeen = data.focus;
        orbit.target.set(data.focus.x, 0, data.focus.z);
        camera.position.set(data.focus.x + 15, 19, data.focus.z + 17);
      }
      if (data.control && data.control.serial !== controlSeen) {
        controlSeen = data.control.serial;
        nudge(data.control.action);
      }
      if (data.mode === 'visitor' && data.visitor) {
        orbit.enabled = false;
        hubert.visible = Boolean(resident);
        if (canWalk()) {
          const turn =
            (keys.has('arrowleft') || keys.has('q') ? 1 : 0) - (keys.has('arrowright') ? 1 : 0);
          if (turn) {
            yaw += turn * dt * 1.65;
            if (now - lastLook > 200) {
              lastLook = now;
              data.onLook(yaw);
            }
          }
          if (now - lastMove > 220) {
            const forward =
                (keys.has('w') || keys.has('arrowup') ? 1 : 0) -
                (keys.has('s') || keys.has('arrowdown') ? 1 : 0),
              side = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
            if (forward || side) {
              directMove(forward, side);
              lastMove = now;
            }
          }
        }
        const own = visitorAvatars.get(data.visitor.visitorId),
          position =
            own?.position ?? new THREE.Vector3(data.visitor.position.x, 0, data.visitor.position.z);
        const travelled = eyeInitialized
          ? Math.hypot(position.x - lastEyePosition.x, position.z - lastEyePosition.z)
          : 0;
        lastEyePosition.copy(position);
        eyeInitialized = true;
        const walking = Math.min(1, travelled / Math.max(dt * 3.2, 0.001));
        gaitPhase += Math.min(travelled, 0.2) * 7.5;
        gaitWeight += (walking - gaitWeight) * (1 - Math.exp(-dt * 18));
        const weight = reducedMotion.matches || data.paused ? 0 : gaitWeight;
        const sway = Math.sin(gaitPhase) * 0.018 * weight;
        camera.position
          .copy(position)
          .add(
            new THREE.Vector3(
              Math.cos(yaw) * sway,
              1.55 + Math.sin(gaitPhase * 2) * 0.025 * weight,
              -Math.sin(yaw) * sway,
            ),
          );
        camera.lookAt(
          camera.position
            .clone()
            .add(
              new THREE.Vector3(
                Math.sin(yaw) * Math.cos(pitch),
                Math.sin(pitch),
                Math.cos(yaw) * Math.cos(pitch),
              ),
            ),
        );
        camera.rotateZ(Math.sin(gaitPhase) * 0.003 * weight);
        camera.fov = 70;
      } else if (data.mode === 'hubert') {
        orbit.enabled = false;
        hubert.visible = false;
        camera.position
          .copy(hubert.position)
          .add(new THREE.Vector3(0, resident?.eyeHeight ?? creature.eyeHeight, 0));
        const gaze = [
          ...(data.snapshot?.world.objects ?? []),
          ...(data.snapshot?.world.entities ?? []),
        ].find((object) => object.id === resident?.gazeTargetId);
        camera.lookAt(
          gaze
            ? new THREE.Vector3(gaze.position.x, gazeHeight(gaze), gaze.position.z)
            : camera.position
                .clone()
                .add(
                  new THREE.Vector3(
                    Math.sin(hubert.rotation.y),
                    -0.1,
                    Math.cos(hubert.rotation.y),
                  ).multiplyScalar(5),
                ),
        );
        camera.fov = 68;
      } else {
        orbit.enabled = !data.paused;
        hubert.visible = Boolean(resident);
        camera.fov = 42;
        orbit.update();
      }
      const runtime = data.snapshot?.runtime;
      let wildlifeTime = runtime?.simulatedAt ?? 0;
      if (runtime) {
        const receipt = receipts.get('hubert'),
          age = receipt ? Math.min(WORLD_PREDICTION_MS, now - receipt.at) : 0,
          worldTime =
            runtime.simulatedAt + (runtime.paused ? 0 : age * (runtime.simulationRate ?? 1)),
          phase = (worldTime - runtime.startedAt) / 60000,
          wind = 3 + Math.sin(phase / 4) * 1.5;
        wildlifeTime = worldTime;
        for (const model of objectModels.values()) model.updateAmbient(worldTime, wind);
      }
      if (runtime) {
        const birdGaze = data.snapshot?.world.entities?.find(
          (entity) => entity.kind === 'bird' && entity.id === resident?.gazeTargetId,
        );
        creature.update({
          dt,
          worldTime: wildlifeTime,
          paused: runtime.paused,
          resting: /rest|sleep/i.test(
            data.snapshot?.character.activity ?? resident?.activity ?? '',
          ),
          gaze: birdGaze
            ? new THREE.Vector3(birdGaze.position.x, gazeHeight(birdGaze), birdGaze.position.z)
            : undefined,
        });
        renderer.domElement.dataset.hubertModel = hubert.userData.modelKind;
        renderer.domElement.dataset.hubertEyeHeight = String(
          resident?.eyeHeight ?? creature.eyeHeight,
        );
        wildlife.update(
          data.snapshot?.world.entities ?? [],
          dt,
          wildlifeTime,
          data.selected,
          camera.position,
          data.mode === 'overview',
          now,
          data.snapshot!.world.updatedAt,
        );
        renderer.domElement.dataset.wildlife = JSON.stringify(wildlife.positions());
        atmosphere.update(runtime.simulatedAt);
      }
      if (architecture) {
        const cutaway = data.mode === 'overview' && orbit.getDistance() < 32;
        for (const roof of architecture.roofs) {
          const room = scenery.places.find((place) => place.id === roof.userData.placeId)?.bounds;
          roof.visible = !(
            cutaway &&
            room &&
            orbit.target.x >= room.minX &&
            orbit.target.x <= room.maxX &&
            orbit.target.z >= room.minZ &&
            orbit.target.z <= room.maxZ
          );
        }
      }
      camera.updateProjectionMatrix();
      const diagnostic = JSON.stringify({
        x: Number(camera.position.x.toFixed(3)),
        y: Number(camera.position.y.toFixed(3)),
        z: Number(camera.position.z.toFixed(3)),
      });
      if (host!.dataset.cameraPosition !== diagnostic) host!.dataset.cameraPosition = diagnostic;
      host!.dataset.cameraMode = data.mode;
      renderer.domElement.dataset.cameraPosition = diagnostic;
      renderer.domElement.dataset.cameraMode = data.mode;
      for (const text of labels) text.visible = data.mode === 'overview';
      camera.updateMatrixWorld();
      scene.updateMatrixWorld();
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      viewFrustum.setFromProjectionMatrix(viewProjection);
      attachAsset.updateVisibility(camera.position, viewFrustum);
      if (!reducedMotion.matches) windUniforms.uWindTime.value = now / 1000;
      if (
        camera.position.distanceToSquared(seenCameraPosition) > 1e-7 ||
        1 - Math.abs(camera.quaternion.dot(seenCameraTurn)) > 1e-9
      ) {
        seenCameraPosition.copy(camera.position);
        seenCameraTurn.copy(camera.quaternion);
        lastActive = now;
      }
      if (now - lastShadowAt >= SHADOW_FRAME - 1.5) {
        renderer.shadowMap.needsUpdate = true;
        lastShadowAt = now;
      }
      renderer.info.reset();
      look.render(scene, camera);
      if (now - lastDiagnostics > 750) {
        renderer.domElement.dataset.renderStats = JSON.stringify({
          buildings: architecture?.roofs.filter((roof) => roof.visible).length ?? 0,
          objects: objectModels.size,
          residentVisible: hubert.visible,
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
        });
        lastDiagnostics = now;
      }
      frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => {
      disposed = true;
      halt();
      releaseMouse();
      if (live.current.controlsRef) live.current.controlsRef.current = null;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      orbit.dispose();
      for (const type of wakeEvents) window.removeEventListener(type, wake, { capture: true });
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('focusin', focusin);
      document.removeEventListener('pointerlockchange', pointerlockchange);
      window.removeEventListener('pointerup', pointerup);
      window.removeEventListener('pointermove', pointermove);
      renderer.domElement.removeEventListener('pointerdown', pointerdown);
      renderer.domElement.removeEventListener('dblclick', dblclick);
      for (const model of objectModels.values()) model.dispose();
      objectModels.clear();
      creature.dispose();
      wildlife.dispose();
      gardens?.dispose();
      forest?.dispose();
      architecture?.dispose();
      resources.dispose();
      surfaces.dispose();
      attachAsset.dispose();
      atmosphere.dispose();
      scene.clear();
      look.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [layoutKey]);

  const label =
    props.mode === 'visitor'
      ? 'Your street-level view in Elsewhere'
      : props.mode === 'hubert'
        ? "Hubert's viewpoint in Elsewhere"
        : 'Interactive 3D map of Elsewhere. Drag to explore and select a place.';
  return (
    <div
      className={`scene-canvas mode-${props.mode}`}
      ref={container}
      aria-label={label}
      role="img"
    >
      {failed && (
        <div className="canvas-fallback">
          <span>◈</span>
          <h3>A window needs a little light.</h3>
          <p>
            3D rendering is unavailable in this browser. The world’s places and Hubert’s activity
            remain available below.
          </p>
        </div>
      )}
    </div>
  );
}
