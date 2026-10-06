// ==========================================
// BAYYILDIZ Ayakkabı - Web Sitesi Uygulama Mantığı
// Firebase'den CANLI stok ve ürün okuma (Salt Okunur)
// ==========================================

// Herkes için geçmişi bir kereliğine temizle (Yeni güncelleme)
if (!localStorage.getItem('bayyildiz_history_cleared_v1')) {
    localStorage.removeItem('bayyildiz_history');
    localStorage.setItem('bayyildiz_history_cleared_v1', 'true');
}

const App = {
  db: null,
  products: [],
  stockData: {},
  branches: [],
  settings: null,
  
  // XSS Koruması için yardımcı fonksiyon
  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },

  // State
  filters: {
    query: '',
    category: 'all',
    gender: 'all',
    season: 'all',
    brand: 'all',
    sort: 'newest',
    stockOnly: false,
    color: 'all'
  },
  currentPage: 1,
  itemsPerPage: 12,
  filteredProducts: [],
  selectedSize: null,
  selectedBranch: null,
  favorites: JSON.parse(localStorage.getItem('bayyildiz_favorites') || '[]'),

  toggleFavorite(productId) {
    if (this.favorites.includes(productId)) {
      this.favorites = this.favorites.filter(id => id !== productId);
    } else {
      this.favorites.push(productId);
    }
    this.saveFavorites();
    return this.isFavorite(productId);
  },

  isFavorite(productId) {
    return this.favorites.includes(productId);
  },

  saveFavorites() {
    localStorage.setItem('bayyildiz_favorites', JSON.stringify(this.favorites));
    if (typeof firebase !== 'undefined' && firebase.auth().currentUser && !firebase.auth().currentUser.isAnonymous) {
        const uid = window.App && window.App.userDbKey ? window.App.userDbKey : firebase.auth().currentUser.uid;
        const dbPath = (this.DATA_PATH ? this.DATA_PATH : '_bayyildiz_secure_v1_A9xK2mP8') + '/customers/' + uid + '/favorites';
        firebase.database().ref(dbPath).set(this.favorites).catch(e => console.error(e));
    }
    if (document.getElementById('history-grid')) {
      if(typeof this.renderDashboard === 'function') this.renderDashboard();
    }
  },

  async syncUserData(uid) {
    // FIX: app.js henüz Firebase'e bağlanmamış olabilir (race condition).
    // "this.db" hazır olana kadar kısa aralıklarla bekle, en fazla 5 saniye.
    if (!this.db) {
        let waited = 0;
        while (!this.db && waited < 5000) {
            await new Promise(r => setTimeout(r, 100));
            waited += 100;
        }
        if (!this.db) {
            console.warn("syncUserData: Firebase veritabanı bağlantısı zaman aşımına uğradı.");
            return;
        }
    }
    
    let currentUser = typeof firebase !== 'undefined' ? firebase.auth().currentUser : null;
    if (!currentUser || currentUser.isAnonymous) return;
    
    const baseCustomersPath = (this.DATA_PATH ? this.DATA_PATH : '_bayyildiz_secure_v1_A9xK2mP8') + '/customers';
    let dbKey = uid;
    this.userDbKey = dbKey;
    const dbPath = baseCustomersPath + '/' + dbKey;

    let seedData = null;

    try {
      const snap = await this.db.ref(dbPath).once('value');
      const data = snap.exists() ? snap.val() : {};
      
      if (!snap.exists() && currentUser.email) {
          try {
              let querySnap = await this.db.ref(baseCustomersPath).orderByChild('email').equalTo(currentUser.email).once('value');
              if (querySnap.exists()) {
                  let results = querySnap.val();
                  let firstKey = Object.keys(results)[0];
                  if (firstKey !== uid) {
                      seedData = results[firstKey];
                  }
              }
          } catch (e) {
              // console.warn("Legacy arama başarısız:", e); 
          }
      }

      if (snap.exists() || true) { // Daima local verileri kontrol et
        let dirty = false;

        let profileFields = {};
        if (seedData) {
            ['name','isimSoyisim','adSoyad','ad soyad','ad_soyad','displayName','kullaniciAdi','telefon','phone','email','kayitTarihi','createdAt'].forEach(f => {
                if (!data[f] && seedData[f]) {
                    profileFields[f] = seedData[f];
                    dirty = true;
                }
            });
        }

        let remoteFavs = data.favorites ? (Array.isArray(data.favorites) ? data.favorites : Object.values(data.favorites)) : [];
        if (seedData && seedData.favorites) {
            let seedFavs = Array.isArray(seedData.favorites) ? seedData.favorites : Object.values(seedData.favorites);
            remoteFavs = [...new Set([...remoteFavs, ...seedFavs])];
        }
        let localFavs = JSON.parse(localStorage.getItem('bayyildiz_favorites') || '[]');
        let mergedFavs = [...new Set([...localFavs, ...remoteFavs])];
        if (mergedFavs.length > localFavs.length || localFavs.length === 0 || localFavs.length > remoteFavs.length) {
          this.favorites = mergedFavs;
          localStorage.setItem('bayyildiz_favorites', JSON.stringify(mergedFavs));
          dirty = true;
        }

        let remoteHist = data.history ? (Array.isArray(data.history) ? data.history : Object.values(data.history)) : [];
        if (seedData && seedData.history) {
            let seedHist = Array.isArray(seedData.history) ? seedData.history : Object.values(seedData.history);
            remoteHist = [...new Set([...remoteHist, ...seedHist])];
        }
        let localHist = JSON.parse(localStorage.getItem('bayyildiz_history') || '[]');
        let mergedHist = [...new Set([...localHist, ...remoteHist])].slice(0, 20);
        if (mergedHist.length > localHist.length || localHist.length === 0 || localHist.length > remoteHist.length) {
          localStorage.setItem('bayyildiz_history', JSON.stringify(mergedHist));
          dirty = true;
        }

        let remoteCart = data.cart ? (Array.isArray(data.cart) ? data.cart : Object.values(data.cart)) : [];
        let localCart = JSON.parse(localStorage.getItem('bayyildiz_cart') || '[]');
        
        let mergedCart = [...localCart];
        let cartChanged = false;
        
        remoteCart.forEach(rItem => {
            let existing = mergedCart.find(lItem => lItem.id === rItem.id && lItem.size === rItem.size && lItem.branch === rItem.branch);
            if (existing) {
                if (rItem.qty > existing.qty) {
                    existing.qty = rItem.qty;
                    cartChanged = true;
                }
            } else {
                mergedCart.push(rItem);
                cartChanged = true;
            }
        });

        if (cartChanged || localCart.length === 0 && remoteCart.length > 0 || localCart.length > remoteCart.length) {
            localStorage.setItem('bayyildiz_cart', JSON.stringify(mergedCart));
            window.dispatchEvent(new Event('cartUpdated'));
            dirty = true;
        }

        if (dirty) {
          try {
            await this.db.ref(dbPath).update({
              favorites: JSON.parse(localStorage.getItem('bayyildiz_favorites') || '[]'),
              history: JSON.parse(localStorage.getItem('bayyildiz_history') || '[]'),
              cart: JSON.parse(localStorage.getItem('bayyildiz_cart') || '[]'),
              ...profileFields
            });
            if (document.getElementById('history-grid') && typeof this.renderDashboard === 'function') {
                this.renderDashboard();
            }
            window.dispatchEvent(new Event('favoritesUpdated'));
            
            // Eğer yeni bir tarayıcıdan girildiyse (localCart 0 iken remoteCart varsa)
            if (localCart.length === 0 && remoteCart.length > 0) {
//                 if(typeof App.toast === 'function') App.toast('Buluttaki sepetiniz yüklendi', 'success');
            } else {
//                 if(typeof App.toast === 'function') App.toast('Verileriniz senkronize edildi', 'success');
            }
          } catch(err) {
            console.error(err);
//             if(typeof App.toast === 'function') App.toast('Senkronizasyon yetki hatası!', 'error');
          }
        } else if (remoteCart.length > 0 || remoteFavs.length > 0) {
//            if(typeof App.toast === 'function') App.toast('Kayıtlı verileriniz yüklendi.', 'success');
        }
      }
    } catch(e) {
      console.error("Senkronizasyon hatası:", e);
    }
  },


  // Firebase Config (Aynı veritabanı)
  firebaseConfig: {
    apiKey: "AIzaSyCn5XmqEuwpaVpbE838MQXUPDbCWohpn0k",
    authDomain: "bayyildiz-stoktakip-4f986.firebaseapp.com",
    databaseURL: "https://bayyildiz-stoktakip-4f986-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "bayyildiz-stoktakip-4f986"
  },
  
  // DİKKAT: Güvenlik açığı oluşturmamak için credentials (e-posta/şifre) buradan kaldırıldı.
  // Artık anonim giriş kullanılıyor. Firebase konsolundan anonim girişi açmayı unutmayın!
  
  DATA_PATH: '_bayyildiz_secure_v1_A9xK2mP8',
  
  toastTimeout: null,
  toast(message, type = 'info') {
    let toastEl = document.getElementById('modern-toast');
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'modern-toast';
      document.body.appendChild(toastEl);
    }
    
    let bgColor = '#111827';
    let icon = '';
    if (type === 'error') {
      bgColor = '#ef4444';
      icon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    } else if (type === 'success') {
      bgColor = '#10b981';
      icon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
    } else {
      icon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }

    toastEl.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; gap: 12px; flex-direction: column; text-align: center;">
        <div style="transform: scale(1.5); margin-bottom: 5px;">${icon}</div>
        <div>${message}</div>
      </div>
    `;
    
    toastEl.className = 'modern-toast show';
    toastEl.style.background = bgColor;
    
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }
    this.toastTimeout = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 3500);
  },
  
  
  openWhatsAppModal(cartText = null, prefill = null) {
    if (!document.getElementById('wa-guest-modal-style')) {
      const style = document.createElement('style');
      style.id = 'wa-guest-modal-style';
      style.textContent = `
        .wa-modal-overlay {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%;
          background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center;
          z-index: 999999; backdrop-filter: blur(4px); opacity: 0; visibility: hidden; transition: 0.3s;
        }
        .wa-modal-overlay.active { opacity: 1; visibility: visible; }
        .wa-modal-box {
          background: #fff; width: 90%; max-width: 400px; border-radius: 16px; padding: 2rem;
          box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);
          transform: translateY(20px); transition: 0.3s;
        }
        .wa-modal-overlay.active .wa-modal-box { transform: translateY(0); }
        .wa-modal-title { font-size: 1.25rem; font-weight: 700; color: #0f172a; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem; }
        .wa-modal-desc { font-size: 0.9rem; color: #64748b; margin-bottom: 1.5rem; line-height: 1.5; }
        .wa-modal-form .form-group { margin-bottom: 1rem; }
        .wa-modal-form label { display: block; font-size: 0.85rem; font-weight: 600; color: #334155; margin-bottom: 0.25rem; }
        .wa-modal-form input { width: 100%; padding: 0.75rem; border: 1px solid #cbd5e1; border-radius: 8px; outline: none; transition: 0.2s; font-family: inherit; }
        .wa-modal-form input:focus { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,0.1); }
        .wa-modal-actions { display: flex; gap: 1rem; margin-top: 1.5rem; }
        .wa-modal-btn { flex: 1; padding: 0.75rem; border-radius: 8px; font-weight: 600; cursor: pointer; text-align: center; border: none; transition: 0.2s; }
        .wa-modal-btn.cancel { background: #f1f5f9; color: #475569; }
        .wa-modal-btn.cancel:hover { background: #e2e8f0; }
        .wa-modal-btn.submit { background: #10b981; color: white; display: flex; justify-content: center; align-items: center; gap: 0.5rem; }
        .wa-modal-btn.submit:hover { background: #059669; }
      `;
      document.head.appendChild(style);
    }

    let overlay = document.getElementById('wa-guest-modal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'wa-guest-modal';
      overlay.className = 'wa-modal-overlay';
      overlay.innerHTML = `
        <div class="wa-modal-box">
          <div class="wa-modal-title">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="#10b981"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            Hızlı İletişim
          </div>
          <div class="wa-modal-desc">Size daha hızlı yardımcı olabilmemiz için lütfen bilgilerinizi giriniz.</div>
          <div class="wa-modal-form">
            <div class="form-group">
              <label>İsim Soyisim</label>
              <input type="text" id="wa-guest-name" placeholder="Adınız Soyadınız">
            </div>
            <div class="form-group">
              <label>Telefon Numarası</label>
              <input type="tel" id="wa-guest-phone" placeholder="05xx xxx xx xx">
            </div>
            <div class="form-group">
              <label>E-posta Adresi (İsteğe Bağlı)</label>
              <input type="email" id="wa-guest-email" placeholder="ornek@email.com">
            </div>
            <div class="form-group">
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                <label style="margin-bottom: 0;">İleti / Not (İsteğe Bağlı)</label>
              </div>
              <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px;">
                <span class="wa-template-btn" data-text="Bu ürün ne zaman kargoya verilir?" style="font-size: 0.75rem; background: #e2e8f0; color: #475569; padding: 5px 12px; border-radius: 12px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='#cbd5e1'" onmouseout="this.style.background='#e2e8f0'">Ne zaman kargolanır?</span>
                <span class="wa-template-btn" data-text="Farklı renk seçenekleri mevcut mu?" style="font-size: 0.75rem; background: #e2e8f0; color: #475569; padding: 5px 12px; border-radius: 12px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='#cbd5e1'" onmouseout="this.style.background='#e2e8f0'">Farklı rengi var mı?</span>
                <span class="wa-template-btn" data-text="Ürün kalıpları dar mı geniş mi?" style="font-size: 0.75rem; background: #e2e8f0; color: #475569; padding: 5px 12px; border-radius: 12px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='#cbd5e1'" onmouseout="this.style.background='#e2e8f0'">Kalıpları nasıl?</span>
              </div>
              <textarea id="wa-guest-note" rows="2" style="width:100%; padding:0.75rem; border:1px solid #cbd5e1; border-radius:8px; font-family:inherit; resize:vertical;" placeholder="Mesajınızı yazabilir veya yukarıdan bir şablon seçebilirsiniz..."></textarea>
            </div>
            <div class="form-group" style="margin-top: 15px; display: flex; align-items: center; gap: 12px; background: #f8fafc; padding: 12px 15px; border-radius: 8px; border: 1px solid #e2e8f0; transition: all 0.2s ease;">
              <input type="checkbox" id="wa-guest-kvkk" style="width: 20px; height: 20px; cursor: pointer; accent-color: #10b981; flex-shrink: 0; margin: 0;">
              <label for="wa-guest-kvkk" style="cursor: pointer; margin-bottom: 0; font-size: 0.85rem; color: #475569; line-height: 1.5; flex: 1;">
                <a href="sartlar-ve-kosullar.html" target="_blank" style="color: #10b981; text-decoration: none; font-weight: 600;">Kullanım Koşulları</a>'nı ve 
                <a href="gizlilik-politikasi.html" target="_blank" style="color: #10b981; text-decoration: none; font-weight: 600;">Gizlilik Politikası</a>'nı okudum, onaylıyorum.
              </label>
            </div>
          </div>
          <div class="wa-modal-actions">
            <button class="wa-modal-btn cancel" id="wa-guest-cancel">İptal</button>
            <button class="wa-modal-btn submit" id="wa-guest-submit" disabled style="opacity: 0.5; cursor: not-allowed;">Devam Et</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      // Bind template buttons
      const templateBtns = overlay.querySelectorAll('.wa-template-btn');
      const noteInput = document.getElementById('wa-guest-note');
      if (templateBtns && noteInput) {
         templateBtns.forEach(btn => {
            btn.addEventListener('click', () => {
               const textToAdd = btn.getAttribute('data-text');
               if (noteInput.value) {
                  noteInput.value = noteInput.value + '\n' + textToAdd;
               } else {
                  noteInput.value = textToAdd;
               }
            });
         });
      }

      const kvkkCheckbox = document.getElementById('wa-guest-kvkk');
      const submitBtn = document.getElementById('wa-guest-submit');
      
      kvkkCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          submitBtn.disabled = false;
          submitBtn.style.opacity = '1';
          submitBtn.style.cursor = 'pointer';
        } else {
          submitBtn.disabled = true;
          submitBtn.style.opacity = '0.5';
          submitBtn.style.cursor = 'not-allowed';
        }
      });

      document.getElementById('wa-guest-cancel').addEventListener('click', () => {
        overlay.classList.remove('active');
      });

      document.getElementById('wa-guest-submit').addEventListener('click', async () => {
        const name = document.getElementById('wa-guest-name').value.trim();
        const phone = document.getElementById('wa-guest-phone').value.trim();
        const email = document.getElementById('wa-guest-email').value.trim();
        const note = document.getElementById('wa-guest-note').value.trim();

        const nInput = document.getElementById('wa-guest-name');
        if (nInput && nInput.closest('.form-group').style.display !== 'none' && (!name || !phone)) {
          alert('Lütfen isim ve telefon bilgilerinizi giriniz.');
          return;
        }

        if (kvkkCheckbox.closest('.form-group').style.display !== 'none' && !kvkkCheckbox.checked) {
          alert('Lütfen Kullanım Koşulları ve Gizlilik Politikası şartlarını onaylayınız.');
          return;
        }

        // Check if user is logged in
        let headerText = '*(Kayıtsız Ziyaretçi Talebi)*';
        let isRealUser = false;
        if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser && !firebase.auth().currentUser.isAnonymous) {
            headerText = '*(Kayıtlı Müşteri Talebi)*';
            isRealUser = true;
        }
        
        // Add guest info to text
        let guestInfo = `${headerText}`;
        if (name) guestInfo += `\n👤 İsim: ${name}`;
        if (!isRealUser) {
            if (phone) guestInfo += `\n📞 Telefon: ${phone}`;
            if (email) guestInfo += `\n📧 E-posta: ${email}`;
        }
        if (note) guestInfo += `\n📝 İleti: ${note}`;
        
        let finalWaUrl = '';
        if (overlay.dataset.cartText) {
           let cText = overlay.dataset.cartText.trim();
           let combined = cText ? (cText + '\n\n' + guestInfo) : guestInfo;
           finalWaUrl = `https://wa.me/${window.BAYYILDIZ_WA_NUMBER || '905522228298'}?text=${encodeURIComponent(combined)}`;
        } else {
           const baseUrl = overlay.dataset.baseUrl || `https://wa.me/${window.BAYYILDIZ_WA_NUMBER || '905522228298'}`;
           const existingText = overlay.dataset.existingText ? overlay.dataset.existingText : '';
           let eText = existingText.trim();
           let combined = eText ? (eText + '\n\n' + guestInfo) : guestInfo;
           finalWaUrl = `${baseUrl}?text=${encodeURIComponent(combined)}`;
        }
        
        // If it's a cart checkout, save to Firebase!
        if (overlay.dataset.cartText && window.Cart && window.Cart.items && window.Cart.items.length > 0) {
            try {
                if (typeof firebase !== 'undefined' && firebase.database) {
                    // Update button UI to show it's saving
                    const subBtn = document.getElementById('wa-guest-submit');
                    const origText = subBtn ? subBtn.innerHTML : 'Devam Et';
                    if (subBtn) { subBtn.innerHTML = 'İşleniyor...'; subBtn.disabled = true; }
                    
                    let orderRef = firebase.database().ref('orders').push();
                    let currentUser = firebase.auth().currentUser;
                    await orderRef.set({
                        uid: currentUser ? currentUser.uid : 'anon_' + Date.now(),
                        phone: phone,
                        customerName: name,
                        items: window.Cart.items,
                        total: window.Cart.getTotal(),
                        date: new Date().toISOString(),
                        status: 1,
                        carrier: 'Satıcı onayı bekleniyor',
                        trackingCode: ''
                    });
                }
            } catch(e) {
                console.error("Misafir siparişi kaydedilemedi", e);
            }
        }

        overlay.classList.remove('active');
        
        // Clear cart if it was a cart checkout
        if (overlay.dataset.cartText && window.Cart) {
            window.Cart.items = [];
            window.Cart.saveCart();
        }

        window.open(finalWaUrl, '_blank');
      });
    }

    if (cartText) {
       overlay.dataset.cartText = cartText;
       overlay.dataset.baseUrl = '';
       overlay.dataset.existingText = '';
    } else {
       overlay.dataset.cartText = '';
    }
    
    
    if (prefill) {
       const nInput = document.getElementById('wa-guest-name');
       const pInput = document.getElementById('wa-guest-phone');
       const eInput = document.getElementById('wa-guest-email');
       const kvkkInput = document.getElementById('wa-guest-kvkk');
       const subBtn = document.getElementById('wa-guest-submit');
       
       if(nInput) { 
           nInput.value = prefill.name || ''; 
           nInput.closest('.form-group').style.display = prefill.name ? 'none' : 'block'; 
       }
       let isRealUserPrefill = typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser && !firebase.auth().currentUser.isAnonymous;
       if(pInput) { 
           pInput.value = prefill.phone || ''; 
           if (isRealUserPrefill) pInput.closest('.form-group').style.display = 'none';
           else pInput.closest('.form-group').style.display = prefill.phone ? 'none' : 'block'; 
       }
       if(eInput) { 
           eInput.value = prefill.email || ''; 
           if (isRealUserPrefill) eInput.closest('.form-group').style.display = 'none';
           else eInput.closest('.form-group').style.display = prefill.email ? 'none' : 'block'; 
       }
       
       // Sadece isim veya telefon eksikse ve e-posta varsa KVKK'yı gizlemeyebiliriz, 
       // ama KVKK'yı her halükarda logged-in user ise gizleyelim veya otomatik işaretleyelim
       if(kvkkInput) { 
           kvkkInput.checked = true;
           kvkkInput.closest('.form-group').style.display = 'none'; 
       }
       if(subBtn) { subBtn.disabled = false; subBtn.style.opacity = '1'; subBtn.style.cursor = 'pointer'; }
    } else {
       // Reset for guests
       const nInput = document.getElementById('wa-guest-name');
       const pInput = document.getElementById('wa-guest-phone');
       const eInput = document.getElementById('wa-guest-email');
       const kvkkInput = document.getElementById('wa-guest-kvkk');
       const subBtn = document.getElementById('wa-guest-submit');
       if(nInput) { nInput.value = ''; nInput.closest('.form-group').style.display = 'block'; }

       if(pInput) { pInput.value = ''; pInput.closest('.form-group').style.display = 'block'; }
       if(eInput) { eInput.value = ''; eInput.closest('.form-group').style.display = 'block'; }
       if(kvkkInput) { kvkkInput.checked = false; kvkkInput.closest('.form-group').style.display = 'flex'; }
       if(subBtn) { subBtn.disabled = true; subBtn.style.opacity = '0.5'; subBtn.style.cursor = 'not-allowed'; }
    }
    overlay.classList.add('active');
  },

  init() {
    this.bindEvents();
    this.bindNotifyForm();
    this.initFirebase();
    this.initTypewriterPlaceholder();
    this.initCookieConsent();
  },

  initCookieConsent() {
    if (localStorage.getItem('bayyildiz_cookie_consent')) return;
    
    const banner = document.createElement('div');
    banner.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      max-width: 400px;
      background: #1e293b;
      color: #cbd5e1;
      padding: 1.5rem;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      z-index: 9999999;
      font-size: 0.85rem;
      line-height: 1.5;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      border: 1px solid rgba(255,255,255,0.1);
      transform: translateY(150px);
      opacity: 0;
      transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    `;
    
    // Küçük ekranlar için ortalama/tam genişlik
    if (window.innerWidth < 450) {
       banner.style.left = '15px';
       banner.style.right = '15px';
       banner.style.bottom = '15px';
       banner.style.maxWidth = '100%';
    }

    banner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <div style="background: rgba(245, 158, 11, 0.2); padding: 8px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"></path><path d="M8.5 8.5v.01"></path><path d="M16 12.5v.01"></path><path d="M12 16v.01"></path><path d="M11 11.5v.01"></path></svg>
        </div>
        <h4 style="margin: 0; color: white; font-size: 1.05rem; font-weight: 600; letter-spacing: 0.5px;">Çerez Kullanımı</h4>
      </div>
      <p style="margin: 0; color: #94a3b8; font-size: 0.9rem;">Daha iyi bir alışveriş deneyimi sunabilmek için yasal düzenlemelere uygun çerezler (cookies) kullanıyoruz. Detaylı bilgi için <a href="gizlilik-politikasi.html" style="color: #f59e0b; text-decoration: underline;">Gizlilik Politikamızı</a> inceleyebilirsiniz.</p>
      <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.5rem;">
        <button id="btn-cookie-accept" style="background: #10b981; color: white; border: none; padding: 0.7rem 1.8rem; border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'">Kabul Et</button>
      </div>
    `;
    
    document.body.appendChild(banner);
    
    setTimeout(() => {
      banner.style.transform = 'translateY(0)';
      banner.style.opacity = '1';
    }, 500);
    
    document.getElementById('btn-cookie-accept').addEventListener('click', () => {
      localStorage.setItem('bayyildiz_cookie_consent', 'true');
      banner.style.transform = 'translateY(150px)';
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 500);
    });
  },

  initTypewriterPlaceholder() {
    const input1 = document.getElementById('global-search-input');
    const input2 = document.getElementById('mobile-search-input-field');
    
    if (!input1 && !input2) return;

    const texts = [
      "Ürün, kategori veya marka ara...",
      "Hakiki deri ayakkabı ara...",
      "Günlük spor ayakkabı ara...",
      "Yeni sezon bot ara...",
      "Klasik erkek ayakkabı ara..."
    ];
    
    let textIndex = 0;
    let charIndex = 0;
    let isDeleting = false;
    let typeSpeed = 100;
    
    const type = () => {
      // Focuslanmışsa animasyonu durdur, standart metni göster
      if ((input1 && document.activeElement === input1) || (input2 && document.activeElement === input2)) {
        if (input1) input1.setAttribute('placeholder', 'Ne aramıştınız?');
        if (input2) input2.setAttribute('placeholder', 'Ne aramıştınız?');
        setTimeout(type, 500);
        return;
      }

      const currentText = texts[textIndex];
      
      if (isDeleting) {
        charIndex--;
        typeSpeed = 30; 
      } else {
        charIndex++;
        typeSpeed = 70; 
      }
      
      const displayText = currentText.substring(0, charIndex);
      
      if (input1) input1.setAttribute('placeholder', displayText + (isDeleting ? "" : "|"));
      if (input2) input2.setAttribute('placeholder', displayText + (isDeleting ? "" : "|"));
      
      if (!isDeleting && charIndex === currentText.length) {
        typeSpeed = 2000; 
        isDeleting = true;
      } else if (isDeleting && charIndex === 0) {
        isDeleting = false;
        textIndex = (textIndex + 1) % texts.length;
        typeSpeed = 400; 
      }
      
      setTimeout(type, typeSpeed);
    };
    
    type();
  },
  
  bindEvents() {

    // WhatsApp Guest Interceptor
    document.addEventListener('click', async (e) => {
      const link = e.target.closest('a[href^="https://wa.me/"]');
      if (!link || link.classList.contains("no-intercept")) return;
      
      e.preventDefault();
      
      const href = link.getAttribute('href');
      const url = new URL(href);
      const textParam = url.searchParams.get('text') || '';
      
      let prefill = null;
      if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser && !firebase.auth().currentUser.isAnonymous) {
          const user = firebase.auth().currentUser;
          prefill = { name: user.displayName || '', phone: '', email: user.email };
          let dbPath = (window.App && window.App.DATA_PATH ? window.App.DATA_PATH : '_bayyildiz_secure_v1_A9xK2mP8') + '/customers/' + user.uid;
          try {
              const snap = await firebase.database().ref(dbPath).once('value');
              if (snap.exists() && (snap.val().name || snap.val().isimSoyisim || snap.val().adSoyad || snap.val().phone || snap.val().telefon)) {
                  const data = snap.val();
                  prefill.name = data.name || data.isimSoyisim || data.adSoyad || prefill.name;
                  prefill.phone = data.phone || data.telefon || '';
              } else if (user.email) {
                  const baseCustomersPath = (window.App && window.App.DATA_PATH ? window.App.DATA_PATH : '_bayyildiz_secure_v1_A9xK2mP8') + '/customers';
                  const querySnap = await firebase.database().ref(baseCustomersPath).orderByChild('email').equalTo(user.email).once('value');
                  if (querySnap.exists()) {
                      const results = querySnap.val();
                      const firstKey = Object.keys(results)[0];
                      const data = results[firstKey];
                      prefill.name = data.name || data.isimSoyisim || data.adSoyad || data["ad soyad"] || data.ad_soyad || data.displayName || data.kullaniciAdi || prefill.name;
                      prefill.phone = data.phone || data.telefon || '';
                  }
              }
          } catch (err) {}
      }
      
      if (window.App && typeof window.App.openWhatsAppModal === 'function') {
         const overlay = document.getElementById('wa-guest-modal');
         if (overlay) {
            overlay.dataset.baseUrl = href.split('?')[0];
            overlay.dataset.existingText = textParam;
            overlay.dataset.cartText = '';
         }
         window.App.openWhatsAppModal(null, prefill);
      } else {
         window.open(href, '_blank');
      }

// cleaned up duplicate logic
    });


    // Yukarı Çık Butonu Oluşturma
    const scrollTopBtn = document.createElement('button');
    scrollTopBtn.className = 'scroll-to-top';
    scrollTopBtn.setAttribute('aria-label', 'Yukarı Çık');
    scrollTopBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>';
    document.body.appendChild(scrollTopBtn);

    window.addEventListener('scroll', () => {
      if (window.scrollY > 400) {
        scrollTopBtn.classList.add('show');
      } else {
        scrollTopBtn.classList.remove('show');
      }
    });

    scrollTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });


    // MEGA SEARCH LOGIC
    const megaSearchInput = document.getElementById("global-search-input");
    const megaSearch = document.getElementById('mega-search-dropdown');
    const searchGrid = document.getElementById('search-results-grid');
    const searchTitle = document.getElementById('search-results-title');
    const mobileSearchToggle = document.getElementById('mobile-search-toggle');
    const mobileSearchBar = document.getElementById('mobile-search-bar');
    const mobileSearchInput = document.getElementById('mobile-search-input-field');

    if (mobileSearchToggle && mobileSearchBar) {
      mobileSearchToggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isVisible = mobileSearchBar.style.display === 'block';
        if (isVisible) {
          // Kapat
          mobileSearchBar.style.display = 'none';
          if (megaSearch) megaSearch.classList.remove('active');
        } else {
          // Aç
          mobileSearchBar.style.display = 'block';
          if (mobileSearchInput) mobileSearchInput.focus();
        }
      });
    }

    const renderMegaSearchResults = (query) => {
      if (!searchGrid) return;
      
      let results = [];
      if (!query || query.length < 2) {
        // Show random or first 4 products when empty
        searchTitle.textContent = "Öne Çıkanlar";
        results = App.products.slice(0, 4);
      } else {
        searchTitle.textContent = 'Sonuçlar ("' + query + '")';
        results = App.products.filter(p => 
          (p.model || "").toLowerCase().includes(query) || 
          p.category.toLowerCase().includes(query) || 
          p.brand.toLowerCase().includes(query)
        ).slice(0, 4);
      }

      if (results.length === 0) {
        searchGrid.innerHTML = '<p style="color:var(--text-light); font-size:0.9rem; grid-column:1/-1;">Sonuç bulunamadı.</p>';
        return;
      }

      searchGrid.innerHTML = results.map(p => `
        <a href="urun-detay.html?id=${p.id}" class="search-result-card">
          <img src="${p.image}" alt="${p.model}" >
          <div class="search-card-info">
            <h5 class="search-card-title">${p.model} ${p.color ? "- " + p.color : ""}</h5>
            <div class="search-card-price">${p.price.toLocaleString('tr-TR')} ₺</div>
          </div>
        </a>
      `).join('');
    };

    if (megaSearchInput && megaSearch) {
      // Open on focus
      megaSearchInput.addEventListener('focus', () => {
        megaSearch.classList.add('active');
        if (App.products.length > 0) {
          renderMegaSearchResults(megaSearchInput.value.trim().toLowerCase());
        } else {
          // If products aren't loaded yet, try after a delay
          setTimeout(() => renderMegaSearchResults(megaSearchInput.value.trim().toLowerCase()), 1000);
        }
      });

      // Filter on type
      megaSearchInput.addEventListener('input', (e) => {
        renderMegaSearchResults(e.target.value.trim().toLowerCase());
      });
      
      // Close when clicking outside
      document.addEventListener('click', (e) => {
        if (!megaSearchInput.contains(e.target) && !megaSearch.contains(e.target) && (!mobileSearchInput || !mobileSearchInput.contains(e.target)) && !e.target.closest(".mobile-search-toggle") && !e.target.closest(".mobile-search-bar")) {
          megaSearch.classList.remove('active');
        }
      });
      
      // Enter key to go to search page
      megaSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
           const q = e.target.value.trim();
           if (q) window.location.href = 'urunler.html?q=' + encodeURIComponent(q);
        }
      });
    }
    
    if (mobileSearchInput) {
      
      // Mobile Mega Search Trigger
      if (mobileSearchInput) {
        mobileSearchInput.addEventListener('focus', () => {
          megaSearch.classList.add('active');
          if (App.products.length > 0) {
            renderMegaSearchResults(mobileSearchInput.value.trim().toLowerCase());
          }
        });
        mobileSearchInput.addEventListener('input', (e) => {
          renderMegaSearchResults(e.target.value.trim().toLowerCase());
        });
      }
      mobileSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
           const q = e.target.value.trim();
           if (q) window.location.href = 'urunler.html?q=' + encodeURIComponent(q);
        }
      });
    }

    // Navbar Scroll
    window.addEventListener('scroll', () => {
      const nav = document.getElementById('site-header');
      if (window.scrollY > 50) nav.classList.add('scrolled');
      else nav.classList.remove('scrolled');
    });

    // Active Nav Link Logic
    const path = window.location.pathname;
    const page = path.split('/').pop() || 'index.html';
    const params = new URLSearchParams(window.location.search);
    const cat = params.get('category');
    const season = params.get('season');
    
    document.querySelectorAll('.navbar-link').forEach(link => {
      link.classList.remove('active');
      
      if (cat) {
        if (link.dataset.category === cat) link.classList.add('active');
      } else if (season) {
        if (link.dataset.season === season) link.classList.add('active');
      } else {
        if (link.dataset.page === page || (page === '' && link.dataset.page === 'index.html')) {
          link.classList.add('active');
        }
      }
      // Ürün detay sayfasında "Tüm Koleksiyon" linkini aktif yap
      if (page === 'urun-detay.html' && link.dataset.page === 'urunler.html' && !cat && !season) {
        link.classList.add('active');
      }
    });

    
    // Slider Logic
    const slides = document.querySelectorAll('.slide');
    if (slides.length > 0) {
      let currentSlide = 0;
      const dotsContainer = document.getElementById('slider-dots');
      let slideInterval;
      
      // Create dots
      slides.forEach((_, i) => {
        const dot = document.createElement('div');
        dot.className = `slider-dot ${i === 0 ? 'active' : ''}`;
        dot.addEventListener('click', () => {
          goToSlide(i);
          resetInterval();
        });
        dotsContainer.appendChild(dot);
      });
      const dots = document.querySelectorAll('.slider-dot');

      const goToSlide = (n) => {
        slides[currentSlide].classList.remove('active');
        dots[currentSlide].classList.remove('active');
        currentSlide = (n + slides.length) % slides.length;
        slides[currentSlide].classList.add('active');
        dots[currentSlide].classList.add('active');
      };

      const nextSlide = () => goToSlide(currentSlide + 1);
      const prevSlide = () => goToSlide(currentSlide - 1);

      document.getElementById('slider-next').addEventListener('click', () => { nextSlide(); resetInterval(); });
      document.getElementById('slider-prev').addEventListener('click', () => { prevSlide(); resetInterval(); });

      // Auto play
      const startInterval = () => { slideInterval = setInterval(nextSlide, 4000); };
      const resetInterval = () => { clearInterval(slideInterval); startInterval(); };
      startInterval();
    }

    // Mobile Menu Toggle
    
      // Mobile Dropdown Toggle (Fix for touch devices)
      const dropdownLinks = document.querySelectorAll('.nav-dropdown > .navbar-link');
      dropdownLinks.forEach(link => {
        link.addEventListener('click', (e) => {
          if (window.innerWidth <= 768) {
            e.preventDefault();
            e.stopPropagation();
            const parent = link.parentElement;
            parent.classList.toggle('touch-active');
            
            // Close other dropdowns
            document.querySelectorAll('.nav-dropdown').forEach(d => {
              if (d !== parent) d.classList.remove('touch-active');
            });
          }
        });
      });

      // Close dropdown when clicking sub-links inside dropdown (mobile)
      document.querySelectorAll('.dropdown-content a').forEach(subLink => {
        subLink.addEventListener('click', () => {
          if (window.innerWidth <= 768) {
            document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('touch-active'));
            // Also close the mobile menu
            const toggleEl = document.getElementById('navbar-toggle');
            const menuEl = document.getElementById('navbar-menu');
            if (toggleEl && menuEl) {
              toggleEl.classList.remove('active');
              toggleEl.setAttribute('aria-expanded', 'false');
              menuEl.classList.remove('active');
            }
          }
        });
      });

      // Close dropdown when clicking other (non-dropdown) nav links (mobile)
      document.querySelectorAll('.navbar-menu > .navbar-link').forEach(navLink => {
        navLink.addEventListener('click', () => {
          if (window.innerWidth <= 768) {
            document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('touch-active'));
          }
        });
      });

      // Close dropdown and mobile menu when clicking outside (mobile)
      document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
          const navbar = document.getElementById('site-header');
          if (navbar && !navbar.contains(e.target)) {
            document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('touch-active'));
            const toggleEl = document.getElementById('navbar-toggle');
            const menuEl = document.getElementById('navbar-menu');
            if (toggleEl && menuEl && menuEl.classList.contains('active')) {
              toggleEl.classList.remove('active');
              toggleEl.setAttribute('aria-expanded', 'false');
              menuEl.classList.remove('active');
            }
          }
        }
      });
      
      const toggle = document.getElementById('navbar-toggle');
    const menu = document.getElementById('navbar-menu');
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('active');
    toggle.setAttribute('aria-expanded', toggle.classList.contains('active'));
      menu.classList.toggle('active');
      // Close any open dropdowns when closing the menu
      if (!menu.classList.contains('active')) {
        document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('touch-active'));
      }
    });

    // Filters (Only bind if on products page)
    const searchInput = document.getElementById('product-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filters.query = e.target.value.toLowerCase().trim();
        this.currentPage = 1;
        this.renderProducts();
    this.checkIyzicoCallback();
      });
      
      ['category', 'gender', 'season', 'brand', 'color', 'sort'].forEach(filter => {
        const el = document.getElementById(`filter-${filter}`);
        if (el) {
          el.addEventListener('change', (e) => {
            this.filters[filter] = e.target.value;
            this.currentPage = 1;
            this.renderProducts();
          });
        }
      });
      
      const stockToggle = document.getElementById('filter-stock-only');
      if (stockToggle) {
        stockToggle.addEventListener('change', (e) => {
          this.filters.stockOnly = e.target.checked;
          this.currentPage = 1;
          this.renderProducts();
        });
      }

      // Clear filters
      const oldClearBtn = document.getElementById('btn-clear-filters'); if (oldClearBtn) oldClearBtn.addEventListener('click', () => {
        document.getElementById('product-search').value = '';
        this.filters.query = '';
        ['category', 'gender', 'season', 'brand', 'color', 'sort'].forEach(f => {
          const el = document.getElementById(`filter-${f}`);
          if (el) el.value = f === 'sort' ? 'newest' : 'all';
          this.filters[f] = f === 'sort' ? 'newest' : 'all';
        });
        if (stockToggle) {
          stockToggle.checked = false;
          this.filters.stockOnly = false;
        }
        this.currentPage = 1;
        this.renderProducts();
      });

      // Load More
      document.getElementById('btn-load-more').addEventListener('click', () => {
        this.currentPage++;
        this.renderProductsGrid(true); // append
      });
    }

    // Modal Close
    const modal = document.getElementById('product-modal');
    if (modal) {
      document.getElementById('modal-close').addEventListener('click', () => {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.add('hidden');
          document.body.style.overflow = '';
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
          modal.classList.add('hidden');
          document.body.style.overflow = '';
        }
      });
    }

    // Footer Links Filtering
    document.querySelectorAll('[data-filter-category]').forEach(link => {
      link.addEventListener('click', (e) => {
        const cat = link.dataset.filterCategory;
        const catEl = document.getElementById('filter-category'); if (catEl) catEl.value = cat;
        this.filters.category = cat;
        this.currentPage = 1;
        this.renderProducts();
      });
    });
  },
  
  // Müşteri Haberdar Ol Formu (Stok Takip Entegrasyonu)
  bindNotifyForm() {
    const notifyForm = document.getElementById('notify-form');
    if (notifyForm) {
      notifyForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('notify-name').value;
        const phone = document.getElementById('notify-phone').value;
        const submitBtn = document.getElementById('notify-submit');
        const msgDiv = document.getElementById('notify-message');
        
        const kvkkCheckbox = document.getElementById('notify-kvkk');
        if (kvkkCheckbox && !kvkkCheckbox.checked) {
            msgDiv.textContent = 'Lütfen KVKK Aydınlatma Metnini onaylayın.';
            msgDiv.style.display = 'block';
            msgDiv.style.padding = '10px';
            msgDiv.style.backgroundColor = 'var(--danger, #e74c3c)';
            msgDiv.style.color = '#fff';
            msgDiv.style.borderRadius = '5px';
            msgDiv.style.marginTop = '10px';
            return;
        }

        if (!this.db) {
           msgDiv.textContent = 'Bağlantı bekleniyor, lütfen biraz bekleyip tekrar deneyin.';
           msgDiv.style.display = 'block';
           msgDiv.style.backgroundColor = 'var(--danger, #e74c3c)';
           msgDiv.style.color = '#fff';
           return;
        }
        
        submitBtn.disabled = true;
        submitBtn.textContent = 'Kaydediliyor...';
        
        // Stok takip veritabanı müşteri kayıt defteri ("musteriler") node'una ekleme
        const newCustomerRef = this.db.ref(this.DATA_PATH + '/customers').push();
        newCustomerRef.set({
          name: name,
          phone: phone,
          createdAt: new Date().toISOString(),
          status: 'new',
          source: 'web'
        }).then(() => {
          msgDiv.innerHTML = '<div style="display:flex;align-items:center;gap:10px;font-size:0.95rem;justify-content:center;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> <span>Bilgileriniz başarıyla kaydedildi. İletişimde kalacağız!</span></div>';
          msgDiv.style.display = 'block';
          msgDiv.style.padding = '12px 18px';
          msgDiv.style.borderRadius = '8px';
          msgDiv.style.background = 'linear-gradient(135deg, rgba(46, 204, 113, 0.15), rgba(39, 174, 96, 0.25))';
          msgDiv.style.border = '1px solid rgba(46, 204, 113, 0.4)';
          msgDiv.style.color = '#10b981'; // Softer green text
          msgDiv.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
          msgDiv.style.marginTop = '15px';
          msgDiv.style.fontWeight = '500';
          notifyForm.reset();
        }).catch((error) => {
          console.error('Kayıt hatası:', error);
          msgDiv.innerHTML = '<div style="display:flex;align-items:center;gap:10px;font-size:0.95rem;justify-content:center;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> <span>Bir hata oluştu. Lütfen daha sonra tekrar deneyin.</span></div>';
          msgDiv.style.display = 'block';
          msgDiv.style.padding = '12px 18px';
          msgDiv.style.borderRadius = '8px';
          msgDiv.style.background = 'linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(220, 38, 38, 0.25))';
          msgDiv.style.border = '1px solid rgba(239, 68, 68, 0.4)';
          msgDiv.style.color = '#ef4444'; 
          msgDiv.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
          msgDiv.style.marginTop = '15px';
          msgDiv.style.fontWeight = '500';
        }).finally(() => {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Kayıt Ol';
        });
      });
    }
  },

  async initFirebase() {
    try {
      firebase.initializeApp(this.firebaseConfig);
      const auth = firebase.auth();
      
      // Anonim giriş artık kullanılmıyor: ürün/stok/şube/ayar/yorum verileri herkese açık
      // okunabildiği için ziyaretçiye hesap açmaya gerek yok. Sadece varsa önceki
      // oturumun geri yüklenmesini bekliyoruz.
      await new Promise((resolve) => {
          const unsubscribe = auth.onAuthStateChanged((user) => {
              unsubscribe(); 
              if (!user) {
                  firebase.auth().signInAnonymously().then(() => resolve()).catch(e => { console.error(e); resolve(); });
              } else {
                  resolve();
              }
          });
      });
      
      this.db = firebase.database();
      this.startListening();
      
    } catch (error) {
      console.error("Firebase Hatası:", error);
      document.getElementById('page-loader').innerHTML = `
        <div class="loader-content" style="color:var(--danger)">
          <h3>Bağlantı Hatası</h3>
          <p>Lütfen sayfayı yenileyin.</p>
        </div>
      `;
    }
  },
  
  startListening() {
    const paths = ['products', 'stock', 'branches', 'settings', 'reviews'];
    const data = {};
    const loadedPaths = new Set();
    
    paths.forEach(path => {
      this.db.ref(`${this.DATA_PATH}/${path}`).on('value', (snapshot) => {
        data[path] = snapshot.val();
        loadedPaths.add(path);
        
        if (loadedPaths.size === paths.length) {
          this.processData(data);
          
          const loader = document.getElementById('page-loader');
          if (loader && !loader.classList.contains('fade-out')) {
            loader.classList.add('fade-out');
            setTimeout(() => loader.remove(), 500);
          }
        }
      });
    });
  },
  
  processData(data) {
    // Sadece silinmemiş ürünleri al
    this.products = (data.products || []).filter(p => p && !p.deletedAt && p.id);
    this.stockData = data.stock || {};
    this.branches = data.branches || [];
    this.settings = data.settings || {};
    this.reviews = data.reviews || {};
    
    // Header stat (Sadece index sayfasında varsa)
    const statEl = document.getElementById('stat-product-count');
    if (statEl) {
      statEl.textContent = this.products.length + '+';
    }
    

    this.updateDynamicCategoryImages();

    // Sadece ürünler sayfasındaysak
    if (document.getElementById('products-grid')) {
      const urlParams = new URLSearchParams(window.location.search);
      ['gender', 'season', 'category'].forEach(key => {
        if (urlParams.get(key)) {
          this.filters[key] = urlParams.get(key);
        }
      });
      this.populateFilters();
        if (urlParams.get('category')) {
          document.querySelectorAll('#sidebar-categories input').forEach(cb => {
            if (cb.value === urlParams.get('category')) cb.checked = true;
          });
        }
        if (urlParams.get('season')) {
          document.querySelectorAll('#sidebar-seasons input, .filter-cb-season').forEach(cb => {
            if (cb.value === urlParams.get('season')) cb.checked = true;
          });
        }
      // Select elementlerini simdi güncelle
      ['gender', 'season', 'category'].forEach(key => {
        if (this.filters[key] !== 'all') {
          const el = document.getElementById(`filter-${key}`);
          if (el) el.value = this.filters[key];
        }
      });
      this.renderProducts();
    }
    
    // Sadece ana sayfadaysak (Öne Çıkanlar Vitrini)
    if (document.getElementById('featured-products')) {
      this.renderFeaturedProducts();
    }

    // Ürün detay sayfasındaysak
    if (document.getElementById('product-detail-container')) {
      this.renderProductDetail();
    }
    
    // Hesabım (Dashboard) sayfasındaysak
    this.buildDynamicMegaMenus();
    if (document.getElementById('history-grid')) {
      this.renderDashboard();
    }

  },
  
      
    openSizeRecommender() {

      let modal = document.getElementById('size-recommender-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'size-recommender-modal';
        modal.className = 'modal-backdrop';
        modal.innerHTML = `
          <div class="modal-content" style="max-width: 400px; text-align: center;">
            <h3 style="margin-bottom: 1rem; color: var(--text-dark);">Ayak Numaranızı Bulun</h3>
            <p style="font-size: 0.9rem; color: var(--text-main); margin-bottom: 1.5rem;">Topuktan en uzun parmağınıza kadar olan uzunluğu cm cinsinden girin.</p>
            <input type="number" id="foot-length-input" placeholder="Örn: 27.5" step="0.1" class="form-input" style="width: 100%; text-align: center; font-size: 1.2rem; padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 1rem;">
            <button class="btn btn-primary" onclick="App.calculateSize()" style="width: 100%; padding: 0.75rem; border-radius: 8px;">Hesapla</button>
            
            <div id="size-result" style="display: none; margin-top: 1.5rem; padding: 1rem; background: var(--bg-main); border-radius: 8px; border-left: 4px solid var(--primary);">
              <p style="font-size: 0.9rem; color: var(--text-main); margin-bottom: 0.25rem;">Önerilen Numara:</p>
              <div id="size-result-value" style="font-size: 2.5rem; font-weight: 800; color: var(--primary);">42</div>
              <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.5rem;">* Tahmini hesaplamadır. Kalıp farklılıkları gösterebilir.</p>
            </div>
            
            <button class="btn btn-outline" style="width: 100%; margin-top: 1rem; border: none; color: var(--text-light);" onclick="document.getElementById('size-recommender-modal').style.display = 'none';">Kapat</button>
          </div>
        `;
        document.body.appendChild(modal);
        // Kapatma eventi (disari tiklama)
        modal.addEventListener('click', (e) => { if(e.target === modal) modal.style.display = 'none'; });
      }

      document.getElementById('foot-length-input').value = '';
      document.getElementById('size-result').style.display = 'none';
      modal.style.display = 'flex';
    },
    
    calculateSize() {
      const cm = parseFloat(document.getElementById('foot-length-input').value);
      if (!cm || cm < 15 || cm > 35) {
        this.toast('L�tfen ge�erli bir ayak uzunlu�u girin (�Örn: 27.5)', 'warning');
        return;
      }
      let size = Math.round(cm * 1.5 + 2);
      document.getElementById('size-result-value').textContent = size;
      document.getElementById('size-result').style.display = 'block';
    },

    openStockAlertModal(productId, size) {

      let modal = document.getElementById('stock-alert-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'stock-alert-modal';
        modal.className = 'modal-backdrop';
        modal.innerHTML = `
          <div class="modal-content" style="max-width: 400px;">
            <h3 style="margin-bottom: 1rem; color: var(--text-dark); text-align: center;">Gelince Haber Ver</h3>
            <p style="font-size: 0.9rem; color: var(--text-main); margin-bottom: 1.5rem; text-align: center;">Bu ürün stoklara girdiğinde size anında haber vereceğiz.</p>
            <input type="tel" id="stock-alert-phone" value="05" maxlength="11" class="form-input" placeholder="Cep Telefonunuz (Örn: 0555 555 5555)" style="width: 100%; font-size: 1rem; padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 1rem;">
            <input type="hidden" id="stock-alert-pid">
            <input type="hidden" id="stock-alert-size">
            <button class="btn btn-primary" onclick="App.saveStockAlert()" style="width: 100%; padding: 0.75rem; border-radius: 8px;">Kaydet</button>
            <button class="btn btn-outline" style="width: 100%; margin-top: 0.5rem; border: none; color: var(--text-light);" onclick="document.getElementById('stock-alert-modal').style.display = 'none';">İptal</button>
          </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if(e.target === modal) modal.style.display = 'none'; });
      }

      document.getElementById('stock-alert-pid').value = productId;
      document.getElementById('stock-alert-size').value = size || '';
      document.getElementById('stock-alert-phone').value = '05';
      modal.style.display = 'flex';
    },
    
    saveStockAlert() {
      const phone = document.getElementById('stock-alert-phone').value;
      const pid = document.getElementById('stock-alert-pid').value;
      const size = document.getElementById('stock-alert-size').value;
      
      if(phone.length < 10) {
        this.toast('L�tfen ge�erli bir telefon numaras� girin', 'warning');
        return;
      }
      
      if (!this.db) {
         this.toast('Ba�lant� hatas�, tekrar deneyin', 'error');
         return;
      }
      
      const newRef = this.db.ref(this.DATA_PATH + '/stock_alerts').push();
      newRef.set({
        productId: pid,
        size: size,
        phone: phone,
        createdAt: new Date().toISOString(),
        status: 'pending'
      }).then(() => {
        this.toast('Ba�ar�yla kaydedildi. Stok geldi�inde haber verece�iz!', 'success');
        document.getElementById('stock-alert-modal').style.display = 'none';
      }).catch(err => {
        this.toast('Bir hata olu�tu.', 'error');
      });
    },

    buildDynamicMegaMenus() {
      if (window.innerWidth <= 900) return; // Sadece masa�st�
      
      const navLinks = document.querySelectorAll('.header-nav-list .navbar-link');
      
      navLinks.forEach(link => {
        const li = link.parentElement;
        if (li.querySelector('.cat-mega-dropdown')) return; // Zaten varsa ge�
        
        let targetProduct = null;
        let btnText = "Ürünü İncele";
        let labelText = "Öne Çıkan";
        
        if (link.dataset.category) {
          const prods = this.products.filter(p => p.category === link.dataset.category);
          if (prods.length > 0) targetProduct = prods[Math.floor(Math.random() * prods.length)]; // Rastgele se�
        } else if (link.dataset.season) {
          const prods = this.products.filter(p => p.season === link.dataset.season);
          if (prods.length > 0) targetProduct = prods[Math.floor(Math.random() * prods.length)];
          labelText = "Yeni Sezon";
        } else if (link.dataset.page === 'urunler.html') {
          // T�m Koleksiyon
          if (this.products.length > 0) targetProduct = this.products[Math.floor(Math.random() * this.products.length)];
          btnText = "Koleksiyonu Keşfet";
          labelText = "Rastgele";
        }
        
        if (targetProduct) {
          const imgSrc = targetProduct.image || 'img/logo.webp?v=2';
          const price = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(targetProduct.price || 0);
          const name = `${targetProduct.model} ${targetProduct.color ? '- ' + targetProduct.color : ''}`;
          
          const dropdown = document.createElement('div');
          dropdown.className = 'cat-mega-dropdown';
          dropdown.innerHTML = `
            <div class="cat-mega-dropdown-label">${labelText}</div>
            <img src="${imgSrc}" class="cat-mega-img" alt="${name}" >
            <div class="cat-mega-info">
              <div class="cat-mega-title">${name}</div>
              <div class="cat-mega-price">${price}</div>
              <a href="urun-detay.html?id=${targetProduct.id}" class="cat-mega-btn">${btnText} <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 5px;"><path d="M5 12h14M12 5l7 7-7 7"/></svg></a>
            </div>
          `;
          li.appendChild(dropdown);
        }
      });
    },

    
  
  getProductTotalStock(productId) {
    const pStock = this.stockData[productId] || {};
    let total = 0;
    Object.values(pStock).forEach(branchStock => {
      Object.values(branchStock).forEach(qty => {
        total += parseInt(qty || 0);
      });
    });
    return total;
  },

  populateFilters() {
    const categories = new Set();
    const brands = new Set();
    const colors = new Set();
    const sizes = new Set();
    
    this.products.forEach(p => {
      if (p.category) categories.add(p.category);
      if (p.brand) brands.add(p.brand);
      if (p.color) colors.add(p.color);
      
      const pStock = this.stockData[p.id] || {};
      this.branches.forEach(b => {
        const bStock = pStock[b.id] || {};
        Object.keys(bStock).forEach(size => {
          sizes.add(size);
        });
      });
    });
    
    const renderCheckboxes = (setId, dataSet) => {
      const container = document.getElementById(setId);
      if (!container) return;
      container.innerHTML = Array.from(dataSet).sort().map(item => `
        <label><input type="checkbox" value="${item}" onchange="App.renderProducts()"> ${item}</label>
      `).join('');
    };

    renderCheckboxes('sidebar-categories', categories);
    renderCheckboxes('sidebar-brands', brands);
    renderCheckboxes('sidebar-colors', colors);

    const sizesContainer = document.getElementById('sidebar-sizes');
    if (sizesContainer) {
      const sortedSizes = Array.from(sizes).sort((a, b) => parseFloat(a) - parseFloat(b));
      sizesContainer.innerHTML = sortedSizes.map(s => `
        <div class="size-filter-btn" onclick="this.classList.toggle('selected'); App.renderProducts();">${s}</div>
      `).join('');
    }

    const searchEl = document.getElementById('product-search');
    if (searchEl) {
      searchEl.oninput = () => this.renderProducts();
    }
    
    const stockEl = document.getElementById('filter-stock-only');
    if (stockEl) stockEl.onchange = () => this.renderProducts();
    
    const genderEls = document.querySelectorAll('.filter-cb-gender');
    genderEls.forEach(el => el.onchange = () => this.renderProducts());
    
    const clearBtn = document.getElementById('btn-clear-sidebar-filters');
    if (clearBtn) clearBtn.onclick = () => {
      document.querySelectorAll('#products-sidebar input[type="checkbox"]').forEach(cb => cb.checked = false);
      document.querySelectorAll('.size-filter-btn').forEach(btn => btn.classList.remove('selected'));
      const minP = document.getElementById('filter-min-price'); if (minP) minP.value = '';
      const maxP = document.getElementById('filter-max-price'); if (maxP) maxP.value = '';
      const sBox = document.getElementById('product-search'); if (sBox) sBox.value = '';
        this.filters = { category: 'all', gender: 'all', season: 'all' };
      this.renderProducts();
    };

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('gender')) {
      document.querySelectorAll('.filter-cb-gender').forEach(cb => {
        if (cb.value === urlParams.get('gender')) cb.checked = true;
      });
    }
    if (urlParams.get('category')) {
      document.querySelectorAll('#sidebar-categories input').forEach(cb => {
        if (cb.value === urlParams.get('category')) cb.checked = true;
      });
    }
  },

  applyFilters() {
    let result = this.products;
    
    const sizeEls = document.querySelectorAll('.size-filter-btn.selected');
    const selectedSizes = Array.from(sizeEls).map(el => el.textContent.trim());
    
    const colorEls = document.querySelectorAll('#sidebar-colors input:checked');
    const selectedColors = Array.from(colorEls).map(el => el.value);

    const catEls = document.querySelectorAll('#sidebar-categories input:checked');
    const selectedCats = Array.from(catEls).map(el => el.value);

    const brandEls = document.querySelectorAll('#sidebar-brands input:checked');
    const selectedBrands = Array.from(brandEls).map(el => el.value);
    
    const genderEls = document.querySelectorAll('#sidebar-genders input:checked');
    const selectedGenders = Array.from(genderEls).map(el => el.value);

    const minP = document.getElementById('filter-min-price') ? parseFloat(document.getElementById('filter-min-price').value) : null;
    const maxP = document.getElementById('filter-max-price') ? parseFloat(document.getElementById('filter-max-price').value) : null;
    
    const stockEl = document.getElementById('filter-stock-only');
    const stockOnly = stockEl ? stockEl.checked : false;

    const searchEl = document.getElementById('product-search');
    const query = searchEl ? searchEl.value.toLowerCase().trim() : '';

    if (query) {
      result = result.filter(p => {
        const searchStr = `${p.brand} ${p.model} ${p.color} ${p.barcode || ''}`.toLowerCase();
        return searchStr.includes(query);
      });
    }
    if (selectedCats.length === 0 && this.filters.category !== 'all') selectedCats.push(this.filters.category);
      if (selectedCats.length > 0) result = result.filter(p => selectedCats.includes(p.category));
    if (selectedGenders.length === 0 && this.filters.gender !== 'all') selectedGenders.push(this.filters.gender);
      if (selectedGenders.length > 0) result = result.filter(p => selectedGenders.includes(p.gender));
      if (this.filters.season !== 'all') result = result.filter(p => p.season === this.filters.season);
    if (selectedBrands.length > 0) result = result.filter(p => selectedBrands.includes(p.brand));
    if (selectedColors.length > 0) result = result.filter(p => selectedColors.includes(p.color));
    
    if (minP && !isNaN(minP)) result = result.filter(p => p.price >= minP);
    if (maxP && !isNaN(maxP)) result = result.filter(p => p.price <= maxP);
    
    if (stockOnly) {
      result = result.filter(p => this.getProductTotalStock(p.id) > 0);
    }

    if (selectedSizes.length > 0) {
      result = result.filter(p => {
        const pStock = this.stockData[p.id] || {};
        let hasSize = false;
        this.branches.forEach(b => {
          const bStock = pStock[b.id] || {};
          selectedSizes.forEach(s => {
            if (parseInt(bStock[s] || 0) > 0) hasSize = true;
          });
        });
        return hasSize;
      });
    }

    const sortEl = document.getElementById('filter-sort');
    const sortVal = sortEl ? sortEl.value : (document.getElementById('filter-sort-mobile') ? document.getElementById('filter-sort-mobile').value : 'best_sellers'); // Default to best sellers if possible
    result.sort((a, b) => {
      if (sortVal === 'best_sellers') return (b.salesCount || 0) - (a.salesCount || 0);
      if (sortVal === 'price_asc') return (a.price || 0) - (b.price || 0);
      if (sortVal === 'price_desc') return (b.price || 0) - (a.price || 0);
      if (sortVal === 'name_asc') {
        const nameA = `${a.brand} ${a.model}`.toLowerCase();
        const nameB = `${b.brand} ${b.model}`.toLowerCase();
        return nameA.localeCompare(nameB);
      }
      return b.id.localeCompare(a.id);
    });
    
    this.filteredProducts = result;
    this.currentPage = 1;
  },

  
  updateDynamicCategoryImages() {
    const erkekBg = document.getElementById('cat-bg-erkek');
    const yeniBg = document.getElementById('cat-bg-yeni');
    const popularBg = document.getElementById('cat-bg-popular');
    
    // Yardımcı fonksiyon: Seçili ürünlerden rastgele birinin resmini döndürür
    const getRandomImage = (productsArray) => {
      const withImages = productsArray.filter(p => p.image && p.image.length > 5);
      if (withImages.length === 0) return null;
      const randomIndex = Math.floor(Math.random() * withImages.length);
      return withImages[randomIndex].image;
    };

    if (erkekBg) {
      const img = getRandomImage(this.products.filter(p => p.gender === 'Erkek'));
      if (img) erkekBg.style.backgroundImage = `linear-gradient(to top, rgba(15,23,42,0.9) 0%, rgba(15,23,42,0.1) 100%), url('${img}')`;
    }
    
    if (yeniBg) {
      const img = getRandomImage(this.products.filter(p => p.season === 'Yeni'));
      if (img) yeniBg.style.backgroundImage = `linear-gradient(to top, rgba(15,23,42,0.9) 0%, rgba(15,23,42,0.1) 100%), url('${img}')`;
    }
    
    if (popularBg) {
      // Çok satanlar için tüm ürünlerden rastgele seç
      const img = getRandomImage(this.products);
      if (img) popularBg.style.backgroundImage = `linear-gradient(to top, rgba(15,23,42,0.9) 0%, rgba(15,23,42,0.1) 100%), url('${img}')`;
    }
  },

  renderProducts() {
    document.getElementById('products-loading').classList.add('hidden');
    this.applyFilters();
    
    const count = this.filteredProducts.length;
    document.getElementById('products-result-bar').innerHTML = 
      `<b>${count}</b> ürün bulundu`;
      
    if (count === 0) {
      document.getElementById('products-grid').classList.add('hidden');
      document.getElementById('products-load-more').classList.add('hidden');
      document.getElementById('products-empty').classList.remove('hidden');
      return;
    }
    
    document.getElementById('products-empty').classList.add('hidden');
    document.getElementById('products-grid').classList.remove('hidden');
    
    this.renderProductsGrid(false);
  },
  

  renderFeaturedProducts() {
    const grid = document.getElementById('featured-products');
    if (!grid) return;
    grid.innerHTML = '';
    
    // En çok satan (stokta olan) 8 ürün
    const availableProducts = this.products.filter(p => this.getProductTotalStock(p.id) > 0);
    availableProducts.sort((a, b) => (b.salesCount || 0) - (a.salesCount || 0));
    const featured = availableProducts.slice(0, 8);
    
    featured.forEach(p => {
      const stock = this.getProductTotalStock(p.id);
      
      let stockStatusHtml = '';
      if (stock > 2) {
        stockStatusHtml = `<div class="product-stock-status status-available" style="font-size: 0.7rem; padding: 0.3rem 0.6rem; background: rgba(16, 185, 129, 0.1); border-radius: 50px; margin-top: 0.5rem; display: inline-flex;"><div class="status-dot"></div> Stokta Mevcut</div>`;
      } else if (stock > 0) {
        stockStatusHtml = `<div class="product-stock-status status-low" style="font-size: 0.7rem; padding: 0.3rem 0.6rem; background: rgba(245, 158, 11, 0.1); border-radius: 50px; margin-top: 0.5rem; display: inline-flex;"><div class="status-dot"></div> Tükenmek Üzere</div>`;
      }
      
      const priceFormatted = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(p.price || 0);
      const imgSrc = p.image || 'img/logo.webp?v=2';
      const imgStyle = !p.image ? 'object-fit: contain; padding: 2rem; opacity: 0.5;' : '';
      
      const reviewStats = this.getReviewStats(p.id);
      let reviewHtml = '';
      if (reviewStats) {
        reviewHtml = `
          <div style="display: flex; align-items: center; gap: 4px; margin-top: 5px; margin-bottom: 5px; font-size: 0.8rem; color: var(--text-muted);">
            <div style="color: #fbbf24; display:flex; align-items:center;">${this.generateStars(reviewStats.avg)}</div>
            <span style="font-weight: 600; color: var(--text-main);">${reviewStats.avg}</span> 
            <span>(${reviewStats.count} Yorum)</span>
          </div>
        `;
      }
      
      const card = document.createElement('div');
      card.className = 'product-card';
      card.innerHTML = `
        <div class="product-img-wrapper">
          <img src="${imgSrc}" alt="${p.brand} ${p.model}" class="product-img" style="${imgStyle}" >
          <div class="product-badge-group">
            <span class="product-badge bg-primary">Popüler</span>
          </div>
          <button class="favorite-btn ${this.isFavorite(p.id) ? 'active' : ''}" onclick="event.stopPropagation(); const isFav = App.toggleFavorite('${p.id}'); this.classList.toggle('active', isFav);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
          </button>
        </div>
        <div class="product-info">
          <div class="product-brand">${p.brand || 'BAYYILDIZ'}</div>
          <h3 class="product-title">${p.model} ${p.color ? '- ' + p.color : ''}</h3>
          ${reviewHtml}
          <div class="product-price">${priceFormatted}
          <button class="btn btn-outline" style="width: 100%; margin-top: 0.75rem; padding: 0.4rem; font-size: 0.8rem; border-radius: 6px; font-weight: 600;" onclick="event.stopPropagation(); App.openProductModal('${p.id}')">Ürünü İncele</button>
        
          ${stockStatusHtml}
        </div>
      `;
      
      card.addEventListener('click', () => this.openProductModal(p.id));
      grid.appendChild(card);
    });
  },

  generateProductCardHTML(p) {
    const stock = this.getProductTotalStock(p.id);
    let stockStatusHtml = '';
    let demandBadge = '';
    
    // We will make the text smaller and add a pill shape
    if (stock > 2) {
      stockStatusHtml = `<div class="product-stock-status status-available" style="font-size: 0.7rem; padding: 0.3rem 0.6rem; background: rgba(16, 185, 129, 0.1); border-radius: 50px; margin-top: 0.5rem; display: inline-flex;"><div class="status-dot"></div> Stokta Mevcut</div>`;
    } else if (stock > 0) {
      stockStatusHtml = `<div class="product-stock-status status-low" style="font-size: 0.7rem; padding: 0.3rem 0.6rem; background: rgba(245, 158, 11, 0.1); border-radius: 50px; margin-top: 0.5rem; display: inline-flex;"><div class="status-dot"></div> Tükenmek Üzere</div>`;
      demandBadge = `<span class="product-badge bg-danger" style="background:#ef4444;">🔥 Son ${stock} Adet</span>`;
    } else {
      stockStatusHtml = `<div class="product-stock-status status-out" style="font-size: 0.7rem; padding: 0.3rem 0.6rem; background: rgba(239, 68, 68, 0.1); border-radius: 50px; margin-top: 0.5rem; display: inline-flex;"><div class="status-dot"></div> Tükendi</div>`;
    }

    const priceFormatted = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(p.price);
    const imgSrc = p.image || 'img/logo.webp?v=2';
    const imgStyle = !p.image ? 'object-fit: contain; padding: 2rem; opacity: 0.5;' : '';

    // Add a review mock if you like
    const reviewHtml = `
      <div class="product-rating">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
        <span style="font-size: 0.75rem; color: #64748b; margin-left: 0.25rem;">(4.9)</span>
      </div>`;

    // ADD BTN HTML
    const inspectBtnHtml = `<button class="btn btn-outline" style="width: 100%; margin-top: 0.75rem; padding: 0.4rem; font-size: 0.8rem; border-radius: 6px; font-weight: 600;" onclick="event.stopPropagation(); App.openProductModal('${p.id}')">Ürünü İncele</button>`;

    return `
      <div class="product-card" onclick="App.openProductModal('${p.id}')">
        <div class="product-img-wrapper">
          <img src="${imgSrc}" alt="${p.brand} ${p.model}" class="product-img" style="${imgStyle}" >
          ${demandBadge ? `<div class="product-badge-group">${demandBadge}</div>` : ''}
          <button class="favorite-btn ${this.isFavorite(p.id) ? 'active' : ''}" onclick="event.stopPropagation(); const isFav = App.toggleFavorite('${p.id}'); this.classList.toggle('active', isFav);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
          </button>
        </div>
        <div class="product-info">
          <div class="product-brand">${p.brand || 'BAYYILDIZ'}</div>
          <h3 class="product-title">${p.model} ${p.color ? '- ' + p.color : ''}</h3>
          ${reviewHtml}
          <div class="product-price">${priceFormatted}</div>
          <div style="display: flex; flex-direction: column; align-items: flex-start;">
            ${stockStatusHtml}
          </div>
          ${inspectBtnHtml}
        </div>
      </div>
    `;
  },

  recordHistory(productId) {
    let history = JSON.parse(localStorage.getItem('bayyildiz_history') || '[]');
    history = history.filter(id => id !== productId);
    history.unshift(productId);
    if (history.length > 20) history = history.slice(0, 20);
    localStorage.setItem('bayyildiz_history', JSON.stringify(history));
    if (typeof firebase !== 'undefined' && firebase.auth) {
        // FIX: dinleyici artık bir kere çalışıp kendini kaldırıyor (unsubscribe),
        // eskiden her ürün görüntülemede kalıcı ve birikimli bir dinleyici bırakılıyordu.
        const unsubscribe = firebase.auth().onAuthStateChanged(user => {
            unsubscribe();
            if (user && !user.isAnonymous && user.email !== 'sistem@bayyildiz-stoktakip.com') {
                const uid = window.App && window.App.userDbKey ? window.App.userDbKey : user.uid;
                const dbPath = (window.App && window.App.DATA_PATH ? window.App.DATA_PATH : '_bayyildiz_secure_v1_A9xK2mP8') + '/customers/' + uid + '/history';
                firebase.database().ref(dbPath).set(history).catch(e => console.error(e));
            }
        });
    }
  },

  renderDashboard() {
    const historyContainer = document.getElementById('history-grid');
    const favoritesContainer = document.getElementById('favorites-grid');
    if (!historyContainer && !favoritesContainer) return;

    if (historyContainer) {
      const history = JSON.parse(localStorage.getItem('bayyildiz_history') || '[]');
      const hProducts = history.map(id => this.products.find(p => p.id === id)).filter(Boolean);
      
      if (hProducts.length === 0) {
        document.getElementById('history-empty').style.display = 'block';
        historyContainer.innerHTML = '';
      } else {
        document.getElementById('history-empty').style.display = 'none';
        historyContainer.innerHTML = hProducts.map(p => this.generateProductCardHTML(p)).join('');
      }
    }

    if (favoritesContainer) {
      const fProducts = this.favorites.map(id => this.products.find(p => p.id === id)).filter(Boolean);
      
      if (fProducts.length === 0) {
        document.getElementById('favorites-empty').style.display = 'block';
        favoritesContainer.innerHTML = '';
      } else {
        document.getElementById('favorites-empty').style.display = 'none';
        favoritesContainer.innerHTML = fProducts.map(p => this.generateProductCardHTML(p)).join('');
      }
    }
  },

  renderProductDetail() {
    const container = document.getElementById('product-detail-container');
    if (!container) return;
    
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');
    
    if (!productId) {
      window.location.href = 'urunler.html';
      return;
    }
    
    this.recordHistory(productId);
    
    const p = this.products.find(x => x.id === productId);
    if (!p) {
      container.innerHTML = `
        <div style="text-align: center; padding: 4rem 0;">
          <h2>Ürün Bulunamadı</h2>
          <p style="color: var(--text-muted); margin: 1rem 0 2rem;">Aradığınız ürün mevcut değil veya kaldırılmış olabilir.</p>
          <a href="urunler.html" class="btn btn-primary">Ürünlere Dön</a>
        </div>
      `;
      return;
    }
    
    // Sayfa başlığını güncelle
    document.title = `${p.brand} ${p.model} | BAYYILDIZ Ayakkabı`;
    
    const priceFormatted = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(p.price || 0);
    const imgSrc = p.image || 'img/logo.webp?v=2';
    const imgStyle = !p.image ? 'object-fit: contain; padding: 2rem; opacity: 0.5;' : '';
    const totalStock = this.getProductTotalStock(p.id);
    
    const sizes = p.gender === 'Erkek' ? 
      (this.settings.sizes?.['Erkek'] || [39, 40, 41, 42, 43, 44, 45]) :
      (this.settings.sizes?.['Kadın'] || [35, 36, 37, 38, 39, 40]);
    
    const pStock = this.stockData[p.id] || {};
    
    // Her numara için toplam stok hesapla
    const sizeStockMap = {};
    sizes.forEach(size => {
      let total = 0;
      this.branches.forEach(branch => {
        const bStock = pStock[branch.id] || {};
        total += parseInt(bStock[size] || 0);
      });
      sizeStockMap[size] = total;
    });
    
    // Numara kutuları
    const sizesHtml = sizes.map(size => {
      const qty = sizeStockMap[size];
      const outClass = qty === 0 ? 'out-of-stock' : '';
      return `<button class="detail-size-box ${outClass}" onclick="App.selectDetailSize('${p.id}', ${size})" id="detail-size-${size}">${size}</button>`;
    }).join('');
    
    // Genel stok durumu
    let stockStatusHtml = '';
    if (totalStock > 2) {
      stockStatusHtml = `<div class="product-stock-status status-available" style="font-size: 0.7rem; padding: 0.3rem 0.6rem; background: rgba(16, 185, 129, 0.1); border-radius: 50px; margin-top: 0.5rem; display: inline-flex;"><div class="status-dot"></div> Stokta Mevcut</div>`;
    } else if (totalStock > 0) {
      stockStatusHtml = `<div class="product-stock-status status-low" style="font-size: 0.7rem; padding: 0.3rem 0.6rem; background: rgba(245, 158, 11, 0.1); border-radius: 50px; margin-top: 0.5rem; display: inline-flex;"><div class="status-dot"></div> Tükenmek üzere (${totalStock} adet)</div>`;
    } else {
      stockStatusHtml = `<div class="product-stock-status status-out" style="font-size: 0.7rem; padding: 0.3rem 0.6rem; background: rgba(239, 68, 68, 0.1); border-radius: 50px; margin-top: 0.5rem; display: inline-flex;"><div class="status-dot"></div> Tükendi</div>`;
    }
    
    // WhatsApp mesajı
    const waMessage = encodeURIComponent(`👋 *Merhaba!* Web sitenizdeki bir ürün hakkında bilgi almak istiyorum.\n\n📦 *Ürün:* ${p.brand} ${p.model}\n🎨 *Renk:* ${p.color || '-'}\n🔖 *Barkod:* ${p.barcode || '-'}\n\nBu ürün stoklarınızda mevcut mu?`);
    
    // Ürün özellikleri
    let detailsHtml = '';
    if (p.brand) detailsHtml += `<tr><td>Marka</td><td>${p.brand}</td></tr>`;
    if (p.category) detailsHtml += `<tr><td>Kategori</td><td>${p.category}</td></tr>`;
    if (p.gender) detailsHtml += `<tr><td>Cinsiyet</td><td>${p.gender}</td></tr>`;
    if (p.color) detailsHtml += `<tr><td>Renk</td><td>${p.color}</td></tr>`;
    if (p.season) detailsHtml += `<tr><td>Sezon</td><td>${p.season}</td></tr>`;
    if (p.barcode) detailsHtml += `<tr><td>Barkod</td><td>${p.barcode}</td></tr>`;
    detailsHtml += `<tr><td>Malzeme</td><td>%100 Hakiki Deri</td></tr>`;
    detailsHtml += `<tr><td>Üretim</td><td>El Yapımı</td></tr>`;
    
    // Benzer ürünler (aynı cinsiyet veya kategori, maks 4)
    const similarProducts = this.products
      .filter(sp => sp.id !== p.id && (sp.gender === p.gender || sp.category === p.category))
      .slice(0, 4);
    
    let similarHtml = '';
    if (similarProducts.length > 0) {
      similarHtml = '<div class="detail-similar-grid">';
      similarProducts.forEach(sp => {
        const spPrice = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(sp.price || 0);
        const spImg = sp.image || 'img/logo.webp?v=2';
        const spImgStyle = !sp.image ? 'object-fit: contain; padding: 1rem; opacity: 0.5;' : '';
        similarHtml += `
          <a href="urun-detay.html?id=${sp.id}" class="detail-similar-card">
            <img src="${spImg}" alt="${sp.brand} ${sp.model}" style="${spImgStyle}">
            <div class="detail-similar-info">
              <span class="detail-similar-brand">${sp.brand || 'BAYYILDIZ'}</span>
              <span class="detail-similar-name">${sp.model}</span>
              <span class="detail-similar-price">${spPrice}</span>
            </div>
          </a>
        `;
      });
      similarHtml += '</div>';
    }
    
    // Galeri HTML oluşturma
    let galleryHtml = `
      <div class="detail-main-img">
        <img src="${imgSrc}" alt="${p.brand} ${p.model}" style="${imgStyle}; cursor: zoom-in;" id="main-product-img" onclick="App.openLightbox(this.src)">
      </div>
    `;
    
    if (p.images && Array.isArray(p.images) && p.images.length > 1) {
      let thumbnailsHtml = p.images.map((img, index) => {
        return `<img src="${img}" alt="Thumbnail ${index + 1}" class="detail-thumb-img ${index === 0 ? 'active' : ''}" onclick="document.getElementById('main-product-img').src=this.src; document.querySelectorAll('.detail-thumb-img').forEach(el=>el.classList.remove('active')); this.classList.add('active');">`;
      }).join('');
      
      galleryHtml += `<div class="detail-thumbnails">${thumbnailsHtml}</div>`;
    }
    
    container.innerHTML = `
      <nav class="detail-breadcrumb">
        <a href="index.html">Anasayfa</a>
        <span class="separator">/</span>
        <a href="urunler.html">Ürünlerimiz</a>
        <span class="separator">/</span>
        ${p.gender ? `<a href="urunler.html?gender=${p.gender}">${p.gender} Ayakkabı</a><span class="separator">/</span>` : ''}
        <span class="current">${p.brand} ${p.model}</span>
      </nav>
      
      <div class="detail-layout">
        <div class="detail-gallery">
          ${galleryHtml}
        </div>
        
        <div class="detail-info">
          <h1 class="detail-title">${p.brand} ${p.model}</h1>
          
          <div class="detail-price-box-new">
            <span class="detail-price">${priceFormatted}</span>
          </div>
          
          <div class="detail-features-text">
            <span>✓ Ücretsiz kargo</span>
            <span>✓ Aynı gün kargo</span>
            <span>✓ Kolay değişim</span>
          </div>
          
          ${totalStock > 0 ? '<div class="product-stock-status stokta-badge">STOKTA</div>' : '<div class="product-stock-status stokta-badge" style="background:#fce8e8;color:#ef4444;">TÜKENDİ</div>'}
          
          <div class="detail-size-card">
            <div class="detail-size-header">
              <div style="display: flex; gap: 10px; align-items: center;">
                <span class="detail-size-title">Numaranızı seçin</span>
                <button type="button" class="btn btn-outline" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; display: flex; align-items: center; gap: 4px; border-radius: 4px; border-color: var(--primary);" onclick="App.openSizeRecommender()">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h16v6H4zm0 0l4-4m12 4l-4-4"/></svg>
                  Numaramı Bul
                </button>
              </div>
              <span class="detail-size-stock-badge" id="detail-size-stock-badge" style="display:none;"></span>
            </div>
            
            <div class="detail-size-grid" id="detail-size-grid">${sizesHtml}</div>
            
            <div class="detail-sku-box">
              <div class="detail-sku-line">SKU: <strong style="text-transform: uppercase;">${(p.model || "").replace(/\s+/g, "")}-${(p.color || "").replace(/\s+/g, "")}</strong><strong id="detail-sku-size-text"></strong></div>
              <div class="detail-shipping-line">Bugün sipariş verirsen yarın kargoda</div>
            </div>
          </div>
          
          <div id="detail-branch-stock" class="detail-branch-stock">
            <span class="detail-size-title" style="display:block; margin-bottom: 0.75rem;">Mağaza Stok Durumu</span>
            <div style="color: var(--text-light); font-size: 0.9rem;">Lütfen stok durumunu görmek için yukarıdan bir numara seçin.</div>
          </div>
          
          <div class="detail-actions-row">
            <span class="detail-qty-label">Adet</span>
            <div class="detail-qty-selector">
              <button class="detail-qty-btn" onclick="App.changeDetailQty(-1)">−</button>
              <input type="number" id="detail-qty-input" class="detail-qty-input" value="1" min="1" max="10" readonly>
              <button class="detail-qty-btn" onclick="App.changeDetailQty(1)">+</button>
            </div>
          </div>

          <div class="detail-actions-buttons">
            <button class="detail-add-cart-btn-new" id="detail-add-cart-btn" onclick="App.addToCartFromDetail('${p.id}')">
              Sepete ekle
            </button>
            <a href="#" class="detail-view-cart-link" onclick="Cart.openDrawer(); return false;">Sepeti görüntüle</a>
            <a href="https://wa.me/?text=${waMessage}" id="detail-wa-btn" target="_blank" rel="noopener" class="detail-wa-btn-new">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              Sipariş &amp; Bilgi (WhatsApp)
            </a>
          </div>
                    <div class="detail-accordion">
            <div class="accordion-item">
              <button class="accordion-toggle" onclick="this.classList.toggle('active'); this.nextElementSibling.classList.toggle('active');">
                Ürün Özellikleri
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
              <div class="accordion-content">
                <table class="detail-specs-table">${detailsHtml}</table>
              </div>
            </div>
            ${similarProducts.length > 0 ? `
            <div class="accordion-item">
              <button class="accordion-toggle active" onclick="this.classList.toggle('active'); this.nextElementSibling.classList.toggle('active');">
                Ürün Önerileri
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
              <div class="accordion-content active">
                ${similarHtml}
              </div>
            </div>
            ` : ''}
          </div>
        </div>
      </div>
      
      <!-- Müşteri Yorumları Bölümü -->
      <div class="reviews-section" id="reviews-section">
        <div class="reviews-section-header">
          <h2 class="reviews-section-title">
            ⭐ Müşteri Yorumları
            <span class="review-count-badge" id="review-count-badge">0</span>
          </h2>
          <div class="reviews-summary" id="reviews-summary" style="display: none;">
            <span class="avg-score" id="avg-score">0</span>
            <div>
              <div class="avg-stars" id="avg-stars"></div>
              <span class="avg-label">ortalama puan</span>
            </div>
          </div>
        </div>
        
        <div class="review-form-wrapper">
          ${(firebase.auth().currentUser && !firebase.auth().currentUser.isAnonymous) ? `
          <h3>✍️ Yorum Yap</h3>
          <form class="review-form" id="review-form" onsubmit="event.preventDefault(); App.submitReview('${p.id}');">
            
            <div class="form-row">
              <label>Puanınız</label>
              <div class="star-rating-input" id="star-rating-input">
                <input type="radio" id="star5" name="rating" value="5"><label for="star5" title="5 yıldız">★</label>
                <input type="radio" id="star4" name="rating" value="4"><label for="star4" title="4 yıldız">★</label>
                <input type="radio" id="star3" name="rating" value="3"><label for="star3" title="3 yıldız">★</label>
                <input type="radio" id="star2" name="rating" value="2"><label for="star2" title="2 yıldız">★</label>
                <input type="radio" id="star1" name="rating" value="1"><label for="star1" title="1 yıldız">★</label>
              </div>
            </div>
            <div class="form-row">
              <label for="review-comment">Yorumunuz</label>
              <textarea id="review-comment" placeholder="Bu ürün hakkındaki düşüncelerinizi yazın..." maxlength="500" required></textarea>
              </div>
              <button type="submit" class="btn-submit-review" id="btn-submit-review">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
              Yorum Gönder
            </button>
            <div class="form-message" id="review-form-message"></div>
          </form>` : `
          <div style="text-align:center; padding: 20px; background: rgba(0,0,0,0.02); border-radius: 8px;">
            <div style="font-size: 24px; margin-bottom: 10px;">🔒</div>
            <h4 style="margin-bottom: 5px;">Ürün Değerlendirmesi</h4>
            <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 15px;">Gerçek müşteri deneyimini korumak adına sadece giriş yapan kullanıcılar yorum yapabilir.</p>
            <a href="hesabim.html" class="btn btn-secondary" style="display: inline-block;">Giriş Yap / Üye Ol</a>
          </div>`}
        </div>
        
        <div id="reviews-list-container">
          <div class="reviews-empty">
            <div class="empty-icon">💬</div>
            <p>Henüz yorum yapılmamış. İlk yorumu siz yapın!</p>
          </div>
        </div>
      </div>
    `;
    
    // Yorumları yükle
    
    // Sticky Cart Observer
    setTimeout(() => {
      const buyBtn = document.getElementById('detail-add-cart-btn');
      const stickyCart = document.getElementById('sticky-add-to-cart');
      const stickyPrice = document.getElementById('sticky-price');
      if (stickyPrice) stickyPrice.textContent = priceFormatted;
      
      if (buyBtn && stickyCart) {
        const observer = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
              stickyCart.classList.add('show');
            } else {
              stickyCart.classList.remove('show');
            }
          });
        }, { threshold: 0 });
        observer.observe(buyBtn);
      }
    }, 500);

    // Setup Image Zoom
    setTimeout(() => {
      const mainImgContainer = document.querySelector('.detail-main-img');
      const mainImg = document.getElementById('main-product-img');
      if (mainImgContainer && mainImg) {
        mainImgContainer.addEventListener('mousemove', (e) => {
          if (window.innerWidth <= 768) return; // Disable zoom on mobile
          const rect = mainImgContainer.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          const y = ((e.clientY - rect.top) / rect.height) * 100;
          mainImg.style.transformOrigin = `${x}% ${y}%`;
          mainImg.style.transform = 'scale(1.8)';
        });
        mainImgContainer.addEventListener('mouseleave', () => {
          mainImg.style.transformOrigin = 'center center';
          mainImg.style.transform = 'scale(1)';
        });
      }
    }, 500);

    // Render History Products (Benzer ürünler is already rendered inside HTML above)
    setTimeout(() => {
      const parentContainer = document.getElementById('product-detail-container');
      if(!parentContainer) return;

      const historyIds = JSON.parse(localStorage.getItem('bayyildiz_history') || '[]').filter(id => id !== p.id).slice(0, 4);
      const historyProds = historyIds.map(id => App.products.find(x => x.id === id)).filter(Boolean);
      
      if (historyProds.length > 0) {
        const historySection = document.createElement('div');
        historySection.className = 'history-products-section';
        historySection.style = 'margin-top: 4rem; padding-top: 3rem; border-top: 1px solid var(--border);';
        historySection.innerHTML = `
          <h3 style="font-size: 1.5rem; font-weight: 800; margin-bottom: 1.5rem; color: var(--text-dark); text-align: center;">Daha Önce İncelediğiniz Ürünler</h3>
          <div class="products-grid" id="history-products-grid"></div>
        `;
        parentContainer.appendChild(historySection);
        
        const historyGrid = document.getElementById('history-products-grid');
        historyProds.forEach(prod => {
          const div = document.createElement('div');
          div.innerHTML = App.generateProductCardHTML(prod);
          const cardEl = div.firstElementChild;
          cardEl.style.cursor = 'pointer';
          cardEl.onclick = () => window.location.href = 'urun-detay.html?id=' + prod.id;
          historyGrid.appendChild(cardEl);
        });
      }
    }, 500);

    this.loadReviews(p.id);

  },

  selectDetailSize(productId, size) {
    // Seçili numarayı güncelle
    document.querySelectorAll('.detail-size-box').forEach(el => el.classList.remove('selected'));
    const selectedEl = document.getElementById(`detail-size-${size}`);
    if (selectedEl) selectedEl.classList.add('selected');
    
    const p = this.products.find(x => x.id === productId);
    if (!p) return;
    
    // SKU Update
    const skuSizeText = document.getElementById('detail-sku-size-text');
    if (skuSizeText) {
      skuSizeText.textContent = "-" + size;
    }
    
    const pStock = this.stockData[p.id] || {};
    
    let totalSizeQty = 0;
    
    // Mağaza (Şube) stok durumu
    let branchHtml = '<div class="detail-branch-list">';
    this.branches.forEach(branch => {
      const bStock = pStock[branch.id] || {};
      const qty = parseInt(bStock[size] || 0);
      totalSizeQty += qty;
      
      let statusText, statusClass;
      if (qty > 2) {
        statusText = 'Stokta Mevcut';
        statusClass = 'status-available';
      } else if (qty > 0) {
        statusText = `Tükenmek üzere (${qty} adet)`;
        statusClass = 'status-low';
      } else {
        statusText = 'Tükendi';
        statusClass = 'status-out';
      }
      
      branchHtml += `
        <div class="detail-branch-item-new">
          <div class="detail-branch-name-new">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <span>${branch.name}</span>
          </div>
          <div class="product-stock-status ${statusClass} branch-status-badge">
            <div class="status-dot"></div> ${statusText}
          </div>
        </div>
      `;
    });
    branchHtml += '</div>';
    
    const branchStockEl = document.getElementById('detail-branch-stock');
    if (branchStockEl) {
      // Canlı stok göstergesi + Mağaza stok durumu
      let urgencyHtml = '';
      
      if (totalSizeQty === 0) {
        urgencyHtml = `
          <div class="stock-urgency-alert stock-out">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
            Bu numara şu an tükenmiştir.
          </div>`;
      } else if (totalSizeQty <= 3) {
        urgencyHtml = `
          <div class="stock-urgency-alert stock-critical">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <span>Son <strong>${totalSizeQty} adet</strong> kaldı! Hızlı davranın!</span>
          </div>
          <div class="stock-live-badge">
            <span class="live-dot"></span> Stok anlık güncelleniyor
          </div>`;
      } else {
        urgencyHtml = `
          <div class="stock-live-badge">
            <span class="live-dot"></span> Stok anlık güncelleniyor
          </div>`;
      }

      branchStockEl.innerHTML = `
        <span class="detail-size-title" style="display:block; margin-bottom: 0.75rem;">Mağaza Stok Durumu</span>
        ${urgencyHtml}
        ${branchHtml}
      `;
    }
    
    const badgeEl = document.getElementById('detail-size-stock-badge');
    if (badgeEl) {
      if (totalSizeQty > 0 && totalSizeQty <= 2) {
        badgeEl.textContent = `Son ${totalSizeQty} adet`;
        badgeEl.style.display = 'inline-block';
      } else {
        badgeEl.style.display = 'none';
      }
    }
    
    // WhatsApp linkini seçilen numara ile güncelle
    const waBtn = document.getElementById('detail-wa-btn');
    if (waBtn) {
      const text = `👋 *Merhaba!* Web sitenizdeki bir ürün hakkında bilgi almak istiyorum.\n\n📦 *Ürün:* ${p.brand} ${p.model}\n🎨 *Renk:* ${p.color || '-'}\n🏷️ *İstenen Numara:* ${size}\n\nBu ürün stoklarınızda mevcut mu?`;
      waBtn.href = `https://wa.me/?text=${encodeURIComponent(text)}`;
    }
  },
  
  openIyzicoCheckout(productId, productName, price) {
    const selectedSizeEl = document.querySelector('.detail-size-box.selected');
    const size = selectedSizeEl ? selectedSizeEl.textContent.trim() : null;
    if (!size) {
      if(window.showCustomAlert) window.showCustomAlert('Hata', 'Lütfen sipariş vermek için bir numara seçin.');
      else alert("Lütfen numara seçin");
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'iyzico-modal-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '999999';

    const modal = document.createElement('div');
    modal.style.backgroundColor = '#fff';
    modal.style.padding = '2rem';
    modal.style.borderRadius = '12px';
    modal.style.width = '90%';
    modal.style.maxWidth = '500px';
    modal.style.position = 'relative';

    modal.innerHTML = `
      <button onclick="document.body.removeChild(document.getElementById('iyzico-modal-overlay'))" style="position:absolute; right:15px; top:15px; background:none; border:none; font-size:1.5rem; cursor:pointer;">&times;</button>
      <h3 style="margin-top:0; font-family:sans-serif; color:#1B2A4A;">Teslimat ve Fatura Bilgileri</h3>
      <p style="color:#666; font-size:0.9rem; margin-bottom:20px;">Lütfen ${productName} (${size} Numara) siparişiniz için bilgilerinizi girin.</p>
      
      <div style="display:flex; gap:10px; margin-bottom:10px;">
        <input type="text" id="iyz_name" placeholder="Adınız *" style="flex:1; padding:10px; border:1px solid #ccc; border-radius:5px;" required>
        <input type="text" id="iyz_surname" placeholder="Soyadınız *" style="flex:1; padding:10px; border:1px solid #ccc; border-radius:5px;" required>
      </div>
      <div style="display:flex; gap:10px; margin-bottom:10px;">
        <input type="tel" id="iyz_phone" placeholder="Telefon (05XX) *" style="flex:1; padding:10px; border:1px solid #ccc; border-radius:5px;" required>
        <input type="email" id="iyz_email" placeholder="E-Posta *" style="flex:1; padding:10px; border:1px solid #ccc; border-radius:5px;" required>
      </div>
      <div style="margin-bottom:10px;">
        <input type="text" id="iyz_tc" placeholder="TC Kimlik No (Fatura için) *" maxlength="11" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:5px;" required>
      </div>
      <div style="display:flex; gap:10px; margin-bottom:10px;">
        <input type="text" id="iyz_city" placeholder="İl / İlçe *" style="flex:1; padding:10px; border:1px solid #ccc; border-radius:5px;" required>
      </div>
      <div style="margin-bottom:20px;">
        <textarea id="iyz_address" placeholder="Açık Adres *" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:5px; height:80px;" required></textarea>
      </div>
      
      <div style="display: flex; gap: 8px; align-items: flex-start; margin-bottom: 15px; padding: 10px 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; margin-top: 2px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        <p style="margin: 0; font-size: 0.8rem; color: #166534; line-height: 1.4; text-align: left;"><strong>G&#252;venli &#214;deme:</strong> Kart numaras&#305; ve CVV bu sitede i&#351;lenmez. &#214;deme iyzico Checkout Form &#252;zerinden al&#305;n&#305;r.</p>
      </div>
      
      <button id="iyz_submit_btn" style="width:100%; padding:12px; background:#1B2A4A; color:white; border:none; border-radius:5px; font-size:1.1rem; font-weight:bold; cursor:pointer;" onclick="App.startIyzicoPayment('${productId}', '${productName}', ${price}, '${size}')">Ödemeye Geç (${price} ₺)</button>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  },

  async startIyzicoPayment(productId, productName, price, size) {
    const btn = document.getElementById('iyz_submit_btn');
    
    const buyer = {
      name: document.getElementById('iyz_name').value,
      surname: document.getElementById('iyz_surname').value,
      phone: document.getElementById('iyz_phone').value,
      email: document.getElementById('iyz_email').value,
      identityNumber: document.getElementById('iyz_tc').value,
      city: document.getElementById('iyz_city').value,
      address: document.getElementById('iyz_address').value
    };

    if(!buyer.name || !buyer.surname || !buyer.phone || !buyer.identityNumber || !buyer.address) {
      alert("Lütfen zorunlu tüm alanları doldurun.");
      return;
    }

    btn.innerText = 'İyzico\'ya Bağlanıyor...';
    btn.disabled = true;

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: { id: productId, name: productName, price: price, size: size },
          buyer: buyer
        })
      });

      const data = await response.json();
      
      if (data.status === 'success' && data.paymentPageUrl) {
         window.location.href = data.paymentPageUrl;
      } else {
         alert("Ödeme başlatılamadı: " + data.message);
         btn.innerText = 'Ödemeye Geç';
         btn.disabled = false;
      }
    } catch(err) {
      alert("Sunucuya bağlanılamadı. Lütfen Node.js sunucusunun (server.js) çalıştığından emin olun.");
      btn.innerText = 'Ödemeye Geç';
      btn.disabled = false;
    }
  },

  // Hook to handle Iyzico Callback on page load
  
  openIyzicoCheckoutFromCart() {
    if (!Cart.items || Cart.items.length === 0) {
      if(window.showCustomAlert) window.showCustomAlert('Hata', 'Sepetiniz boş.');
      else alert("Sepetiniz boş.");
      return;
    }

    const price = Cart.getTotal();

    const overlay = document.createElement('div');
    overlay.id = 'iyzico-modal-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '999999';

    const modal = document.createElement('div');
    modal.style.backgroundColor = '#fff';
    modal.style.padding = '2rem';
    modal.style.borderRadius = '12px';
    modal.style.width = '90%';
    modal.style.maxWidth = '500px';
    modal.style.position = 'relative';

    modal.innerHTML = `
      <button onclick="document.body.removeChild(document.getElementById('iyzico-modal-overlay'))" style="position:absolute; right:15px; top:15px; background:none; border:none; font-size:1.5rem; cursor:pointer;">&times;</button>
      <h3 style="margin-top:0; font-family:sans-serif; color:#1B2A4A;">Teslimat ve Fatura Bilgileri</h3>
      <p style="color:#666; font-size:0.9rem; margin-bottom:20px;">Sepetinizdeki ${Cart.items.length} ürün için bilgilerinizi girin.</p>
      
      <div style="display:flex; gap:10px; margin-bottom:10px;">
        <input type="text" id="iyz_name" placeholder="Adınız *" style="flex:1; padding:10px; border:1px solid #ccc; border-radius:5px;" required>
        <input type="text" id="iyz_surname" placeholder="Soyadınız *" style="flex:1; padding:10px; border:1px solid #ccc; border-radius:5px;" required>
      </div>
      <div style="display:flex; gap:10px; margin-bottom:10px;">
        <input type="tel" id="iyz_phone" placeholder="Telefon (05XX) *" style="flex:1; padding:10px; border:1px solid #ccc; border-radius:5px;" required>
        <input type="email" id="iyz_email" placeholder="E-Posta *" style="flex:1; padding:10px; border:1px solid #ccc; border-radius:5px;" required>
      </div>
      <div style="margin-bottom:10px;">
        <input type="text" id="iyz_tc" placeholder="TC Kimlik No (Fatura için) *" maxlength="11" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:5px;" required>
      </div>
      <div style="display:flex; gap:10px; margin-bottom:10px;">
        <input type="text" id="iyz_city" placeholder="İl / İlçe *" style="flex:1; padding:10px; border:1px solid #ccc; border-radius:5px;" required>
      </div>
      <div style="margin-bottom:20px;">
        <textarea id="iyz_address" placeholder="Açık Adres *" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:5px; height:80px;" required></textarea>
      </div>
      
      <div style="display: flex; gap: 8px; align-items: flex-start; margin-bottom: 15px; padding: 10px 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; margin-top: 2px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        <p style="margin: 0; font-size: 0.8rem; color: #166534; line-height: 1.4; text-align: left;"><strong>G&#252;venli &#214;deme:</strong> Kart numaras&#305; ve CVV bu sitede i&#351;lenmez. &#214;deme iyzico Checkout Form &#252;zerinden al&#305;n&#305;r.</p>
      </div>
      
      <button id="iyz_submit_btn" style="width:100%; padding:12px; background:#1B2A4A; color:white; border:none; border-radius:5px; font-size:1.1rem; font-weight:bold; cursor:pointer;" onclick="App.startIyzicoPaymentFromCart()">Ödemeye Geç (${price} ₺)</button>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  },

  async startIyzicoPaymentFromCart() {
    const btn = document.getElementById('iyz_submit_btn');
    
    const buyer = {
      name: document.getElementById('iyz_name').value,
      surname: document.getElementById('iyz_surname').value,
      phone: document.getElementById('iyz_phone').value,
      email: document.getElementById('iyz_email').value,
      identityNumber: document.getElementById('iyz_tc').value,
      city: document.getElementById('iyz_city').value,
      address: document.getElementById('iyz_address').value
    };

    if(!buyer.name || !buyer.surname || !buyer.phone || !buyer.identityNumber || !buyer.address) {
      alert("Lütfen zorunlu tüm alanları doldurun.");
      return;
    }

    btn.innerText = 'İyzico\'ya Bağlanıyor...';
    btn.disabled = true;

    try {
      const response = await fetch('/api/checkout-cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cartItems: Cart.items,
          buyer: buyer
        })
      });

      const data = await response.json();
      
      if (data.status === 'success' && data.paymentPageUrl) {
         window.location.href = data.paymentPageUrl;
      } else {
         alert("Ödeme başlatılamadı: " + data.message);
         btn.innerText = 'Ödemeye Geç';
         btn.disabled = false;
      }
    } catch(err) {
      alert("Sunucuya bağlanılamadı. Lütfen Node.js sunucusunun (server.js) çalıştığından emin olun.");
      btn.innerText = 'Ödemeye Geç';
      btn.disabled = false;
    }
  },

  checkIyzicoCallback() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
       const paymentId = params.get('paymentId');
       if(window.showCustomAlert) {
          window.showCustomAlert('Sipariş Alındı', 'Ödemeniz başarıyla gerçekleşti! Sipariş/Ödeme No: ' + paymentId);
       } else {
          alert('Ödemeniz başarıyla gerçekleşti! Sipariş/Ödeme No: ' + paymentId);
       }
       // Write to Firebase
       const ordersRef = window.db ? window.ref(window.db, '_bayyildiz_secure_v1_A9xK2mP8/orders') : null;
       if (ordersRef) {
          if(window.Cart) { window.Cart.items = []; window.Cart.saveCart(); }
          window.push(ordersRef, {
             productId: params.get('productId'),
             size: params.get('size'),
             price: params.get('price'),
             paymentId: paymentId,
             status: 'Ödendi',
             createdAt: new Date().toISOString()
          });
       }
       // Clear URL
       window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get('payment') === 'error') {
       alert('Ödeme Başarısız: ' + params.get('msg'));
       window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
,
  changeDetailQty(delta) {
    const input = document.getElementById('detail-qty-input');
    if (!input) return;
    
    // Stok kontrolü yapalım
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');
    const selectedSizeEl = document.querySelector('.detail-size-box.selected');
    
    let maxAllowed = 10;
    if (productId && selectedSizeEl) {
      const size = selectedSizeEl.textContent.trim();
      const p = this.products.find(x => x.id === productId);
      if (p) {
        const pStock = this.stockData[p.id] || {};
        let totalSizeQty = 0;
        this.branches.forEach(branch => {
          const bStock = pStock[branch.id] || {};
          totalSizeQty += parseInt(bStock[size] || 0);
        });
        maxAllowed = totalSizeQty;
      }
    } else if (!selectedSizeEl) {
      if (delta > 0) {
        this.toast('Lütfen önce numara seçin', 'error');
        return;
      }
    }

    let val = parseInt(input.value) + delta;
    if (val < 1) val = 1;
    
    if (selectedSizeEl && val > maxAllowed) {
      this.toast(`Stokta sadece ${maxAllowed} adet mevcut.`, 'error');
      val = maxAllowed;
    } else if (val > 10) {
      val = 10;
    }
    
    input.value = val;
  },

  addToCartFromDetail(productId) {
    const p = this.products.find(x => x.id === productId);
    if (!p) return;

    // Seçili numarayı bul
    const selectedSizeEl = document.querySelector('.detail-size-box.selected');
    if (!selectedSizeEl) {
      this.toast('Lütfen stokları görmek için bir numara seçin.', 'error');
      return;
    }
    const size = selectedSizeEl.textContent.trim();

    // Numaranın toplam stok bilgisini hesapla
    const pStock = this.stockData[p.id] || {};
    let totalSizeQty = 0;
    this.branches.forEach(branch => {
      const bStock = pStock[branch.id] || {};
      totalSizeQty += parseInt(bStock[size] || 0);
    });

    if (totalSizeQty < 1) {
      this.toast('Seçtiğiniz numara maalesef tükenmiş.', 'error');
      return;
    }

    // Adet
    const qtyInput = document.getElementById('detail-qty-input');
    let qty = qtyInput ? parseInt(qtyInput.value) : 1;

    // Sepette zaten ne kadar var?
    let inCartQty = 0;
    if (typeof Cart !== 'undefined' && Cart.items) {
      inCartQty = Cart.items
        .filter(item => item.id === p.id && item.size === size)
        .reduce((sum, item) => sum + (item.qty || 0), 0);
    }

    if (inCartQty + qty > totalSizeQty) {
      const kalan = totalSizeQty - inCartQty;
      if (kalan > 0) {
        if (inCartQty > 0) {
          this.toast(`Stokta toplam ${totalSizeQty} adet var. Sepetinizde zaten ${inCartQty} adet mevcut. En fazla ${kalan} adet daha ekleyebilirsiniz.`, 'error');
        } else {
          this.toast(`Stokta sadece ${totalSizeQty} adet mevcut.`, 'error');
        }
        if (qtyInput) qtyInput.value = kalan;
      } else {
        this.toast(`Mevcut tüm stok (${totalSizeQty} adet) zaten sepetinizde ekli.`, 'error');
      }
      return;
    }

    // Sepete ekle
    const product = {
      id: p.id,
      name: `${p.brand} ${p.model}`,
      price: p.price,
      size: size,
      branch: 'Online',
      image: p.image || 'img/logo.webp?v=2'
    };

    for (let i = 0; i < qty; i++) {
      Cart.addItem(product);
    }

    // Buton animasyonu
    const btn = document.getElementById('detail-add-cart-btn');
    if (btn) {
      const originalHtml = btn.innerHTML;
      btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Sepete Eklendi!`;
      btn.style.background = '#059669';
      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.style.background = '';
      }, 1500);
    }
  },

  // ==========================================
  // YORUM SİSTEMİ
  // ==========================================
  
  loadReviews(productId) {
    if (!this.db) return;
    const reviewsRef = this.db.ref(this.DATA_PATH + '/reviews/' + productId);
    
    // Realtime listener — yorumlar anlık güncellenir
    reviewsRef.orderByChild('createdAt').on('value', (snapshot) => {
      const data = snapshot.val();
      let reviews = data ? Object.values(data) : [];
      // SADECE ONAYLANMIŞ YORUMLARI FİLTRELE
      reviews = reviews.filter(r => r.approved === true);
      // En yeniler üstte
      reviews.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      this.renderReviews(productId, reviews);
    });
  },
  
  async submitReview(productId) {
    if (!firebase.auth().currentUser || firebase.auth().currentUser.isAnonymous) {
        alert("Yorum yapabilmek için giriş yapmalısınız.");
        return;
    }
    const commentInput = document.getElementById('review-comment');
    const ratingInput = document.querySelector('input[name="rating"]:checked');
    const messageEl = document.getElementById('review-form-message');
    const submitBtn = document.getElementById('btn-submit-review');
    
    // Auto-fetch name
    let name = firebase.auth().currentUser.displayName || localStorage.getItem('bayyildiz_cached_username');
    if (!name || name.trim() === '') name = "Değerli Müşterimiz";
    
    // Validasyon
    const comment = (commentInput.value || '').trim();
    const rating = ratingInput ? parseInt(ratingInput.value) : 0;
    
    
    
    if (rating === 0) {
      messageEl.className = 'form-message error';
      messageEl.textContent = 'Lütfen bir puan seçin.';
      return;
    }
    
    if (!comment) {
      messageEl.className = 'form-message error';
      messageEl.textContent = 'Lütfen yorumunuzu yazın.';
      commentInput.focus();
      return;
    }
    
    // Argo / Küfür Filtresi
    const checkProfanity = (text) => {
      const lowerText = text.toLocaleLowerCase('tr-TR');
      // Noktalama işaretlerini boşluk yap, kelimeleri ayır
      const words = lowerText.replace(/[^\w\sğüşöçığÜŞİÖÇI]/g, ' ').split(/\s+/);
      const badWords = [
        'amk', 'aq', 'sik', 'siker', 'siktir', 'piç', 'oc', 'oç', 'orospu', 
        'yarak', 'yarrak', 'göt', 'amcık', 'pezevenk', 'yavşak', 'ibne', 
        'kahpe', 'orosbu', 'sürtük', 'sikiş', 'sokam', 'sokarım', 'orosPU', 's.ç', 'g.t', 'amq'
      ];
      return words.some(word => badWords.includes(word));
    };

    if (checkProfanity(comment) || checkProfanity(name)) {
      messageEl.className = 'form-message error';
      messageEl.textContent = 'Yorumunuz veya isminiz uygunsuz ifadeler içerdiği için gönderilemiyor. Lütfen kelimelerinizi kontrol edin.';
      return;
    }
    
    // Gönder
    submitBtn.disabled = true;
    submitBtn.textContent = 'Gönderiliyor...';
    
    try {
      const reviewsRef = this.db.ref(this.DATA_PATH + '/reviews/' + productId);
      
      await reviewsRef.push({
        name: name,
        rating: rating,
        comment: comment,
        createdAt: Date.now(),
        approved: false
      });
      
      // Başarılı
      messageEl.className = 'form-message success';
      messageEl.textContent = '✅ İletiniz gönderilmiştir.';
      const alertOverlay = document.createElement('div');
      alertOverlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 999999; backdrop-filter: blur(4px); opacity: 0; transition: 0.3s;";
      
      const alertBox = document.createElement('div');
      alertBox.style.cssText = "background: white; padding: 2.5rem 2rem; border-radius: 16px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); text-align: center; transform: scale(0.9); transition: 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); max-width: 90%; width: 350px;";
      
      alertBox.innerHTML = `
        <div style="width: 70px; height: 70px; background: #d1fae5; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem auto;">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </div>
        <h3 style="margin: 0 0 0.75rem 0; color: #1e293b; font-size: 1.35rem; font-weight: 700;">Başarılı!</h3>
        <p style="margin: 0 0 1.75rem 0; color: #64748b; font-size: 1rem; line-height: 1.5;">İletiniz başarılı bir şekilde gönderilmiştir.</p>
        <button style="background: #10b981; color: white; border: none; padding: 0.8rem 2.5rem; border-radius: 10px; font-weight: 600; font-size: 1rem; cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'" onclick="this.parentElement.parentElement.style.opacity='0'; this.parentElement.style.transform='scale(0.9)'; setTimeout(() => this.parentElement.parentElement.remove(), 300);">Tamam</button>
      `;
      
      alertOverlay.appendChild(alertBox);
      document.body.appendChild(alertOverlay);
      
      setTimeout(() => {
        alertOverlay.style.opacity = '1';
        alertBox.style.transform = 'scale(1)';
      }, 10);
      
      // Formu temizle
      nameInput.value = '';
      commentInput.value = '';
      if (ratingInput) ratingInput.checked = false;
      
      // 3 saniye sonra mesajı gizle
      setTimeout(() => {
        messageEl.className = 'form-message';
        messageEl.textContent = '';
      }, 3000);
      
    } catch (error) {
      console.error('Yorum gönderme hatası:', error);
      messageEl.className = 'form-message error';
      messageEl.textContent = '❌ Yorum gönderilirken bir hata oluştu. Lütfen tekrar deneyin.';
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        Yorum Gönder
      `;
    }
  },
  
  renderReviews(productId, reviews) {
    const container = document.getElementById('reviews-list-container');
    const countBadge = document.getElementById('review-count-badge');
    const summaryEl = document.getElementById('reviews-summary');
    const avgScoreEl = document.getElementById('avg-score');
    const avgStarsEl = document.getElementById('avg-stars');
    
    if (!container) return;
    
    const count = reviews.length;
    countBadge.textContent = count;
    
    if (count === 0) {
      summaryEl.style.display = 'none';
      container.innerHTML = `
        <div class="reviews-empty">
          <div class="empty-icon">💬</div>
          <p>Henüz yorum yapılmamış. İlk yorumu siz yapın!</p>
        </div>
      `;
      return;
    }
    
    // Ortalama puanı hesapla
    const totalRating = reviews.reduce((sum, r) => sum + (r.rating || 0), 0);
    const avg = (totalRating / count).toFixed(1);
    
    avgScoreEl.textContent = avg;
    avgStarsEl.innerHTML = this.generateStars(parseFloat(avg));
    summaryEl.style.display = 'flex';
    
    // Yorum kartlarını oluştur
    let html = '<div class="reviews-list">';
    reviews.forEach(review => {
      const initial = (review.name || '?').charAt(0).toUpperCase();
      const stars = this.generateStars(review.rating || 0);
      const timeAgo = this.formatTimeAgo(review.createdAt);
      // XSS koruması ve İsim Gizleme
      const maskName = (name) => {
        return name.split(' ').map(word => {
          if (word.length <= 1) return word;
          return word.charAt(0) + '*'.repeat(word.length - 1);
        }).join(' ');
      };
      const maskedName = maskName(review.name || 'Anonim');
      const safeName = App.escapeHtml(maskedName);
      
      let photoHtml = '';
      if (review.photo) {
        const safePhoto = App.escapeHtml(review.photo);
        photoHtml = `
          <div style="margin-top: 10px; cursor: zoom-in;" onclick="window.open('${safePhoto}', '_blank')">
            <img src="${safePhoto}" style="max-width: 100px; max-height: 100px; border-radius: 8px; border: 1px solid var(--border); object-fit: cover; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          </div>
        `;
      }
      const safeComment = App.escapeHtml(review.comment || '');
      
      let replyHtml = '';
      if (review.reply) {
        const safeReply = App.escapeHtml(review.reply || '');
        replyHtml = `
          <div class="review-card-reply" style="margin-top: 12px; padding: 10px 14px; background: rgba(6, 182, 212, 0.08); border-left: 3px solid #06b6d4; border-radius: 6px; font-size: 0.88rem;">
            <div style="font-weight: 700; color: #06b6d4; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
              <span>🏪</span> BAYYILDIZ Ayakkabı Yanıtı
            </div>
            <div style="color: #0f172a; font-weight: 600; line-height: 1.5;">${safeReply}</div>
          </div>
        `;
      }
      
      html += `
        <div class="review-card">
          <div class="review-card-header">
            <div class="review-card-author">
              <div class="review-avatar">${initial}</div>
              <div>
                <div class="review-author-name">${safeName}</div>
                <div class="review-card-date">${timeAgo}</div>
              </div>
            </div>
            <div class="review-card-stars">${stars}</div>
          </div>
          <div class="review-card-body">${safeComment}${photoHtml}</div>
          ${replyHtml}
        </div>
      `;
    });
    html += '</div>';
    
    container.innerHTML = html;
  },

  getReviewStats(productId) {
    if (!this.reviews || !this.reviews[productId]) return null;
    const prodReviews = Object.values(this.reviews[productId]);
    if (prodReviews.length === 0) return null;
    
    const count = prodReviews.length;
    const sum = prodReviews.reduce((acc, r) => acc + (r.rating || 0), 0);
    const avg = (sum / count).toFixed(1);
    return { count, avg: parseFloat(avg) };
  },
  
  generateStars(rating) {
    let html = '';
    for (let i = 1; i <= 5; i++) {
      if (i <= Math.floor(rating)) {
        html += '★';
      } else if (i - 0.5 <= rating) {
        html += '★'; // Yarım yıldız yerine dolu göster (basitlik)
      } else {
        html += '<span style="color: #d1d5db;">★</span>';
      }
    }
    return html;
  },
  
  formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    const now = Date.now();
    const diff = now - timestamp;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    const weeks = Math.floor(diff / 604800000);
    const months = Math.floor(diff / 2592000000);
    
    if (minutes < 1) return 'Az önce';
    if (minutes < 60) return `${minutes} dakika önce`;
    if (hours < 24) return `${hours} saat önce`;
    if (days < 7) return `${days} gün önce`;
    if (weeks < 4) return `${weeks} hafta önce`;
    if (months < 12) return `${months} ay önce`;
    
    const date = new Date(timestamp);
    return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  },

  openLightbox(src) {
    let lightbox = document.getElementById('image-lightbox');
    if (!lightbox) {
      lightbox = document.createElement('div');
      lightbox.id = 'image-lightbox';
      lightbox.className = 'lightbox';
      lightbox.innerHTML = `
        <span class="lightbox-close">&times;</span>
        <img id="lightbox-img" src="">
      `;
      document.body.appendChild(lightbox);
      
      lightbox.addEventListener('click', () => {
        lightbox.classList.remove('active');
        document.body.style.overflow = '';
      });
    }
    
    document.getElementById('lightbox-img').src = src;
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden'; // Arkaplanı kaydırmayı engelle
  },

  renderProductsGrid(append = false) {
    const grid = document.getElementById('products-grid');
    if (!append) grid.innerHTML = '';
    
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    const pageItems = this.filteredProducts.slice(startIndex, endIndex);
    
    pageItems.forEach(p => {
      const stock = this.getProductTotalStock(p.id);
      
      let stockStatusHtml = '';
      if (stock > 2) {
        stockStatusHtml = `<div class="product-stock-status status-available" style="font-size: 0.7rem; padding: 0.3rem 0.6rem; background: rgba(16, 185, 129, 0.1); border-radius: 50px; margin-top: 0.5rem; display: inline-flex;"><div class="status-dot"></div> Stokta Mevcut</div>`;
      } else if (stock > 0) {
        stockStatusHtml = `<div class="product-stock-status status-low" style="font-size: 0.7rem; padding: 0.3rem 0.6rem; background: rgba(245, 158, 11, 0.1); border-radius: 50px; margin-top: 0.5rem; display: inline-flex;"><div class="status-dot"></div> Tükenmek Üzere</div>`;
      } else {
        stockStatusHtml = `<div class="product-stock-status status-out" style="font-size: 0.7rem; padding: 0.3rem 0.6rem; background: rgba(239, 68, 68, 0.1); border-radius: 50px; margin-top: 0.5rem; display: inline-flex;"><div class="status-dot"></div> Tükendi</div>`;
      }
      
      const priceFormatted = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(p.price || 0);
      const imgSrc = p.image || 'img/logo.webp?v=2';
      const imgStyle = !p.image ? 'object-fit: contain; padding: 2rem; opacity: 0.5;' : '';
      
      const reviewStats = this.getReviewStats(p.id);
      let reviewHtml = '';
      if (reviewStats) {
        reviewHtml = `
          <div style="display: flex; align-items: center; gap: 4px; margin-top: 5px; margin-bottom: 5px; font-size: 0.8rem; color: var(--text-muted);">
            <div style="color: #fbbf24; display:flex; align-items:center;">${this.generateStars(reviewStats.avg)}</div>
            <span style="font-weight: 600; color: var(--text-main);">${reviewStats.avg}</span> 
            <span>(${reviewStats.count} Yorum)</span>
          </div>
        `;
      }

      const card = document.createElement('div');
      card.className = 'product-card';
      card.innerHTML = `
        <div class="product-img-wrapper">
          <img src="${imgSrc}" alt="${p.brand} ${p.model}" class="product-img" style="${imgStyle}" >
          <div class="product-badge-group">
            ${p.season === 'Yeni Sezon' ? '<span class="product-badge bg-primary">Yeni</span>' : ''}
            ${p.gender ? `<span class="product-badge bg-secondary">${p.gender}</span>` : ''}
          </div>
          <button class="favorite-btn ${this.isFavorite(p.id) ? 'active' : ''}" onclick="event.stopPropagation(); const isFav = App.toggleFavorite('${p.id}'); this.classList.toggle('active', isFav);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
          </button>
        </div>
        <div class="product-info">
          <div class="product-brand">${p.brand || 'BAYYILDIZ'}</div>
          <h3 class="product-title">${p.model} ${p.color ? '- ' + p.color : ''}</h3>
          ${reviewHtml}
          <div class="product-price">${priceFormatted}
          <button class="btn btn-outline" style="width: 100%; margin-top: 0.75rem; padding: 0.4rem; font-size: 0.8rem; border-radius: 6px; font-weight: 600;" onclick="event.stopPropagation(); App.openProductModal('${p.id}')">Ürünü İncele</button>
        
          ${stockStatusHtml}
        </div>
      `;
      
      card.addEventListener('click', () => this.openProductModal(p.id));
      grid.appendChild(card);
    });
    
    // Toggle Load More button
    if (endIndex < this.filteredProducts.length) {
      document.getElementById('products-load-more').classList.remove('hidden');
    } else {
      document.getElementById('products-load-more').classList.add('hidden');
    }
  },
  
  selectSize(productId, branchId, branchName, size, qty) {
    this.selectedSize = size; window.currentSelectedSize = size;
    this.selectedBranch = branchName;
    
    // Update message display
    const msgEl = document.getElementById(`msg-${branchId}`);
    if (msgEl) {
      let detailText = qty === 0 ? '(Tükendi)' : qty <= 2 ? '(Tükenmek Üzere)' : '(Stokta Mevcut)';
      let detailColor = qty === 0 ? 'var(--danger)' : qty <= 2 ? 'var(--warning)' : 'var(--success)';
      msgEl.innerHTML = `<strong>Numara: ${size}</strong> &rarr; Stok Adedi: <strong>${qty}</strong> ${detailText}`;
      msgEl.style.color = detailColor;
    }
    
    // Highlight the selected size box globally
    document.querySelectorAll('.size-box').forEach(el => el.classList.remove('selected'));
    const selectedEl = document.getElementById(`size-box-${branchId}-${size}`);
    if (selectedEl) selectedEl.classList.add('selected');
    
    // Update WhatsApp link removed for Cart
      const p = this.products.find(x => x.id === productId);
      if (p) {
        const cartBtn = document.getElementById('modal-add-cart-btn');
        if (cartBtn) {
          cartBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px; margin-bottom: -4px;"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
            Sepete Ekle (${this.selectedSize} Numara)
          `;
        }
      }
    },
  
  
    addToCart(id) {
    if (!this.selectedSize || !this.selectedBranch) {
      alert("Lütfen numaralardan (stok kutularından) bir beden seçin.");
      return;
    }
    const p = this.products.find(x => x.id === id);
    if (!p) return;

    // Numaranın toplam stok bilgisini hesapla
    const pStock = this.stockData[p.id] || {};
    let totalSizeQty = 0;
    this.branches.forEach(branch => {
      const bStock = pStock[branch.id] || {};
      totalSizeQty += parseInt(bStock[this.selectedSize] || 0);
    });

    if (totalSizeQty < 1) {
      this.toast('Seçtiğiniz numara maalesef tükenmiş.', 'error');
      return;
    }

    // Sepette zaten ne kadar var?
    let inCartQty = 0;
    if (typeof Cart !== 'undefined' && Cart.items) {
      inCartQty = Cart.items
        .filter(item => item.id === p.id && item.size === this.selectedSize)
        .reduce((sum, item) => sum + (item.qty || 0), 0);
    }

    if (inCartQty + 1 > totalSizeQty) {
      this.toast(`Stokta toplam ${totalSizeQty} adet var ve zaten hepsini sepetinize eklediniz!`, 'error');
      return;
    }

    Cart.addItem({
      id: p.id,
      name: (p.brand || 'BAYYILDIZ') + ' ' + p.model,
      price: p.price || 0,
      image: p.image,
      size: this.selectedSize,
      branch: this.selectedBranch
    });
    
    document.getElementById('product-modal').classList.add('hidden');
    document.body.style.overflow = '';
  },
    
    openProductModal(id) {
    window.location.href = "urun-detay.html?id=" + id;
    return;
    this.selectedSize = null;
    this.selectedBranch = null;
    const p = this.products.find(x => x.id === id);
    if (!p) return;
    
    const priceFormatted = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(p.price || 0);
    const imgSrc = p.image || 'img/logo.webp?v=2';
    const imgStyle = !p.image ? 'object-fit: contain; opacity: 0.5;' : '';
    const totalStock = this.getProductTotalStock(p.id);
    
    // Beden listesi (Ayarlardan veya varsayılan)
    const sizes = p.gender === 'Erkek' ? 
      (this.settings.sizes?.['Erkek'] || [39, 40, 41, 42, 43, 44, 45]) :
      (this.settings.sizes?.['Kadın'] || [35, 36, 37, 38, 39, 40]);
      
    const pStock = this.stockData[p.id] || {};
    
    let branchesHtml = '';
    
    this.branches.forEach(branch => {
      const bStock = pStock[branch.id] || {};
      let hasAnyStockInBranch = false;
      
      let sizesHtml = sizes.map(size => {
        const qty = parseInt(bStock[size] || 0);
        let statusClass = 'out';
        let statusText = 'YOK';
        
        if (qty > 0) {
          // Changed from AZ/VAR split: all in-stock items just show VAR
          statusClass = 'available';
          statusText = 'VAR';
          hasAnyStockInBranch = true;
        }
        
        return `
          <div id="size-box-${branch.id}-${size}" class="size-box ${statusClass}" onclick="App.selectSize('${p.id}', '${branch.id}', '${branch.name}', ${size}, ${qty})">
            <span class="size">${size}</span>
            <span class="status">${statusText}</span>
          </div>
        `;
      }).join('');
      
      branchesHtml += `
        <div class="branch-stock">
          <div class="branch-stock-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
            ${branch.name}
          </div>
          <div class="size-grid">${sizesHtml}</div>
          <div class="stock-message-box" id="msg-${branch.id}" style="margin-top: 12px; font-size: 0.95rem; min-height: 22px; text-align: center; background: rgba(0,0,0,0.02); padding: 6px; border-radius: 6px;">
            <span style="color: var(--text-muted); font-size: 0.85rem;">Detaylı stok bilgisi için numaralara tıklayın</span>
          </div>
        </div>
      `;
    });
    
    // WhatsApp Mesajı
    const waMessage = encodeURIComponent(`👋 *Merhaba!* Web sitenizdeki bir ürün hakkında bilgi almak istiyorum.\n\n📦 *Ürün:* ${p.brand} ${p.model}\n🎨 *Renk:* ${p.color || '-'}\n🔖 *Barkod:* ${p.barcode || '-'}\n\nBu ürün stoklarınızda mevcut mu?`);

    // Galeri HTML oluşturma (Modal için)
    let modalGalleryHtml = `
      <img src="${imgSrc}" alt="${p.brand} ${p.model}" style="${imgStyle}; cursor: zoom-in;" id="modal-main-img" onclick="App.openLightbox(this.src)">
    `;
    
    if (p.images && Array.isArray(p.images) && p.images.length > 1) {
      let thumbnailsHtml = p.images.map((img, index) => {
        return `<img src="${img}" alt="Thumbnail ${index + 1}" class="detail-thumb-img ${index === 0 ? 'active' : ''}" onclick="document.getElementById('modal-main-img').src=this.src; document.querySelectorAll('#modal-body .detail-thumb-img').forEach(el=>el.classList.remove('active')); this.classList.add('active');">`;
      }).join('');
      
      modalGalleryHtml += `<div class="detail-thumbnails">${thumbnailsHtml}</div>`;
    }

    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <div class="modal-split">
        <div class="modal-img-col">
          ${modalGalleryHtml}
        </div>
        <div class="modal-info-col">
          <div class="product-brand">${p.brand || 'BAYYILDIZ'}</div>
          <h2>${p.model}</h2>
          
          <div class="modal-price-box">
            <div class="price">${priceFormatted}</div>
          </div>
          
          <div class="modal-details">
            ${p.color ? `<p><strong>Renk:</strong> ${p.color}</p>` : ''}
            ${p.category ? `<p><strong>Kategori:</strong> ${p.category}</p>` : ''}
            ${p.gender ? `<p><strong>Cinsiyet:</strong> ${p.gender}</p>` : ''}
            ${p.season ? `<p><strong>Sezon:</strong> ${p.season}</p>` : ''}
            ${p.barcode ? `<p><strong>Barkod:</strong> ${p.barcode}</p>` : ''}
          </div>
          
          <div class="stock-section">
            <button type="button" class="size-guide-toggle" onclick="document.getElementById('size-guide-panel').classList.toggle('active')">📏 Beden Rehberi</button>
            <div id="size-guide-panel" class="size-guide-panel">
              <table>
                <tr><th>Erkek</th><td>39</td><td>40</td><td>41</td><td>42</td><td>43</td><td>44</td><td>45</td></tr>
                <tr><th>CM</th><td>24.5</td><td>25.5</td><td>26.5</td><td>27.5</td><td>28</td><td>29</td><td>29.5</td></tr>
              </table>
              <table>
                <tr><th>Kadın</th><td>35</td><td>36</td><td>37</td><td>38</td><td>39</td><td>40</td></tr>
                <tr><th>CM</th><td>22.5</td><td>23</td><td>23.5</td><td>24.5</td><td>25.5</td><td>26</td></tr>
              </table>
              <ul class="size-guide-tips">
                <li>Ayağınızı akşam saatlerinde ölçün</li>
                <li>Çorapla ölçüm yapın</li>
                <li>İki ayağınızı da ölçün, büyük olanı tercih edin</li>
              </ul>
            </div>
            <h3>Şubelerdeki Stok Durumu</h3>
            ${totalStock === 0 ? 
              `<div style="padding: 1rem; background: var(--bg-main); border-radius: var(--radius-md); text-align:center; color: var(--danger); font-weight: 500;">Ürün geçici olarak tükenmiştir.</div>` : 
              branchesHtml
            }
          </div>
          
          <div class="modal-actions">
            <button class="btn btn-outline ${this.isFavorite(p.id) ? 'active' : ''}" style="flex: 0 0 auto; width: 50px;" onclick="const isFav = App.toggleFavorite('${p.id}'); this.classList.toggle('active', isFav); this.querySelector('svg').style.fill = isFav ? '#ef4444' : 'none'; this.querySelector('svg').style.stroke = isFav ? '#ef4444' : 'currentColor';">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="${this.isFavorite(p.id) ? '#ef4444' : 'none'}" stroke="${this.isFavorite(p.id) ? '#ef4444' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
            </button>
            <button type="button" id="modal-add-cart-btn" class="btn btn-add-to-cart" style="flex: 1; padding: 0.8rem; font-size: 0.95rem; margin-top:0;" onclick="App.addToCart('${p.id}')">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; margin-bottom: -4px;"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
                Sepete Ekle
              </button>
            <a href="urun-detay.html?id=${p.id}" class="btn btn-primary btn-lg" style="flex: 1; padding: 0.8rem; font-size: 0.95rem; background: var(--text-dark); color: white;">
              Detaylar
            </a>
          </div>
        </div>
      </div>
    `;
    
    document.getElementById('product-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Arkaplan kaydırmayı kapat
  },

  async trackOrder() {
    const input = document.getElementById('track-order-input');
    if (!input || !input.value.trim()) return;
    
    const query = input.value.trim().toLowerCase();
    const btn = document.getElementById('btn-track-order');
    const resultDiv = document.getElementById('tracking-result');
    const errorDiv = document.getElementById('tracking-error');
    
    btn.innerHTML = '<div class="loader-spinner" style="width:20px; height:20px; border-width:2px; display:inline-block; margin-bottom:-5px;"></div> Sorgulanıyor...';
    btn.disabled = true;
    errorDiv.style.display = 'none';
    resultDiv.style.display = 'none';
    
    try {
      // GÜVENLİK: Tüm siparişleri indirmek yerine sadece istenen Sipariş ID'sini sorguluyoruz.
      // Firebase Rules'da orders için ".read": false, "$orderId": { ".read": true } 
      // yapılarak listeleme kapatılmalı, sadece ID'yi bilen okuyabilmelidir.
              let foundOrder = null;
        let pQuery = query;
        if (pQuery.length === 10 && pQuery.startsWith('5')) pQuery = '0' + pQuery;
        
        const isPhone = /^0?\d{10}$/.test(pQuery);
        if (isPhone) {
           // 1. WhatsApp siparişleri (orders koleksiyonu)
           const snapshot = await this.db.ref('orders').orderByChild('phone').equalTo(pQuery).once('value');
           if (snapshot.exists()) {
             const orders = snapshot.val();
             const orderIds = Object.keys(orders);
             foundOrder = orders[orderIds[orderIds.length - 1]];
           } else {
             // 2. Admin paneli satışları (sales koleksiyonu) - Doğrudan telefon ile arama
             const secureSnap = await this.db.ref('_bayyildiz_secure_v1_A9xK2mP8/sales').orderByChild('phone').equalTo(pQuery).once('value');
             if (secureSnap.exists()) {
               const orders = secureSnap.val();
               const orderIds = Object.keys(orders);
               foundOrder = orders[orderIds[orderIds.length - 1]];
             }
           }
        } else {
           // Kodu ile arama
           const snapshot = await this.db.ref('orders/' + query).once('value');
           foundOrder = snapshot.exists() ? snapshot.val() : null;
           if (!foundOrder) {
             // Admin panel sales araması (generateId küçük harflerle oluşturulur)
             const secureSnap = await this.db.ref('_bayyildiz_secure_v1_A9xK2mP8/sales').orderByChild('id').equalTo(query).once('value');
             if (secureSnap.exists()) {
               const res = secureSnap.val();
               foundOrder = res[Object.keys(res)[0]];
             } else {
               foundOrder = null;
             }
           }
        }
      
      if (foundOrder) {
        // Reset steps
        [1, 2, 3].forEach(step => {
          const el = document.querySelector(`#step-${step} .step-icon`);
          if (el) {
            el.style.background = 'var(--bg-main)';
            el.style.borderColor = 'var(--border)';
            el.style.color = 'var(--text-light)';
          }
        });
        
        // Setup line
        const line = document.getElementById('track-progress-line');
        const status = foundOrder.status || 1; // 1: Onaylandı, 2: Hazırlanıyor, 3: Kargoda
        
        setTimeout(() => {
          if (status === 1) line.style.width = '0%';
          if (status === 2) line.style.width = '50%';
          if (status === 3) line.style.width = '100%';
          
          for(let i=1; i<=status; i++) {
            setTimeout(() => {
              const el = document.querySelector(`#step-${i} .step-icon`);
              if (el) {
                el.style.background = '#10b981';
                el.style.borderColor = '#10b981';
                el.style.color = 'white';
                if (i < status || status === 3) el.innerHTML = '&#10003;'; // Checkmark
              }
            }, i * 300);
          }
        }, 100);
        
        document.getElementById('track-carrier').textContent = foundOrder.carrier || 'Bekleniyor';
        document.getElementById('track-code').textContent = (status === 3 && foundOrder.trackingCode) ? foundOrder.trackingCode : 'Kargoya verildiğinde eklenecektir';
        
        resultDiv.style.display = 'block';
      } else {
        errorDiv.style.display = 'block';
      }
    } catch (e) {
      console.error(e);
      errorDiv.style.display = 'block';
      errorDiv.textContent = 'Bağlantı hatası oluştu, lütfen tekrar deneyin.';
    } finally {
      btn.innerHTML = 'Sorgula';
      btn.disabled = false;
    }
  },
};

// FIX: "const App" üst seviyede tanımlandığı için otomatik olarak window
// nesnesine eklenmiyordu. auth.js ve cart.js'deki tüm "window.App" kontrolleri
// bu satır olmadan HER ZAMAN undefined dönüyordu — yani syncUserData()
// (geçmiş/favori senkronizasyonu) bu satır olmadan asla çalışamazdı.
window.App = App;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  App.init();
  document.getElementById('footer-year').textContent = new Date().getFullYear();
});

