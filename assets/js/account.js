import { auth, db } from './firebase-config.js';
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateEmail,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import {
  doc,
  getDoc,
  serverTimestamp,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

const elements = {
  form: document.getElementById('account-form'),
  firstNameInput: document.getElementById('first-name'),
  lastNameInput: document.getElementById('last-name'),
  usernameInput: document.getElementById('username'),
  emailInput: document.getElementById('email'),
  saveButton: document.getElementById('save-btn'),
  resetPasswordButton: document.getElementById('reset-password-btn'),
  pageMessage: document.getElementById('page-message'),
  accountMessage: document.getElementById('account-message'),
  profileSection: document.querySelector('.profile-section'),
  openPhotoModalButton: document.getElementById('open-photo-modal'),
  profilePhotoPreview: document.getElementById('profile-photo-preview'),
  profilePhotoModal: document.getElementById('profile-photo-modal'),
  profilePhotoModalCopy: document.getElementById('profile-photo-modal-copy'),
  profilePhotoInput: document.getElementById('profile-photo-input'),
  profilePhotoCropper: document.getElementById('profile-photo-cropper'),
  profilePhotoCanvas: document.getElementById('profile-photo-canvas'),
  profilePhotoControls: document.getElementById('profile-photo-controls'),
  profilePhotoZoomInput: document.getElementById('profile-photo-zoom'),
  profilePhotoOffsetXInput: document.getElementById('profile-photo-offset-x'),
  profilePhotoOffsetYInput: document.getElementById('profile-photo-offset-y'),
  profilePhotoApplyButton: document.getElementById('profile-photo-apply-btn'),
  profilePhotoResetButton: document.getElementById('profile-photo-reset-btn')
};

let currentUser = null;
let accountMessageTimeoutId = null;
let photoSourceImage = null;
let pendingProfilePhotoDataUrl = '';
let pendingProfilePhotoObjectUrl = '';
let hasUnappliedCrop = false;

const PROFILE_PHOTO_SIZE = 192;
const PROFILE_PHOTO_JPEG_QUALITY = 0.78;

const cropState = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0
};

function getDefaultProfilePhotoUrl() {
  return 'assets/images/default-profile.svg';
}

function getLocalProfilePhotoKey(userId) {
  return `mf_profile_photo_${userId}`;
}

function getLocalProfilePhoto(userId) {
  if (!userId) {
    return '';
  }

  return localStorage.getItem(getLocalProfilePhotoKey(userId)) || '';
}

function saveLocalProfilePhoto(userId, dataUrl) {
  if (!userId) {
    return;
  }

  if (!dataUrl) {
    localStorage.removeItem(getLocalProfilePhotoKey(userId));
    return;
  }

  localStorage.setItem(getLocalProfilePhotoKey(userId), dataUrl);
}

function setProfilePhotoPreview(photoURL) {
  if (!elements.profilePhotoPreview) {
    return;
  }

  elements.profilePhotoPreview.src = photoURL || getDefaultProfilePhotoUrl();
}

function setPhotoModalCopy(text) {
  if (!elements.profilePhotoModalCopy) {
    return;
  }

  elements.profilePhotoModalCopy.textContent = text;
}

function setProfilePhotoModalOpen(isOpen) {
  if (!elements.profilePhotoModal) {
    return;
  }

  if (isOpen) {
    const sectionRect = elements.profileSection?.getBoundingClientRect();
    if (sectionRect) {
      const modalWidth = Math.min(400, Math.max(280, window.innerWidth * 0.95));
      const targetLeft = Math.min(
        Math.max(8, sectionRect.left + 10),
        Math.max(8, window.innerWidth - modalWidth - 12)
      );
      const targetTop = Math.max(8, sectionRect.top + 10);

      elements.profilePhotoModal.style.setProperty('--profile-photo-modal-left', `${targetLeft}px`);
      elements.profilePhotoModal.style.setProperty('--profile-photo-modal-top', `${targetTop}px`);
    }
  }

  elements.profilePhotoModal.hidden = !isOpen;

  if (isOpen) {
    if (photoSourceImage) {
      elements.profilePhotoCropper.hidden = false;
      elements.profilePhotoControls.hidden = false;
      setPhotoModalCopy('Adjust your image in the crop area below.');
      drawCropPreview();
    } else {
      elements.profilePhotoCropper.hidden = true;
      elements.profilePhotoControls.hidden = true;
      setPhotoModalCopy('Upload an image to start cropping.');
    }
  }
}

