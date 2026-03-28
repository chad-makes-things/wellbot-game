// city.js — Procedural chunk-based infinite city (Beta)
// Generates buildings as the player moves. Seeded RNG for deterministic layout.

import * as THREE from 'three';
import { createRNG } from './utils.js';

// Colors from art_style_guide.md
const C_CREAM    = 0xF2E8D5;
const C_SLATE    = 0x6D8096;
const C_TAN      = 0xC9A96E;
const C_TEAL     = 0x2A9D8F;
const C_ROOFTOP  = 0xB5B5B8;
const C_WINDOW   = 0xFFE66D;
const C_ASPHALT  = 0x3D3D3D;
const C_SIDEWALK = 0xC8C0B0;
const C_PLAZA    = 0xE8E0D0;
const C_STRIPE   = 0xF5F5F5;

const BUILDING_COLORS = [C_CREAM, C_SLATE, C_TAN];

// Chunk config
const CHUNK_SIZE     = 48;    // world units per chunk
const LOAD_RADIUS    = 2;     // chunks around player (5x5 grid)
const UNLOAD_RADIUS  = 3;     // chunks beyond this get disposed
const LOT_SIZE       = 16;    // subdivision per chunk (3x3 lots)
const LOTS_PER_AXIS  = 3;
const BUILD_CHANCE   = 0.55;  // probability a lot gets a building

// Shared geometries (reused across chunks)
const _windowGeoNS = new THREE.BoxGeometry(0.8, 0.6, 0.1);
const _windowGeoEW = new THREE.BoxGeometry(0.1, 0.6, 0.8);
const _stripeGeoNS = new THREE.BoxGeometry(0.15, 0.02, 5.0);
const _stripeGeoEW = new THREE.BoxGeometry(5.0, 0.02, 0.15);

// Shared materials
function mkMat(color, emissive = 0x000000, emissiveIntensity = 0) {
  return new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity });
}
const _windowMat  = mkMat(C_WINDOW, 0x222200, 0.6);
const _roofMat    = mkMat(C_ROOFTOP);
const _sidewalkMat = mkMat(C_SIDEWALK);
const _stripeMat  = mkMat(C_STRIPE);
const _asphaltMat = mkMat(C_ASPHALT);
const _plazaMat   = mkMat(C_PLAZA);

// ─────────────────────────────────────────────
// Chunk class — one tile of the city
// ─────────────────────────────────────────────
class Chunk {
  constructor(cx, cz, scene) {
    this.cx = cx;
    this.cz = cz;
    this.scene = scene;
    this.meshes = [];     // all THREE.Mesh objects in this chunk
    this.buildings = [];  // building data for collision/grapple

    this._generate();
  }

