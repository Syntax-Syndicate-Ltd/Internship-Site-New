// ===========================
// AUTH MODULE
// js/auth.js
// ===========================

import { auth, db, COLLECTIONS } from './firebase.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// === ENSURE PERSISTENCE IS SET ===
setPersistence(auth, browserLocalPersistence).catch(console.error);

// =============================================
// USER DATA CACHE (sessionStorage)
// Avoids hitting Firestore on every single page load.
// After first fetch, role + profile is read from
// sessionStorage instantly — zero network round trip.
// Cache is cleared on sign-out.
// =============================================
const USER_CACHE_KEY = 'ss_user_cache';

function getCachedUserData(uid) {
  try {
    const raw = sessionStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.uid !== uid) return null; // different user
    return parsed;
  } catch { return null; }
}

function setCachedUserData(uid, data) {
  try {
    sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify({ uid, ...data }));
  } catch { /* sessionStorage full or unavailable */ }
}

function clearUserCache() {
  try { sessionStorage.removeItem(USER_CACHE_KEY); } catch { /* ignore */ }
}

// === TOAST NOTIFICATION ===
export function showToast(message, type = 'info', duration = 4000) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon"></span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// === WRITE USER TO FIRESTORE (with retry) ===
async function writeUserToFirestore(uid, email, retries = 3) {
  const userData = {
    uid,
    email,
    username:    email.split('@')[0],
    college:     '',
    role:        'user',
    applyClicks: 0,
    createdAt:   serverTimestamp()
  };

  for (let i = 0; i < retries; i++) {
    try {
      await setDoc(doc(db, COLLECTIONS.USERS, uid), userData);
      console.log('✅ User written to Firestore:', uid);
      return true;
    } catch (err) {
      console.error(`❌ Firestore write attempt ${i + 1} failed:`, err.code, err.message);
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, 1000));
      } else {
        throw err;
      }
    }
  }
}

// === GET USER DATA FROM FIRESTORE ===
// Checks sessionStorage first — only hits Firestore if cache is empty
export async function getUserData(uid) {
  const cached = getCachedUserData(uid);
  if (cached) return cached;

  try {
    const snap = await getDoc(doc(db, COLLECTIONS.USERS, uid));
    const data = snap.exists() ? snap.data() : null;
    if (data) setCachedUserData(uid, data);
    return data;
  } catch (err) {
    console.error('Error fetching user data:', err);
    return null;
  }
}

// === GET USER ROLE FROM FIRESTORE ===
export async function getUserRole(uid) {
  try {
    const data = await getUserData(uid);
    return data?.role || 'user';
  } catch (err) {
    console.error('Error fetching user role:', err);
    return 'user';
  }
}

// === SIGNUP ===
export async function signUp(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  console.log('✅ Auth user created:', cred.user.uid);
  await writeUserToFirestore(cred.user.uid, email);
  return cred.user;
}

// === LOGIN ===
export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

// === LOGOUT ===
export async function logout() {
  clearUserCache(); // wipe cache on sign-out
  await signOut(auth);
}

// === AUTH STATE OBSERVER ===
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// === REQUIRE AUTH ===
export function requireAuth(redirectUrl = 'login.html') {
  return new Promise((resolve, reject) => {
    if (auth.currentUser) {
      return resolve(auth.currentUser);
    }
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      if (user) {
        resolve(user);
      } else {
        window.location.href = redirectUrl;
        reject(new Error('Not authenticated'));
      }
    });
  });
}

// === REQUIRE ADMIN ===
// Checks sessionStorage cache first — skips Firestore entirely if role is cached
export async function requireAdmin() {
  return new Promise((resolve, reject) => {
    const checkRole = async (user) => {
      if (!user) {
        window.location.href = 'login.html';
        return reject(new Error('Not authenticated'));
      }

      // Cache hit — resolve instantly, zero Firestore reads
      const cached = getCachedUserData(user.uid);
      if (cached?.role === 'admin') {
        return resolve({ user, role: 'admin' });
      }

      // Cache miss — fetch from Firestore, cache for next time
      const role = await getUserRole(user.uid);
      if (role !== 'admin') {
        window.location.href = 'index.html';
        return reject(new Error('Not authorized'));
      }
      resolve({ user, role });
    };

    if (auth.currentUser) {
      return checkRole(auth.currentUser);
    }

    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      await checkRole(user);
    });
  });
}

