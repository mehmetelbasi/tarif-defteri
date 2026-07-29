const { createClient } = supabase;
const SB_URL = 'https://zgxucheohvezwtfzeaua.supabase.co';
const SB_KEY = 'sb_publishable_AkdkF3EJ2mlguvi3UU6fjw_xAz0nINq';
const sb = createClient(SB_URL, SB_KEY);

// Üye adından, Supabase Auth için sahte (gerçek e-posta olmayan) bir kimlik üretir
function memberEmail(name) {
  return normalize(name).replace(/\s+/g,'.') + '@aile.local';
}

const catEmoji = {
  'Sabah Kahvaltısı':'🍳','Çorba':'🍜','Salata':'🥗','Zeytinyağlılar':'🫒',
  'Etli Yemekler':'🥩','Tavuk Yemekleri':'🍗','Balık & Deniz Ürünleri':'🐟',
  'Sebze Yemekleri':'🥦','Baklagiller':'🫘','Pilav & Makarna':'🍝',
  'Börek & Hamur İşleri':'🥐','Tatlı & Pasta':'🍰','Turşu & Konserve':'🫙',
  'İçecek':'🧃','Diğer':'🍴'
};
const PAGE_SIZE = 20;
const SESSION_KEY = 'tarif_session';

let recipes=[], members=[], currentCat='', currentTag='', currentSort='new', currentPage=1;
let editingId=null, detailId=null, currentUser=null, formTags=[], importList2=[], searchTimer=null;
let commentCounts = {};
let filterStateRestored = false;

const LAST_SEEN_KEY = 'tarif_last_seen';

function checkNewRecipes() {
  const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
  if (!lastSeen || !recipes.length) return;

  const lastSeenDate = new Date(lastSeen);
  const newOnes = recipes.filter(r => {
    if (!r.created_at) return false;
    if (r.added_by === currentUser?.name) return false;
    return new Date(r.created_at) > lastSeenDate;
  });

  const banner = document.getElementById('newRecipesBanner');
  if (!banner) return;

  if (newOnes.length > 0) {
    document.getElementById('newRecipesText').textContent =
      `🆕 ${newOnes.length} yeni tarif eklendi!`;
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
}

function showNewRecipes() {
  localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
  document.getElementById('newRecipesBanner').style.display = 'none';
  currentSort = 'new'; currentPage = 1;
  document.getElementById('sortLabel').textContent = 'Yeni';
  document.querySelectorAll('.sort-option').forEach(o => o.classList.remove('active'));
  document.querySelector('.sort-option')?.classList.add('active');
  currentCat = '';
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.cat-btn')?.classList.add('active');
  renderList();
}

function markAsSeen() {
  localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
}

// ── YENİ YORUM BİLDİRİMİ ──
const COMMENT_LAST_SEEN_KEY = 'tarif_comment_last_seen';

async function checkNewComments() {
  const lastSeen = localStorage.getItem(COMMENT_LAST_SEEN_KEY);
  const banner = document.getElementById('newCommentsBanner');
  if (!banner) return;
  if (!lastSeen) { markCommentsSeen(); return; }

  const { count, error } = await sb.from('comments')
    .select('id', { count: 'exact', head: true })
    .gt('created_at', lastSeen)
    .neq('member_id', currentUser?.id || '');
  if (error) return;

  if (count > 0) {
    document.getElementById('newCommentsText').textContent = `💬 ${count} yeni yorum var`;
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
}

function markCommentsSeen() {
  localStorage.setItem(COMMENT_LAST_SEEN_KEY, new Date().toISOString());
}

function showNewComments() {
  markCommentsSeen();
  document.getElementById('newCommentsBanner').style.display = 'none';
  toast('💬 Yorumları görmek için bir tarif açın');
}

// ── ARAMA/FİLTRE HAFIZASI ──
const FILTER_STATE_KEY = 'tarif_filter_state';

function saveFilterState() {
  localStorage.setItem(FILTER_STATE_KEY, JSON.stringify({
    cat: currentCat, tag: currentTag, sort: currentSort,
    search: document.getElementById('searchInput')?.value || ''
  }));
}

function restoreFilterState() {
  if (filterStateRestored) return;
  filterStateRestored = true;
  try {
    const raw = localStorage.getItem(FILTER_STATE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    currentCat = s.cat || '';
    currentTag = s.tag || '';
    currentSort = s.sort || 'new';

    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = s.search || '';

    document.querySelectorAll('.cat-btn').forEach(btn => {
      const onclk = btn.getAttribute('onclick') || '';
      const m = onclk.match(/'([^']*)'/);
      const val = m ? m[1] : '';
      btn.classList.toggle('active', val === currentCat);
    });

    const sortLabels = { new:'Yeni', alpha:'A-Z', alpha_desc:'Z-A', time:'Hızlı', fav:'Favori' };
    const sortLabelEl = document.getElementById('sortLabel');
    if (sortLabelEl) sortLabelEl.textContent = sortLabels[currentSort] || 'Yeni';
    document.querySelectorAll('.sort-option').forEach(o => {
      o.classList.toggle('active', o.dataset.val === currentSort);
    });
  } catch(e) {}
}

async function sha256(text) {
  const msgBuffer = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

let currentPhotoUrl = null;
let currentPhotoFile = null;

function handlePhotoSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('⚠️ Fotoğraf 10MB dan küçük olmalıdır'); return; }

  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxW = 1200;
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        currentPhotoFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {type:'image/jpeg'});
        const url = canvas.toDataURL('image/jpeg', 0.85);
        document.getElementById('photoImg').src = url;
        document.getElementById('photoPreview').style.display = 'block';
      }, 'image/jpeg', 0.85);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removePhoto() {
  currentPhotoFile = null;
  currentPhotoUrl = null;
  document.getElementById('photoImg').src = '';
  document.getElementById('photoPreview').style.display = 'none';
  document.getElementById('photoInput').value = '';
}

function normalize(s) {
  if (!s) return '';
  return s.toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s').replace(/ı/g,'i')
    .replace(/ö/g,'o').replace(/ç/g,'c').replace(/İ/g,'i').replace(/Ğ/g,'g')
    .replace(/Ü/g,'u').replace(/Ş/g,'s').replace(/Ö/g,'o').replace(/Ç/g,'c');
}

async function init() {
  const urlParams = new URLSearchParams(location.search);
  const sharedId = urlParams.get('tarif');

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      const { data: profile } = await sb.from('profiles').select('id,name,is_admin').eq('id', session.user.id).single();
      if (profile) {
        currentUser = { id: profile.id, name: profile.name, isAdmin: profile.is_admin };
        document.getElementById('loadingScreen').style.display = 'none';
        showApp();
        try {
          await fetchRecipes();
        } catch (e) {
          console.error('Tarifler yüklenemedi (Supabase bağlantı hatası):', e);
          toast('⚠️ Sunucuya bağlanılamadı. Supabase adresini/anahtarını kontrol edin.');
        }
        if (sharedId) {
          setTimeout(() => {
            const r = recipes.find(r => r.id === sharedId);
            if (r) openDetail(sharedId);
          }, 500);
        }
        return;
      } else {
        // Profil silinmiş/bulunamıyor — hesabı sonlandır
        await sb.auth.signOut();
      }
    }
  } catch(e) {}

  if (sharedId) {
    try {
      await loadSharedRecipe(sharedId);
    } catch (e) {
      console.error('Paylaşılan tarif yüklenemedi:', e);
      document.getElementById('loadingScreen').style.display = 'none';
      showLogin();
      toast('⚠️ Sunucuya bağlanılamadı. Supabase adresini/anahtarını kontrol edin.');
    }
    return;
  }

  try {
    await loadMembers();
  } catch (e) {
    console.error('Üyeler yüklenemedi (Supabase bağlantı hatası):', e);
    toast('⚠️ Sunucuya bağlanılamadı. Supabase adresini/anahtarını kontrol edin.');
  }
  document.getElementById('loadingScreen').style.display = 'none';
  showLogin();
}

