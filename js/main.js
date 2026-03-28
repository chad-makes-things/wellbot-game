// main.js — Scene setup, game loop, state machine
// Weller's Game — Alpha Build

import * as THREE from 'three';
import { Player }       from './player.js';
import { EnemyManager } from './enemies.js';
import { WeaponSystem } from './weapons.js';
import { City }         from './city.js';
import { HUD }          from './hud.js';
import { Shop }         from './shop.js';
import { VehicleManager } from './vehicles.js';

// ─────────────────────────────────────────────
// Renderer
// ─────────────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// ─────────────────────────────────────────────
// Scene
// ─────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky Blue

// ─────────────────────────────────────────────
// Camera — OrthographicCamera at isometric angle
// ─────────────────────────────────────────────
const VIEW_SIZE    = 14;
let aspect         = window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(
  -VIEW_SIZE * aspect,
   VIEW_SIZE * aspect,
   VIEW_SIZE,
  -VIEW_SIZE,
  0.1,
  500
);
camera.position.set(20, 30, 20);
camera.lookAt(0, 0, 0);

// ─────────────────────────────────────────────
// Lighting (from art_style_guide.md §3)
// ─────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0xFFF5E6, 0.6);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xFFFDE7, 1.0);
sunLight.position.set(50, 80, 40);
scene.add(sunLight);

const fillLight = new THREE.DirectionalLight(0xC8E6F5, 0.25);
fillLight.position.set(-30, 40, -20);
scene.add(fillLight);

