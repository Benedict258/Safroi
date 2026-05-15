import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, query, orderBy, onSnapshot, getDocFromServer, initializeFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Use standard Firestore initialization as per critical requirement
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    
    // Create/update user profile
    const userDoc = doc(db, 'users', user.uid);
    const docSnap = await getDocFromServer(userDoc);
    
    if (!docSnap.exists()) {
      await setDoc(userDoc, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        createdAt: new Date().toISOString()
      });
    }
    return user;
  } catch (error) {
    console.error("Error signing in with Google:", error);
    throw error;
  }
};

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
