// ===========================
// ADMIN MODULE
// js/admin.js
// ===========================

import { auth, db, COLLECTIONS } from './firebase.js';
import { requireAdmin, showToast, formatDate, CATEGORY_CONFIG } from './auth.js';
import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// === STATE ===
let currentUser = null;
let allPosts = [];

// === INIT ===
async function init() {
  try {
    const { user } = await requireAdmin();
    currentUser = user;
    document.getElementById('admin-email').textContent = user.email;
    loadDashboard();
    initNav();
    initForms();
    initMobileMenu();
    showSection('dashboard');
  } catch (err) {
    console.error('Admin auth failed:', err);
  }
}

// === SIDEBAR NAVIGATION ===
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

  if (id === 'manage')    loadManagePosts();
  if (id === 'dashboard') loadDashboard();
  if (id === 'users')     loadUsersTable();
}

// === DASHBOARD ===
async function loadDashboard() {
  const cols = [
    { col: COLLECTIONS.JOBS,        id: 'stat-jobs' },
    { col: COLLECTIONS.INTERNSHIPS, id: 'stat-internships' },
    { col: COLLECTIONS.HACKATHONS,  id: 'stat-hackathons' },
    { col: COLLECTIONS.TECH_EVENTS, id: 'stat-techevents' },
    { col: COLLECTIONS.SEMINARS,    id: 'stat-seminars' },
    { col: COLLECTIONS.COURSES,     id: 'stat-courses' },
    { col: COLLECTIONS.ADS,         id: 'stat-ads' }
  ];

  let total = 0;
  for (const { col, id } of cols) {
    try {
      const snap = await getDocs(collection(db, col));
      const count = snap.size;
      total += count;
      const el = document.getElementById(id);
      if (el) el.textContent = count;
    } catch { /* skip */ }
  }
  const totalEl = document.getElementById('stat-total');
  if (totalEl) totalEl.textContent = total;

  try {
    const usersSnap = await getDocs(collection(db, COLLECTIONS.USERS));
    const usersEl = document.getElementById('stat-users');
    if (usersEl) usersEl.textContent = usersSnap.size;
  } catch { /* skip */ }
}

