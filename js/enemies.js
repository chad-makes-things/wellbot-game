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
const C_INDICATOR      = 0xE63946;

// Enemy type configs
const ENEMY_TYPES = {
  grunt:    { hp: 50,  speed: 3.0, attackPower: 10, attackRate: 1.0, coins: 3,  color: C_ENEMY_RED, darkColor: C_ENEMY_DARK_RED, eyeColor: C_ENEMY_EYE },
  sprinter: { hp: 30,  speed: 6.0, attackPower: 8,  attackRate: 0.8, coins: 4,  color: 0xAADD00, darkColor: 0x336600, eyeColor: 0xFFFFFF },
  brute:    { hp: 150, speed: 1.5, attackPower: 20, attackRate: 1.5, coins: 10, color: 0x5B2C6F, darkColor: 0x333333, eyeColor: 0xFF4444 },
  lobber:   { hp: 40,  speed: 0,   attackPower: 12, attackRate: 3.0, coins: 8,  color: 0xE67E22, darkColor: 0xA04000, eyeColor: 0xFFFF00 },
};

// Spawn type selection by difficulty stage
// Earlier variety: sprinters from Stage 1, brutes from Stage 2
const STAGE_TYPE_WEIGHTS = {
  1: { grunt: 70, sprinter: 20, lobber: 10 },
  2: { grunt: 50, sprinter: 25, brute: 10, lobber: 15 },
  3: { grunt: 40, sprinter: 25, brute: 15, lobber: 20 },
  4: { grunt: 35, sprinter: 25, brute: 20, lobber: 20 },
  5: { grunt: 25, sprinter: 25, brute: 25, lobber: 25 },
  6: { grunt: 20, sprinter: 25, brute: 30, lobber: 25 },
};

// Shared indicator geometry + material (diamond shape via rotated box, depthTest off)
let _indicatorGeo = null;
let _indicatorMat = null;
function getIndicatorGeo() {
  if (!_indicatorGeo) _indicatorGeo = new THREE.BoxGeometry(0.45, 0.45, 0.45);
  return _indicatorGeo;
}
function getIndicatorMat() {
  if (!_indicatorMat) {
    _indicatorMat = new THREE.MeshBasicMaterial({
      color: C_INDICATOR,
      transparent: true,
      opacity: 0.85,
      depthTest: false,  // renders through buildings
    });
  }
  return _indicatorMat;
}

// AI distance thresholds (squared)
const PURSUE_RANGE_SQ  = 15 * 15;    // 225
const ATTACK_RANGE_SQ  = 1.8 * 1.8;  // ~3.24
const IDLE_RETURN_SQ   = 22 * 22;    // 484 — hysteresis back to IDLE

