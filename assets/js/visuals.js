import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';
import { applyAnimationMode, applyVisualTheme, buildThemeFromAccent } from './theme.js';

function createBuiltInPreset(id, name, background, accent, extra = {}) {
  return {
    id,
    name,
    kind: 'preset',
    source: 'built-in',
    ...buildThemeFromAccent(background, accent, name),
    ...extra
  };
}

// Developer note: add new presets here using createBuiltInPreset(...)
const BUILT_IN_PRESETS = [
  createBuiltInPreset('preset_classic', 'Classic Indigo', 'radial-gradient(circle at top, #f7f5ff 0%, #e5f4ff 45%, #f6fff7 100%)', '#4f46e5'),
  createBuiltInPreset('preset_forest', 'Forest Calm', 'radial-gradient(circle at top, #f3fff8 0%, #dcfce7 42%, #eefbf2 100%)', '#0f766e'),
  createBuiltInPreset('preset_sunset', 'Sunset Warm', 'radial-gradient(circle at top, #fff7ed 0%, #ffedd5 48%, #fef3c7 100%)', '#ea580c'),
  createBuiltInPreset('preset_midnight', 'Midnight Blue', 'radial-gradient(circle at top, #ecf3ff 0%, #dbeafe 45%, #e0e7ff 100%)', '#1d4ed8'),
  createBuiltInPreset('preset_darkmode', 'Dark Mode', 'radial-gradient(circle at top, #121826 0%, #0f172a 48%, #111827 100%)', '#8b5cf6', {
    textColor: '#e5e7eb',
    headingColor: '#f8fafc',
    subtitleColor: '#cbd5e1',
    mutedColor: '#cbd5e1',
    greetingColor: '#e2e8f0',
    surfaceColor: '#172033',
    surfaceSoftColor: '#1e293b',
    surfaceMutedColor: '#1f2937',
    borderColor: 'rgba(148, 163, 184, 0.35)',
    cardTextColor: '#f8fafc'
  })
];

const elements = {
  message: document.getElementById('visuals-message'),
  presetsGrid: document.getElementById('visuals-presets-grid'),
  animationMode: document.getElementById('visuals-animation-mode'),
  saveButton: document.getElementById('visuals-save-btn')
};

let currentUser = null;
let presets = [];
let selectedPresetId = null;

function setMessage(text = '', type = '') {
  elements.message.textContent = text;
  elements.message.className = 'page-message';

  if (type) {
    elements.message.classList.add(type);
  }
}

function renderPresetCards() {
  if (presets.length === 0) {
    elements.presetsGrid.innerHTML = '<p class="visuals-empty">No presets found yet.</p>';
    return;
  }

  elements.presetsGrid.innerHTML = presets
    .map((preset) => {
      const isSelected = preset.id === selectedPresetId;

      return `
        <button
          type="button"
          class="visual-preset-card ${isSelected ? 'active' : ''}"
          data-preset-id="${preset.id}"
          aria-pressed="${isSelected ? 'true' : 'false'}"
        >
          <span class="visual-preset-name">${preset.name}</span>
          <span class="visual-preset-preview" style="--preview-bg: ${preset.background}; --preview-accent: ${preset.accent};"></span>
          <span class="visual-preset-meta">Built-in</span>
        </button>
      `;
    })
    .join('');
}