async function loadSharedRecipe(id) {
  const { data, error } = await sb.from('recipes').select('*').eq('id', id).is('deleted_at', null).single();
  document.getElementById('loadingScreen').style.display = 'none';

  if (error || !data) {
    await loadMembers();
    showLogin();
    toast('⚠️ Tarif bulunamadı veya silinmiş');
    return;
  }

  const r = data;
  const steps = (r.steps || '').split('\n').filter(Boolean);
  const tags = (r.tags || []).map(t => '<span style="padding:3px 10px;background:#FFF0E6;color:#C04A1B;border-radius:50px;font-size:11px;font-weight:700;">#' + esc(t) + '</span>').join('');

  const photoHtml = r.photo_url
    ? '<div style="width:100%;height:160px;background:#FDF0E8;display:flex;align-items:center;justify-content:center;"><img src="' + r.photo_url + '" style="width:100%;height:100%;object-fit:cover;" /></div>'
    : '';

  const ingHtml = r.ingredients && r.ingredients.length
    ? '<div style="font-family:Playfair Display,serif;font-size:17px;font-weight:700;color:#2A1A0E;margin-bottom:12px;padding-bottom:8px;border-bottom:1.5px solid #EDE4D8;">Malzemeler</div><div style="margin-bottom:20px;">'
      + r.ingredients.map(function(i){ return '<span style="display:inline-flex;padding:6px 12px;background:#FDF8F3;border:1.5px solid #EDE4D8;border-radius:50px;font-size:13px;margin:0 5px 7px 0;">✓ ' + esc(i) + '</span>'; }).join('') + '</div>'
    : '';

  const stepsHtml = steps.length
    ? '<div style="font-family:Playfair Display,serif;font-size:17px;font-weight:700;color:#2A1A0E;margin-bottom:12px;padding-bottom:8px;border-bottom:1.5px solid #EDE4D8;">Yapılışı</div><ol style="list-style:none;padding:0;">'
      + steps.map(function(s, i){
          return '<li style="display:flex;gap:12px;margin-bottom:15px;">'
            + '<div style="flex-shrink:0;width:30px;height:30px;background:#E85D26;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;">' + (i+1) + '</div>'
            + '<div style="font-size:14px;color:#7A5C44;line-height:1.6;padding-top:4px;">' + esc(s.replace(/^\d+\.?\s*/,'')) + '</div>'
            + '</li>';
        }).join('') + '</ol>'
    : '';

  const noteHtml = r.note
    ? '<div style="background:#E6F5EC;border-left:3px solid #2D7A4F;border-radius:0 12px 12px 0;padding:12px 14px;font-size:13px;color:#2D7A4F;line-height:1.6;">💡 ' + esc(r.note) + '</div>'
    : '';

  const metaHtml = [
    r.time_minutes ? '<div style="text-align:center;"><div style="font-size:15px;font-weight:700;">⏱ ' + r.time_minutes + ' dk</div><div style="font-size:10px;color:#B89B85;text-transform:uppercase;">Süre</div></div>' : '',
    r.servings ? '<div style="text-align:center;"><div style="font-size:15px;font-weight:700;">👤 ' + r.servings + ' kişi</div><div style="font-size:10px;color:#B89B85;text-transform:uppercase;">Porsiyon</div></div>' : '',
    r.ingredients && r.ingredients.length ? '<div style="text-align:center;"><div style="font-size:15px;font-weight:700;">' + r.ingredients.length + '</div><div style="font-size:10px;color:#B89B85;text-transform:uppercase;">Malzeme</div></div>' : ''
  ].filter(Boolean).join('');

  document.body.innerHTML =
    '<div style="max-width:600px;margin:0 auto;padding:0 0 40px;font-family:Nunito,sans-serif;">'
    + '<div style="background:#E85D26;padding:16px;display:flex;align-items:center;justify-content:space-between;">'
    + '<div style="font-family:Playfair Display,serif;font-size:18px;color:#fff;font-weight:700;">🍽 Aile Tarif Defteri</div>'
    + '<a href="' + location.origin + location.pathname + '" style="background:rgba(255,255,255,0.2);color:#fff;padding:8px 14px;border-radius:50px;font-size:13px;font-weight:700;text-decoration:none;">Giriş Yap →</a>'
    + '</div>'
    + photoHtml
    + '<div style="background:linear-gradient(135deg,#FFF0E6,#FDE8D4);padding:24px 20px;text-align:center;">'
    + '<div style="font-size:56px;margin-bottom:10px;">' + (r.emoji || '🍽') + '</div>'
    + '<div style="font-family:Playfair Display,serif;font-size:26px;font-weight:700;color:#2A1A0E;margin-bottom:8px;">' + esc(r.name) + '</div>'
    + '<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:5px;margin-bottom:8px;">'
    + '<span style="padding:3px 10px;background:#FFF0E6;color:#C04A1B;border-radius:50px;font-size:11px;font-weight:700;">' + esc(r.category) + '</span>' + tags
    + '</div>'
    + (r.added_by ? '<div style="font-size:12px;color:#B89B85;font-style:italic;">👤 ' + esc(r.added_by) + ' tarafından eklendi</div>' : '')
    + '<div style="display:flex;justify-content:center;gap:20px;margin-top:12px;flex-wrap:wrap;">' + metaHtml + '</div>'
    + '</div>'
    + '<div style="padding:20px;">' + ingHtml + stepsHtml + noteHtml + '</div>'
    + '</div>';
}

async function loadMembers() {
  const { data, error } = await sb.from('profiles').select('id,name,is_admin').order('is_admin', { ascending: false }).order('name');
  if (error) { members = []; return; }
  members = data || [];
  renderMemberList();
}

function renderMemberList() {
  const list = document.getElementById('memberList');
  if (!members.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;">Henüz üye eklenmemiş.</div>';
    return;
  }
  list.innerHTML = members.map(m => `
    <button class="member-btn" onclick="selectMember('${m.id}','${esc(m.name)}',${m.is_admin})">
      <div class="member-avatar ${m.is_admin?'admin':''}">${m.name[0].toUpperCase()}</div>
      <span class="member-name">${esc(m.name)}</span>
      ${m.is_admin ? '<span class="member-badge">👑 Yönetici</span>' : ''}
    </button>`).join('');
}

let selectedMemberId = null, selectedMemberName = '', selectedMemberIsAdmin = false;

function selectMember(id, name, isAdmin) {
  selectedMemberId = id; selectedMemberName = name; selectedMemberIsAdmin = isAdmin;
  document.querySelectorAll('.member-btn').forEach(b => b.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
  document.getElementById('passWrap').style.display = 'block';
  document.getElementById('hiddenUsername').value = name;
  document.getElementById('passInput').value = '';
  document.getElementById('passInput').focus();
  document.getElementById('loginBtn').disabled = false;
  document.getElementById('loginError').style.display = 'none';
}

async function doLogin() {
  if (!selectedMemberId) { showLoginError('Lütfen adınızı seçin.'); return; }
  const pass = document.getElementById('passInput').value;
  if (!pass) { showLoginError('Lütfen şifrenizi girin.'); return; }

  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = '⏳ Kontrol ediliyor...';

  const email = memberEmail(selectedMemberName);
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });

  btn.disabled = false; btn.textContent = 'Giriş Yap →';

  if (error || !data.user) { showLoginError('❌ Şifre hatalı, tekrar deneyin.'); document.getElementById('passInput').value=''; document.getElementById('passInput').focus(); return; }

  const { data: profile } = await sb.from('profiles').select('id,name,is_admin').eq('id', data.user.id).single();
  if (!profile) { showLoginError('⚠️ Bu hesap artık aktif değil.'); await sb.auth.signOut(); return; }

  currentUser = { id: profile.id, name: profile.name, isAdmin: profile.is_admin };

  document.getElementById('loginScreen').style.display = 'none';
  showApp();
  await fetchRecipes();
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg; el.style.display = 'block';
}

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appShell').style.display = 'none';
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  updateThemeButton();
  const l = currentUser.name[0].toUpperCase();
  const av = document.getElementById('userAvatar');
  av.textContent = currentUser.isAdmin ? '👑' : l;
  av.style.background = currentUser.isAdmin ? '#EDE9FE' : '';
  av.style.color = currentUser.isAdmin ? '#7C3AED' : '';
  document.getElementById('profileAvatar').textContent = currentUser.isAdmin ? '👑' : l;
  document.getElementById('profileAvatar').className = 'profile-avatar' + (currentUser.isAdmin ? ' admin' : '');
  document.getElementById('profileName').textContent = currentUser.name;
  document.getElementById('profileRole').textContent = currentUser.isAdmin ? '👑 Yönetici' : 'Aile üyesi';
  document.getElementById('adminPanelBtn').style.display = currentUser.isAdmin ? 'block' : 'none';
  const impBtn = document.getElementById('importBtn');
  if (impBtn) impBtn.style.display = currentUser.isAdmin ? 'flex' : 'none';
}

async function logout() {
  await sb.auth.signOut();
  currentUser = null; recipes = [];
  selectedMemberId = null; selectedMemberName = '';
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
  document.getElementById('passWrap').style.display = 'none';
  document.getElementById('passInput').value = '';
  document.getElementById('hiddenUsername').value = '';
  document.getElementById('loginBtn').disabled = true;
  document.getElementById('loginError').style.display = 'none';
  document.querySelectorAll('.member-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  if ('serviceWorker' in navigator) {
    caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
  }
  toast('👋 Çıkış yapıldı');
}

// ── KARANLIK MOD ──
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('tarif_theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('tarif_theme', 'dark');
  }
  updateThemeButton();
}

function updateThemeButton() {
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  btn.textContent = isDark ? '☀️ Aydınlık Mod' : '🌙 Karanlık Mod';
}

function openProfile()  { document.getElementById('profileOverlay').classList.add('open'); }
function closeProfile() { document.getElementById('profileOverlay').classList.remove('open'); }
function handleProfileOverlay(e) { if(e.target===document.getElementById('profileOverlay')) closeProfile(); }

async function openAdminPanel() {
  document.getElementById('adminOverlay').classList.add('open');
  await renderAdminMembers();
  await renderTrash();
}
function closeAdminPanel() { document.getElementById('adminOverlay').classList.remove('open'); }
function handleAdminOverlay(e) { if(e.target===document.getElementById('adminOverlay')) closeAdminPanel(); }

let restoreData = [];

function handleRestoreFile(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data) || !data.length) {
        toast('⚠️ Geçersiz yedek dosyası');
        return;
      }
      restoreData = data;
      document.getElementById('restorePreview').style.display = 'block';
      document.getElementById('restoreInfo').innerHTML =
        '📦 <strong>' + data.length + ' tarif</strong> bulundu.<br>' +
        '<span style="font-size:12px;color:var(--text3);">Eksikleri Ekle: Sadece veritabanında olmayan tarifler eklenir.<br>' +
        'Tümünü Yükle: Mevcut tüm tarifler silinir, yedek yüklenir.</span>';
    } catch(e) {
      toast('⚠️ JSON dosyası okunamadı');
    }
  };
  reader.readAsText(file);
}

