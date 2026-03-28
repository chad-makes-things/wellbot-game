// vehicles.js — Vehicle system: Bike, Car, Tank
// Beta feature — player can buy, mount, ride, and dismount vehicles

import * as THREE from 'three';
import { distanceSqXZ } from './utils.js';

function mkMat(color, emissive = 0x000000, emissiveIntensity = 0) {
  return new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity });
}

// ─────────────────────────────────────────────
// Vehicle base class
// ─────────────────────────────────────────────
class Vehicle {
  constructor(scene, type, config) {
    this.scene = scene;
    this.type = type;
    this.speed = config.speed;
    this.reverseSpeed = config.reverseSpeed;
    this.turnRate = config.turnRate; // degrees per second
    this.maxHP = config.maxHP || 0;
    this.hp = this.maxHP;
    this.hasWeapon = config.hasWeapon || false;
    this.rammingDamage = config.rammingDamage || 0;
    this.footprintW = config.footprintW || 2;
    this.footprintD = config.footprintD || 4;

    this.mesh = this._buildMesh(config);
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.isSpawned = false;
    this.isOccupied = false;
    this.isDestroyed = false;
    this.heading = 0; // radians

    // Ramming cooldown per enemy (Map<enemy, timer>)
    this._ramCooldowns = new Map();

    // Tank cannon
    this._cannonCooldown = 0;
    this._turretAngle = 0;
  }

  _buildMesh(config) {
    // Override in subclasses
    return new THREE.Group();
  }

  spawn(position, heading) {
    this.mesh.position.copy(position);
    this.mesh.position.y = 0;
    this.heading = heading;
    this.mesh.rotation.y = heading;
    this.mesh.visible = true;
    this.isSpawned = true;
    this.isDestroyed = false;
    this.hp = this.maxHP;
  }

  mount() {
    this.isOccupied = true;
  }

  dismount() {
    this.isOccupied = false;
  }

  update(delta, keyState, cameraAzimuth, buildings) {
    if (!this.isOccupied || this.isDestroyed) return;

    // Turning
    const turnSpeed = this.turnRate * (Math.PI / 180) * delta;
    if (keyState['ArrowLeft'])  this.heading += turnSpeed;
    if (keyState['ArrowRight']) this.heading -= turnSpeed;

    // Forward/reverse
    let speed = 0;
    if (keyState['ArrowUp'])   speed = this.speed;
    if (keyState['ArrowDown']) speed = -this.reverseSpeed;

    if (speed !== 0) {
      const dx = Math.sin(this.heading) * speed * delta;
      const dz = Math.cos(this.heading) * speed * delta;

      // Tentative move
      const newX = this.mesh.position.x + dx;
      const newZ = this.mesh.position.z + dz;

      // Building collision check
      let blocked = false;
      if (buildings) {
        const hw = this.footprintW / 2;
        const hd = this.footprintD / 2;
        for (const b of buildings) {
          if (newX + hw > b.x - b.halfW && newX - hw < b.x + b.halfW &&
              newZ + hd > b.z - b.halfD && newZ - hd < b.z + b.halfD) {
            blocked = true;
            break;
          }
        }
      }

      if (!blocked) {
        this.mesh.position.x = newX;
        this.mesh.position.z = newZ;
      }
    }

    this.mesh.rotation.y = this.heading;

    // Update ram cooldowns
    for (const [enemy, timer] of this._ramCooldowns) {
      const newT = timer - delta;
      if (newT <= 0) this._ramCooldowns.delete(enemy);
      else this._ramCooldowns.set(enemy, newT);
    }
  }

  // Check ramming collision with enemies (car only)
  checkRamming(enemies) {
    if (this.rammingDamage <= 0 || !this.isOccupied) return [];
    const hits = [];
    const hw = this.footprintW / 2;
    const hd = this.footprintD / 2;
    const vx = this.mesh.position.x;
    const vz = this.mesh.position.z;
    for (const e of enemies) {
      if (e.isDead || !e.mesh.visible) continue;
      if (this._ramCooldowns.has(e)) continue;
      const ex = e.mesh.position.x;
      const ez = e.mesh.position.z;
      if (ex > vx - hw - 0.5 && ex < vx + hw + 0.5 &&
          ez > vz - hd - 0.5 && ez < vz + hd + 0.5) {
        e.takeDamage(this.rammingDamage);
        this._ramCooldowns.set(e, 0.5);
        // Knockback
        const kx = ex - vx;
        const kz = ez - vz;
        const kLen = Math.sqrt(kx * kx + kz * kz) || 1;
        e.mesh.position.x += (kx / kLen) * 3;
        e.mesh.position.z += (kz / kLen) * 3;
        hits.push(e);
      }
    }
    return hits;
  }

