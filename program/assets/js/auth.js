import { auth, db } from './firebase-config.js';
import {
  buildDisplayName,
  findFamilyByInviteCode,
  generateInviteCode,
  getDefaultMemberPermissions,
  normalizeInviteCode
} from './family.js';
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  getAdditionalUserInfo,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithRedirect,
  signOut,
  signInWithPopup,
  signInWithEmailAndPassword,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

const authTabs = document.querySelectorAll('.auth-tab');
const authPanels = document.querySelectorAll('.auth-panel');
const authForms = document.querySelectorAll('.auth-form');
const forgotPasswordLink = document.getElementById('forgot-password-link');
const loginEmailInput = document.getElementById('login-email');
const authProviderButtons = document.querySelectorAll('[data-auth-provider="google"]');
const gisLoginButtonContainer = document.getElementById('google-gis-login-button');
const popupFallbackButton = document.getElementById('google-popup-fallback-btn');
const googleClientIdMeta = document.querySelector('meta[name="google-signin-client_id"]');
const signupRoleSelect = document.getElementById('signup-role');
const signupRoleCopy = document.getElementById('signup-role-copy');
const familyNameGroup = document.getElementById('family-name-group');
const familyNameInput = document.getElementById('family-name');
const inviteCodeGroup = document.getElementById('invite-code-group');
const inviteCodeInput = document.getElementById('family-invite-code');

let isAuthFlowInProgress = false;
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
const GOOGLE_REDIRECT_CONTEXT_KEY = 'mf_google_redirect_context';

function getGisClientId() {
  const metaClientId = googleClientIdMeta?.getAttribute('content')?.trim();

  if (metaClientId) {
    return metaClientId;
  }

  const windowClientId = window?.ROOKIEPAY_GOOGLE_CLIENT_ID;
  return typeof windowClientId === 'string' ? windowClientId.trim() : '';
}

const ROLE_COPY = {
  solo: 'Individual accounts keep the current personal budgeting flow.',
  parent: 'Parent portal accounts can monitor multiple linked children from one place.',
  child: 'Child accounts join a parent account using that parent invite code.'
};

function switchTab(isLogin) {
  authTabs.forEach((tab) => {
    const selected = tab.id === (isLogin ? 'login-tab' : 'signup-tab');
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
  });

  authPanels.forEach((panel) => {
    const showPanel = isLogin ? panel.id === 'login-panel' : panel.id === 'signup-panel';
    panel.classList.toggle('active', showPanel);
    panel.hidden = !showPanel;
  });
}

function getEmailUsernameFallback(email = '') {
  return String(email).split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30) || 'rookiepay_user';
}

function parseNameParts(displayName = '') {
  const parts = String(displayName).trim().split(/\s+/).filter(Boolean);

  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ')
  };
}

function saveGoogleRedirectContext(mode, signupContext = null) {
  try {
    // Redirect auth loses in-memory state; persist enough context to complete provisioning after return.
    const payload = {
      mode,
      signupContext,
      createdAt: Date.now()
    };

    sessionStorage.setItem(GOOGLE_REDIRECT_CONTEXT_KEY, JSON.stringify(payload));
  } catch {
    // no-op
  }
}

