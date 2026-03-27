// city.js — Building generation (hardcoded layout for Alpha)
// Beta will have procedural city generation.

import * as THREE from 'three';

// Colors from art_style_guide.md
const C_CREAM   = 0xF2E8D5; // Building Cream
const C_SLATE   = 0x6D8096; // Building Slate
const C_TAN     = 0xC9A96E; // Building Warm Tan
const C_TEAL    = 0x2A9D8F; // Building Teal (landmark — 1 per block)
const C_ROOFTOP = 0xB5B5B8; // Rooftop Concrete
const C_WINDOW  = 0xFFE66D; // Window Yellow
const C_ASPHALT = 0x3D3D3D; // Street Asphalt
const C_SIDEWALK = 0xC8C0B0;
const C_PLAZA   = 0xE8E0D0; // Plaza Pale Stone
const C_STRIPE  = 0xF5F5F5; // Lane marking white

function mkMat(color, emissive = 0x000000, emissiveIntensity = 0) {
  return new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity });
}

// ─────────────────────────────────────────────
// Building spec: { x, z, w, d, h, color }
// All positions are world-space centers.
// ─────────────────────────────────────────────
const BUILDING_SPECS = [
  // --- North block ---
  { x: -20, z: -20, w: 8,  d: 8,  h: 20, color: C_CREAM },
  { x: -8,  z: -22, w: 6,  d: 6,  h: 12, color: C_SLATE },
  { x:  4,  z: -20, w: 7,  d: 7,  h: 16, color: C_TEAL  },  // landmark
  { x:  16, z: -20, w: 9,  d: 7,  h: 24, color: C_CREAM },
  { x:  24, z: -18, w: 5,  d: 6,  h: 8,  color: C_TAN   },

  // --- East block ---
  { x:  26, z: -4,  w: 6,  d: 8,  h: 18, color: C_SLATE },
  { x:  28, z:  8,  w: 7,  d: 6,  h: 12, color: C_CREAM },
  { x:  26, z:  20, w: 6,  d: 7,  h: 16, color: C_TAN   },

  // --- South block ---
  { x:  14, z:  24, w: 8,  d: 6,  h: 10, color: C_SLATE },
  { x:   2, z:  26, w: 7,  d: 7,  h: 20, color: C_CREAM },
  { x: -10, z:  24, w: 6,  d: 6,  h: 14, color: C_SLATE },
  { x: -22, z:  22, w: 8,  d: 8,  h: 12, color: C_TAN   },

  // --- West block ---
  { x: -28, z:  8,  w: 6,  d: 7,  h: 16, color: C_CREAM },
  { x: -26, z: -6,  w: 7,  d: 6,  h: 10, color: C_SLATE },

  // --- Inner ring (creates streets around central plaza) ---
  { x: -14, z: -10, w: 5,  d: 5,  h: 8,  color: C_TAN   },
  { x:  12, z: -10, w: 5,  d: 5,  h: 8,  color: C_SLATE },
  { x:  12, z:  10, w: 5,  d: 5,  h: 8,  color: C_CREAM },
  { x: -14, z:  10, w: 5,  d: 5,  h: 8,  color: C_SLATE },

  // --- Accent corner towers ---
  { x: -32, z: -28, w: 6,  d: 6,  h: 28, color: C_CREAM },
  { x:  32, z: -28, w: 6,  d: 6,  h: 24, color: C_SLATE },
  { x:  32, z:  28, w: 6,  d: 6,  h: 20, color: C_CREAM },
  { x: -32, z:  28, w: 6,  d: 6,  h: 28, color: C_TAN   },
];

function addWindowsToFacade(scene, buildX, buildZ, buildY, wallFaceDir, buildW, buildD, buildH) {
  // wallFaceDir: 'north','south','east','west'
  const windowGeo = new THREE.BoxGeometry(0.8, 0.6, 0.1);
  const windowMat = mkMat(C_WINDOW, 0x222200, 0.6);

  let spanW, spawnZ, facingAxis;
  if (wallFaceDir === 'north' || wallFaceDir === 'south') {
    spanW = buildW;
    const sign = wallFaceDir === 'north' ? -1 : 1;
    spawnZ = buildZ + sign * (buildD / 2 + 0.05);
    for (let row = 1.5; row < buildH - 1.0; row += 2.0) {
      for (let col = -buildW / 2 + 1.0; col < buildW / 2 - 0.4; col += 1.5) {
        const w = new THREE.Mesh(windowGeo, windowMat);
        w.position.set(buildX + col, buildY + row, spawnZ);
        if (wallFaceDir === 'north') w.rotation.y = Math.PI;
        scene.add(w);
      }
    }
  } else {
    // east / west
    const windowGeoEW = new THREE.BoxGeometry(0.1, 0.6, 0.8);
    const sign = wallFaceDir === 'east' ? 1 : -1;
    const spawnX = buildX + sign * (buildW / 2 + 0.05);
    for (let row = 1.5; row < buildH - 1.0; row += 2.0) {
      for (let col = -buildD / 2 + 1.0; col < buildD / 2 - 0.4; col += 1.5) {
        const w = new THREE.Mesh(windowGeoEW, windowMat);
        w.position.set(spawnX, buildY + row, buildZ + col);
        scene.add(w);
      }
    }
  }
}