function resetCropState() {
  cropState.zoom = 1;
  cropState.offsetX = 0;
  cropState.offsetY = 0;

  elements.profilePhotoZoomInput.value = '1';
  elements.profilePhotoOffsetXInput.value = '0';
  elements.profilePhotoOffsetYInput.value = '0';
}

function drawCropPreview() {
  if (!photoSourceImage || !elements.profilePhotoCanvas) {
    return;
  }

  const canvas = elements.profilePhotoCanvas;
  const context = canvas.getContext('2d');

  if (!context) {
    return;
  }

  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;

  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  const baseScale = Math.max(canvasWidth / photoSourceImage.width, canvasHeight / photoSourceImage.height);
  const scaledWidth = photoSourceImage.width * baseScale * cropState.zoom;
  const scaledHeight = photoSourceImage.height * baseScale * cropState.zoom;
  const drawX = (canvasWidth - scaledWidth) / 2 + cropState.offsetX;
  const drawY = (canvasHeight - scaledHeight) / 2 + cropState.offsetY;

  context.drawImage(photoSourceImage, drawX, drawY, scaledWidth, scaledHeight);
}

function loadImageForCropping(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load the selected image.'));
    };

    image.src = objectUrl;
  });
}

async function handleProfilePhotoInputChange() {
  const file = elements.profilePhotoInput.files?.[0];

  if (!file) {
    return;
  }

  if (!file.type.startsWith('image/')) {
    setAccountMessage('Please select a valid image file.', 'error');
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    setAccountMessage('Please choose an image under 5 MB.', 'error');
    return;
  }

  try {
    photoSourceImage = await loadImageForCropping(file);
    resetCropState();
    drawCropPreview();
    elements.profilePhotoCropper.hidden = false;
    elements.profilePhotoControls.hidden = false;
    hasUnappliedCrop = true;
    setPhotoModalCopy('Image loaded. Adjust the crop, then click Use Cropped Photo.');
    setAccountMessage('Adjust the crop and click Apply Cropped Photo.', '');
  } catch (error) {
    console.error('Failed to load profile image:', error);
    setAccountMessage('Could not load that image. Try a different file.', 'error');
  }
}

function updateCropFromControls() {
  cropState.zoom = Number(elements.profilePhotoZoomInput.value);
  cropState.offsetX = Number(elements.profilePhotoOffsetXInput.value);
  cropState.offsetY = Number(elements.profilePhotoOffsetYInput.value);
  hasUnappliedCrop = true;
  drawCropPreview();
}

function exportCompressedProfilePhoto(canvas) {
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = PROFILE_PHOTO_SIZE;
  exportCanvas.height = PROFILE_PHOTO_SIZE;

  const exportContext = exportCanvas.getContext('2d');

  if (!exportContext) {
    throw new Error('Could not prepare image for save.');
  }

  exportContext.fillStyle = '#ffffff';
  exportContext.fillRect(0, 0, PROFILE_PHOTO_SIZE, PROFILE_PHOTO_SIZE);
  exportContext.drawImage(canvas, 0, 0, PROFILE_PHOTO_SIZE, PROFILE_PHOTO_SIZE);

  return exportCanvas.toDataURL('image/jpeg', PROFILE_PHOTO_JPEG_QUALITY);
}

async function handleApplyCroppedPhoto() {
  if (!photoSourceImage || !elements.profilePhotoCanvas) {
    setAccountMessage('Upload an image first.', 'error');
    return;
  }

  try {
    const compressedDataUrl = exportCompressedProfilePhoto(elements.profilePhotoCanvas);
    pendingProfilePhotoDataUrl = compressedDataUrl;
    hasUnappliedCrop = false;

    if (pendingProfilePhotoObjectUrl) {
      URL.revokeObjectURL(pendingProfilePhotoObjectUrl);
    }

    pendingProfilePhotoObjectUrl = compressedDataUrl;
    setProfilePhotoPreview(pendingProfilePhotoObjectUrl);
    setAccountMessage('Cropped photo ready. Click Save Changes to store on this device.', 'success');
    setPhotoModalCopy('Cropped photo selected. Save account changes to store it on this device.');
    setProfilePhotoModalOpen(false);
  } catch (error) {
    console.error('Failed to crop profile image:', error);
    setAccountMessage('Could not crop this image. Please try again.', 'error');
  }
}

