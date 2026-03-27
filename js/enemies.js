// enemies.js — Enemy spawning, AI, coin drops, particle puffs

import * as THREE from 'three';
import { distanceSqXZ, createParticlePool, spawnParticles, updateParticlePool } from './utils.js';

// Colors from art_style_guide.md
const C_ENEMY_RED      = 0xE63946;
const C_ENEMY_DARK_RED = 0x9B2226;
const C_ENEMY_EYE      = 0xFF6B35;
const C_COIN_GOLD      = 0xFFD700;
const C_COIN_EMISSIVE  = 0xB8860B;
const C_PUFF           = 0xE63946;

// AI distance thresholds (squared)
const PURSUE_RANGE_SQ  = 15 * 15;    // 225
const ATTACK_RANGE_SQ  = 1.8 * 1.8;  // ~3.24
const IDLE_RETURN_SQ   = 22 * 22;    // 484 — hysteresis back to IDLE

// Spawn boundary
const SPAWN_RADIUS = 28;
const MAX_ENEMIES  = 5;

// Geometries — initialized lazily on first use (safe for module-level scope)
let _coinGeo = null;
let _puffGeo = null;
function getCoinGeo() { return _coinGeo || (_coinGeo = new THREE.BoxGeometry(0.4, 0.4, 0.15)); }
function getPuffGeo() { return _puffGeo || (_puffGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2)); }

function mkMat(color, emissive = 0x000000, emissiveIntensity = 0) {
  return new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity });
}

// ─────────────────────────────────────────────
// Enemy class
// ─────────────────────────────────────────────
class Enemy {
  constructor(scene, manager) {
    this.scene   = scene;
    this.manager = manager;

    this.health      = 50;
    this.maxHealth   = 50;
    this.speed       = 3.0;
    this.attackPower = 10;
    this.attackRate  = 1.0;
    this.attackCooldown = 0;
    this.state       = 'IDLE';
    this.isDead      = true; // pool starts as available — activate() sets false

    // Walk animation
    this.walkCycle = Math.random() * Math.PI * 2;
    this.baseY     = 0;

    // Wander
    this.wanderDir   = new THREE.Vector3(1, 0, 0);
    this.wanderTimer = 0;

    // Flash
    this._flashTimer = 0;
    this._originalColors = [];

    this.mesh = this._buildMesh();
    scene.add(this.mesh);
    this.mesh.visible = false; // hidden until positioned
  }

  _buildMesh() {
    const group = new THREE.Group();

    // Legs (two separate — art spec says left and right)
    const legGeo = new THREE.BoxGeometry(0.35, 0.45, 0.35);
    const legMat = mkMat(C_ENEMY_DARK_RED);
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.2, 0.225, 0);
    group.add(leftLeg);
    this._leftLeg = leftLeg;

    const rightLeg = new THREE.Mesh(legGeo, legMat.clone());
    rightLeg.position.set(0.2, 0.225, 0);
    group.add(rightLeg);
    this._rightLeg = rightLeg;

