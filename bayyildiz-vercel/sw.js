// FIX: Sürüm artırıldı (v4). Yeni service worker aktif olunca eski önbellekler
// (içinde bozuk/404 cevaplar kalmış olabilir) tüm cihazlarda otomatik silinir.
const CACHE_NAME = 'bayyildiz-v5';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.min.css',
  '/css/cart.min.css',
  '/img/logo.webp',
  '/manifest.json'
];

// FIX: Sadece başarılı (200) ve aynı kaynaktan gelen cevapları önbelleğe al.
// Eskiden 404 gibi hatalı cevaplar da saklanıyor, resimler için "önce önbellek"
// kuralı yüzünden dosya sonradan düzelse bile telefon bozuk cevabı göstermeye
// devam ediyordu.
function cachePut(request, response) {
  if (response && response.status === 200 && response.type === 'basic') {
    const clone = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(request, clone)).catch(() => {});
  }
}

// Install: her dosyayı ayrı ayrı önbelleğe almayı dene, biri eksikse diğerleri devam etsin
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(err => {
            console.warn('[sw.js] Önbelleğe alınamadı, atlanıyor:', url, err);
          })
        )
      ))
      .then(() => self.skipWaiting())
  );
});

// Activate: eski önbellekleri temizle
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // GET olmayan ve başka kaynaktan gelen istekleri karıştırma
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // HTML sayfaları: önce ağ, olmazsa önbellek
  if (url.pathname.endsWith('/') || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          cachePut(event.request, response);
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // JS/CSS: önbellekten hızlı sun, arkada güncelle
  if (url.pathname.match(/\.(css|js)$/)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fetchPromise = fetch(event.request).then(networkResponse => {
          cachePut(event.request, networkResponse);
          return networkResponse;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Resim/font: önce önbellek, yoksa ağ (sadece başarılı cevaplar saklanır)
  if (url.pathname.match(/\.(jpg|jpeg|png|webp|svg|woff2?)$/)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request).then(response => {
          cachePut(event.request, response);
          return response;
        });
      })
    );
    return;
  }

  // Diğer her şey: önce ağ, olmazsa önbellek
  event.respondWith(
    fetch(event.request)
      .then(response => {
        cachePut(event.request, response);
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