// ─────────────────────────────────────────────
// Resize handler
// ─────────────────────────────────────────────
window.addEventListener('resize', () => {
  aspect = window.innerWidth / window.innerHeight;
  camera.left   = -VIEW_SIZE * aspect;
  camera.right  =  VIEW_SIZE * aspect;
  camera.top    =  VIEW_SIZE;
  camera.bottom = -VIEW_SIZE;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─────────────────────────────────────────────
// Input system
// ─────────────────────────────────────────────
const keyState = {
  ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false,
  Space: false, KeyZ: false, KeyX: false, KeyC: false, Enter: false,
  Escape: false, ShiftLeft: false, ShiftRight: false,
  MetaLeft: false, MetaRight: false,
};
const prevKeyState = {};
const justPressed  = {};

// Seed prev state
for (const k in keyState) prevKeyState[k] = false;

window.addEventListener('keydown', e => {
  if (e.code in keyState) {
    e.preventDefault();
    keyState[e.code] = true;
  }
});
window.addEventListener('keyup', e => {
  if (e.code in keyState) keyState[e.code] = false;
});
// Mac: Command key sometimes misses keyup when browser loses focus
window.addEventListener('blur', () => {
  for (const k in keyState) keyState[k] = false;
});

function updateInput() {
  for (const k in keyState) {
    justPressed[k] = keyState[k] && !prevKeyState[k];
    prevKeyState[k] = keyState[k];
  }
}

// ─────────────────────────────────────────────
// Camera follow + snap-behind (Command key)
// ─────────────────────────────────────────────
const CAMERA_DIST   = 28.28;  // horizontal distance from player (sqrt(20^2 + 20^2))
const CAMERA_HEIGHT = 30;
const CAMERA_LERP   = 0.08;
const CAMERA_SNAP_LERP = 0.10; // how fast the snap-behind rotation lerps
const cameraLookTarget = new THREE.Vector3(0, 0, 0);

// Default isometric angle: offset (20, 30, 20) → azimuth = atan2(20, 20) = PI/4
let cameraAzimuth       = Math.PI / 4;  // current angle
let cameraAzimuthTarget = Math.PI / 4;  // target angle (lerped toward)
const DEFAULT_AZIMUTH   = Math.PI / 4;

function cameraFollow(player, delta) {
  // If Command is pressed, snap azimuth target to behind the player's facing
  if (justPressed['MetaLeft'] || justPressed['MetaRight']) {
    // Player faces rotation.y — camera should be behind, so add PI
    cameraAzimuthTarget = player.mesh.rotation.y + Math.PI;
  }

  // Smoothly lerp azimuth toward target
  // Use angle wrapping to avoid spinning the long way around
  let diff = cameraAzimuthTarget - cameraAzimuth;
  // Normalize to [-PI, PI]
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  cameraAzimuth += diff * CAMERA_SNAP_LERP;

  // Compute offset from azimuth
  const offsetX = Math.sin(cameraAzimuth) * CAMERA_DIST;
  const offsetZ = Math.cos(cameraAzimuth) * CAMERA_DIST;
  const offset = new THREE.Vector3(offsetX, CAMERA_HEIGHT, offsetZ);

  const targetPos = player.mesh.position.clone().add(offset);
  camera.position.lerp(targetPos, CAMERA_LERP);
  cameraLookTarget.lerp(player.mesh.position, CAMERA_LERP);
  camera.lookAt(cameraLookTarget);
}

// ─────────────────────────────────────────────
// End screen
// ─────────────────────────────────────────────
function getEndHeadline(defeated) {
  if (defeated < 5)  return 'Nice first run!';
  if (defeated < 16) return "Now we're talking!";
  if (defeated < 31) return 'Whoa. That was awesome.';
  if (defeated < 51) return 'EPIC RUN!';
  return "LEGENDARY. You're unstoppable.";
}

function showEndScreen(player, enemyManager) {
  const screen = document.getElementById('end-screen');
  screen.classList.remove('hidden');

  const defeated = enemyManager.defeatedCount;
  const coins    = player.totalCoinsEarned;

  document.getElementById('end-headline').textContent     = getEndHeadline(defeated);
  document.getElementById('end-subheadline').textContent  = `You defeated ${defeated} ${defeated === 1 ? 'enemy' : 'enemies'}!`;
  document.getElementById('end-stat-defeated').textContent = defeated;
  document.getElementById('end-stat-coins').textContent    = coins;
  document.getElementById('end-stat-weapons').textContent  = player.unlockedWeapons.length;
}

document.getElementById('play-again').addEventListener('click', () => {
  location.reload();
});

// Also allow Space on end screen to restart
window.addEventListener('keydown', e => {
  if (e.code === 'Space') {
    const screen = document.getElementById('end-screen');
    if (!screen.classList.contains('hidden')) {
      location.reload();
    }
  }
});

// ─────────────────────────────────────────────
// Game state
// ─────────────────────────────────────────────
const gameState = {
  isRunning:    true,
  gameOverShown: false,
  isShopOpen:   false,
};

// ─────────────────────────────────────────────
// System initialization
// ─────────────────────────────────────────────
const city         = new City(scene);
const player       = new Player(scene);
const enemyManager = new EnemyManager(scene);
enemyManager.spawnInitialWave(3);
const weaponSystem = new WeaponSystem(scene);
const hud          = new HUD(player, enemyManager);
const shop         = new Shop(player);
const vehicleManager = new VehicleManager(scene);
shop.vehicleManager = vehicleManager; // so shop can spawn vehicles

// Load initial chunks around spawn and get building data
city.update(0, 0);
let buildings = city.getBuildingData();

// ─────────────────────────────────────────────
// Building collision helpers
// ─────────────────────────────────────────────
const PLAYER_XZ_RADIUS = 0.55; // half-width used for wall collision
const PLAYER_HALF_H    = 1.1;  // feet-to-center height

// Push player out of building footprints (XZ walls).
// Skipped during grapple and when player is on or above the rooftop surface.
function resolveBuildingWalls(player, buildings) {
  if (player.isGrappling) return;
  const p = player.mesh.position;
  for (const b of buildings) {
    // Skip wall collision if player is standing on or above this building's roof.
    // Without this, a player at building-center XZ (after grappling) gets
    // pushed out every frame because they're "inside" the footprint.
    if (p.y >= b.h + PLAYER_HALF_H - 0.15) continue;

    const minX = b.x - b.halfW - PLAYER_XZ_RADIUS;
    const maxX = b.x + b.halfW + PLAYER_XZ_RADIUS;
    const minZ = b.z - b.halfD - PLAYER_XZ_RADIUS;
    const maxZ = b.z + b.halfD + PLAYER_XZ_RADIUS;

    if (p.x <= minX || p.x >= maxX || p.z <= minZ || p.z >= maxZ) continue;

    // Overlapping — push out along shortest axis
    const dLeft  = p.x - minX;
    const dRight = maxX - p.x;
    const dFront = p.z - minZ;
    const dBack  = maxZ - p.z;
    const minXOverlap = Math.min(dLeft, dRight);
    const minZOverlap = Math.min(dFront, dBack);

    if (minXOverlap < minZOverlap) {
      p.x += dLeft < dRight ? -dLeft : dRight;
    } else {
      p.z += dFront < dBack ? -dFront : dBack;
    }
  }
}

// Clamp player onto rooftop surface when standing on a building.
// Runs every frame — keeps Wellbot standing on any roof he lands on.
function resolveRooftops(player, buildings) {
  const p = player.mesh.position;
  for (const b of buildings) {
    const roofStandY = b.h + PLAYER_HALF_H; // Y where player's feet meet the roof

    // Only check buildings whose roof is below the player's current height
    // and the player isn't way above (just fell from a much taller building).
    if (p.y > roofStandY + 4) continue;  // player is too high above this roof
    if (p.y < roofStandY - 0.5) continue; // player has already fallen through

    // Check XZ footprint — small inset so edge-walking naturally falls off
    const inset = 0.3;
    if (
      p.x > b.x - b.halfW + inset && p.x < b.x + b.halfW - inset &&
      p.z > b.z - b.halfD + inset && p.z < b.z + b.halfD - inset
    ) {
      if (p.y <= roofStandY) {
        p.y = roofStandY;
        player.velocity.y = 0;
        player.isGrounded = true;
      }
    }
  }
}

// ─────────────────────────────────────────────
// Clock & FPS tracking
// ─────────────────────────────────────────────
const clock   = new THREE.Clock();
const MAX_DELTA = 0.05;

let _fpsSamples = [];
let _fpsDisplay = 0;
let _fpsTimer   = 0;

// ─────────────────────────────────────────────
// Camera shake helper
// ─────────────────────────────────────────────
const _shakeOffset = new THREE.Vector3();

function applyCameraShake(ws) {
  const shake = ws.cameraShake;
  if (!shake.active) {
    _shakeOffset.set(0, 0, 0);
    return;
  }
  const i = shake.intensity;
  _shakeOffset.set(
    (Math.random() - 0.5) * i * 0.6,
    (Math.random() - 0.5) * i * 0.3,
    (Math.random() - 0.5) * i * 0.6
  );
}

// ─────────────────────────────────────────────
// Main game loop
// ─────────────────────────────────────────────
function gameLoop() {
  requestAnimationFrame(gameLoop);

  const delta = Math.min(clock.getDelta(), MAX_DELTA);

  // Input — always update
  updateInput();

  // Shop toggle (Enter key)
  if (justPressed['Enter']) {
    if (!gameState.gameOverShown) {
      if (gameState.isShopOpen) {
        shop.close();
        gameState.isShopOpen = false;
      } else {
        shop.open();
        gameState.isShopOpen = true;
      }
    }
  }

  // Sync shop state — catches auto-close from purchase timeout
  gameState.isShopOpen = shop.isOpen;

  // When shop is open — only update shop, not gameplay
  if (gameState.isShopOpen) {
    shop.handleInput(justPressed);
    shop.update(delta);
    hud.update(weaponSystem, enemyManager.enemies);
    renderer.render(scene, camera);
    return;
  }

  // Game over — nothing updates
  if (!gameState.isRunning) {
    renderer.render(scene, camera);
    return;
  }

  // ─── Game systems update ───
  // Update procedural city chunks around player
  city.update(player.mesh.position.x, player.mesh.position.z);
  buildings = city.getBuildingData();

  // ─── Vehicle mount/dismount (Space near vehicle) ───
  const inVehicle = player.inVehicle;
  if (inVehicle) {
    // In vehicle: Space dismounts (bike/car) or fires cannon (tank, handled in weapons)
    if (justPressed['Space'] && !inVehicle.hasWeapon) {
      vehicleManager.dismountVehicle(player);
    } else if (justPressed['Space'] && inVehicle.hasWeapon) {
      // Tank cannon — let weapon system handle it below
    }
    // Vehicle movement
    vehicleManager.update(delta, keyState, cameraAzimuth, buildings, enemyManager.enemies, player);
  } else {
    // Not in vehicle: normal player update
    player.update(delta, keyState, cameraAzimuth);

    // Weapon cycle — C key
    if (justPressed['KeyC'] && !gameState.isShopOpen && !player.isDead) {
      player.currentWeaponIndex =
        (player.currentWeaponIndex + 1) % player.unlockedWeapons.length;
      const newName = weaponSystem.currentWeaponName(player);
      hud.flashWeaponSwitch(newName);
    }

    // Jump — Shift key, only when grounded
    if ((justPressed['ShiftLeft'] || justPressed['ShiftRight']) && player.isGrounded && !player.isDead) {
      player.velocity.y = 12;
      player.isGrounded = false;
    }

    resolveBuildingWalls(player, buildings);
    resolveRooftops(player, buildings);

    // Check for nearby vehicle to mount (Space when no enemy in close range)
    if (justPressed['Space'] && !player.isDead) {
      const nearby = vehicleManager.getNearbyVehicle(player.mesh.position);
      if (nearby) {
        // Only mount if no enemies within 6 units (prevents accidental mount during combat)
        let enemyClose = false;
        for (const e of enemyManager.enemies) {
          if (e.isDead || !e.mesh.visible) continue;
          const dSq = (e.mesh.position.x - player.mesh.position.x) ** 2 +
                      (e.mesh.position.z - player.mesh.position.z) ** 2;
          if (dSq < 36) { enemyClose = true; break; }
        }
        if (!enemyClose) {
          vehicleManager.mountVehicle(nearby, player);
        }
      }
    }
  }

  // Check if vehicle was destroyed — eject player
  if (inVehicle && inVehicle.isDestroyed) {
    vehicleManager.dismountVehicle(player);
  }

  // Weapons: skip personal weapons while in vehicle (except tank cannon)
  if (!inVehicle) {
    weaponSystem.update(
      delta,
      player,
      enemyManager.enemies,
      gameState,
      keyState,
      justPressed,
      buildings
    );
  } else if (inVehicle && inVehicle.hasWeapon) {
    // Tank cannon — fire using weapon system's existing auto-aim
    weaponSystem.update(
      delta,
      player,
      enemyManager.enemies,
      gameState,
      keyState,
      justPressed,
      buildings
    );
  }

  enemyManager.updateDifficulty(player.totalCoinsEarned);
  enemyManager.update(delta, player, buildings);

  cameraFollow(player, delta);

  // Camera shake (combine weapon + vehicle shake)
  applyCameraShake(weaponSystem);
  if (vehicleManager.cameraShake.active) {
    const vi = vehicleManager.cameraShake.intensity;
    _shakeOffset.x += (Math.random() - 0.5) * vi * 0.6;
    _shakeOffset.y += (Math.random() - 0.5) * vi * 0.3;
    _shakeOffset.z += (Math.random() - 0.5) * vi * 0.6;
  }
  camera.position.x += _shakeOffset.x;
  camera.position.y += _shakeOffset.y;
  camera.position.z += _shakeOffset.z;

  hud.update(weaponSystem, enemyManager.enemies);

  // Sword swing visual feedback
  if (weaponSystem.swordSwungThisFrame) hud.flashSwordSwing();

  // ─── Game over check ───
  if (player.isDead && !gameState.gameOverShown) {
    showEndScreen(player, enemyManager);
    gameState.isRunning    = false;
    gameState.gameOverShown = true;
  }

  // ─── FPS dev counter ───
  if (delta > 0) {
    _fpsSamples.push(1 / delta);
    if (_fpsSamples.length > 60) _fpsSamples.shift();
    _fpsTimer += delta;
    if (_fpsTimer >= 2.0) {
      _fpsTimer = 0;
      _fpsDisplay = Math.round(_fpsSamples.reduce((a, b) => a + b, 0) / _fpsSamples.length);
      // Dev only: uncomment to log FPS
      // console.log(`FPS: ${_fpsDisplay}`);
    }
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(gameLoop);