    // Body — fused torso+head block
    const bodyGeo = new THREE.BoxGeometry(0.8, 0.9, 0.55);
    const bodyMat = mkMat(C_ENEMY_RED);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0, 0.9, 0);
    group.add(body);
    this._body = body;

    // Arms
    const armGeo = new THREE.BoxGeometry(0.22, 0.5, 0.22);
    const armMat = mkMat(C_ENEMY_DARK_RED);
    const leftArm = new THREE.Mesh(armGeo, armMat);
    leftArm.position.set(-0.55, 0.9, 0);
    group.add(leftArm);
    this._leftArm = leftArm;

    const rightArm = new THREE.Mesh(armGeo, armMat.clone());
    rightArm.position.set(0.55, 0.9, 0);
    group.add(rightArm);
    this._rightArm = rightArm;

    // Cyclops eye — emissive orange
    const eyeGeo = new THREE.BoxGeometry(0.22, 0.18, 0.06);
    const eyeMat = mkMat(C_ENEMY_EYE, C_ENEMY_EYE, 0.8);
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    // Z = body front = 0.55/2 + 0.03 = 0.305
    eye.position.set(0, 1.05, 0.305);
    group.add(eye);
    this._eye = eye;

    // Collect original colors (skip emissive eye to preserve glow)
    group.traverse(obj => {
      if (obj.isMesh && obj !== eye) {
        this._originalColors.push({ mesh: obj, color: obj.material.color.getHex() });
      }
    });

    return group;
  }

  activate(position) {
    this.isDead  = false;
    this.health = this.maxHealth;
    this.state  = 'IDLE';
    this.attackCooldown = 0;
    this.walkCycle = Math.random() * Math.PI * 2;
    this.mesh.position.copy(position);
    this.mesh.position.y = 0;
    this.baseY = 0;
    this.mesh.visible = true;
    this.mesh.scale.setScalar(1);
    this._flashTimer = 0;
    // Restore colors
    for (const { mesh, color } of this._originalColors) {
      mesh.material.color.setHex(color);
    }
  }

  update(delta, player) {
    if (this.isDead) return;

    // Flash restore
    if (this._flashTimer > 0) {
      this._flashTimer -= delta;
      if (this._flashTimer <= 0) {
        for (const { mesh, color } of this._originalColors) {
          mesh.material.color.setHex(color);
        }
      }
    }

    const dSq = distanceSqXZ(this.mesh.position, player.mesh.position);

    switch (this.state) {
      case 'IDLE': {
        // Wander randomly
        this.wanderTimer -= delta;
        if (this.wanderTimer <= 0) {
          const angle = Math.random() * Math.PI * 2;
          this.wanderDir.set(Math.cos(angle), 0, Math.sin(angle));
          this.wanderTimer = 1.5 + Math.random() * 1.5;
        }
        this.mesh.position.x += this.wanderDir.x * this.speed * 0.4 * delta;
        this.mesh.position.z += this.wanderDir.z * this.speed * 0.4 * delta;
        this._animateWalk(delta, 0.4);

        if (dSq < PURSUE_RANGE_SQ) this.state = 'PURSUE';
        break;
      }

      case 'PURSUE': {
        const toPlayer = new THREE.Vector3(
          player.mesh.position.x - this.mesh.position.x,
          0,
          player.mesh.position.z - this.mesh.position.z
        );
        const dist = toPlayer.length();
        if (dist > 0.01) {
          toPlayer.divideScalar(dist);
          this.mesh.position.x += toPlayer.x * this.speed * delta;
          this.mesh.position.z += toPlayer.z * this.speed * delta;
          this.mesh.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
          this._animateWalk(delta, 1.0);
        }

        if (dSq < ATTACK_RANGE_SQ)  this.state = 'ATTACK';
        if (dSq > IDLE_RETURN_SQ)   this.state = 'IDLE';
        break;
      }

      case 'ATTACK': {
        this.attackCooldown -= delta;
        if (this.attackCooldown <= 0) {
          player.takeDamage(this.attackPower);
          this.attackCooldown = this.attackRate;
        }
        // Keep facing player
        const tx = player.mesh.position.x - this.mesh.position.x;
        const tz = player.mesh.position.z - this.mesh.position.z;
        this.mesh.rotation.y = Math.atan2(tx, tz);

        if (dSq > ATTACK_RANGE_SQ * 2) this.state = 'PURSUE';
        break;
      }
    }

    // Hop animation — vertical bob while moving
    if (this.state === 'PURSUE' || this.state === 'IDLE') {
      this.mesh.position.y = this.baseY + Math.abs(Math.sin(this.walkCycle)) * 0.12;
    }

    // Keep on ground
    if (this.mesh.position.y < this.baseY) this.mesh.position.y = this.baseY;

    // World bounds
    this.mesh.position.x = Math.max(-48, Math.min(48, this.mesh.position.x));
    this.mesh.position.z = Math.max(-48, Math.min(48, this.mesh.position.z));
  }

  _animateWalk(delta, speedFactor) {
    this.walkCycle += this.speed * speedFactor * 3.0 * delta;
    // Leg swing
    this._leftLeg.rotation.x  =  Math.sin(this.walkCycle) * 0.35;
    this._rightLeg.rotation.x = -Math.sin(this.walkCycle) * 0.35;
    this._leftArm.rotation.x  = -Math.sin(this.walkCycle) * 0.3;
    this._rightArm.rotation.x =  Math.sin(this.walkCycle) * 0.3;
  }

  takeDamage(amount) {
    if (this.isDead) return;
    this.health -= amount;

    // Flash white
    this._flashTimer = 0.1;
    this.mesh.traverse(obj => {
      if (obj.isMesh) obj.material.color.setHex(0xffffff);
    });

    if (this.health <= 0) {
      this.defeat();
    }
  }

  defeat() {
    this.isDead = true;
    this.mesh.visible = false;
    this.manager.onEnemyDefeated(this);
  }
}

