// Main Application Module
const App = {
  currentView: 'home',
  activeTournament: null,
  selectedLeaderboardTournament: null,
  allTournaments: [],
  currentSeason: null,

  async init() {
    // Initialize theme
    this.initTheme();
    
    // Initialize authentication
    Auth.init();
    
    // Get current season from URL or default to current year
    this.currentSeason = this.getSeasonFromUrl() || new Date().getFullYear();
    
    // Set up navigation
    this.setupNavigation();
    
    // Load active tournament
    await this.loadActiveTournament();
    
    // Load all tournaments for the season
    await this.loadAllTournaments();
    
    // Show initial view based on URL hash
    this.previousHash = window.location.hash;
    this.handleHashChange();
    window.addEventListener('hashchange', () => this.handleHashChange());
  },

  initTheme() {
    // Load saved theme preference
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    // Set up toggle button
    const toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggleTheme());
    }
  },

  toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  },

  getSeasonFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const season = params.get('season');
    return season ? parseInt(season) : null;
  },

  setSeasonInUrl(season) {
    const url = new URL(window.location);
    if (season === new Date().getFullYear()) {
      url.searchParams.delete('season');
    } else {
      url.searchParams.set('season', season);
    }
    window.history.replaceState({}, '', url);
  },

  async loadAllTournaments() {
    try {
      // Get all tournaments, we'll filter by season client-side
      const snapshot = await firebaseDb.collection('tournaments')
        .orderBy('startDate', 'desc')
        .get();

      this.allTournaments = snapshot.docs.map(doc => {
        const data = doc.data();
        // Derive season from startDate
        const startDate = data.startDate?.toDate ? data.startDate.toDate() : new Date(data.startDate);
        const season = startDate.getFullYear();
        return { 
          id: doc.id, 
          ...data,
          season,
          startDateObj: startDate
        };
      });
    } catch (error) {
      console.error('Error loading tournaments:', error);
      this.allTournaments = [];
    }
  },

  getTournamentsForSeason(season) {
    return this.allTournaments.filter(t => t.season === season);
  },

  getAvailableSeasons() {
    const seasons = [...new Set(this.allTournaments.map(t => t.season))];
    return seasons.sort((a, b) => b - a); // Most recent first
  },

  async loadActiveTournament() {
    try {
      const snapshot = await firebaseDb.collection('tournaments')
        .where('status', 'in', ['lineup_open', 'in_progress'])
        .orderBy('startDate', 'desc')
        .limit(1)
        .get();

      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        this.activeTournament = { id: doc.id, ...doc.data() };
        await Lineup.loadTournament(this.activeTournament.id);
        
        // Auto-start scoring if tournament has started (based on date) or is in_progress
        const tournamentStartDate = this.activeTournament.startDate?.toDate 
          ? this.activeTournament.startDate.toDate() 
          : new Date(this.activeTournament.startDate);
        const tournamentEndDate = this.activeTournament.endDate?.toDate
          ? this.activeTournament.endDate.toDate()
          : new Date(this.activeTournament.endDate);
        const now = new Date();
        
        // Add a day buffer to end date (tournaments often end late)
        const endDateWithBuffer = new Date(tournamentEndDate);
        endDateWithBuffer.setDate(endDateWithBuffer.getDate() + 1);
        
        const tournamentHasStarted = now >= tournamentStartDate;
        const tournamentHasEnded = now > endDateWithBuffer;
        
        // Start auto-update if: tournament dates indicate it's active, OR status is in_progress
        // AND scoring is enabled for this tournament
        if ((tournamentHasStarted && !tournamentHasEnded) || this.activeTournament.status === 'in_progress') {
          const scoringEnabled = await Scoring.checkScoringEnabled(this.activeTournament.id);
          if (scoringEnabled) {
            Scoring.startAutoUpdate(
              this.activeTournament.id, 
              this.activeTournament.espnEventName,
              10 // Update every 10 minutes
            );
          } else {
            console.log('Auto-update not started: scoring disabled for this tournament');
          }
        }
      }
      
      // Always use general chat (persists across all tournaments)
      Chat.init(null);

      this.updateTournamentDisplay();
    } catch (error) {
      console.error('Error loading active tournament:', error);
    }
  },

  updateTournamentDisplay() {
    const nameEl = document.getElementById('tournament-name');
    const statusEl = document.getElementById('tournament-status');
    
    if (this.activeTournament) {
      if (nameEl) nameEl.textContent = this.activeTournament.name;
      if (statusEl) {
        const statusText = {
          'upcoming': 'Coming Soon',
          'lineup_open': 'Lineups Open',
          'in_progress': 'In Progress',
          'completed': 'Completed'
        };
        statusEl.textContent = statusText[this.activeTournament.status] || this.activeTournament.status;
        statusEl.className = `status-badge status-${this.activeTournament.status}`;
      }
    } else {
      if (nameEl) nameEl.textContent = 'No Active Tournament';
      if (statusEl) statusEl.textContent = '';
    }
  },

  // Flag to skip hashchange warning when nav was already confirmed via click
  skipHashChangeWarning: false,

  setupNavigation() {
    document.querySelectorAll('[data-nav]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const view = el.dataset.nav;
        
        // Check for unsaved lineup changes before navigating away from lineup tab
        if (this.hasUnsavedChanges() && window.location.hash === '#lineup') {
          if (!confirm('You have unsaved lineup changes. Are you sure you want to leave?')) {
            return;
          }
          // User confirmed, clear the warning and skip the hashchange check
          this.clearUnsavedWarning();
          this.skipHashChangeWarning = true;
        }
        
        window.location.hash = view;
      });
    });

    // Sign in/out buttons
    document.getElementById('sign-in-btn')?.addEventListener('click', () => Auth.signInWithGoogle());
    document.getElementById('sign-out-btn')?.addEventListener('click', () => Auth.signOut());
  },

  handleHashChange() {
    const newHash = window.location.hash;
    const hash = newHash.slice(1) || 'home';
    
    // Check for unsaved changes when navigating away from lineup tab
    // Skip if already confirmed via nav click
    if (!this.skipHashChangeWarning && this.previousHash === '#lineup' && newHash !== '#lineup' && this.hasUnsavedChanges()) {
      if (!confirm('You have unsaved lineup changes. Are you sure you want to leave?')) {
        // Restore the previous hash without triggering another hashchange
        history.pushState(null, '', this.previousHash);
        return;
      }
      // User confirmed, clear the warning
      this.clearUnsavedWarning();
    }
    
    // Reset the skip flag
    this.skipHashChangeWarning = false;
    
    this.previousHash = newHash;
    this.showView(hash);
  },

  showView(viewName) {
    this.currentView = viewName;
    
    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    
    // Show requested view
    const view = document.getElementById(`view-${viewName}`);
    if (view) {
      view.classList.add('active');
      this.onViewLoad(viewName);
    }

    // Update nav active state
    document.querySelectorAll('[data-nav]').forEach(el => {
      el.classList.toggle('active', el.dataset.nav === viewName);
    });
  },

  async onViewLoad(viewName) {
    // Clean up subscriptions when leaving views
    if (viewName !== 'leaderboard') {
      Leaderboard.stopLiveUpdates();
      Leaderboard.stopSeasonLiveUpdates();
    }
    
    switch (viewName) {
      case 'home':
        this.loadHomeView();
        break;
      case 'lineup':
        this.loadLineupView();
        break;
      case 'leaderboard':
        this.loadLeaderboardView();
        break;
      case 'history':
        this.loadHistoryView();
        break;
    }
  },

  async loadHomeView() {
    // Update tournament info is already done
  },

  // Track current lineup state
  currentLineupType: 'rounds_1_2',
  selectedGolfersR12: [],
  selectedGolfersR34: [],
  savedGolfersR12: [],
  savedGolfersR34: [],
  round1Started: false,
  round3Started: false,
  
  // Unsaved changes warning
  hasUnsavedChanges() {
    const r12Changed = JSON.stringify(this.selectedGolfersR12.sort()) !== JSON.stringify(this.savedGolfersR12.sort());
    const r34Changed = JSON.stringify(this.selectedGolfersR34.sort()) !== JSON.stringify(this.savedGolfersR34.sort());
    return r12Changed || r34Changed;
  },

  beforeUnloadHandler: null,

  updateUnsavedWarning() {
    if (this.hasUnsavedChanges()) {
      if (!this.beforeUnloadHandler) {
        this.beforeUnloadHandler = (e) => {
          e.preventDefault();
          e.returnValue = 'You have unsaved lineup changes. Are you sure you want to leave?';
          return e.returnValue;
        };
        window.addEventListener('beforeunload', this.beforeUnloadHandler);
      }
    } else {
      if (this.beforeUnloadHandler) {
        window.removeEventListener('beforeunload', this.beforeUnloadHandler);
        this.beforeUnloadHandler = null;
      }
    }
  },

  clearUnsavedWarning() {
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
  },

  // Check if a round has started by looking for any golfer with scores
  async checkRoundStatus(tournamentId) {
    try {
      const scoresDoc = await firebaseDb.collection('scores').doc(tournamentId).get();
      if (!scoresDoc.exists) {
        this.round1Started = false;
        this.round3Started = false;
        return;
      }

      const golferScores = scoresDoc.data().golferScores || {};
      
      this.round1Started = this.hasRoundStarted(golferScores, 1);
      this.round3Started = this.hasRoundStarted(golferScores, 3);
    } catch (error) {
      console.error('Error checking round status:', error);
      this.round1Started = false;
      this.round3Started = false;
    }
  },

  hasRoundStarted(golferScores, roundNumber) {
    const roundIndex = roundNumber - 1;
    for (const golferName in golferScores) {
      const golfer = golferScores[golferName];
      if (golfer?.rounds?.[roundIndex]) {
        const round = golfer.rounds[roundIndex];
        if (round.holes && round.holes.some(h => h && h.toPar !== null)) {
          return true;
        }
      }
    }
    return false;
  },

  async loadLineupView() {
    if (!this.activeTournament) {
      document.getElementById('lineup-content').innerHTML = 
        '<div class="no-data">No active tournament</div>';
      return;
    }

    if (!Auth.currentUser) {
      document.getElementById('lineup-content').innerHTML = 
        '<div class="no-data">Please sign in to submit your lineup</div>';
      return;
    }

    // Check round status for locking
    await this.checkRoundStatus(this.activeTournament.id);

    // Load existing lineups (always load, even if locked)
    const lineups = await Lineup.loadUserLineups(
      this.activeTournament.id, 
      Auth.currentUser.uid
    );

    this.selectedGolfersR12 = lineups.rounds_1_2?.golfers || [];
    this.selectedGolfersR34 = lineups.rounds_3_4?.golfers || [];
    
    // Store saved state to detect unsaved changes
    this.savedGolfersR12 = [...this.selectedGolfersR12];
    this.savedGolfersR34 = [...this.selectedGolfersR34];
    this.clearUnsavedWarning();
    
    // Default to first unlocked lineup type
    if (this.round1Started && !this.round3Started) {
      this.currentLineupType = 'rounds_3_4';
    } else {
      this.currentLineupType = 'rounds_1_2';
    }

    // Render the lineup builder
    this.renderLineupBuilder();
  },

  renderLineupBuilder() {
    const content = document.getElementById('lineup-content');
    const selectedGolfers = this.currentLineupType === 'rounds_1_2' 
      ? this.selectedGolfersR12 
      : this.selectedGolfersR34;

    // Check if current lineup type is locked
    const isR12Locked = this.round1Started;
    const isR34Locked = this.round3Started;
    const isCurrentLocked = this.currentLineupType === 'rounds_1_2' ? isR12Locked : isR34Locked;
    const allLocked = isR12Locked && isR34Locked;

    content.innerHTML = `
      <div class="lineup-builder">
        <div class="lineup-tabs">
          <button class="lineup-tab ${this.currentLineupType === 'rounds_1_2' ? 'active' : ''} ${isR12Locked ? 'locked' : ''}" 
                  data-lineup="rounds_1_2">
            Rounds 1-2
            ${isR12Locked ? '<span class="lock-icon">🔒</span>' : ''}
            <span class="tab-status">${this.selectedGolfersR12.length}/4</span>
          </button>
          <button class="lineup-tab ${this.currentLineupType === 'rounds_3_4' ? 'active' : ''} ${isR34Locked ? 'locked' : ''}" 
                  data-lineup="rounds_3_4">
            Rounds 3-4
            ${isR34Locked ? '<span class="lock-icon">🔒</span>' : ''}
            <span class="tab-status">${this.selectedGolfersR34.length}/4</span>
          </button>
        </div>

        ${allLocked ? `
          <div class="lineup-locked-banner">
            <p><strong>🔒 All lineups are locked</strong></p>
            <p>The tournament is in progress. View your selections below.</p>
            <a href="#leaderboard" class="btn btn-outline" style="margin-top: 12px;">View Leaderboard →</a>
          </div>
        ` : isCurrentLocked ? `
          <div class="lineup-locked-banner">
            <p><strong>🔒 This lineup is locked</strong></p>
            <p>Round ${this.currentLineupType === 'rounds_1_2' ? '1' : '3'} has started. You can no longer edit this lineup.</p>
          </div>
        ` : `
          <div class="lineup-info-banner">
            <p>You can use different golfers for rounds 1-2 vs rounds 3-4, or use the same lineup for both.</p>
            <p class="secondary-note">Golfers who are not playing or missed the cut are removed when possible, but the list may not always be up to date.</p>
          </div>
        `}

        <div class="salary-cap-display">
          <div class="cap-item">
            <span class="cap-label">Budget</span>
            <span class="cap-value">$<span id="salary-cap-display">${Lineup.formatSalary(Lineup.salaryCap)}</span></span>
          </div>
          <div class="cap-item">
            <span class="cap-label">Used</span>
            <span class="cap-value">$<span id="total-used">0.00</span></span>
          </div>
          <div class="cap-item">
            <span class="cap-label">Remaining</span>
            <span class="cap-value">$<span id="total-remaining">${Lineup.formatSalary(Lineup.salaryCap)}</span></span>
          </div>
          <div class="cap-item">
            <span class="cap-label">Per Slot Left</span>
            <span class="cap-value">$<span id="avg-per-pick">25.00</span></span>
          </div>
        </div>
        <div class="progress">
          <div class="progress-bar bg-success" id="budget-progress" style="width: 0%"></div>
        </div>
        <div id="budget-warning" class="budget-warning" style="display: none;">
          Over budget! Adjust your selections.
        </div>

        <div class="lineup-columns">
          <div class="selected-golfers-section">
            <h3>${this.currentLineupType === 'rounds_1_2' ? 'Rounds 1-2 Lineup' : 'Rounds 3-4 Lineup'}</h3>
            <div id="selected-golfers"></div>
            ${!isCurrentLocked ? `
              <div class="lineup-actions">
                <button id="submit-lineup-btn" class="btn btn-primary btn-lg" disabled>
                  Save ${this.currentLineupType === 'rounds_1_2' ? 'R1-2' : 'R3-4'}
                </button>
                ${this.currentLineupType === 'rounds_1_2' ? `
                  <button id="copy-to-r34-btn" class="btn btn-outline" ${this.selectedGolfersR12.length !== 4 || isR34Locked ? 'disabled' : ''}>
                    Copy to R3-4
                  </button>
                ` : `
                  <button id="copy-from-r12-btn" class="btn btn-outline" ${this.selectedGolfersR12.length !== 4 ? 'disabled' : ''}>
                    Copy R1-2
                  </button>
                `}
              </div>
            ` : ''}
          </div>

          ${!isCurrentLocked ? `
            <div class="golfer-pool-section">
              <h3>Available Golfers</h3>
              <input type="text" id="golfer-search" class="form-control" placeholder="Search golfers...">
              <div id="golfer-pool"></div>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    // Tab switching
    document.querySelectorAll('.lineup-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const newType = tab.dataset.lineup;
        const isLocked = newType === 'rounds_1_2' ? isR12Locked : isR34Locked;
        // Allow viewing locked lineups, but not switching away if current is the only unlocked one
        this.currentLineupType = newType;
        this.renderLineupBuilder();
      });
    });

    // Only set up editing functionality if not locked
    if (!isCurrentLocked) {
      // Copy lineup buttons
      document.getElementById('copy-to-r34-btn')?.addEventListener('click', () => {
        if (isR34Locked) {
          this.showToast('R3-4 lineup is locked', 'warning');
          return;
        }
        this.selectedGolfersR34 = [...this.selectedGolfersR12];
        this.currentLineupType = 'rounds_3_4';
        this.renderLineupBuilder();
        this.updateUnsavedWarning();
        this.showToast('Lineup copied to Rounds 3-4', 'success');
      });

      document.getElementById('copy-from-r12-btn')?.addEventListener('click', () => {
        this.selectedGolfersR34 = [...this.selectedGolfersR12];
        this.renderLineupBuilder();
        this.updateUnsavedWarning();
        this.showToast('Lineup copied from Rounds 1-2', 'success');
      });

      // Render golfer selector
      Lineup.renderGolferSelector('golfer-pool', (golfer) => {
        const currentGolfers = this.currentLineupType === 'rounds_1_2' 
          ? this.selectedGolfersR12 
          : this.selectedGolfersR34;

        if (currentGolfers.length >= 4) {
          this.showToast('You already have 4 golfers selected', 'warning');
          return;
        }
        if (currentGolfers.includes(golfer.name)) {
          this.showToast('Golfer already selected', 'warning');
          return;
        }
        if (!Lineup.canAfford(golfer.name, currentGolfers)) {
          this.showToast('Cannot afford this golfer', 'warning');
          return;
        }
        currentGolfers.push(golfer.name);
        this.updateLineupDisplay();
        this.updateUnsavedWarning();
      });

      // Search functionality
      document.getElementById('golfer-search')?.addEventListener('input', (e) => {
        const search = e.target.value.toLowerCase();
        document.querySelectorAll('#golfer-pool .golfer-item').forEach(item => {
          const name = item.dataset.name.toLowerCase();
          item.style.display = name.includes(search) ? '' : 'none';
        });
      });

      // Submit button
      document.getElementById('submit-lineup-btn')?.addEventListener('click', async () => {
        const currentGolfers = this.currentLineupType === 'rounds_1_2' 
          ? this.selectedGolfersR12 
          : this.selectedGolfersR34;

        try {
          await Lineup.saveLineup(
            this.activeTournament.id,
            Auth.currentUser.uid,
            Auth.currentUser.displayName || Auth.currentUser.email,
            currentGolfers,
            this.currentLineupType
          );
          
          // Update saved state after successful save
          if (this.currentLineupType === 'rounds_1_2') {
            this.savedGolfersR12 = [...this.selectedGolfersR12];
          } else {
            this.savedGolfersR34 = [...this.selectedGolfersR34];
          }
          this.updateUnsavedWarning();
          
          this.showToast(`${this.currentLineupType === 'rounds_1_2' ? 'Rounds 1-2' : 'Rounds 3-4'} lineup saved!`, 'success');
          // Re-render to update tab status
          this.renderLineupBuilder();
        } catch (error) {
          this.showToast(error.message, 'error');
        }
      });
    }

    // Render selected golfers (always, for viewing)
    this.updateLineupDisplay();
  },

  updateLineupDisplay() {
    const currentGolfers = this.currentLineupType === 'rounds_1_2' 
      ? this.selectedGolfersR12 
      : this.selectedGolfersR34;

    const isCurrentLocked = this.currentLineupType === 'rounds_1_2' 
      ? this.round1Started 
      : this.round3Started;

    // If locked, don't allow removal (pass null callback)
    Lineup.renderSelectedGolfers('selected-golfers', currentGolfers, isCurrentLocked ? null : (index) => {
      currentGolfers.splice(index, 1);
      this.updateLineupDisplay();
      this.updateUnsavedWarning();
    });

    // Update submit button state
    const submitBtn = document.getElementById('submit-lineup-btn');
    if (submitBtn) {
      const isValid = currentGolfers.length === 4 && 
        Lineup.calculateTotalSalary(currentGolfers) <= Lineup.salaryCap;
      submitBtn.disabled = !isValid;
    }

    // Update tab status
    document.querySelectorAll('.lineup-tab').forEach(tab => {
      const type = tab.dataset.lineup;
      const golfers = type === 'rounds_1_2' ? this.selectedGolfersR12 : this.selectedGolfersR34;
      const status = tab.querySelector('.tab-status');
      if (status) status.textContent = `${golfers.length}/4`;
    });

    // Update golfer pool to show affordability
    document.querySelectorAll('#golfer-pool .golfer-item').forEach(item => {
      const name = item.dataset.name;
      const isSelected = currentGolfers.includes(name);
      const canAfford = Lineup.canAfford(name, currentGolfers);
      
      item.classList.toggle('selected', isSelected);
      item.classList.toggle('cannot-afford', !canAfford && !isSelected);
    });
  },

  // Tournament leaderboard sub-view: 'standings' | 'field'
  leaderboardTournamentSubview: 'standings',

  async loadLeaderboardView() {
    // Setup toggle buttons and tournament selector
    this.setupLeaderboardToggle();
    this.setupLeaderboardTournamentSubviewToggle();
    this.setupTournamentSelector();
    this.setupSeasonSelector();
    
    // Load tournament leaderboard
    const tournamentToLoad = this.selectedLeaderboardTournament || this.activeTournament;
    if (tournamentToLoad) {
      await this.loadTournamentLeaderboard(tournamentToLoad.id);
    } else {
      document.getElementById('leaderboard-content').innerHTML = 
        '<div class="no-data">No tournaments available</div>';
    }
  },

  setupTournamentSelector() {
    const selector = document.getElementById('tournament-selector');
    const seasonIndicator = document.getElementById('season-indicator');
    if (!selector) return;

    const seasonTournaments = this.getTournamentsForSeason(this.currentSeason);
    const currentYear = new Date().getFullYear();
    
    // Build options
    selector.innerHTML = seasonTournaments.length === 0
      ? '<option value="">No tournaments this season</option>'
      : seasonTournaments.map(t => {
          const statusBadge = t.status === 'in_progress' ? ' (Live)' : 
                             t.status === 'completed' ? ' ✓' : 
                             t.status === 'lineup_open' ? ' (Open)' : '';
          return `<option value="${t.id}">${t.name}${statusBadge}</option>`;
        }).join('');

    // Set initial selection
    const initialTournament = this.selectedLeaderboardTournament || this.activeTournament;
    if (initialTournament && seasonTournaments.some(t => t.id === initialTournament.id)) {
      selector.value = initialTournament.id;
    } else if (seasonTournaments.length > 0) {
      selector.value = seasonTournaments[0].id;
      this.selectedLeaderboardTournament = seasonTournaments[0];
    }

    // Update season indicator
    if (seasonIndicator) {
      const availableSeasons = this.getAvailableSeasons();
      if (this.currentSeason !== currentYear) {
        seasonIndicator.innerHTML = `Viewing ${this.currentSeason} season | <a href="?#leaderboard">Back to ${currentYear}</a>`;
      } else if (availableSeasons.length > 1) {
        const otherSeasons = availableSeasons.filter(s => s !== currentYear);
        seasonIndicator.innerHTML = `${this.currentSeason} Season | View: ${otherSeasons.map(s => 
          `<a href="?season=${s}#leaderboard">${s}</a>`
        ).join(', ')}`;
      } else {
        seasonIndicator.innerHTML = `${this.currentSeason} Season`;
      }
    }

    // Handle selection change
    selector.addEventListener('change', async (e) => {
      const tournamentId = e.target.value;
      if (!tournamentId) return;
      
      const tournament = this.allTournaments.find(t => t.id === tournamentId);
      if (tournament) {
        this.selectedLeaderboardTournament = tournament;
        await this.loadTournamentLeaderboard(tournamentId);
      }
    });
  },

  setupSeasonSelector() {
    const selector = document.getElementById('season-selector');
    if (!selector) return;

    const availableSeasons = this.getAvailableSeasons();
    
    selector.innerHTML = availableSeasons.length === 0
      ? '<option value="">No seasons available</option>'
      : availableSeasons.map(s => 
          `<option value="${s}" ${s === this.currentSeason ? 'selected' : ''}>${s} Season</option>`
        ).join('');

    selector.addEventListener('change', async (e) => {
      const season = parseInt(e.target.value);
      if (season) {
        this.currentSeason = season;
        this.setSeasonInUrl(season);
        // Reload season standings with the selected season
        await Leaderboard.renderSeasonStandings('season-leaderboard-content', Auth.currentUser?.uid, season);
      }
    });
  },

  async loadTournamentLeaderboard(tournamentId) {
    const tournament = this.allTournaments.find(t => t.id === tournamentId);
    if (!tournament) return;

    this.selectedLeaderboardTournament = tournament;
    
    // Stop any existing live updates
    Leaderboard.stopLiveUpdates();
    
    // Start live updates only for active tournaments
    if (tournament.status === 'in_progress' || tournament.status === 'lineup_open') {
      Leaderboard.startLiveUpdates(tournamentId, 'leaderboard-content');
    }
    
    const standings = await Leaderboard.calculateStandings(tournamentId);
    if (this.leaderboardTournamentSubview === 'field') {
      Leaderboard.renderFieldView('leaderboard-field-content', tournamentId, Auth.currentUser?.uid, standings);
    } else {
      Leaderboard.renderLeaderboard('leaderboard-content', standings, Auth.currentUser?.uid);
    }
    
    // Update last updated timestamp
    Leaderboard.updateLastUpdatedDisplay('leaderboard-last-updated');
    this.syncLeaderboardSubviewPanels();
  },

  syncLeaderboardSubviewPanels() {
    const isField = this.leaderboardTournamentSubview === 'field';
    document.getElementById('btn-leaderboard-standings')?.classList.toggle('active', !isField);
    document.getElementById('btn-leaderboard-field')?.classList.toggle('active', isField);
    document.getElementById('leaderboard-standings-panel')?.classList.toggle('active', !isField);
    document.getElementById('leaderboard-field-panel')?.classList.toggle('active', isField);
  },

  setupLeaderboardTournamentSubviewToggle() {
    const standingsBtn = document.getElementById('btn-leaderboard-standings');
    const fieldBtn = document.getElementById('btn-leaderboard-field');
    if (!standingsBtn || !fieldBtn) return;
    if (standingsBtn.dataset.bound === '1') return;
    standingsBtn.dataset.bound = '1';
    fieldBtn.dataset.bound = '1';

    standingsBtn.addEventListener('click', async () => {
      if (this.leaderboardTournamentSubview === 'standings') return;
      this.leaderboardTournamentSubview = 'standings';
      this.syncLeaderboardSubviewPanels();
      const tid = this.selectedLeaderboardTournament?.id;
      if (tid && Leaderboard.currentStandings.length) {
        Leaderboard.renderLeaderboard('leaderboard-content', Leaderboard.currentStandings, Auth.currentUser?.uid);
      } else if (tid) {
        await this.loadTournamentLeaderboard(tid);
      }
    });

    fieldBtn.addEventListener('click', async () => {
      if (this.leaderboardTournamentSubview === 'field') return;
      this.leaderboardTournamentSubview = 'field';
      this.syncLeaderboardSubviewPanels();
      const tid = this.selectedLeaderboardTournament?.id;
      if (tid) {
        const standings = await Leaderboard.calculateStandings(tid);
        Leaderboard.renderFieldView('leaderboard-field-content', tid, Auth.currentUser?.uid, standings);
        Leaderboard.updateLastUpdatedDisplay('leaderboard-last-updated');
      }
    });
  },

  setupLeaderboardToggle() {
    const tournamentBtn = document.getElementById('btn-tournament-view');
    const seasonBtn = document.getElementById('btn-season-view');
    const tournamentView = document.getElementById('leaderboard-tournament');
    const seasonView = document.getElementById('leaderboard-season');

    if (!tournamentBtn || !seasonBtn) return;

    tournamentBtn.addEventListener('click', () => {
      tournamentBtn.classList.add('active');
      seasonBtn.classList.remove('active');
      tournamentView.classList.add('active');
      seasonView.classList.remove('active');
      this.syncLeaderboardSubviewPanels();
    });

    seasonBtn.addEventListener('click', async () => {
      seasonBtn.classList.add('active');
      tournamentBtn.classList.remove('active');
      seasonView.classList.add('active');
      tournamentView.classList.remove('active');
      
      // Load season standings for current season
      await Leaderboard.renderSeasonStandings('season-leaderboard-content', Auth.currentUser?.uid, this.currentSeason);
    });
  },

  // Cache for history tournaments
  historyTournaments: [],
  historySelectedSeason: null,

  async loadHistoryView() {
    // Load Previous Winners
    this.loadHallOfFame();
    
    // Load completed tournaments
    try {
      const snapshot = await firebaseDb.collection('tournaments')
        .where('status', '==', 'completed')
        .orderBy('startDate', 'desc')
        .get();

      this.historyTournaments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      const content = document.getElementById('history-content');
      const selectorContainer = document.getElementById('history-season-selector');
      const selector = document.getElementById('history-season-select');
      
      if (this.historyTournaments.length === 0) {
        content.innerHTML = '<div class="no-data">No completed tournaments yet</div>';
        selectorContainer.style.display = 'none';
        return;
      }

      // Extract unique seasons
      const seasons = [...new Set(this.historyTournaments.map(t => {
        const date = t.startDate?.toDate ? t.startDate.toDate() : new Date(t.startDate.seconds * 1000);
        return date.getFullYear();
      }))].sort((a, b) => b - a);

      // Show season selector if multiple seasons exist
      if (seasons.length > 1) {
        selectorContainer.style.display = 'flex';
        selector.innerHTML = seasons.map(s => `<option value="${s}">${s}</option>`).join('');
        
        // Set up change handler
        selector.onchange = () => {
          this.historySelectedSeason = parseInt(selector.value);
          this.renderHistoryTournaments();
        };
      } else {
        selectorContainer.style.display = 'none';
      }

      // Default to most recent season
      this.historySelectedSeason = seasons[0];
      if (selector) selector.value = this.historySelectedSeason;
      
      this.renderHistoryTournaments();
    } catch (error) {
      console.error('Error loading history:', error);
    }
  },

  renderHistoryTournaments() {
    const content = document.getElementById('history-content');
    
    // Filter tournaments by selected season
    const filteredTournaments = this.historyTournaments.filter(t => {
      const date = t.startDate?.toDate ? t.startDate.toDate() : new Date(t.startDate.seconds * 1000);
      return date.getFullYear() === this.historySelectedSeason;
    });

    if (filteredTournaments.length === 0) {
      content.innerHTML = '<div class="no-data">No completed tournaments for this season</div>';
      return;
    }

    // Build HTML with loading placeholders
    content.innerHTML = `
      <div class="history-list">
        ${filteredTournaments.map(t => {
          const date = t.startDate?.toDate ? t.startDate.toDate() : new Date(t.startDate.seconds * 1000);
          return `
            <div class="history-item" data-id="${t.id}">
              <div class="history-header">
                <div>
                  <h4>${t.name}</h4>
                  <p class="history-date">${date.toLocaleDateString()}</p>
                </div>
              </div>
              <div class="history-standings" id="history-standings-${t.id}">
                <div class="loading-placeholder">Loading standings...</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Load standings for each tournament
    for (const tournament of filteredTournaments) {
      this.loadHistoryStandings(tournament.id);
    }
  },

  tournamentDisplayNames: {
    masters: 'Masters',
    pga: 'PGA Championship',
    usopen: 'US Open',
    open: 'The Open',
    season: 'Season'
  },

  async loadHallOfFame() {
    const container = document.getElementById('hall-of-fame-content');
    
    try {
      const doc = await firebaseDb.collection('config').doc('historicalWinners').get();
      const winners = doc.exists ? (doc.data().winners || []) : [];
      
      if (winners.length === 0) {
        container.innerHTML = '<div class="no-data">No historical data available yet</div>';
        return;
      }

      // Get unique years and sort descending
      const years = [...new Set(winners.map(w => w.year))].sort((a, b) => b - a);
      const tournaments = ['masters', 'pga', 'usopen', 'open', 'season'];

      // Build table
      let html = `
        <div class="hall-of-fame-table-wrapper">
          <table class="hall-of-fame-table">
            <thead>
              <tr>
                <th class="year-col">Year</th>
                ${tournaments.map(t => `
                  <th class="tournament-col">${this.tournamentDisplayNames[t]}</th>
                `).join('')}
              </tr>
            </thead>
            <tbody>
      `;

      for (const year of years) {
        html += `<tr>`;
        html += `<td class="year-col">${year}</td>`;
        
        for (const tournament of tournaments) {
          const winner = winners.find(w => w.year === year && w.tournament === tournament);
          if (winner) {
            html += `
              <td class="winner-cell ${tournament === 'season' ? 'season-champion' : ''}">
                <span class="winner-name">${winner.winner}</span>
                ${winner.score ? `<span class="winner-score">${winner.score}</span>` : ''}
              </td>
            `;
          } else {
            html += `<td class="winner-cell empty">—</td>`;
          }
        }
        
        html += `</tr>`;
      }

      html += `</tbody></table></div>`;
      container.innerHTML = html;
    } catch (error) {
      console.error('Error loading previous winners:', error);
      container.innerHTML = '<div class="no-data">Error loading previous winners</div>';
    }
  },

  async loadHistoryStandings(tournamentId) {
    try {
      const standings = await Leaderboard.calculateStandings(tournamentId);
      const container = document.getElementById(`history-standings-${tournamentId}`);
      if (!container) return;

      if (!standings || standings.length === 0) {
        container.innerHTML = '<div class="no-standings">No standings available</div>';
        return;
      }

      const top5 = standings.slice(0, 5);
      const hasMore = standings.length > 5;

      container.innerHTML = `
        <table class="history-standings-table">
          <thead>
            <tr>
              <th class="pos">Pos</th>
              <th class="player">Player</th>
              <th class="total">Total</th>
            </tr>
          </thead>
          <tbody class="top-standings">
            ${top5.map(player => this.renderHistoryStandingRow(player)).join('')}
          </tbody>
          ${hasMore ? `
            <tbody class="expanded-standings" style="display: none;">
              ${standings.slice(5).map(player => this.renderHistoryStandingRow(player)).join('')}
            </tbody>
          ` : ''}
        </table>
        ${hasMore ? `
          <button class="btn btn-sm expand-standings-btn" data-tournament="${tournamentId}" data-total="${standings.length}">
            Show All (${standings.length} players)
          </button>
        ` : ''}
      `;

      // Add click handler for expand button
      const expandBtn = container.querySelector('.expand-standings-btn');
      if (expandBtn) {
        expandBtn.addEventListener('click', () => this.toggleHistoryStandings(tournamentId));
      }
    } catch (error) {
      console.error(`Error loading standings for ${tournamentId}:`, error);
      const container = document.getElementById(`history-standings-${tournamentId}`);
      if (container) {
        container.innerHTML = '<div class="no-standings">Error loading standings</div>';
      }
    }
  },

  renderHistoryStandingRow(player) {
    const formatScore = (score) => {
      if (score === null || score === undefined || score === '-') return '-';
      if (score === 0) return 'E';
      return score > 0 ? `+${score}` : score;
    };
    
    const positionDisplay = player.tied ? `T${player.position}` : player.position;

    return `
      <tr>
        <td class="pos">${positionDisplay}</td>
        <td class="player">${player.displayName}</td>
        <td class="total">${formatScore(player.totalToPar)}</td>
      </tr>
    `;
  },

  toggleHistoryStandings(tournamentId) {
    const container = document.getElementById(`history-standings-${tournamentId}`);
    if (!container) return;

    const expandedBody = container.querySelector('.expanded-standings');
    const btn = container.querySelector('.expand-standings-btn');
    
    if (expandedBody && btn) {
      const isExpanded = expandedBody.style.display !== 'none';
      const total = btn.dataset.total;
      expandedBody.style.display = isExpanded ? 'none' : 'table-row-group';
      btn.textContent = isExpanded ? `Show All (${total} players)` : 'Show Top 5';
    }
  },

  onUserSignedIn(user) {
    console.log('User signed in:', user.displayName);
    // Re-subscribe to chat now that user is authenticated
    if (typeof Chat !== 'undefined') {
      Chat.subscribeToMessages();
    }
    // Refresh current view
    this.onViewLoad(this.currentView);
  },

  onUserSignedOut() {
    console.log('User signed out');
    // Cleanup chat subscription
    if (typeof Chat !== 'undefined') {
      Chat.cleanup();
      Chat.subscribeToMessages(); // This will show the "sign in" message
    }
    // Refresh current view
    this.onViewLoad(this.currentView);
  },

  showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = message;
      toast.className = `toast show ${type}`;
      setTimeout(() => toast.classList.remove('show'), 3000);
    }
  }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
