import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ResourceScope, releaseObjectResources } from './sceneResources';
import { decorative, firstVisibleIntersection } from './scenePicking';

describe('scene resource lifetime', () => {
  it('releases detached instance resources while retaining cached GLB resources', () => {
    const assets = new ResourceScope(),
      local = new ResourceScope();
    const geometry = assets.own(new THREE.BoxGeometry(), true);
    const material = assets.own(new THREE.MeshStandardMaterial(), true);
    const geometryDispose = vi.spyOn(geometry, 'dispose'),
      materialDispose = vi.spyOn(material, 'dispose');
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, material));
    const ring = new THREE.Mesh(new THREE.RingGeometry(), new THREE.MeshBasicMaterial());
    const ringGeometryDispose = vi.spyOn(ring.geometry, 'dispose'),
      ringMaterialDispose = vi.spyOn(ring.material, 'dispose');
    group.add(ring);
    local.capture(group);
    releaseObjectResources(group);
    expect(ringGeometryDispose).toHaveBeenCalledTimes(1);
    expect(ringMaterialDispose).toHaveBeenCalledTimes(1);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    local.dispose();
    assets.dispose();
    assets.dispose();
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(ringGeometryDispose).toHaveBeenCalledTimes(1);
  });

  it('releases unique visitor geometry while keeping shared colors', () => {
    const scope = new ResourceScope();
    const sharedColor = scope.own(new THREE.MeshStandardMaterial(), true);
    const avatar = new THREE.Mesh(new THREE.SphereGeometry(), sharedColor);
    const geometryDispose = vi.spyOn(avatar.geometry, 'dispose'),
      colorDispose = vi.spyOn(sharedColor, 'dispose');
    scope.capture(avatar);
    releaseObjectResources(avatar);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(colorDispose).not.toHaveBeenCalled();
    scope.dispose();
    expect(colorDispose).toHaveBeenCalledTimes(1);
  });
});

describe('visible picking', () => {
  it('ignores hidden fallbacks, hidden LODs and decorative geometry before selecting a visible object', () => {
    const root = new THREE.Group();
    const hiddenFallback = new THREE.Group();
    hiddenFallback.visible = false;
    const mesh = () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const hidden = mesh();
    hidden.position.z = 3;
    hiddenFallback.add(hidden);
    root.add(hiddenFallback);
    const hiddenLOD = mesh();
    hiddenLOD.visible = false;
    hiddenLOD.position.z = 2;
    root.add(hiddenLOD);
    const ring = decorative(mesh());
    ring.position.z = 1;
    root.add(ring);
    const target = mesh();
    root.add(target);
    root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
    expect(firstVisibleIntersection(ray, [root])?.object).toBe(target);
    const scope = new ResourceScope();
    scope.capture(root);
    scope.dispose();
  });
});