// ─────────────────────────────────────────────
// EnemyManager class
// ─────────────────────────────────────────────
export class EnemyManager {
  constructor(scene) {
    this.scene    = scene;
    this.enemies  = [];
    this.coins    = [];      // { mesh, baseY, phaseOffset }
    this._defeatedCount = 0;
    this._respawnTimer  = 0;
    this._respawnInterval = 10; // seconds between auto-respawn waves

    // Coin material (shared)
    this._coinMat = mkMat(C_COIN_GOLD, C_COIN_EMISSIVE, 0.4);

    // Particle pool for enemy defeat puffs (8 particles × 5 enemies)
    this._puffPool = createParticlePool(scene, 40, getPuffGeo(), mkMat(C_PUFF));

    // Pre-allocate enemy pool
    for (let i = 0; i < MAX_ENEMIES; i++) {
      this.enemies.push(new Enemy(scene, this));
    }
  }

  // Returns a dead enemy slot, or null if pool is full
  _acquireEnemy() {
    for (const e of this.enemies) {
      if (e.isDead && !e.mesh.visible) return e;
    }
    return null;
  }

  spawnAt(position) {
    const enemy = this._acquireEnemy();
    if (!enemy) return null;
    enemy.activate(position.clone());
    return enemy;
  }

  get liveCount() {
    return this.enemies.filter(e => !e.isDead && e.mesh.visible).length;
  }

  spawnInitialWave(count = 3) {
    const positions = [
      new THREE.Vector3(10, 0, 0),
      new THREE.Vector3(-10, 0, 5),
      new THREE.Vector3(4, 0, -10),
      new THREE.Vector3(-6, 0, 12),
      new THREE.Vector3(14, 0, -6),
    ];
    const n = Math.min(count, MAX_ENEMIES);
    for (let i = 0; i < n; i++) {
      this.spawnAt(positions[i % positions.length]);
    }
  }

  _spawnFromEdges(count) {
    const spawned = [];
    for (let i = 0; i < count; i++) {
      if (this.liveCount >= MAX_ENEMIES) break;
      const angle = Math.random() * Math.PI * 2;
      const pos = new THREE.Vector3(
        Math.cos(angle) * SPAWN_RADIUS,
        0,
        Math.sin(angle) * SPAWN_RADIUS
      );
      const e = this.spawnAt(pos);
      if (e) spawned.push(e);
    }
    return spawned;
  }

  onEnemyDefeated(enemy) {
    this._defeatedCount++;
    this._dropCoins(enemy.mesh.position.clone());
    // Spawn puff particles
    spawnParticles(this._puffPool, enemy.mesh.position.clone(), 8, 3, 7, 0.5);
  }

  _dropCoins(position) {
    const count = 3;
    for (let i = 0; i < count; i++) {
      const coinMesh = new THREE.Mesh(getCoinGeo(), this._coinMat.clone());
      const baseY = 0.4;
      coinMesh.position.set(
        position.x + (Math.random() - 0.5) * 1.6,
        baseY,
        position.z + (Math.random() - 0.5) * 1.6
      );
      this.scene.add(coinMesh);
      this.coins.push({
        mesh: coinMesh,
        baseY: baseY,
        phaseOffset: Math.random() * Math.PI * 2,
      });
    }
  }

  update(delta, player) {
    // Update enemies
    for (const enemy of this.enemies) {
      if (!enemy.isDead && enemy.mesh.visible) {
        enemy.update(delta, player);
      }
    }

    // Coin animation + pickup
    const now = Date.now();
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      // Bob and rotate
      coin.mesh.position.y = coin.baseY + Math.sin(now * 0.003 + coin.phaseOffset) * 0.15;
      coin.mesh.rotation.y += 0.04;

      // Pickup check — 0.8 unit radius (art spec §9)
      const dSq = (coin.mesh.position.x - player.mesh.position.x) ** 2 +
                  (coin.mesh.position.z - player.mesh.position.z) ** 2;
      if (dSq < 0.8 * 0.8) {
        player.coins++;
        player.totalCoinsEarned++;
        this.scene.remove(coin.mesh);
        this.coins.splice(i, 1);
      }
    }

    // Particle puffs
    updateParticlePool(this._puffPool, delta);

    // Auto-respawn: maintain up to MAX_ENEMIES active
    this._respawnTimer += delta;
    if (this._respawnTimer >= this._respawnInterval) {
      this._respawnTimer = 0;
      if (this.liveCount < MAX_ENEMIES) {
        const needed = MAX_ENEMIES - this.liveCount;
        this._spawnFromEdges(needed);
      }
    }
  }

  get defeatedCount() {
    return this._defeatedCount;
  }
}
