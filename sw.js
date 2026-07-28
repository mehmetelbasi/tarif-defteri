const CACHE = 'tarif-defteri-v1';
const STATIC = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Nunito:wght@400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.0/dist/umd/supabase.js'
];

// Kurulum: statik dosyaları cache'le
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC))
      .then(() => self.skipWaiting())
  );
});

// Aktifleştirme: eski cache'leri sil
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: önce network, olmadıysa cache
self.addEventListener('fetch', e => {
  // Supabase API isteklerini cache'leme
  if (e.request.url.includes('supabase.co')) {
    e.respondWith(
      fetch(e.request)
        .catch(() => new Response(
          JSON.stringify({ error: 'Çevrimdışı' }),
          { headers: { 'Content-Type': 'application/json' } }
        ))
    );
    return;
  }

  // Diğer istekler: network first, cache fallback
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Başarılı yanıtı cache'e kaydet
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request)
        .then(cached => cached || caches.match('./index.html'))
      )
  );
});