  _generate() {
    const seed = this.cx * 73856093 ^ this.cz * 19349663;
    const rng = createRNG(seed);
    const originX = this.cx * CHUNK_SIZE;
    const originZ = this.cz * CHUNK_SIZE;

    // Ground plane for this chunk
    this._addGround(originX, originZ);

    // Spawn plaza at chunk (0,0) — no buildings in center lots
    const isSpawnChunk = (this.cx === 0 && this.cz === 0);

    // Pick one lot for a landmark teal building
    const landmarkLot = Math.floor(rng() * (LOTS_PER_AXIS * LOTS_PER_AXIS));
    let lotIndex = 0;
    let hasLandmark = false;

    // Generate lots
    for (let lx = 0; lx < LOTS_PER_AXIS; lx++) {
      for (let lz = 0; lz < LOTS_PER_AXIS; lz++) {
        const lotCenterX = originX + (lx - 1) * LOT_SIZE;
        const lotCenterZ = originZ + (lz - 1) * LOT_SIZE;

        // Spawn plaza: skip center 4 lots (the 2x2 around origin)
        if (isSpawnChunk && Math.abs(lotCenterX) < LOT_SIZE && Math.abs(lotCenterZ) < LOT_SIZE) {
          if (lx === 1 && lz === 1) {
            this._addPlaza(0, 0);
          }
          lotIndex++;
          continue;
        }

        // Roll for building
        if (rng() > BUILD_CHANCE) {
          lotIndex++;
          continue;
        }

        // Building dimensions
        const w = 5 + rng() * 7;
        const d = 5 + rng() * 7;
        // Height distribution: 40% short, 40% medium, 20% tall
        const hRoll = rng();
        let h;
        if (hRoll < 0.4)      h = 6 + rng() * 6;    // 6-12
        else if (hRoll < 0.8) h = 12 + rng() * 8;   // 12-20
        else                  h = 20 + rng() * 8;   // 20-28

        // Jitter position within lot (keep away from lot edges)
        const maxJitter = (LOT_SIZE - Math.max(w, d)) / 2 - 1;
        const jitter = Math.max(0, maxJitter);
        const bx = lotCenterX + (rng() - 0.5) * jitter;
        const bz = lotCenterZ + (rng() - 0.5) * jitter;

        // Color
        let color;
        if (lotIndex === landmarkLot && !hasLandmark) {
          color = C_TEAL;
          hasLandmark = true;
        } else {
          color = BUILDING_COLORS[Math.floor(rng() * BUILDING_COLORS.length)];
        }

        this._addBuilding(bx, bz, w, d, h, color);
        lotIndex++;
      }
    }

    // Street markings along chunk axes
    this._addStreetMarkings(originX, originZ);
  }