async function restoreMissing() {
  if (!restoreData.length) return;
  if (!confirm(restoreData.length + ' tariften eksik olanlar eklenecek. Devam?')) return;

  const btn = event.target;
  btn.disabled = true; btn.textContent = '⏳ Kontrol ediliyor...';

  const { data: existing } = await sb.from('recipes').select('id').is('deleted_at', null);
  const existingIds = new Set((existing || []).map(r => r.id));

  const missing = restoreData.filter(r => !existingIds.has(r.id));

  if (!missing.length) {
    toast('✅ Eksik tarif yok, veritabanı güncel!');
    btn.disabled = false; btn.textContent = '➕ Eksikleri Ekle';
    return;
  }

  btn.textContent = '⏳ ' + missing.length + ' tarif ekleniyor...';

  const cleaned = missing.map(r => ({
    id: r.id,
    name: r.name,
    category: r.category || 'Diğer',
    emoji: r.emoji || null,
    time_minutes: r.time_minutes || null,
    servings: r.servings || null,
    ingredients: r.ingredients || [],
    steps: r.steps || null,
    note: r.note || null,
    tags: r.tags || [],
    added_by: r.added_by || '',
    is_favorite: r.is_favorite || false,
    is_private: r.is_private || false,
    photo_url: r.photo_url || null,
    created_at: r.created_at || new Date().toISOString(),
  }));

  const { error } = await sb.from('recipes').insert(cleaned);
  btn.disabled = false; btn.textContent = '➕ Eksikleri Ekle';

  if (error) { toast('⚠️ Hata: ' + error.message); return; }
  await fetchRecipes();
  document.getElementById('restorePreview').style.display = 'none';
  toast('✅ ' + missing.length + ' tarif geri yüklendi!');
}

async function restoreAll() {
  if (!restoreData.length) return;
  if (!confirm('⚠️ DİKKAT! Mevcut tüm tarifler silinecek ve yedek yüklenecek. Geri alınamaz!')) return;
  if (!confirm('Emin misiniz? Bu işlem ' + restoreData.length + ' tarifi geri yükler, mevcut her şeyi siler.')) return;

  const btn = event.target;
  btn.disabled = true; btn.textContent = '⏳ Geri yükleniyor...';

  // Silme + yükleme tek bir veritabanı işlemi (transaction) olarak yapılır:
  // bağlantı kesilirse ya tamamı uygulanır ya da hiçbiri — ara/eksik durum oluşmaz.
  const { data: loaded, error } = await sb.rpc('restore_all_recipes', { recipes_json: restoreData });

  btn.disabled = false; btn.textContent = '⚠️ Tümünü Yükle';

  if (error) { toast('⚠️ Geri yükleme hatası: ' + error.message); return; }

  await fetchRecipes();
  document.getElementById('restorePreview').style.display = 'none';
  toast('✅ ' + loaded + ' tarif başarıyla geri yüklendi!');
}

async function backupJSON() {
  toast('⏳ Yedek hazırlanıyor...');
  const { data, error } = await sb.from('recipes').select('*').is('deleted_at', null).order('created_at', { ascending: false });
  if (error) { toast('⚠️ Yedek alınamadı'); return; }

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const tarih = new Date().toLocaleDateString('tr-TR').replace(/\./g, '-');
  a.href = url;
  a.download = `tarif-defteri-yedek-${tarih}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`✅ ${data.length} tarif JSON olarak indirildi`);
}

async function backupCSV() {
  toast('⏳ CSV hazırlanıyor...');
  const { data, error } = await sb.from('recipes').select('*').is('deleted_at', null).order('created_at', { ascending: false });
  if (error) { toast('⚠️ Yedek alınamadı'); return; }

  const headers = ['id','name','category','emoji','time_minutes','servings','ingredients','steps','note','tags','added_by','is_favorite','is_private','photo_url','created_at'];

  const rows = data.map(r => headers.map(h => {
    let val = r[h];
    if (Array.isArray(val)) val = val.join(' | ');
    if (val === null || val === undefined) val = '';
    val = String(val).replace(/"/g, '""');
    return '"' + val + '"';
  }).join(','));

  const bom = String.fromCharCode(0xFEFF);
  const lines = [headers.join(',')].concat(rows);
  const csv = bom + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const tarih = new Date().toLocaleDateString('tr-TR').replace(/\./g, '-');
  a.href = url;
  a.download = 'tarif-defteri-yedek-' + tarih + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  toast('✅ ' + data.length + ' tarif CSV olarak indirildi');
}

async function cleanupOrphanedPhotos() {
  if (!confirm('Fotoğraf deposu taranacak. Devam edilsin mi?')) return;
  const btn = event.target;
  const originalText = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Taranıyor...';

  // 1) Depodaki tüm dosyaları listele (sayfalı)
  let allFiles = [];
  let offset = 0;
  const pageSize = 100;
  while (true) {
    const { data, error } = await sb.storage.from('recipe-photos').list('', { limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) { toast('⚠️ Depo listelenemedi: ' + error.message); btn.disabled = false; btn.textContent = originalText; return; }
    allFiles = allFiles.concat(data || []);
    if (!data || data.length < pageSize) break;
    offset += pageSize;
  }

  if (!allFiles.length) { toast('✅ Depo zaten boş'); btn.disabled = false; btn.textContent = originalText; return; }

  // 2) Silinmiş olanlar dahil tüm tariflerde kullanılan fotoğraf dosya adlarını topla
  const { data: allRecipes, error: recErr } = await sb.from('recipes').select('photo_url');
  if (recErr) { toast('⚠️ Tarifler okunamadı'); btn.disabled = false; btn.textContent = originalText; return; }

  const usedFiles = new Set();
  (allRecipes || []).forEach(r => {
    if (r.photo_url) {
      const parts = r.photo_url.split('/recipe-photos/');
      if (parts[1]) usedFiles.add(decodeURIComponent(parts[1]));
    }
  });

  // 3) Hiçbir tarif tarafından kullanılmayan dosyaları bul
  const orphans = allFiles.filter(f => !usedFiles.has(f.name)).map(f => f.name);

  btn.disabled = false; btn.textContent = originalText;

  if (!orphans.length) { toast('✅ Kullanılmayan fotoğraf yok, depo temiz!'); return; }
  if (!confirm(orphans.length + ' kullanılmayan fotoğraf bulundu. Silinsin mi?')) return;

  btn.disabled = true; btn.textContent = '⏳ Siliniyor...';
  const { error: delErr } = await sb.storage.from('recipe-photos').remove(orphans);
  btn.disabled = false; btn.textContent = originalText;

  if (delErr) { toast('⚠️ Silme hatası: ' + delErr.message); return; }
  toast('🧹 ' + orphans.length + ' kullanılmayan fotoğraf silindi');
}

async function renderTrash() {
  const list = document.getElementById('trashList');
  if (!list) return;
  list.innerHTML = '<div style="font-size:13px;color:var(--text3);padding:8px 0;">⏳ Yükleniyor...</div>';
  const { data } = await sb.from('recipes').select('id,name,category,added_by,deleted_at').not('deleted_at','is',null).order('deleted_at',{ascending:false});
  if (!data || !data.length) {
    list.innerHTML = '<div style="font-size:13px;color:var(--text3);padding:8px 0;">Çöp kutusu boş.</div>';
    return;
  }
  list.innerHTML = data.map(r => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">
      <div style="flex:1;">
        <div style="font-size:14px;font-weight:600;">${esc(r.name)}</div>
        <div style="font-size:11px;color:var(--text3);">${esc(r.category)}${r.added_by?' · '+esc(r.added_by):''}</div>
      </div>
      <button onclick="restoreRecipe('${r.id}')" style="background:var(--green-bg);color:var(--green);border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">↩ Geri Al</button>
      <button onclick="permanentDelete('${r.id}')" style="background:#FEE;color:#C00;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">🗑 Sil</button>
    </div>`).join('');
}

async function restoreRecipe(id) {
  const { error } = await sb.from('recipes').update({ deleted_at: null }).eq('id', id);
  if (error) { toast('⚠️ Geri alınamadı'); return; }
  await fetchRecipes();
  await renderTrash();
  toast('✅ Tarif geri alındı!');
}

async function permanentDelete(id) {
  if (!confirm('Bu tarif kalıcı olarak silinecek, geri alınamaz!')) return;
  const { error } = await sb.from('recipes').delete().eq('id', id);
  if (error) { toast('⚠️ Silinemedi'); return; }
  await renderTrash();
  toast('🗑 Tarif kalıcı olarak silindi');
}

async function renderAdminMembers() {
  const { data } = await sb.from('profiles').select('*').order('is_admin',{ascending:false}).order('name');
  const list = document.getElementById('adminMemberList');
  if (!data||!data.length) { list.innerHTML='<p style="color:var(--text3);font-size:13px;">Henüz üye yok.</p>'; return; }
  list.innerHTML = data.map(m=>`
    <div class="admin-member-item">
      <div class="admin-member-avatar ${m.is_admin?'admin':''}">${m.name[0].toUpperCase()}</div>
      <div style="flex:1">
        <div class="admin-member-name">${esc(m.name)} ${m.is_admin?'<span class="admin-member-badge">👑</span>':''}</div>
        <div style="font-size:11px;color:var(--text3);">••••••••</div>
      </div>
      ${!m.is_admin?`<button class="btn-del-member" onclick="deleteMember('${m.id}','${esc(m.name)}')">🗑</button>`:''}
    </div>`).join('');
}

