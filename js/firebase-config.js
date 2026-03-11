// Firebase Configuration
// IMPORTANT: Replace these values with your own Firebase project config
// Get these from: https://console.firebase.google.com/ -> Project Settings -> General -> Your apps

const firebaseConfig = {
  apiKey: "AIzaSyD9dfIiBVCLPAQLqIKnvBonMA9Y1aKnKtw",
  authDomain: "majors-best-ball.firebaseapp.com",
  projectId: "majors-best-ball",
  storageBucket: "majors-best-ball.firebasestorage.app",
  messagingSenderId: "308011654361",
  appId: "1:308011654361:web:8a757a0530bb632d2c32c8",
  measurementId: "G-JVZY01PD9Y"
};
// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize services
const auth = firebase.auth();
const db = firebase.firestore();

// Configure Google Auth Provider
const googleProvider = new firebase.auth.GoogleAuthProvider();

// Export for use in other modules
window.firebaseAuth = auth;
window.firebaseDb = db;
window.googleProvider = googleProvider;
