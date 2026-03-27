// weapons.js — Pistol auto-aim, bomb, grappling hook

import * as THREE from 'three';
import { distanceSqXZ } from './utils.js';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const BULLET_SPEED     = 25;
const BULLET_MAX_RANGE = 40;
const PISTOL_FIRE_RATE = 0.15;
const PISTOL_DAMAGE    = 20;
const BULLET_POOL_SIZE = 50;
const BULLET_HIT_SQ    = 0.7 * 0.7;  // hit radius squared

const BOMB_DAMAGE       = 40;
const BOMB_RADIUS       = 4.0;
const BOMB_FUSE         = 2.0;
const BOMB_TRAVEL_SPEED = 8;
const BOMB_THROW_DIST   = 5;
const BOMB_COOLDOWN     = 1.5;

const GRAPPLE_RANGE     = 22;
const GRAPPLE_SPEED     = 18;
const GRAPPLE_PULL_SPEED = 12;

// Materials
function mkMat(color, emissive = 0x000000, intensity = 0) {
  return new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: intensity });
}

// ─────────────────────────────────────────────
// Bullet (pooled)
// ─────────────────────────────────────────────
class Bullet {
  constructor(scene) {
    const geo = new THREE.SphereGeometry(0.15, 4, 4);
    const mat = mkMat(0xffff00, 0xffcc00, 0.6);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.velocity = new THREE.Vector3();
    this.distanceTraveled = 0;
    this.damage = PISTOL_DAMAGE;
    this.active = false;
  }

  activate(position, velocity, damage) {
    this.mesh.position.copy(position);
    this.velocity.copy(velocity);
    this.distanceTraveled = 0;
    this.damage = damage;
    this.mesh.visible = true;
    this.active = true;
  }

  release() {
    this.active = false;
    this.mesh.visible = false;
  }
}

// ─────────────────────────────────────────────
// Bomb
// ─────────────────────────────────────────────
class BombInstance {
  constructor(scene) {
    const geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const mat = mkMat(0x333300, 0x886600, 0.4);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.visible = false;
    scene.add(this.mesh);

    // Fuse indicator — small red box on top
    const fuseGeo = new THREE.BoxGeometry(0.08, 0.25, 0.08);
    const fuseMat = mkMat(0xcc2222, 0xff0000, 0.8);
    this.fuseMesh = new THREE.Mesh(fuseGeo, fuseMat);
    this.fuseMesh.position.y = 0.32;
    this.mesh.add(this.fuseMesh);

    this.active      = false;
    this.fuse        = 0;
    this.velocity    = new THREE.Vector3();
    this.grounded    = false;
  }

  activate(position, velocity) {
    this.mesh.position.copy(position);
    this.velocity.copy(velocity);
    this.fuse     = BOMB_FUSE;
    this.grounded = false;
    this.active   = true;
    this.mesh.visible = true;
  }

  release() {
    this.active = false;
    this.mesh.visible = false;
  }
}

// ─────────────────────────────────────────────
// Explosion particles (pooled)
// ─────────────────────────────────────────────
class ExplosionParticle {
  constructor(scene, size, color, emissive) {
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = mkMat(color, emissive, 0.6);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.velocity = new THREE.Vector3();
    this.age      = 0;
    this.lifetime = 0.7;
    this.active   = false;
  }

  activate(pos, vel, lifetime) {
    this.mesh.position.copy(pos);
    this.velocity.copy(vel);
    this.age      = 0;
    this.lifetime = lifetime;
    this.active   = true;
    this.mesh.visible = true;
    this.mesh.scale.setScalar(1);
  }

  update(delta) {
    if (!this.active) return;
    this.age += delta;
    if (this.age >= this.lifetime) {
      this.active = false;
      this.mesh.visible = false;
      return;
    }
    this.velocity.y -= 9.8 * delta;
    this.mesh.position.addScaledVector(this.velocity, delta);
    this.mesh.scale.setScalar(1 - this.age / this.lifetime);
  }

  release() {
    this.active = false;
    this.mesh.visible = false;
  }
}