async function addMember() {
  const name = document.getElementById('newMemberName').value.trim();
  const pass = document.getElementById('newMemberPass').value.trim();
  if (!name||!pass) { toast('⚠️ Ad ve şifre gereklidir'); return; }
  if (pass.length < 6) { toast('⚠️ Şifre en az 6 karakter olmalıdır'); return; }

  // Admin'in kendi oturumunu bozmadan yeni kullanıcı oluşturmak için geçici, oturum saklamayan bir istemci kullanıyoruz
  const tempClient = createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = memberEmail(name);
  const { data: signUpData, error: signUpErr } = await tempClient.auth.signUp({ email, password: pass });
  if (signUpErr || !signUpData.user) { toast('⚠️ '+(signUpErr?.message||'Üye oluşturulamadı')); return; }

  const { error } = await sb.from('profiles').insert({ id: signUpData.user.id, name, is_admin: false });
  if (error) { toast('⚠️ '+error.message); return; }
  document.getElementById('newMemberName').value='';
  document.getElementById('newMemberPass').value='';
  await renderAdminMembers();
  await loadMembers();
  toast('✅ '+name+' eklendi');
}

async function deleteMember(id, name) {
  if (!confirm(name+' üyelikten çıkarılsın mı? (Hesabı devre dışı bırakılır, tekrar giriş yapamaz)')) return;
  const { error } = await sb.from('profiles').delete().eq('id', id);
  if (error) { toast('⚠️ Silinemedi'); return; }
  await renderAdminMembers();
  await loadMembers();
  toast('🗑 '+name+' çıkarıldı');
}

async function fetchRecipes() {
  if (!navigator.onLine) {
    const cached = localStorage.getItem('tarif_cache');
    if (cached) {
      recipes = JSON.parse(cached);
      updateCounts(); updateTagsBar(); renderList();
      toast('📵 Çevrimdışı — önbellekten yüklendi');
    }
    return;
  }

  let query = sb.from('recipes').select('*').is('deleted_at', null);

  if (!currentUser.isAdmin) {
    query = query.or(`is_private.is.false,is_private.is.null,added_by_id.eq.${currentUser.id}`);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    const cached = localStorage.getItem('tarif_cache');
    if (cached) { recipes = JSON.parse(cached); updateCounts(); updateTagsBar(); renderList(); }
    toast('⚠️ Veriler yüklenemedi');
    return;
  }
  recipes = data || [];
  localStorage.setItem('tarif_cache', JSON.stringify(recipes));
  if (!localStorage.getItem(LAST_SEEN_KEY)) markAsSeen();
  await loadCommentCounts();
  restoreFilterState();
  updateCounts(); updateTagsBar(); renderList();
  checkNewRecipes();
  checkNewComments();
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('screen-'+name).classList.add('active');
  document.getElementById('nav-'+name).classList.add('active');
  if(name==='favs') renderFavs();
  if(name==='stats') renderStats();
  if(name==='shop') renderShop();
}

function toggleSort(){const d=document.getElementById('sortDropdown');d.style.display=d.style.display==='block'?'none':'block';}
function setSort(val,label,el){
  currentSort=val;currentPage=1;
  document.getElementById('sortLabel').textContent=label;
  document.querySelectorAll('.sort-option').forEach(o=>o.classList.remove('active'));
  if(el)el.classList.add('active');
  document.getElementById('sortDropdown').style.display='none';
  saveFilterState();
  renderList();
}
document.addEventListener('click',e=>{if(!e.target.closest('.sort-wrap'))document.getElementById('sortDropdown').style.display='none';});

function onSearch(){clearTimeout(searchTimer);searchTimer=setTimeout(()=>{currentPage=1;saveFilterState();renderList();},200);}
function setCat(btn,cat){currentCat=cat;currentPage=1;document.querySelectorAll('.cat-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');saveFilterState();renderList();}
function setTag(tag){currentTag=currentTag===tag?'':tag;currentPage=1;updateTagsBar();saveFilterState();renderList();}

function getFiltered(){
  const q=normalize(document.getElementById('searchInput')?.value||'');
  let items=recipes.filter(r=>{
    if(r.is_private){
      if(!currentUser)return false;
      if(!currentUser.isAdmin && r.added_by_id !== currentUser.id)return false;
    }
    const mc=!currentCat||r.category===currentCat;
    const mt=!currentTag||(r.tags||[]).includes(currentTag);
    const mq=!q||normalize(r.name).includes(q)||(r.ingredients||[]).some(i=>normalize(i).includes(q))||(r.tags||[]).some(t=>normalize(t).includes(q));
    return mc&&mt&&mq;
  });
  if(currentSort==='alpha')items.sort((a,b)=>normalize(a.name).localeCompare(normalize(b.name)));
  else if(currentSort==='alpha_desc')items.sort((a,b)=>normalize(b.name).localeCompare(normalize(a.name)));
  else if(currentSort==='time')items.sort((a,b)=>(a.time_minutes||9999)-(b.time_minutes||9999));
  else if(currentSort==='fav')items.sort((a,b)=>(b.is_favorite?1:0)-(a.is_favorite?1:0));
  return items;
}

function updateCounts(){
  const c={};recipes.forEach(r=>{c[r.category]=(c[r.category]||0)+1;});
  document.getElementById('cnt-all').textContent=recipes.length;
  document.querySelectorAll('#catBar .cat-btn').forEach(btn=>{
    const onclk=btn.getAttribute('onclick')||'';
    const m=onclk.match(/'([^']+)'/);
    if(m&&m[1]){let span=btn.querySelector('.cat-count');if(!span){span=document.createElement('span');span.className='cat-count';btn.appendChild(span);}span.textContent=c[m[1]]||0;}
  });
}

function getAllTags(){const s=new Set();recipes.forEach(r=>(r.tags||[]).forEach(t=>s.add(t)));return[...s].sort();}

function updateTagsBar(){
  const tags=getAllTags();const bar=document.getElementById('tagsBar');
  if(!tags.length){bar.innerHTML='';return;}
  bar.innerHTML=tags.map(t=>`<button class="tag-filter-btn ${currentTag===t?'active':''}" onclick="setTag('${esc(t)}')">#${esc(t)}</button>`).join('');
}

function canEdit(r){ return currentUser&&(currentUser.isAdmin||!r.added_by_id||r.added_by_id===currentUser.id); }

function addedByHTML(r){
  if (!r.added_by) return '';
  if (!r.added_by_id) return `<div class="added-by">👤 ${esc(r.added_by)}</div>`;
  return `<div class="added-by" onclick="event.stopPropagation();openMemberProfile('${r.added_by_id}')" style="cursor:pointer;text-decoration:underline;text-underline-offset:2px;">👤 ${esc(r.added_by)}</div>`;
}

function cardHTML(r,_q=''){
  const tags=(r.tags||[]).map(t=>`<span class="recipe-etag">#${esc(t)}</span>`).join('');
  return`<div class="recipe-card" onclick="openDetail('${r.id}')">
    ${r.photo_url ? `<div style="width:100%;height:120px;background:#FDF0E8;overflow:hidden;display:flex;align-items:center;justify-content:center;"><img src="${r.photo_url}" style="width:100%;height:100%;object-fit:cover;" loading="lazy" /></div>` : ''}
    <div class="recipe-card-body">
      <div class="recipe-card-header">
        <div class="recipe-card-title">${r.emoji||catEmoji[r.category]||'🍴'} ${highlight(r.name,_q)} ${r.is_private?'<span style="font-size:11px;">🔒</span>':''}</div>
        <div class="recipe-card-actions">
          <button class="icon-btn fav ${r.is_favorite?'active':''}" onclick="toggleFav(event,'${r.id}')">
            <svg fill="${r.is_favorite?'currentColor':'none'}" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </button>
          ${canEdit(r)?`<button class="icon-btn" onclick="deleteRecipe(event,'${r.id}')">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline stroke-linecap="round" stroke-linejoin="round" points="3 6 5 6 21 6"/><path stroke-linecap="round" stroke-linejoin="round" d="M19 6l-1 14H6L5 6m5 0V4h4v2"/></svg>
          </button>`:''}
        </div>
      </div>
      <div class="recipe-card-meta">
        ${r.time_minutes?`<div class="meta-item"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline stroke-linecap="round" points="12 6 12 12 16 14"/></svg>${r.time_minutes} dk</div>`:''}
        ${r.servings?`<div class="meta-item"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>${r.servings} kişi</div>`:''}
        ${r.ingredients&&r.ingredients.length?`<div class="meta-item">${r.ingredients.length} malzeme</div>`:''}
        ${commentCounts[r.id]?`<div class="meta-item">💬 ${commentCounts[r.id]}</div>`:''}
        ${addedByHTML(r)}
      </div>
      ${r.steps?`<div class="recipe-card-desc">${highlight(r.steps.split('\n').filter(Boolean)[0]||'',_q)}</div>`:''}
      <div class="recipe-card-footer"><span class="recipe-tag">${esc(r.category)}</span>${tags}</div>
    </div>
  </div>`;
}

