// ===========================
// ADMIN MODULE
// js/admin.js
// ===========================

import { auth, db, COLLECTIONS } from './firebase.js';
import { requireAdmin, showToast, formatDate, CATEGORY_CONFIG } from './auth.js';
import {
  collection, addDoc, getDocs, getDoc,
  updateDoc, deleteDoc, doc,
  serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// =============================================
// IN-MEMORY CACHE
// =============================================
const cache = {
  posts:   null,
  users:   null,
  postsTs: 0,
  usersTs: 0,
  TTL:     60_000
};
const isFresh  = ts => Date.now() - ts < cache.TTL;
const bustPosts = () => { cache.posts = null; cache.postsTs = 0; };
const bustUsers = () => { cache.users = null; cache.usersTs = 0; };

const POST_COLS = [
  COLLECTIONS.JOBS, COLLECTIONS.INTERNSHIPS, COLLECTIONS.HACKATHONS,
  COLLECTIONS.TECH_EVENTS, COLLECTIONS.SEMINARS, COLLECTIONS.COURSES, COLLECTIONS.ADS
];

// Wrap any promise with a timeout
function withTimeout(promise, ms = 10000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out after ' + ms + 'ms')), ms))
  ]);
}

async function fetchAllPosts(force = false) {
  if (!force && cache.posts && isFresh(cache.postsTs)) return cache.posts;

  const results = await Promise.all(
    POST_COLS.map(col =>
      withTimeout(getDocs(collection(db, col)))
        .then(snap => snap.docs.map(d => ({ id: d.id, _col: col, ...d.data() })))
        .catch(() => [])
    )
  );

  cache.posts   = results.flat();
  cache.postsTs = Date.now();
  return cache.posts;
}

async function fetchAllUsers(force = false) {
  if (!force && cache.users && isFresh(cache.usersTs)) return cache.users;

  console.log('🔍 Fetching ss_users...');
  // withTimeout prevents hanging forever on deployed environments
  const snap  = await withTimeout(getDocs(collection(db, COLLECTIONS.USERS)), 10000);
  console.log('✅ ss_users fetched, count:', snap.size);
  const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  users.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

  cache.users   = users;
  cache.usersTs = Date.now();
  return cache.users;
}

// =============================================
let currentUser = null;

async function init() {
  try {
    const { user } = await requireAdmin();
    currentUser = user;
    document.getElementById('admin-email').textContent = user.email;
    initNav();
    initForms();
    initMobileMenu();
    // Prefetch AFTER auth confirmed — no silent catch swallowing errors
    await Promise.all([fetchAllPosts(), fetchAllUsers()]);
    showSection('dashboard');
  } catch (err) {
    console.error('Admin init failed:', err);
  }
}

function initNav() {
  document.querySelectorAll('.sidebar-link[data-section]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      showSection(link.dataset.section);
      closeMobileSidebar();
    });
  });
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });
}

function showSection(id) {
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  document.getElementById(`section-${id}`)?.classList.add('active');
  document.querySelector(`.sidebar-link[data-section="${id}"]`)?.classList.add('active');

  if (id === 'dashboard') loadDashboard();
  if (id === 'manage')    loadManagePosts();
  if (id === 'users')     loadUsersTable();
}

// =============================================
// DASHBOARD
// =============================================
async function loadDashboard() {
  const [posts, users] = await Promise.all([
    fetchAllPosts(),
    fetchAllUsers().catch(() => [])
  ]);

  const countMap = {};
  posts.forEach(p => { countMap[p._col] = (countMap[p._col] || 0) + 1; });

  const colStatMap = {
    [COLLECTIONS.JOBS]:        'stat-jobs',
    [COLLECTIONS.INTERNSHIPS]: 'stat-internships',
    [COLLECTIONS.HACKATHONS]:  'stat-hackathons',
    [COLLECTIONS.TECH_EVENTS]: 'stat-techevents',
    [COLLECTIONS.SEMINARS]:    'stat-seminars',
    [COLLECTIONS.COURSES]:     'stat-courses',
    [COLLECTIONS.ADS]:         'stat-ads'
  };

  let total = 0;
  Object.entries(colStatMap).forEach(([col, statId]) => {
    const count = countMap[col] || 0;
    const el = document.getElementById(statId);
    if (el) el.textContent = count;
    if (col !== COLLECTIONS.ADS) total += count;
  });

  const totalEl = document.getElementById('stat-total');
  if (totalEl) totalEl.textContent = total;

  const usersEl = document.getElementById('stat-users');
  if (usersEl) usersEl.textContent = users.length;
}

