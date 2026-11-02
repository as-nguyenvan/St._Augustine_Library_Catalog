import { initializeApp, FirebaseApp, getApps } from 'firebase/app';
import {
  getAuth,
  Auth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';

export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
];

const LIBRARIAN_SESSION_HINT_KEY = 'st_augustine_librarian_hint';

// Cache the access token strictly in memory (never in localStorage/sessionStorage).
let cachedAccessToken: string | null = null;
let firebaseAppInstance: FirebaseApp | null = null;
let firebaseAuthInstance: Auth | null = null;

/**
 * Lazily fetches minimal Firebase Auth configuration from the backend
 * ONLY when the librarian initiates Sign-In (never bundled in client code).
 */
async function ensureFirebaseAuthInitialized(): Promise<Auth> {
  if (firebaseAuthInstance) {
    return firebaseAuthInstance;
  }

  if (getApps().length > 0) {
    firebaseAppInstance = getApps()[0];
    firebaseAuthInstance = getAuth(firebaseAppInstance);
    return firebaseAuthInstance;
  }

  const res = await fetch('/api/auth/session-config', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'LibrarianAuth',
    },
  });

  if (!res.ok) {
    throw new Error('Unable to load librarian authentication configuration.');
  }

  const config = await res.json();
  firebaseAppInstance = initializeApp(config);
  firebaseAuthInstance = getAuth(firebaseAppInstance);
  return firebaseAuthInstance;
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  let unsubscribeFn: (() => void) | null = null;
  let isCancelled = false;

  // Only initialize Firebase Auth on page load if the librarian previously signed in on this browser tab
  let shouldRestoreLibrarian = false;
  try {
    shouldRestoreLibrarian =
      sessionStorage.getItem(LIBRARIAN_SESSION_HINT_KEY) === '1';
  } catch {
    shouldRestoreLibrarian = false;
  }

  if (!shouldRestoreLibrarian) {
    if (onAuthFailure) onAuthFailure();
    return () => {};
  }

  ensureFirebaseAuthInitialized()
    .then((auth) => {
      if (isCancelled) return;
      unsubscribeFn = onAuthStateChanged(auth, (user: User | null) => {
        if (user) {
          if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
        } else {
          cachedAccessToken = null;
          try {
            sessionStorage.removeItem(LIBRARIAN_SESSION_HINT_KEY);
          } catch {
            // Ignore storage errors
          }
          if (onAuthFailure) onAuthFailure();
        }
      });
    })
    .catch(() => {
      if (onAuthFailure) onAuthFailure();
    });

  return () => {
    isCancelled = true;
    if (unsubscribeFn) unsubscribeFn();
  };
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    const auth = await ensureFirebaseAuthInitialized();
    const provider = new GoogleAuthProvider();
    for (const scope of SCOPES) {
      provider.addScope(scope);
    }

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google Sheets access token from sign-in.');
    }

    cachedAccessToken = credential.accessToken;
    try {
      sessionStorage.setItem(LIBRARIAN_SESSION_HINT_KEY, '1');
    } catch {
      // Ignore storage errors
    }
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  try {
    sessionStorage.removeItem(LIBRARIAN_SESSION_HINT_KEY);
  } catch {
    // Ignore storage errors
  }
  if (firebaseAuthInstance) {
    await firebaseAuthInstance.signOut();
  }
  cachedAccessToken = null;
};