// === USERS TABLE ===
async function loadUsersTable() {
  const tbody      = document.getElementById('users-tbody');
  const searchInput = document.getElementById('users-search');
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted)">
        <div style="font-size:24px;margin-bottom:8px">⏳</div>
        Loading users...
      </td>
    </tr>`;

  let allUsers = [];

  try {
    // Try ordered fetch first; fall back to unordered if index missing
    let snap;
    try {
      snap = await getDocs(query(collection(db, COLLECTIONS.USERS), orderBy('createdAt', 'desc')));
    } catch {
      snap = await getDocs(collection(db, COLLECTIONS.USERS));
    }
    allUsers = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted)">
          Failed to load users: ${err.message}
        </td>
      </tr>`;
    return;
  }

  function renderUsers(users) {
    if (users.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted)">
            No users found
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = users.map((user, i) => {
      // Best available name: stored username > email prefix
      const nameRaw = user.username || user.displayName || user.name
        || (user.email ? user.email.split('@')[0].replace(/[._-]/g, ' ') : 'Unknown');

      const nameLabel = nameRaw.replace(/\b\w/g, c => c.toUpperCase());

      const initials = nameRaw
        .trim()
        .split(/\s+/)
        .map(w => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2) || '?';

      const college = user.college
        ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">🏫 ${user.college}</div>`
        : '';

      const roleBadge = user.role === 'admin'
        ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:rgba(124,111,255,0.15);color:#a89fff;letter-spacing:0.5px">⚡ ADMIN</span>`
        : `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(255,255,255,0.06);color:var(--text-muted);letter-spacing:0.3px">👤 USER</span>`;

      const applyCount = user.applyClicks || 0;
      const applyBadge = applyCount > 0
        ? `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;background:rgba(61,232,160,0.12);color:#3de8a0">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            ${applyCount} click${applyCount !== 1 ? 's' : ''}
          </span>`
        : `<span style="color:var(--text-muted);font-size:12px">—</span>`;

      return `
        <tr style="animation:fadeInRow 0.2s ease ${i * 0.03}s both">
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

  // Live search
  if (searchInput) {
    searchInput.oninput = () => {
      const q = searchInput.value.toLowerCase().trim();
      if (!q) return renderUsers(allUsers);
      renderUsers(allUsers.filter(u =>
        (u.username || '').toLowerCase().includes(q) ||
        (u.email    || '').toLowerCase().includes(q) ||
        (u.college  || '').toLowerCase().includes(q) ||
        (u.role     || '').toLowerCase().includes(q)
      ));
    };
  }

  // Summary stats
  const el = id => document.getElementById(id);
  if (el('users-total-count')) el('users-total-count').textContent = allUsers.length;
  if (el('users-admin-count')) el('users-admin-count').textContent = allUsers.filter(u => u.role === 'admin').length;
  if (el('users-total-clicks')) el('users-total-clicks').textContent = allUsers.reduce((s, u) => s + (u.applyClicks || 0), 0);
}

// === FORM INITIALIZATION ===
function initForms() {
  setupForm('form-job',        COLLECTIONS.JOBS,        buildJobData);
  setupForm('form-internship', COLLECTIONS.INTERNSHIPS, buildInternshipData);
  setupForm('form-hackathon',  COLLECTIONS.HACKATHONS,  buildHackathonData);
  setupForm('form-techevent',  COLLECTIONS.TECH_EVENTS, buildTechEventData);
  setupForm('form-seminar',    COLLECTIONS.SEMINARS,    buildSeminarData);
  setupForm('form-course',     COLLECTIONS.COURSES,     buildCourseData);
  setupForm('form-ad',         COLLECTIONS.ADS,         buildAdData);
}

function setupForm(formId, collectionName, dataBuilder) {
  const form = document.getElementById(formId);
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    try {
      const data = dataBuilder(form);
      data.createdBy = currentUser.uid;
      data.postedAt  = serverTimestamp();
      await addDoc(collection(db, collectionName), data);
      showToast(`✅ Post created successfully!`, 'success');
      form.reset();
    } catch (err) {
      console.error('Error saving:', err);
      showToast(`Failed to save: ${err.message}`, 'error');
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });
}

// === DATA BUILDERS ===
function val(form, name) { return form.querySelector(`[name="${name}"]`)?.value.trim() || ''; }

function buildJobData(form) {
  return {
    title: val(form,'title'), company: val(form,'company'),
    location: val(form,'location'), experienceLevel: val(form,'experienceLevel'),
    description: val(form,'description'), requirements: val(form,'requirements'),
    benefits: val(form,'benefits'), imagePath: val(form,'imagePath'),
    applyLink: val(form,'applyLink'), category: 'jobs'
  };
}

function buildInternshipData(form) {
  return { ...buildJobData(form), duration: val(form,'duration'), category: 'internships' };
}

function buildHackathonData(form) {
  return {
    title: val(form,'title'), organizer: val(form,'organizer'),
    mode: val(form,'mode'), prizePool: val(form,'prizePool'),
    deadline: val(form,'deadline'), description: val(form,'description'),
    imagePath: val(form,'imagePath'), applyLink: val(form,'applyLink'),
    category: 'hackathons'
  };
}

function buildTechEventData(form) {
  return {
    title: val(form,'title'), speaker: val(form,'speaker'),
    venue: val(form,'venue'), eventDate: val(form,'eventDate'),
    description: val(form,'description'), imagePath: val(form,'imagePath'),
    applyLink: val(form,'applyLink'), category: 'techEvents'
  };
}

function buildSeminarData(form) {
  return { ...buildTechEventData(form), category: 'seminars' };
}

function buildCourseData(form) {
  return {
    title: val(form,'title'), instructor: val(form,'instructor'),
    platform: val(form,'platform'), level: val(form,'level'),
    duration: val(form,'duration'), price: val(form,'price'),
    description: val(form,'description'), imagePath: val(form,'imagePath'),
    applyLink: val(form,'applyLink'), category: 'courses'
  };
}

function buildAdData(form) {
  return {
    title: val(form,'title'), imagePath: val(form,'imagePath'),
    redirectLink: val(form,'redirectLink'), placement: val(form,'placement'),
    createdAt: serverTimestamp()
  };
}

// === MANAGE POSTS ===
const FILTER_TO_COLLECTION = {
  jobs: COLLECTIONS.JOBS, internships: COLLECTIONS.INTERNSHIPS,
  hackathons: COLLECTIONS.HACKATHONS, techEvents: COLLECTIONS.TECH_EVENTS,
  seminars: COLLECTIONS.SEMINARS, courses: COLLECTIONS.COURSES, ads: COLLECTIONS.ADS
};

async function loadManagePosts() {
  const tbody     = document.getElementById('posts-tbody');
  const filterSel = document.getElementById('manage-filter');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted)">Loading...</td></tr>';

  const selectedVal = filterSel?.value || 'all';
  allPosts = [];

  const colsToFetch = selectedVal === 'all'
    ? Object.values(COLLECTIONS).filter(c => c !== COLLECTIONS.USERS && c !== COLLECTIONS.ADS)
    : [FILTER_TO_COLLECTION[selectedVal] || selectedVal];

  for (const col of colsToFetch) {
    try {
      const snap = await getDocs(query(collection(db, col), orderBy('postedAt', 'desc')));
      snap.docs.forEach(d => allPosts.push({ id: d.id, _col: col, ...d.data() }));
    } catch (e) { console.warn('skip col', col, e.message); }
  }

  if (allPosts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted)">No posts found</td></tr>';
    return;
  }

  tbody.innerHTML = allPosts.map(post => {
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

// === DELETE POST ===
window.deletePost = async function(id, col) {
  if (!confirm('Delete this post permanently?')) return;
  try {
    await deleteDoc(doc(db, col, id));
    showToast('Post deleted', 'success');
    loadManagePosts();
    loadDashboard();
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
};

// === EDIT POST ===
window.editPost = async function(id, col) {
  try {
    const snap = await getDoc(doc(db, col, id));
    if (!snap.exists()) return showToast('Post not found', 'error');
    openEditModal(id, col, snap.data());
  } catch (err) {
    showToast('Error loading post', 'error');
  }
};

function openEditModal(id, col, data) {
  const modal     = document.getElementById('edit-modal');
  const modalBody = document.getElementById('edit-modal-body');
  if (!modal || !modalBody) return;

  const fields = getFieldsForCollection(col, data);
  modalBody.innerHTML = `
    <form id="edit-form">
      <div class="form-grid">
        ${fields.map(f => `
          <div class="form-group ${f.full ? 'full' : ''}">
            <label class="form-label">${f.label}</label>
            ${f.type === 'textarea'
              ? `<textarea name="${f.name}" class="form-textarea" ${f.required ? 'required' : ''}>${data[f.name] || ''}</textarea>`
              : f.type === 'select'
              ? `<select name="${f.name}" class="form-select">
                  ${f.options.map(o => `<option value="${o}" ${data[f.name] === o ? 'selected' : ''}>${o}</option>`).join('')}
                </select>`
              : `<input type="${f.type || 'text'}" name="${f.name}" class="form-input" value="${data[f.name] || ''}" ${f.required ? 'required' : ''}>`
            }
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:12px;margin-top:24px">
        <button type="submit" class="btn btn-primary">Save Changes</button>
        <button type="button" class="btn btn-secondary" onclick="closeEditModal()">Cancel</button>
      </div>
    </form>`;

  modal.classList.add('open');

  document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn  = form.querySelector('button[type="submit"]');
    btn.textContent = 'Saving...';
    btn.disabled = true;

    try {
      const updates = {};
      fields.forEach(f => {
        const el = form.querySelector(`[name="${f.name}"]`);
        if (el) updates[f.name] = el.value.trim();
      });
      await updateDoc(doc(db, col, id), updates);
      showToast('Post updated successfully!', 'success');
      closeEditModal();
      loadManagePosts();
    } catch (err) {
      showToast('Update failed: ' + err.message, 'error');
    } finally {
      btn.textContent = 'Save Changes';
      btn.disabled = false;
    }
  });
}

function getFieldsForCollection(col, data) {
  const common = [
    { name: 'title',       label: 'Title',                    required: true },
    { name: 'description', label: 'Description', type: 'textarea', full: true },
    { name: 'imagePath',   label: 'Image Path',               full: true },
    { name: 'applyLink',   label: 'Apply / Registration Link', full: true }
  ];
  switch (col) {
    case COLLECTIONS.JOBS:
    case COLLECTIONS.INTERNSHIPS:
      return [
        ...common,
        { name: 'company',  label: 'Company' },
        { name: 'location', label: 'Location' },
        { name: 'experienceLevel', label: 'Experience Level', type: 'select', options: ['','Entry Level','Junior','Mid Level','Senior','Lead'] },
        { name: 'requirements', label: 'Requirements', type: 'textarea', full: true },
        { name: 'benefits',     label: 'Benefits',     type: 'textarea', full: true },
        ...(col === COLLECTIONS.INTERNSHIPS ? [{ name: 'duration', label: 'Duration' }] : [])
      ];
    case COLLECTIONS.HACKATHONS:
      return [
        ...common,
        { name: 'organizer', label: 'Organizer' },
        { name: 'mode',      label: 'Mode',         type: 'select', options: ['Online','Offline','Hybrid'] },
        { name: 'prizePool', label: 'Prize Pool' },
        { name: 'deadline',  label: 'Deadline',     type: 'date' }
      ];
    case COLLECTIONS.TECH_EVENTS:
    case COLLECTIONS.SEMINARS:
      return [
        ...common,
        { name: 'speaker',   label: 'Speaker' },
        { name: 'venue',     label: 'Venue' },
        { name: 'eventDate', label: 'Event Date', type: 'date' }
      ];
    case COLLECTIONS.COURSES:
      return [
        { name: 'title',      label: 'Course Title', required: true },
        { name: 'instructor', label: 'Instructor' },
        { name: 'platform',   label: 'Platform' },
        { name: 'level',      label: 'Level', type: 'select', options: ['','Beginner','Intermediate','Advanced','All Levels'] },
        { name: 'duration',   label: 'Duration' },
        { name: 'price',      label: 'Price' },
        { name: 'description', label: 'Description', type: 'textarea', full: true },
        { name: 'imagePath',  label: 'Image Path',   full: true },
        { name: 'applyLink',  label: 'Enroll Link',  full: true }
      ];
    case COLLECTIONS.ADS:
      return [
        { name: 'title',        label: 'Ad Title',      required: true },
        { name: 'imagePath',    label: 'Image Path',    full: true },
        { name: 'redirectLink', label: 'Redirect Link', full: true },
        { name: 'placement',    label: 'Placement', type: 'select', options: ['top','betweenCards','popup'] }
      ];
    default:
      return common;
  }
}

window.closeEditModal = function() {
  document.getElementById('edit-modal')?.classList.remove('open');
};

document.getElementById('edit-modal')?.addEventListener('click', function(e) {
  if (e.target === this) closeEditModal();
});

document.getElementById('manage-filter')?.addEventListener('change', loadManagePosts);

// === MOBILE SIDEBAR ===
function initMobileMenu() {
  const toggle  = document.querySelector('.admin-menu-toggle');
  const sidebar = document.querySelector('.admin-sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  toggle?.addEventListener('click',  () => { sidebar?.classList.toggle('open'); overlay?.classList.toggle('open'); });
  overlay?.addEventListener('click', closeMobileSidebar);
}

function closeMobileSidebar() {
  document.querySelector('.admin-sidebar')?.classList.remove('open');
  document.querySelector('.sidebar-overlay')?.classList.remove('open');
}

// === START ===
init();