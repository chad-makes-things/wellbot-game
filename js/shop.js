// shop.js — Shop UI overlay logic

// Full shop item list from ui_ux_spec.md §3.3 and narrative_copy_guide.md §3
const SHOP_ITEMS = [
  {
    id: 'shotgun',
    name: 'BOOM BLASTER',
    desc: 'Fires a spread of shots — great for enemies up close.',
    price: 25,
    category: 'Weapon',
    iconColor: '#664400',
    label: 'SHOTGUN',
  },
  {
    id: 'rocket',
    name: 'THE ROCKET',
    desc: 'Slow but massive. One shot clears the whole block.',
    price: 60,
    category: 'Weapon',
    iconColor: '#886600',
    label: 'ROCKET',
  },
  {
    id: 'laser',
    name: 'LASER BEAM',
    desc: 'Hold the button and melt anything in your path.',
    price: 50,
    category: 'Weapon',
    iconColor: '#00AACC',
    label: 'LASER',
  },
  {
    id: 'sword',
    name: 'SUPER SWORD',
    desc: 'Fast slashes, zero ammo needed. Get in close and go wild.',
    price: 35,
    category: 'Weapon',
    iconColor: '#AAAAAA',
    label: 'SWORD',
  },
  {
    id: 'car',
    name: 'SPEED CAR',
    desc: 'Zip around the city way faster than on foot.',
    price: 40,
    category: 'Vehicle',
    iconColor: '#3A86FF',
    label: 'CAR',
  },
  {
    id: 'motorcycle',
    name: 'TURBO BIKE',
    desc: 'The fastest ride in town — hold on tight!',
    price: 30,
    category: 'Vehicle',
    iconColor: '#FF6B35',
    label: 'BIKE',
  },
  {
    id: 'tank',
    name: 'THE TANK',
    desc: 'Slow and heavy, but it blasts through everything.',
    price: 100,
    category: 'Vehicle',
    iconColor: '#4A5240',
    label: 'TANK',
  },
];

export class Shop {
  constructor(player) {
    this.player        = player;
    this.isOpen        = false;
    this.selectedIndex = 0;
    this.ownedItems    = new Set();

    this._overlay  = document.getElementById('shop-overlay');
    this._coinsBal = document.getElementById('shop-coins-balance');
    this._list     = document.getElementById('shop-item-list');
    this._feedback = document.getElementById('shop-feedback');

    this._feedbackTimer = 0;
    this._buildItemList();
  }

  _buildItemList() {
    if (!this._list) return;
    this._list.innerHTML = '';
    for (let i = 0; i < SHOP_ITEMS.length; i++) {
      const item = SHOP_ITEMS[i];
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.dataset.index = i;

      row.innerHTML = `
        <div class="shop-icon" style="background:${item.iconColor}">${item.label}</div>
        <div class="shop-info">
          <div class="shop-item-name">${item.name}</div>
          <div class="shop-item-desc">${item.desc}</div>
        </div>
        <div class="shop-price">
          <span class="shop-coin-icon">●</span>
          <span class="shop-price-num">${item.price}</span>
        </div>
        <div class="shop-buy-btn" id="shop-btn-${i}">BUY</div>
      `;
      this._list.appendChild(row);
    }
  }

  open() {
    this.isOpen = true;
    this.selectedIndex = 0;
    this._overlay.classList.remove('hidden');
    this._refreshList();
    this._updateBalance();
  }

  close() {
    this.isOpen = false;
    this._overlay.classList.add('hidden');
    this._feedbackTimer = 0;
    if (this._feedback) this._feedback.textContent = '';
  }

  _refreshList() {
    const rows = this._list.querySelectorAll('.shop-row');
    rows.forEach((row, i) => {
      const item = SHOP_ITEMS[i];
      row.classList.toggle('highlighted', i === this.selectedIndex);
      const btn = document.getElementById(`shop-btn-${i}`);
      if (!btn) return;

      // Coming in Beta label for actual purchase functionality
      if (this.ownedItems.has(item.id)) {
        btn.textContent = '✓ OWNED';
        btn.className = 'shop-buy-btn owned';
        row.style.background = 'rgba(46, 204, 64, 0.08)';
      } else {
        btn.textContent = 'BUY';
        btn.className = 'shop-buy-btn';
        if (i === this.selectedIndex) {
          row.style.background = 'rgba(255, 215, 0, 0.12)';
          row.style.borderLeft = '3px solid #FFD700';
        } else {
          row.style.background = '';
          row.style.borderLeft = '';
        }
      }
    });
  }