// === NAVBAR AUTH STATE ===
export function initNavbarAuth() {
  const navAuth    = document.querySelector('.nav-auth');
  const mobileAuth = document.getElementById('mobile-auth-container');

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      // getUserData uses sessionStorage cache — no Firestore read on repeat visits
      const data = await getUserData(user.uid);
      const role  = data?.role || 'user';

      const displayName = data?.username
        || user.displayName
        || user.email.split('@')[0];

      const initials = displayName
        .trim()
        .split(/\s+/)
        .map(w => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

      const college = data?.college
        ? `<div style="font-size:11px;color:var(--text-muted);margin-top:1px">${data.college}</div>`
        : '';

      if (navAuth) {
        navAuth.innerHTML = `
          <div class="user-menu">
            <div class="user-avatar" title="${displayName}">${initials}</div>
            <div class="user-dropdown">
              <div class="user-dropdown-item" style="flex-direction:column;align-items:flex-start;gap:2px">
                <span style="font-weight:600;font-size:13px">${displayName}</span>
                ${college}
              </div>
              <div style="padding:4px 12px;font-size:11px;color:var(--accent);font-weight:600">${role.toUpperCase()}</div>
              <hr>
              ${role === 'admin' ? `<a href="admin.html" class="user-dropdown-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                Admin Panel
              </a>` : ''}
              <div class="user-dropdown-item danger" id="logout-btn" style="cursor:pointer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Sign Out
              </div>
            </div>
          </div>
        `;
        document.getElementById('logout-btn')?.addEventListener('click', async () => {
          await logout();
          showToast('Signed out successfully', 'info');
          setTimeout(() => window.location.href = 'index.html', 800);
        });
      }

      if (mobileAuth) {
        mobileAuth.innerHTML = `
          <div style="padding:8px 14px">
            <div style="font-size:13px;font-weight:600;color:var(--text)">👤 ${displayName}</div>
            ${data?.college ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${data.college}</div>` : ''}
            <div style="margin-top:2px;font-size:11px;color:var(--accent);font-weight:600">${role.toUpperCase()}</div>
          </div>
          ${role === 'admin' ? `<a href="admin.html" class="btn btn-secondary" style="flex:1">⚡ Admin</a>` : ''}
          <button class="btn btn-danger" id="mobile-logout-btn" style="flex:1">Sign Out</button>
        `;
        document.getElementById('mobile-logout-btn')?.addEventListener('click', async () => {
          await logout();
          showToast('Signed out successfully', 'info');
          setTimeout(() => window.location.href = 'index.html', 800);
        });
      }

    } else {
      if (navAuth) {
        navAuth.innerHTML = `
          <a href="login.html" class="btn btn-ghost">Login</a>
          <a href="signup.html" class="btn btn-primary">Sign Up</a>
        `;
      }
      if (mobileAuth) {
        mobileAuth.innerHTML = `
          <a href="login.html" class="btn btn-ghost">Login</a>
          <a href="signup.html" class="btn btn-primary">Sign Up</a>
        `;
      }
    }
  });
}

// === FORMAT TIME AGO ===
export function timeAgo(timestamp) {
  if (!timestamp) return 'Recently';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
  return date.toLocaleDateString('en-US', { month:'short', day:'numeric' });
}

// === FORMAT FULL DATE ===
export function formatDate(timestamp) {
  if (!timestamp) return 'N/A';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// === TRUNCATE TEXT ===
export function truncate(text, max = 120) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

// === CATEGORY ICONS ===
export const CATEGORY_CONFIG = {
  ss_jobs:       { icon: '💼', label: 'Job',        badgeClass: 'badge-job',       emoji: '🏢' },
  ss_internships:{ icon: '🎓', label: 'Internship', badgeClass: 'badge-internship', emoji: '📚' },
  ss_hackathons: { icon: '⚡', label: 'Hackathon',  badgeClass: 'badge-hackathon',  emoji: '🏆' },
  ss_techEvents: { icon: '🛠', label: 'Tech Event', badgeClass: 'badge-techEvent',  emoji: '💡' },
  ss_seminars:   { icon: '🎤', label: 'Seminar',    badgeClass: 'badge-seminar',    emoji: '🎓' },
  ss_courses:    { icon: '📖', label: 'Course',     badgeClass: 'badge-course',     emoji: '🎒' }
};