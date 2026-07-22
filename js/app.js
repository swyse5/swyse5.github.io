// Main Application Module
const App = {
  currentView: 'home',
  activeTournament: null,
  selectedLeaderboardTournament: null,
  allTournaments: [],
  currentSeason: null,
  /** Shown in the banner when no tournament is lineup_open / in_progress (config/siteBanner). */
  bannerConfig: { text: '', subtext: '' },

  async init() {
    // Initialize theme
    this.initTheme();
    
    // Initialize authentication
    Auth.init();
    
    // Get current season from URL or default to current year
    this.currentSeason = this.getSeasonFromUrl() || new Date().getFullYear();
    
    // Set up navigation
    this.setupNavigation();
    
    await this.loadBannerConfig();
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

  /** Firestore Timestamp / seconds / Date → Date. */
  toTournamentDate(value) {
    if (value == null) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  },

  /**
   * Calendar day from admin date fields (YYYY-MM-DD stored as UTC midnight).
   * Uses UTC parts so US timezones do not show the previous day.
   */
  tournamentDateParts(value) {
    const d = this.toTournamentDate(value);
    if (!d) return null;
    return {
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      year: d.getUTCFullYear()
    };
  },

  /** e.g. 5/14-5/17 for a Thu–Sun major (calendar dates from admin, no year). */
  formatTournamentDateRange(tournament) {
    const start = this.tournamentDateParts(tournament?.startDate);
    const end = this.tournamentDateParts(tournament?.endDate);
    if (!start) return '';
    if (!end) return `${start.month}/${start.day}`;
    if (start.month === end.month && start.day === end.day) {
      return `${start.month}/${start.day}`;
    }
    return `${start.month}/${start.day}-${end.month}/${end.day}`;
  },

  async loadAllTournaments(force = false) {
    if (!force && this.allTournaments?.length && this._tournamentsLoadedAt
      && (Date.now() - this._tournamentsLoadedAt) < 10 * 60 * 1000) {
      return;
    }
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
      this._tournamentsLoadedAt = Date.now();
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

  async loadBannerConfig(force = false) {
    try {
      const cached = await FirestoreCache.getDoc('config', 'siteBanner', {
        force,
        ttlMs: 15 * 60 * 1000
      });
      if (cached.exists) {
        const data = cached.data;
        this.bannerConfig = {
          text: String(data.text || '').trim(),
          subtext: String(data.subtext || '').trim()
        };
      }
    } catch (error) {
      console.warn('Could not load site banner config:', error);
      this.bannerConfig = { text: '', subtext: '' };
    }
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
    const subtextEl = document.getElementById('tournament-banner-subtext');
    const statusEl = document.getElementById('tournament-status');

    if (this.activeTournament) {
      if (nameEl) nameEl.textContent = this.activeTournament.name;
      if (subtextEl) {
        subtextEl.textContent = '';
        subtextEl.hidden = true;
      }
      if (statusEl) {
        const statusText = {
          upcoming: 'Coming Soon',
          lineup_open: 'Lineups Open',
          in_progress: 'In Progress',
          completed: 'Completed'
        };
        statusEl.textContent = statusText[this.activeTournament.status] || this.activeTournament.status;
        statusEl.className = `status-badge status-${this.activeTournament.status}`;
        statusEl.hidden = false;
      }
      return;
    }

    const { text, subtext } = this.bannerConfig || { text: '', subtext: '' };
    if (nameEl) nameEl.textContent = text || 'No Active Tournament';
    if (subtextEl) {
      if (subtext) {
        subtextEl.textContent = subtext;
        subtextEl.hidden = false;
      } else {
        subtextEl.textContent = '';
        subtextEl.hidden = true;
      }
    }
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.className = 'status-badge';
      statusEl.hidden = true;
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

  /** Open leaderboard on Season tab after navigating from Home. */
  pendingLeaderboardSeasonView: false,

  getCompletedTournamentCount(season = this.currentSeason) {
    return this.getTournamentsForSeason(season).filter((t) => t.status === 'completed').length;
  },

  getPreviousCompletedTournament(season = this.currentSeason) {
    return this.getTournamentsForSeason(season)
      .filter((t) => t.status === 'completed')
      .sort((a, b) => {
        const aMs = (a.startDateObj || this.toTournamentDate(a.startDate))?.getTime() || 0;
        const bMs = (b.startDateObj || this.toTournamentDate(b.startDate))?.getTime() || 0;
        return bMs - aMs;
      })[0] || null;
  },

  getNextTournament(season = this.currentSeason) {
    const now = Date.now();
    const candidates = this.getTournamentsForSeason(season)
      .filter((t) => {
        if (t.status === 'upcoming') return true;
        if (t.status === 'completed' || t.status === 'lineup_open' || t.status === 'in_progress') {
          return false;
        }
        const start = t.startDateObj || this.toTournamentDate(t.startDate);
        return start && start.getTime() > now;
      })
      .sort((a, b) => {
        const aMs = (a.startDateObj || this.toTournamentDate(a.startDate))?.getTime() || 0;
        const bMs = (b.startDateObj || this.toTournamentDate(b.startDate))?.getTime() || 0;
        return aMs - bMs;
      });
    return candidates[0] || null;
  },

  getHomePhasePreviewFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const preview = (params.get('previewHome') || '').trim().toLowerCase();
    const allowed = new Set([
      'signed_out',
      'lineup_open',
      'in_progress',
      'between_majors',
      'season_over'
    ]);
    return allowed.has(preview) ? preview : null;
  },

  /** Stand-in major when previewing lineup_open / in_progress with no live tournament. */
  getHomePreviewTournament(season = this.currentSeason) {
    if (this.activeTournament) return this.activeTournament;
    const completed = this.getTournamentsForSeason(season)
      .filter((t) => t.status === 'completed')
      .sort((a, b) => {
        const aMs = (a.startDateObj || this.toTournamentDate(a.startDate))?.getTime() || 0;
        const bMs = (b.startDateObj || this.toTournamentDate(b.startDate))?.getTime() || 0;
        return bMs - aMs;
      });
    return completed[0] || this.getTournamentsForSeason(season)[0] || null;
  },

  getHomePhase() {
    const preview = this.getHomePhasePreviewFromUrl();
    if (preview) return preview;
    if (!Auth.currentUser) return 'signed_out';
    const active = this.activeTournament;
    if (active?.status === 'lineup_open') return 'lineup_open';
    if (active?.status === 'in_progress') return 'in_progress';
    // Four majors per season: once all are completed, wrap the season.
    if (this.getCompletedTournamentCount(this.currentSeason) >= 4) return 'season_over';
    return 'between_majors';
  },

  homePhaseLabel(phase) {
    return {
      signed_out: 'League',
      lineup_open: 'Lineups Open',
      in_progress: 'In Progress',
      between_majors: 'Between Majors',
      season_over: 'Season Complete'
    }[phase] || '';
  },

  formatHomeOrdinal(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '';
    const mod100 = v % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
    switch (v % 10) {
      case 1: return `${v}st`;
      case 2: return `${v}nd`;
      case 3: return `${v}rd`;
      default: return `${v}th`;
    }
  },

  formatHomeLockTime(ts) {
    const d = this.parseTournamentTimestamp(ts);
    if (!d) return null;
    return d.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  },

  findStandingForUser(standings, userId) {
    if (!standings?.length || !userId) return null;
    return standings.find((p) => AccountMerges.isSamePlayer(p.userId, userId)) || null;
  },

  async getHomeTournamentStandings(tournamentId) {
    if (
      Leaderboard.currentTournamentId === tournamentId &&
      Array.isArray(Leaderboard.currentStandings)
    ) {
      const tb = await Leaderboard.loadTournamentTiebreakUserId(tournamentId);
      Leaderboard.currentStandings = Leaderboard.applyFirstPlaceTiebreak(
        [...Leaderboard.currentStandings],
        tb
      );
      return Leaderboard.currentStandings;
    }
    const tournament =
      this.activeTournament?.id === tournamentId
        ? this.activeTournament
        : this.allTournaments.find((t) => t.id === tournamentId);
    const standings = await Leaderboard.calculateStandings(tournamentId, {
      tournament: tournament || undefined
    });
    Leaderboard.currentTournamentId = tournamentId;
    Leaderboard.currentStandings = standings;
    return standings;
  },

  async getHomeSeasonSnapshot(season) {
    if (
      Leaderboard.seasonValue === season &&
      Array.isArray(Leaderboard.seasonStandings)
    ) {
      const tb = await Leaderboard.loadSeasonTiebreakUserId(season);
      Leaderboard.seasonStandings = Leaderboard.applyFirstPlaceTiebreak(
        [...Leaderboard.seasonStandings],
        tb
      );
      return {
        standings: Leaderboard.seasonStandings,
        bogeyPot: Leaderboard.seasonBogeyPot || 0
      };
    }
    const result = await Leaderboard.calculateSeasonStandings(season);
    Leaderboard.seasonValue = season;
    Leaderboard.seasonStandings = result.standings;
    Leaderboard.seasonBogeyPot = result.bogeyPot;
    return { standings: result.standings, bogeyPot: result.bogeyPot };
  },

  buildHomeStandingsSnapshotHtml(standings, userId, { scoreKey = 'totalToPar', emptyLabel = 'No standings yet', limit = 3 } = {}) {
    if (!standings?.length) {
      return `<p class="home-support">${emptyLabel}</p>`;
    }
    const top = standings.slice(0, limit);
    const you = this.findStandingForUser(standings, userId);
    const rows = [...top];
    if (you && !top.some((p) => AccountMerges.isSamePlayer(p.userId, you.userId))) {
      rows.push(you);
    }
    const items = rows.map((p) => {
      const isYou = AccountMerges.isSamePlayer(p.userId, userId);
      const score = p[scoreKey];
      const scoreClass = Leaderboard.getScoreClass(score);
      const posLabel = p.tied ? `T${p.position}` : String(p.position);
      const name = isYou ? `${p.displayName || 'You'} (you)` : (p.displayName || 'Player');
      return `<li class="${isYou ? 'is-you' : ''}">
        <span class="pos">${posLabel}</span>
        <span class="name">${name}</span>
        <span class="score ${scoreClass}">${Scoring.formatToPar(score)}</span>
      </li>`;
    }).join('');
    return `<ul class="home-standings-list">${items}</ul>`;
  },

  openSeasonLeaderboard() {
    this.pendingLeaderboardSeasonView = true;
    if (window.location.hash === '#leaderboard') {
      this.showView('leaderboard');
    } else {
      window.location.hash = 'leaderboard';
    }
  },

  bindHomeDashboardActions(container) {
    container.querySelector('#home-sign-in')?.addEventListener('click', () => Auth.signInWithGoogle());
    container.querySelector('#home-cta-season')?.addEventListener('click', () => this.openSeasonLeaderboard());
    container.querySelector('#home-cta-season-inline')?.addEventListener('click', () => this.openSeasonLeaderboard());
    container.querySelector('#home-prev-major-lb')?.addEventListener('click', (e) => {
      e.preventDefault();
      const tournamentId = e.currentTarget.dataset.tournamentId;
      const tournament = this.allTournaments.find((t) => t.id === tournamentId);
      if (tournament) {
        this.selectedLeaderboardTournament = tournament;
        this.pendingLeaderboardSeasonView = false;
      }
      window.location.hash = 'leaderboard';
    });
    container.querySelectorAll('[data-nav]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.hash = el.dataset.nav;
      });
    });

    const scorecardMount = container.querySelector('#home-scorecard-body');
    if (scorecardMount) {
      const labelEl = container.querySelector('.home-scorecard-header .home-snapshot-label');
      container.querySelectorAll('.home-round-toggle .round-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const round = parseInt(btn.dataset.round, 10);
          if (!round) return;
          container.querySelectorAll('.home-round-toggle .round-btn').forEach((b) => {
            b.classList.toggle('active', b === btn);
          });
          if (labelEl) labelEl.textContent = `Your scorecard · Round ${round}`;
          const player = this._homeScorecardPlayer;
          const userId = this._homeScorecardUserId;
          if (!player) return;
          scorecardMount.innerHTML = Leaderboard.renderHoleByHoleDetails(player, round, userId);
        });
      });
    }
  },

  buildHomeLiveScorecardHtml(player, userId, roundNumber) {
    if (!player) return '';
    this._homeScorecardPlayer = player;
    this._homeScorecardUserId = userId;
    const roundBtns = [1, 2, 3, 4].map((r) =>
      `<button type="button" class="round-btn ${r === roundNumber ? 'active' : ''}" data-round="${r}">R${r}</button>`
    ).join('');
    return `
      <div class="home-scorecard">
        <div class="home-scorecard-header">
          <p class="home-snapshot-label">Your scorecard · Round ${roundNumber}</p>
          <div class="home-round-toggle">${roundBtns}</div>
        </div>
        <div id="home-scorecard-body" data-player-id="${player.userId}">
          ${Leaderboard.renderHoleByHoleDetails(player, roundNumber, userId)}
        </div>
      </div>
    `;
  },

  async getHomeLineupStatus(tournamentId, userId) {
    const lineups = userId
      ? await Lineup.loadUserLineups(tournamentId, userId)
      : { rounds_1_2: null, rounds_3_4: null };
    const r12Count = lineups.rounds_1_2?.golfers?.length || 0;
    const r34Count = lineups.rounds_3_4?.golfers?.length || 0;
    return {
      r12Count,
      r34Count,
      r12Ready: r12Count >= 4,
      r34Ready: r34Count >= 4
    };
  },

  homeLineupStatusValue(open, ready, count) {
    if (!open) return '🔒 locked';
    if (ready) return '✅ saved';
    if (count) return `⚠️ ${count}/4`;
    return '⚠️ not set';
  },

  buildHomeLineupStatusListHtml(status, { r12Open = true, r34Open = true } = {}) {
    const rows = [
      {
        label: 'Rounds 1–2',
        value: this.homeLineupStatusValue(r12Open, status.r12Ready, status.r12Count)
      },
      {
        label: 'Rounds 3–4',
        value: this.homeLineupStatusValue(r34Open, status.r34Ready, status.r34Count)
      }
    ];
    return `
      <ul class="home-lock-list">
        ${rows.map((row) => `
          <li>
            <span class="home-lock-label">${row.label}</span>
            <span class="home-lock-time">${row.value}</span>
          </li>
        `).join('')}
      </ul>
    `;
  },

  buildHomeLocksHtml(tournament, { include12 = true, include34 = true } = {}) {
    const lock12 = include12 ? this.formatHomeLockTime(tournament?.lineupLockAtRounds12) : null;
    const lock34 = include34 ? this.formatHomeLockTime(tournament?.lineupLockAtRounds34) : null;
    if (!lock12 && !lock34) return '';
    return `
      <p class="home-snapshot-label">Locks</p>
      <ul class="home-lock-list">
        ${lock12 ? `<li><span class="home-lock-label">Rounds 1–2</span><span class="home-lock-time">${lock12}</span></li>` : ''}
        ${lock34 ? `<li><span class="home-lock-label">Rounds 3–4</span><span class="home-lock-time">${lock34}</span></li>` : ''}
      </ul>
    `;
  },

  buildHomeLineupPanelHtml(tournament, status, { r12Open, r34Open }) {
    const locksHtml = this.buildHomeLocksHtml(tournament, {
      include12: r12Open,
      include34: r34Open
    });
    return `
      <div class="home-lineup-panel">
        <p class="home-snapshot-label">Lineups</p>
        ${this.buildHomeLineupStatusListHtml(status, { r12Open, r34Open })}
        ${locksHtml}
      </div>
    `;
  },

  renderHomeShell({ title, badge, personal, support, ctaHtml, snapshotHtml, scorecardHtml = '', lineupPanelHtml = '', wide = false }) {
    return `
      <div class="home-dashboard${wide ? ' has-scorecard' : ''}">
        <div class="home-status">
          <h2 class="home-status-title">${title}</h2>
          ${badge ? `<span class="home-status-badge">${badge}</span>` : ''}
        </div>
        ${personal ? `<p class="home-personal">${personal}</p>` : ''}
        ${support ? `<p class="home-support">${support}</p>` : ''}
        ${ctaHtml ? `<div class="home-cta">${ctaHtml}</div>` : ''}
        ${lineupPanelHtml || ''}
        ${scorecardHtml || ''}
        ${snapshotHtml ? `<div class="home-snapshot">${snapshotHtml}</div>` : ''}
      </div>
    `;
  },

  async loadHomeView() {
    const container = document.getElementById('home-dashboard');
    if (!container) return;

    container.innerHTML = '<div class="loading">Loading...</div>';

    try {
      await AccountMerges.loadMerges();
      const phase = this.getHomePhase();
      let badge = this.homePhaseLabel(phase);
      const userId = Auth.currentUser
        ? AccountMerges.getEffectiveUserId(Auth.currentUser.uid)
        : null;
      const season = this.currentSeason;
      const previewing = !!this.getHomePhasePreviewFromUrl();
      const active = (phase === 'lineup_open' || phase === 'in_progress')
        ? (this.activeTournament || this.getHomePreviewTournament(season))
        : this.activeTournament;
      const next = this.getNextTournament(season);

      let title = 'Majors Best Ball';
      let personal = '';
      let support = '';
      let ctaHtml = '';
      let snapshotHtml = '';
      let scorecardHtml = '';
      let lineupPanelHtml = '';
      let wide = false;

      if (phase === 'signed_out') {
        const liveOrNext = active || next;
        title = 'Majors Best Ball';
        personal = 'Pick 4 golfers. Best ball on every hole. Lowest score wins the major.';
        support = liveOrNext
          ? `${liveOrNext.name}${active?.status === 'in_progress' || phase === 'in_progress' ? ' is live' : active?.status === 'lineup_open' || phase === 'lineup_open' ? ' lineups are open' : ' is next'}. Sign in to play.`
          : `${season} season — sign in to join the league.`;
        ctaHtml = `<button type="button" class="btn btn-primary" id="home-sign-in">Sign in with Google</button>`;
        if (liveOrNext) {
          const range = this.formatTournamentDateRange(liveOrNext);
          snapshotHtml = `
            <p class="home-snapshot-label">${active ? 'Current major' : 'Next major'}</p>
            <p class="home-next-major"><strong>${liveOrNext.name}</strong>${range ? ` · ${range}` : ''}</p>
          `;
        }
      } else if (phase === 'lineup_open') {
        if (!active) {
          container.innerHTML = this.renderHomeShell({
            title: 'No tournament to preview',
            badge,
            personal: 'Add a tournament for this season to preview lineup_open.',
            support: previewing ? 'Using ?previewHome=lineup_open' : '',
            ctaHtml: '',
            snapshotHtml: ''
          });
          return;
        }
        title = active.name;
        const status = await this.getHomeLineupStatus(active.id, userId);
        personal = status.r12Ready && status.r34Ready
          ? 'Both lineups are ready — you can still edit until lock.'
          : 'Finish your lineups before they lock.';
        support = previewing ? 'Preview mode.' : '';
        const ctaLabel = status.r12Ready && status.r34Ready ? 'Edit lineup' : 'Submit lineup';
        ctaHtml = `<a href="#lineup" class="btn btn-primary" data-nav="lineup">${ctaLabel}</a>`;
        const locksHtml = this.buildHomeLocksHtml(active);
        snapshotHtml = `
          <p class="home-snapshot-label">Lineups</p>
          ${this.buildHomeLineupStatusListHtml(status)}
          ${locksHtml}
        `;
      } else if (phase === 'in_progress') {
        if (!active) {
          container.innerHTML = this.renderHomeShell({
            title: 'No tournament to preview',
            badge,
            personal: 'Add a tournament for this season to preview in_progress.',
            support: previewing ? 'Using ?previewHome=in_progress' : '',
            ctaHtml: '',
            snapshotHtml: ''
          });
          return;
        }
        title = active.name;
        await this.checkRoundStatus(active.id);
        let r12Open = !this.round1Started;
        let r34Open = !this.round3Started;
        // Preview: force the mid-major hybrid (R1–2 locked, R3–4 still open) for UI testing.
        if (previewing) {
          r12Open = false;
          r34Open = true;
        }
        const lineupsStillOpen = r12Open || r34Open;

        const standings = await this.getHomeTournamentStandings(active.id);
        const you = this.findStandingForUser(standings, userId);
        if (you) {
          const place = you.tied
            ? `T-${this.formatHomeOrdinal(you.position)}`
            : this.formatHomeOrdinal(you.position);
          personal = `You’re ${place} (${Scoring.formatToPar(you.totalToPar)})`;
        } else {
          personal = 'No lineup submitted';
        }

        const lastUpdated = Leaderboard.cachedLastUpdated
          ? Leaderboard.formatLastUpdated(Leaderboard.cachedLastUpdated)
          : '';
        const openNote = lineupsStillOpen
          ? (r34Open && !r12Open
            ? 'Rounds 3–4 lineups still open'
            : r12Open && r34Open
              ? 'Lineups still open'
              : 'Rounds 1–2 lineups still open')
          : '';
        support = [lastUpdated, openNote, previewing ? 'Preview mode' : '']
          .filter(Boolean)
          .join(' · ');

        if (lineupsStillOpen) {
          badge = 'Live · Lineups Open';
          const status = await this.getHomeLineupStatus(active.id, userId);
          const openReady = (!r12Open || status.r12Ready) && (!r34Open || status.r34Ready);
          const lineupCta = openReady ? 'Edit lineup' : (r34Open && !r12Open ? 'Submit R3–4 lineup' : 'Submit lineup');
          ctaHtml = `
            <a href="#lineup" class="btn btn-primary" data-nav="lineup">${lineupCta}</a>
            <a href="#leaderboard" class="btn btn-outline" data-nav="leaderboard" style="margin-left:8px">View Leaderboard</a>
          `;
          lineupPanelHtml = this.buildHomeLineupPanelHtml(active, status, { r12Open, r34Open });
        } else {
          ctaHtml = `<a href="#leaderboard" class="btn btn-primary" data-nav="leaderboard">View Leaderboard</a>`;
        }

        if (you) {
          const roundNumber = Leaderboard.selectedRound || 1;
          scorecardHtml = this.buildHomeLiveScorecardHtml(you, userId, roundNumber);
          wide = true;
        }
        snapshotHtml = `
          <p class="home-snapshot-label">Live top 10</p>
          ${this.buildHomeStandingsSnapshotHtml(standings, userId, { limit: 10, emptyLabel: 'Scores will appear as play continues.' })}
        `;
      } else if (phase === 'between_majors') {
        title = `${season} Season`;
        const { standings } = await this.getHomeSeasonSnapshot(season);
        const previous = this.getPreviousCompletedTournament(season);
        let previousStandings = [];
        if (previous) {
          previousStandings = await this.getHomeTournamentStandings(previous.id);
        }
        const you = this.findStandingForUser(standings, userId);
        if (you) {
          const place = you.tied
            ? `T-${this.formatHomeOrdinal(you.position)}`
            : this.formatHomeOrdinal(you.position);
          personal = `You’re ${place} for the season (${Scoring.formatToPar(you.totalToPar)})`;
        } else {
          personal = 'No season results yet';
        }
        const range = next ? this.formatTournamentDateRange(next) : '';
        support = next
          ? `Next up: ${next.name}${range ? ` · ${range}` : ''}`
          : '';
        ctaHtml = `<button type="button" class="btn btn-primary" id="home-cta-season">View Season Standings</button>`;
        wide = true;
        const previousLabel = previous ? `${previous.name}` : 'Previous major';
        snapshotHtml = `
          <div class="home-dual-standings">
            <div class="home-dual-panel">
              <div class="home-dual-panel-header">
                <p class="home-snapshot-label">Season top 10</p>
                <button type="button" class="home-panel-link" id="home-cta-season-inline">Full season standings</button>
              </div>
              ${this.buildHomeStandingsSnapshotHtml(standings, userId, { limit: 10, emptyLabel: 'Season standings will appear after the first major.' })}
            </div>
            <div class="home-dual-panel">
              <div class="home-dual-panel-header">
                <p class="home-snapshot-label">${previousLabel} top 10</p>
                ${previous
                  ? `<a href="#leaderboard" class="home-panel-link" id="home-prev-major-lb" data-tournament-id="${previous.id}">View leaderboard</a>`
                  : ''}
              </div>
              ${previous
                ? this.buildHomeStandingsSnapshotHtml(previousStandings, userId, { limit: 10, emptyLabel: 'No standings for the previous major.' })
                : '<p class="home-support">No completed major yet this season.</p>'}
            </div>
          </div>
          ${next ? `<p class="home-meta home-next-major" style="margin-top:16px"><strong>${next.name}</strong>${range ? ` · ${range}` : ''}</p>` : ''}
        `;
      } else {
        // season_over
        title = `${season} Season`;
        const { standings } = await this.getHomeSeasonSnapshot(season);
        const champ = standings.find((p) => p.firstPlaceTiebreakWinner) || standings[0] || null;
        const you = this.findStandingForUser(standings, userId);
        if (champ) {
          const champScore = Scoring.formatToPar(champ.totalToPar);
          const tiedForFirst = !!champ.tied && champ.position === 1 && !champ.firstPlaceTiebreakWinner;
          const coLeaders = standings.filter((p) => p.position === 1);
          const champIsYou = you && AccountMerges.isSamePlayer(champ.userId, you.userId);
          const youTiedFirst = you && you.position === 1 && you.tied && !champ.firstPlaceTiebreakWinner;

          if (champ.firstPlaceTiebreakWinner) {
            personal = champIsYou
              ? `You (${champScore}) won the season`
              : `${champ.displayName} (${champScore}) won the season`;
            support = you && !champIsYou
              ? `You finished ${you.tied ? `T-${this.formatHomeOrdinal(you.position)}` : this.formatHomeOrdinal(you.position)} (${Scoring.formatToPar(you.totalToPar)})`
              : 'Season wrap — see full standings and past winners.';
          } else if (tiedForFirst) {
            if (youTiedFirst) {
              personal = `You’re tied for 1st (${champScore})`;
            } else {
              const names = coLeaders.map((p) => p.displayName).filter(Boolean);
              personal = names.length
                ? `${names.join(' & ')} tied for 1st (${champScore})`
                : `Tied for 1st (${champScore})`;
            }
            support = you && !youTiedFirst
              ? `You finished ${you.tied ? `T-${this.formatHomeOrdinal(you.position)}` : this.formatHomeOrdinal(you.position)} (${Scoring.formatToPar(you.totalToPar)})`
              : 'Season wrap — see full standings and past winners.';
          } else if (champIsYou) {
            personal = `You (${champScore}) won the season`;
            support = 'Season wrap — see full standings and past winners.';
          } else {
            personal = `${champ.displayName} (${champScore}) won the season`;
            if (you) {
              const place = you.tied
                ? `T-${this.formatHomeOrdinal(you.position)}`
                : this.formatHomeOrdinal(you.position);
              support = `You finished ${place} (${Scoring.formatToPar(you.totalToPar)})`;
            } else {
              support = 'Season wrap — see full standings and past winners.';
            }
          }
        } else {
          personal = `${season} season is complete`;
          support = 'Check History for previous winners.';
        }
        ctaHtml = `
          <button type="button" class="btn btn-primary" id="home-cta-season">View Season Standings</button>
          <a href="#history" class="btn btn-outline" data-nav="history" style="margin-left:8px">History</a>
        `;
        let winnersTease = '';
        try {
          const cached = await FirestoreCache.getDoc('config', 'historicalWinners', {
            ttlMs: 30 * 60 * 1000
          });
          const winners = cached.exists ? (cached.data.winners || []) : [];
          const seasonWinner = winners.find(
            (w) => String(w.year) === String(season) && w.tournament === 'season'
          );
          if (seasonWinner?.name) {
            winnersTease = `<p class="home-meta">Hall of Fame: ${seasonWinner.name} (${season} season)</p>`;
          }
        } catch (_) { /* ignore */ }
        snapshotHtml = `
          <p class="home-snapshot-label">Final top 10</p>
          ${this.buildHomeStandingsSnapshotHtml(standings, userId, { limit: 10, emptyLabel: 'No season standings available.' })}
          ${winnersTease}
        `;
      }

      container.innerHTML = this.renderHomeShell({
        title,
        badge,
        personal,
        support,
        ctaHtml,
        lineupPanelHtml,
        scorecardHtml,
        snapshotHtml,
        wide
      });
      this.bindHomeDashboardActions(container);
    } catch (error) {
      console.error('Error loading home dashboard:', error);
      container.innerHTML = '<div class="no-data">Could not load home dashboard</div>';
    }
  },

  // Track current lineup state
  currentLineupType: 'rounds_1_2',
  selectedGolfersR12: [],
  selectedGolfersR34: [],
  savedGolfersR12: [],
  savedGolfersR34: [],
  round1Started: false,
  round3Started: false,
  /** Why R1–2 / R3–4 are locked: null | 'schedule' | 'espn' */
  rounds12LockReason: null,
  rounds34LockReason: null,

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

  parseTournamentTimestamp(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  },

  isScheduledLockPassed(ts) {
    const d = this.parseTournamentTimestamp(ts);
    return !!(d && Date.now() >= d.getTime());
  },

  // Check if a round has started by looking for any golfer with scores
  async checkRoundStatus(tournamentId, options = {}) {
    this.rounds12LockReason = null;
    this.rounds34LockReason = null;

    let espnRound1 = false;
    let espnRound3 = false;

    try {
      const scoresDoc = await firebaseDb.collection('scores').doc(tournamentId).get();
      if (scoresDoc.exists) {
        const golferScores = scoresDoc.data().golferScores || {};
        espnRound1 = this.hasRoundStarted(golferScores, 1);
        espnRound3 = this.hasRoundStarted(golferScores, 3);
      }
    } catch (error) {
      console.error('Error checking round status:', error);
    }

    // Prefer active tournament (already loaded); re-fetch when missing lock fields or forced (e.g. on save)
    let tournament = this.activeTournament?.id === tournamentId ? this.activeTournament : null;
    const needsLockFields = options.forceTournament
      || !tournament
      || !('lineupLockAtRounds12' in tournament)
      || !('lineupLockAtRounds34' in tournament);

    if (needsLockFields) {
      try {
        const doc = await firebaseDb.collection('tournaments').doc(tournamentId).get();
        if (doc.exists) {
          const data = doc.data();
          if (this.activeTournament?.id === tournamentId) {
            this.activeTournament = {
              ...this.activeTournament,
              lineupLockAtRounds12: data.lineupLockAtRounds12 ?? null,
              lineupLockAtRounds34: data.lineupLockAtRounds34 ?? null
            };
            tournament = this.activeTournament;
          } else {
            tournament = { id: doc.id, ...data };
          }
        }
      } catch (error) {
        console.warn('Could not load tournament lock schedule:', error);
      }
    }

    const schedule12 = this.isScheduledLockPassed(tournament?.lineupLockAtRounds12);
    const schedule34 = this.isScheduledLockPassed(tournament?.lineupLockAtRounds34);

    if (schedule12) this.rounds12LockReason = 'schedule';
    else if (espnRound1) this.rounds12LockReason = 'espn';

    if (schedule34) this.rounds34LockReason = 'schedule';
    else if (espnRound3) this.rounds34LockReason = 'espn';

    this.round1Started = !!(schedule12 || espnRound1);
    this.round3Started = !!(schedule34 || espnRound3);
  },

  lineupLockBannerMessage(lineupType) {
    const isR12 = lineupType === 'rounds_1_2';
    const reason = isR12 ? this.rounds12LockReason : this.rounds34LockReason;
    const roundLabel = isR12 ? '1' : '3';
    if (reason === 'schedule') {
      return `Lineups for Rounds ${isR12 ? '1–2' : '3–4'} are locked (scheduled lock time has passed). You can still view this lineup.`;
    }
    return `Round ${roundLabel} has started. You can no longer edit this lineup.`;
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

    await AccountMerges.loadMerges();
    const effectiveUserId = AccountMerges.getEffectiveUserId(Auth.currentUser.uid);

    // Load existing lineups (always load, even if locked)
    const lineups = await Lineup.loadUserLineups(
      this.activeTournament.id, 
      effectiveUserId
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
            <p>${this.lineupLockBannerMessage(this.currentLineupType)}</p>
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
          await this.checkRoundStatus(this.activeTournament.id, { forceTournament: true });
          const locked = this.currentLineupType === 'rounds_1_2'
            ? this.round1Started
            : this.round3Started;
          if (locked) {
            throw new Error('This lineup is locked and can no longer be saved.');
          }

          await Lineup.saveLineup(
            this.activeTournament.id,
            AccountMerges.getEffectiveUserId(Auth.currentUser.uid),
            AccountMerges.getDisplayName(Auth.currentUser.uid, Auth.currentUser.displayName || Auth.currentUser.email),
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

    if (this.pendingLeaderboardSeasonView) {
      this.pendingLeaderboardSeasonView = false;
      const tournamentBtn = document.getElementById('btn-tournament-view');
      const seasonBtn = document.getElementById('btn-season-view');
      const tournamentView = document.getElementById('leaderboard-tournament');
      const seasonView = document.getElementById('leaderboard-season');
      if (seasonBtn && tournamentBtn && seasonView && tournamentView) {
        seasonBtn.classList.add('active');
        tournamentBtn.classList.remove('active');
        seasonView.classList.add('active');
        tournamentView.classList.remove('active');
        await Leaderboard.renderSeasonStandings(
          'season-leaderboard-content',
          Auth.currentUser?.uid,
          this.currentSeason
        );
        return;
      }
    }
    
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

      // Seasons from completed tournaments; also load all tournaments for pick-stats years
      let allTournamentsForSeasons = [];
      try {
        const allSnap = await firebaseDb.collection('tournaments').get();
        allTournamentsForSeasons = allSnap.docs.map((doc) => {
          const data = doc.data();
          const startDate = data.startDate?.toDate
            ? data.startDate.toDate()
            : data.startDate?.seconds
              ? new Date(data.startDate.seconds * 1000)
              : null;
          return data.season != null ? Number(data.season) : (startDate ? startDate.getFullYear() : null);
        }).filter((y) => y != null);
      } catch (e) {
        console.warn('Could not load tournaments for season list:', e);
      }

      const seasons = [...new Set([
        ...this.historyTournaments.map(t => {
          const date = t.startDate?.toDate ? t.startDate.toDate() : new Date(t.startDate.seconds * 1000);
          return date.getFullYear();
        }),
        ...allTournamentsForSeasons
      ])].sort((a, b) => b - a);

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
      this.loadGolferPicksStats();
    } catch (error) {
      console.error('Error loading history:', error);
    }
  },

  picksStatsTournaments: null,
  picksStatsSelectedSeason: null,
  /** null = not loaded; true/false from config/golferPickStats */
  golferPickStatsEnabled: null,

  async isGolferPickStatsEnabled() {
    if (this.golferPickStatsEnabled !== null) {
      return this.golferPickStatsEnabled;
    }
    try {
      const cached = await FirestoreCache.getDoc('config', 'golferPickStats', {
        ttlMs: 15 * 60 * 1000
      });
      this.golferPickStatsEnabled = !cached.exists || cached.data.enabled !== false;
    } catch (error) {
      console.warn('Could not load golfer pick stats config:', error);
      this.golferPickStatsEnabled = true;
    }
    return this.golferPickStatsEnabled;
  },

  async fetchTournamentsForPickStats() {
    if (this.picksStatsTournaments) return this.picksStatsTournaments;

    const mapDoc = (doc) => {
      const data = doc.data();
      const startDate = data.startDate?.toDate
        ? data.startDate.toDate()
        : data.startDate?.seconds
          ? new Date(data.startDate.seconds * 1000)
          : data.startDate
            ? new Date(data.startDate)
            : null;
      const season = data.season != null ? Number(data.season) : (startDate ? startDate.getFullYear() : null);
      return { id: doc.id, ...data, season };
    };

    try {
      const snap = await firebaseDb.collection('tournaments').orderBy('startDate', 'asc').get();
      this.picksStatsTournaments = snap.docs.map(mapDoc);
    } catch (tournamentErr) {
      console.warn('Tournaments orderBy failed, loading without sort:', tournamentErr);
      const snap = await firebaseDb.collection('tournaments').get();
      this.picksStatsTournaments = snap.docs.map(mapDoc);
    }

    return this.picksStatsTournaments;
  },

  async loadGolferPicksStats() {
    const section = document.getElementById('golfer-picks-section');
    const body = document.getElementById('golfer-picks-body');
    if (!section || !body || typeof GolferPicksStats === 'undefined') return;

    const enabled = await this.isGolferPickStatsEnabled();
    if (!enabled) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    body.innerHTML = '<div class="loading">Loading pick stats…</div>';

    try {
      const tournaments = await this.fetchTournamentsForPickStats();
      const seasons = GolferPicksStats.availableSeasons(tournaments);

      if (!seasons.length) {
        body.innerHTML = '<p class="no-stat-data">No completed tournaments available for pick statistics yet.</p>';
        return;
      }

      if (!this.picksStatsSelectedSeason || !seasons.includes(this.picksStatsSelectedSeason)) {
        this.picksStatsSelectedSeason = seasons[0];
      }
      await GolferPicksStats.loadDashboard(tournaments, this.picksStatsSelectedSeason);
    } catch (error) {
      console.error('Error loading golfer pick stats:', error);
      const detail = error?.message ? ` (${error.message})` : '';
      body.innerHTML = `<p class="no-stat-data">Could not load pick statistics.${detail}</p>`;
    }
  },

  renderHistoryTournaments() {
    const content = document.getElementById('history-content');
    
    // Filter tournaments by selected season
    const filteredTournaments = this.historyTournaments.filter((t) => {
      const year = this.tournamentDateParts(t.startDate)?.year;
      return year === this.historySelectedSeason;
    });

    if (filteredTournaments.length === 0) {
      content.innerHTML = '<div class="no-data">No completed tournaments for this season</div>';
      return;
    }

    // Build HTML with loading placeholders
    content.innerHTML = `
      <div class="history-list">
        ${filteredTournaments.map((t) => {
          const dateLabel = this.formatTournamentDateRange(t);
          return `
            <div class="history-item" data-id="${t.id}">
              <div class="history-header">
                <div>
                  <h4>${t.name}</h4>
                  ${dateLabel ? `<p class="history-date">${dateLabel}</p>` : ''}
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
    season: 'Season',
    rookie: 'Rookie of the Year'
  },

  hallOfFameTournaments: ['masters', 'pga', 'usopen', 'open', 'season', 'rookie'],

  hallOfFameYears(winners, seasonStats = {}) {
    return [...new Set([
      ...winners.map(w => String(w.year)),
      ...Object.keys(seasonStats)
    ])].sort((a, b) => Number(b) - Number(a));
  },

  formatHallOfFameCount(count, singular, plural) {
    if (count == null || count === '') return null;
    const n = Number(count);
    if (Number.isNaN(n)) return null;
    return `${n} ${n === 1 ? singular : plural}`;
  },

  async loadHallOfFame() {
    const container = document.getElementById('hall-of-fame-content');
    
    try {
      const cached = await FirestoreCache.getDoc('config', 'historicalWinners', {
        ttlMs: 30 * 60 * 1000
      });
      const winners = cached.exists ? (cached.data.winners || []) : [];
      const seasonStats = cached.exists ? (cached.data.seasonStats || {}) : {};
      
      if (winners.length === 0 && Object.keys(seasonStats).length === 0) {
        container.innerHTML = '<div class="no-data">No historical data available yet</div>';
        return;
      }

      const years = this.hallOfFameYears(winners, seasonStats);
      const tournaments = this.hallOfFameTournaments;

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
        const stats = seasonStats[year] || {};
        const playerMeta = this.formatHallOfFameCount(stats.playerCount, 'player', 'players');
        html += `<tr>`;
        html += `<td class="year-col">
          <span class="year-value">${year}</span>
          ${playerMeta ? `<span class="year-meta">${playerMeta}</span>` : ''}
        </td>`;
        
        for (const tournament of tournaments) {
          const winner = winners.find(w => String(w.year) === String(year) && w.tournament === tournament);
          const rookieMeta = tournament === 'rookie'
            ? this.formatHallOfFameCount(stats.rookieCount, 'rookie', 'rookies')
            : null;
          if (winner) {
            html += `
              <td class="winner-cell ${tournament === 'season' ? 'season-champion' : ''} ${tournament === 'rookie' ? 'rookie-winner' : ''}">
                <span class="winner-name">${winner.winner}</span>
                ${winner.score ? `<span class="winner-score">${winner.score}</span>` : ''}
                ${rookieMeta ? `<span class="winner-meta">${rookieMeta}</span>` : ''}
              </td>
            `;
          } else {
            html += `<td class="winner-cell empty">—${rookieMeta ? `<span class="winner-meta">${rookieMeta}</span>` : ''}</td>`;
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
        <div class="history-ideal-lineups" id="history-ideal-${tournamentId}" hidden></div>
      `;

      // Add click handler for expand button
      const expandBtn = container.querySelector('.expand-standings-btn');
      if (expandBtn) {
        expandBtn.addEventListener('click', () => this.toggleHistoryStandings(tournamentId));
      }

      this.loadHistoryIdealLineups(tournamentId);
    } catch (error) {
      console.error(`Error loading standings for ${tournamentId}:`, error);
      const container = document.getElementById(`history-standings-${tournamentId}`);
      if (container) {
        container.innerHTML = '<div class="no-standings">Error loading standings</div>';
      }
    }
  },

  async loadHistoryIdealLineups(tournamentId) {
    const el = document.getElementById(`history-ideal-${tournamentId}`);
    if (!el || typeof IdealLineup === 'undefined') return;
    try {
      const ideal = await IdealLineup.load(tournamentId);
      const hasLineups = ideal?.rounds?.some((r) => IdealLineup.getRoundLineups(r).length > 0);
      if (!hasLineups) {
        el.innerHTML = '';
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.innerHTML = IdealLineup.renderSectionHtml(ideal);
      IdealLineup.bindCarousel(el);
    } catch (error) {
      console.warn('Ideal lineups load failed:', error);
      el.innerHTML = '';
      el.hidden = true;
    }
  },

  renderHistoryStandingRow(player) {
    const formatScore = (score) => {
      if (score === null || score === undefined || score === '-') return '-';
      if (score === 0) return 'E';
      return score > 0 ? `+${score}` : score;
    };
    
    const positionDisplay = player.tied ? `T${player.position}` : player.position;
    const trClass = Number(player.position) === 1 ? ' class="history-first-place"' : '';

    return `
      <tr${trClass}>
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
    // SiteAnalytics is started from Auth.init (before user-doc / admin lookups).
    // Re-subscribe to chat now that user is authenticated
    if (typeof Chat !== 'undefined') {
      Chat.subscribeToMessages();
    }
    // Refresh current view
    this.onViewLoad(this.currentView);
  },

  onUserSignedOut() {
    console.log('User signed out');
    // SiteAnalytics is stopped from Auth.init when auth becomes null.
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