function renderList(){
  const filtered=getFiltered();const total=filtered.length;
  const totalPages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  if(currentPage>totalPages)currentPage=totalPages;
  const pageItems=filtered.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE);
  document.getElementById('resultsCount').textContent=total?`${total} tarif`:'';
  const list=document.getElementById('recipeList');
  if(!pageItems.length){list.innerHTML=`<div class="empty-state"><div class="big">🍳</div><p>${recipes.length===0?'Henüz tarif yok.':'Arama sonucu bulunamadı.'}</p></div>`;document.getElementById('pagination').innerHTML='';return;}
  const _q=(document.getElementById('searchInput')?.value||'').trim();
  list.innerHTML=pageItems.map(r=>cardHTML(r,_q)).join('');
  renderPagination(currentPage,totalPages);
}

function renderPagination(page,total){
  const pg=document.getElementById('pagination');
  if(total<=1){pg.innerHTML='';return;}
  let html=`<button class="page-btn" onclick="goPage(${page-1})" ${page===1?'disabled':''}>‹</button>`;
  const s=Math.max(1,page-2),e=Math.min(total,page+2);
  if(s>1)html+=`<button class="page-btn" onclick="goPage(1)">1</button>${s>2?'<span class="page-info">…</span>':''}`;
  for(let i=s;i<=e;i++)html+=`<button class="page-btn ${i===page?'active':''}" onclick="goPage(${i})">${i}</button>`;
  if(e<total)html+=`${e<total-1?'<span class="page-info">…</span>':''}<button class="page-btn" onclick="goPage(${total})">${total}</button>`;
  html+=`<button class="page-btn" onclick="goPage(${page+1})" ${page===total?'disabled':''}>›</button>`;
  pg.innerHTML=html;
}

function goPage(p){currentPage=p;renderList();window.scrollTo(0,0);}

function renderFavs(){
  const favs=recipes.filter(r=>r.is_favorite);const list=document.getElementById('favList');
  if(!favs.length){list.innerHTML=`<div class="empty-state"><div class="big">❤️</div><p>Henüz favori tarif yok.</p></div>`;return;}
  list.innerHTML=favs.map(r=>cardHTML(r,'')).join('');
}

function renderStats(){
  document.getElementById('statsDate').textContent=new Date().toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'});
  const favCount=recipes.filter(r=>r.is_favorite).length;
  const cats={};recipes.forEach(r=>{cats[r.category]=(cats[r.category]||0)+1;});
  const contributors=new Set(recipes.map(r=>r.added_by).filter(Boolean)).size;
  document.getElementById('statsGrid').innerHTML=`
    <div class="stat-card"><div class="stat-num">${recipes.length}</div><div class="stat-lbl">Toplam Tarif</div></div>
    <div class="stat-card"><div class="stat-num">${favCount}</div><div class="stat-lbl">Favori</div></div>
    <div class="stat-card"><div class="stat-num">${members.length}</div><div class="stat-lbl">Aile Üyesi</div></div>
    <div class="stat-card"><div class="stat-num">${contributors}</div><div class="stat-lbl">Katkıda Bulunan</div></div>`;
  const catEl=document.getElementById('statsCats');
  if(!Object.keys(cats).length){catEl.innerHTML='<div class="empty-state"><p>Henüz tarif eklenmedi.</p></div>';return;}
  catEl.innerHTML=Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([cat,count])=>`
    <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);">
      <span style="font-size:26px;">${catEmoji[cat]||'🍴'}</span>
      <div style="flex:1"><div style="font-weight:600;font-size:14px;">${esc(cat)}</div>
        <div style="height:5px;background:var(--border);border-radius:3px;margin-top:5px;">
          <div style="height:100%;width:${Math.round(count/recipes.length*100)}%;background:var(--accent);border-radius:3px;"></div>
        </div>
      </div>
      <span style="font-family:'Playfair Display',serif;font-size:18px;font-weight:700;color:var(--accent);">${count}</span>
    </div>`).join('');
}

async function renderShop(){
  const content=document.getElementById('shopContent');
  content.innerHTML=`<div class="imp-progress"><div class="big">⏳</div><p>Yükleniyor...</p></div>`;
  const {data,error}=await sb.from('shopping_items').select('*').order('created_at',{ascending:true});
  if(error){content.innerHTML=`<div class="empty-state"><p>Yüklenemedi.</p></div>`;return;}
  const items=data||[];
  if(!items.length){content.innerHTML=`<div class="empty-state"><div class="big">🛒</div><p>Alışveriş listesi boş.<br>Tarif detayında 🛒 butonuna basın.</p></div>`;return;}
  const grouped={};
  items.forEach(item=>{const g=item.recipe_name||'Diğer';if(!grouped[g])grouped[g]=[];grouped[g].push(item);});
  content.innerHTML=Object.entries(grouped).map(([recipe,items])=>`
    <div class="shop-section-title">${esc(recipe)}</div>
    ${items.map(item=>`<div class="shop-item ${item.is_done?'done':''}" id="si-${item.id}">
      <input type="checkbox" ${item.is_done?'checked':''} onchange="toggleShop('${item.id}',this.checked)" />
      <label>${esc(item.name)}</label>
    </div>`).join('')}`).join('');
}

async function toggleShop(id,done){await sb.from('shopping_items').update({is_done:done}).eq('id',id);const el=document.getElementById('si-'+id);if(el)el.classList.toggle('done',done);}
async function clearDoneShop(){await sb.from('shopping_items').delete().eq('is_done',true);renderShop();toast('✅ Alınanlar temizlendi');}
async function clearAllShop(){if(!confirm('Alışveriş listesi tamamen silinsin mi?'))return;await sb.from('shopping_items').delete().neq('id','00000000-0000-0000-0000-000000000000');renderShop();}
async function addToShop(){
  const r=recipes.find(r=>r.id===detailId);
  if(!r||!r.ingredients||!r.ingredients.length){toast('⚠️ Bu tarifte malzeme yok');return;}
  const rows=r.ingredients.map(ing=>({name:ing,recipe_name:r.name,is_done:false}));
  const {error}=await sb.from('shopping_items').insert(rows);
  if(error){toast('⚠️ Eklenemedi');return;}
  toast(`🛒 ${rows.length} malzeme listeye eklendi`);
}

function handleCatChange(sel){const c=document.getElementById('fCatCustom');if(sel.value==='__custom__'){c.style.display='block';c.focus();}else{c.style.display='none';c.value='';}}
function getSelectedCategory(){const sel=document.getElementById('fCat');if(sel.value==='__custom__'){const c=document.getElementById('fCatCustom').value.trim();return c||'Diğer';}return sel.value;}

function initTagsInput(){formTags=[];const wrap=document.getElementById('tagsWrap');wrap.innerHTML=`<input class="tags-text-input" id="tagTxt" placeholder="vejetaryen, pratik..." onkeydown="onTagKey(event)" />`;}
function onTagKey(e){if(e.key==='Enter'||e.key===','){e.preventDefault();const val=e.target.value.trim().replace(/,/g,'');if(val&&!formTags.includes(val)){formTags.push(val);renderFormTags();}e.target.value='';}}
function renderFormTags(){const wrap=document.getElementById('tagsWrap');wrap.innerHTML='';formTags.forEach(t=>{const chip=document.createElement('span');chip.className='tag-chip';chip.innerHTML=`#${esc(t)} <button onclick="removeTag('${esc(t)}')" type="button">&times;</button>`;wrap.appendChild(chip);});const input=document.createElement('input');input.className='tags-text-input';input.id='tagTxt';input.placeholder='Etiket ekle...';input.addEventListener('keydown',onTagKey);wrap.appendChild(input);}
function removeTag(tag){formTags=formTags.filter(t=>t!==tag);renderFormTags();}

async function toggleFav(e,id){e.stopPropagation();const r=recipes.find(r=>r.id===id);if(!r)return;const v=!r.is_favorite;await sb.from('recipes').update({is_favorite:v}).eq('id',id);r.is_favorite=v;renderList();toast(v?'❤️ Favorilere eklendi':'💔 Favorilerden çıkarıldı');}
async function toggleFavDetail(){const r=recipes.find(r=>r.id===detailId);if(!r)return;const v=!r.is_favorite;await sb.from('recipes').update({is_favorite:v}).eq('id',detailId);r.is_favorite=v;updateDetailFavBtn(v);renderList();toast(v?'❤️ Favorilere eklendi':'💔 Favorilerden çıkarıldı');}
function updateDetailFavBtn(fav){const btn=document.getElementById('detailFavBtn');btn.classList.toggle('active',fav);btn.querySelector('svg').setAttribute('fill',fav?'currentColor':'none');}

async function deleteRecipe(e,id){
  e.stopPropagation();
  const r=recipes.find(r=>r.id===id);
  if(!canEdit(r)){toast('⚠️ Sadece kendi tariflerinizi silebilirsiniz');return;}
  if(!confirm('Bu tarifi çöp kutusuna taşımak istediğinizden emin misiniz?'))return;
  const {error}=await sb.from('recipes').update({deleted_at: new Date().toISOString()}).eq('id',id);
  if(error){toast('⚠️ Silinemedi');return;}
  recipes=recipes.filter(r=>r.id!==id);updateCounts();updateTagsBar();renderList();
  toast('🗑 Tarif çöp kutusuna taşındı');
}