  takeDamage(amount) {
    if (this.maxHP <= 0) return amount; // no buffer, pass through
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.destroy();
      return 0;
    }
    return 0; // absorbed
  }

  destroy() {
    this.isDestroyed = true;
    this.isOccupied = false;
    this.mesh.visible = false;
  }
}

// ─────────────────────────────────────────────
// Turbo Bike
// ─────────────────────────────────────────────
class Bike extends Vehicle {
  constructor(scene) {
    super(scene, 'motorcycle', {
      speed: 18,
      reverseSpeed: 8,
      turnRate: 180,
      maxHP: 0,
      rammingDamage: 0,
      footprintW: 1.5,
      footprintD: 3.0,
    });
  }

  _buildMesh() {
    const group = new THREE.Group();
    // Body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.8, 3.0),
      mkMat(0xFF6B35)
    );
    body.position.y = 0.6;
    group.add(body);
    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 8);
    const wheelMat = mkMat(0x333333);
    const fw = new THREE.Mesh(wheelGeo, wheelMat);
    fw.rotation.z = Math.PI / 2;
    fw.position.set(0, 0.4, 1.2);
    group.add(fw);
    const rw = new THREE.Mesh(wheelGeo, wheelMat);
    rw.rotation.z = Math.PI / 2;
    rw.position.set(0, 0.4, -1.2);
    group.add(rw);
    // Handlebars
    const hb = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.15, 0.15),
      mkMat(0x666666)
    );
    hb.position.set(0, 1.1, 1.3);
    group.add(hb);
    return group;
  }
}

// ─────────────────────────────────────────────
// Speed Car
// ─────────────────────────────────────────────
class Car extends Vehicle {
  constructor(scene) {
    super(scene, 'car', {
      speed: 12,
      reverseSpeed: 6,
      turnRate: 150,
      maxHP: 50,
      rammingDamage: 30,
      footprintW: 3.0,
      footprintD: 5.0,
    });
  }

  _buildMesh() {
    const group = new THREE.Group();
    // Chassis
    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.8, 5.0),
      mkMat(0x3A86FF)
    );
    chassis.position.y = 0.6;
    group.add(chassis);
    // Cabin
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.0, 2.5),
      mkMat(0x3A86FF, 0x1144AA, 0.1)
    );
    cabin.position.set(0, 1.5, -0.3);
    group.add(cabin);
    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 8);
    const wheelMat = mkMat(0x333333);
    const positions = [
      [-1.3, 0.5, 1.8], [1.3, 0.5, 1.8],
      [-1.3, 0.5, -1.8], [1.3, 0.5, -1.8],
    ];
    for (const [wx, wy, wz] of positions) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, wy, wz);
      group.add(w);
    }
    // Headlights
    const hlGeo = new THREE.BoxGeometry(0.3, 0.2, 0.1);
    const hlMat = mkMat(0xFFFF00, 0xFFFF00, 0.8);
    const hl1 = new THREE.Mesh(hlGeo, hlMat);
    hl1.position.set(-0.9, 0.7, 2.55);
    group.add(hl1);
    const hl2 = new THREE.Mesh(hlGeo, hlMat);
    hl2.position.set(0.9, 0.7, 2.55);
    group.add(hl2);
    return group;
  }
}

// ─────────────────────────────────────────────
// The Tank
// ─────────────────────────────────────────────
class Tank extends Vehicle {
  constructor(scene) {
    super(scene, 'tank', {
      speed: 4,
      reverseSpeed: 2,
      turnRate: 90,
      maxHP: 200,
      hasWeapon: true,
      rammingDamage: 0,
      footprintW: 4.0,
      footprintD: 6.0,
    });
  }

  _buildMesh() {
    const group = new THREE.Group();
    // Hull
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(4.0, 1.2, 6.0),
      mkMat(0x4A5240)
    );
    hull.position.y = 0.8;
    group.add(hull);
    // Treads
    const treadGeo = new THREE.BoxGeometry(0.5, 0.6, 6.0);
    const treadMat = mkMat(0x333333);
    const lt = new THREE.Mesh(treadGeo, treadMat);
    lt.position.set(-2.0, 0.5, 0);
    group.add(lt);
    const rt = new THREE.Mesh(treadGeo, treadMat);
    rt.position.set(2.0, 0.5, 0);
    group.add(rt);
    // Turret base (rotates)
    this._turretGroup = new THREE.Group();
    this._turretGroup.position.set(0, 1.6, 0);
    const turretBase = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.8, 2.0),
      mkMat(0x4A5240, 0x222211, 0.1)
    );
    this._turretGroup.add(turretBase);
    // Barrel
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 3.0, 8),
      mkMat(0x555555)
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.1, 2.0);
    this._turretGroup.add(barrel);
    group.add(this._turretGroup);
    return group;
  }

  updateTurret(delta, targetPos) {
    if (!this._turretGroup || !targetPos) return;
    // Rotate turret toward target
    const dx = targetPos.x - this.mesh.position.x;
    const dz = targetPos.z - this.mesh.position.z;
    const targetAngle = Math.atan2(dx, dz) - this.heading;
    let diff = targetAngle - this._turretAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxRot = (90 * Math.PI / 180) * delta;
    this._turretAngle += Math.sign(diff) * Math.min(Math.abs(diff), maxRot);
    this._turretGroup.rotation.y = this._turretAngle;
  }
}