function handleResetCrop() {
  if (!photoSourceImage) {
    return;
  }

  resetCropState();
  drawCropPreview();
  hasUnappliedCrop = true;
  setPhotoModalCopy('Crop reset. Adjust and use cropped photo when ready.');
  setAccountMessage('Crop has been reset.', '');
}

function broadcastProfileUpdate(photoURL, localPhotoDataUrl = '', userId = '') {
  const payload = JSON.stringify({
    photoURL,
    localPhotoDataUrl,
    userId,
    at: Date.now()
  });

  localStorage.setItem('mf_profile_updated', payload);

  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'mf-profile-updated', photoURL, localPhotoDataUrl, userId }, window.location.origin);
  }
}

function setProfilePhotoEditingDisabled(disabled) {
  elements.openPhotoModalButton.disabled = disabled;
  elements.profilePhotoInput.disabled = disabled;
  elements.profilePhotoZoomInput.disabled = disabled;
  elements.profilePhotoOffsetXInput.disabled = disabled;
  elements.profilePhotoOffsetYInput.disabled = disabled;
  elements.profilePhotoApplyButton.disabled = disabled;
  elements.profilePhotoResetButton.disabled = disabled;
}

function setAccountMessage(text = '', type = '') {
  const el = elements.accountMessage;
  if (!el) return;
  if (accountMessageTimeoutId) {
    clearTimeout(accountMessageTimeoutId);
    accountMessageTimeoutId = null;
  }
  el.textContent = text;
  el.className = 'inline-save-message' + (type ? ` ${type}` : '');
  if (text && type === 'success') {
    accountMessageTimeoutId = setTimeout(() => {
      el.textContent = '';
      el.className = 'inline-save-message';
      accountMessageTimeoutId = null;
    }, 3000);
  }
}

function setPageMessage(text = '', type = '') {
  elements.pageMessage.textContent = text;
  elements.pageMessage.className = 'page-message';
  if (type) {
    elements.pageMessage.classList.add(type);
  }
}

function setFormDisabled(disabled) {
  elements.saveButton.disabled = disabled;
  elements.firstNameInput.disabled = disabled;
  elements.lastNameInput.disabled = disabled;
  elements.usernameInput.disabled = disabled;
  elements.emailInput.disabled = disabled;
  setProfilePhotoEditingDisabled(disabled);
}

async function loadAccountData(user) {
  setFormDisabled(true);
  setPageMessage('Loading account information…');

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    const data = userDoc.exists() ? userDoc.data() : {};

    elements.firstNameInput.value = data.firstName || (user.displayName || '').split(' ')[0] || '';
    elements.lastNameInput.value = data.lastName || (user.displayName || '').split(' ').slice(1).join(' ') || '';
    elements.usernameInput.value = data.username || '';
    elements.emailInput.value = user.email || '';
    const localPhotoDataUrl = getLocalProfilePhoto(user.uid);
    setProfilePhotoPreview(localPhotoDataUrl || data.photoURL || user.photoURL || getDefaultProfilePhotoUrl());

    setPageMessage('');
  } catch (error) {
    console.error('Failed to load account data:', error);
    setPageMessage('Could not load account information. Please refresh the page.', 'error');
  } finally {
    setFormDisabled(false);
  }
}