// Service Worker Kaydı
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// PWA Ana Ekrana Ekle (Kurulum Uyarı Popup'ı)
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
  // Chrome'un varsayılan küçük barını engelle
  e.preventDefault();
  deferredPrompt = e;
  
  // Kullanıcı daha önce "Şimdilik Geç" dediyse gösterme
  if (localStorage.getItem('bayyildiz_pwa_dismissed')) {
    return;
  }

  showPWAInstallBanner();
});

function showPWAInstallBanner() {
  if (document.getElementById('pwa-install-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.innerHTML = `
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
      <img src="img/icon-192.png" alt="BAYYILDIZ" style="width:48px; height:48px; border-radius:10px; box-shadow:0 2px 5px rgba(0,0,0,0.1);">
      <div>
        <h4 style="margin:0; font-size:1rem; color:var(--primary); font-weight:800;">BAYYILDIZ</h4>
        <p style="margin:0; font-size:0.8rem; color:var(--text-muted); line-height:1.3; margin-top:2px;">Uygulamamızı telefonunuza kurun, daha hızlı alışveriş yapın!</p>
      </div>
    </div>
    <div style="display:flex; gap:10px;">
      <button id="pwa-install-btn" class="btn btn-primary" style="flex:1; padding:0.6rem; font-size:0.9rem;">Hemen Kur</button>
      <button id="pwa-close-btn" class="btn btn-outline" style="padding:0.6rem; color:var(--text-muted); font-size:0.9rem;">Şimdilik Geç</button>
    </div>
  `;
  
  // Banner stili
  Object.assign(banner.style, {
    position: 'fixed',
    bottom: '-200px', // Başlangıçta gizli
    left: '50%',
    transform: 'translateX(-50%)',
    width: '90%',
    maxWidth: '400px',
    background: 'white',
    padding: '1.2rem',
    borderRadius: '16px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
    zIndex: '999999',
    transition: 'bottom 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
  });

  document.body.appendChild(banner);

  // Sayfa açıldıktan 2 saniye sonra yavaşça yukarı kaysın
  setTimeout(() => {
    banner.style.bottom = '20px';
  }, 2000);

  // Kur butonuna tıklandığında
  document.getElementById('pwa-install-btn').addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        banner.style.bottom = '-200px';
        setTimeout(() => banner.remove(), 500);
      }
      deferredPrompt = null;
    }
  });

  // Kapat butonuna tıklandığında (bir daha sorma)
  document.getElementById('pwa-close-btn').addEventListener('click', () => {
    localStorage.setItem('bayyildiz_pwa_dismissed', 'true');
    banner.style.bottom = '-200px';
    setTimeout(() => banner.remove(), 500);
  });
}

// iOS (iPhone/iPad) cihazlar için özel Safari uyarısı (Apple otomatik kurulum desteklemediği için)
const isIos = () => {
  const userAgent = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(userAgent);

};
const isInStandaloneMode = () => ('standalone' in window.navigator) && (window.navigator.standalone);

if (isIos() && !isInStandaloneMode() && !localStorage.getItem('bayyildiz_ios_pwa_dismissed')) {
  setTimeout(() => {
    if (document.getElementById('pwa-install-banner')) return; // Eğer diğeri çıktıysa (ki iOS'te çıkmaz) pas geç

    const banner = document.createElement('div');
    banner.innerHTML = `
      <div style="font-size:0.85rem; color:var(--text-dark); line-height:1.4;">
        <div style="font-weight:bold; margin-bottom:5px;">Apple Kullanıcıları İçin:</div>
        Uygulamamızı kurmak için tarayıcınızın altındaki <b>[Paylaş]</b> butonuna dokunup <b>"Ana Ekrana Ekle"</b> seçeneğini seçebilirsiniz.
      </div>
      <button id="ios-pwa-close" style="width:100%; margin-top:10px; padding:0.5rem; background:var(--bg-main); border:none; border-radius:8px; font-weight:bold;">Anladım</button>
    `;
    
    Object.assign(banner.style, {
      position: 'fixed',
      bottom: '-200px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '90%',
      maxWidth: '400px',
      background: 'white',
      padding: '1.2rem',
      borderRadius: '16px',
      boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
      zIndex: '999999',
      transition: 'bottom 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
      border: '2px solid var(--primary)'
    });

    document.body.appendChild(banner);
    
    setTimeout(() => { banner.style.bottom = '20px'; }, 3000);

    document.getElementById('ios-pwa-close').addEventListener('click', () => {
      localStorage.setItem('bayyildiz_ios_pwa_dismissed', 'true');
      banner.style.bottom = '-200px';
      setTimeout(() => banner.remove(), 500);
    });
  }, 1000);
}


// ==========================================================
// Header onarımı (tüm sayfalar için)
// header.html şablonunda profil menüsü kutusu yoktu ve logo yolu eskiydi (logo.jpg).
// Bu fonksiyonlar sayfa açılınca eksik menüyü oluşturur, logo bozuksa alternatif
// uzantıyı dener. Şablon/sayfalar sonradan düzeltilse de zararsızdır.
// ==========================================================
function renderProfileDropdowns(isRealUser) {
            document.querySelectorAll('.profile-dropdown').forEach(dropdown => {
                if (isRealUser) {
                    dropdown.innerHTML = '<a href="hesabim.html" class="dropdown-link">' +
                        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>' +
                        'Hesabım</a>' +
                        '<a href="#" onclick="if(typeof handleLogout === \'function\') { handleLogout(); } else if(firebase && firebase.auth) { firebase.auth().signOut().then(()=>{localStorage.removeItem(\'bayyildiz_cart\'); window.location.reload();}); } return false;" class="dropdown-link" style="color: #ef4444;">' +
                        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>' +
                        'Çıkış</a>';
                } else {
                    dropdown.innerHTML = '<a href="hesabim.html?tab=login" class="dropdown-link">' +
                        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>' +
                        'Giriş Yap</a>' +
                        '<a href="hesabim.html?tab=register" class="dropdown-link">' +
                        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>' +
                        'Kayıt Ol</a>';
                }
            });
}

function ensureProfileDropdown() {
    let created = false;
    document.querySelectorAll('.profile-btn').forEach(btn => {
        if (btn.closest('.profile-dropdown-wrapper')) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'profile-dropdown-wrapper';
        btn.parentNode.insertBefore(wrapper, btn);
        wrapper.appendChild(btn);
        const dd = document.createElement('div');
        dd.className = 'profile-dropdown';
        wrapper.appendChild(dd);
        created = true;
    });
    if (created) renderProfileDropdowns(!!window.__profileIsRealUser);
    return created;
}
window.ensureProfileDropdown = ensureProfileDropdown;

function adjustBodyForHeader() {
    const header = document.getElementById('site-header');
    if (!header) return;

    if (!window.__headerObserver) {
        window.__headerObserver = new ResizeObserver(entries => {
            const h = header.offsetHeight;
            
            
            // Find the main section to push down
            let mainEl = document.querySelector('body > section') || document.querySelector('body > main');
            
            if (mainEl) {
                
                if (mainEl.classList.contains('hero')) {
                    mainEl.style.setProperty('margin-top', h + 'px', 'important');
                    mainEl.style.setProperty('padding-top', '0px', 'important');
                } else {
                    mainEl.style.setProperty('padding-top', (h + 40) + 'px', 'important');
                    mainEl.style.setProperty('margin-top', '0px', 'important');
                }
            } else {
                
            }
        });
        window.__headerObserver.observe(header);
    }
}

function fixHeaderLogo() {
    document.querySelectorAll('img.navbar-logo').forEach(img => {
        const swap = () => {
            if (img.dataset.logoFallback) return;
            img.dataset.logoFallback = '1';
            const src = img.getAttribute('src') || '';
            if (/logo\.jpg/.test(src)) img.src = src.replace('logo.jpg', 'logo.webp');
            else if (/logo\.webp/.test(src)) img.src = src.replace('logo.webp', 'logo.jpg');
        };
        img.addEventListener('error', swap);
        if (img.complete && img.naturalWidth === 0) swap();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    ensureProfileDropdown();
    fixHeaderLogo();
    adjustBodyForHeader();
    adjustBodyForHeader();
    if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().onAuthStateChanged((user) => {
            const isRealUser = user && !user.isAnonymous && user.email !== 'sistem@bayyildiz-stoktakip.com';
            window.__profileIsRealUser = isRealUser;
            if (isRealUser && window.App && typeof window.App.syncUserData === 'function') {
                window.App.syncUserData(user.uid);
            }
            ensureProfileDropdown();
            renderProfileDropdowns(isRealUser);
        });
    }
});


window.addEventListener('load', () => { ensureProfileDropdown(); fixHeaderLogo(); });

// ==========================================================
// Mobil/dokunmatik cihazlarda profil menüsü
// Masaüstünde menü hover ile açılıyor; dokunmatik cihazlarda hover olmadığı için
// ikona dokunmak direkt hesabim.html'e götürüyordu. Burada ilk dokunuş menüyü
// açıp kapatıyor, menüdeki "Hesabım" / "Çıkış" bağlantıları normal çalışıyor.
// ==========================================================
(function initProfileMenuToggle() {
    // Aynı sayfada hem auth.js hem app.js yüklenirse kod ikinci kez çalışıp menüyü
    // açtığı gibi kapatmasın diye tek sefer çalışmasını garanti ediyoruz.
    if (window.__profileMenuToggleInit) return;
    window.__profileMenuToggleInit = true;
    let styleInjected = false;

    // CSS'teki mevcut ":hover" kurallarını ".open" sınıfı için kopyalar,
    // böylece menü mobilde masaüstündekiyle birebir aynı görünür.
    function injectOpenStyles() {
        if (styleInjected) return;
        styleInjected = true;
        let css = '';

        const collect = (rules, wrapMedia) => {
            for (const r of rules) {
                if (r.type === 1 && r.selectorText && r.selectorText.includes('profile-dropdown') && r.selectorText.includes(':hover')) {
                    let text = r.cssText.replace(/:hover/g, '.open');
                    css += wrapMedia ? '@media ' + wrapMedia + '{' + text + '}' : text;
                } else if (r.type === 4 && r.cssRules) { // @media
                    collect(r.cssRules, r.conditionText || (r.media && r.media.mediaText));
                }
            }
        };

        for (const sheet of document.styleSheets) {
            let rules;
            try { rules = sheet.cssRules; } catch (e) { continue; }
            if (rules) collect(rules, null);
        }

        // Hover kuralı bulunamazsa genel bir yedek kural kullan
        if (!css) {
            css = '.profile-dropdown-wrapper.open .profile-dropdown{opacity:1!important;visibility:visible!important;pointer-events:auto!important;}';
        }

        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    function closeAll() {
        document.querySelectorAll('.profile-dropdown-wrapper.open').forEach(w => {
            w.classList.remove('open');
            const dd = w.querySelector('.profile-dropdown');
            if (dd) dd.style.removeProperty('display');
        });
    }

    document.addEventListener('click', function (e) {
        const isTouch = window.innerWidth <= 992 || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
        const btn = e.target.closest('.profile-btn');

        if (btn && isTouch) {
            e.preventDefault(); // ilk dokunuşta sayfaya gitme, menüyü aç/kapat
            if (typeof window.ensureProfileDropdown === 'function') window.ensureProfileDropdown();
            injectOpenStyles();
            const wrapper = btn.closest('.profile-dropdown-wrapper');
            if (!wrapper) return;
            const wasOpen = wrapper.classList.contains('open');
            closeAll();
            if (!wasOpen) {
                wrapper.classList.add('open');
                const dd = wrapper.querySelector('.profile-dropdown');
                if (dd && getComputedStyle(dd).display === 'none') dd.style.display = 'block';
            }
            return;
        }

        // Menünün dışına dokunulursa kapat
        if (!e.target.closest('.profile-dropdown-wrapper')) closeAll();
    });
})();

// --- Site Duyuru Cubugu (Announcement Bar) ---

function initWhatsAppRedirect() {
    const checkFirebase = setInterval(() => {
        if (typeof firebase !== 'undefined' && typeof App !== 'undefined' && App.db) {
            clearInterval(checkFirebase);
            const dbPath = (App.DATA_PATH ? App.DATA_PATH : '_bayyildiz_secure_v1_A9xK2mP8') + '/webSettings';
            App.db.ref(dbPath).on('value', snap => {
                const config = snap.val();
                if (config && config.whatsapp) {
                    let waNum = config.whatsapp.replace(/[^0-9]/g, '');
                      if (waNum.startsWith('0')) waNum = '90' + waNum.substring(1);
                      else if (waNum.length === 10) waNum = '90' + waNum;
                    if (waNum) {
                        window.BAYYILDIZ_WA_NUMBER = waNum;
                        document.querySelectorAll('a[href*="wa.me"]').forEach(a => {
                            try {
                                const url = new URL(a.href);
                                if (url.pathname.length > 1) {
                                    url.pathname = '/' + waNum;
                                    a.href = url.toString();
                                }
                            } catch (e) {
                                if (a.href.includes('wa.me/')) {
                                    a.href = 'https://wa.me/' + waNum;
                                }
                            }
                        });
                    }
                }
            });
        }
    }, 500);
}

function initAnnouncementBar() {
    const header = document.getElementById('site-header');
    if (!header) return;
    
    if (document.getElementById('dynamic-announcement-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'dynamic-announcement-bar';
    bar.style.display = 'none';
    bar.style.position = 'relative';
    bar.style.padding = '8px 0px';
    bar.style.textAlign = 'left';
    bar.style.fontSize = '0.85rem';
    bar.style.fontWeight = '500';
    bar.style.overflow = 'hidden';
    bar.style.whiteSpace = 'nowrap';
    bar.style.transition = 'all 0.3s ease';
    bar.style.zIndex = '1000';
    bar.style.width = '100%';

    const marquee = document.createElement('div');
    marquee.id = 'announcement-marquee';
    
    if (!document.getElementById('marquee-style')) {
        const style = document.createElement('style');
        style.id = 'marquee-style';
        style.innerHTML = "\n" +
            "            @keyframes siteMarquee {\n" +
            "                0% { transform: translateX(0); }\n" +
            "                100% { transform: translateX(-100%); }\n" +
            "            }\n" +
            "            .site-marquee-anim {\n" +
            "                display: inline-block;\n" +
            "                padding-left: 100%;\n" +
            "                animation: siteMarquee 15s linear infinite;\n" +
            "            }\n" +
            "            .site-marquee-anim:hover {\n" +
            "                animation-play-state: paused;\n" +
            "            }\n" +
            "            .site-marquee-anim a {\n" +
            "                text-decoration: none;\n" +
            "                font-weight: 700;\n" +
            "            }\n" +
            "            .site-marquee-anim a:hover {\n" +
            "                opacity: 0.8;\n" +
            "            }\n";
        document.head.appendChild(style);
    }
    
    marquee.className = 'site-marquee-anim';
    
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.position = 'absolute';
    closeBtn.style.right = '10px';
    closeBtn.style.top = '50%';
    closeBtn.style.transform = 'translateY(-50%)';
    closeBtn.style.background = 'none';
    closeBtn.style.border = 'none';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '16px';
    closeBtn.style.padding = '4px';
    closeBtn.style.display = 'flex';
    closeBtn.style.alignItems = 'center';
    closeBtn.style.justifyContent = 'center';
    closeBtn.style.zIndex = '10';
    
    closeBtn.onclick = () => {
        bar.style.display = 'none';
        bar.dataset.closedByUser = "true";
    };

    bar.appendChild(marquee);
    bar.appendChild(closeBtn);
    
    header.insertBefore(bar, header.firstChild);

    let prevShowState = null;

    const checkFirebase = setInterval(() => {
        if (typeof firebase !== 'undefined' && typeof App !== 'undefined' && App.db) {
            clearInterval(checkFirebase);
            const dbPath = (App.DATA_PATH ? App.DATA_PATH : '_bayyildiz_secure_v1_A9xK2mP8') + '/webSettings';
            App.db.ref(dbPath).on('value', snap => {
                let config = snap.val();
                
                if (!config) return;
                
                if (prevShowState !== null && prevShowState === false && config.show === true) {
                    bar.dataset.closedByUser = "false";
                }
                prevShowState = config.show;

                if (config && config.show && bar.dataset.closedByUser !== "true") {
                    bar.style.display = 'block';
                    bar.style.backgroundColor = config.backgroundColor || '#ef4444';
                    bar.style.color = config.textColor || '#ffffff';
                    closeBtn.style.color = config.textColor || '#ffffff';
                    
                    let text = config.text || '';
                    text = text.replace(/,/g, ',&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;');
                    const linkRegex = /\[(.*?)\]\((.*?)\)/g;
                    text = text.replace(linkRegex, '<a href="$2" target="_blank" style="color: inherit;">$1</a>');

                    marquee.innerHTML = "<span>" + text + "</span>";
                    
                    if (config.speed) {
                        marquee.style.animationDuration = config.speed + 's';
                    }
                } else {
                    bar.style.display = 'none';
                }
            });
        }
    }, 500);
}

// --- Site Pop-up (Karşılama Ekranı) ---
function initPopup() {
    if (document.getElementById('dynamic-site-popup')) return;

    const overlay = document.createElement('div');
    overlay.id = 'dynamic-site-popup';
    overlay.style.display = 'none';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
    overlay.style.zIndex = '99999';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    
    const modal = document.createElement('div');
    modal.style.position = 'relative';
    modal.style.width = '90%';
    modal.style.maxWidth = '450px';
    modal.style.borderRadius = '12px';
    modal.style.overflow = 'hidden';
    modal.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.25)';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.position = 'absolute';
    closeBtn.style.right = '12px';
    closeBtn.style.top = '12px';
    closeBtn.style.background = 'rgba(255,255,255,0.7)';
    closeBtn.style.color = '#000';
    closeBtn.style.border = 'none';
    closeBtn.style.borderRadius = '50%';
    closeBtn.style.width = '32px';
    closeBtn.style.height = '32px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '16px';
    closeBtn.style.fontWeight = 'bold';
    closeBtn.style.display = 'flex';
    closeBtn.style.alignItems = 'center';
    closeBtn.style.justifyContent = 'center';
    closeBtn.style.zIndex = '10';
    closeBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    
    closeBtn.onclick = () => {
        overlay.style.display = 'none';
        sessionStorage.setItem('site_popup_closed', 'true');
    };
    
    overlay.onclick = (e) => {
        if(e.target === overlay) closeBtn.onclick();
    };

    const imgContainer = document.createElement('div');
    imgContainer.style.width = '100%';
    imgContainer.style.display = 'none';
    imgContainer.style.backgroundColor = 'rgba(0,0,0,0.02)';
    
    const img = document.createElement('img');
    img.style.width = '100%';
    img.style.height = 'auto';
    img.style.display = 'block';
    img.style.maxHeight = '40vh';
    img.style.objectFit = 'contain';
    imgContainer.appendChild(img);

    const contentBox = document.createElement('div');
    contentBox.style.padding = '32px 24px 24px';
    contentBox.style.textAlign = 'center';
    
    const title = document.createElement('h2');
    title.style.marginTop = '0';
    title.style.marginBottom = '12px';
    title.style.fontSize = '1.4rem';
    title.style.fontWeight = '700';
    
    const text = document.createElement('p');
    text.style.margin = '0 0 24px 0';
    text.style.lineHeight = '1.6';
    text.style.whiteSpace = 'pre-wrap';
    text.style.fontSize = '0.95rem';
    
    const btn = document.createElement('a');
    btn.style.display = 'inline-block';
    btn.style.padding = '12px 32px';
    btn.style.borderRadius = '8px';
    btn.style.textDecoration = 'none';
    btn.style.fontWeight = 'bold';
    btn.style.fontSize = '1rem';
    btn.style.transition = 'opacity 0.2s';
    
    contentBox.appendChild(title);
    contentBox.appendChild(text);
    contentBox.appendChild(btn);
    
    modal.appendChild(imgContainer);
    modal.appendChild(closeBtn);
    modal.appendChild(contentBox);
    overlay.appendChild(modal);
    
    document.body.appendChild(overlay);

    let prevShowState = null;

    const checkFirebase = setInterval(() => {
        if (typeof firebase !== 'undefined' && typeof App !== 'undefined' && App.db) {
            clearInterval(checkFirebase);
            const dbPath = (App.DATA_PATH ? App.DATA_PATH : '_bayyildiz_secure_v1_A9xK2mP8') + '/webSettings';
            App.db.ref(dbPath).on('value', snap => {
                const config = snap.val();
                if (!config || !config.popup) {
                    overlay.style.display = 'none';
                    return;
                }
                
                const p = config.popup;
                
                if (prevShowState === false && p.show === true) {
                    sessionStorage.removeItem('site_popup_closed');
                }
                prevShowState = p.show;

                if (p.show && sessionStorage.getItem('site_popup_closed') !== 'true') {
                    modal.style.backgroundColor = p.backgroundColor || '#ffffff';
                    title.style.color = p.textColor || '#000000';
                    text.style.color = p.textColor || '#000000';
                    
                    if (p.image) {
                        img.src = p.image;
                        imgContainer.style.display = 'block';
                    } else {
                        imgContainer.style.display = 'none';
                    }
                    
                    title.innerText = p.title || '';
                    title.style.display = p.title ? 'block' : 'none';
                    
                    text.innerText = p.text || '';
                    text.style.display = p.text ? 'block' : 'none';
                    
                    if (p.btnText) {
                        btn.innerText = p.btnText;
                        btn.href = p.btnLink || '#';
                        btn.style.backgroundColor = p.btnColor || '#ef4444';
                        btn.style.color = '#ffffff';
                        btn.style.display = 'inline-block';
                    } else {
                        btn.style.display = 'none';
                    }
                    
                    overlay.style.display = 'flex';
                } else {
                    overlay.style.display = 'none';
                }
            });
        }
    }, 500);
}

// --- Site Dynamic Slider ---
function initDynamicSlider() {
    const sliderContainer = document.getElementById('hero-slider');
    const dotsContainer = document.getElementById('slider-dots');
    const prevBtn = document.getElementById('slider-prev');
    const nextBtn = document.getElementById('slider-next');
    if (!sliderContainer) return;

    let currentSlide = 0;
    let slideInterval;
    
    function resetInterval(nextSlideFn) {
        if (slideInterval) clearInterval(slideInterval);
        slideInterval = setInterval(nextSlideFn, 4000);
    }
    
    function renderSlides(slidesData) {
        if (!slidesData || slidesData.length === 0) return; // leave original static slider
        
        sliderContainer.innerHTML = '';
        if (dotsContainer) dotsContainer.innerHTML = '';
        
        slidesData.forEach((slide, i) => {
            const slideDiv = document.createElement('div');
            slideDiv.className = `slide ${i === 0 ? 'active' : ''}`;
            
            const isVideo = slide.url && slide.url.match(/\.(mp4|webm|ogg)$/i);
            
            if (isVideo) {
                slideDiv.innerHTML = `<video src="${slide.url}" autoplay loop muted playsinline style="width: 100%; height: 100%; object-fit: cover; position: absolute; top:0; left:0;"></video>`;
            } else {
                slideDiv.style.backgroundImage = `url('${slide.url}')`;
                slideDiv.style.backgroundSize = 'cover';
                slideDiv.style.backgroundPosition = 'center';
            }
            
            if (slide.link) {
                slideDiv.style.cursor = 'pointer';
                slideDiv.onclick = () => window.location.href = slide.link;
            }
            
            sliderContainer.appendChild(slideDiv);
            
            if (dotsContainer) {
                const dot = document.createElement('div');
                dot.className = `slider-dot ${i === 0 ? 'active' : ''}`;
                dot.onclick = () => goToSlide(i);
                dotsContainer.appendChild(dot);
            }
        });
        
        currentSlide = 0;
    }
    
    function goToSlide(n) {
        const slides = sliderContainer.querySelectorAll('.slide');
        if (slides.length === 0) return;
        
        const dots = dotsContainer ? dotsContainer.querySelectorAll('.slider-dot') : [];
        
        if (slides[currentSlide]) slides[currentSlide].classList.remove('active');
        if (dots[currentSlide]) dots[currentSlide].classList.remove('active');
        
        currentSlide = (n + slides.length) % slides.length;
        
        if (slides[currentSlide]) slides[currentSlide].classList.add('active');
        if (dots[currentSlide]) dots[currentSlide].classList.add('active');
    }
    
    function nextSlide() { goToSlide(currentSlide + 1); }
    function prevSlide() { goToSlide(currentSlide - 1); }
    
    // Replace buttons to clear old event listeners
    if (prevBtn) {
        const newPrev = prevBtn.cloneNode(true);
        prevBtn.parentNode.replaceChild(newPrev, prevBtn);
        newPrev.addEventListener('click', () => { prevSlide(); resetInterval(nextSlide); });
    }
    if (nextBtn) {
        const newNext = nextBtn.cloneNode(true);
        nextBtn.parentNode.replaceChild(newNext, nextBtn);
        newNext.addEventListener('click', () => { nextSlide(); resetInterval(nextSlide); });
    }
    
    resetInterval(nextSlide);

    const checkFirebase = setInterval(() => {
        if (typeof firebase !== 'undefined' && typeof App !== 'undefined' && App.db) {
            clearInterval(checkFirebase);
            const dbPath = (App.DATA_PATH ? App.DATA_PATH : '_bayyildiz_secure_v1_A9xK2mP8') + '/webSettings';
            App.db.ref(dbPath).on('value', snap => {
                const config = snap.val();
                if (config && config.slider && config.slider.length > 0) {
                    renderSlides(config.slider.filter(s => s.url));
                }
            });
        }
    }, 500);
}


  if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
          initAnnouncementBar();
          initWhatsAppRedirect();
          initPopup();
          initDynamicSlider();
      });
  } else {
      initAnnouncementBar();
      initWhatsAppRedirect();
      initPopup();
      initDynamicSlider();
  }


// Append to the end of app.js
window.AuthModal = {
  injected: false,
  isLoginMode: true,
  inject() {
    if (this.injected) return;
    const style = document.createElement('style');
    style.textContent = `
      .auth-modal-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        z-index: 9999999; opacity: 0; visibility: hidden; transition: 0.3s ease;
      }
      .auth-modal-overlay.active { opacity: 1; visibility: visible; }
      .auth-modal-box {
        background: #fff; width: 90%; max-width: 420px; border-radius: 1.5rem;
        padding: 2.5rem; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);
        transform: translateY(30px) scale(0.95); transition: 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        position: relative;
      }
      .auth-modal-overlay.active .auth-modal-box { transform: translateY(0) scale(1); }
      .auth-modal-close {
        position: absolute; top: 1rem; right: 1rem; background: #f1f5f9; border: none;
        width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
        cursor: pointer; color: #64748b; transition: 0.2s;
      }
      .auth-modal-close:hover { background: #e2e8f0; color: #0f172a; }
      .auth-modal-title { font-size: 1.5rem; font-weight: 700; color: #0f172a; margin-bottom: 0.5rem; text-align: center; }
      .auth-modal-desc { font-size: 0.95rem; color: #64748b; text-align: center; margin-bottom: 1.5rem; }
      .auth-form-group { margin-bottom: 1.25rem; text-align: left; }
      .auth-form-group label { display: block; font-size: 0.85rem; font-weight: 600; color: #334155; margin-bottom: 0.5rem; }
      .auth-form-group input { width: 100%; padding: 0.85rem 1rem; border: 1px solid #cbd5e1; border-radius: 0.75rem; background: #f8fafc; font-family: inherit; font-size: 0.95rem; color: #0f172a; transition: 0.2s; outline: none; }
      .auth-form-group input:focus { border-color: #3b82f6; background: #fff; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
      .auth-submit-btn {
        width: 100%; padding: 1rem; background: #0f172a; color: #fff; border: none;
        border-radius: 0.75rem; font-weight: 600; font-size: 1rem; cursor: pointer; transition: 0.2s;
        margin-top: 0.5rem;
      }
      .auth-submit-btn:hover { background: #1e293b; transform: translateY(-2px); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
      .auth-submit-btn:disabled { background: #94a3b8; cursor: not-allowed; transform: none; box-shadow: none; }
      .auth-toggle-text { text-align: center; margin-top: 1.5rem; font-size: 0.9rem; color: #64748b; }
      .auth-toggle-link { color: #3b82f6; font-weight: 600; text-decoration: none; cursor: pointer; }
      .auth-toggle-link:hover { text-decoration: underline; }
      .auth-error { color: #ef4444; font-size: 0.85rem; text-align: center; margin-bottom: 1rem; display: none; font-weight: 500; background: #fef2f2; padding: 0.75rem; border-radius: 0.5rem; }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'auth-modal-overlay';
    overlay.id = 'global-auth-modal';
    overlay.innerHTML = `
      <div class="auth-modal-box">
        <button class="auth-modal-close" id="auth-modal-close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
        <div class="auth-modal-title" id="auth-modal-title">Giriş Yap</div>
        <div class="auth-modal-desc" id="auth-modal-desc">Hesabınıza giriş yaparak alışverişe devam edin.</div>
        <div id="auth-modal-error" class="auth-error"></div>
        <form id="global-auth-form">
          <div id="auth-modal-register-fields" style="display: none;">
            <div class="auth-form-group">
              <label>İsim Soyisim</label>
              <input type="text" id="auth-modal-name" placeholder="Adınız Soyadınız">
            </div>
            <div class="auth-form-group">
              <label>Cep Telefonu</label>
              <input type="tel" id="auth-modal-phone" placeholder="05xx xxx xx xx">
            </div>
          </div>
          <div class="auth-form-group">
            <label>E-posta Adresi</label>
            <input type="email" id="auth-modal-email" required placeholder="ornek@email.com">
          </div>
          <div class="auth-form-group">
            <div style="display: flex; justify-content: space-between;">
              <label>Şifreniz</label>
              <a href="#" onclick="event.preventDefault(); const am = document.getElementById('auth-modal-overlay'); if(am) am.remove(); window.handleForgotPassword();" style="font-size: 0.8rem; color: #3b82f6; text-decoration: none;" class="no-intercept" id="auth-modal-forgot">Şifremi Unuttum?</a>
            </div>
            <input type="password" id="auth-modal-password" required minlength="6" placeholder="••••••••">
          </div>
          <button type="submit" class="auth-submit-btn" id="auth-modal-submit">Giriş Yap</button>
        </form>
        <div class="auth-toggle-text">
          <span id="auth-modal-toggle-msg">Hesabınız yok mu?</span>
          <a class="auth-toggle-link" id="auth-modal-toggle">Kayıt Olun</a>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('auth-modal-close').addEventListener('click', () => this.close());
    overlay.addEventListener('click', (e) => { if(e.target === overlay) this.close(); });
    
    document.getElementById('auth-modal-toggle').addEventListener('click', () => this.toggleMode());
    document.getElementById('global-auth-form').addEventListener('submit', (e) => this.submit(e));

    this.injected = true;
  },

  open(mode = 'login') {
    this.inject();
    this.isLoginMode = (mode === 'login');
    this.updateUI();
    document.getElementById('global-auth-modal').classList.add('active');
    document.getElementById('auth-modal-error').style.display = 'none';
  },

  close() {
    if(!this.injected) return;
    document.getElementById('global-auth-modal').classList.remove('active');
  },

  toggleMode() {
    this.isLoginMode = !this.isLoginMode;
    this.updateUI();
    document.getElementById('auth-modal-error').style.display = 'none';
  },

  updateUI() {
    const title = document.getElementById('auth-modal-title');
    const desc = document.getElementById('auth-modal-desc');
    const regFields = document.getElementById('auth-modal-register-fields');
    const submitBtn = document.getElementById('auth-modal-submit');
    const toggleMsg = document.getElementById('auth-modal-toggle-msg');
    const toggleLink = document.getElementById('auth-modal-toggle');
    const forgot = document.getElementById('auth-modal-forgot');

    if (this.isLoginMode) {
      title.innerText = 'Giriş Yap';
      desc.innerText = 'Hesabınıza giriş yaparak alışverişe devam edin.';
      regFields.style.display = 'none';
      submitBtn.innerText = 'Giriş Yap';
      toggleMsg.innerText = 'Hesabınız yok mu?';
      toggleLink.innerText = 'Kayıt Olun';
      forgot.style.display = 'block';
      document.getElementById('auth-modal-name').removeAttribute('required');
      document.getElementById('auth-modal-phone').removeAttribute('required');
    } else {
      title.innerText = 'Kayıt Ol';
      desc.innerText = 'Saniyeler içinde yeni bir hesap oluşturun.';
      regFields.style.display = 'block';
      submitBtn.innerText = 'Ücretsiz Kayıt Ol';
      toggleMsg.innerText = 'Zaten hesabınız var mı?';
      toggleLink.innerText = 'Giriş Yapın';
      forgot.style.display = 'none';
      document.getElementById('auth-modal-name').setAttribute('required', 'true');
      document.getElementById('auth-modal-phone').setAttribute('required', 'true');
    }
  },

  showError(msg) {
    const err = document.getElementById('auth-modal-error');
    err.innerText = msg;
    err.style.display = 'block';
  },

  async submit(e) {
    e.preventDefault();
    if (typeof firebase === 'undefined' || !firebase.auth) {
      this.showError("Bağlantı hatası. Lütfen sayfayı yenileyin.");
      return;
    }

    const email = document.getElementById('auth-modal-email').value.trim();
    const password = document.getElementById('auth-modal-password').value;
    const submitBtn = document.getElementById('auth-modal-submit');
    
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="loader-spinner" style="width:20px;height:20px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:8px;"></div> Bekleyin...';
    document.getElementById('auth-modal-error').style.display = 'none';

    try {
      if (this.isLoginMode) {
        if (!email.includes('@')) {
           throw { code: 'auth/invalid-email', message: 'Lütfen geçerli bir e-posta adresi girin.' };
        }
        await firebase.auth().signInWithEmailAndPassword(email, password);
        if(window.App && window.App.toast) window.App.toast("Başarıyla giriş yapıldı!", "success");
        setTimeout(() => window.location.href = "hesabim.html", 1000);
      } else {
        const name = document.getElementById('auth-modal-name').value.trim();
        const phone = document.getElementById('auth-modal-phone').value.trim();
        
        const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
        if (userCredential.user) {
          try {
             await userCredential.user.sendEmailVerification();
             if(window.App && window.App.toast) window.App.toast("Kayıt başarılı! Lütfen e-postanıza gelen onay linkine tıklayın.", "info");
          } catch(err) {}

          let dbPath = (window.App && window.App.DATA_PATH ? window.App.DATA_PATH : '_bayyildiz_secure_v1_A9xK2mP8') + '/customers/' + userCredential.user.uid;
          try {
             await firebase.database().ref(dbPath).set({
                 name, isimSoyisim: name, adSoyad: name, telefon: phone, phone: phone,
                 email, kayitTarihi: new Date().toISOString(), createdAt: new Date().toISOString(),
                 status: 'new', source: 'web_register_modal'
             });
          } catch(dbErr) {}
        }
        setTimeout(() => window.location.href = "hesabim.html", 1500);
      }
    } catch (error) {
        let msg = "Bir hata oluştu.";
        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential' || error.code === 'auth/invalid-login-credentials') msg = "Giriş bilgileri hatalı.";
        else if (error.code === 'auth/email-already-in-use') msg = "Bu e-posta adresi zaten kullanılıyor.";
        else if (error.code === 'auth/weak-password') msg = "Şifreniz en az 6 karakter olmalıdır.";
        else if (error.message) msg = error.message;
        
        this.showError(msg);
        submitBtn.disabled = false;
        submitBtn.innerHTML = this.isLoginMode ? 'Giriş Yap' : 'Ücretsiz Kayıt Ol';
    }
  }
};

// Intercept all hesabim.html clicks
document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href*="hesabim.html"]');
    if (!link) return;
    
    // Check if the link specifically goes to # or is a logout link
    if (link.getAttribute('onclick') && link.getAttribute('onclick').includes('handleLogout')) return;

    // If user is already logged in, let them go to Hesabım page normally
    if (window.__profileIsRealUser) return;
    
    // IF NOT LOGGED IN -> Show global Auth Modal!
    e.preventDefault();
    const href = link.getAttribute('href');
    const mode = href.includes('register') ? 'register' : 'login';
    window.AuthModal.open(mode);
});


// Sipariş Takip Enter ile sorgulama
document.addEventListener('DOMContentLoaded', () => {
    const trackInput = document.getElementById('track-order-input');
    if (trackInput) {
        trackInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (window.App && typeof window.App.trackOrder === 'function') {
                    window.App.trackOrder();
                }
            }
        });
    }
});


// --- FORGOT PASSWORD MODAL ---
window.handleForgotPassword = function() {
    const existingModal = document.getElementById("forgot-password-modal-overlay");
    if (existingModal) existingModal.remove();

    const overlay = document.createElement("div");
    overlay.id = "forgot-password-modal-overlay";
    overlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.8); z-index:9999999; display:flex; align-items:center; justify-content:center; padding:15px; opacity:0; transition:opacity 0.3s ease;";

    const modal = document.createElement("div");
    modal.style.cssText = "background:#fff; width:100%; max-width:400px; border-radius:12px; padding:2.5rem; box-shadow:0 20px 25px -5px rgba(0,0,0,0.1); position:relative; transform:translateY(20px); transition:transform 0.3s ease; text-align:center;";

    modal.innerHTML = `
        <button id="fp-close-btn" style="position:absolute; top:15px; right:15px; background:none; border:none; cursor:pointer; padding:8px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#64748b; transition:all 0.2s;" onmouseover="this.style.background='#f1f5f9';this.style.color='#0f172a'" onmouseout="this.style.background='none';this.style.color='#64748b'">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
        <div style="width:56px; height:56px; border-radius:50%; background:#eff6ff; display:flex; align-items:center; justify-content:center; margin:0 auto 1.25rem auto; color:#3b82f6;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        </div>
        <h3 style="margin:0 0 0.5rem 0; font-size:1.35rem; font-weight:700; color:#0f172a;">&#350;ifrenizi mi Unuttunuz?</h3>
        <p style="margin:0 0 1.5rem 0; font-size:0.9rem; color:#64748b; line-height:1.5;">L&#252;tfen sisteme kay&#305;tl&#305; e-posta adresinizi girin. Size bir s&#305;f&#305;rlama ba&#287;lant&#305;s&#305; g&#246;nderece&#287;iz.</p>
        
        <form id="fp-form" style="text-align:left;">
            <div style="margin-bottom:1.5rem;">
                <label style="display:block; margin-bottom:0.5rem; font-size:0.85rem; font-weight:600; color:#475569;">E-posta Adresi</label>
                <input type="email" id="fp-email" required placeholder="ornek@email.com" style="width:100%; padding:0.85rem 1rem; border:1px solid #cbd5e1; border-radius:8px; font-size:0.95rem; outline:none; transition:border-color 0.2s; box-sizing:border-box;" onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#cbd5e1'">
            </div>
            <button type="submit" id="fp-submit-btn" style="width:100%; padding:0.9rem; background:#0f172a; color:#fff; border:none; border-radius:8px; font-weight:600; cursor:pointer; font-size:1rem; transition:background 0.2s;" onmouseover="this.style.background='#1e293b'" onmouseout="this.style.background='#0f172a'">Ba&#287;lant&#305;y&#305; G&#246;nder</button>
        </form>
        <div id="fp-message" style="margin-top:1rem; font-size:0.85rem; display:none; padding:0.75rem; border-radius:6px; line-height:1.5;"></div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    setTimeout(() => {
        overlay.style.opacity = "1";
        modal.style.transform = "translateY(0)";
    }, 10);

    const closeFn = () => {
        overlay.style.opacity = "0";
        modal.style.transform = "translateY(20px)";
        setTimeout(() => overlay.remove(), 300);
    };

    document.getElementById("fp-close-btn").addEventListener("click", closeFn);
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeFn();
    });

    document.getElementById("fp-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("fp-email").value.trim();
        const btn = document.getElementById("fp-submit-btn");
        const msg = document.getElementById("fp-message");

        if (!email) return;

        btn.disabled = true;
        btn.textContent = "G&#246;nderiliyor...";
        btn.style.opacity = "0.7";

        if (typeof firebase === "undefined" || !firebase.auth) {
            msg.style.display = "block";
            msg.style.backgroundColor = "#fee2e2";
            msg.style.color = "#b91c1c";
            msg.innerHTML = "Ba&#287;lant&#305; hatas&#305;. L&#252;tfen sayfay&#305; yenileyin.";
            btn.disabled = false;
            btn.innerHTML = "Ba&#287;lant&#305;y&#305; G&#246;nder";
            btn.style.opacity = "1";
            return;
        }

        try {
            await firebase.auth().sendPasswordResetEmail(email);
            msg.style.display = "block";
            msg.style.backgroundColor = "#dcfce3";
            msg.style.color = "#166534";
            msg.innerHTML = "&#350;ifre s&#305;f&#305;rlama ba&#287;lant&#305;s&#305; e-posta adresinize g&#246;nderildi. L&#252;tfen gelen kutunuzu (ve Spam klas&#246;r&#252;n&#252;) kontrol edin.";
            btn.style.display = "none";
        } catch (error) {
            msg.style.display = "block";
            msg.style.backgroundColor = "#fee2e2";
            msg.style.color = "#b91c1c";
            if (error.code === "auth/user-not-found") {
                msg.innerHTML = "Bu e-posta adresiyle kay&#305;tl&#305; bir hesap bulunamad&#305;.";
            } else if (error.code === "auth/invalid-email") {
                msg.innerHTML = "L&#252;tfen ge&#231;erli bir e-posta adresi girin.";
            } else {
                msg.innerHTML = "Bir hata olu&#351;tu: " + error.message;
            }
            btn.disabled = false;
            btn.innerHTML = "Ba&#287;lant&#305;y&#305; G&#246;nder";
            btn.style.opacity = "1";
        }
    });
};