function openAddModal(){
  editingId=null;
  document.getElementById('modalTitle').textContent='Yeni Tarif';
  ['fId','fName','fEmoji','fTime','fServ','fSteps','fNote'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('fCat').value='Çorba';
  document.getElementById('fPrivate').checked=false;
  document.getElementById('fCatCustom').style.display='none';
  document.getElementById('photoPreview').style.display='none';
  document.getElementById('photoImg').src='';
  document.getElementById('photoInput').value='';
  currentPhotoUrl=null; currentPhotoFile=null;
  document.getElementById('ingList').innerHTML='';
  initTagsInput();addIngField('');addIngField('');
  document.getElementById('modalOverlay').classList.add('open');
}

function openEditModal(id){
  const r=recipes.find(r=>r.id===id);if(!r)return;
  editingId=id;formTags=[...(r.tags||[])];
  document.getElementById('modalTitle').textContent='Tarifi Düzenle';
  document.getElementById('fId').value=r.id;
  document.getElementById('fName').value=r.name;
  document.getElementById('fEmoji').value=r.emoji||'';
  document.getElementById('fPrivate').checked=r.is_private||false;
  currentPhotoUrl=r.photo_url||null; currentPhotoFile=null;
  if(r.photo_url){document.getElementById('photoImg').src=r.photo_url;document.getElementById('photoPreview').style.display='block';}
  else{document.getElementById('photoPreview').style.display='none';document.getElementById('photoImg').src='';}
  document.getElementById('photoInput').value='';
  document.getElementById('fTime').value=r.time_minutes||'';
  document.getElementById('fServ').value=r.servings||'';
  document.getElementById('fSteps').value=r.steps||'';
  document.getElementById('fNote').value=r.note||'';
  const catOpts=Array.from(document.getElementById('fCat').options).map(o=>o.value);
  if(catOpts.includes(r.category)){document.getElementById('fCat').value=r.category;document.getElementById('fCatCustom').style.display='none';}
  else{document.getElementById('fCat').value='__custom__';document.getElementById('fCatCustom').value=r.category;document.getElementById('fCatCustom').style.display='block';}
  document.getElementById('ingList').innerHTML='';
  (r.ingredients||[]).forEach(i=>addIngField(i));
  if(!(r.ingredients&&r.ingredients.length))addIngField('');
  renderFormTags();
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal(){document.getElementById('modalOverlay').classList.remove('open');}
function handleOverlayClick(e){if(e.target===document.getElementById('modalOverlay'))closeModal();}

function addIngField(val){
  const div=document.createElement('div');div.className='ingredient-item';
  div.innerHTML=`<input class="form-input" placeholder="örn. 2 su bardağı un" value="${esc(val)}" />
    <button class="btn-remove" onclick="this.parentNode.remove()"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line stroke-linecap="round" x1="8" y1="12" x2="16" y2="12"/></svg></button>`;
  document.getElementById('ingList').appendChild(div);
}

async function saveRecipe(){
  const name=document.getElementById('fName').value.trim();
  if(!name){toast('⚠️ Tarif adı gereklidir!');return;}
  const tagTxt=document.getElementById('tagTxt');
  if(tagTxt&&tagTxt.value.trim()&&!formTags.includes(tagTxt.value.trim()))formTags.push(tagTxt.value.trim());
  const ings=Array.from(document.querySelectorAll('#ingList .form-input')).map(i=>i.value.trim()).filter(Boolean);
  const btn=document.getElementById('saveBtn');btn.disabled=true;btn.textContent='⏳ Kaydediliyor...';
  let photoUrl = currentPhotoUrl || null;
  if(currentPhotoFile){
    btn.textContent='📷 Fotoğraf yükleniyor...';
    const ext = currentPhotoFile.name.split('.').pop();
    const fileName = Date.now()+'_'+Math.random().toString(36).slice(2)+'.'+ext;
    const {data:upData, error:upErr} = await sb.storage.from('recipe-photos').upload(fileName, currentPhotoFile, {cacheControl:'3600',upsert:false});
    if(upErr){toast('⚠️ Fotoğraf yüklenemedi: '+upErr.message);}
    else{
      const {data:urlData}=sb.storage.from('recipe-photos').getPublicUrl(fileName);
      const newUrl = urlData.publicUrl;
      if(currentPhotoUrl && currentPhotoUrl !== newUrl){
        try {
          const oldPath = currentPhotoUrl.split('/recipe-photos/')[1];
          if(oldPath) await sb.storage.from('recipe-photos').remove([oldPath]);
        } catch(e){}
      }
      photoUrl = newUrl;
    }
    btn.textContent='⏳ Kaydediliyor...';
  } else if(currentPhotoUrl === null && editingId) {
    const orig = recipes.find(r=>r.id===editingId);
    if(orig && orig.photo_url){
      try {
        const oldPath = orig.photo_url.split('/recipe-photos/')[1];
        if(oldPath) await sb.storage.from('recipe-photos').remove([oldPath]);
      } catch(e){}
    }
  }
  const payload={name,category:getSelectedCategory(),emoji:document.getElementById('fEmoji').value.trim()||null,time_minutes:parseInt(document.getElementById('fTime').value)||null,servings:parseInt(document.getElementById('fServ').value)||null,ingredients:ings,steps:document.getElementById('fSteps').value.trim()||null,note:document.getElementById('fNote').value.trim()||null,tags:formTags,added_by:currentUser.name,added_by_id:currentUser.id,is_private:document.getElementById('fPrivate').checked,photo_url:photoUrl};
  let error;
  if(editingId){
    const orig=recipes.find(r=>r.id===editingId);
    if(orig&&orig.added_by_id&&orig.added_by_id!==currentUser.id){payload.added_by=orig.added_by;payload.added_by_id=orig.added_by_id;}
    ({error}=await sb.from('recipes').update(payload).eq('id',editingId));if(!error){const idx=recipes.findIndex(r=>r.id===editingId);if(idx>-1)recipes[idx]={...recipes[idx],...payload};}}
  else{payload.is_favorite=false;const {data,error:e}=await sb.from('recipes').insert(payload).select().single();error=e;if(!error&&data)recipes.unshift(data);}
  btn.disabled=false;btn.textContent='💾 Kaydet';
  if(error){toast('⚠️ Kaydedilemedi: '+error.message);return;}
  closeModal();updateCounts();updateTagsBar();renderList();
  if (!editingId) markAsSeen();
  toast(editingId?'✅ Tarif güncellendi!':'✅ Tarif eklendi!');
}

function openDetail(id){
  const r=recipes.find(r=>r.id===id);if(!r)return;
  detailId=id;updateDetailFavBtn(r.is_favorite);
  const steps=(r.steps||'').split('\n').filter(Boolean);
  const tags=(r.tags||[]).map(t=>`<span class="recipe-etag">#${esc(t)}</span>`).join('');
  document.getElementById('detailEditBtn').style.display=canEdit(r)?'':'none';
  document.getElementById('detailContent').innerHTML=`
    ${r.photo_url ? `<div style="width:100%;height:160px;background:#FDF0E8;overflow:hidden;display:flex;align-items:center;justify-content:center;"><img src="${r.photo_url}" style="width:100%;height:100%;object-fit:cover;" /></div>` : ''}
    <div class="detail-hero">
      <div class="detail-emoji">${r.emoji||catEmoji[r.category]||'🍴'}</div>
      <div class="detail-title">${esc(r.name)} ${r.is_private?'🔒':''}</div>
      <div class="detail-tags"><span class="recipe-tag">${esc(r.category)}</span>${tags}</div>
      ${r.added_by?(r.added_by_id?`<div class="detail-added-by" onclick="openMemberProfile('${r.added_by_id}')" style="cursor:pointer;text-decoration:underline;text-underline-offset:2px;">👤 ${esc(r.added_by)} tarafından eklendi</div>`:`<div class="detail-added-by">👤 ${esc(r.added_by)} tarafından eklendi</div>`):''}
      <div class="detail-meta-row">
        ${r.time_minutes?`<div class="detail-meta-item"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline stroke-linecap="round" points="12 6 12 12 16 14"/></svg><span class="val">${r.time_minutes} dk</span><span class="lbl">Süre</span></div>`:''}
        ${r.servings?`<div class="detail-meta-item"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><span class="val">${r.servings} kişi</span><span class="lbl">Porsiyon</span></div>`:''}
        ${r.ingredients&&r.ingredients.length?`<div class="detail-meta-item"><span class="val">${r.ingredients.length}</span><span class="lbl">Malzeme</span></div>`:''}
      </div>
    </div>
    <div class="detail-body">
      ${r.ingredients&&r.ingredients.length?`<div class="section-title">Malzemeler</div><div>${r.ingredients.map(i=>`<span class="ing-chip">✓ ${esc(i)}</span>`).join('')}</div>`:''}
      ${steps.length?`<div class="section-title">Yapılışı</div><ol class="steps-list">${steps.map((s,i)=>`<li class="step-item"><div class="step-num">${i+1}</div><div class="step-text">${esc(s.replace(/^\d+[\.\)]\s*/,''))}</div></li>`).join('')}</ol>`:''}
      ${r.note?`<div class="section-title">İpucu</div><div class="detail-note">💡 ${esc(r.note)}</div>`:''}
      <div class="section-title">💬 Yorumlar</div>
      <div id="commentsList"></div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input class="form-input" id="commentInput" placeholder="Yorum yaz..." onkeydown="if(event.key==='Enter'){addComment()}" style="flex:1;" />
        <button onclick="addComment()" style="background:var(--accent);color:#fff;border:none;border-radius:12px;padding:0 16px;font-weight:700;cursor:pointer;">Gönder</button>
      </div>
    </div><div style="height:20px;"></div>`;
  document.getElementById('detailOverlay').classList.add('open');
  loadComments(id);
}

function closeDetail(){document.getElementById('detailOverlay').classList.remove('open');}

// ── ÜYE PROFİLİ ──
function getMemberById(id){ return members.find(m => m.id === id); }

async function openMemberProfile(id){
  if (!id) return;
  const member = getMemberById(id) || { name: 'Üye', is_admin: false };

  document.getElementById('profileViewAvatar').textContent = member.is_admin ? '👑' : (member.name ? member.name[0].toUpperCase() : '👤');
  document.getElementById('profileViewAvatar').className = 'profile-avatar' + (member.is_admin ? ' admin' : '');
  document.getElementById('profileViewName').textContent = member.name;
  document.getElementById('profileViewRole').textContent = member.is_admin ? '👑 Yönetici' : 'Aile üyesi';

  // Sadece şu an bizim görebildiğimiz tarifler (gizlilik kuralları zaten recipes dizisine yansımış durumda)
  const memberRecipes = recipes.filter(r => r.added_by_id === id);
  document.getElementById('profileViewRecipeCount').textContent = memberRecipes.length;
  document.getElementById('profileViewRecipes').innerHTML = memberRecipes.length
    ? memberRecipes.map(r => cardHTML(r,'')).join('')
    : '<div class="empty-state" style="padding:30px 20px;"><div class="big">🍳</div><p>Henüz tarif eklenmemiş.</p></div>';

  document.getElementById('profileViewOverlay').classList.add('open');

  const commentsEl = document.getElementById('profileViewComments');
  commentsEl.innerHTML = '<div style="font-size:13px;color:var(--text3);padding:12px 0;">⏳ Yükleniyor...</div>';
  document.getElementById('profileViewCommentCount').textContent = '…';

  const { data, count, error } = await sb.from('comments').select('*', { count: 'exact' }).eq('member_id', id).order('created_at', { ascending: false }).limit(50);
  if (error) { commentsEl.innerHTML = '<div style="font-size:13px;color:var(--text3);">Yorumlar yüklenemedi.</div>'; return; }

  // Erişemediğimiz (gizli) bir tarife yapılmış yorumlar burada gösterilmez
  const rows = (data || []).map(c => {
    const r = recipes.find(x => x.id === c.recipe_id);
    if (!r) return '';
    return `<div style="padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;" onclick="closeMemberProfile();setTimeout(()=>openDetail('${c.recipe_id}'),200)">
      <div style="font-size:12px;color:var(--accent);font-weight:700;margin-bottom:3px;">${esc(r.name)}</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.5;">${esc(c.text)}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:3px;">${new Date(c.created_at).toLocaleString('tr-TR')}</div>
    </div>`;
  }).filter(Boolean);

  document.getElementById('profileViewCommentCount').textContent = rows.length;
  commentsEl.innerHTML = rows.length ? rows.join('') : '<div style="font-size:13px;color:var(--text3);padding:12px 0;">Henüz yorum yapılmamış.</div>';
}

function closeMemberProfile(){ document.getElementById('profileViewOverlay').classList.remove('open'); }
function handleProfileViewOverlay(e){ if(e.target===document.getElementById('profileViewOverlay')) closeMemberProfile(); }

async function loadCommentCounts() {
  const { data, error } = await sb.from('comment_counts').select('recipe_id,count');
  if (error) return;
  const counts = {};
  (data || []).forEach(c => { counts[c.recipe_id] = c.count; });
  commentCounts = counts;
}

async function loadComments(recipeId) {
  const list = document.getElementById('commentsList');
  list.innerHTML = '<div style="font-size:13px;color:var(--text3);padding:8px 0;">⏳ Yükleniyor...</div>';
  const { data, error } = await sb.from('comments').select('*').eq('recipe_id', recipeId).order('created_at', { ascending: true });
  if (error) { list.innerHTML = '<div style="font-size:13px;color:var(--text3);">Yorumlar yüklenemedi.</div>'; return; }
  if (!data.length) { list.innerHTML = '<div style="font-size:13px;color:var(--text3);padding:8px 0;">Henüz yorum yok. İlk yorumu sen yaz!</div>'; return; }
  list.innerHTML = data.map(c => `
    <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">
      <div style="width:30px;height:30px;border-radius:50%;background:var(--tag-bg);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;">${esc(c.member_name[0].toUpperCase())}</div>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:700;color:var(--text);">${esc(c.member_name)} <span style="font-weight:400;color:var(--text3);font-size:11px;">${new Date(c.created_at).toLocaleString('tr-TR')}</span></div>
        <div style="font-size:13px;color:var(--text2);line-height:1.5;margin-top:2px;">${esc(c.text)}</div>
      </div>
      ${(currentUser.isAdmin || currentUser.id === c.member_id) ? `<button onclick="deleteComment('${c.id}')" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:14px;padding:2px;">🗑</button>` : ''}
    </div>`).join('');
}

async function addComment() {
  const input = document.getElementById('commentInput');
  const text = input.value.trim();
  if (!text) return;
  const { error } = await sb.from('comments').insert({ recipe_id: detailId, member_id: currentUser.id, member_name: currentUser.name, text });
  if (error) { toast('⚠️ Yorum eklenemedi'); return; }
  input.value = '';
  await loadComments(detailId);
  commentCounts[detailId] = (commentCounts[detailId] || 0) + 1;
  renderList();
}

async function deleteComment(id) {
  if (!confirm('Yorumu silmek istediğinize emin misiniz?')) return;
  const { error } = await sb.from('comments').delete().eq('id', id);
  if (error) { toast('⚠️ Silinemedi'); return; }
  await loadComments(detailId);
  commentCounts[detailId] = Math.max(0, (commentCounts[detailId] || 1) - 1);
  renderList();
}

function handleDetailOverlay(e){if(e.target===document.getElementById('detailOverlay'))closeDetail();}
function editFromDetail(){closeDetail();setTimeout(()=>openEditModal(detailId),200);}

function shareRecipe() {
  const r = recipes.find(r => r.id === detailId);
  if (!r) return;
  const url = `${location.origin}${location.pathname}?tarif=${r.id}`;

  if (navigator.share) {
    navigator.share({
      title: r.name,
      text: `${r.emoji || '🍽'} ${r.name} — Aile Tarif Defteri`,
      url: url
    }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url).then(() => {
      toast('🔗 Link kopyalandı!');
    }).catch(() => {
      prompt('Linki kopyalayın:', url);
    });
  }
}

function printRecipe(){
  const r=recipes.find(r=>r.id===detailId);if(!r)return;
  const steps=(r.steps||'').split('\n').filter(Boolean);
  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>${r.name}</title>
  <style>body{font-family:Georgia,serif;max-width:600px;margin:40px auto;padding:0 20px;color:#222;line-height:1.6;}
  h1{font-size:26px;margin-bottom:6px;}h2{font-size:17px;border-bottom:1px solid #ddd;padding-bottom:4px;margin-top:20px;}
  ul,ol{padding-left:20px;}li{margin-bottom:8px;}.meta{color:#888;font-size:13px;margin-bottom:16px;}
  .note{background:#f0faf4;border-left:3px solid #2D7A4F;padding:10px 14px;margin-top:16px;font-size:13px;color:#2D7A4F;border-radius:0 8px 8px 0;}</style>
  </head><body>
  <h1>${r.emoji||''} ${r.name}</h1>
  <div class="meta">${r.category}${r.time_minutes?' · ⏱ '+r.time_minutes+' dk':''}${r.servings?' · 👤 '+r.servings+' kişi':''}${r.added_by?' · Ekleyen: '+r.added_by:''}</div>
  ${r.ingredients&&r.ingredients.length?`<h2>Malzemeler</h2><ul>${r.ingredients.map(i=>`<li>${i}</li>`).join('')}</ul>`:''}
  ${steps.length?`<h2>Yapılışı</h2><ol>${steps.map(s=>`<li>${s.replace(/^\d+[\.\)]\s*/,'')}</li>`).join('')}</ol>`:''}
  ${r.note?`<div class="note">💡 ${r.note}</div>`:''}
  <script>window.print();window.onafterprint=()=>window.close();<\/script></body></html>`);
  win.document.close();
}

function openRandom(){
  const filtered=getFiltered();if(!filtered.length){toast('⚠️ Gösterilecek tarif yok');return;}
  const r=filtered[Math.floor(Math.random()*filtered.length)];
  document.getElementById('randomContent').innerHTML=`
    <div class="random-card">
      <div class="random-emoji">${r.emoji||catEmoji[r.category]||'🍴'}</div>
      <div class="random-title">${esc(r.name)}</div>
      <div class="random-meta">${esc(r.category)}${r.time_minutes?' · ⏱ '+r.time_minutes+' dk':''}${r.added_by?' · 👤 '+esc(r.added_by):''}</div>
      <div class="random-btns">
        <button onclick="openRandom()">🎲 Tekrar</button>
        <button class="primary" onclick="closeRandom();setTimeout(()=>openDetail('${r.id}'),200)">Tarifi Gör →</button>
      </div>
    </div>`;
  document.getElementById('randomOverlay').classList.add('open');
}
function closeRandom(){document.getElementById('randomOverlay').classList.remove('open');}
function handleRandomOverlay(e){if(e.target===document.getElementById('randomOverlay'))closeRandom();}

function closeImport(){document.getElementById('importOverlay').classList.remove('open');}
function handleImportOverlay(e){if(e.target===document.getElementById('importOverlay'))closeImport();}

async function handleFileImport(event){
  const file=event.target.files[0];event.target.value='';if(!file)return;
  document.getElementById('importTitle').textContent='📄 Dosyadan Aktar';
  document.getElementById('importBody').innerHTML=`<div class="imp-progress"><div class="big">⏳</div><p>Dosya okunuyor...</p></div>`;
  document.getElementById('importOverlay').classList.add('open');
  try{
    let text='';const name=file.name.toLowerCase();
    if(name.endsWith('.html')||name.endsWith('.htm'))text=await extractHtmlText(file);
    else if(name.endsWith('.pdf'))text=await extractPdfText(file);
    else{document.getElementById('importBody').innerHTML=`<div class="imp-progress"><div class="big">😕</div><p>Desteklenmeyen dosya türü.</p></div>`;return;}
    if(!text||text.trim().length<30){document.getElementById('importBody').innerHTML=`<div class="imp-progress"><div class="big">😕</div><p>Dosyadan metin okunamadı.</p></div>`;return;}
    importList2=parseRecipesFromText(text);
    if(!importList2.length){document.getElementById('importBody').innerHTML=`<div class="imp-progress"><div class="big">🤔</div><p>Tarif formatı tanınamadı.</p></div>`;return;}
    renderImportList();
  }catch(err){document.getElementById('importBody').innerHTML=`<div class="imp-progress"><div class="big">⚠️</div><p>Hata: ${esc(err.message)}</p></div>`;}
}

async function extractHtmlText(file){const html=await file.text();const doc=new DOMParser().parseFromString(html,'text/html');doc.querySelectorAll('br').forEach(br=>br.replaceWith('\n'));doc.querySelectorAll('p,div,h1,h2,h3,h4,li,tr').forEach(el=>el.insertAdjacentText('afterend','\n'));return doc.body?doc.body.innerText||doc.body.textContent:doc.documentElement.textContent;}
async function extractPdfText(file){if(!window.pdfjsLib){await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s);});window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';}const ab=await file.arrayBuffer();const pdf=await pdfjsLib.getDocument({data:ab}).promise;let txt='';for(let i=1;i<=pdf.numPages;i++){const pg=await pdf.getPage(i);const c=await pg.getTextContent();txt+=c.items.map(x=>x.str).join(' ')+'\n';}return txt;}

function parseRecipesFromText(rawText){
  const results=[];const lines=rawText.split(/\n/).map(l=>l.trim()).filter(Boolean);
  const titleRe=/^(\d{1,3})[\)\.]\s*(.+)/;let blocks=[],current=null;
  for(const line of lines){const m=line.match(titleRe);if(m){if(current)blocks.push(current);current={title:m[2].trim(),lines:[]};}else if(current)current.lines.push(line);}
  if(current)blocks.push(current);
  for(const block of blocks){
    let ingredients=[],stepsArr=[],noteArr=[],time_minutes=null,servings=null,mode='';
    for(const line of block.lines){
      if(/^malzeme/i.test(line)||/^içindekiler/i.test(line)){mode='ing';continue;}
      if(/^yapılı|^hazırlanı/i.test(line)){mode='steps';continue;}
      if(/^not:/i.test(line)){mode='note';noteArr.push(line.replace(/^not:\s*/i,'').trim());continue;}
      const tm=line.match(/(\d+)\s*(dakika|dk\.?|saat)/i);if(tm)time_minutes=parseInt(tm[1])*(/saat/i.test(tm[2])?60:1);
      const sm=line.match(/(\d+)\s*(kişi|porsiyon|kişilik)/i);if(sm)servings=parseInt(sm[1]);
      if(mode==='ing'){const parts=line.replace(/\.\s*$/,'').split(',').map(s=>s.trim()).filter(s=>s.length>0);ingredients.push(...parts);}
      else if(mode==='steps')stepsArr.push(line);
      else if(mode==='note')noteArr.push(line);
    }
    const raw=stepsArr.join(' ').replace(/\s+/g,' ');
    const sents=raw.split(/(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜİa-zçğışöü])/).map(s=>s.trim()).filter(s=>s.length>3);
    const stepsText=sents.map((s,i)=>`${i+1}. ${s.endsWith('.')?s:s+'.'}`).join('\n');
    if(block.title.length>1&&(ingredients.length>0||stepsText.length>0)){
      results.push({name:block.title,category:guessCategory(block.title+' '+ingredients.join(' ')),emoji:guessEmoji(block.title),time_minutes,servings,ingredients,steps:stepsText,note:noteArr.join(' ').trim()||null,tags:[],is_favorite:false,added_by:currentUser?.name||''});
    }
  }
  return results;
}