// =============================================
// USERS TABLE
// =============================================
async function loadUsersTable() {
  const tbody       = document.getElementById('users-tbody');
  const searchInput = document.getElementById('users-search');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text-muted)">Loading users…</td></tr>`;

  let allUsers;
  try {
    allUsers = await fetchAllUsers(true); // force=true: always re-fetch when tab opens
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:32px;color:#ff6b6b">❌ Failed to load users: ${err.message}<br><small style="opacity:0.7">Check browser console (F12) for details</small></td></tr>`;
    console.error('loadUsersTable error:', err);
    return;
  }

  function renderUsers(list) {
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text-muted)">No users found</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map((user, i) => {
      const nameRaw   = user.username || user.displayName || user.name
        || (user.email ? user.email.split('@')[0].replace(/[._-]/g, ' ') : 'Unknown');
      const nameLabel = nameRaw.replace(/\b\w/g, c => c.toUpperCase());
      const initials  = nameRaw.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
      const college   = user.college ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">🏫 ${user.college}</div>` : '';
      const roleBadge = user.role === 'admin'
        ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:rgba(124,111,255,0.15);color:#a89fff">⚡ ADMIN</span>`
        : `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(255,255,255,0.06);color:var(--text-muted)">👤 USER</span>`;
      const applyCount = user.applyClicks || 0;
      const applyBadge = applyCount > 0
        ? `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;background:rgba(61,232,160,0.12);color:#3de8a0">✓ ${applyCount} click${applyCount !== 1 ? 's' : ''}</span>`
        : `<span style="color:var(--text-muted);font-size:12px">—</span>`;

      return `
        <tr style="animation:fadeInRow 0.15s ease ${Math.min(i,10)*0.02}s both">
          <td>
            <div style="display:flex;align-items:center;gap:12px">
              <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#ff6b8a);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#fff;flex-shrink:0">${initials}</div>
              <div>
                <div style="font-weight:600;color:var(--text);font-size:14px">${nameLabel}</div>
                ${college}
              </div>
            </div>
          </td>
          <td style="font-size:13px;color:var(--text-secondary)">${user.email || '—'}</td>
          <td>${roleBadge}</td>
          <td>${applyBadge}</td>
          <td style="font-size:12px;color:var(--text-muted)">${formatDate(user.createdAt)}</td>
        </tr>`;
    }).join('');
  }

  renderUsers(allUsers);

  if (searchInput) {
    searchInput.oninput = () => {
      const q = searchInput.value.toLowerCase().trim();
      renderUsers(q ? allUsers.filter(u =>
        (u.username || '').toLowerCase().includes(q) ||
        (u.email    || '').toLowerCase().includes(q) ||
        (u.college  || '').toLowerCase().includes(q) ||
        (u.role     || '').toLowerCase().includes(q)
      ) : allUsers);
    };
  }

  const g = id => document.getElementById(id);
  if (g('users-total-count'))  g('users-total-count').textContent  = allUsers.length;
  if (g('users-admin-count'))  g('users-admin-count').textContent  = allUsers.filter(u => u.role === 'admin').length;
  if (g('users-total-clicks')) g('users-total-clicks').textContent = allUsers.reduce((s, u) => s + (u.applyClicks || 0), 0);
}

// =============================================
// MANAGE POSTS
// =============================================
const FILTER_TO_COLLECTION = {
  jobs: COLLECTIONS.JOBS, internships: COLLECTIONS.INTERNSHIPS,
  hackathons: COLLECTIONS.HACKATHONS, techEvents: COLLECTIONS.TECH_EVENTS,
  seminars: COLLECTIONS.SEMINARS, courses: COLLECTIONS.COURSES, ads: COLLECTIONS.ADS
};

