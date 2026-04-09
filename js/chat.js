// Chat Module
const Chat = {
  unsubscribe: null,
  currentTournamentId: null,
  messages: [],
  isOpen: false,
  unreadCount: 0,
  lastReadTimestamp: null,
  reactionEmojis: ['👍', '👎', '🔥', '⛳', '😂', '😮', '👏'],
  userNameCache: {},
  authListenerSet: false,
  isAdmin: false,
  adminEmails: [],
  announcedEaglesCache: null,

  // Check if an eagle has been announced (using Firebase)
  async hasNotifiedEagle(tournamentId, golferName, round, hole) {
    const eagleId = `${tournamentId}_${golferName}_R${round}_H${hole}`;
    try {
      const doc = await firebaseDb.collection('config').doc('announcedEagles').get();
      if (doc.exists) {
        const data = doc.data();
        return data[eagleId] === true;
      }
      return false;
    } catch (e) {
      console.error('Error checking announced eagle:', e);
      return false;
    }
  },

  // Add an eagle to Firebase as announced
  async addNotifiedEagle(tournamentId, golferName, round, hole) {
    const eagleId = `${tournamentId}_${golferName}_R${round}_H${hole}`;
    try {
      await firebaseDb.collection('config').doc('announcedEagles').set({
        [eagleId]: true
      }, { merge: true });
      console.log(`Added eagle to Firebase: ${eagleId}`);
      return true;
    } catch (e) {
      console.error('Error saving announced eagle:', e);
      return false;
    }
  },

  async loadAdminStatus() {
    try {
      const user = firebaseAuth.currentUser;
      if (!user) {
        this.isAdmin = false;
        return;
      }

      // Load admin emails if not already loaded
      if (this.adminEmails.length === 0) {
        const adminDoc = await firebaseDb.collection('config').doc('admins').get();
        if (adminDoc.exists) {
          this.adminEmails = adminDoc.data().emails || [];
        }
      }

      this.isAdmin = this.adminEmails.includes(user.email);
    } catch (error) {
      console.log('Could not load admin status for chat:', error);
      this.isAdmin = false;
    }
  },

  init(tournamentId = null) {
    // Use tournament ID if available, otherwise use 'general' chat room
    this.currentTournamentId = tournamentId || 'general';
    this.loadLastReadTimestamp();
    this.setupUI();
    this.updateChatHeader();
    
    // Subscribe to messages (will show login prompt if not authenticated)
    this.subscribeToMessages();
    
    // Also listen for auth state changes to re-subscribe when user logs in
    if (!this.authListenerSet) {
      this.authListenerSet = true;
      firebaseAuth.onAuthStateChanged(async (user) => {
        // Load admin status and re-subscribe when auth state changes
        await this.loadAdminStatus();
        this.subscribeToMessages();
      });
    }
  },

  updateChatHeader() {
    const header = document.querySelector('.chat-header h3');
    if (header) {
      header.textContent = 'League Chat';
    }
  },

  cleanup() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  },

  loadLastReadTimestamp() {
    const stored = localStorage.getItem(`chat_lastRead_${this.currentTournamentId}`);
    this.lastReadTimestamp = stored ? new Date(stored) : new Date();
  },

  saveLastReadTimestamp() {
    this.lastReadTimestamp = new Date();
    localStorage.setItem(`chat_lastRead_${this.currentTournamentId}`, this.lastReadTimestamp.toISOString());
  },

  setupUI() {
    const chatToggle = document.getElementById('chat-toggle');
    const chatPanel = document.getElementById('chat-panel');
    const chatClose = document.getElementById('chat-close');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');

    if (chatToggle) {
      chatToggle.addEventListener('click', () => this.togglePanel());
    }

    if (chatClose) {
      chatClose.addEventListener('click', () => this.closePanel());
    }

    if (chatForm) {
      chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = chatInput.value.trim();
        if (message) {
          this.sendMessage(message);
          chatInput.value = '';
        }
      });
    }
  },

  togglePanel() {
    this.isOpen = !this.isOpen;
    const panel = document.getElementById('chat-panel');
    const toggle = document.getElementById('chat-toggle');
    
    if (panel) {
      panel.classList.toggle('open', this.isOpen);
    }
    if (toggle) {
      toggle.classList.toggle('active', this.isOpen);
    }

    if (this.isOpen) {
      this.markAsRead();
      this.scrollToBottom();
      document.getElementById('chat-input')?.focus();
    }
  },

  openPanel() {
    if (!this.isOpen) {
      this.togglePanel();
    }
  },

  closePanel() {
    if (this.isOpen) {
      this.togglePanel();
    }
  },

  markAsRead() {
    this.unreadCount = 0;
    this.saveLastReadTimestamp();
    this.updateUnreadBadge();
  },

  updateUnreadBadge() {
    const badge = document.getElementById('chat-unread-badge');
    if (badge) {
      if (this.unreadCount > 0) {
        badge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }
  },

  subscribeToMessages() {
    if (!this.currentTournamentId) return;

    this.cleanup();

    // Check if user is authenticated
    const user = firebaseAuth.currentUser;
    if (!user) {
      // Show login required message
      const container = document.getElementById('chat-messages');
      if (container) {
        container.innerHTML = `
          <div class="chat-empty">
            <p>💬</p>
            <p><strong>Sign in to chat</strong></p>
            <p style="font-size: 12px; color: var(--text-secondary); margin-top: 8px;">
              You must be logged in to read and participate in chat.
            </p>
          </div>
        `;
      }
      return;
    }

    this.unsubscribe = firebaseDb.collection('chats')
      .doc(this.currentTournamentId)
      .collection('messages')
      .orderBy('timestamp', 'asc')
      .limitToLast(100)
      .onSnapshot(snapshot => {
        const newMessages = [];
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const data = change.doc.data();
            const message = {
              id: change.doc.id,
              ...data,
              timestamp: data.timestamp?.toDate() || new Date()
            };
            newMessages.push(message);
            
            // Count unread if panel is closed
            if (!this.isOpen && message.timestamp > this.lastReadTimestamp) {
              this.unreadCount++;
            }
          }
        });

        // Update messages array and cache user names
        this.messages = snapshot.docs.map(doc => {
          const data = doc.data();
          // Cache user name for showing reaction tooltips
          if (data.userId && data.userName && data.userId !== 'system') {
            this.userNameCache[data.userId] = data.userName;
          }
          const rx = data.reactions || {};
          for (const list of Object.values(rx)) {
            if (!Array.isArray(list)) continue;
            for (const entry of list) {
              if (entry && typeof entry === 'object' && entry.userId && entry.userName) {
                this.userNameCache[entry.userId] = entry.userName;
              }
            }
          }
          return {
            id: doc.id,
            ...data,
            timestamp: data.timestamp?.toDate() || new Date()
          };
        });

        this.renderMessages();
        this.updateUnreadBadge();

        // Auto-scroll if panel is open
        if (this.isOpen && newMessages.length > 0) {
          this.scrollToBottom();
        }
      }, error => {
        console.error('Chat subscription error:', error);
        const container = document.getElementById('chat-messages');
        if (error.code === 'permission-denied') {
          if (container) {
            container.innerHTML = `
              <div class="chat-empty">
                <p>💬</p>
                <p><strong>Sign in to chat</strong></p>
                <p style="font-size: 12px; color: var(--text-secondary); margin-top: 8px;">
                  You must be logged in to read and participate in chat.
                </p>
              </div>
            `;
          }
        }
      });
  },

  async sendMessage(text, isSystemMessage = false) {
    const user = firebaseAuth.currentUser;
    if (!user && !isSystemMessage) {
      alert('Please sign in to send messages');
      return;
    }

    try {
      await firebaseDb.collection('chats')
        .doc(this.currentTournamentId)
        .collection('messages')
        .add({
          text,
          userId: isSystemMessage ? 'system' : user.uid,
          userName: isSystemMessage ? '🏌️ Eagle Alert' : (user.displayName || 'Anonymous'),
          userPhoto: isSystemMessage ? null : user.photoURL,
          isSystem: isSystemMessage,
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
          reactions: {}
        });
    } catch (error) {
      console.error('Error sending message:', error);
      if (error.code === 'permission-denied') {
        alert('Unable to send message. Please make sure you are signed in.');
      } else {
        alert('Failed to send message. Please try again.');
      }
    }
  },

  reactionEntryUid(entry) {
    return typeof entry === 'string' ? entry : entry?.userId;
  },

  async toggleReaction(messageId, emoji) {
    const user = firebaseAuth.currentUser;
    if (!user) {
      alert('Please sign in to react');
      return;
    }

    const messageRef = firebaseDb.collection('chats')
      .doc(this.currentTournamentId)
      .collection('messages')
      .doc(messageId);

    try {
      const doc = await messageRef.get();
      if (!doc.exists) return;

      const reactions = doc.data().reactions || {};
      const emojiReactions = reactions[emoji] || [];
      const displayName = user.displayName || 'Anonymous';

      const hasMine = emojiReactions.some(e => this.reactionEntryUid(e) === user.uid);

      if (hasMine) {
        reactions[emoji] = emojiReactions.filter(e => this.reactionEntryUid(e) !== user.uid);
        if (reactions[emoji].length === 0) {
          delete reactions[emoji];
        }
      } else {
        reactions[emoji] = [...emojiReactions, { userId: user.uid, userName: displayName }];
        this.userNameCache[user.uid] = displayName;
      }

      await messageRef.update({ reactions });
    } catch (error) {
      console.error('Error toggling reaction:', error);
    }
  },

  renderMessages() {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const currentUserId = firebaseAuth.currentUser?.uid;

    if (this.messages.length === 0) {
      container.innerHTML = `
        <div class="chat-empty">
          <p>No messages yet</p>
          <p style="font-size: 12px; color: var(--text-secondary);">Be the first to say something!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.messages.map(msg => this.renderMessage(msg, currentUserId)).join('');

    // Add reaction button listeners
    container.querySelectorAll('.reaction-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const messageId = btn.dataset.messageId;
        const emoji = btn.dataset.emoji;
        this.toggleReaction(messageId, emoji);
      });
    });

    // Add reaction picker toggle
    container.querySelectorAll('.add-reaction-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const picker = btn.nextElementSibling;
        picker.classList.toggle('show');
      });
    });

    // Add delete button listeners (admin only)
    container.querySelectorAll('.message-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const messageId = btn.dataset.messageId;
        this.deleteMessage(messageId);
      });
    });
  },

  async deleteMessage(messageId) {
    if (!this.isAdmin) {
      alert('Only admins can delete messages');
      return;
    }

    if (!confirm('Are you sure you want to delete this message?')) {
      return;
    }

    try {
      const chatId = this.currentTournamentId || 'general';
      await firebaseDb.collection('chats').doc(chatId).collection('messages').doc(messageId).delete();
      // Message will be removed from UI automatically via the onSnapshot listener
    } catch (error) {
      console.error('Error deleting message:', error);
      alert('Error deleting message: ' + error.message);
    }
  },

  renderMessage(msg, currentUserId) {
    const isOwn = msg.userId === currentUserId;
    const isSystem = msg.isSystem;
    const timeStr = this.formatTime(msg.timestamp);

    const reactionsHtml = this.renderReactions(msg, currentUserId);

    // Admin delete button
    const deleteBtn = this.isAdmin ? `
      <button class="message-delete-btn" data-message-id="${msg.id}" title="Delete message">×</button>
    ` : '';

    if (isSystem) {
      return `
        <div class="chat-message system" data-message-id="${msg.id}">
          <div class="message-content system-message">
            <span class="system-icon">🦅</span>
            <span>${msg.text}</span>
            ${deleteBtn}
          </div>
          <div class="message-time">${timeStr}</div>
          ${reactionsHtml}
        </div>
      `;
    }

    return `
      <div class="chat-message ${isOwn ? 'own' : ''}" data-message-id="${msg.id}">
        <div class="message-header">
          ${msg.userPhoto ? `<img src="${msg.userPhoto}" alt="" class="message-avatar">` : '<div class="message-avatar-placeholder"></div>'}
          <span class="message-author">${msg.userName}</span>
          <span class="message-time">${timeStr}</span>
          ${deleteBtn}
        </div>
        <div class="message-content">${this.escapeHtml(msg.text)}</div>
        ${reactionsHtml}
      </div>
    `;
  },

  renderReactions(msg, currentUserId) {
    const reactions = msg.reactions || {};

    let reactionButtons = '';
    for (const [emoji, users] of Object.entries(reactions)) {
      const isActive = users.some(e => this.reactionEntryUid(e) === currentUserId);
      const count = users.length;
      const userNames = users.map(entry => {
        if (entry && typeof entry === 'object' && entry.userName) {
          return entry.userName;
        }
        const uid = this.reactionEntryUid(entry);
        return this.userNameCache[uid] || 'Someone';
      }).join(', ');
      reactionButtons += `
        <button class="reaction-btn ${isActive ? 'active' : ''}" data-message-id="${msg.id}" data-emoji="${emoji}" title="${userNames}">
          ${emoji} ${count}
        </button>
      `;
    }

    return `
      <div class="message-reactions">
        ${reactionButtons}
        <button class="add-reaction-btn" title="Add reaction">+</button>
        <div class="reaction-picker">
          ${this.reactionEmojis.map(emoji => `
            <button class="reaction-btn" data-message-id="${msg.id}" data-emoji="${emoji}">${emoji}</button>
          `).join('')}
        </div>
      </div>
    `;
  },

  formatTime(date) {
    if (!date) return '';
    const now = new Date();
    const diff = now - date;
    
    // Just now (less than 1 minute)
    if (diff < 60000) return 'Just now';
    
    // Minutes ago (less than 1 hour)
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    
    // Check if same day
    const isToday = date.toDateString() === now.toDateString();
    
    // Check if yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();
    
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    if (isToday) {
      return timeStr;
    }
    
    if (isYesterday) {
      return `Yesterday ${timeStr}`;
    }
    
    // Check if within last 7 days - show day name
    if (diff < 7 * 86400000) {
      const dayName = date.toLocaleDateString([], { weekday: 'short' });
      return `${dayName} ${timeStr}`;
    }
    
    // Older than 7 days - show full date and time
    const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${dateStr} ${timeStr}`;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  scrollToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) {
      setTimeout(() => {
        container.scrollTop = container.scrollHeight;
      }, 50);
    }
  },

  // Eagle Alert System
  async checkForEagles(tournamentId, golferScores, lineups) {
    if (!golferScores || !lineups || !tournamentId) return;

    // Build a map of which users have which golfers PER ROUND
    // This ensures we only alert users who have that golfer in the specific round
    const golferToUsersByRound = {
      1: {}, // Round 1
      2: {}, // Round 2
      3: {}, // Round 3
      4: {}  // Round 4
    };
    
    lineups.forEach(lineup => {
      // Get golfers for each individual round
      const golfersR1 = lineup.golfersRound1 || lineup.golfersRounds12 || [];
      const golfersR2 = lineup.golfersRound2 || lineup.golfersRounds12 || [];
      const golfersR3 = lineup.golfersRound3 || lineup.golfersRounds34 || [];
      const golfersR4 = lineup.golfersRound4 || lineup.golfersRounds34 || [];
      
      const roundGolfers = [golfersR1, golfersR2, golfersR3, golfersR4];
      
      roundGolfers.forEach((golfers, roundIndex) => {
        const roundNum = roundIndex + 1;
        golfers.forEach(golferName => {
          const normalized = Scoring.normalizeName(golferName);
          if (!golferToUsersByRound[roundNum][normalized]) {
            golferToUsersByRound[roundNum][normalized] = [];
          }
          if (!golferToUsersByRound[roundNum][normalized].includes(lineup.userDisplayName)) {
            golferToUsersByRound[roundNum][normalized].push(lineup.userDisplayName);
          }
        });
      });
    });

    // Collect potential eagles first
    const potentialEagles = [];
    
    for (const [normalizedName, golfer] of Object.entries(golferScores)) {
      if (!golfer.rounds) continue;

      golfer.rounds.forEach((round, roundIndex) => {
        if (!round.holes) return;
        const roundNum = roundIndex + 1;

        round.holes.forEach((hole, holeIndex) => {
          if (!hole || hole.toPar === null) return;

          // Eagle is -2 or better
          if (hole.toPar <= -2) {
            // Get users who have this golfer in THIS SPECIFIC ROUND
            const users = golferToUsersByRound[roundNum][normalizedName] || [];
            if (users.length > 0) {
              potentialEagles.push({
                tournamentId,
                normalizedName,
                golferDisplayName: golfer.displayName,
                round: roundNum,
                hole: holeIndex + 1,
                toPar: hole.toPar,
                users
              });
            }
          }
        });
      });
    }

    // Check each potential eagle against Firebase and send alerts for new ones
    for (const eagle of potentialEagles) {
      // Check Firebase if this eagle has already been announced
      const alreadyAnnounced = await this.hasNotifiedEagle(
        eagle.tournamentId, 
        eagle.normalizedName, 
        eagle.round, 
        eagle.hole
      );
      
      if (alreadyAnnounced) {
        continue;
      }

      // Mark as announced in Firebase FIRST to prevent race conditions
      const saved = await this.addNotifiedEagle(
        eagle.tournamentId, 
        eagle.normalizedName, 
        eagle.round, 
        eagle.hole
      );
      
      if (!saved) {
        // If we couldn't save to Firebase, skip to avoid potential duplicates
        console.warn('Could not save eagle to Firebase, skipping announcement');
        continue;
      }

      // Now send the message
      const scoreLabel = this.getScoreLabel(eagle.toPar);
      const userList = eagle.users.length === 1 ? eagle.users[0] : 
        eagle.users.length === 2 ? `${eagle.users[0]} and ${eagle.users[1]}` :
        `${eagle.users.slice(0, -1).join(', ')}, and ${eagle.users[eagle.users.length - 1]}`;
      
      const message = `${eagle.golferDisplayName} made ${scoreLabel} on Hole ${eagle.hole} (R${eagle.round})! 🦅 Teams: ${userList}`;
      await this.sendMessage(message, true);
    }
  },

  getScoreLabel(toPar) {
    switch (toPar) {
      case -2: return 'an EAGLE';
      case -3: return 'an ALBATROSS';
      case -4: return 'a CONDOR';
      default: return toPar <= -2 ? `${Math.abs(toPar)} under par` : 'an amazing score';
    }
  }
};