async function ensureSeedPresets(userId) {
  const writes = BUILT_IN_PRESETS.map((preset) => {
    const presetRef = doc(db, 'users', userId, 'visuals', preset.id);

    return setDoc(presetRef, {
      kind: 'preset',
      source: preset.source,
      name: preset.name,
      background: preset.background,
      accent: preset.accent,
      accentHover: preset.accentHover,
      accentSoft: preset.accentSoft,
      accentSoftStrong: preset.accentSoftStrong,
      accentBorder: preset.accentBorder,
      accentShadow: preset.accentShadow,
      textColor: preset.textColor || '#333333',
      headingColor: preset.headingColor || '#1a1a2e',
      subtitleColor: preset.subtitleColor || '#666666',
      mutedColor: preset.mutedColor || '#4b5563',
      greetingColor: preset.greetingColor || '#374151',
      surfaceColor: preset.surfaceColor || '#ffffff',
      surfaceSoftColor: preset.surfaceSoftColor || '#f8fafc',
      surfaceMutedColor: preset.surfaceMutedColor || '#f8f9fa',
      borderColor: preset.borderColor || 'rgba(0, 0, 0, 0.12)',
      cardTextColor: preset.cardTextColor || '#1a1a2e',
      updatedAt: serverTimestamp()
    }, { merge: true });
  });

  await Promise.all(writes);

  const settingsRef = doc(db, 'users', userId, 'visuals', 'settings');
  const settingsSnapshot = await getDoc(settingsRef);

  if (!settingsSnapshot.exists()) {
    await setDoc(settingsRef, {
      kind: 'settings',
      activePresetId: BUILT_IN_PRESETS[0].id,
      animationMode: 'normal',
      updatedAt: serverTimestamp()
    });
  }
}

async function loadVisualPreferences(userId) {
  setMessage('Loading visual preferences…');

  await ensureSeedPresets(userId);

  const presetSnapshots = await Promise.all(
    BUILT_IN_PRESETS.map((preset) => getDoc(doc(db, 'users', userId, 'visuals', preset.id)))
  );

  presets = presetSnapshots
    .filter((snapshot) => snapshot.exists())
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));

  const settingsSnapshot = await getDoc(doc(db, 'users', userId, 'visuals', 'settings'));
  const settings = settingsSnapshot.exists() ? settingsSnapshot.data() : {};

  selectedPresetId = settings.activePresetId || presets[0]?.id || null;
  elements.animationMode.value = settings.animationMode || 'normal';

  renderPresetCards();

  const activePreset = presets.find((preset) => preset.id === selectedPresetId);
  if (activePreset) {
    applyVisualTheme(activePreset);
  }

  applyAnimationMode(elements.animationMode.value);
  setMessage('');
}

async function savePreferences() {
  if (!currentUser || !selectedPresetId) {
    setMessage('Please select a preset first.', 'error');
    return;
  }

  try {
    await setDoc(doc(db, 'users', currentUser.uid, 'visuals', 'settings'), {
      kind: 'settings',
      activePresetId: selectedPresetId,
      animationMode: elements.animationMode.value,
      updatedAt: serverTimestamp()
    }, { merge: true });

    const activePreset = presets.find((preset) => preset.id === selectedPresetId);
    if (activePreset) {
      applyVisualTheme(activePreset);
    }
    applyAnimationMode(elements.animationMode.value);

    setMessage('Visual preferences saved.', 'success');
  } catch (error) {
    console.error('Failed to save visual preferences:', error);
    setMessage('Could not save visual preferences right now.', 'error');
  }
}

function onPresetSelected(event) {
  const card = event.target.closest('[data-preset-id]');

  if (!card) {
    return;
  }

  selectedPresetId = card.dataset.presetId;
  renderPresetCards();

  const activePreset = presets.find((preset) => preset.id === selectedPresetId);
  if (activePreset) {
    applyVisualTheme(activePreset);
  }
}

function onAnimationModeChanged() {
  applyAnimationMode(elements.animationMode.value);
}

function handleAuthStateChanged(user) {
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  currentUser = user;
  loadVisualPreferences(user.uid).catch((error) => {
    console.error('Failed to load visual preferences:', error);
    setMessage('Could not load visual preferences.', 'error');
  });
}

function init() {
  if (!elements.presetsGrid || !elements.animationMode || !elements.saveButton || !elements.message) {
    return;
  }

  elements.presetsGrid.addEventListener('click', onPresetSelected);
  elements.animationMode.addEventListener('change', onAnimationModeChanged);
  elements.saveButton.addEventListener('click', savePreferences);
  onAuthStateChanged(auth, handleAuthStateChanged);
}

init();