async function handleSave(event) {
  event.preventDefault();

  if (!currentUser) {
    setPageMessage('You must be signed in to save changes.', 'error');
    return;
  }

  const firstName = elements.firstNameInput.value.trim();
  const lastName = elements.lastNameInput.value.trim();
  const username = elements.usernameInput.value.trim();
  const newEmail = elements.emailInput.value.trim();

  if (hasUnappliedCrop) {
    setAccountMessage('Apply your photo crop before saving.', 'error');
    return;
  }

  if (!firstName) {
    setPageMessage('First name is required.', 'error');
    return;
  }

  if (!username) {
    setPageMessage('Username is required.', 'error');
    return;
  }

  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    setPageMessage('Username must be 3–30 characters and use only letters, numbers, or underscores.', 'error');
    return;
  }

  if (!newEmail) {
    setPageMessage('Email is required.', 'error');
    return;
  }

  setFormDisabled(true);
  setPageMessage('Saving…');

  try {
    const displayName = `${firstName} ${lastName}`.trim();
    const writes = [];
    const profileUpdatePayload = {};
    let nextPhotoURL = currentUser.photoURL || '';
    let localPhotoDataUrl = getLocalProfilePhoto(currentUser.uid);

    if (displayName && currentUser.displayName !== displayName) {
      profileUpdatePayload.displayName = displayName;
    }

    if (pendingProfilePhotoDataUrl) {
      saveLocalProfilePhoto(currentUser.uid, pendingProfilePhotoDataUrl);
      localPhotoDataUrl = pendingProfilePhotoDataUrl;
    }

    if (Object.keys(profileUpdatePayload).length > 0) {
      writes.push(updateProfile(currentUser, profileUpdatePayload));
    }

    // Update email in Firebase Auth if it changed
    if (currentUser.email !== newEmail) {
      writes.push(updateEmail(currentUser, newEmail));
    }

    await Promise.all(writes);

    // Update Firestore profile document
    await updateDoc(doc(db, 'users', currentUser.uid), {
      firstName,
      lastName,
      username,
      email: newEmail,
      photoURL: nextPhotoURL || '',
      updatedAt: serverTimestamp()
    });

    if (pendingProfilePhotoDataUrl) {
      pendingProfilePhotoDataUrl = '';
      pendingProfilePhotoObjectUrl = '';
      photoSourceImage = null;
      elements.profilePhotoInput.value = '';
      elements.profilePhotoCropper.hidden = true;
      elements.profilePhotoControls.hidden = true;
      broadcastProfileUpdate(nextPhotoURL || '', localPhotoDataUrl || '', currentUser.uid);
    }

    setPageMessage('');
    setAccountMessage('Account updated successfully.', 'success');
  } catch (error) {
    console.error('Failed to save account changes:', error);

    if (error.code === 'auth/requires-recent-login') {
      setAccountMessage('Changing your email requires a recent sign-in. Please log out, sign back in, and try again.', 'error');
    } else if (error.code === 'auth/email-already-in-use') {
      setAccountMessage('That email address is already associated with another account.', 'error');
    } else if (error.code === 'auth/invalid-email') {
      setAccountMessage('Please enter a valid email address.', 'error');
    } else {
      setAccountMessage('Could not save changes. Please try again.', 'error');
    }
  } finally {
    setFormDisabled(false);
  }
}

function setupProfilePhotoListeners() {
  elements.openPhotoModalButton.addEventListener('click', () => {
    setProfilePhotoModalOpen(true);
  });

  elements.profilePhotoModal.addEventListener('click', (event) => {
    if (event.target.closest('[data-photo-close]')) {
      setProfilePhotoModalOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.profilePhotoModal.hidden) {
      setProfilePhotoModalOpen(false);
    }
  });

  window.addEventListener('resize', () => {
    if (!elements.profilePhotoModal.hidden) {
      setProfilePhotoModalOpen(true);
    }
  });

  elements.profilePhotoInput.addEventListener('change', handleProfilePhotoInputChange);
  elements.profilePhotoZoomInput.addEventListener('input', updateCropFromControls);
  elements.profilePhotoOffsetXInput.addEventListener('input', updateCropFromControls);
  elements.profilePhotoOffsetYInput.addEventListener('input', updateCropFromControls);
  elements.profilePhotoApplyButton.addEventListener('click', handleApplyCroppedPhoto);
  elements.profilePhotoResetButton.addEventListener('click', handleResetCrop);
}

async function handleResetPassword() {
  if (!currentUser?.email) {
    setPageMessage('No email address is associated with this account.', 'error');
    return;
  }

  elements.resetPasswordButton.disabled = true;

  try {
    await sendPasswordResetEmail(auth, currentUser.email);
    setPageMessage(`Password reset email sent to ${currentUser.email}.`, 'success');
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    setPageMessage('Could not send password reset email. Please try again.', 'error');
  } finally {
    elements.resetPasswordButton.disabled = false;
  }
}

function handleAuthStateChanged(user) {
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  currentUser = user;
  loadAccountData(user);
}

elements.form.addEventListener('submit', handleSave);
elements.resetPasswordButton.addEventListener('click', handleResetPassword);
setupProfilePhotoListeners();

onAuthStateChanged(auth, handleAuthStateChanged);
