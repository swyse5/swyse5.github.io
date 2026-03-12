// Lineup Management Module
// Supports 2 lineups per tournament: "rounds_1_2" (rounds 1-2) and "rounds_3_4" (rounds 3-4)
const Lineup = {
  // Format salary to always show 2 decimal places
  formatSalary(value) {
    return Number(value).toFixed(2);
  },
  currentTournament: null,
  golferField: [],
  selectedGolfers: [],
  salaryCap: 100,

  // Lineup types
  LINEUP_TYPES: {
    ROUNDS_1_2: 'rounds_1_2',
    ROUNDS_3_4: 'rounds_3_4'
  },

  async loadTournament(tournamentId) {
    try {
      const doc = await firebaseDb.collection('tournaments').doc(tournamentId).get();
      if (!doc.exists) {
        console.error('Tournament not found');
        return null;
      }

      this.currentTournament = { id: doc.id, ...doc.data() };
      this.golferField = this.currentTournament.golferField || [];
      this.salaryCap = this.currentTournament.salaryCap || 100;
      
      // Sort by salary descending
      this.golferField.sort((a, b) => b.salary - a.salary);
      
      return this.currentTournament;
    } catch (error) {
      console.error('Error loading tournament:', error);
      return null;
    }
  },

  async loadUserLineup(tournamentId, userId, lineupType = null) {
    try {
      let query = firebaseDb.collection('lineups')
        .where('tournamentId', '==', tournamentId)
        .where('userId', '==', userId);
      
      if (lineupType) {
        query = query.where('lineupType', '==', lineupType);
      }
      
      const snapshot = await query.limit(1).get();

      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        return { id: doc.id, ...doc.data() };
      }
      return null;
    } catch (error) {
      console.error('Error loading lineup:', error);
      return null;
    }
  },

  async loadUserLineups(tournamentId, userId) {
    try {
      const snapshot = await firebaseDb.collection('lineups')
        .where('tournamentId', '==', tournamentId)
        .where('userId', '==', userId)
        .get();

      const lineups = {
        rounds_1_2: null,
        rounds_3_4: null
      };

      snapshot.docs.forEach(doc => {
        const data = { id: doc.id, ...doc.data() };
        const type = data.lineupType || 'rounds_1_2';
        lineups[type] = data;
      });

      return lineups;
    } catch (error) {
      console.error('Error loading lineups:', error);
      return { rounds_1_2: null, rounds_3_4: null };
    }
  },

  async saveLineup(tournamentId, userId, userDisplayName, golfers, lineupType = 'rounds_1_2') {
    if (!Auth.requireAuth()) return null;

    // Validate
    if (golfers.length !== 4) {
      throw new Error('You must select exactly 4 golfers');
    }

    const totalSalary = this.calculateTotalSalary(golfers);
    if (totalSalary > this.salaryCap) {
      throw new Error(`Lineup exceeds salary cap ($${this.formatSalary(totalSalary)} > $${this.formatSalary(this.salaryCap)})`);
    }

    // Check for existing lineup of this type
    const existing = await this.loadUserLineup(tournamentId, userId, lineupType);

    const lineupData = {
      tournamentId,
      userId,
      userDisplayName,
      golfers,
      totalSalary,
      lineupType,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (existing) {
      await firebaseDb.collection('lineups').doc(existing.id).update(lineupData);
      return existing.id;
    } else {
      lineupData.submittedAt = firebase.firestore.FieldValue.serverTimestamp();
      const docRef = await firebaseDb.collection('lineups').add(lineupData);
      return docRef.id;
    }
  },

  calculateTotalSalary(golferNames) {
    return golferNames.reduce((total, name) => {
      const golfer = this.golferField.find(g => g.name === name);
      return total + (golfer?.salary || 0);
    }, 0);
  },

  getGolferSalary(name) {
    const golfer = this.golferField.find(g => g.name === name);
    return golfer?.salary || 0;
  },

  getRemainingBudget(selectedGolfers) {
    const used = this.calculateTotalSalary(selectedGolfers);
    return this.salaryCap - used;
  },

  canAfford(golferName, currentSelections) {
    const golferSalary = this.getGolferSalary(golferName);
    const currentTotal = this.calculateTotalSalary(currentSelections);
    return (currentTotal + golferSalary) <= this.salaryCap;
  },

  async getAllLineups(tournamentId) {
    try {
      const snapshot = await firebaseDb.collection('lineups')
        .where('tournamentId', '==', tournamentId)
        .get();

      // Group lineups by user
      const userLineups = new Map();
      
      snapshot.docs.forEach(doc => {
        const data = { id: doc.id, ...doc.data() };
        const userId = data.userId;
        const lineupType = data.lineupType || 'rounds_1_2';
        
        if (!userLineups.has(userId)) {
          userLineups.set(userId, {
            userId,
            userDisplayName: data.userDisplayName,
            rounds_1_2: null,
            rounds_3_4: null,
            round_1: null,
            round_2: null,
            round_3: null,
            round_4: null
          });
        }
        
        userLineups.get(userId)[lineupType] = data;
      });

      // Convert to array and extract golfers for each round
      // Individual round lineups take priority over group lineups
      return Array.from(userLineups.values()).map(user => {
        // Get golfers for each individual round (individual round overrides group lineup)
        const golfersR1 = user.round_1?.golfers || user.rounds_1_2?.golfers || [];
        const golfersR2 = user.round_2?.golfers || user.rounds_1_2?.golfers || [];
        const golfersR3 = user.round_3?.golfers || user.rounds_3_4?.golfers || [];
        const golfersR4 = user.round_4?.golfers || user.rounds_3_4?.golfers || [];
        
        // Group-level golfers for display
        const golfersRounds12 = user.rounds_1_2?.golfers || [];
        const golfersRounds34 = user.rounds_3_4?.golfers || [];
        
        return {
          userId: user.userId,
          userDisplayName: user.userDisplayName,
          // Per-round golfers (with fallback logic applied)
          golfersRound1: golfersR1,
          golfersRound2: golfersR2,
          golfersRound3: golfersR3,
          golfersRound4: golfersR4,
          // Group-level golfers (raw, without individual overrides)
          golfersRounds12: golfersRounds12,
          golfersRounds34: golfersRounds34,
          golfers: golfersRounds12,
          lineup1: user.rounds_1_2,
          lineup2: user.rounds_3_4,
          // Individual round lineup objects
          lineupRound1: user.round_1,
          lineupRound2: user.round_2,
          lineupRound3: user.round_3,
          lineupRound4: user.round_4,
          // Flags for existence checks
          hasLineup1: user.rounds_1_2 !== null,
          hasLineup2: user.rounds_3_4 !== null,
          hasIndividualRound1: user.round_1 !== null,
          hasIndividualRound2: user.round_2 !== null,
          hasIndividualRound3: user.round_3 !== null,
          hasIndividualRound4: user.round_4 !== null
        };
      });
    } catch (error) {
      console.error('Error loading lineups:', error);
      return [];
    }
  },

  renderGolferSelector(containerId, onSelect) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    this.golferField.forEach(golfer => {
      const item = document.createElement('div');
      item.className = 'golfer-item';
      item.dataset.name = golfer.name;
      item.dataset.salary = golfer.salary;
      
      item.innerHTML = `
        <span class="golfer-name">${golfer.name}</span>
        <span class="golfer-salary">$${this.formatSalary(golfer.salary)}</span>
      `;

      item.addEventListener('click', () => onSelect(golfer));
      container.appendChild(item);
    });
  },

  renderSelectedGolfers(containerId, selectedGolfers, onRemove) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    for (let i = 0; i < 4; i++) {
      const slot = document.createElement('div');
      slot.className = 'golfer-slot';

      if (selectedGolfers[i]) {
        const golfer = selectedGolfers[i];
        const salary = this.getGolferSalary(golfer);
        slot.classList.add('filled');
        
        // Only show remove button if onRemove callback is provided (not locked)
        const removeButton = onRemove ? `<button class="remove-btn" data-index="${i}">&times;</button>` : '';
        slot.innerHTML = `
          <span class="slot-number">${i + 1}</span>
          <span class="golfer-name">${golfer}</span>
          <span class="golfer-salary">$${this.formatSalary(salary)}</span>
          ${removeButton}
        `;
        if (onRemove) {
          slot.querySelector('.remove-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            onRemove(i);
          });
        }
      } else {
        slot.innerHTML = `
          <span class="slot-number">${i + 1}</span>
          <span class="slot-empty">Select a golfer</span>
        `;
      }

      container.appendChild(slot);
    }

    // Update budget display
    this.updateBudgetDisplay(selectedGolfers);
  },

  updateBudgetDisplay(selectedGolfers) {
    const used = this.calculateTotalSalary(selectedGolfers);
    const remaining = this.salaryCap - used;
    const picksRemaining = 4 - selectedGolfers.length;
    const avgPerPick = picksRemaining > 0 ? (remaining / picksRemaining).toFixed(2) : 0;

    const elements = {
      salaryCap: document.getElementById('salary-cap-display'),
      totalUsed: document.getElementById('total-used'),
      totalRemaining: document.getElementById('total-remaining'),
      avgPerPick: document.getElementById('avg-per-pick'),
      budgetProgress: document.getElementById('budget-progress'),
      budgetWarning: document.getElementById('budget-warning')
    };

    if (elements.salaryCap) elements.salaryCap.textContent = this.formatSalary(this.salaryCap);
    if (elements.totalUsed) elements.totalUsed.textContent = this.formatSalary(used);
    if (elements.totalRemaining) elements.totalRemaining.textContent = this.formatSalary(remaining);
    if (elements.avgPerPick) elements.avgPerPick.textContent = this.formatSalary(avgPerPick);

    if (elements.budgetProgress) {
      const percentage = (used / this.salaryCap) * 100;
      elements.budgetProgress.style.width = `${Math.min(percentage, 100)}%`;
      elements.budgetProgress.className = 'progress-bar';
      if (percentage > 100) {
        elements.budgetProgress.classList.add('bg-danger');
      } else if (percentage > 80) {
        elements.budgetProgress.classList.add('bg-warning');
      } else {
        elements.budgetProgress.classList.add('bg-success');
      }
    }

    if (elements.budgetWarning) {
      elements.budgetWarning.style.display = remaining < 0 ? 'block' : 'none';
    }
  }
};