  _addGround(ox, oz) {
    const geo = new THREE.PlaneGeometry(CHUNK_SIZE + 2, CHUNK_SIZE + 2);
    const ground = new THREE.Mesh(geo, _asphaltMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(ox, -0.01, oz);
    this.scene.add(ground);
    this.meshes.push(ground);
  }

  _addPlaza(px, pz) {
    const geo = new THREE.PlaneGeometry(18, 18);
    const plaza = new THREE.Mesh(geo, _plazaMat);
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(px, 0.01, pz);
    this.scene.add(plaza);
    this.meshes.push(plaza);
  }

  _addBuilding(x, z, w, d, h, color) {
    // Body
    const bodyGeo = new THREE.BoxGeometry(w, h, d);
    const bodyMat = mkMat(color);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(x, h / 2, z);
    this.scene.add(body);
    this.meshes.push(body);

    // Rooftop cap
    const roofGeo = new THREE.BoxGeometry(w, 0.15, d);
    const roof = new THREE.Mesh(roofGeo, _roofMat);
    roof.position.set(x, h + 0.075, z);
    this.scene.add(roof);
    this.meshes.push(roof);

    // Sidewalks
    const swGeo = new THREE.BoxGeometry(w + 1.5, 0.12, 1.5);
    const swGeoEW = new THREE.BoxGeometry(1.5, 0.12, d);

    const swN = new THREE.Mesh(swGeo, _sidewalkMat);
    swN.position.set(x, 0.06, z - d / 2 - 0.75);
    this.scene.add(swN); this.meshes.push(swN);

    const swS = new THREE.Mesh(swGeo, _sidewalkMat);
    swS.position.set(x, 0.06, z + d / 2 + 0.75);
    this.scene.add(swS); this.meshes.push(swS);

    const swW = new THREE.Mesh(swGeoEW, _sidewalkMat);
    swW.position.set(x - w / 2 - 0.75, 0.06, z);
    this.scene.add(swW); this.meshes.push(swW);

    const swE = new THREE.Mesh(swGeoEW, _sidewalkMat);
    swE.position.set(x + w / 2 + 0.75, 0.06, z);
    this.scene.add(swE); this.meshes.push(swE);

    // Windows on all 4 facades
    this._addWindows(x, z, w, d, h, 'north');
    this._addWindows(x, z, w, d, h, 'south');
    this._addWindows(x, z, w, d, h, 'east');
    this._addWindows(x, z, w, d, h, 'west');

    // Store building data for collision/grapple
    const rooftopPos = new THREE.Vector3(x, h + 0.15, z);
    this.buildings.push({
      x, z, w, d, h,
      halfW: w / 2,
      halfD: d / 2,
      rooftopPos,
    });
  }

  _addWindows(bx, bz, w, d, h, face) {
    if (face === 'north' || face === 'south') {
      const sign = face === 'north' ? -1 : 1;
      const wz = bz + sign * (d / 2 + 0.05);
      for (let row = 1.5; row < h - 1.0; row += 2.0) {
        for (let col = -w / 2 + 1.0; col < w / 2 - 0.4; col += 1.5) {
          const win = new THREE.Mesh(_windowGeoNS, _windowMat);
          win.position.set(bx + col, row, wz);
          if (face === 'north') win.rotation.y = Math.PI;
          this.scene.add(win);
          this.meshes.push(win);
        }
      }
    } else {
      const sign = face === 'east' ? 1 : -1;
      const wx = bx + sign * (w / 2 + 0.05);
      for (let row = 1.5; row < h - 1.0; row += 2.0) {
        for (let col = -d / 2 + 1.0; col < d / 2 - 0.4; col += 1.5) {
          const win = new THREE.Mesh(_windowGeoEW, _windowMat);
          win.position.set(wx, row, bz + col);
          this.scene.add(win);
          this.meshes.push(win);
        }
      }
    }
  }

  _addStreetMarkings(ox, oz) {
    // N-S stripes
    for (let z = oz - CHUNK_SIZE / 2 + 2.5; z < oz + CHUNK_SIZE / 2; z += 10) {
      const s = new THREE.Mesh(_stripeGeoNS, _stripeMat);
      s.position.set(ox, 0.03, z);
      this.scene.add(s); this.meshes.push(s);
    }
    // E-W stripes
    for (let x = ox - CHUNK_SIZE / 2 + 2.5; x < ox + CHUNK_SIZE / 2; x += 10) {
      const s = new THREE.Mesh(_stripeGeoEW, _stripeMat);
      s.position.set(x, 0.03, oz);
      this.scene.add(s); this.meshes.push(s);
    }
  }

  dispose() {
    for (const m of this.meshes) {
      this.scene.remove(m);
      if (m.geometry) m.geometry.dispose();
      // Don't dispose shared materials
    }
    this.meshes.length = 0;
    this.buildings.length = 0;
  }
}

// ─────────────────────────────────────────────
// City manager — loads/unloads chunks around player
// ─────────────────────────────────────────────
export class City {
  constructor(scene) {
    this.scene = scene;
    this._chunks = new Map(); // key "cx,cz" → Chunk
    this._lastPlayerCX = null;
    this._lastPlayerCZ = null;

    this._addFog(scene);
  }

  // Call once per frame with player position
  update(playerX, playerZ) {
    const pcx = Math.floor(playerX / CHUNK_SIZE);
    const pcz = Math.floor(playerZ / CHUNK_SIZE);

    // Skip if player hasn't changed chunk
    if (pcx === this._lastPlayerCX && pcz === this._lastPlayerCZ) return;
    this._lastPlayerCX = pcx;
    this._lastPlayerCZ = pcz;

    // Load chunks within radius
    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = `${cx},${cz}`;
        if (!this._chunks.has(key)) {
          this._chunks.set(key, new Chunk(cx, cz, this.scene));
        }
      }
    }

    // Unload chunks beyond unload radius
    for (const [key, chunk] of this._chunks) {
      const adx = Math.abs(chunk.cx - pcx);
      const adz = Math.abs(chunk.cz - pcz);
      if (adx > UNLOAD_RADIUS || adz > UNLOAD_RADIUS) {
        chunk.dispose();
        this._chunks.delete(key);
      }
    }
  }

  // Returns combined building data from all loaded chunks
  getBuildingData() {
    const all = [];
    for (const chunk of this._chunks.values()) {
      for (const b of chunk.buildings) {
        all.push(b);
      }
    }
    return all;
  }

  _addFog(scene) {
    scene.fog = new THREE.Fog(0xC8E6F5, 60, 160);
  }
}
