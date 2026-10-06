const Cart = {
  items: [],
  
  init() {
    this.loadCart();
    this.bindEvents();
    this.render();
    this.trySyncFromCloud();
    this.checkAbandonedCart();
  },

  // FIX: app.js'in syncUserData olayını beklemek yerine, cart.js kendi başına
  // buluttaki sepeti kontrol edip yerelle birleştiriyor. Bu, iki dosya
  // arasındaki zamanlama sorunundan (race condition) bağımsız çalışmasını sağlar.
  
  checkAbandonedCart() {
    if (this.items.length === 0) return;
    const lastReminder = localStorage.getItem('bayyildiz_cart_reminder_2');
    const now = new Date().getTime();
    if (lastReminder && now - parseInt(lastReminder) < 6 * 60 * 60 * 1000) return; // 6 saat
    
    setTimeout(() => {
        if (this.items.length > 0 && !document.getElementById('cart-drawer').classList.contains('active')) {
            const toast = document.createElement('div');
            toast.className = 'abandoned-cart-toast';
            toast.innerHTML = `
                <div class="toast-icon">🛍️</div>
                <div class="toast-text">
                    <strong>Sepetiniz Sizi Bekliyor!</strong>
                    <span>Tükenmeden siparişinizi tamamlayın.</span>
                </div>
                <button onclick="window.Cart.openDrawer(); this.parentElement.classList.remove('show'); setTimeout(()=>this.parentElement.remove(), 500);">Sepete Git</button>
                <button class="toast-close" onclick="this.parentElement.classList.remove('show'); setTimeout(()=>this.parentElement.remove(), 500);">✕</button>
            `;
            document.body.appendChild(toast);
            
            const style = document.createElement('style');
            style.textContent = `
                .abandoned-cart-toast {
                    position: fixed; bottom: 90px; right: 20px; background: white; padding: 15px; border-radius: 12px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.15); display: flex; align-items: center; gap: 12px; z-index: 9998;
                    transform: translateX(120%); transition: transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                    border-left: 4px solid var(--primary, #10b981);
                }
                .abandoned-cart-toast.show { transform: translateX(0); }
                .abandoned-cart-toast .toast-icon { font-size: 28px; }
                .abandoned-cart-toast .toast-text { display: flex; flex-direction: column; }
                .abandoned-cart-toast .toast-text strong { font-size: 14px; color: #1e293b; margin-bottom: 2px; }
                .abandoned-cart-toast .toast-text span { font-size: 12px; color: #64748b; }
                .abandoned-cart-toast button { background: var(--primary, #10b981); color: white; border: none; padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; transition: 0.2s; white-space: nowrap; }
                .abandoned-cart-toast button:hover { opacity: 0.9; transform: translateY(-1px); }
                .abandoned-cart-toast .toast-close { background: transparent; color: #94a3b8; font-size: 18px; padding: 0 4px; font-weight: normal; margin-left: -5px; }
                .abandoned-cart-toast .toast-close:hover { color: #475569; background: transparent; transform: none; }
                @media(max-width: 768px) {
                    .abandoned-cart-toast { bottom: 20px; right: 10px; left: 10px; justify-content: space-between; }
                    .abandoned-cart-toast button { margin-left: auto; }
                }
            `;
            document.head.appendChild(style);
            
            setTimeout(() => toast.classList.add('show'), 100);
            localStorage.setItem('bayyildiz_cart_reminder_2', now.toString());
        }
    }, 4000); 
  },

  async trySyncFromCloud() {
    // Firebase App henüz initialize edilmemiş olabilir (script sırası/zamanlaması),
    // en fazla ~5 saniye kısa aralıklarla bekle.
    const ready = await new Promise((resolve) => {
        let waited = 0;
        const check = () => {
            if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
                resolve(true);
            } else if (waited >= 5000) {
                resolve(false);
            } else {
                waited += 50;
                setTimeout(check, 50);
            }
        };
        check();
    });
    if (!ready) return;

    const user = await new Promise((resolve) => {
        const unsub = firebase.auth().onAuthStateChanged((u) => {
            unsub();
            resolve(u);
        });
    });

    if (!user || user.isAnonymous) return;

    const uid = (window.App && window.App.userDbKey) ? window.App.userDbKey : user.uid;
    const dataPath = (window.App && window.App.DATA_PATH) ? window.App.DATA_PATH : '_bayyildiz_secure_v1_A9xK2mP8';

    try {
        const snap = await firebase.database().ref(`${dataPath}/customers/${uid}/cart`).once('value');
        if (!snap.exists()) return;

        const remoteCart = Array.isArray(snap.val()) ? snap.val() : Object.values(snap.val());
        if (!remoteCart.length) return;

        let changed = false;
        remoteCart.forEach(rItem => {
            const existing = this.items.find(i => i.id === rItem.id && i.size === rItem.size && i.branch === rItem.branch);
            if (existing) {
                if ((rItem.qty || 0) > (existing.qty || 0)) {
                    existing.qty = rItem.qty;
                    changed = true;
                }
            } else {
                this.items.push(rItem);
                changed = true;
            }
        });

        if (changed) {
            localStorage.setItem('bayyildiz_cart', JSON.stringify(this.items));
            this.render();
        }
    } catch (e) {
        console.error("Bulut sepeti okunamadı:", e);
    }
  },

  loadCart() {
    const saved = localStorage.getItem('bayyildiz_cart');
    if (saved) {
      try {
        this.items = JSON.parse(saved);
      } catch (e) {
        this.items = [];
      }
    }
  },

  saveCart() {
    localStorage.setItem('bayyildiz_cart', JSON.stringify(this.items));
    this.render();
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser && !firebase.auth().currentUser.isAnonymous) {
        const uid = window.App && window.App.userDbKey ? window.App.userDbKey : firebase.auth().currentUser.uid;
        const dbPath = (window.App && window.App.DATA_PATH ? window.App.DATA_PATH : '_bayyildiz_secure_v1_A9xK2mP8') + '/customers/' + uid + '/cart';
        firebase.database().ref(dbPath).set(this.items).catch(e => console.error(e));
    }
  },

  addItem(product) {
    // product should have: id, name, price, size, branch, image
    const existingIndex = this.items.findIndex(item => item.id === product.id && item.size === product.size && item.branch === product.branch);
    
    // Stok kontrolü
    let currentQtyInCart = 0;
    if (existingIndex !== -1) {
      currentQtyInCart = this.items[existingIndex].qty;
    }
    
    if (typeof App !== 'undefined' && App.stockData && App.branches) {
      const pStock = App.stockData[product.id] || {};
      let totalSizeQty = 0;
      App.branches.forEach(branch => {
        const bStock = pStock[branch.id] || {};
        totalSizeQty += parseInt(bStock[product.size] || 0);
      });
      
      const otherSameSizeInCart = this.items
        .filter((x, i) => i !== existingIndex && x.id === product.id && x.size === product.size)
        .reduce((sum, x) => sum + (x.qty || 0), 0);
        
      const maxAllowed = totalSizeQty - otherSameSizeInCart;
      
      if (currentQtyInCart + 1 > maxAllowed) {
        if (typeof App.toast === 'function') {
           App.toast(`Stokta bu numaradan toplam ${totalSizeQty} adet mevcut. Daha fazla ekleyemezsiniz.`, 'error');
        } else {
           alert(`Stokta bu numaradan toplam ${totalSizeQty} adet mevcut. Daha fazla ekleyemezsiniz.`);
        }
        return; // İşlemi iptal et
      }
    }

    if (existingIndex !== -1) {
      this.items[existingIndex].qty += 1;
    } else {
      this.items.push({
        ...product,
        qty: 1
      });
    }
    
    this.saveCart();
    this.openDrawer();
  },

  removeItem(index) {
    this.items.splice(index, 1);
    this.saveCart();
  },

  updateQty(index, newQty) {
    if (newQty < 1) return;
    
    const item = this.items[index];
    
    // Stok kontrolü (Eğer App yüklüyse)
    if (typeof App !== 'undefined' && App.stockData && App.branches) {
      const pStock = App.stockData[item.id] || {};
      let totalSizeQty = 0;
      App.branches.forEach(branch => {
        const bStock = pStock[branch.id] || {};
        totalSizeQty += parseInt(bStock[item.size] || 0);
      });
      
      const currentOtherQty = this.items
        .filter((x, i) => i !== index && x.id === item.id && x.size === item.size)
        .reduce((sum, x) => sum + (x.qty || 0), 0);
        
      const maxAllowed = totalSizeQty - currentOtherQty;
      
      if (newQty > maxAllowed) {
        if (typeof App.toast === 'function') {
           App.toast(`Stokta toplam ${totalSizeQty} adet mevcut. Daha fazla artıramazsınız.`, 'error');
        } else {
           alert(`Stokta toplam ${totalSizeQty} adet mevcut.`);
        }
        return;
      }
    }

    this.items[index].qty = parseInt(newQty);
    this.saveCart();
  },

  getTotal() {
    return this.items.reduce((total, item) => total + (item.price * item.qty), 0);
  },

  bindEvents() {
    const toggleBtns = document.querySelectorAll('.cart-toggle');
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.openDrawer();
      });
    });

    const closeBtn = document.getElementById('cart-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeDrawer());
    }

    const overlay = document.getElementById('cart-drawer-overlay');
    if (overlay) {
      overlay.addEventListener('click', () => this.closeDrawer());
    }
    
    const checkoutBtn = document.getElementById('btn-cart-checkout');
    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', () => this.checkoutWhatsApp());
    }
  },

  openDrawer() {
    document.getElementById('cart-drawer').classList.add('active');
    document.getElementById('cart-drawer-overlay').classList.add('active');
    document.body.style.overflow = 'hidden'; // prevent bg scrolling
  },

  closeDrawer() {
    document.getElementById('cart-drawer').classList.remove('active');
    document.getElementById('cart-drawer-overlay').classList.remove('active');
    document.body.style.overflow = '';
  },

  render() {
    // Update badge
    const badges = document.querySelectorAll('.cart-badge');
    const totalItems = this.items.reduce((sum, item) => sum + item.qty, 0);
    badges.forEach(badge => {
      badge.textContent = totalItems;
      badge.style.display = totalItems > 0 ? 'flex' : 'none';
    });

    // Render items
    const cartBody = document.getElementById('cart-items-container');
    if (!cartBody) return;

    if (this.items.length === 0) {
      cartBody.innerHTML = `
        <div class="empty-cart">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
          </svg>
          <p>Sepetiniz şu an boş.</p>
        </div>
      `;
      document.getElementById('btn-cart-checkout').disabled = true;
      const iyzBtn = document.getElementById('btn-cart-iyzico');
      if (iyzBtn) iyzBtn.disabled = true;
      document.getElementById('cart-total-price').textContent = '0,00 ₺';
      return;
    }

    document.getElementById('btn-cart-checkout').disabled = false;
    const iyzBtn = document.getElementById('btn-cart-iyzico');
    if (iyzBtn) iyzBtn.disabled = false;

    let html = '';
    const escapeHtml = (str) => {
        if (!str) return '';
        return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    };

    this.items.forEach((item, index) => {
      const priceFormatted = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(item.price);
      const safeImage = escapeHtml(item.image || 'img/logo.webp?v=2');
      const safeName = escapeHtml(item.name);
      const safeBranch = escapeHtml(item.branch);
      const safeSize = escapeHtml(item.size);

      html += `
        <div class="cart-item">
          <img src="${safeImage}" alt="${safeName}" class="cart-item-img">
          <div class="cart-item-details">
            <div>
              <div class="cart-item-title">${safeName}</div>
              <div class="cart-item-meta">Şube: ${safeBranch} | No: ${safeSize}</div>
            </div>
            <div class="cart-item-actions">
              <div class="cart-item-price">${priceFormatted}</div>
              
              <div class="qty-control">
                <button class="qty-btn" onclick="Cart.updateQty(${index}, ${item.qty - 1})">-</button>
                <input type="text" class="qty-input" value="${item.qty}" readonly>
                <button class="qty-btn" onclick="Cart.updateQty(${index}, ${item.qty + 1})">+</button>
              </div>
              
              <button class="remove-btn" onclick="Cart.removeItem(${index})">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    });

    cartBody.innerHTML = html;
    
    // Update total
    const totalFormatted = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(this.getTotal());
    document.getElementById('cart-total-price').textContent = totalFormatted;
  },

  async checkoutWhatsApp() {
    if (this.items.length === 0) return;
    
    const btn = document.getElementById('btn-cart-checkout');
    const originalBtnHtml = btn ? btn.innerHTML : 'Siparişi Tamamla';
    if (btn) {
        btn.innerHTML = 'İşleniyor...';
        btn.disabled = true;
    }
    
    let customerInfo = "";
    // FIX: "snap" artık dış scope'ta tanımlı, ikinci try bloğu da erişebiliyor.
    let snap = null;
    if (typeof firebase !== 'undefined' && typeof firebase.auth === 'function' && firebase.auth().currentUser) {
       const user = firebase.auth().currentUser;
       if (user) {
           let dbPath = (window.App && window.App.DATA_PATH ? window.App.DATA_PATH : '_bayyildiz_secure_v1_A9xK2mP8') + '/customers/' + user.uid;
           try {
               snap = await firebase.database().ref(dbPath).once('value');
               if (snap.exists() && (snap.val().name || snap.val().isimSoyisim || snap.val().adSoyad || snap.val().phone || snap.val().telefon)) {
                   let data = snap.val();
                   customerInfo = `\n\n*Müşteri Bilgileri:*\nİsim: ${data.name || data.isimSoyisim || data.adSoyad || ''}\nTel: ${data.phone || data.telefon || ''}\nE-posta: ${data.email || user.email || ''}`;
               } else if (user.email) {
                   const baseCustomersPath = (window.App && window.App.DATA_PATH ? window.App.DATA_PATH : '_bayyildiz_secure_v1_A9xK2mP8') + '/customers';
                   const querySnap = await firebase.database().ref(baseCustomersPath).orderByChild('email').equalTo(user.email).once('value');
                   if (querySnap.exists()) {
                       const results = querySnap.val();
                       const firstKey = Object.keys(results)[0];
                       const data = results[firstKey];
                       snap = { exists: () => true, val: () => data };
                       customerInfo = `\n\n*Müşteri Bilgileri:*\nİsim: ${data.name || data.isimSoyisim || data.adSoyad || data["ad soyad"] || data.ad_soyad || data.displayName || data.kullaniciAdi || ''}\nTel: ${data.phone || data.telefon || ''}\nE-posta: ${data.email || user.email || ''}`;
                   } else {
                       customerInfo = `\n\n*Müşteri Bilgileri:*\nE-posta: ${user.email}`;
                   }
               } else {
                   customerInfo = `\n\n*Müşteri Bilgileri:*\nE-posta: ${user.email}`;
               }
           } catch(e) {
               console.error("Müşteri bilgisi okunamadı", e);
           }
       }
       
// Push is deferred to app.js if they are a guest, or handled below if real user.
    }
    
    let text = "🛍️ *YENİ SİPARİŞ TALEBİ*\n\n👋 Merhaba, web sitenizden aşağıdaki ürünleri sipariş vermek istiyorum:\n\n";
    
    this.items.forEach((item, i) => {
      text += `📦 *${i+1}. Ürün:* ${item.name}\n`;
      text += `🏷️ *Beden/Numara:* ${item.size} (${item.branch})\n`;
      text += `🛒 *Adet:* ${item.qty} x ${item.price} TL\n`;
      text += `---------------------------\n`;
    });
    
    const totalFormatted = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(this.getTotal());
    text += `\n💵 *Genel Toplam: ${totalFormatted}*\n`;
    
    if(customerInfo) {
        if (window.App && typeof window.App.openWhatsAppModal === 'function') {
            if (btn) { btn.innerHTML = originalBtnHtml; btn.disabled = false; }
            this.closeDrawer();
            
            let prefill = {};
            if (snap && snap.exists()) {
                let d = snap.val();
                prefill.name = d.name || d.isimSoyisim || d.adSoyad || d["ad soyad"] || d.ad_soyad || d.displayName || d.kullaniciAdi || '';
                prefill.phone = d.phone || d.telefon || '';
                prefill.email = d.email || (firebase.auth().currentUser ? firebase.auth().currentUser.email : '');
            } else if (firebase.auth().currentUser) {
                prefill.email = firebase.auth().currentUser.email;
            }
            window.App.openWhatsAppModal(text, prefill);
        } else {
            text += customerInfo;
            const waUrl = `https://wa.me/${window.BAYYILDIZ_WA_NUMBER || '905522228298'}?text=${encodeURIComponent(text)}`;
            this.items = [];
            this.saveCart();
            if (btn) { btn.innerHTML = originalBtnHtml; btn.disabled = false; }
            this.closeDrawer();
            window.open(waUrl, '_blank');
        }
    } else {
        if (window.App && typeof window.App.openWhatsAppModal === 'function') {
            if (btn) { btn.innerHTML = originalBtnHtml; btn.disabled = false; }
            this.closeDrawer();
            window.App.openWhatsAppModal(text);
        } else {
            text += "\n\n*(Kayıtsız Ziyaretçi Siparişi)*\nLütfen isim ve adres bilgilerinizi bu sohbete yazınız.";
            const waUrl = `https://wa.me/${window.BAYYILDIZ_WA_NUMBER || '905522228298'}?text=${encodeURIComponent(text)}`;
            this.items = [];
            this.saveCart();
            if (btn) { btn.innerHTML = originalBtnHtml; btn.disabled = false; }
            this.closeDrawer();
            window.open(waUrl, '_blank');
        }
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  Cart.init();
});

window.addEventListener('cartUpdated', () => { if(typeof Cart !== 'undefined') { Cart.loadCart(); Cart.render(); } });

window.Cart = Cart;