function guessCategory(t){t=t.toLowerCase();if(/çorba/.test(t))return'Çorba';if(/salata/.test(t))return'Salata';if(/tatlı|pasta|kek|kurabiye|baklava|kadayıf|sütlaç/.test(t))return'Tatlı & Pasta';if(/kahvaltı|omlet|yumurta|reçel/.test(t))return'Sabah Kahvaltısı';if(/börek|poğaça|mantı|gözleme|hamur/.test(t))return'Börek & Hamur İşleri';if(/pilav|makarna/.test(t))return'Pilav & Makarna';if(/fasulye|nohut|mercimek|barbunya/.test(t))return'Baklagiller';if(/turşu|konserve/.test(t))return'Turşu & Konserve';if(/tavuk|piliç/.test(t))return'Tavuk Yemekleri';if(/balık|karides|midye/.test(t))return'Balık & Deniz Ürünleri';if(/zeytinyağlı|dolma|sarma|enginar/.test(t))return'Zeytinyağlılar';if(/köfte|kebap|kavurma|kuzu|dana/.test(t))return'Etli Yemekler';if(/sebze|güveç|türlü|patlıcan|kabak/.test(t))return'Sebze Yemekleri';if(/çay|kahve|şerbet|limonata/.test(t))return'İçecek';return'Diğer';}
function guessEmoji(n){n=n.toLowerCase();if(/çorba/.test(n))return'🍜';if(/pilav/.test(n))return'🍚';if(/köfte/.test(n))return'🥩';if(/kebap/.test(n))return'🍢';if(/salata/.test(n))return'🥗';if(/tatlı|pasta|kek/.test(n))return'🍰';if(/baklava/.test(n))return'🍯';if(/tavuk/.test(n))return'🍗';if(/balık/.test(n))return'🐟';if(/makarna/.test(n))return'🍝';if(/börek/.test(n))return'🥐';if(/kahve/.test(n))return'☕';if(/çay/.test(n))return'🍵';if(/dolma|sarma/.test(n))return'🌿';return'🍽';}