export class City {
  constructor(scene) {
    this.scene     = scene;
    this.buildings = []; // { mesh, rooftopPos, w, d, h }

    this._buildGround();
    this._buildPlaza();
    this._buildStreetMarkings();
    this._buildBuildings();
    this._addFog(scene);
  }

  _buildGround() {
    // Large asphalt ground plane
    const geo = new THREE.PlaneGeometry(200, 200);
    const mat = mkMat(C_ASPHALT);
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    this.scene.add(ground);
  }

  _buildPlaza() {
    // Central open combat plaza — 20x20 pale stone
    const plazaGeo = new THREE.PlaneGeometry(18, 18);
    const plazaMat = mkMat(C_PLAZA);
    const plaza = new THREE.Mesh(plazaGeo, plazaMat);
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(0, 0.01, 0); // slightly above asphalt
    this.scene.add(plaza);
  }

  _buildStreetMarkings() {
    // Lane markings along main streets
    const stripeGeo = new THREE.BoxGeometry(0.15, 0.02, 5.0);
    const stripeMat = mkMat(C_STRIPE);

    const stripePositions = [
      // North-south street (x ≈ -3 and +3)
      { x: -3,  z: -15 }, { x: -3,  z: -5 }, { x: -3,  z:  5 }, { x: -3,  z: 15 },
      { x:  3,  z: -15 }, { x:  3,  z: -5 }, { x:  3,  z:  5 }, { x:  3,  z: 15 },
      // East-west street (z ≈ -3 and +3)
    ];
    for (const sp of stripePositions) {
      const stripe = new THREE.Mesh(stripeGeo, stripeMat);
      stripe.position.set(sp.x, 0.03, sp.z);
      this.scene.add(stripe);
    }

    // East-west stripes (rotated)
    const stripeGeoEW = new THREE.BoxGeometry(5.0, 0.02, 0.15);
    for (const ez of [-15, -5, 5, 15]) {
      for (const ex of [-3, 3]) {
        const stripe = new THREE.Mesh(stripeGeoEW, stripeMat);
        stripe.position.set(ex, 0.03, ez);
        this.scene.add(stripe);
      }
    }
  }

  _buildBuildings() {
    for (const spec of BUILDING_SPECS) {
      this._addBuilding(spec);
    }
  }

  _addBuilding({ x, z, w, d, h, color }) {
    // Main body
    const bodyGeo = new THREE.BoxGeometry(w, h, d);
    const bodyMat = mkMat(color);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(x, h / 2, z);
    this.scene.add(body);

    // Rooftop cap
    const roofGeo = new THREE.BoxGeometry(w, 0.15, d);
    const roofMat = mkMat(C_ROOFTOP);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(x, h + 0.075, z);
    this.scene.add(roof);

    // Sidewalk strip around base
    const swGeo = new THREE.BoxGeometry(w + 1.5, 0.12, 1.5);
    const swMat = mkMat(C_SIDEWALK);
    // North sidewalk
    const swN = new THREE.Mesh(swGeo, swMat);
    swN.position.set(x, 0.06, z - d / 2 - 0.75);
    this.scene.add(swN);
    // South sidewalk
    const swS = new THREE.Mesh(swGeo, swMat.clone());
    swS.position.set(x, 0.06, z + d / 2 + 0.75);
    this.scene.add(swS);

    // East-west sidewalks
    const swGeoEW = new THREE.BoxGeometry(1.5, 0.12, d);
    const swW = new THREE.Mesh(swGeoEW, swMat.clone());
    swW.position.set(x - w / 2 - 0.75, 0.06, z);
    this.scene.add(swW);
    const swE = new THREE.Mesh(swGeoEW, swMat.clone());
    swE.position.set(x + w / 2 + 0.75, 0.06, z);
    this.scene.add(swE);

    // Windows on all four facades
    addWindowsToFacade(this.scene, x, z, 0, 'north', w, d, h);
    addWindowsToFacade(this.scene, x, z, 0, 'south', w, d, h);
    addWindowsToFacade(this.scene, x, z, 0, 'east', w, d, h);
    addWindowsToFacade(this.scene, x, z, 0, 'west', w, d, h);

    // Rooftop position for grappling hook
    const rooftopPos = new THREE.Vector3(x, h + 0.15, z);

    // Store building data
    this.buildings.push({
      mesh: body,
      rooftopPos,
      x, z, w, d, h,
      halfW: w / 2,
      halfD: d / 2,
    });
  }

  _addFog(scene) {
    scene.fog = new THREE.Fog(0xC8E6F5, 80, 200);
  }

  // Returns array of building data for grapple hook target selection
  getBuildingData() {
    return this.buildings;
  }
}