// Spawn boundary
const SPAWN_RADIUS = 35;
const MAX_ENEMIES  = 12;
const RECYCLE_DIST_SQ = 70 * 70; // enemies farther than 70u get recycled

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
    this.enemyType   = 'grunt';
    this.coinDrop    = 3;
    this._fleeTimer  = 0;
    this._buildings  = null; // set each frame by manager

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

    // Floating indicator diamond — rendered above enemy, through buildings
    this._indicator = new THREE.Mesh(getIndicatorGeo(), getIndicatorMat().clone());
    this._indicator.rotation.set(Math.PI / 4, 0, Math.PI / 4); // diamond orientation
    this._indicator.visible = false;
    this._indicator.renderOrder = 999; // draw on top
    scene.add(this._indicator);
    this._indicatorBob = Math.random() * Math.PI * 2; // phase offset for bob
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

  activate(position, hpMultiplier = 1.0, speedMultiplier = 1.0, type = 'grunt') {
    this.enemyType = type;
    const cfg = ENEMY_TYPES[type] || ENEMY_TYPES.grunt;

    this.isDead  = false;
    this.maxHealth = cfg.hp;
    this.health = Math.round(cfg.hp * hpMultiplier);
    this.speed  = cfg.speed * (type === 'brute' || type === 'lobber' ? 1.0 : speedMultiplier);
    this.attackPower = cfg.attackPower;
    this.attackRate = cfg.attackRate;
    this.coinDrop = cfg.coins;
    this.state  = type === 'lobber' ? 'IDLE' : 'IDLE';
    this.attackCooldown = 0;
    this.walkCycle = Math.random() * Math.PI * 2;
    this._fleeTimer = 0;

    this.mesh.position.copy(position);
    this.mesh.position.y = 0;
    this.baseY = 0;
    this.mesh.visible = true;
    this._flashTimer = 0;
    this._indicator.visible = true;

    // Resize/recolor based on type
    const scale = type === 'sprinter' ? 0.8 : type === 'brute' ? 1.4 : type === 'lobber' ? 0.9 : 1.0;
    this.mesh.scale.setScalar(scale);

    // Recolor
    this._body.material.color.setHex(cfg.color);
    this._leftLeg.material.color.setHex(cfg.darkColor);
    this._rightLeg.material.color.setHex(cfg.darkColor);
    this._leftArm.material.color.setHex(cfg.darkColor);
    this._rightArm.material.color.setHex(cfg.darkColor);
    this._eye.material.color.setHex(cfg.eyeColor);
    this._eye.material.emissive.setHex(cfg.eyeColor);

    // Update original colors for flash restore
    this._originalColors = [];
    this.mesh.traverse(obj => {
      if (obj.isMesh && obj !== this._eye) {
        this._originalColors.push({ mesh: obj, color: obj.material.color.getHex() });
      }
    });

    // Indicator color matches enemy
    this._indicator.material.color.setHex(cfg.color);
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

    // Sprinter flee behavior
    if (this._fleeTimer > 0) {
      this._fleeTimer -= delta;
      const fromPlayer = new THREE.Vector3(
        this.mesh.position.x - player.mesh.position.x,
        0,
        this.mesh.position.z - player.mesh.position.z
      );
      if (fromPlayer.length() > 0.01) {
        fromPlayer.normalize();
        this.mesh.position.x += fromPlayer.x * this.speed * 1.5 * delta;
        this.mesh.position.z += fromPlayer.z * this.speed * 1.5 * delta;
        this.mesh.rotation.y = Math.atan2(fromPlayer.x, fromPlayer.z);
        this._animateWalk(delta, 1.5);
      }
      return; // skip normal AI while fleeing
    }

    const dSq = distanceSqXZ(this.mesh.position, player.mesh.position);

    // Lobber stays put and attacks from range with visible projectile
    if (this.enemyType === 'lobber') {
      const tx = player.mesh.position.x - this.mesh.position.x;
      const tz = player.mesh.position.z - this.mesh.position.z;
      this.mesh.rotation.y = Math.atan2(tx, tz);

      if (dSq < 25 * 25) {
        this.attackCooldown -= delta;
        if (this.attackCooldown <= 0) {
          this.attackCooldown = this.attackRate;
          // Fire a visible lobbed projectile
          if (this.manager && dSq < 22 * 22) {
            this.manager._fireLobberProjectile(this.mesh.position.clone(), player, this.attackPower);
          }
        }
      }
      return;
    }

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

          // Steering-based obstacle avoidance
          let moveDir = toPlayer.clone();
          if (this._buildings) {
            const feelerDist = 3.0;
            const angle = Math.atan2(toPlayer.x, toPlayer.z);
            const fwdBlocked = this._isPointInBuilding(
              this.mesh.position.x + Math.sin(angle) * feelerDist,
              this.mesh.position.z + Math.cos(angle) * feelerDist
            );
            if (fwdBlocked) {
              const leftAngle = angle + 0.52; // 30 degrees
              const rightAngle = angle - 0.52;
              const leftBlocked = this._isPointInBuilding(
                this.mesh.position.x + Math.sin(leftAngle) * feelerDist,
                this.mesh.position.z + Math.cos(leftAngle) * feelerDist
              );
              const rightBlocked = this._isPointInBuilding(
                this.mesh.position.x + Math.sin(rightAngle) * feelerDist,
                this.mesh.position.z + Math.cos(rightAngle) * feelerDist
              );
              if (!leftBlocked && rightBlocked) {
                moveDir.set(Math.sin(leftAngle), 0, Math.cos(leftAngle));
              } else if (!rightBlocked && leftBlocked) {
                moveDir.set(Math.sin(rightAngle), 0, Math.cos(rightAngle));
              } else if (!leftBlocked && !rightBlocked) {
                // Both clear, pick one randomly based on position
                const pick = (Math.floor(this.mesh.position.x * 7) & 1) === 0;
                const a = pick ? leftAngle : rightAngle;
                moveDir.set(Math.sin(a), 0, Math.cos(a));
              } else {
                // Both blocked, go perpendicular
                moveDir.set(Math.sin(angle + 1.57), 0, Math.cos(angle + 1.57));
              }
            }
          }

          this.mesh.position.x += moveDir.x * this.speed * delta;
          this.mesh.position.z += moveDir.z * this.speed * delta;
          this.mesh.rotation.y = Math.atan2(moveDir.x, moveDir.z);
          this._animateWalk(delta, 1.0);
        }

        // Only enter attack if player is at roughly the same height
        const heightDiff = Math.abs(player.mesh.position.y - this.mesh.position.y);
        if (dSq < ATTACK_RANGE_SQ && heightDiff < 3) this.state = 'ATTACK';
        if (dSq > IDLE_RETURN_SQ)                    this.state = 'IDLE';
        break;
      }

      case 'ATTACK': {
        // Stop attacking if player has moved out of reach vertically (e.g. rooftop)
        const heightDiff = Math.abs(player.mesh.position.y - this.mesh.position.y);
        if (heightDiff >= 3) { this.state = 'PURSUE'; break; }

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

    // No world bounds — infinite city

    // Update floating indicator position — bob above enemy
    this._indicatorBob += delta * 2.0;
    this._indicator.position.set(
      this.mesh.position.x,
      this.mesh.position.y + 2.8 + Math.sin(this._indicatorBob) * 0.15,
      this.mesh.position.z
    );
    this._indicator.rotation.y += delta * 1.5; // slow spin
  }

  _isPointInBuilding(px, pz) {
    if (!this._buildings) return false;
    for (const b of this._buildings) {
      if (px > b.x - b.halfW - 0.6 && px < b.x + b.halfW + 0.6 &&
          pz > b.z - b.halfD - 0.6 && pz < b.z + b.halfD + 0.6) {
        return true;
      }
    }
    return false;
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

    // Sprinter flees after taking damage
    if (this.enemyType === 'sprinter' && this.health > 0) {
      this._fleeTimer = 1.5;
    }

    if (this.health <= 0) {
      this.defeat();
    }
  }

  defeat() {
    this.isDead = true;
    this.mesh.visible = false;
    this._indicator.visible = false;
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

    // Difficulty scaling
    this._targetEnemyCount = 5;
    this._hpMultiplier = 1.0;
    this._speedMultiplier = 1.0;
    this._difficultyStage = 1;
    this._stageName = 'Gentle Start';

    // Coin material (shared)
    this._coinMat = mkMat(C_COIN_GOLD, C_COIN_EMISSIVE, 0.4);

    // Particle pool for enemy defeat puffs (8 particles × 5 enemies)
    this._puffPool = createParticlePool(scene, 40, getPuffGeo(), mkMat(C_PUFF));

    // Lobber projectile pool
    this._lobberProjectiles = [];
    const lobGeo = new THREE.SphereGeometry(0.25, 6, 6);
    const lobMat = new THREE.MeshLambertMaterial({ color: 0x444444, emissive: 0xFF4400, emissiveIntensity: 0.4 });
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(lobGeo, lobMat);
      m.visible = false;
      this.scene.add(m);
      this._lobberProjectiles.push({
        mesh: m, velocity: new THREE.Vector3(),
        active: false, damage: 0, age: 0, targetPlayer: null,
      });
    }

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

  _pickEnemyType() {
    const weights = STAGE_TYPE_WEIGHTS[this._difficultyStage] || STAGE_TYPE_WEIGHTS[1];
    // Count brutes — cap at 3
    if (weights.brute) {
      let bruteCount = 0;
      for (const e of this.enemies) {
        if (!e.isDead && e.mesh.visible && e.enemyType === 'brute') bruteCount++;
      }
      if (bruteCount >= 3) {
        // Remove brute from consideration, redistribute to grunt
        const adjusted = { ...weights };
        adjusted.grunt = (adjusted.grunt || 0) + (adjusted.brute || 0);
        delete adjusted.brute;
        return this._rollType(adjusted);
      }
    }
    return this._rollType(weights);
  }

  _rollType(weights) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (const [type, weight] of Object.entries(weights)) {
      roll -= weight;
      if (roll <= 0) return type;
    }
    return 'grunt';
  }

  spawnAt(position) {
    const enemy = this._acquireEnemy();
    if (!enemy) return null;
    const type = this._pickEnemyType();
    enemy.activate(position.clone(), this._hpMultiplier, this._speedMultiplier, type);
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

  _spawnFromEdges(count, player, buildings) {
    const spawned = [];
    const px = player ? player.mesh.position.x : 0;
    const pz = player ? player.mesh.position.z : 0;
    for (let i = 0; i < count; i++) {
      if (this.liveCount >= MAX_ENEMIES) break;
      // Try up to 5 positions to avoid spawning inside buildings
      for (let attempt = 0; attempt < 5; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const pos = new THREE.Vector3(
          px + Math.cos(angle) * SPAWN_RADIUS,
          0,
          pz + Math.sin(angle) * SPAWN_RADIUS
        );
        if (!this._isInsideBuilding(pos, buildings)) {
          const e = this.spawnAt(pos);
          if (e) spawned.push(e);
          break;
        }
      }
    }
    return spawned;
  }

  _isInsideBuilding(pos, buildings) {
    if (!buildings) return false;
    for (const b of buildings) {
      if (pos.x > b.x - b.halfW - 0.5 && pos.x < b.x + b.halfW + 0.5 &&
          pos.z > b.z - b.halfD - 0.5 && pos.z < b.z + b.halfD + 0.5) {
        return true;
      }
    }
    return false;
  }

  onEnemyDefeated(enemy) {
    this._defeatedCount++;
    this._dropCoins(enemy.mesh.position.clone(), enemy.coinDrop || 3);
    spawnParticles(this._puffPool, enemy.mesh.position.clone(), 8, 3, 7, 0.5);
    if (this.audio) this.audio.play('enemyDeath');

    // Brutes and lobbers drop health pickups
    if (enemy.enemyType === 'brute' || enemy.enemyType === 'lobber') {
      this._dropHealth(enemy.mesh.position.clone());
    }
  }

  _dropHealth(position) {
    const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const mat = new THREE.MeshLambertMaterial({ color: 0x2ECC40, emissive: 0x00AA00, emissiveIntensity: 0.5 });
    const hp = new THREE.Mesh(geo, mat);
    hp.position.set(position.x + (Math.random() - 0.5), 0.4, position.z + (Math.random() - 0.5));
    this.scene.add(hp);
    this.healthPickups = this.healthPickups || [];
    this.healthPickups.push({ mesh: hp, phase: Math.random() * Math.PI * 2 });
  }

  _dropCoins(position, count) {
    count = count || 3;
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

  update(delta, player, buildings) {
    // Update enemies
    for (const enemy of this.enemies) {
      if (!enemy.isDead && enemy.mesh.visible) {
        enemy._buildings = buildings; // for pathfinding feelers
        enemy.update(delta, player);
        if (buildings) this._resolveEnemyBuildings(enemy, buildings);

        // Recycle enemies too far from player
        const dSq = distanceSqXZ(enemy.mesh.position, player.mesh.position);
        if (dSq > RECYCLE_DIST_SQ) {
          enemy.isDead = true;
          enemy.mesh.visible = false;
          enemy._indicator.visible = false;
        }
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
        if (this.audio) this.audio.play('coin');
      }
    }

    // Lobber projectiles
    this._updateLobberProjectiles(delta, player);

    // Health pickup animation + collection
    if (this.healthPickups) {
      const now = Date.now();
      for (let i = this.healthPickups.length - 1; i >= 0; i--) {
        const hp = this.healthPickups[i];
        hp.mesh.position.y = 0.4 + Math.sin(now * 0.004 + hp.phase) * 0.2;
        hp.mesh.rotation.y += 0.05;
        // Pickup check
        const dSq = (hp.mesh.position.x - player.mesh.position.x) ** 2 +
                    (hp.mesh.position.z - player.mesh.position.z) ** 2;
        if (dSq < 1.2) {
          player.health = Math.min(player.maxHealth, player.health + 20);
          this.scene.remove(hp.mesh);
          this.healthPickups.splice(i, 1);
          if (this.audio) this.audio.play('coin'); // reuse ding sound
        }
      }
    }

    // Particle puffs
    updateParticlePool(this._puffPool, delta);

    // Auto-respawn: maintain up to target enemy count
    this._respawnTimer += delta;
    if (this._respawnTimer >= this._respawnInterval) {
      this._respawnTimer = 0;
      const target = this._targetEnemyCount || 5;
      if (this.liveCount < target) {
        const needed = Math.min(3, target - this.liveCount); // spawn up to 3 at a time
        this._spawnFromEdges(needed, player, buildings);
      }
    }
  }

  _fireLobberProjectile(origin, player, damage) {
    let proj = null;
    for (const p of this._lobberProjectiles) {
      if (!p.active) { proj = p; break; }
    }
    if (!proj) return;

    // Compute arc toward player
    const dx = player.mesh.position.x - origin.x;
    const dz = player.mesh.position.z - origin.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const speed = 6;
    proj.mesh.position.copy(origin);
    proj.mesh.position.y += 1.5;
    proj.velocity.set(
      (dx / dist) * speed,
      8, // arc upward
      (dz / dist) * speed
    );
    proj.active = true;
    proj.damage = damage;
    proj.age = 0;
    proj.targetPlayer = player;
    proj.mesh.visible = true;
  }

  _updateLobberProjectiles(delta, player) {
    for (const p of this._lobberProjectiles) {
      if (!p.active) continue;
      p.age += delta;
      p.velocity.y -= 12 * delta; // gravity
      p.mesh.position.addScaledVector(p.velocity, delta);
      p.mesh.rotation.x += 3 * delta;
      p.mesh.rotation.z += 2 * delta;

      // Hit ground or player
      if (p.mesh.position.y <= 0.3 || p.age > 4) {
        // Check distance to player for splash
        const dSq = (p.mesh.position.x - player.mesh.position.x) ** 2 +
                    (p.mesh.position.z - player.mesh.position.z) ** 2;
        if (dSq < 2.5 * 2.5) {
          player.takeDamage(p.damage);
        }
        p.active = false;
        p.mesh.visible = false;
        // Small particle burst
        spawnParticles(this._puffPool, p.mesh.position.clone(), 4, 2, 5, 0.3);
      }

      // Direct player hit
      const pDSq = (p.mesh.position.x - player.mesh.position.x) ** 2 +
                   (p.mesh.position.y - player.mesh.position.y) ** 2 +
                   (p.mesh.position.z - player.mesh.position.z) ** 2;
      if (pDSq < 1.5) {
        player.takeDamage(p.damage);
        p.active = false;
        p.mesh.visible = false;
        spawnParticles(this._puffPool, p.mesh.position.clone(), 4, 2, 5, 0.3);
      }
    }
  }

  // Push enemy out of building footprints — same logic as player wall collision
  _resolveEnemyBuildings(enemy, buildings) {
    const ENEMY_RADIUS = 0.5;
    const p = enemy.mesh.position;
    for (const b of buildings) {
      if (p.y > b.h) continue; // enemy on a rooftop — skip walls

      const minX = b.x - b.halfW - ENEMY_RADIUS;
      const maxX = b.x + b.halfW + ENEMY_RADIUS;
      const minZ = b.z - b.halfD - ENEMY_RADIUS;
      const maxZ = b.z + b.halfD + ENEMY_RADIUS;

      if (p.x <= minX || p.x >= maxX || p.z <= minZ || p.z >= maxZ) continue;

      // Overlapping — push out on shortest axis
      const dLeft  = p.x - minX;
      const dRight = maxX - p.x;
      const dFront = p.z - minZ;
      const dBack  = maxZ - p.z;
      const minXOv = Math.min(dLeft, dRight);
      const minZOv = Math.min(dFront, dBack);

      if (minXOv < minZOv) {
        p.x += dLeft < dRight ? -dLeft : dRight;
      } else {
        p.z += dFront < dBack ? -dFront : dBack;
      }
    }
  }

  // Difficulty scaling — call each frame with player's lifetime coins
  updateDifficulty(totalCoins) {
    let stage, name, target, hp, spd, interval;
    if (totalCoins < 50)       { stage=1; name='Gentle Start';     target=5;  hp=1.0; spd=1.0;  interval=10; }
    else if (totalCoins < 150) { stage=2; name='Getting Busy';     target=5;  hp=1.0; spd=1.1;  interval=8;  }
    else if (totalCoins < 300) { stage=3; name='Heating Up';       target=6;  hp=1.2; spd=1.15; interval=7;  }
    else if (totalCoins < 500) { stage=4; name='Serious Trouble';  target=7;  hp=1.5; spd=1.2;  interval=6;  }
    else if (totalCoins < 750) { stage=5; name='Overwhelm';        target=9;  hp=1.8; spd=1.3;  interval=5;  }
    else                       { stage=6; name='Maximum Chaos';    target=12; hp=2.2; spd=1.4;  interval=4;  }

    this._difficultyStage = stage;
    this._stageName = name;
    this._targetEnemyCount = target;
    this._hpMultiplier = hp;
    this._speedMultiplier = spd;
    this._respawnInterval = interval;
  }

  get difficultyStage() { return this._difficultyStage; }
  get stageName() { return this._stageName; }

  get defeatedCount() {
    return this._defeatedCount;
  }
}
