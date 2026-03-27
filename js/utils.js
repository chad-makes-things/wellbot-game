// utils.js — Core helper functions for Weller's Game

import * as THREE from 'three';

// Distance squared — avoids sqrt, use for comparisons
export function distanceSq(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

// Distance on XZ plane only (ignores height — used for AI range checks)
export function distanceSqXZ(a, b) {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

// Build an AABB (THREE.Box3) from mesh position and half-extents Vector3
export function buildAABB(position, halfExtents) {
  return new THREE.Box3(
    position.clone().sub(halfExtents),
    position.clone().add(halfExtents)
  );
}

// Clamp a number between min and max
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Linear interpolation
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Simple seeded pseudo-random number generator (mulberry32)
export function createRNG(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Shared material helper — avoids creating duplicate materials
const _matCache = new Map();
export function mat(hexColor, emissiveHex = 0x000000, emissiveIntensity = 0) {
  const key = `${hexColor}_${emissiveHex}_${emissiveIntensity}`;
  if (_matCache.has(key)) return _matCache.get(key);
  const m = new THREE.MeshLambertMaterial({
    color: hexColor,
    emissive: emissiveHex,
    emissiveIntensity: emissiveIntensity,
  });
  _matCache.set(key, m);
  return m;
}

// Spawn a burst of particles from a pool
// pool: { meshes: THREE.Mesh[], ages: number[], lifetimes: number[], velocities: THREE.Vector3[], active: boolean[] }
export function createParticlePool(scene, count, geo, matInst) {
  const pool = {
    meshes: [],
    ages: [],
    lifetimes: [],
    velocities: [],
    active: [],
    baseY: [],
  };
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geo, matInst);
    m.visible = false;
    scene.add(m);
    pool.meshes.push(m);
    pool.ages.push(0);
    pool.lifetimes.push(1);
    pool.velocities.push(new THREE.Vector3());
    pool.active.push(false);
    pool.baseY.push(0);
  }
  return pool;
}

export function spawnParticles(pool, position, count, speedMin, speedMax, lifetime) {
  let spawned = 0;
  for (let i = 0; i < pool.meshes.length && spawned < count; i++) {
    if (!pool.active[i]) {
      pool.active[i] = true;
      pool.ages[i] = 0;
      pool.lifetimes[i] = lifetime;
      pool.meshes[i].position.copy(position);
      pool.meshes[i].visible = true;
      pool.meshes[i].scale.setScalar(1);
      const speed = speedMin + Math.random() * (speedMax - speedMin);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      pool.velocities[i].set(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.abs(Math.cos(phi)) * speed,
        Math.sin(phi) * Math.sin(theta) * speed
      );
      spawned++;
    }
  }
}

export function updateParticlePool(pool, delta) {
  for (let i = 0; i < pool.meshes.length; i++) {
    if (!pool.active[i]) continue;
    pool.ages[i] += delta;
    const t = pool.ages[i] / pool.lifetimes[i];
    if (t >= 1) {
      pool.active[i] = false;
      pool.meshes[i].visible = false;
      continue;
    }
    pool.velocities[i].y -= 9.8 * delta;
    pool.meshes[i].position.addScaledVector(pool.velocities[i], delta);
    const s = 1 - t;
    pool.meshes[i].scale.setScalar(s);
  }
}
