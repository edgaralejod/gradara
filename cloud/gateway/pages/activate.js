// SPDX-License-Identifier: Apache-2.0
// Browser half of the device sign-in: verify who you are, then approve the code
// shown in the Gradara desktop app. Passwords never reach Gradara.
const FIREBASE = 'https://www.gstatic.com/firebasejs/12.19.0';
const $ = (id) => document.getElementById(id);
const show = (id, visible = true) => { $(id).hidden = !visible; };
const status = (text, kind = '') => { $('status').textContent = text; $('status').className = `status ${kind}`; };

const params = new URLSearchParams(location.search);
$('code').value = (params.get('code') || localStorage.getItem('gradara.code') || '').toUpperCase();
localStorage.setItem('gradara.code', $('code').value);
$('code').addEventListener('input', () => localStorage.setItem('gradara.code', $('code').value.toUpperCase()));

async function approve(body) {
  const code = $('code').value.trim().toUpperCase();
  if (code.replace('-', '').length !== 8) { status('Enter the 8-character code from Gradara.', 'err'); return false; }
  status('Approving…');
  const response = await fetch('/v1/device/approve', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userCode: code, ...body }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { status(data.detail || 'Approval failed. Start sign-in again in Gradara.', 'err'); return false; }
  localStorage.removeItem('gradara.code');
  ['step-code', 'step-signin', 'step-approve'].forEach((id) => show(id, false));
  show('step-done');
  status(`Signed in as ${data.email}. Balance: ${data.balance} credits.`, 'ok');
  return true;
}

const config = await (await fetch('/v1/public-config')).json();
show('step-signin');

if (config.authMode === 'dev') {
  show('dev-signin');
  show('step-approve');
  $('signed-in-as').textContent = 'Test account';
  $('switch').hidden = true;
  $('approve').onclick = () => approve({ devEmail: $('dev-email').value });
} else {
  const { initializeApp } = await import(`${FIREBASE}/firebase-app.js`);
  const auth$ = await import(`${FIREBASE}/firebase-auth.js`);
  const app = initializeApp(config.firebase);
  const auth = auth$.getAuth(app);
  show('firebase-signin');

  if (auth$.isSignInWithEmailLink(auth, location.href)) {
    let email = localStorage.getItem('gradara.email');
    if (!email) email = prompt('Confirm your email to finish signing in') || '';
    try {
      await auth$.signInWithEmailLink(auth, email, location.href);
      localStorage.removeItem('gradara.email');
      history.replaceState(null, '', '/activate');
    } catch { status('That sign-in link expired. Request a new one.', 'err'); }
  }

  $('google').onclick = async () => {
    try { await auth$.signInWithPopup(auth, new auth$.GoogleAuthProvider()); }
    catch (error) { status(error.code === 'auth/popup-closed-by-user' ? '' : 'Google sign-in did not finish.', 'err'); }
  };
  $('send-link').onclick = async () => {
    const email = $('email').value.trim();
    if (!email) { status('Enter your email.', 'err'); return; }
    try {
      await auth$.sendSignInLinkToEmail(auth, email, { url: `${location.origin}/activate`, handleCodeInApp: true });
      localStorage.setItem('gradara.email', email);
      status('Check your email for a sign-in link. Open it in this browser.', 'ok');
    } catch { status('Could not send the link. Check the address and try again.', 'err'); }
  };
  $('switch').onclick = () => auth$.signOut(auth);
  $('approve').onclick = async () => {
    const user = auth.currentUser;
    if (!user) return;
    $('approve').disabled = true;
    try { await approve({ idToken: await user.getIdToken(true) }); }
    finally { $('approve').disabled = false; }
  };
  auth$.onAuthStateChanged(auth, (user) => {
    show('firebase-signin', !user);
    show('step-approve', !!user);
    if (user) $('signed-in-as').textContent = `Signed in as ${user.email}`;
  });
}
