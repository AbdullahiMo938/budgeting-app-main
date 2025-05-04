import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Firebase configuration object
const firebaseConfig = {
  apiKey: "AIzaSyDdtBQPsrgCDH3VD41J7XKZQ4gxi53V6pA",
  authDomain: "budgetbattles-af631.firebaseapp.com", // Firebase Authentication domain
  projectId: "budgetbattles-af631",
  storageBucket: "budgetbattles-af631.appspot.com",
  messagingSenderId: "24136065520",
  appId: "1:24136065520:web:3547bc859b4c0ebf4f7d35",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Firebase Authentication
export const auth = getAuth(app);

// Initialize Firestore
export const db = getFirestore(app);

// Initialize Storage
export const storage = getStorage(app);

export default app;