async function loadManagePosts() {
  const tbody     = document.getElementById('posts-tbody');
  const filterSel = document.getElementById('manage-filter');
  if (!tbody) return;

  if (!cache.posts) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-muted)">Loading…</td></tr>';
  }

  const allPosts    = await fetchAllPosts();
  const selectedVal = filterSel?.value || 'all';

  const filtered = (selectedVal === 'all'
    ? allPosts
    : allPosts.filter(p => p._col === (FILTER_TO_COLLECTION[selectedVal] || selectedVal))
  ).slice().sort((a, b) => (b.postedAt?.toMillis?.() ?? 0) - (a.postedAt?.toMillis?.() ?? 0));

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-muted)">No posts found</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(post => {
    const config = CATEGORY_CONFIG[post._col] || { icon: '📄', label: post._col };
    return `
      <tr>
        <td>${post.title || 'Untitled'}</td>
        <td><span class="card-badge ${config.badgeClass || ''}">${config.icon} ${config.label}</span></td>
        <td>${post.company || post.organizer || '—'}</td>
        <td>${post.location || post.venue || '—'}</td>
        <td>${formatDate(post.postedAt)}</td>
        <td>
          <div class="table-actions">
            <button class="btn btn-secondary btn-sm" onclick="editPost('${post.id}','${post._col}')">✏️ Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deletePost('${post.id}','${post._col}')">🗑 Delete</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

// =============================================
// FORMS
// =============================================
function initForms() {
  setupForm('form-job',        COLLECTIONS.JOBS,        buildJobData);
  setupForm('form-internship', COLLECTIONS.INTERNSHIPS, buildInternshipData);
  setupForm('form-hackathon',  COLLECTIONS.HACKATHONS,  buildHackathonData);
  setupForm('form-techevent',  COLLECTIONS.TECH_EVENTS, buildTechEventData);
  setupForm('form-seminar',    COLLECTIONS.SEMINARS,    buildSeminarData);
  setupForm('form-course',     COLLECTIONS.COURSES,     buildCourseData);
  setupForm('form-ad',         COLLECTIONS.ADS,         buildAdData);
}

function setupForm(formId, col, builder) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const orig = btn.textContent;
    btn.textContent = 'Saving…'; btn.disabled = true;
    try {
      const data = builder(form);
      data.createdBy = currentUser.uid;
      data.postedAt  = serverTimestamp();
      await addDoc(collection(db, col), data);
      showToast('✅ Post created!', 'success');
      form.reset();
      bustPosts();
    } catch (err) {
      showToast('Failed: ' + err.message, 'error');
    } finally {
      btn.textContent = orig; btn.disabled = false;
    }
  });
}

const val = (form, name) => form.querySelector(`[name="${name}"]`)?.value.trim() || '';
function buildJobData(f)  {
  return { title: val(f,'title'), company: val(f,'company'), location: val(f,'location'),
    experienceLevel: val(f,'experienceLevel'), description: val(f,'description'),
    requirements: val(f,'requirements'), benefits: val(f,'benefits'),
    imagePath: val(f,'imagePath'), applyLink: val(f,'applyLink'), category: 'jobs' };
}
function buildInternshipData(f) { return { ...buildJobData(f), duration: val(f,'duration'), category: 'internships' }; }
function buildHackathonData(f)  {
  return { title: val(f,'title'), organizer: val(f,'organizer'), mode: val(f,'mode'),
    prizePool: val(f,'prizePool'), deadline: val(f,'deadline'), description: val(f,'description'),
    imagePath: val(f,'imagePath'), applyLink: val(f,'applyLink'), category: 'hackathons' };
}
function buildTechEventData(f)  {
  return { title: val(f,'title'), speaker: val(f,'speaker'), venue: val(f,'venue'),
    eventDate: val(f,'eventDate'), description: val(f,'description'),
    imagePath: val(f,'imagePath'), applyLink: val(f,'applyLink'), category: 'techEvents' };
}
function buildSeminarData(f) { return { ...buildTechEventData(f), category: 'seminars' }; }
function buildCourseData(f)  {
  return { title: val(f,'title'), instructor: val(f,'instructor'), platform: val(f,'platform'),
    level: val(f,'level'), duration: val(f,'duration'), price: val(f,'price'),
    description: val(f,'description'), imagePath: val(f,'imagePath'),
    applyLink: val(f,'applyLink'), category: 'courses' };
}
function buildAdData(f) {
  return { title: val(f,'title'), imagePath: val(f,'imagePath'),
    redirectLink: val(f,'redirectLink'), placement: val(f,'placement'), createdAt: serverTimestamp() };
}

// =============================================
// DELETE / EDIT
// =============================================
window.deletePost = async function(id, col) {
  if (!confirm('Delete this post permanently?')) return;
  try {
    await deleteDoc(doc(db, col, id));
    showToast('Post deleted', 'success');
    bustPosts();
    loadManagePosts();
    loadDashboard();
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
};

window.editPost = async function(id, col) {
  try {
    const snap = await getDoc(doc(db, col, id));
    if (!snap.exists()) return showToast('Post not found', 'error');
    openEditModal(id, col, snap.data());
  } catch { showToast('Error loading post', 'error'); }
};

function openEditModal(id, col, data) {
  const modal = document.getElementById('edit-modal');
  const body  = document.getElementById('edit-modal-body');
  if (!modal || !body) return;

  const fields = getFieldsForCollection(col, data);
  body.innerHTML = `
    <form id="edit-form">
      <div class="form-grid">
        ${fields.map(f => `
          <div class="form-group ${f.full ? 'full' : ''}">
            <label class="form-label">${f.label}</label>
            ${f.type === 'textarea'
              ? `<textarea name="${f.name}" class="form-textarea" ${f.required ? 'required' : ''}>${data[f.name] || ''}</textarea>`
              : f.type === 'select'
              ? `<select name="${f.name}" class="form-select">${f.options.map(o =>
                  `<option value="${o}" ${data[f.name] === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`
              : `<input type="${f.type||'text'}" name="${f.name}" class="form-input" value="${data[f.name]||''}" ${f.required?'required':''}>`
            }
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:12px;margin-top:24px">
        <button type="submit" class="btn btn-primary">Save Changes</button>
        <button type="button" class="btn btn-secondary" onclick="closeEditModal()">Cancel</button>
      </div>
    </form>`;

  modal.classList.add('open');
  document.getElementById('edit-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const btn  = form.querySelector('button[type="submit"]');
    btn.textContent = 'Saving…'; btn.disabled = true;
    try {
      const updates = {};
      fields.forEach(f => { const el = form.querySelector(`[name="${f.name}"]`); if (el) updates[f.name] = el.value.trim(); });
      await updateDoc(doc(db, col, id), updates);
      showToast('Post updated!', 'success');
      closeEditModal(); bustPosts(); loadManagePosts();
    } catch (err) {
      showToast('Update failed: ' + err.message, 'error');
    } finally { btn.textContent = 'Save Changes'; btn.disabled = false; }
  });
}

function getFieldsForCollection(col, data) {
  const common = [
    { name: 'title', label: 'Title', required: true },
    { name: 'description', label: 'Description', type: 'textarea', full: true },
    { name: 'imagePath', label: 'Image Path', full: true },
    { name: 'applyLink', label: 'Apply / Registration Link', full: true }
  ];
  switch (col) {
    case COLLECTIONS.JOBS:
    case COLLECTIONS.INTERNSHIPS:
      return [...common,
        { name: 'company', label: 'Company' }, { name: 'location', label: 'Location' },
        { name: 'experienceLevel', label: 'Experience Level', type: 'select', options: ['','Entry Level','Junior','Mid Level','Senior','Lead'] },
        { name: 'requirements', label: 'Requirements', type: 'textarea', full: true },
        { name: 'benefits', label: 'Benefits', type: 'textarea', full: true },
        ...(col === COLLECTIONS.INTERNSHIPS ? [{ name: 'duration', label: 'Duration' }] : [])];
    case COLLECTIONS.HACKATHONS:
      return [...common,
        { name: 'organizer', label: 'Organizer' },
        { name: 'mode', label: 'Mode', type: 'select', options: ['Online','Offline','Hybrid'] },
        { name: 'prizePool', label: 'Prize Pool' },
        { name: 'deadline', label: 'Deadline', type: 'date' }];
    case COLLECTIONS.TECH_EVENTS:
    case COLLECTIONS.SEMINARS:
      return [...common,
        { name: 'speaker', label: 'Speaker' }, { name: 'venue', label: 'Venue' },
        { name: 'eventDate', label: 'Event Date', type: 'date' }];
    case COLLECTIONS.COURSES:
      return [
        { name: 'title', label: 'Course Title', required: true },
        { name: 'instructor', label: 'Instructor' }, { name: 'platform', label: 'Platform' },
        { name: 'level', label: 'Level', type: 'select', options: ['','Beginner','Intermediate','Advanced','All Levels'] },
        { name: 'duration', label: 'Duration' }, { name: 'price', label: 'Price' },
        { name: 'description', label: 'Description', type: 'textarea', full: true },
        { name: 'imagePath', label: 'Image Path', full: true },
        { name: 'applyLink', label: 'Enroll Link', full: true }];
    case COLLECTIONS.ADS:
      return [
        { name: 'title', label: 'Ad Title', required: true },
        { name: 'imagePath', label: 'Image Path', full: true },
        { name: 'redirectLink', label: 'Redirect Link', full: true },
        { name: 'placement', label: 'Placement', type: 'select', options: ['top','betweenCards','popup'] }];
    default: return common;
  }
}

window.closeEditModal = function() { document.getElementById('edit-modal')?.classList.remove('open'); };
document.getElementById('edit-modal')?.addEventListener('click', function(e) { if (e.target === this) closeEditModal(); });
document.getElementById('manage-filter')?.addEventListener('change', loadManagePosts);

function initMobileMenu() {
  const toggle  = document.querySelector('.admin-menu-toggle');
  const sidebar = document.querySelector('.admin-sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  toggle?.addEventListener('click', () => { sidebar?.classList.toggle('open'); overlay?.classList.toggle('open'); });
  overlay?.addEventListener('click', closeMobileSidebar);
}
function closeMobileSidebar() {
  document.querySelector('.admin-sidebar')?.classList.remove('open');
  document.querySelector('.sidebar-overlay')?.classList.remove('open');
}

init();
