// Authentication Module
const Auth = {
  currentUser: null,
  isAdmin: false,
  adminEmails: [], // Will be loaded from Firestore

  init() {
    firebaseAuth.onAuthStateChanged(async (user) => {
      this.currentUser = user;
      if (user) {
        await this.loadAdminEmails();
        await this.checkAdminStatus(user.email);
        await this.ensureUserDocument(user);
        this.updateUI(true);
        App.onUserSignedIn(user);
      } else {
        this.isAdmin = false;
        this.adminEmails = [];
        this.updateUI(false);
        App.onUserSignedOut();
      }
    });
  },

  async loadAdminEmails() {
    try {
      const doc = await firebaseDb.collection('config').doc('admins').get();
      if (doc.exists) {
        this.adminEmails = doc.data().emails || [];
      }
    } catch (error) {
      console.log('Could not load admin emails:', error);
      this.adminEmails = [];
    }
  },

  async checkAdminStatus(email) {
    this.isAdmin = this.adminEmails.includes(email?.toLowerCase());
  },

  async ensureUserDocument(user) {
    const userRef = firebaseDb.collection('users').doc(user.uid);
    const doc = await userRef.get();
    
    if (!doc.exists) {
      await userRef.set({
        email: user.email,
        displayName: user.displayName || user.email.split('@')[0],
        photoURL: user.photoURL || null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  },

  async signInWithGoogle() {
    try {
      const result = await firebaseAuth.signInWithPopup(googleProvider);
      return result.user;
    } catch (error) {
      console.error('Sign in error:', error);
      this.showError('Failed to sign in. Please try again.');
      throw error;
    }
  },

  async signOut() {
    try {
      await firebaseAuth.signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    }
  },

  updateUI(isSignedIn) {
    const userAvatar = document.getElementById('user-avatar');
    const userName = document.getElementById('user-name');
    const adminLink = document.getElementById('admin-link');

    if (isSignedIn && this.currentUser) {
      // Add signed-in class to body - CSS handles show/hide
      document.body.classList.add('signed-in');
      
      if (userAvatar) {
        userAvatar.src = this.currentUser.photoURL || 'https://via.placeholder.com/32';
      }
      if (userName) {
        userName.textContent = this.currentUser.displayName || this.currentUser.email;
      }
      if (adminLink) {
        adminLink.style.display = this.isAdmin ? 'block' : 'none';
      }
    } else {
      // Remove signed-in class from body
      document.body.classList.remove('signed-in');
      if (adminLink) adminLink.style.display = 'none';
    }
  },

  showError(message) {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = message;
      toast.classList.add('show', 'error');
      setTimeout(() => toast.classList.remove('show', 'error'), 3000);
    }
  },

  requireAuth() {
    if (!this.currentUser) {
      this.showError('Please sign in to continue');
      return false;
    }
    return true;
  }
};
