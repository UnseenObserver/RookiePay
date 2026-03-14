import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import { doc, getDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

const DEFAULT_THEME = {
  name: 'Default',
  background: 'radial-gradient(circle at top, #f7f5ff 0%, #e5f4ff 45%, #f6fff7 100%)',
  accent: '#4f46e5',
  accentHover: '#4338ca',
  accentSoft: 'rgba(79, 70, 229, 0.12)',
  accentSoftStrong: 'rgba(79, 70, 229, 0.18)',
  accentBorder: 'rgba(79, 70, 229, 0.35)',
  accentShadow: 'rgba(79, 70, 229, 0.22)',
  textColor: '#333333',
  headingColor: '#1a1a2e',
  subtitleColor: '#666666',
  mutedColor: '#4b5563',
  greetingColor: '#374151',
  surfaceColor: '#ffffff',
  surfaceSoftColor: '#f8fafc',
  surfaceMutedColor: '#f8f9fa',
  borderColor: 'rgba(0, 0, 0, 0.12)',
  cardTextColor: '#1a1a2e'
};

const DEFAULT_ANIMATION_MODE = 'normal';
let unsubscribeVisualSettings = null;

function toRgba(hex, alpha) {
  const cleaned = String(hex || '').replace('#', '').trim();

  if (!/^[\da-fA-F]{6}$/.test(cleaned)) {
    return `rgba(79, 70, 229, ${alpha})`;
  }

  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildThemeFromAccent(background, accent, name = 'Custom') {
  const safeAccent = /^[#][\da-fA-F]{6}$/.test(accent) ? accent : DEFAULT_THEME.accent;
  const safeBackground = background || DEFAULT_THEME.background;

  return {
    name,
    background: safeBackground,
    accent: safeAccent,
    accentHover: safeAccent,
    accentSoft: toRgba(safeAccent, 0.12),
    accentSoftStrong: toRgba(safeAccent, 0.18),
    accentBorder: toRgba(safeAccent, 0.35),
    accentShadow: toRgba(safeAccent, 0.22)
  };
}

export function applyVisualTheme(theme) {
  const activeTheme = {
    ...DEFAULT_THEME,
    ...(theme || {})
  };

  const root = document.documentElement;
  root.style.setProperty('--app-bg', activeTheme.background);
  root.style.setProperty('--app-accent', activeTheme.accent);
  root.style.setProperty('--app-accent-hover', activeTheme.accentHover || activeTheme.accent);
  root.style.setProperty('--app-accent-soft', activeTheme.accentSoft || toRgba(activeTheme.accent, 0.12));
  root.style.setProperty('--app-accent-soft-strong', activeTheme.accentSoftStrong || toRgba(activeTheme.accent, 0.18));
  root.style.setProperty('--app-accent-border', activeTheme.accentBorder || toRgba(activeTheme.accent, 0.35));
  root.style.setProperty('--app-accent-shadow', activeTheme.accentShadow || toRgba(activeTheme.accent, 0.22));
  root.style.setProperty('--app-text', activeTheme.textColor || DEFAULT_THEME.textColor);
  root.style.setProperty('--app-heading', activeTheme.headingColor || DEFAULT_THEME.headingColor);
  root.style.setProperty('--app-subtitle', activeTheme.subtitleColor || DEFAULT_THEME.subtitleColor);
  root.style.setProperty('--app-muted', activeTheme.mutedColor || DEFAULT_THEME.mutedColor);
  root.style.setProperty('--app-greeting', activeTheme.greetingColor || DEFAULT_THEME.greetingColor);
  root.style.setProperty('--app-surface', activeTheme.surfaceColor || DEFAULT_THEME.surfaceColor);
  root.style.setProperty('--app-surface-soft', activeTheme.surfaceSoftColor || DEFAULT_THEME.surfaceSoftColor);
  root.style.setProperty('--app-surface-muted', activeTheme.surfaceMutedColor || DEFAULT_THEME.surfaceMutedColor);
  root.style.setProperty('--app-border', activeTheme.borderColor || DEFAULT_THEME.borderColor);
  root.style.setProperty('--app-card-text', activeTheme.cardTextColor || DEFAULT_THEME.cardTextColor);
}

export function applyAnimationMode(mode) {
  const animationMode = ['normal', 'slow', 'fast', 'off'].includes(mode) ? mode : DEFAULT_ANIMATION_MODE;

  document.body.classList.remove('motion-normal', 'motion-slow', 'motion-fast', 'motion-off');
  document.body.classList.add(`motion-${animationMode}`);
}

async function applyVisualSettings(userId, settings) {
  const activePresetId = settings?.activePresetId;
  const animationMode = settings?.animationMode || DEFAULT_ANIMATION_MODE;

  applyAnimationMode(animationMode);

  if (!activePresetId) {
    applyVisualTheme(DEFAULT_THEME);
    return;
  }

  try {
    const presetSnapshot = await getDoc(doc(db, 'users', userId, 'visuals', activePresetId));

    if (!presetSnapshot.exists()) {
      applyVisualTheme(DEFAULT_THEME);
      return;
    }

    const preset = presetSnapshot.data();
    const isDarkPreset = activePresetId === 'preset_darkmode' || /dark\s*mode/i.test(String(preset.name || ''));

    if (preset.kind !== 'preset') {
      applyVisualTheme(DEFAULT_THEME);
      return;
    }

    applyVisualTheme({
      name: preset.name,
      background: preset.background,
      accent: preset.accent,
      accentHover: preset.accentHover,
      accentSoft: preset.accentSoft,
      accentSoftStrong: preset.accentSoftStrong,
      accentBorder: preset.accentBorder,
      accentShadow: preset.accentShadow,
      textColor: preset.textColor || (isDarkPreset ? '#e5e7eb' : undefined),
      headingColor: preset.headingColor || (isDarkPreset ? '#f8fafc' : undefined),
      subtitleColor: preset.subtitleColor || (isDarkPreset ? '#cbd5e1' : undefined),
      mutedColor: preset.mutedColor || (isDarkPreset ? '#cbd5e1' : undefined),
      greetingColor: preset.greetingColor || (isDarkPreset ? '#e2e8f0' : undefined),
      surfaceColor: preset.surfaceColor || (isDarkPreset ? '#172033' : undefined),
      surfaceSoftColor: preset.surfaceSoftColor || (isDarkPreset ? '#1e293b' : undefined),
      surfaceMutedColor: preset.surfaceMutedColor || (isDarkPreset ? '#1f2937' : undefined),
      borderColor: preset.borderColor || (isDarkPreset ? 'rgba(148, 163, 184, 0.35)' : undefined),
      cardTextColor: preset.cardTextColor || (isDarkPreset ? '#f8fafc' : undefined)
    });
  } catch {
    applyVisualTheme(DEFAULT_THEME);
  }
}

onAuthStateChanged(auth, (user) => {
  if (unsubscribeVisualSettings) {
    unsubscribeVisualSettings();
    unsubscribeVisualSettings = null;
  }

  if (!user) {
    applyVisualTheme(DEFAULT_THEME);
    applyAnimationMode(DEFAULT_ANIMATION_MODE);
    return;
  }

  unsubscribeVisualSettings = onSnapshot(
    doc(db, 'users', user.uid, 'visuals', 'settings'),
    (settingsSnapshot) => {
      const settings = settingsSnapshot.exists() ? settingsSnapshot.data() : null;
      applyVisualSettings(user.uid, settings);
    },
    () => {
      applyVisualTheme(DEFAULT_THEME);
      applyAnimationMode(DEFAULT_ANIMATION_MODE);
    }
  );
});
