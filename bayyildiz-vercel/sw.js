// FIX: SÃƒÆ’Ã‚Â¼rÃƒÆ’Ã‚Â¼m artÃƒâ€Ã‚Â±rÃƒâ€Ã‚Â±ldÃƒâ€Ã‚Â± (v4). Yeni service worker aktif olunca eski ÃƒÆ’Ã‚Â¶nbellekler
// (iÃƒÆ’Ã‚Â§inde bozuk/404 cevaplar kalmÃƒâ€Ã‚Â±Ãƒâ€¦Ã…Â¸ olabilir) tÃƒÆ’Ã‚Â¼m cihazlarda otomatik silinir.
const CACHE_NAME = 'bayyildiz-v6';
const STATIC_ASSETS = [
  '/',
  '/css/style.min.css',
  '/css/cart.min.css',
  '/img/logo.webp',
  '/manifest.json'
];

// FIX: Sadece baÃƒâ€¦Ã…Â¸arÃƒâ€Ã‚Â±lÃƒâ€Ã‚Â± (200) ve aynÃƒâ€Ã‚Â± kaynaktan gelen cevaplarÃƒâ€Ã‚Â± ÃƒÆ’Ã‚Â¶nbelleÃƒâ€Ã…Â¸e al.
// Eskiden 404 gibi hatalÃƒâ€Ã‚Â± cevaplar da saklanÃƒâ€Ã‚Â±yor, resimler iÃƒÆ’Ã‚Â§in "ÃƒÆ’Ã‚Â¶nce ÃƒÆ’Ã‚Â¶nbellek"
// kuralÃƒâ€Ã‚Â± yÃƒÆ’Ã‚Â¼zÃƒÆ’Ã‚Â¼nden dosya sonradan dÃƒÆ’Ã‚Â¼zelse bile telefon bozuk cevabÃƒâ€Ã‚Â± gÃƒÆ’Ã‚Â¶stermeye
// devam ediyordu.
function cachePut(request, response) {
  if (response && response.status === 200 && response.type === 'basic') {
    const clone = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(request, clone)).catch(() => {});
  }
}

// Install: her dosyayÃƒâ€Ã‚Â± ayrÃƒâ€Ã‚Â± ayrÃƒâ€Ã‚Â± ÃƒÆ’Ã‚Â¶nbelleÃƒâ€Ã…Â¸e almayÃƒâ€Ã‚Â± dene, biri eksikse diÃƒâ€Ã…Â¸erleri devam etsin
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(err => {
            console.warn('[sw.js] ÃƒÆ’Ã¢â‚¬â€œnbelleÃƒâ€Ã…Â¸e alÃƒâ€Ã‚Â±namadÃƒâ€Ã‚Â±, atlanÃƒâ€Ã‚Â±yor:', url, err);
          })
        )
      ))
      .then(() => self.skipWaiting())
  );
});

// Activate: eski ÃƒÆ’Ã‚Â¶nbellekleri temizle
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

  // GET olmayan ve baÃƒâ€¦Ã…Â¸ka kaynaktan gelen istekleri karÃƒâ€Ã‚Â±Ãƒâ€¦Ã…Â¸tÃƒâ€Ã‚Â±rma
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // HTML sayfalarÃƒâ€Ã‚Â±: ÃƒÆ’Ã‚Â¶nce aÃƒâ€Ã…Â¸, olmazsa ÃƒÆ’Ã‚Â¶nbellek
  if (url.pathname.endsWith('/') || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          cachePut(event.request, response);
          return response;
        })
        .catch(() => caches.match(event.request).then(res => res || new Response('Offline - Baglanti Hatasi', {status: 503})))
    );
    return;
  }

  // JS/CSS: ÃƒÆ’Ã‚Â¶nbellekten hÃƒâ€Ã‚Â±zlÃƒâ€Ã‚Â± sun, arkada gÃƒÆ’Ã‚Â¼ncelle
  if (url.pathname.match(/\.(css|js)$/)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fetchPromise = fetch(event.request).then(networkResponse => {
          cachePut(event.request, networkResponse);
          return networkResponse;
        }).catch(() => cached || new Response('', {status: 503}));
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Resim/font: ÃƒÆ’Ã‚Â¶nce ÃƒÆ’Ã‚Â¶nbellek, yoksa aÃƒâ€Ã…Â¸ (sadece baÃƒâ€¦Ã…Â¸arÃƒâ€Ã‚Â±lÃƒâ€Ã‚Â± cevaplar saklanÃƒâ€Ã‚Â±r)
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

    // API isteklerini asla ÃƒÆ’Ã‚Â¶nbelleÃƒâ€Ã…Â¸e alma (KVKK)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // DiÃƒâ€Ã…Â¸er her Ãƒâ€¦Ã…Â¸ey
  event.respondWith(
    fetch(event.request)
      .then(response => {
        cachePut(event.request, response);
        return response;
      })
      .catch(() => caches.match(event.request).then(res => res || new Response('Offline - Baglanti Hatasi', {status: 503})))
  );
});
