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

const ROCKET_SPEED       = 12;
const ROCKET_DAMAGE      = 80;
const ROCKET_SPLASH_RAD  = 6;
const ROCKET_COOLDOWN    = 2.5;
const ROCKET_MAX_RANGE   = 40;

const LASER_DPS          = 60;    // damage per second
const LASER_TICK         = 0.1;   // seconds between ticks
const LASER_TICK_DMG     = 6;     // LASER_DPS * LASER_TICK
const LASER_RANGE        = 25;

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

    // Rocket pool (4 max in flight)
    this._rocketPool = [];
    for (let i = 0; i < 4; i++) {
      const rGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.8, 8);
      const rMat = mkMat(0xFF6B35, 0xFF4400, 0.6);
      const rMesh = new THREE.Mesh(rGeo, rMat);
      rMesh.rotation.x = Math.PI / 2; // orient forward
      rMesh.visible = false;
      scene.add(rMesh);
      this._rocketPool.push({
        mesh: rMesh, velocity: new THREE.Vector3(),
        active: false, distanceTraveled: 0
      });
    }
    this._rocketCooldown = 0;

    // Laser beam mesh
    const laserGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 6);
    this._laserBeam = new THREE.Mesh(laserGeo,
      new THREE.MeshBasicMaterial({ color: 0x00FFFF, transparent: true, opacity: 0.85 })
    );
    this._laserBeam.visible = false;
    scene.add(this._laserBeam);
    this._laserTickTimer = 0;
    this._laserActive = false;

    // Grappling hook
    this._hook = new GrapplingHook(scene);
    this._hookCooldown = 0;

    // Camera shake state (passed to main.js via property)
    this.cameraShake = { active: false, timer: 0, intensity: 0 };
    // Set to true for one frame when sword is swung — main.js reads and clears
    this.swordSwungThisFrame = false;
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

  // ─── SHOTGUN — 3-bullet spread, auto-aimed at nearest enemy ───
  _fireShotgun(player, enemies) {
    const nearest = this._findNearest(player.mesh.position, enemies);
    const SPREAD = 0.22; // radians between each pellet
    // Use nearest enemy direction as center, or forward if no target
    let centerAngle = player.mesh.rotation.y;
    if (nearest) {
      const tx = nearest.mesh.position.x - player.mesh.position.x;
      const tz = nearest.mesh.position.z - player.mesh.position.z;
      centerAngle = Math.atan2(tx, tz);
      player.mesh.rotation.y = centerAngle;
    }
    for (let i = -1; i <= 1; i++) {
      const angle = centerAngle + i * SPREAD;
      const dir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
      const bullet = this._acquireBullet();
      if (!bullet) continue;
      const spawnPos = player.mesh.position.clone().addScaledVector(dir, 0.9);
      spawnPos.y = player.mesh.position.y + 1.0;
      bullet.activate(spawnPos, dir.clone().multiplyScalar(BULLET_SPEED), 15);
    }
  }

  // ─── SWORD — instant area damage to all enemies within melee range ───
  _swingSword(player, enemies) {
    const SWORD_RANGE_SQ = 4.0 * 4.0; // increased range so player doesn't have to get hit
    const SWORD_DAMAGE   = 40; // one-shot grunts
    let hit = false;
    for (const e of enemies) {
      if (e.isDead || !e.mesh.visible) continue;
      const dSq = distanceSqXZ(player.mesh.position, e.mesh.position);
      if (dSq < SWORD_RANGE_SQ) {
        e.takeDamage(SWORD_DAMAGE);
        hit = true;
      }
    }
    // Face nearest enemy even if out of range
    const nearest = this._findNearest(player.mesh.position, enemies);
    if (nearest) {
      const tx = nearest.mesh.position.x - player.mesh.position.x;
      const tz = nearest.mesh.position.z - player.mesh.position.z;
      player.mesh.rotation.y = Math.atan2(tx, tz);
    }
    // Small camera shake on a hit
    if (hit) {
      this.cameraShake.active = true;
      this.cameraShake.timer = 0.1;
      this.cameraShake.intensity = 0.1;
    }
  }

  // ─── ROCKET ───
  _fireRocket(player, enemies) {
    // Acquire from pool
    let rocket = null;
    for (const r of this._rocketPool) {
      if (!r.active) { rocket = r; break; }
    }
    if (!rocket) return;

    const nearest = this._findNearest(player.mesh.position, enemies);
    let dir;
    if (nearest) {
      dir = new THREE.Vector3(
        nearest.mesh.position.x - player.mesh.position.x,
        0,
        nearest.mesh.position.z - player.mesh.position.z
      ).normalize();
      player.mesh.rotation.y = Math.atan2(dir.x, dir.z);
    } else {
      const a = player.mesh.rotation.y;
      dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    }

    const spawnPos = player.mesh.position.clone().addScaledVector(dir, 1.2);
    spawnPos.y = player.mesh.position.y + 1.0;
    rocket.mesh.position.copy(spawnPos);
    rocket.mesh.rotation.y = Math.atan2(dir.x, dir.z);
    rocket.velocity.copy(dir).multiplyScalar(ROCKET_SPEED);
    rocket.distanceTraveled = 0;
    rocket.active = true;
    rocket.mesh.visible = true;
  }

  _explodeRocket(position, enemies, player) {
    if (this.audio) this.audio.play('explosion');
    // Splash damage
    const rSq = ROCKET_SPLASH_RAD * ROCKET_SPLASH_RAD;
    for (const e of enemies) {
      if (e.isDead || !e.mesh.visible) continue;
      const dSq = distanceSqXZ(position, e.mesh.position);
      if (dSq < rSq) {
        const dist = Math.sqrt(dSq);
        const dmg = Math.round(ROCKET_DAMAGE * (1 - dist / ROCKET_SPLASH_RAD));
        e.takeDamage(Math.max(15, dmg));
      }
    }
    // Self-damage
    const pDSq = distanceSqXZ(position, player.mesh.position);
    if (pDSq < rSq) {
      const dist = Math.sqrt(pDSq);
      const dmg = Math.round(ROCKET_DAMAGE * 0.5 * (1 - dist / ROCKET_SPLASH_RAD));
      if (dmg > 0) player.takeDamage(dmg);
    }
    // Explosion particles (reuse bomb particles)
    for (const p of this._explosionParticles) {
      if (!p.active) {
        const speed = 6 + Math.random() * 10;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI * 0.6;
        const vel = new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta) * speed,
          Math.abs(Math.cos(phi)) * speed,
          Math.sin(phi) * Math.sin(theta) * speed
        );
        p.activate(position.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 2, Math.random() * 0.5, (Math.random() - 0.5) * 2
        )), vel, 0.5 + Math.random() * 0.4);
      }
    }
    // Camera shake (stronger than bomb)
    this.cameraShake.active = true;
    this.cameraShake.timer = 0.4;
    this.cameraShake.intensity = 0.35;
  }

  // ─── LASER ───
  _updateLaser(delta, player, enemies, buildings, keyState) {
    const weapon = player.unlockedWeapons[player.currentWeaponIndex] || 'pistol';
    const shouldFire = weapon === 'laser' && keyState['Space'];

    if (!shouldFire) {
      this._laserBeam.visible = false;
      this._laserActive = false;
      this._laserTickTimer = 0;
      return;
    }

    this._laserActive = true;
    const nearest = this._findNearest(player.mesh.position, enemies);

    // Start position (chest)
    const start = player.mesh.position.clone();
    start.y += 1.0;

    let end;
    let hitEnemy = nearest;

    if (nearest) {
      const toTarget = nearest.mesh.position.clone().sub(player.mesh.position);
      toTarget.y = 0;
      const dist = toTarget.length();
      if (dist > LASER_RANGE) hitEnemy = null;
      if (hitEnemy) {
        end = hitEnemy.mesh.position.clone();
        end.y += 0.7; // aim at body center
        player.mesh.rotation.y = Math.atan2(toTarget.x, toTarget.z);
      }
    }

    if (!end) {
      // Fire in facing direction
      const a = player.mesh.rotation.y;
      end = start.clone().add(new THREE.Vector3(
        Math.sin(a) * LASER_RANGE, 0, Math.cos(a) * LASER_RANGE
      ));
      hitEnemy = null;
    }

    // Check building occlusion — shorten beam if a building is in the way
    if (buildings) {
      const dir = end.clone().sub(start);
      const totalDist = dir.length();
      dir.normalize();
      // Step along beam in 1-unit increments
      for (let t = 1; t < totalDist; t += 1.0) {
        const checkX = start.x + dir.x * t;
        const checkZ = start.z + dir.z * t;
        const checkY = start.y + dir.y * t;
        let blocked = false;
        for (const b of buildings) {
          if (checkY > b.h) continue;
          if (checkX > b.x - b.halfW && checkX < b.x + b.halfW &&
              checkZ > b.z - b.halfD && checkZ < b.z + b.halfD) {
            end.set(checkX, checkY, checkZ);
            hitEnemy = null;
            blocked = true;
            break;
          }
        }
        if (blocked) break;
      }
    }

    // Position and scale beam
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const beamLen = start.distanceTo(end);
    this._laserBeam.position.copy(mid);
    this._laserBeam.scale.set(1, beamLen, 1);
    this._laserBeam.lookAt(end);
    this._laserBeam.rotateX(Math.PI / 2);

    // Pulse opacity
    this._laserBeam.material.opacity = 0.7 + 0.3 * Math.sin(Date.now() * 0.004 * Math.PI);
    this._laserBeam.visible = true;

    // Damage ticks
    if (hitEnemy) {
      this._laserTickTimer += delta;
      while (this._laserTickTimer >= LASER_TICK) {
        this._laserTickTimer -= LASER_TICK;
        hitEnemy.takeDamage(LASER_TICK_DMG);
      }
    } else {
      this._laserTickTimer = 0;
    }
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
    if (this.audio) this.audio.play('explosion');
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
      player.isGrappling = false;
      return;
    }

    // Find nearest building within range — target its rooftop center.
    // Wall collision is suspended via player.isGrappling so Wellbot
    // gets pulled straight up and through to land on the roof.
    let bestDSq = GRAPPLE_RANGE * GRAPPLE_RANGE;
    let bestTarget = null;
    let bestBuilding = null;

    for (const b of buildings) {
      if (!b.rooftopPos) continue;
      const dSq = distanceSqXZ(player.mesh.position, b.rooftopPos);
      if (dSq < bestDSq) {
        bestDSq = dSq;
        bestBuilding = b;
        // Target center of roof, 1.5 units above surface so player
        // arrives cleanly above the rooftop and settles onto it.
        bestTarget = new THREE.Vector3(b.x, b.h + 1.5, b.z);
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
    // Clear one-frame signals
    this.swordSwungThisFrame = false;

    // ─── Active weapon fire (Space) ───
    this._fireCooldown -= delta;
    if (keyState['Space'] && this._fireCooldown <= 0 && !gameState.isShopOpen) {
      const weapon = player.unlockedWeapons[player.currentWeaponIndex] || 'pistol';
      switch (weapon) {
        case 'shotgun':
          this._fireShotgun(player, enemies);
          this._fireCooldown = 0.45;
          if (this.audio) this.audio.play('shotgun');
          break;
        case 'sword':
          this._swingSword(player, enemies);
          this.swordSwungThisFrame = true;
          this._fireCooldown = 0.4;
          break;
        case 'rocket':
          this._fireRocket(player, enemies);
          this._fireCooldown = ROCKET_COOLDOWN;
          if (this.audio) this.audio.play('rocket');
          break;
        case 'laser':
          // Laser is continuous — handled separately in _updateLaser
          break;
        default:
          this._firePistol(player, enemies);
          this._fireCooldown = PISTOL_FIRE_RATE;
          if (this.audio) this.audio.play('pistol');
      }
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

      // Building collision — stop bullet on wall impact
      if (buildings) {
        let blocked = false;
        const bp = bullet.mesh.position;
        for (const b of buildings) {
          if (bp.y > b.h) continue; // bullet is above this building
          if (bp.x > b.x - b.halfW && bp.x < b.x + b.halfW &&
              bp.z > b.z - b.halfD && bp.z < b.z + b.halfD) {
            bullet.release();
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
      }

      // Enemy hit detection
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

    // ─── Rockets ───
    for (const rocket of this._rocketPool) {
      if (!rocket.active) continue;
      rocket.mesh.position.addScaledVector(rocket.velocity, delta);
      rocket.distanceTraveled += ROCKET_SPEED * delta;

      if (rocket.distanceTraveled > ROCKET_MAX_RANGE) {
        rocket.active = false; rocket.mesh.visible = false; continue;
      }

      // Building hit
      let detonated = false;
      if (buildings) {
        const rp = rocket.mesh.position;
        for (const b of buildings) {
          if (rp.y > b.h) continue;
          if (rp.x > b.x - b.halfW && rp.x < b.x + b.halfW &&
              rp.z > b.z - b.halfD && rp.z < b.z + b.halfD) {
            this._explodeRocket(rp.clone(), enemies, player);
            rocket.active = false; rocket.mesh.visible = false;
            detonated = true; break;
          }
        }
      }
      if (detonated) continue;

      // Enemy hit
      for (const e of enemies) {
        if (e.isDead || !e.mesh.visible) continue;
        const dSq = (rocket.mesh.position.x - e.mesh.position.x) ** 2 +
                    (rocket.mesh.position.z - e.mesh.position.z) ** 2;
        if (dSq < 1.0) {
          this._explodeRocket(rocket.mesh.position.clone(), enemies, player);
          rocket.active = false; rocket.mesh.visible = false; break;
        }
      }
    }

    // ─── Laser ───
    this._updateLaser(delta, player, enemies, buildings, keyState);

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

      // Building wall hit — stop bomb on impact (detonate on fuse)
      if (!this._bomb.grounded && buildings) {
        const bp = this._bomb.mesh.position;
        for (const b of buildings) {
          if (bp.y > b.h) continue; // bomb is above building — skip
          if (
            bp.x > b.x - b.halfW - 0.3 && bp.x < b.x + b.halfW + 0.3 &&
            bp.z > b.z - b.halfD - 0.3 && bp.z < b.z + b.halfD + 0.3
          ) {
            this._bomb.grounded = true;
            this._bomb.velocity.set(0, 0, 0);
            break;
          }
        }
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
      if (this.audio) this.audio.play('grapple');
    }

    const hook = this._hook;
    if (hook.state === 'TRAVELING') {
      player.isGrappling = true;
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
      player.isGrappling = true;
      // Pull player toward hook target (roof edge point)
      const toTarget = hook.target.clone().sub(player.mesh.position);
      const dist = toTarget.length();
      if (dist > 0.4) {
        toTarget.normalize();
        player.mesh.position.addScaledVector(toTarget, GRAPPLE_PULL_SPEED * delta);
        player.velocity.set(0, 0, 0);
      } else {
        // Arrived — snap to roof edge and release
        player.mesh.position.copy(hook.target);
        player.velocity.set(0, 0, 0);
        player.isGrounded = true;
        player.isGrappling = false;
        hook.state = 'IDLE';
        hook.mesh.visible = false;
        hook.rope.visible = false;
      }
      this._updateRope(player);
    }

    // If hook IDLE, hide rope and clear flag
    if (hook.state === 'IDLE') {
      hook.rope.visible = false;
      player.isGrappling = false;
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

  // Expose current weapon name for HUD
  currentWeaponName(player) {
    const id = player.unlockedWeapons[player.currentWeaponIndex] || 'pistol';
    const names = {
      pistol: 'PISTOL', shotgun: 'BOOM BLASTER',
      sword: 'SUPER SWORD', rocket: 'THE ROCKET', laser: 'LASER BEAM',
    };
    return names[id] || id.toUpperCase();
  }
}