// ─────────────────────────────────────────────
// Grappling Hook
// ─────────────────────────────────────────────
class GrapplingHook {
  constructor(scene) {
    // Hook head
    const geo = new THREE.BoxGeometry(0.2, 0.2, 0.3);
    const mat = mkMat(0x888888, 0x444444, 0.2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.visible = false;
    scene.add(this.mesh);

    // Rope line — we'll use a thin BoxGeometry updated per frame
    const ropeGeo = new THREE.BoxGeometry(0.05, 0.05, 1);
    const ropeMat = mkMat(0xaaaaaa);
    this.rope = new THREE.Mesh(ropeGeo, ropeMat);
    this.rope.visible = false;
    scene.add(this.rope);

    this.state    = 'IDLE';    // IDLE | TRAVELING | ATTACHED | PULLING
    this.target   = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.cooldown = 0;
  }
}

// ─────────────────────────────────────────────
// WeaponSystem
// ─────────────────────────────────────────────
export class WeaponSystem {
  constructor(scene) {
    this.scene = scene;

    // Bullet pool
    this._bulletPool = [];
    for (let i = 0; i < BULLET_POOL_SIZE; i++) {
      this._bulletPool.push(new Bullet(scene));
    }
    this._fireCooldown = 0;

    // Bomb (one active at a time in Alpha)
    this._bomb = new BombInstance(scene);
    this._bombCooldown = 0;

    // Explosion particles pool (16)
    this._explosionParticles = [];
    for (let i = 0; i < 8; i++) {
      this._explosionParticles.push(new ExplosionParticle(scene, 0.3, 0xFF6B35, 0xFF4400));
    }
    for (let i = 0; i < 5; i++) {
      this._explosionParticles.push(new ExplosionParticle(scene, 0.25, 0xFFD600, 0xCC8800));
    }
    for (let i = 0; i < 3; i++) {
      this._explosionParticles.push(new ExplosionParticle(scene, 0.15, 0xFFFFFF, 0xFFFFFF));
    }

    // Grappling hook
    this._hook = new GrapplingHook(scene);
    this._hookCooldown = 0;

    // Camera shake state (passed to main.js via property)
    this.cameraShake = { active: false, timer: 0, intensity: 0 };
  }

  // Find nearest living enemy from list
  _findNearest(origin, enemies) {
    let nearestDSq = Infinity;
    let nearest = null;
    for (const e of enemies) {
      if (e.isDead || !e.mesh.visible) continue;
      const dSq = distanceSqXZ(origin, e.mesh.position);
      if (dSq < nearestDSq) {
        nearestDSq = dSq;
        nearest = e;
      }
    }
    return nearest;
  }

  _acquireBullet() {
    for (const b of this._bulletPool) {
      if (!b.active) return b;
    }
    return null;
  }

  // ─── PISTOL FIRE ───
  _firePistol(player, enemies) {
    const nearest = this._findNearest(player.mesh.position, enemies);
    if (!nearest) return;

    const toEnemy = new THREE.Vector3(
      nearest.mesh.position.x - player.mesh.position.x,
      0,
      nearest.mesh.position.z - player.mesh.position.z
    );
    const dist = toEnemy.length();
    if (dist < 0.01) return;
    toEnemy.divideScalar(dist);

    // Snap player facing
    player.mesh.rotation.y = Math.atan2(toEnemy.x, toEnemy.z);

    const bullet = this._acquireBullet();
    if (!bullet) return;

    const spawnPos = player.mesh.position.clone().addScaledVector(toEnemy, 0.9);
    spawnPos.y = player.mesh.position.y + 1.0; // roughly chest height
    bullet.activate(spawnPos, toEnemy.clone().multiplyScalar(BULLET_SPEED), PISTOL_DAMAGE);
  }

  // ─── BOMB THROW ───
  _throwBomb(player) {
    if (this._bomb.active) return;
    // Throw 5 units in the direction Wellbot is facing
    const dir = new THREE.Vector3(
      Math.sin(player.mesh.rotation.y),
      0,
      Math.cos(player.mesh.rotation.y)
    );
    const startPos = player.mesh.position.clone().addScaledVector(dir, 0.8);
    startPos.y = player.mesh.position.y + 0.8;

    const vel = dir.clone().multiplyScalar(BOMB_TRAVEL_SPEED);
    vel.y = 6; // arc upward
    this._bomb.activate(startPos, vel);
  }

