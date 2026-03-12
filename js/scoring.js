// ESPN Scoring Module
const Scoring = {
  ESPN_API_URL: 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard',
  HOLE_COUNT: 18,
  updateInterval: null,

  async fetchScoreboard() {
    try {
      const response = await fetch(this.ESPN_API_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Failed to fetch ESPN scoreboard:', error);
      return null;
    }
  },

  findEvent(scoreboard, eventName) {
    const events = scoreboard?.events || [];
    if (!events.length) return null;
    if (!eventName) return events[0];

    const normalizedSearch = this.normalizeEventName(eventName);
    const match = events.find(e => 
      this.normalizeEventName(e.name || e.shortName || '').includes(normalizedSearch)
    );
    return match || events[0];
  },

  normalizeEventName(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  normalizeName(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  // Check if the tournament/round has progressed past a certain point
  // Returns true if ANY golfer has started playing the specified round
  hasAnyGolferStartedRound(golferScores, roundNum) {
    const roundIndex = roundNum - 1;
    for (const golfer of Object.values(golferScores)) {
      if (!golfer?.rounds?.[roundIndex]?.holes) continue;
      if (golfer.rounds[roundIndex].holes.some(h => h && h.toPar !== null)) {
        return true;
      }
    }
    return false;
  },

  // Check if a golfer is considered "withdrawn" for a specific round
  // A golfer is considered withdrawn if:
  // 1. They have partial scores in this round (started but didn't finish 18 holes)
  // 2. AND the tournament has moved on (other golfers are playing a later round)
  // Note: If a golfer WDs in Round 1, they don't play Rounds 2-4
  isGolferWithdrawnForRound(golferScores, golferName, roundNum) {
    const normalized = this.normalizeName(golferName);
    const golfer = golferScores[normalized];
    if (!golfer || !golfer.rounds) return false;

    const roundIndex = roundNum - 1;
    const round = golfer.rounds[roundIndex];
    
    // Count completed holes in this round
    const holesCompleted = round?.holes 
      ? round.holes.filter(h => h && h.toPar !== null && h.toPar !== undefined).length 
      : 0;
    
    // If they completed all 18 holes, they're not withdrawn from this round
    if (holesCompleted === 18) return false;
    
    // If they have 0 holes in this round, check if they were already withdrawn from a previous round
    if (holesCompleted === 0) {
      // Check if this golfer withdrew in an earlier round
      // (had partial scores in an earlier round)
      for (let i = 0; i < roundIndex; i++) {
        const earlierRound = golfer.rounds?.[i];
        if (!earlierRound?.holes) continue;
        const earlierHoles = earlierRound.holes.filter(h => h && h.toPar !== null).length;
        // If they started an earlier round but didn't finish it, they're WD
        if (earlierHoles > 0 && earlierHoles < 18) {
          return true;
        }
      }
      // Never started this round - not considered withdrawn FROM this round
      // (might not have made the cut, or tournament hasn't reached this round)
      return false;
    }

    // They have partial scores (1-17 holes) in this round
    // Check if the tournament has moved on to a later round
    for (let laterRound = roundNum + 1; laterRound <= 4; laterRound++) {
      if (this.hasAnyGolferStartedRound(golferScores, laterRound)) {
        // Tournament has moved to a later round, this golfer didn't finish = withdrawn
        return true;
      }
    }

    // Tournament hasn't moved on yet - golfer might still be playing
    // Check if their round is marked as complete (individually)
    if (round?.isComplete && holesCompleted < 18) {
      return true;
    }

    return false;
  },

  // Check if a golfer is "active" for a round (has started and not withdrawn)
  isGolferActiveForRound(golferScores, golferName, roundNum) {
    const normalized = this.normalizeName(golferName);
    const golfer = golferScores[normalized];
    if (!golfer || !golfer.rounds) return false;

    const roundIndex = roundNum - 1;
    const round = golfer.rounds[roundIndex];
    
    // Must have at least one hole score to be considered active
    if (!round?.holes) return false;
    const hasAnyScore = round.holes.some(h => h && h.toPar !== null && h.toPar !== undefined);
    
    return hasAnyScore;
  },

  normalizeRelToPar(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    if (s.toUpperCase() === 'E') return 0;
    const cleaned = s.replace(/^\+/, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  },

  computePars(competitors) {
    const pars = Array(this.HOLE_COUNT).fill(null);

    for (const c of competitors) {
      const rounds = Array.isArray(c.linescores) ? c.linescores : [];
      for (const r of rounds) {
        const holes = r?.linescores || [];
        for (const h of holes) {
          const holeNo = Number(h.period);
          if (!(holeNo >= 1 && holeNo <= this.HOLE_COUNT)) continue;
          if (pars[holeNo - 1] !== null) continue;

          const strokes = Number(h.value);
          const toPar = this.normalizeRelToPar(h?.scoreType?.displayValue);
          if (!Number.isFinite(strokes) || strokes <= 0) continue;
          if (toPar === null) continue;

          const par = Math.round(strokes - toPar);
          if (par >= 3 && par <= 5) {
            pars[holeNo - 1] = par;
          }
        }
        if (pars.every(p => p !== null)) return pars;
      }
    }

    return pars;
  },

  parseGolferScores(competitors) {
    const golferScores = {};

    competitors.forEach(c => {
      const name = c?.athlete?.displayName || c?.athlete?.fullName || '';
      if (!name) return;
      
      const normalizedName = this.normalizeName(name);
      const rounds = Array.isArray(c.linescores) ? c.linescores : [];

      golferScores[normalizedName] = {
        displayName: name,
        rounds: rounds.map((roundObj, roundIndex) => {
          const holeObjs = roundObj?.linescores || [];
          const holes = Array(this.HOLE_COUNT).fill(null);
          
          holeObjs.forEach(h => {
            const holeNo = Number(h.period);
            if (holeNo >= 1 && holeNo <= this.HOLE_COUNT) {
              holes[holeNo - 1] = {
                strokes: Number(h.value) || null,
                toPar: this.normalizeRelToPar(h?.scoreType?.displayValue)
              };
            }
          });

          const totalStrokes = Number(roundObj?.value) || null;
          const totalToPar = this.normalizeRelToPar(roundObj?.displayValue);
          const isComplete = holeObjs.filter(h => 
            Number(h.period) >= 1 && Number(h.period) <= 18 && Number(h.value) > 0
          ).length === 18;

          return {
            roundNumber: roundIndex + 1,
            holes,
            totalStrokes,
            totalToPar,
            isComplete
          };
        })
      };
    });

    return golferScores;
  },

  calculateBestBall(userGolfers, golferScores, roundNumber) {
    const roundIndex = roundNumber - 1;
    const bestBallHoles = Array(this.HOLE_COUNT).fill(null);
    let roundComplete = false;

    // Handle empty or missing golferScores
    if (!golferScores || Object.keys(golferScores).length === 0) {
      return {
        holes: bestBallHoles,
        totalToPar: 0,
        holesPlayed: 0,
        isComplete: false
      };
    }

    userGolfers.forEach(golferName => {
      const normalized = this.normalizeName(golferName);
      const golfer = golferScores[normalized];
      if (!golfer || !golfer.rounds || !golfer.rounds[roundIndex]) return;

      const round = golfer.rounds[roundIndex];
      if (round.isComplete) roundComplete = true;

      if (round.holes) {
        round.holes.forEach((hole, holeIndex) => {
          if (!hole || hole.toPar === null || hole.toPar === undefined) return;
          
          if (bestBallHoles[holeIndex] === null || hole.toPar < bestBallHoles[holeIndex]) {
            bestBallHoles[holeIndex] = hole.toPar;
          }
        });
      }
    });

    const totalToPar = bestBallHoles.reduce((sum, h) => {
      return sum + (h !== null ? h : 0);
    }, 0);

    const holesPlayed = bestBallHoles.filter(h => h !== null).length;

    return {
      holes: bestBallHoles,
      totalToPar,
      holesPlayed,
      isComplete: roundComplete && holesPlayed === 18
    };
  },

  calculateTotalBestBall(userGolfers, golferScores) {
    const rounds = [1, 2, 3, 4].map(roundNum => 
      this.calculateBestBall(userGolfers, golferScores, roundNum)
    );

    const totalToPar = rounds.reduce((sum, r) => sum + r.totalToPar, 0);
    const totalHolesPlayed = rounds.reduce((sum, r) => sum + r.holesPlayed, 0);
    const completedRounds = rounds.filter(r => r.isComplete).length;

    return {
      rounds,
      totalToPar,
      totalHolesPlayed,
      completedRounds
    };
  },

  calculateTotalBestBallSplit(golfersRounds12, golfersRounds34, golferScores) {
    const rounds = [1, 2, 3, 4].map(roundNum => {
      const golfers = roundNum <= 2 ? golfersRounds12 : golfersRounds34;
      return this.calculateBestBall(golfers, golferScores, roundNum);
    });

    const totalToPar = rounds.reduce((sum, r) => sum + r.totalToPar, 0);
    const totalHolesPlayed = rounds.reduce((sum, r) => sum + r.holesPlayed, 0);
    const completedRounds = rounds.filter(r => r.isComplete).length;

    return {
      rounds,
      totalToPar,
      totalHolesPlayed,
      completedRounds
    };
  },

  calculateTotalBestBallByRound(golfersPerRound, golferScores) {
    const rounds = [1, 2, 3, 4].map(roundNum => {
      const golfers = golfersPerRound[roundNum - 1] || [];
      return this.calculateBestBall(golfers, golferScores, roundNum);
    });

    const totalToPar = rounds.reduce((sum, r) => sum + r.totalToPar, 0);
    const totalHolesPlayed = rounds.reduce((sum, r) => sum + r.holesPlayed, 0);
    const completedRounds = rounds.filter(r => r.isComplete).length;

    return {
      rounds,
      totalToPar,
      totalHolesPlayed,
      completedRounds
    };
  },

  formatToPar(toPar) {
    if (toPar === null || toPar === undefined) return '-';
    if (toPar === 0) return 'E';
    return toPar > 0 ? `+${toPar}` : String(toPar);
  },

  async updateScores(tournamentId, espnEventName) {
    const scoreboard = await this.fetchScoreboard();
    if (!scoreboard) return null;

    const event = this.findEvent(scoreboard, espnEventName);
    if (!event) return null;

    const competitors = event?.competitions?.[0]?.competitors || [];
    const pars = this.computePars(competitors);
    const golferScores = this.parseGolferScores(competitors);

    // Store in Firestore
    await firebaseDb.collection('scores').doc(tournamentId).set({
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
      eventName: event.name || event.shortName,
      eventStatus: event.status?.type?.description || 'Unknown',
      pars,
      golferScores
    }, { merge: true });

    // Check for eagles and send alerts to chat
    if (typeof Chat !== 'undefined' && Chat.checkForEagles) {
      try {
        const lineups = await Lineup.getAllLineups(tournamentId);
        await Chat.checkForEagles(tournamentId, golferScores, lineups);
      } catch (error) {
        console.error('Error checking for eagles:', error);
      }
    }

    return { pars, golferScores, event };
  },

  startAutoUpdate(tournamentId, espnEventName, intervalMinutes = 10) {
    this.stopAutoUpdate();
    
    // Initial update
    this.updateScores(tournamentId, espnEventName);
    
    // Set interval
    this.updateInterval = setInterval(() => {
      this.updateScores(tournamentId, espnEventName);
    }, intervalMinutes * 60 * 1000);

    console.log(`Auto-update started: every ${intervalMinutes} minutes`);
  },

  stopAutoUpdate() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      console.log('Auto-update stopped');
    }
  }
};
