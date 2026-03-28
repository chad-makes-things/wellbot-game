// hud.js — HUD elements: health bar, coin counter, score, weapon indicator, minimap

export class HUD {
  constructor(player, enemyManager) {
    this.player       = player;
    this.enemyManager = enemyManager;

    // DOM references
    this.healthBar    = document.getElementById('hud-health-bar');
    this.coinDisplay  = document.getElementById('hud-coins');
    this.scoreDisplay = document.getElementById('hud-defeated');
    this.weaponName   = document.getElementById('hud-weapon-name');
    this.weaponIcon   = document.getElementById('hud-weapon-icon');
    this.minimapCanvas = document.getElementById('minimap-canvas');
    this.minimapCtx   = this.minimapCanvas
      ? this.minimapCanvas.getContext('2d')
      : null;

    this._coinPopTimer = 0;
    this._lastCoins    = 0;
  }

  update(weaponSystem, enemies) {
    const player  = this.player;
    const pct     = player.health / player.maxHealth;

    // ─── Health bar ───
    this.healthBar.style.width = (pct * 100) + '%';
    if (pct > 0.6) {
      this.healthBar.style.background = '#2ECC40';
      this.healthBar.classList.remove('pulse');
    } else if (pct > 0.29) {
      this.healthBar.style.background = '#FF851B';
      this.healthBar.classList.remove('pulse');
    } else {
      this.healthBar.style.background = '#FF4136';
      this.healthBar.classList.add('pulse');
    }

    // ─── Coin counter ───
    const coins = player.coins;
    if (coins !== this._lastCoins) {
      this._coinPopTimer = 0.2;
      this._lastCoins = coins;
    }
    this.coinDisplay.textContent = coins;
    if (this._coinPopTimer > 0) {
      this._coinPopTimer -= 0.016;
      this.coinDisplay.style.transform = 'scale(1.25)';
    } else {
      this._coinPopTimer = 0;
      this.coinDisplay.style.transform = 'scale(1)';
    }

    // ─── Score ───
    const defeated = this.enemyManager.defeatedCount;
    this.scoreDisplay.textContent = defeated > 999 ? '999+' : defeated;

    // ─── Weapon indicator ───
    const wName = weaponSystem ? weaponSystem.currentWeaponName(player) : 'PISTOL';
    if (this.weaponName) this.weaponName.textContent = wName;

    // ─── Minimap ───
    this._drawMinimap(enemies);
  }

  _drawMinimap(enemies) {
    if (!this.minimapCtx) return;
    const ctx    = this.minimapCtx;
    const size   = this.minimapCanvas.width; // 150
    const scale  = size / 120;  // world-unit to pixel ratio (show 60-unit radius)
    const cx     = size / 2;
    const cy     = size / 2;
    const px     = this.player.mesh.position.x;
    const pz     = this.player.mesh.position.z;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(0, 20, 40, 0)';
    ctx.fillRect(0, 0, size, size);

    // Enemy dots
    if (enemies) {
      for (const e of enemies) {
        if (e.isDead || !e.mesh.visible) continue;
        const ex = cx + (e.mesh.position.x - px) * scale;
        const ez = cy + (e.mesh.position.z - pz) * scale;
        if (ex < 0 || ex > size || ez < 0 || ez > size) continue;
        ctx.fillStyle = '#FF4136';
        ctx.beginPath();
        ctx.arc(ex, ez, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Player dot (always centered)
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();

    // "MAP" label
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '9px Courier New';
    ctx.fillText('MAP', 5, 14);
  }
}
