import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile
} from 'firebase/auth';
import { getFirestore, doc, setDoc, query, orderBy, onSnapshot, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Use standard Firestore initialization as per critical requirement
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    await ensureUserDoc(user);
    return user;
  } catch (error) {
    console.error("Error signing in with Google:", error);
    throw error;
  }
};

import { User } from 'firebase/auth';

const ensureUserDoc = async (user: User) => {
  const userDoc = doc(db, 'users', user.uid);
  const docSnap = await getDocFromServer(userDoc).catch(() => null);
  
  if (!docSnap || !docSnap.exists()) {
    await setDoc(userDoc, {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || user.email?.split('@')[0] || 'User',
      photoURL: user.photoURL,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
};

export const loginWithEmail = async (email: string, pass: string) => {
  const result = await signInWithEmailAndPassword(auth, email, pass);
  return result.user;
};

export const registerWithEmail = async (email: string, pass: string, name: string) => {
  const result = await createUserWithEmailAndPassword(auth, email, pass);
  await updateProfile(result.user, { displayName: name });
  await ensureUserDoc(result.user);
  return result.user;
};

export const resetPassword = (email: string) => sendPasswordResetEmail(auth, email);

export const logout = () => signOut(auth);

// Test Connection as per instructions
async function testConnection() {
  try {
    const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
    const testDoc = doc(db, 'test', 'connection');
    await getDocFromServer(testDoc);
    console.log(`[Firestore] Connection success to database: ${dbId}`);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('the client is offline')) {
        console.warn("[Firestore] OFFLINE: The application is running in an environment without direct Firestore access. This is expected in some preview modes.");
      } else if (error.message.includes('insufficient permissions')) {
        console.warn("[Firestore] Connection test failed with permission error. This may happen if the database is still initializing or rules are propagating. Standard operations might still work if user is authenticated.");
      } else {
        console.warn(`[Firestore] Initial connectivity test failed: ${error.message}`);
      }
    }
  }
}
testConnection();
