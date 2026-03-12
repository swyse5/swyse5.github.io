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
  _notifiedEagles: null, // Use private backing field
  notifiedEaglesLoaded: false,

  // Getter to ensure notifiedEagles is always a Set
  get notifiedEagles() {
    if (!this._notifiedEagles) {
      this._notifiedEagles = new Set();
    }
    return this._notifiedEagles;
  },

  set notifiedEagles(value) {
    this._notifiedEagles = value;
  },

  init(tournamentId = null) {
    // Use tournament ID if available, otherwise use 'general' chat room
    this.currentTournamentId = tournamentId || 'general';
    this.loadLastReadTimestamp();
    this.loadNotifiedEagles();
    this.setupUI();
    this.updateChatHeader();
    
    // Subscribe to messages (will show login prompt if not authenticated)
    this.subscribeToMessages();
    
    // Also listen for auth state changes to re-subscribe when user logs in
    if (!this.authListenerSet) {
      this.authListenerSet = true;
      firebaseAuth.onAuthStateChanged((user) => {
        // Re-subscribe when auth state changes
        this.subscribeToMessages();
      });
    }
  },

  updateChatHeader() {
    const header = document.querySelector('.chat-header h3');
    if (header) {
      header.textContent = this.currentTournamentId === 'general' 
        ? 'League Chat' 
        : 'Tournament Chat';
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
      
      if (emojiReactions.includes(user.uid)) {
        // Remove reaction
        reactions[emoji] = emojiReactions.filter(uid => uid !== user.uid);
        if (reactions[emoji].length === 0) {
          delete reactions[emoji];
        }
      } else {
        // Add reaction
        reactions[emoji] = [...emojiReactions, user.uid];
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
  },

  renderMessage(msg, currentUserId) {
    const isOwn = msg.userId === currentUserId;
    const isSystem = msg.isSystem;
    const timeStr = this.formatTime(msg.timestamp);

    const reactionsHtml = this.renderReactions(msg, currentUserId);

    if (isSystem) {
      return `
        <div class="chat-message system">
          <div class="message-content system-message">
            <span class="system-icon">🦅</span>
            <span>${msg.text}</span>
          </div>
          <div class="message-time">${timeStr}</div>
          ${reactionsHtml}
        </div>
      `;
    }

    return `
      <div class="chat-message ${isOwn ? 'own' : ''}">
        <div class="message-header">
          ${msg.userPhoto ? `<img src="${msg.userPhoto}" alt="" class="message-avatar">` : '<div class="message-avatar-placeholder"></div>'}
          <span class="message-author">${msg.userName}</span>
          <span class="message-time">${timeStr}</span>
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
      const isActive = users.includes(currentUserId);
      const count = users.length;
      // Get user names for tooltip
      const userNames = users.map(uid => this.userNameCache[uid] || 'Someone').join(', ');
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

    // Ensure notified eagles are loaded from localStorage
    if (!this.notifiedEaglesLoaded) {
      this.loadNotifiedEagles();
    }

    const eagleAlerts = [];

    // Build a map of which users have which golfers
    const golferToUsers = {};
    lineups.forEach(lineup => {
      const allGolfers = [...(lineup.golfersRounds12 || []), ...(lineup.golfersRounds34 || [])];
      allGolfers.forEach(golferName => {
        const normalized = Scoring.normalizeName(golferName);
        if (!golferToUsers[normalized]) {
          golferToUsers[normalized] = [];
        }
        if (!golferToUsers[normalized].includes(lineup.userDisplayName)) {
          golferToUsers[normalized].push(lineup.userDisplayName);
        }
      });
    });

    // Check each golfer for new eagles or better
    for (const [normalizedName, golfer] of Object.entries(golferScores)) {
      if (!golfer.rounds) continue;

      golfer.rounds.forEach((round, roundIndex) => {
        if (!round.holes) return;

        round.holes.forEach((hole, holeIndex) => {
          if (!hole || hole.toPar === null) return;

          // Eagle is -2 or better
          if (hole.toPar <= -2) {
            // Create a unique key for this eagle
            const eagleKey = `${tournamentId}_${normalizedName}_R${roundIndex + 1}_H${holeIndex + 1}`;
            
            // Only alert if we haven't notified about this eagle before
            if (!this.notifiedEagles.has(eagleKey)) {
              const users = golferToUsers[normalizedName] || [];
              if (users.length > 0) {
                const scoreLabel = this.getScoreLabel(hole.toPar);
                const userList = users.length === 1 ? users[0] : 
                  users.length === 2 ? `${users[0]} and ${users[1]}` :
                  `${users.slice(0, -1).join(', ')}, and ${users[users.length - 1]}`;
                
                eagleAlerts.push({
                  key: eagleKey,
                  golfer: golfer.displayName,
                  hole: holeIndex + 1,
                  round: roundIndex + 1,
                  score: scoreLabel,
                  users: userList
                });
              }
            }
          }
        });
      });
    }

    // Send eagle alerts and mark them as notified
    for (const alert of eagleAlerts) {
      const message = `${alert.golfer} made ${alert.score} on Hole ${alert.hole} (R${alert.round})! 🦅 Teams: ${alert.users}`;
      await this.sendMessage(message, true);
      
      // Mark this eagle as notified
      this.notifiedEagles.add(alert.key);
    }
    
    // Save notified eagles to localStorage
    if (eagleAlerts.length > 0) {
      this.saveNotifiedEagles();
    }
  },

  loadNotifiedEagles() {
    // Skip if already loaded and has data
    if (this.notifiedEaglesLoaded && this._notifiedEagles && this._notifiedEagles.size > 0) {
      return;
    }
    
    try {
      const stored = localStorage.getItem('notifiedEagles');
      if (stored) {
        const parsed = JSON.parse(stored);
        // Merge with existing to prevent data loss during re-init
        if (!this._notifiedEagles) {
          this._notifiedEagles = new Set(parsed);
        } else {
          parsed.forEach(key => this._notifiedEagles.add(key));
        }
      } else if (!this._notifiedEagles) {
        this._notifiedEagles = new Set();
      }
      this.notifiedEaglesLoaded = true;
    } catch (e) {
      console.log('Could not load notified eagles from localStorage');
      if (!this._notifiedEagles) {
        this._notifiedEagles = new Set();
      }
      this.notifiedEaglesLoaded = true;
    }
  },

  saveNotifiedEagles() {
    try {
      localStorage.setItem('notifiedEagles', JSON.stringify([...this.notifiedEagles]));
    } catch (e) {
      console.log('Could not save notified eagles to localStorage');
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