function consumeGoogleRedirectContext() {
  try {
    const raw = sessionStorage.getItem(GOOGLE_REDIRECT_CONTEXT_KEY);
    sessionStorage.removeItem(GOOGLE_REDIRECT_CONTEXT_KEY);

    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function resolveSignupContext(form, options = {}) {
  const role = signupRoleSelect?.value || 'solo';
  const firstName = document.getElementById('first-name').value.trim();
  const lastName = document.getElementById('last-name').value.trim();
  const username = document.getElementById('signup-username').value.trim();
  const email = options.emailOverride || document.getElementById('signup-email').value.trim();
  const allowEmptyEmail = options.allowEmptyEmail === true;
  const allowEmptyUsername = options.allowEmptyUsername === true;
  const familyName = familyNameInput?.value.trim() || '';
  const inviteCode = normalizeInviteCode(inviteCodeInput?.value || '');

  let linkedFamily = null;

  if (!username && !allowEmptyUsername) {
    setAuthMessage(form, 'Please enter a username.', 'error');
    return null;
  }

  if (username && !/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    setAuthMessage(form, 'Username must be 3-30 characters and use only letters, numbers, or underscores.', 'error');
    return null;
  }

  if (!email && !allowEmptyEmail) {
    setAuthMessage(form, 'Please enter a valid email address.', 'error');
    return null;
  }

  if (role === 'parent' && !familyName) {
    setAuthMessage(form, 'Parents must provide a family name.', 'error');
    return null;
  }

  if (role === 'child') {
    if (!inviteCode) {
      setAuthMessage(form, 'Children must enter a valid family invite code.', 'error');
      return null;
    }

    linkedFamily = await findFamilyByInviteCode(inviteCode);

    if (!linkedFamily) {
      setAuthMessage(form, 'That family invite code is not valid or has expired.', 'error');
      return null;
    }
  }

  return {
    role,
    firstName,
    lastName,
    username,
    email,
    familyName,
    linkedFamily
  };
}

function addDefaultTransactions(batch, uid) {
  const defaultTransactions = [
    { description: 'Starting Balance', amount: 0, category: 'General', type: 'income', createdAt: serverTimestamp() },
    { description: 'Example Expense', amount: 0, category: 'General', type: 'expense', createdAt: serverTimestamp() }
  ];

  defaultTransactions.forEach((transaction) => {
    batch.set(doc(collection(db, 'users', uid, 'transactions')), transaction);
  });
}

async function provisionUserProfile({
  uid,
  firstName,
  lastName,
  email,
  username,
  role,
  familyName,
  linkedFamily,
  photoURL = ''
}) {
  // Keep user + family membership + starter data in one batch so onboarding doesn't partially apply.
  const displayName = buildDisplayName(firstName, lastName);
  let primaryFamilyId = null;
  let inviteCodeValue = '';
  const batch = writeBatch(db);

  const userDocPayload = {
    uid,
    firstName,
    lastName,
    email,
    username,
    role,
    primaryFamilyId: null,
    familyName: familyName || '',
    inviteCode: '',
    inviteStatus: role === 'parent' ? 'active' : '',
    photoURL,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  if (role === 'parent') {
    inviteCodeValue = await createUniqueInviteCode();
    primaryFamilyId = uid;

    batch.set(doc(db, 'users', uid, 'familyMembers', uid), {
      uid,
      role: 'parent',
      status: 'active',
      displayName: displayName || username,
      email,
      permissions: getDefaultMemberPermissions('parent'),
      joinedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  if (role === 'child' && linkedFamily) {
    primaryFamilyId = linkedFamily.id;

    batch.set(doc(db, 'users', linkedFamily.id, 'familyMembers', uid), {
      uid,
      role: 'child',
      status: 'active',
      joinedWithInviteCode: normalizeInviteCode(linkedFamily.inviteCode || ''),
      displayName: displayName || username,
      email,
      permissions: getDefaultMemberPermissions('child'),
      joinedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  userDocPayload.primaryFamilyId = primaryFamilyId;
  userDocPayload.inviteCode = inviteCodeValue;
  batch.set(doc(db, 'users', uid), userDocPayload);
  addDefaultTransactions(batch, uid);
  await batch.commit();

  return { displayName, primaryFamilyId };
}

function setAuthMessage(form, text = '', type = '') {
  const message = form.querySelector('.auth-message');
  message.className = 'auth-message';

  message.innerHTML = '';

  if (!text) {
    return;
  }

  const messageText = document.createElement('p');
  messageText.className = 'auth-message-text';
  messageText.textContent = text;
  message.append(messageText);

  if (type) {
    message.classList.add(type);
  }
}

function updateSignupRoleFields() {
  if (!signupRoleSelect) {
    return;
  }

  const role = signupRoleSelect.value || 'solo';

  if (signupRoleCopy) {
    signupRoleCopy.textContent = ROLE_COPY[role] || ROLE_COPY.solo;
  }

  const showFamilyName = role === 'parent';
  const showInviteCode = role === 'child';

  familyNameGroup.hidden = !showFamilyName;
  familyNameInput.required = showFamilyName;
  if (!showFamilyName) {
    familyNameInput.value = '';
  }

  inviteCodeGroup.hidden = !showInviteCode;
  inviteCodeInput.required = showInviteCode;
  if (!showInviteCode) {
    inviteCodeInput.value = '';
  }
}

async function createUniqueInviteCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const inviteCode = generateInviteCode(6);
    const existingFamily = await findFamilyByInviteCode(inviteCode);

    if (!existingFamily) {
      return inviteCode;
    }
  }

  throw new Error('Could not generate a unique family invite code. Please try again.');
}

function setPasswordRequirementMessage(form, title, requirements = []) {
  const message = form.querySelector('.auth-message');
  message.className = 'auth-message error password-requirements';
  message.innerHTML = '';

  const messageTitle = document.createElement('p');
  messageTitle.className = 'auth-message-text';
  messageTitle.textContent = title;
  message.append(messageTitle);

  if (!requirements.length) {
    return;
  }

  const requirementList = document.createElement('ul');
  requirementList.className = 'password-requirements-list';

  requirements.forEach((requirement) => {
    const item = document.createElement('li');
    item.textContent = requirement;
    requirementList.append(item);
  });

  message.append(requirementList);
}

function getPasswordRequirements(error) {
  const message = (error?.message || '').toLowerCase();
  const requirements = [];

  if (message.includes('6 characters') || message.includes('at least 6')) {
    requirements.push('Use at least 6 characters.');
  }

  if (message.includes('uppercase')) {
    requirements.push('Include at least 1 uppercase letter.');
  }

  if (message.includes('lowercase')) {
    requirements.push('Include at least 1 lowercase letter.');
  }

  if (message.includes('number') || message.includes('digit')) {
    requirements.push('Include at least 1 number.');
  }

  if (message.includes('special') || message.includes('symbol')) {
    requirements.push('Include at least 1 special character.');
  }

  if (message.includes('different')) {
    requirements.push('Choose a password different from recent passwords.');
  }

  return requirements.length ? requirements : ['Use at least 6 characters.'];
}

function isPasswordRequirementError(error) {
  const code = error?.code;
  const message = (error?.message || '').toLowerCase();

  return code === 'auth/weak-password'
    || code === 'auth/password-does-not-meet-requirements'
    || message.includes('password should')
    || message.includes('password must')
    || message.includes('password requirement');
}

function getFriendlyAuthMessage(error) {
  const code = error?.code;

  if (code === 'auth/configuration-not-found') {
    return 'Firebase Auth is not fully configured. In Firebase Console, enable Email/Password sign-in.';
  }

  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Incorrect email or password.';
  }

  if (code === 'auth/email-already-in-use') {
    return 'That email is already registered. Try logging in instead.';
  }

  if (code === 'auth/weak-password') {
    return 'Password is too weak. Use at least 6 characters.';
  }

  if (code === 'auth/invalid-email') {
    return 'Please enter a valid email address.';
  }

  if (code === 'auth/too-many-requests') {
    return 'Too many attempts. Please wait a moment and try again.';
  }

  if (code === 'permission-denied') {
    return 'Firestore write blocked by rules. Allow users to write only to their own records.';
  }

  if (code === 'unavailable') {
    return 'Firestore is temporarily unavailable. Please retry in a moment.';
  }

  if (code === 'auth/popup-closed-by-user') {
    return 'Google sign-in was canceled before completion.';
  }

  if (code === 'auth/popup-blocked') {
    return 'Your browser blocked the Google sign-in popup. Allow popups and try again.';
  }

  if (code === 'auth/account-exists-with-different-credential') {
    return 'That email is already linked to a different sign-in method.';
  }

  return error?.message || 'Authentication failed. Please try again.';
}

async function createAccount(form) {
  const signupContext = await resolveSignupContext(form);
  const password = document.getElementById('signup-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;

  if (!signupContext) {
    return;
  }

  if (password !== confirmPassword) {
    setAuthMessage(form, 'Passwords do not match.', 'error');
    return;
  }

  isAuthFlowInProgress = true;

  const credential = await createUserWithEmailAndPassword(auth, signupContext.email, password);
  const uid = credential.user.uid;
  const displayName = buildDisplayName(signupContext.firstName, signupContext.lastName);

  if (displayName) {
    await updateProfile(credential.user, { displayName });
  }

  await provisionUserProfile({
    uid,
    ...signupContext,
    photoURL: credential.user.photoURL || ''
  });

  setAuthMessage(form, 'Account created. Redirecting...', 'success');
  window.location.href = 'dashboard.html';
}

async function signIn(form) {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  isAuthFlowInProgress = true;
  await signInWithEmailAndPassword(auth, email, password);
  setAuthMessage(form, 'Login successful. Redirecting...', 'success');
  window.location.href = 'dashboard.html';
}

async function handleGoogleAuth(mode) {
  const form = document.querySelector(`.auth-form[data-mode="${mode}"]`);

  if (!form) {
    return;
  }

  setAuthMessage(form);

  let signupContext = null;
  if (mode === 'signup') {
    signupContext = await resolveSignupContext(form, {
      emailOverride: document.getElementById('signup-email').value.trim(),
      allowEmptyEmail: true,
      allowEmptyUsername: true
    });

    if (!signupContext) {
      return;
    }
  }

  try {
    isAuthFlowInProgress = true;
    const credential = await signInWithPopup(auth, googleProvider);
    await finalizeGoogleAuthResult({
      credential,
      mode,
      signupContext,
      form
    });
  } catch (error) {
    if (error?.code === 'auth/popup-blocked') {
      saveGoogleRedirectContext(mode, signupContext);
      setAuthMessage(form, 'Popup blocked. Switching to secure redirect sign-in…', 'success');
      await signInWithRedirect(auth, googleProvider);
      return;
    }

    console.error('Google authentication failed:', error);
    isAuthFlowInProgress = false;
    setAuthMessage(form, getFriendlyAuthMessage(error), 'error');
  }
}

async function finalizeGoogleAuthResult({ credential, mode, signupContext, form }) {
  const additionalInfo = getAdditionalUserInfo(credential);
  const user = credential.user;
  const userDocRef = doc(db, 'users', user.uid);
  const userDoc = await getDoc(userDocRef);

  if (!userDoc.exists()) {
    const providerNameParts = parseNameParts(user.displayName || '');
    const googleContext = signupContext || {
      role: 'solo',
      firstName: providerNameParts.firstName,
      lastName: providerNameParts.lastName,
      username: getEmailUsernameFallback(user.email),
      email: user.email || '',
      familyName: '',
      linkedFamily: null
    };

    const finalContext = {
      ...googleContext,
      firstName: googleContext.firstName || providerNameParts.firstName,
      lastName: googleContext.lastName || providerNameParts.lastName,
      username: googleContext.username || getEmailUsernameFallback(user.email),
      email: user.email || googleContext.email || ''
    };

    const nextDisplayName = buildDisplayName(finalContext.firstName, finalContext.lastName);
    if (nextDisplayName && user.displayName !== nextDisplayName) {
      await updateProfile(user, { displayName: nextDisplayName });
    }

    if (finalContext.role === 'child' && !finalContext.linkedFamily) {
      await signOut(auth);
      isAuthFlowInProgress = false;
      setAuthMessage(form, 'Child Google signup requires a valid family invite code. Please enter one and try again.', 'error');
      return;
    }

    await provisionUserProfile({
      uid: user.uid,
      ...finalContext,
      photoURL: user.photoURL || ''
    });
  }

  const successMessage = mode === 'signup'
    ? (additionalInfo?.isNewUser ? 'Google account created. Redirecting...' : 'Google account linked. Redirecting...')
    : 'Google login successful. Redirecting...';

  setAuthMessage(form, successMessage, 'success');
  window.location.href = 'dashboard.html';
}

async function handleGisCredentialResponse(response) {
  const loginForm = document.querySelector('.auth-form[data-mode="login"]');

  if (!response?.credential || !loginForm) {
    return;
  }

  setAuthMessage(loginForm);

  try {
    isAuthFlowInProgress = true;
    const firebaseCredential = GoogleAuthProvider.credential(response.credential);
    const credential = await signInWithCredential(auth, firebaseCredential);

    await finalizeGoogleAuthResult({
      credential,
      mode: 'login',
      signupContext: null,
      form: loginForm
    });
  } catch (error) {
    console.error('GIS credential sign-in failed:', error);
    isAuthFlowInProgress = false;
    setAuthMessage(loginForm, getFriendlyAuthMessage(error), 'error');
  }
}

function initializeGisLoginButton() {
  const loginForm = document.querySelector('.auth-form[data-mode="login"]');
  const gisClientId = getGisClientId();

  if (!gisLoginButtonContainer || !loginForm) {
    return;
  }

  const showPopupFallbackOnly = () => {
    if (popupFallbackButton) {
      popupFallbackButton.hidden = false;
    }

    if (gisLoginButtonContainer) {
      gisLoginButtonContainer.innerHTML = '';
    }
  };

  if (!gisClientId || !window.google?.accounts?.id) {
    showPopupFallbackOnly();

    return;
  }

  try {
    window.google.accounts.id.initialize({
      client_id: gisClientId,
      callback: handleGisCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true
    });

    window.google.accounts.id.renderButton(gisLoginButtonContainer, {
      type: 'standard',
      shape: 'rectangular',
      theme: 'outline',
      text: 'signin_with',
      size: 'large',
      logo_alignment: 'left',
      width: 320
    });
  } catch (error) {
    console.error('Failed to initialize GIS button:', error);
    showPopupFallbackOnly();
  }
}

async function handleGoogleRedirectResult() {
  const redirectContext = consumeGoogleRedirectContext();
  const mode = redirectContext?.mode || 'login';
  const form = document.querySelector(`.auth-form[data-mode="${mode}"]`) || document.querySelector('.auth-form[data-mode="login"]');

  try {
    const credential = await getRedirectResult(auth);

    if (!credential) {
      return;
    }

    isAuthFlowInProgress = true;
    await finalizeGoogleAuthResult({
      credential,
      mode,
      signupContext: redirectContext?.signupContext || null,
      form
    });
  } catch (error) {
    console.error('Google redirect authentication failed:', error);
    isAuthFlowInProgress = false;

    if (form) {
      setAuthMessage(form, getFriendlyAuthMessage(error), 'error');
    }
  }
}

async function handleFormSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  setAuthMessage(form);

  try {
    if (form.dataset.mode === 'login') {
      await signIn(form);
      return;
    }

    await createAccount(form);
  } catch (error) {
    console.error('Authentication failed:', error);
    isAuthFlowInProgress = false;

    if (form.dataset.mode === 'signup' && isPasswordRequirementError(error)) {
      setPasswordRequirementMessage(
        form,
        'Please update your password to meet Firebase requirements:',
        getPasswordRequirements(error)
      );
      return;
    }

    setAuthMessage(form, getFriendlyAuthMessage(error), 'error');
  }
}

async function handleForgotPassword(event) {
  event.preventDefault();

  const loginForm = document.querySelector('.auth-form[data-mode="login"]');
  const email = loginEmailInput.value.trim();

  if (!email) {
    setAuthMessage(loginForm, 'Enter your login email first, then click forgot password.', 'error');
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    setAuthMessage(loginForm, 'Password reset email sent.', 'success');
  } catch (error) {
    setAuthMessage(loginForm, getFriendlyAuthMessage(error), 'error');
  }
}

authTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    switchTab(tab.id === 'login-tab');
  });
});

authForms.forEach((form) => {
  form.addEventListener('submit', handleFormSubmit);
});

authProviderButtons.forEach((button) => {
  button.addEventListener('click', () => {
    handleGoogleAuth(button.dataset.mode || 'login');
  });
});

forgotPasswordLink.addEventListener('click', handleForgotPassword);

if (signupRoleSelect) {
  signupRoleSelect.addEventListener('change', updateSignupRoleFields);
  updateSignupRoleFields();
}

handleGoogleRedirectResult();
initializeGisLoginButton();

onAuthStateChanged(auth, (user) => {
  if (user && !isAuthFlowInProgress) {
    window.location.replace('dashboard.html');
  }
});