  _updateBalance() {
    if (this._coinsBal) {
      this._coinsBal.textContent = this.player.coins;
    }
  }

  _attemptPurchase() {
    const item = SHOP_ITEMS[this.selectedIndex];
    if (this.ownedItems.has(item.id)) return;

    // Alpha: show "Coming in Beta" for actual unlock effect
    // But coin total still works correctly
    if (this.player.coins >= item.price) {
      this.player.coins -= item.price;
      this.ownedItems.add(item.id);

      // Add weapon to player's unlocked list so C key can cycle to it.
      if (item.category === 'Weapon' && !this.player.unlockedWeapons.includes(item.id)) {
        this.player.unlockedWeapons.push(item.id);
      }

      // Spawn vehicle near player
      if (item.category === 'Vehicle' && this.vehicleManager) {
        const dir = this.player.mesh.rotation.y;
        const spawnPos = this.player.mesh.position.clone();
        spawnPos.x += Math.sin(dir) * 4;
        spawnPos.z += Math.cos(dir) * 4;
        spawnPos.y = 0;
        this.vehicleManager.spawnVehicle(item.id, spawnPos, dir);
      }

      // Flash green
      const rows = this._list.querySelectorAll('.shop-row');
      const row  = rows[this.selectedIndex];
      if (row) {
        row.style.background = 'rgba(46, 204, 64, 0.6)';
        setTimeout(() => {
          row.style.background = 'rgba(46, 204, 64, 0.08)';
        }, 200);
      }

      this._updateBalance();
      this._refreshList();

      // Show feedback
      const msg = item.category === 'Vehicle'
        ? `${item.name} is ready! Walk to it and press Space.`
        : `${item.name} unlocked! Press C to equip.`;
      this._showFeedback(msg, '#2ECC40');

      // Auto-close after 600ms
      setTimeout(() => this.close(), 700);
    } else {
      const needed = item.price - this.player.coins;
      this._showFeedback(`Need ${needed} more coins!`, '#FF4136');

      // Flash row red
      const rows = this._list.querySelectorAll('.shop-row');
      const row  = rows[this.selectedIndex];
      if (row) {
        row.style.background = 'rgba(255, 65, 54, 0.35)';
        setTimeout(() => { row.style.background = ''; }, 400);
      }

      // Shake balance display
      if (this._coinsBal) {
        this._coinsBal.classList.add('shake');
        setTimeout(() => this._coinsBal.classList.remove('shake'), 300);
      }
    }
  }

  _showFeedback(text, color) {
    if (this._feedback) {
      this._feedback.textContent = text;
      this._feedback.style.color = color;
      this._feedbackTimer = 1.5;
    }
  }

  // Call from main game loop — returns true if shop consumed the input
  handleInput(justPressed) {
    if (!this.isOpen) return false;

    if (justPressed['ArrowDown']) {
      this.selectedIndex = (this.selectedIndex + 1) % SHOP_ITEMS.length;
      this._refreshList();
      this._updateBalance();
    }
    if (justPressed['ArrowUp']) {
      this.selectedIndex = (this.selectedIndex - 1 + SHOP_ITEMS.length) % SHOP_ITEMS.length;
      this._refreshList();
      this._updateBalance();
    }
    if (justPressed['Space']) {
      this._attemptPurchase();
    }
    return true;
  }

  update(delta) {
    if (!this.isOpen) return;
    if (this._feedbackTimer > 0) {
      this._feedbackTimer -= delta;
      if (this._feedbackTimer <= 0) {
        if (this._feedback) this._feedback.textContent = '';
      }
    }
    // Live balance update
    this._updateBalance();
  }
}
