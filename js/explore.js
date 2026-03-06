// ===========================
// EXPLORE MODULE
// js/explore.js
// ===========================

import { db, COLLECTIONS } from './firebase.js';
import { initNavbarAuth, showToast, timeAgo, truncate, CATEGORY_CONFIG } from './auth.js';
import {
  collection,
  getDocs,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// === STATE ===
let allPosts = [];
let filteredPosts = [];
let topAds = [];
let inlineAds = [];
let popupAds = [];
let adRotateIndex = 0;
let popupAdIndex = 0;

const state = {
  search: '',
  category: 'all',
  location: '',
  experience: '',
  time: 'all'
};

// === DOM REFS ===
const grid = document.getElementById('cards-grid');
const countEl = document.getElementById('result-count');
const searchInput = document.getElementById('search-input');
const catFilter = document.getElementById('cat-filter');
const locFilter = document.getElementById('loc-filter');
const expFilter = document.getElementById('exp-filter');
const timeFilter = document.getElementById('time-filter');
const clearBtn = document.getElementById('clear-filters');
const adBannerEl = document.getElementById('ad-banner');

// === INIT ===
async function init() {
  initNavbarAuth();
  initNavbarScroll();
  initMobileMenu();
  showSkeletons();
  await Promise.all([fetchAllPosts(), fetchAds()]);
  renderTopAd();
  applyFilters();
}

// === FETCH ALL COLLECTIONS ===
async function fetchAllPosts() {
  try {
    const fetches = Object.values(COLLECTIONS).filter(c => c !== COLLECTIONS.USERS && c !== COLLECTIONS.ADS)
      .map(col => fetchCollection(col));
    const results = await Promise.all(fetches);
    allPosts = results.flat().sort((a, b) => {
      const aT = a.postedAt?.toDate?.() || new Date(0);
      const bT = b.postedAt?.toDate?.() || new Date(0);
      return bT - aT;
    });
  } catch (err) {
    console.error('Error fetching posts:', err);
    showToast('Failed to load posts', 'error');
    allPosts = [];
  }
}

async function fetchCollection(colName) {
  try {
    const q = query(collection(db, colName), orderBy('postedAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, _collection: colName, ...d.data() }));
  } catch {
    return [];
  }
}

async function fetchAds() {
  try {
    const snap = await getDocs(collection(db, COLLECTIONS.ADS));
    const ads = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    topAds = ads.filter(a => a.placement === 'top');
    inlineAds = ads.filter(a => a.placement === 'betweenCards');
    popupAds = ads.filter(a => a.placement === 'popup');
    // All ads that don't have specific placement rotate through all positions
    const allAds = [...topAds, ...inlineAds, ...popupAds];
    startAdRotation(allAds);
    schedulePopupAd(allAds);
  } catch {
    topAds = [];
    inlineAds = [];
    popupAds = [];
  }
}

// === AD ROTATION — cycles through up to 4 ads across top + inline positions ===
function startAdRotation(allAds) {
  if (!allAds.length) return;
  // Rotate top banner every 30s
  setInterval(() => {
    if (!topAds.length) return;
    adRotateIndex = (adRotateIndex + 1) % topAds.length;
    renderTopAd(adRotateIndex);
  }, 30000);
  // Rotate inline ads every 45s by re-rendering cards
  setInterval(() => {
    if (!inlineAds.length) return;
    renderCards();
  }, 45000);
}

// === POPUP AD — shows after 3 minutes, then every 3 minutes ===
function schedulePopupAd(allAds) {
  const adsForPopup = popupAds.length ? popupAds : allAds;
  if (!adsForPopup.length) return;

  const THREE_MIN = 3 * 60 * 1000;

  setTimeout(() => {
    showPopupAd(adsForPopup);

    setInterval(() => {
      popupAdIndex = (popupAdIndex + 1) % adsForPopup.length;
      showPopupAd(adsForPopup);
    }, THREE_MIN);

  }, THREE_MIN);
}

function showPopupAd(ads) {
  const ad = ads[popupAdIndex % ads.length];
  if (!ad) return;

  // Remove existing popup
  document.getElementById('ad-popup-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ad-popup-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);animation:fadeIn 0.3s ease';

  overlay.innerHTML = \`
    <div style="background:var(--surface);border:1px solid var(--border2);border-radius:20px;max-width:420px;width:90%;padding:0;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.4);animation:slideUp 0.35s ease;position:relative">
      <button onclick="document.getElementById('ad-popup-overlay').remove()" style="position:absolute;top:12px;right:14px;background:rgba(255,255,255,0.1);border:none;color:var(--text-muted);cursor:pointer;font-size:18px;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;z-index:1">✕</button>
      <div style="background:linear-gradient(135deg,var(--accent-1),var(--accent-2));padding:4px 12px;font-size:11px;color:white;font-weight:600;letter-spacing:1px;text-transform:uppercase">Sponsored</div>
      \${ad.imagePath ? \`<div style="width:100%;height:180px;overflow:hidden"><img src="\${ad.imagePath}" alt="\${ad.title}" style="width:100%;height:100%;object-fit:cover"></div>\` : \`<div style="height:120px;display:flex;align-items:center;justify-content:center;font-size:60px;background:var(--surface2)">📢</div>\`}
      <div style="padding:24px">
        <div style="font-family:var(--font-display);font-size:20px;font-weight:700;margin-bottom:8px;color:var(--text)">\${ad.title}</div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:20px">Special offer — Limited time</div>
        <div style="display:flex;gap:10px">
          <button onclick="window.open('\${ad.redirectLink}','_blank');document.getElementById('ad-popup-overlay').remove()" style="flex:1;padding:12px;background:var(--accent-1);color:white;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:14px">Learn More →</button>
          <button onclick="document.getElementById('ad-popup-overlay').remove()" style="padding:12px 16px;background:var(--surface2);color:var(--text-muted);border:1px solid var(--border);border-radius:10px;cursor:pointer;font-size:13px">Skip</button>
        </div>
      </div>
    </div>
    <style>
      @keyframes fadeIn{from{opacity:0}to{opacity:1}}
      @keyframes slideUp{from{transform:translateY(40px);opacity:0}to{transform:translateY(0);opacity:1}}
    </style>
  \`;

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// === RENDER TOP AD ===
function renderTopAd(idx = 0) {
  if (!adBannerEl || !topAds.length) {
    adBannerEl?.classList.add('hidden');
    return;
  }
  const ad = topAds[idx % topAds.length];
  adBannerEl.classList.remove('hidden');
  adBannerEl.onclick = () => window.open(ad.redirectLink, '_blank');
  adBannerEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;flex:1">
      ${ad.imagePath ? `<img src="${ad.imagePath}" alt="${ad.title}" style="width:60px;height:60px;border-radius:10px;object-fit:cover">` : '<div style="width:60px;height:60px;border-radius:10px;background:rgba(108,99,255,0.1);display:flex;align-items:center;justify-content:center;font-size:24px">📢</div>'}
      <div>
        <div style="font-family:var(--font-display);font-size:16px;font-weight:700;margin-bottom:4px">${ad.title}</div>
        <div style="font-size:13px;color:var(--text-muted)">Sponsored · Click to learn more</div>
      </div>
    </div>
    <div class="btn btn-secondary btn-sm">Learn More →</div>
  `;
}

// === APPLY FILTERS ===
function applyFilters() {
  const now = new Date();

  filteredPosts = allPosts.filter(post => {
    // Category
    if (state.category !== 'all' && post._collection !== state.category) return false; // state.category is full ss_ collection name

    // Search
    if (state.search) {
      const s = state.search.toLowerCase();
      const searchable = `${post.title} ${post.company} ${post.organizer} ${post.description}`.toLowerCase();
      if (!searchable.includes(s)) return false;
    }

    // Location
    if (state.location && post.location) {
      if (!post.location.toLowerCase().includes(state.location.toLowerCase())) return false;
    }

    // Experience
    if (state.experience && post.experienceLevel) {
      if (post.experienceLevel !== state.experience) return false;
    }

    // Time
    if (state.time !== 'all' && post.postedAt) {
      const postDate = post.postedAt.toDate ? post.postedAt.toDate() : new Date(post.postedAt);
      const diff = (now - postDate) / (1000 * 60 * 60 * 24);
      if (state.time === 'week' && diff > 7) return false;
      if (state.time === 'month' && diff > 30) return false;
    }

    return true;
  });

  renderCards();
  updateCount();
}

// === RENDER CARDS WITH INLINE ADS ===
function renderCards() {
  if (!grid) return;
  grid.innerHTML = '';

  if (filteredPosts.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <h3>No Results Found</h3>
        <p>Try adjusting your filters or search query</p>
      </div>
    `;
    return;
  }

  filteredPosts.forEach((post, i) => {
    // Insert inline ad every 4 cards
    if (i > 0 && i % 4 === 0 && inlineAds.length) {
      const ad = inlineAds[(Math.floor(i / 4) - 1) % inlineAds.length];
      grid.appendChild(createAdCard(ad));
    }
    grid.appendChild(createCard(post));
  });
}

// === CREATE CARD ELEMENT ===
function createCard(post) {
  const config = CATEGORY_CONFIG[post._collection] || { icon: '📄', label: post._collection, badgeClass: '', emoji: '📄' };
  const div = document.createElement('div');
  div.className = 'card';

  const imageHtml = post.imagePath
    ? `<div class="card-image"><img src="${post.imagePath}" alt="${post.title}" loading="lazy" onerror="this.parentElement.innerHTML='<span style=font-size:40px>${config.emoji}</span>'"></div>`
    : `<div class="card-image-placeholder">${config.emoji}</div>`;

  const company = post.company || post.organizer || 'Syntax Syndicate';
  const location = post.location || post.venue || (post.mode === 'Online' ? 'Online' : '') || 'N/A';

  div.innerHTML = `
    ${imageHtml}
    <div class="card-body">
      <div class="card-top">
        <span class="card-badge ${config.badgeClass}">${config.icon} ${config.label}</span>
        <span class="card-time">${timeAgo(post.postedAt)}</span>
      </div>
      <div class="card-title">${post.title || 'Untitled'}</div>
      <div class="card-company">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
        ${company}
      </div>
      <div class="card-meta">
        ${location !== 'N/A' ? `<span class="card-tag"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${location}</span>` : ''}
        ${post.experienceLevel ? `<span class="card-tag">📊 ${post.experienceLevel}</span>` : ''}
        ${post.duration ? `<span class="card-tag">⏱ ${post.duration}</span>` : ''}
        ${post.prizePool ? `<span class="card-tag">🏆 ${post.prizePool}</span>` : ''}
      </div>
      <div class="card-desc">${truncate(post.description)}</div>
    </div>
    <div class="card-footer">
      <span style="font-size:12px;color:var(--text-muted)">${post._collection}</span>
      <a href="apply.html?id=${post.id}&type=${post._collection}" class="btn btn-primary btn-sm">View Details →</a>
    </div>
  `;

  return div;
}

// === CREATE AD CARD ===
function createAdCard(ad) {
  const div = document.createElement('div');
  div.className = 'ad-card';
  div.onclick = () => window.open(ad.redirectLink, '_blank');
  div.innerHTML = `
    <div class="ad-image">
      ${ad.imagePath ? `<img src="${ad.imagePath}" alt="${ad.title}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">` : '📢'}
    </div>
    <div>
      <div style="font-family:var(--font-display);font-size:15px;font-weight:700;margin-bottom:6px">${ad.title}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Sponsored Content</div>
      <span class="btn btn-secondary btn-sm">Learn More →</span>
    </div>
  `;
  return div;
}

function updateCount() {
  if (countEl) countEl.textContent = `${filteredPosts.length} result${filteredPosts.length !== 1 ? 's' : ''}`;
}

function showSkeletons() {
  if (!grid) return;
  grid.innerHTML = Array(6).fill(`
    <div class="skeleton">
      <div class="skeleton-img"></div>
      <div class="skeleton-body">
        <div class="skeleton-line shorter"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line short"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line shorter"></div>
      </div>
    </div>
  `).join('');
}

// === NAVBAR SCROLL ===
function initNavbarScroll() {
  const nav = document.querySelector('.navbar');
  if (!nav) return;
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });
}

// === MOBILE MENU ===
function initMobileMenu() {
  const toggle = document.querySelector('.nav-toggle');
  const mobileMenu = document.querySelector('.mobile-menu');
  if (!toggle || !mobileMenu) return;
  toggle.addEventListener('click', () => {
    mobileMenu.classList.toggle('open');
    toggle.classList.toggle('active');
  });
}

// === EVENT LISTENERS ===
searchInput?.addEventListener('input', e => {
  state.search = e.target.value.trim();
  applyFilters();
});

catFilter?.addEventListener('change', e => {
  state.category = e.target.value;
  applyFilters();
});

locFilter?.addEventListener('change', e => {
  state.location = e.target.value;
  applyFilters();
});

expFilter?.addEventListener('change', e => {
  state.experience = e.target.value;
  applyFilters();
});

timeFilter?.addEventListener('change', e => {
  state.time = e.target.value;
  applyFilters();
});

clearBtn?.addEventListener('click', () => {
  state.search = '';
  state.category = 'all';
  state.location = '';
  state.experience = '';
  state.time = 'all';
  if (searchInput) searchInput.value = '';
  if (catFilter) catFilter.value = 'all';
  if (locFilter) locFilter.value = '';
  if (expFilter) expFilter.value = '';
  if (timeFilter) timeFilter.value = 'all';
  applyFilters();
});

// === START ===
init();