function renderImportList(){
  document.getElementById('importTitle').textContent=`📄 ${importList2.length} Tarif Bulundu`;
  document.getElementById('importBody').innerHTML=`
    <p style="font-size:12px;color:var(--text3);margin-bottom:12px;">Aktarmak istediğiniz tarifleri seçin:</p>
    <div>${importList2.map((r,idx)=>`<div class="imp-item"><label class="imp-check"><input type="checkbox" id="ic_${idx}" checked /><div><div class="imp-title">${r.emoji} ${esc(r.name)}</div><div class="imp-meta">${r.category}${r.time_minutes?' · ⏱ '+r.time_minutes+' dk':''}${r.ingredients.length?' · '+r.ingredients.length+' malzeme':''}</div></div></label></div>`).join('')}</div>
    <button class="btn-import" id="importBtn" onclick="doImport()">✅ Seçilenleri Aktar</button>`;
}

async function doImport(){
  const btn=document.getElementById('importBtn');
  const selected=importList2.filter((_,idx)=>{const cb=document.getElementById(`ic_${idx}`);return cb&&cb.checked;});
  if(!selected.length){toast('⚠️ En az bir tarif seçin');return;}
  btn.disabled=true;btn.textContent=`⏳ ${selected.length} tarif aktarılıyor...`;
  let ok=0;
  for(const r of selected){const {data,error}=await sb.from('recipes').insert({...r,added_by:currentUser?.name||''}).select().single();if(!error&&data){recipes.unshift(data);ok++;}}
  closeImport();updateCounts();updateTagsBar();renderList();
  toast(`✅ ${ok} tarif başarıyla aktarıldı!`);
}

function highlight(text, query) {
  if (!text || !query) return esc(text);
  const escaped = esc(text);
  const nText = normalize(text);
  const nQuery = normalize(query);
  if (!nQuery || !nText.includes(nQuery)) return escaped;
  let result = '';
  let i = 0;
  while (i < text.length) {
    const remaining = normalize(text.slice(i));
    if (remaining.startsWith(nQuery)) {
      const match = text.slice(i, i + nQuery.length);
      result += `<mark style="background:#FFE066;color:#2A1A0E;border-radius:3px;padding:0 2px;">${esc(match)}</mark>`;
      i += nQuery.length;
    } else {
      result += esc(text[i]);
      i++;
    }
  }
  return result;
}

function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2400);}
function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('SW kayıtlı:', reg.scope))
      .catch(err => console.log('SW hatası:', err));
  });
}

window.addEventListener('online', () => {
  document.getElementById('offlineBanner')?.remove();
  if (currentUser) fetchRecipes();
});

window.addEventListener('offline', () => {
  if (!document.getElementById('offlineBanner')) {
    const banner = document.createElement('div');
    banner.id = 'offlineBanner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#F59E0B;color:#fff;text-align:center;padding:8px;font-size:13px;font-weight:700;font-family:Nunito,sans-serif;';
    banner.textContent = '📵 Çevrimdışı — Tarifler önbellekten gösteriliyor';
    document.body.prepend(banner);
  }
});

init();