// ─────────────────────────────────────────────
// Vehicle Manager
// ─────────────────────────────────────────────
export class VehicleManager {
  constructor(scene) {
    this.scene = scene;
    this.vehicles = new Map(); // id → Vehicle
    this._activeVehicle = null; // currently occupied vehicle

    // Camera shake request (read by main.js)
    this.cameraShake = { active: false, timer: 0, intensity: 0 };
  }

  spawnVehicle(vehicleId, position, heading) {
    if (this.vehicles.has(vehicleId)) {
      // Already exists — just reposition if not destroyed
      const v = this.vehicles.get(vehicleId);
      if (!v.isDestroyed) return v;
    }

    let vehicle;
    switch (vehicleId) {
      case 'motorcycle': vehicle = new Bike(this.scene); break;
      case 'car':        vehicle = new Car(this.scene); break;
      case 'tank':       vehicle = new Tank(this.scene); break;
      default: return null;
    }
    vehicle.spawn(position, heading);
    this.vehicles.set(vehicleId, vehicle);
    return vehicle;
  }

  // Check if player can mount a nearby vehicle
  getNearbyVehicle(playerPos) {
    for (const v of this.vehicles.values()) {
      if (!v.isSpawned || v.isDestroyed || v.isOccupied) continue;
      const dSq = distanceSqXZ(playerPos, v.mesh.position);
      if (dSq < 4) return v; // within 2 units
    }
    return null;
  }

  get activeVehicle() { return this._activeVehicle; }

  mountVehicle(vehicle, player) {
    vehicle.mount();
    this._activeVehicle = vehicle;
    player.mesh.visible = false;
    player.inVehicle = vehicle;
  }

  dismountVehicle(player) {
    if (!this._activeVehicle) return;
    const v = this._activeVehicle;
    v.dismount();

    // Place player beside vehicle
    const exitX = v.mesh.position.x + Math.cos(v.heading) * 2;
    const exitZ = v.mesh.position.z - Math.sin(v.heading) * 2;
    player.mesh.position.set(exitX, 0, exitZ);
    player.mesh.visible = true;
    player.velocity.set(0, 0, 0);
    player.isGrounded = true;
    player.inVehicle = null;
    this._activeVehicle = null;
  }

  update(delta, keyState, cameraAzimuth, buildings, enemies, player) {
    if (!this._activeVehicle) return;
    const v = this._activeVehicle;

    v.update(delta, keyState, cameraAzimuth, buildings);

    // Sync player position to vehicle
    if (player.inVehicle) {
      player.mesh.position.copy(v.mesh.position);
    }

    // Car ramming
    if (v.rammingDamage > 0 && enemies) {
      const hits = v.checkRamming(enemies);
      if (hits.length > 0) {
        this.cameraShake.active = true;
        this.cameraShake.timer = 0.15;
        this.cameraShake.intensity = 0.1;
      }
    }

    // Tank turret tracking
    if (v.type === 'tank' && v.updateTurret) {
      // Find nearest enemy for turret
      let nearest = null;
      let bestDSq = Infinity;
      for (const e of enemies) {
        if (e.isDead || !e.mesh.visible) continue;
        const dSq = distanceSqXZ(v.mesh.position, e.mesh.position);
        if (dSq < bestDSq) { bestDSq = dSq; nearest = e; }
      }
      v.updateTurret(delta, nearest ? nearest.mesh.position : null);
    }

    // Camera shake decay
    if (this.cameraShake.active) {
      this.cameraShake.timer -= delta;
      this.cameraShake.intensity = Math.max(0, this.cameraShake.intensity - delta * 0.5);
      if (this.cameraShake.timer <= 0) {
        this.cameraShake.active = false;
        this.cameraShake.intensity = 0;
      }
    }
  }

  // Handle vehicle damage (returns leftover damage to pass to player)
  handleDamage(amount) {
    if (!this._activeVehicle || this._activeVehicle.maxHP <= 0) return amount;
    return this._activeVehicle.takeDamage(amount);
  }
}
