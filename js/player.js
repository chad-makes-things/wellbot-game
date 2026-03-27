// player.js — Wellbot character, movement, health
// Player robot named "Wellbot" — designed by Weller

import * as THREE from 'three';
import { clamp } from './utils.js';

// Movement constants
const PLAYER_SPEED = 8;
const GRAVITY = 20;
const PLAYER_HALF_HEIGHT = 1.1; // foot-to-center approx

// Color palette from art_style_guide.md
const C_BODY_GRAY    = 0x8C9BAB; // Robot Body Gray — torso, arms
const C_DARK_METAL   = 0x5C6C7C; // Robot Dark Metal — head, legs
const C_EYE_WHITE    = 0xF0F4FF; // Robot Eye White — sclera
const C_EYE_PUPIL    = 0x1A1A2E; // Robot Eye Pupil
const C_ANTENNA_YLW  = 0xFFD600; // Antenna Ball yellow

function mkMat(color, emissive = 0x000000, emissiveIntensity = 0) {
  return new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity });
}

export class Player {
  constructor(scene) {
    this.scene = scene;

    // Stats
    this.health = 100;
    this.maxHealth = 100;
    this.coins = 0;
    this.totalCoinsEarned = 0;
    this.currentWeaponIndex = 0;
    this.unlockedWeapons = ['pistol'];
    this.isGrounded = true;
    this.isDead = false;
    this.velocity = new THREE.Vector3();

    // Walk animation state
    this.stepCycle = 0;
    this.isMoving = false;

    // Grappling state — disables wall collision during pull
    this.isGrappling = false;

    // Flash timer for damage feedback
    this._flashTimer = 0;
    this._originalColors = [];

    // Build the robot mesh group
    this.mesh = this._buildRobot();
    this.mesh.position.set(0, 0, 0);
    scene.add(this.mesh);
  }

  _buildRobot() {
    const group = new THREE.Group();

    // === LEGS ===
    const legGeo = new THREE.BoxGeometry(0.4, 0.7, 0.4);
    const legMat = mkMat(C_DARK_METAL);
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.25, 0.35, 0);
    group.add(leftLeg);
    this._leftLeg = leftLeg;

    const rightLeg = new THREE.Mesh(legGeo, legMat.clone());
    rightLeg.position.set(0.25, 0.35, 0);
    group.add(rightLeg);
    this._rightLeg = rightLeg;

    // === TORSO ===
    const torsoGeo = new THREE.BoxGeometry(0.9, 0.8, 0.5);
    const torsoMat = mkMat(C_BODY_GRAY);
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.set(0, 1.1, 0);
    group.add(torso);
    this._torso = torso;
    this._torsoBaseY = 1.1;

    // === ARMS ===
    const armGeo = new THREE.BoxGeometry(0.25, 0.6, 0.25);
    const armMat = mkMat(C_BODY_GRAY);
    const leftArm = new THREE.Mesh(armGeo, armMat);
    leftArm.position.set(-0.625, 1.1, 0);
    group.add(leftArm);
    this._leftArm = leftArm;

    const rightArm = new THREE.Mesh(armGeo, armMat.clone());
    rightArm.position.set(0.625, 1.1, 0);
    group.add(rightArm);
    this._rightArm = rightArm;

    // === HEAD ===
    const headGeo = new THREE.BoxGeometry(0.7, 0.65, 0.6);
    const headMat = mkMat(C_DARK_METAL);
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(0, 1.825, 0);
    group.add(head);
    this._head = head;

    // === EIGHT EYES ===
    // 2-column × 4-row grid on front face (Z+ face) of head
    // Sclera (white part): BoxGeometry(0.1, 0.09, 0.05)
    const scleraGeo = new THREE.BoxGeometry(0.1, 0.09, 0.05);
    const scleraMat = mkMat(C_EYE_WHITE);
    // Pupil (dark): BoxGeometry(0.06, 0.055, 0.02)
    const pupilGeo = new THREE.BoxGeometry(0.06, 0.055, 0.02);
    const pupilMat = mkMat(C_EYE_PUPIL);

    // Head front face Z = head.position.z + headDepth/2 = 0 + 0.3 = 0.3
    const headFrontZ = 0.3 + 0.025; // slightly proud of face
    const pupilZ     = 0.3 + 0.045;

    const eyePositions = [
      [-0.18,  0.20],  // e1 top-left
      [ 0.18,  0.20],  // e2 top-right
      [-0.18,  0.07],  // e3 upper-mid-left
      [ 0.18,  0.07],  // e4 upper-mid-right
      [-0.18, -0.06],  // e5 lower-mid-left
      [ 0.18, -0.06],  // e6 lower-mid-right
      [-0.18, -0.19],  // e7 bottom-left
      [ 0.18, -0.19],  // e8 bottom-right
    ];

    for (const [ex, ey] of eyePositions) {
      // Sclera — positioned relative to head group
      const sclera = new THREE.Mesh(scleraGeo, scleraMat);
      sclera.position.set(ex, 1.825 + ey, headFrontZ);
      group.add(sclera);

      // Pupil
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(ex, 1.825 + ey, pupilZ);
      group.add(pupil);
    }