  _explodeBomb(position, enemies) {
    this._bomb.release();
    // Area damage
    const rSq = BOMB_RADIUS * BOMB_RADIUS;
    for (const e of enemies) {
      if (e.isDead || !e.mesh.visible) continue;
      const dSq = distanceSqXZ(position, e.mesh.position);
      if (dSq < rSq) {
        const dmg = Math.round(BOMB_DAMAGE * (1 - Math.sqrt(dSq) / BOMB_RADIUS));
        e.takeDamage(Math.max(10, dmg));
      }
    }
    // Explosion particles
    for (const p of this._explosionParticles) {
      if (!p.active) {
        const speed = 5 + Math.random() * 8;
        const theta = Math.random() * Math.PI * 2;
        const phi   = Math.random() * Math.PI * 0.6;
        const vel = new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta) * speed,
          Math.abs(Math.cos(phi)) * speed,
          Math.sin(phi) * Math.sin(theta) * speed
        );
        const offset = new THREE.Vector3(
          (Math.random() - 0.5) * 1.5,
          Math.random() * 0.5,
          (Math.random() - 0.5) * 1.5
        );
        p.activate(position.clone().add(offset), vel, 0.45 + Math.random() * 0.35);
      }
    }
    // Camera shake
    this.cameraShake.active = true;
    this.cameraShake.timer = 0.3;
    this.cameraShake.intensity = 0.3;
  }

  // ─── GRAPPLING HOOK ───
  _fireGrapple(player, buildings) {
    const hook = this._hook;
    if (hook.state !== 'IDLE') {
      // Cancel if already active
      hook.state = 'IDLE';
      hook.mesh.visible = false;
      hook.rope.visible = false;
      return;
    }

    // Find nearest building top edge within range
    let bestDSq = GRAPPLE_RANGE * GRAPPLE_RANGE;
    let bestTarget = null;

    for (const b of buildings) {
      if (!b.rooftopPos) continue;
      const dSq = distanceSqXZ(player.mesh.position, b.rooftopPos);
      if (dSq < bestDSq) {
        bestDSq = dSq;
        bestTarget = b.rooftopPos.clone();
      }
    }

    if (!bestTarget) return; // nothing in range

    hook.target.copy(bestTarget);
    hook.mesh.position.copy(player.mesh.position);
    hook.mesh.position.y += 1.5; // launch from chest
    const dir = bestTarget.clone().sub(hook.mesh.position).normalize();
    hook.velocity.copy(dir).multiplyScalar(GRAPPLE_SPEED);
    hook.state = 'TRAVELING';
    hook.mesh.visible = true;
    hook.rope.visible = true;
  }

  update(delta, player, enemies, gameState, keyState, justPressed, buildings) {
    // ─── Pistol ───
    this._fireCooldown -= delta;
    if (keyState['Space'] && this._fireCooldown <= 0 && !gameState.isShopOpen) {
      this._firePistol(player, enemies);
      this._fireCooldown = PISTOL_FIRE_RATE;
    }

    // Update bullets
    for (const bullet of this._bulletPool) {
      if (!bullet.active) continue;
      bullet.mesh.position.addScaledVector(bullet.velocity, delta);
      bullet.distanceTraveled += BULLET_SPEED * delta;

      if (bullet.distanceTraveled > BULLET_MAX_RANGE) {
        bullet.release();
        continue;
      }

      // Hit detection
      let hit = false;
      for (const e of enemies) {
        if (e.isDead || !e.mesh.visible) continue;
        const dSq = (bullet.mesh.position.x - e.mesh.position.x) ** 2 +
                    (bullet.mesh.position.z - e.mesh.position.z) ** 2;
        if (dSq < BULLET_HIT_SQ) {
          e.takeDamage(bullet.damage);
          bullet.release();
          hit = true;
          break;
        }
      }
      if (hit) continue;
    }

    // ─── Bomb ───
    this._bombCooldown -= delta;
    if (justPressed['KeyZ'] && this._bombCooldown <= 0 && !gameState.isShopOpen) {
      this._throwBomb(player);
      this._bombCooldown = BOMB_COOLDOWN;
    }

    if (this._bomb.active) {
      // Physics
      this._bomb.velocity.y -= 9.8 * delta;
      this._bomb.mesh.position.addScaledVector(this._bomb.velocity, delta);
      this._bomb.mesh.rotation.x += 2 * delta;

      // Ground hit
      if (this._bomb.mesh.position.y <= 0.2) {
        this._bomb.mesh.position.y = 0.2;
        this._bomb.grounded = true;
        this._bomb.velocity.set(0, 0, 0);
      }

      // Enemy contact check (before fuse)
      if (!this._bomb.grounded) {
        for (const e of enemies) {
          if (e.isDead || !e.mesh.visible) continue;
          const dSq = distanceSqXZ(this._bomb.mesh.position, e.mesh.position);
          if (dSq < 0.8 * 0.8) {
            this._explodeBomb(this._bomb.mesh.position.clone(), enemies);
            break;
          }
        }
      }

      // Fuse countdown
      if (this._bomb.active) {
        this._bomb.fuse -= delta;
        if (this._bomb.fuse <= 0) {
          this._explodeBomb(this._bomb.mesh.position.clone(), enemies);
        }
      }
    }

    // Update explosion particles
    for (const p of this._explosionParticles) p.update(delta);

    // Camera shake decay
    if (this.cameraShake.active) {
      this.cameraShake.timer -= delta;
      this.cameraShake.intensity = Math.max(0, this.cameraShake.intensity - delta);
      if (this.cameraShake.timer <= 0) {
        this.cameraShake.active = false;
        this.cameraShake.intensity = 0;
      }
    }

    // ─── Grappling Hook ───
    this._hookCooldown -= delta;
    if (justPressed['KeyX'] && this._hookCooldown <= 0 && !gameState.isShopOpen) {
      this._fireGrapple(player, buildings || []);
      this._hookCooldown = 0.5;
    }

    const hook = this._hook;
    if (hook.state === 'TRAVELING') {
      hook.mesh.position.addScaledVector(hook.velocity, delta);

      // Check if reached target
      const dSq = (hook.mesh.position.x - hook.target.x) ** 2 +
                  (hook.mesh.position.y - hook.target.y) ** 2 +
                  (hook.mesh.position.z - hook.target.z) ** 2;
      if (dSq < 0.5) {
        hook.state = 'ATTACHED';
        hook.mesh.position.copy(hook.target);
      }

      // Update rope
      this._updateRope(player);
    } else if (hook.state === 'ATTACHED') {
      // Pull player toward hook target
      const toTarget = hook.target.clone().sub(player.mesh.position);
      const dist = toTarget.length();
      if (dist > 0.5) {
        toTarget.normalize();
        player.mesh.position.addScaledVector(toTarget, GRAPPLE_PULL_SPEED * delta);
        player.velocity.set(0, 0, 0);
      } else {
        // Arrived — land on rooftop
        player.mesh.position.copy(hook.target);
        player.mesh.position.y = hook.target.y; // stand on roof
        player.isGrounded = true;
        player.velocity.set(0, 0, 0);
        hook.state = 'IDLE';
        hook.mesh.visible = false;
        hook.rope.visible = false;
      }
      this._updateRope(player);
    }

    // If hook IDLE, hide rope
    if (hook.state === 'IDLE') {
      hook.rope.visible = false;
    }
  }

  _updateRope(player) {
    const hook  = this._hook;
    const start = new THREE.Vector3(
      player.mesh.position.x,
      player.mesh.position.y + 1.5,
      player.mesh.position.z
    );
    const end = hook.mesh.position.clone();
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const length = start.distanceTo(end);
    const dir = end.clone().sub(start).normalize();

    hook.rope.position.copy(mid);
    hook.rope.scale.z = length;
    hook.rope.lookAt(end);
    hook.rope.visible = true;
  }

  // Expose weapons list for HUD/Shop
  get currentWeaponName() {
    return 'PISTOL'; // Alpha: only pistol is active
  }
}
