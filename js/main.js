// main.js — Scene setup, game loop, state machine
// Weller's Game — Alpha Build

import * as THREE from 'three';
import { Player }       from './player.js';
import { EnemyManager } from './enemies.js';
import { WeaponSystem } from './weapons.js';
import { City }         from './city.js';
import { HUD }          from './hud.js';
import { Shop }         from './shop.js';

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
const VIEW_SIZE    = 22;
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
  Escape: false,
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

function updateInput() {
  for (const k in keyState) {
    justPressed[k] = keyState[k] && !prevKeyState[k];
    prevKeyState[k] = keyState[k];
  }
}

// ─────────────────────────────────────────────
// Camera follow
// ─────────────────────────────────────────────
const CAMERA_OFFSET = new THREE.Vector3(20, 30, 20);
const CAMERA_LERP   = 0.08;
const cameraLookTarget = new THREE.Vector3(0, 0, 0);

function cameraFollow(player) {
  const targetPos = player.mesh.position.clone().add(CAMERA_OFFSET);
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

// Building data for grappling hook
const buildings = city.getBuildingData();

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
  player.update(delta, keyState);

  weaponSystem.update(
    delta,
    player,
    enemyManager.enemies,
    gameState,
    keyState,
    justPressed,
    buildings
  );

  enemyManager.update(delta, player);

  cameraFollow(player);

  // Camera shake
  applyCameraShake(weaponSystem);
  camera.position.x += _shakeOffset.x;
  camera.position.y += _shakeOffset.y;
  camera.position.z += _shakeOffset.z;

  hud.update(weaponSystem, enemyManager.enemies);

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