    // === ANTENNA ===
    // Antenna Base
    const antBaseGeo = new THREE.BoxGeometry(0.1, 0.15, 0.1);
    const antBaseMat = mkMat(C_BODY_GRAY);
    const antBase = new THREE.Mesh(antBaseGeo, antBaseMat);
    antBase.position.set(0, 1.825 + 0.325 + 0.075, 0); // top of head + half base height
    group.add(antBase);

    // Antenna Shaft
    const antShaftGeo = new THREE.BoxGeometry(0.05, 0.25, 0.05);
    const antShaftMat = mkMat(C_BODY_GRAY);
    const antShaft = new THREE.Mesh(antShaftGeo, antShaftMat);
    antShaft.position.set(0, 1.825 + 0.325 + 0.15 + 0.125, 0);
    group.add(antShaft);

    // Antenna Ball (SphereGeometry per art spec)
    const antBallGeo = new THREE.SphereGeometry(0.06, 6, 6);
    const antBallMat = mkMat(C_ANTENNA_YLW, 0xB89000, 0.3);
    const antBall = new THREE.Mesh(antBallGeo, antBallMat);
    antBall.position.set(0, 1.825 + 0.325 + 0.15 + 0.25 + 0.06, 0);
    group.add(antBall);

    // Store original colors for flash-restore
    group.traverse(obj => {
      if (obj.isMesh) {
        this._originalColors.push({ mesh: obj, color: obj.material.color.getHex() });
      }
    });

    return group;
  }

  update(delta, keyState) {
    if (this.isDead) return;

    // --- Flash damage feedback ---
    if (this._flashTimer > 0) {
      this._flashTimer -= delta;
      if (this._flashTimer <= 0) {
        // Restore colors
        for (const { mesh, color } of this._originalColors) {
          mesh.material.color.setHex(color);
        }
      }
    }

    // --- Movement ---
    let dx = 0, dz = 0;
    if (keyState['ArrowUp'])    { dx -= 1; dz -= 1; }
    if (keyState['ArrowDown'])  { dx += 1; dz += 1; }
    if (keyState['ArrowLeft'])  { dx -= 1; dz += 1; }
    if (keyState['ArrowRight']) { dx += 1; dz -= 1; }

    const moveDir = new THREE.Vector3(dx, 0, dz);
    this.isMoving = moveDir.lengthSq() > 0;

    if (this.isMoving) {
      moveDir.normalize();
      this.mesh.position.x += moveDir.x * PLAYER_SPEED * delta;
      this.mesh.position.z += moveDir.z * PLAYER_SPEED * delta;
      // Rotate to face movement direction
      this.mesh.rotation.y = Math.atan2(moveDir.x, moveDir.z);

      // Walk cycle — advance step counter
      this.stepCycle += PLAYER_SPEED * 4.0 * delta;

      // Torso bob
      this._torso.position.y = this._torsoBaseY + Math.abs(Math.sin(this.stepCycle)) * 0.08;

      // Leg swing
      this._leftLeg.rotation.x  =  Math.sin(this.stepCycle) * 0.45;
      this._rightLeg.rotation.x = -Math.sin(this.stepCycle) * 0.45;

      // Arm swing (opposite to legs)
      this._leftArm.rotation.x  = -Math.sin(this.stepCycle) * 0.4;
      this._rightArm.rotation.x =  Math.sin(this.stepCycle) * 0.4;
    } else {
      // Settle torso and limbs back to neutral
      this._torso.position.y    = THREE.MathUtils.lerp(this._torso.position.y, this._torsoBaseY, 0.2);
      this._leftLeg.rotation.x  = THREE.MathUtils.lerp(this._leftLeg.rotation.x,  0, 0.2);
      this._rightLeg.rotation.x = THREE.MathUtils.lerp(this._rightLeg.rotation.x, 0, 0.2);
      this._leftArm.rotation.x  = THREE.MathUtils.lerp(this._leftArm.rotation.x,  0, 0.2);
      this._rightArm.rotation.x = THREE.MathUtils.lerp(this._rightArm.rotation.x, 0, 0.2);
    }

    // --- Gravity ---
    this.velocity.y -= GRAVITY * delta;
    this.mesh.position.y += this.velocity.y * delta;

    // Ground clamp
    if (this.mesh.position.y < PLAYER_HALF_HEIGHT) {
      this.mesh.position.y = PLAYER_HALF_HEIGHT;
      this.velocity.y = 0;
      this.isGrounded = true;
    }

    // World boundary clamp — keep Wellbot on the city ground
    this.mesh.position.x = Math.max(-48, Math.min(48, this.mesh.position.x));
    this.mesh.position.z = Math.max(-48, Math.min(48, this.mesh.position.z));
  }

  takeDamage(amount) {
    if (this.isDead) return;
    this.health = Math.max(0, this.health - amount);

    // Flash red
    this._flashTimer = 0.15;
    this.mesh.traverse(obj => {
      if (obj.isMesh) obj.material.color.setHex(0xff2222);
    });

    if (this.health === 0) {
      this.isDead = true;
    }
  }

  // Called by grappling hook to lift Wellbot to a rooftop
  grappleTo(targetPos) {
    this.mesh.position.copy(targetPos);
    this.velocity.y = 0;
    this.isGrounded = true;
  }
}
