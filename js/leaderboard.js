// Leaderboard Module
const Leaderboard = {
  currentTournamentId: null,
  unsubscribeScores: null,
  unsubscribeLineups: null,
  cachedGolferScores: {},
  cachedPars: null,
  cachedLastUpdated: null,
  cachedGolferField: [],
  round1Started: false,
  round3Started: false,

  // Look up a golfer's salary from the cached golfer field
  getGolferSalary(golferName) {
    if (!this.cachedGolferField || !this.cachedGolferField.length) return null;
    const golfer = this.cachedGolferField.find(g => 
      g.name.toLowerCase() === golferName.toLowerCase()
    );
    return golfer ? golfer.salary : null;
  },

  formatSalary(salary) {
    if (salary === null || salary === undefined) return '';
    return `$${salary.toFixed(2)}`;
  },

  formatLastUpdated(timestamp) {
    if (!timestamp) return '';
    
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    
    // Format in user's local timezone
    const options = {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    };
    
    return `Last updated: ${date.toLocaleString(undefined, options)}`;
  },

  updateLastUpdatedDisplay(elementId) {
    const element = document.getElementById(elementId);
    if (element && this.cachedLastUpdated) {
      element.textContent = this.formatLastUpdated(this.cachedLastUpdated);
    } else if (element) {
      element.textContent = 'Scores not yet updated';
    }
  },

  // Check if a round has started by looking for any golfer with scores in that round
  checkRoundStarted(golferScores, roundNumber) {
    const roundIndex = roundNumber - 1;
    for (const golferName in golferScores) {
      const golfer = golferScores[golferName];
      if (golfer?.rounds?.[roundIndex]) {
        const round = golfer.rounds[roundIndex];
        // Check if any holes have been played
        if (round.holes && round.holes.some(h => h && h.toPar !== null)) {
          return true;
        }
      }
    }
    return false;
  },

  async calculateStandings(tournamentId) {
    // Get all lineups
    const lineups = await Lineup.getAllLineups(tournamentId);
    if (!lineups.length) return [];

    await AccountMerges.loadMerges();

    // Get current scores (may not exist if tournament hasn't started)
    const scoresDoc = await firebaseDb.collection('scores').doc(tournamentId).get();
    const scoresData = scoresDoc.exists ? scoresDoc.data() : {};
    const golferScores = scoresData.golferScores || {};
    const pars = scoresData.pars || null;
    
    // Get tournament golfer field for salary info
    const tournamentDoc = await firebaseDb.collection('tournaments').doc(tournamentId).get();
    const golferField = tournamentDoc.exists ? (tournamentDoc.data().golferField || []) : [];
    
    // Cache for use in expanded views
    this.cachedGolferScores = golferScores;
    this.cachedPars = pars;
    this.cachedLastUpdated = scoresData.lastUpdated || null;
    this.cachedGolferField = golferField;
    
    // Determine which rounds have started (for hiding lineups until rounds begin)
    this.round1Started = this.checkRoundStarted(golferScores, 1);
    this.round3Started = this.checkRoundStarted(golferScores, 3);

    // Calculate best ball for each player
    let standings = lineups.map(lineup => {
      // Get per-round golfer lineups (with individual round overrides applied)
      const golfersR1 = lineup.golfersRound1 || [];
      const golfersR2 = lineup.golfersRound2 || [];
      const golfersR3 = lineup.golfersRound3 || [];
      const golfersR4 = lineup.golfersRound4 || [];
      
      // Keep group-level references for backwards compatibility
      const golfersR12 = lineup.golfersRounds12 || [];
      const golfersR34 = lineup.golfersRounds34 || [];
      const hasLineup1 = lineup.hasLineup1 || golfersR12.length > 0;
      const hasLineup2 = lineup.hasLineup2 || golfersR34.length > 0;
      const hasSplitLineup = hasLineup1 || hasLineup2;
      
      // Use per-round calculation for scoring (individual overrides already applied in getAllLineups)
      const golfersPerRound = [golfersR1, golfersR2, golfersR3, golfersR4];
      const bestBall = Scoring.calculateTotalBestBallByRound(golfersPerRound, golferScores);
      
      // Get individual golfer round totals for display
      // Combine golfers from all rounds for display
      const allGolfers = [...new Set([...golfersR1, ...golfersR2, ...golfersR3, ...golfersR4])];
      const golferDetails = allGolfers.map(golferName => {
        const normalized = Scoring.normalizeName(golferName);
        const golfer = golferScores[normalized];
        
        // Check which rounds this golfer is active in
        const isActiveInRound = [
          golfersR1.includes(golferName),
          golfersR2.includes(golferName),
          golfersR3.includes(golferName),
          golfersR4.includes(golferName)
        ];
        
        // Determine active rounds label
        let activeRounds = 'all';
        const activeRoundNums = isActiveInRound.map((active, i) => active ? i + 1 : null).filter(r => r !== null);
        if (activeRoundNums.length < 4) {
          activeRounds = activeRoundNums.join(', ');
        }
        
        return {
          name: golferName,
          activeRounds,
          isActiveInRound,
          rounds: [1, 2, 3, 4].map(roundNum => {
            if (!golfer || !golfer.rounds || !golfer.rounds[roundNum - 1]) {
              return { toPar: null, holesPlayed: 0, active: isActiveInRound[roundNum - 1] };
            }
            const round = golfer.rounds[roundNum - 1];
            const holesPlayed = round.holes ? round.holes.filter(h => h && h.toPar !== null).length : 0;
            return {
              toPar: round.totalToPar,
              holesPlayed,
              isComplete: round.isComplete,
              active: isActiveInRound[roundNum - 1]
            };
          }),
          totalToPar: golfer ? golfer.rounds?.reduce((sum, r) => sum + (r?.totalToPar || 0), 0) : null
        };
      });
      
      // Calculate total holes remaining for all golfers in lineup
      // Be smart about withdrawals - don't count holes for past rounds or withdrawn golfers
      // Also don't count holes for rounds where the player didn't submit a lineup
      let holesRemaining = 0;
      
      // Find the current active round (latest round where any golfer has started)
      let currentActiveRound = 0;
      for (let r = 4; r >= 1; r--) {
        if (Scoring.hasAnyGolferStartedRound(golferScores, r)) {
          currentActiveRound = r;
          break;
        }
      }
      
      // Track which rounds have a submitted lineup
      const hasLineupForRound = [
        hasLineup1, // R1
        hasLineup1, // R2
        hasLineup2, // R3
        hasLineup2  // R4
      ];
      
      golfersPerRound.forEach((roundGolfers, roundIndex) => {
        const roundNum = roundIndex + 1;
        
        // Skip rounds where no lineup was submitted
        if (!hasLineupForRound[roundIndex] || roundGolfers.length === 0) {
          return;
        }
        
        roundGolfers.forEach(golferName => {
          const normalized = Scoring.normalizeName(golferName);
          const golfer = golferScores[normalized];
          const round = golfer?.rounds?.[roundIndex];
          
          // Check if golfer is withdrawn for this round
          const isWithdrawn = Scoring.isGolferWithdrawnForRound(golferScores, golferName, roundNum);
          
          if (isWithdrawn) {
            // Withdrawn golfers don't have remaining holes
            holesRemaining += 0;
          } else if (roundNum < currentActiveRound) {
            // Past rounds: if golfer didn't complete, they won't (assume round is done)
            holesRemaining += 0;
          } else if (!round || !round.holes) {
            // No data for this round yet
            if (roundNum > currentActiveRound || currentActiveRound === 0) {
              // Future round or tournament hasn't started - count as 18 remaining
              holesRemaining += 18;
            } else {
              // Current round but no data - might not have teed off yet
              holesRemaining += 18;
            }
          } else if (round.isComplete) {
            // Round complete, 0 holes remaining
            holesRemaining += 0;
          } else {
            // Active round - count unplayed holes
            const holesPlayed = round.holes.filter(h => h && h.toPar !== null).length;
            holesRemaining += (18 - holesPlayed);
          }
        });
      });
      
      // Calculate real-time eagles and bogeys for this player
      const { eagles, bogeys } = this.calculateRealTimeEaglesAndBogeys(
        golfersPerRound,
        golferScores
      );
      
      return {
        userId: AccountMerges.resolveUserId(lineup.userId),
        displayName: AccountMerges.getDisplayName(lineup.userId, lineup.userDisplayName) || lineup.userDisplayName,
        golfers: lineup.golfers,
        golfersRounds12: golfersR12,
        golfersRounds34: golfersR34,
        golfersRound1: golfersR1,
        golfersRound2: golfersR2,
        golfersRound3: golfersR3,
        golfersRound4: golfersR4,
        hasLineup1,
        hasLineup2,
        hasIndividualRound1: lineup.hasIndividualRound1,
        hasIndividualRound2: lineup.hasIndividualRound2,
        hasIndividualRound3: lineup.hasIndividualRound3,
        hasIndividualRound4: lineup.hasIndividualRound4,
        hasSplitLineup,
        golferDetails,
        rounds: bestBall.rounds.map((r, i) => ({
          roundNumber: i + 1,
          toPar: r.totalToPar,
          holesPlayed: r.holesPlayed,
          isComplete: r.isComplete
        })),
        totalToPar: bestBall.totalToPar,
        totalHolesPlayed: bestBall.totalHolesPlayed,
        completedRounds: bestBall.completedRounds,
        holesRemaining: holesRemaining,
        eagles: eagles,
        bogeys: bogeys
      };
    });

    standings = AccountMerges.consolidateStandings(standings);

    // Sort by total to par (lowest first)
    standings.sort((a, b) => a.totalToPar - b.totalToPar);

    // Assign positions (handle ties)
    let position = 1;
    standings.forEach((player, index) => {
      if (index > 0 && player.totalToPar === standings[index - 1].totalToPar) {
        player.position = standings[index - 1].position;
        player.tied = true;
        standings[index - 1].tied = true;
      } else {
        player.position = position;
        player.tied = false;
      }
      position++;
    });

    const tournamentStatus = tournamentDoc.exists ? (tournamentDoc.data().status || '') : '';
    this.applyLeaderboardRoundDefaultsIfNeeded(tournamentId, tournamentStatus, scoresData, golferScores);

    return standings;
  },

  // Calculate real-time eagles and bogeys for a player
  // Eagles: best ball score of -2 or better (counted immediately when any golfer achieves it)
  // Bogeys: best ball score of +1 or worse (counted when ALL non-withdrawn golfers have finished the hole)
  // Golfers who haven't started still block bogey counting (they might still play)
  // Only withdrawn golfers are excluded from blocking
  calculateRealTimeEaglesAndBogeys(golfersPerRound, golferScores) {
    let eagles = 0;
    let bogeys = 0;
    
    // Process all 4 rounds
    for (let roundNum = 1; roundNum <= 4; roundNum++) {
      const roundIndex = roundNum - 1;
      const golfers = golfersPerRound[roundIndex] || [];
      
      if (golfers.length === 0) continue;
      
      // Get withdrawn golfers - these are excluded from bogey blocking
      const withdrawnGolfers = golfers.filter(golferName => 
        Scoring.isGolferWithdrawnForRound(golferScores, golferName, roundNum)
      );
      
      // Relevant golfers = all lineup golfers MINUS withdrawn ones
      // This includes golfers who haven't started yet (they still block bogey counting)
      const relevantGolfers = golfers.filter(golferName => 
        !Scoring.isGolferWithdrawnForRound(golferScores, golferName, roundNum)
      );
      
      // If all golfers withdrew, skip this round
      if (relevantGolfers.length === 0) continue;
      
      // Check each hole
      for (let holeNum = 1; holeNum <= 18; holeNum++) {
        const holeIndex = holeNum - 1;
        let bestScore = null;
        let allRelevantGolfersCompletedHole = true;
        let anyGolferHasScore = false;
        
        // Check all golfers in lineup for best score
        golfers.forEach(golferName => {
          const normalized = Scoring.normalizeName(golferName);
          const golfer = golferScores[normalized];
          const hole = golfer?.rounds?.[roundIndex]?.holes?.[holeIndex];
          
          if (hole && hole.toPar !== null && hole.toPar !== undefined) {
            anyGolferHasScore = true;
            if (bestScore === null || hole.toPar < bestScore) {
              bestScore = hole.toPar;
            }
          }
        });
        
        // Check if all RELEVANT (non-withdrawn) golfers have completed this hole
        // This includes golfers who haven't started - they block bogey counting
        relevantGolfers.forEach(golferName => {
          const normalized = Scoring.normalizeName(golferName);
          const golfer = golferScores[normalized];
          const hole = golfer?.rounds?.[roundIndex]?.holes?.[holeIndex];
          
          if (!hole || hole.toPar === null || hole.toPar === undefined) {
            allRelevantGolfersCompletedHole = false;
          }
        });
        
        // Count eagles immediately when best ball is -2 or better
        if (anyGolferHasScore && bestScore !== null && bestScore <= -2) {
          eagles++;
        }
        
        // Count bogeys ONLY when ALL non-withdrawn golfers have completed the hole
        // Golfers who haven't started yet will block this (they might still play and get a better score)
        if (allRelevantGolfersCompletedHole && bestScore !== null && bestScore >= 1) {
          bogeys++;
        }
      }
    }
    
    return { eagles, bogeys };
  },

  // Current selected round for detailed view
  selectedRound: 1,
  // Field tab: round selector (independent from expanded standings row)
  fieldSelectedRound: 1,
  // Apply default round selection once per tournament load (not on every live refresh)
  roundDefaultsAppliedForTournamentId: null,

  computeDefaultLeaderboardRound(tournamentStatus, scoresData, golferScores) {
    if (tournamentStatus === 'completed') return 4;
    const fromEspn = Number(scoresData?.espnCompetitionPeriod);
    if (Number.isFinite(fromEspn)) {
      const r = Math.round(fromEspn);
      if (r >= 1 && r <= 4) return r;
    }
    for (let r = 4; r >= 1; r--) {
      if (Scoring.hasAnyGolferStartedRound(golferScores, r)) return r;
    }
    return 1;
  },

  applyLeaderboardRoundDefaultsIfNeeded(tournamentId, tournamentStatus, scoresData, golferScores) {
    if (this.roundDefaultsAppliedForTournamentId === tournamentId) return;
    this.roundDefaultsAppliedForTournamentId = tournamentId;
    const r = this.computeDefaultLeaderboardRound(tournamentStatus, scoresData, golferScores);
    this.selectedRound = r;
    this.fieldSelectedRound = r;
  },
  // null = sort by golfer name; 0–17 = sort by that hole’s toPar
  fieldSortHoleIndex: null,
  fieldSortAsc: true,
  currentStandings: [],

  getGolfersForRoundFromStandings(player, roundNumber) {
    const roundKey = `golfersRound${roundNumber}`;
    const isRounds12 = roundNumber <= 2;
    const golfers = player[roundKey] || (isRounds12 ? player.golfersRounds12 : player.golfersRounds34) || [];
    const hasIndividualRound = player[`hasIndividualRound${roundNumber}`];
    const hasGroupLineup = isRounds12 ? player.hasLineup1 : player.hasLineup2;
    const hasLineup = golfers.length > 0 && (hasIndividualRound || hasGroupLineup);
    return hasLineup ? golfers : [];
  },

  buildFieldPickCounts(standings, roundNumber) {
    const pickCounts = new Map();
    for (const player of standings) {
      const golfers = this.getGolfersForRoundFromStandings(player, roundNumber);
      for (const g of golfers) {
        pickCounts.set(g, (pickCounts.get(g) || 0) + 1);
      }
    }
    return pickCounts;
  },

  renderFieldView(containerId, tournamentId, currentUserId, standings) {
    const container = document.getElementById(containerId);
    if (!container) return;

    this.currentStandings = standings;

    const roundNum = this.fieldSelectedRound;
    const isRounds12 = roundNum <= 2;
    const roundStarted = isRounds12 ? this.round1Started : this.round3Started;
    const roundLabel = isRounds12 ? 'Rounds 1-2' : 'Rounds 3-4';

    const roundSelectorHtml = `
      <div class="round-selector">
        <span class="round-selector-label">Round:</span>
        <div class="round-buttons">
          ${[1, 2, 3, 4].map(r => `
            <button type="button" class="round-btn field-round-btn ${this.fieldSelectedRound === r ? 'active' : ''}" data-round="${r}">R${r}</button>
          `).join('')}
        </div>
      </div>`;

    let bodyHtml = '';

    if (!standings.length) {
      bodyHtml = '<div class="no-data">No lineups submitted yet</div>';
    } else if (!roundStarted) {
      bodyHtml = `
        <div class="lineup-hidden-message field-round-body">
          <p><strong>Field hidden</strong></p>
          <p>The full field and pick counts for ${roundLabel} appear once Round ${isRounds12 ? '1' : '3'} begins. Use the round buttons above to view another round.</p>
        </div>`;
    } else {
      const pickCounts = this.buildFieldPickCounts(standings, roundNum);
      const golferNames = [...pickCounts.keys()].sort((a, b) => a.localeCompare(b));

      if (golferNames.length === 0) {
        bodyHtml = `
          <div class="no-data field-round-body">
            <p><strong>No golfers in the field for Round ${roundNum}</strong></p>
            <p style="font-size: 14px; margin-top: 8px;">No lineups are active for this round yet.</p>
          </div>`;
      } else {
        const pars = this.cachedPars || Array(18).fill(null);
        const roundIndex = roundNum - 1;

        const getHoleToPar = (hole) => {
          if (!hole || hole.toPar === null || hole.toPar === undefined) return null;
          return hole.toPar;
        };

        const golferHoleData = golferNames.map(name => {
          const normalized = Scoring.normalizeName(name);
          const golfer = this.cachedGolferScores[normalized];
          const roundData = golfer?.rounds?.[roundIndex];
          return {
            name,
            holes: roundData?.holes || Array(18).fill(null),
            totalToPar: roundData?.totalToPar ?? null,
            pickCount: pickCounts.get(name) || 0
          };
        });

        const loneLowGolferByHole = Array(18).fill(null);
        for (let hi = 0; hi < 18; hi++) {
          const scored = golferHoleData
            .map(g => ({ name: g.name, toPar: getHoleToPar(g.holes[hi]) }))
            .filter(x => x.toPar !== null);
          if (scored.length === 0) continue;
          const minToPar = Math.min(...scored.map(x => x.toPar));
          const atMin = scored.filter(x => x.toPar === minToPar);
          if (atMin.length === 1) loneLowGolferByHole[hi] = atMin[0].name;
        }

        const sortedGolfers = [...golferHoleData];
        if (this.fieldSortHoleIndex !== null && this.fieldSortHoleIndex >= 0 && this.fieldSortHoleIndex < 18) {
          const hi = this.fieldSortHoleIndex;
          sortedGolfers.sort((a, b) => {
            const aPar = getHoleToPar(a.holes[hi]);
            const bPar = getHoleToPar(b.holes[hi]);
            if (aPar === null && bPar === null) return a.name.localeCompare(b.name);
            if (aPar === null) return 1;
            if (bPar === null) return -1;
            let cmp = aPar - bPar;
            if (!this.fieldSortAsc) cmp = -cmp;
            if (cmp !== 0) return cmp;
            return a.name.localeCompare(b.name);
          });
        } else {
          sortedGolfers.sort((a, b) => {
            const cmp = a.name.localeCompare(b.name);
            return this.fieldSortAsc ? cmp : -cmp;
          });
        }

        const hasAnyScores = golferHoleData.some(g => g.holes.some(h => getHoleToPar(h) !== null));

        const nameSortActive = this.fieldSortHoleIndex === null;
        const nameDir = nameSortActive ? (this.fieldSortAsc ? 'sorted-asc' : 'sorted-desc') : '';
        const nameAriaSort = nameSortActive
          ? (this.fieldSortAsc ? ' aria-sort="ascending"' : ' aria-sort="descending"')
          : '';

        bodyHtml = `
      <div class="field-scorecard-wrap field-round-body">
        <div class="hole-by-hole-container">
          ${!hasAnyScores ? `
            <div class="no-scores-message">
              <p>Scores will appear once Round ${roundNum} begins.</p>
            </div>
          ` : ''}
          <div class="scorecard-scroll">
            <table class="hole-scorecard field-hole-scorecard">
              <thead>
                <tr>
                  <th class="golfer-col field-golfer-sort ${nameDir}" scope="col" title="Sort A–Z; click again for Z–A" tabindex="0"${nameAriaSort}>Golfer</th>
                  ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((h, i) => {
                    const active = this.fieldSortHoleIndex === i;
                    const dir = active ? (this.fieldSortAsc ? 'sorted-asc' : 'sorted-desc') : '';
                    const ariaSort = active
                      ? (this.fieldSortAsc ? ' aria-sort="ascending"' : ' aria-sort="descending"')
                      : '';
                    return `<th class="hole-col field-hole-sort ${dir}" data-hole-index="${i}" scope="col" title="Sort by hole ${h} (best scores first)" tabindex="0"${ariaSort}>${h}</th>`;
                  }).join('')}
                  ${[10, 11, 12, 13, 14, 15, 16, 17, 18].map((h, i) => {
                    const idx = i + 9;
                    const active = this.fieldSortHoleIndex === idx;
                    const dir = active ? (this.fieldSortAsc ? 'sorted-asc' : 'sorted-desc') : '';
                    const ariaSort = active
                      ? (this.fieldSortAsc ? ' aria-sort="ascending"' : ' aria-sort="descending"')
                      : '';
                    return `<th class="hole-col field-hole-sort ${dir}" data-hole-index="${idx}" scope="col" title="Sort by hole ${h} (best scores first)" tabindex="0"${ariaSort}>${h}</th>`;
                  }).join('')}
                  <th class="total-col" scope="col">Tot</th>
                </tr>
              </thead>
              <tbody>
                <tr class="par-row">
                  <td class="golfer-col">Par</td>
                  ${pars.slice(0, 9).map(p => `<td class="hole-col">${p || '-'}</td>`).join('')}
                  ${pars.slice(9, 18).map(p => `<td class="hole-col">${p || '-'}</td>`).join('')}
                  <td class="total-col">${pars.reduce((s, p) => s + (p || 0), 0) || '-'}</td>
                </tr>
                ${sortedGolfers.map((g) => {
                  const gFront = g.holes.slice(0, 9);
                  const gBack = g.holes.slice(9, 18);
                  const salary = this.getGolferSalary(g.name);
                  const salaryDisplay = salary ? ` <span class="golfer-salary">(${this.formatSalary(salary)})</span>` : '';
                  const pickLabel = g.pickCount === 1 ? '1 pick' : `${g.pickCount} picks`;
                  return `
                <tr class="golfer-row">
                  <td class="golfer-col">${g.name}${salaryDisplay} <span class="field-pick-count">${pickLabel}</span></td>
                  ${gFront.map((h, i) => {
                    const toPar = getHoleToPar(h);
                    const loneLow = loneLowGolferByHole[i] === g.name;
                    const loneClass = loneLow ? ' field-lone-low' : '';
                    return `<td class="hole-col ${this.getScoreClass(toPar)}${loneClass}">${toPar !== null ? Scoring.formatToPar(toPar) : '-'}</td>`;
                  }).join('')}
                  ${gBack.map((h, i) => {
                    const toPar = getHoleToPar(h);
                    const holeIdx = i + 9;
                    const loneLow = loneLowGolferByHole[holeIdx] === g.name;
                    const loneClass = loneLow ? ' field-lone-low' : '';
                    return `<td class="hole-col ${this.getScoreClass(toPar)}${loneClass}">${toPar !== null ? Scoring.formatToPar(toPar) : '-'}</td>`;
                  }).join('')}
                  <td class="total-col ${this.getScoreClass(g.totalToPar)}">${g.totalToPar !== null ? Scoring.formatToPar(g.totalToPar) : '-'}</td>
                </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
      }
    }

    container.innerHTML = roundSelectorHtml + bodyHtml;

    container.querySelectorAll('.field-round-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.fieldSelectedRound = parseInt(btn.dataset.round, 10);
        this.fieldSortHoleIndex = null;
        this.fieldSortAsc = true;
        this.renderFieldView(containerId, tournamentId, currentUserId, this.currentStandings);
      });
    });

    const activateHoleSort = (hi) => {
      if (this.fieldSortHoleIndex === hi) {
        this.fieldSortAsc = !this.fieldSortAsc;
      } else {
        this.fieldSortHoleIndex = hi;
        this.fieldSortAsc = true;
      }
      this.renderFieldView(containerId, tournamentId, currentUserId, this.currentStandings);
    };

    const activateGolferSort = () => {
      if (this.fieldSortHoleIndex === null) {
        this.fieldSortAsc = !this.fieldSortAsc;
      } else {
        this.fieldSortHoleIndex = null;
        this.fieldSortAsc = true;
      }
      this.renderFieldView(containerId, tournamentId, currentUserId, this.currentStandings);
    };

    container.querySelectorAll('th.field-hole-sort').forEach(th => {
      th.addEventListener('click', (e) => {
        e.stopPropagation();
        const hi = parseInt(th.dataset.holeIndex, 10);
        if (Number.isNaN(hi)) return;
        activateHoleSort(hi);
      });
      th.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        const hi = parseInt(th.dataset.holeIndex, 10);
        if (Number.isNaN(hi)) return;
        activateHoleSort(hi);
      });
    });

    const golferSortTh = container.querySelector('th.field-golfer-sort');
    if (golferSortTh) {
      golferSortTh.addEventListener('click', (e) => {
        e.stopPropagation();
        activateGolferSort();
      });
      golferSortTh.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        activateGolferSort();
      });
    }
  },
  
  // Sorting state
  sortColumn: 'pos',
  sortDirection: 'asc',

  sortStandings(standings, column, direction) {
    const sorted = [...standings];
    
    sorted.sort((a, b) => {
      let valA, valB;
      
      switch (column) {
        case 'pos':
        case 'total':
          valA = a.totalToPar;
          valB = b.totalToPar;
          break;
        case 'player':
          valA = a.displayName.toLowerCase();
          valB = b.displayName.toLowerCase();
          break;
        case 'r1':
          valA = a.rounds[0]?.toPar ?? 999;
          valB = b.rounds[0]?.toPar ?? 999;
          break;
        case 'r2':
          valA = a.rounds[1]?.toPar ?? 999;
          valB = b.rounds[1]?.toPar ?? 999;
          break;
        case 'r3':
          valA = a.rounds[2]?.toPar ?? 999;
          valB = b.rounds[2]?.toPar ?? 999;
          break;
        case 'r4':
          valA = a.rounds[3]?.toPar ?? 999;
          valB = b.rounds[3]?.toPar ?? 999;
          break;
        default:
          valA = a.totalToPar;
          valB = b.totalToPar;
      }
      
      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
    });
    
    return sorted;
  },

  renderLeaderboard(containerId, standings, currentUserId = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    this.currentStandings = standings;

    if (!standings.length) {
      container.innerHTML = '<div class="no-data">No lineups submitted yet</div>';
      return;
    }

    // Check if any scores exist
    const hasScores = standings.some(s => s.totalHolesPlayed > 0);
    
    let html = '';
    if (!hasScores) {
      html = `
        <div class="no-data" style="margin-bottom: 20px;">
          <p><strong>Tournament has not started yet</strong></p>
          <p style="font-size: 14px; margin-top: 8px;">Scores will appear once play begins.</p>
        </div>
      `;
    }

    // Round selector
    html += `
      <div class="round-selector">
        <span class="round-selector-label">Round:</span>
        <div class="round-buttons">
          ${[1, 2, 3, 4].map(r => `
            <button class="round-btn ${this.selectedRound === r ? 'active' : ''}" data-round="${r}">R${r}</button>
          `).join('')}
        </div>
      </div>
    `;

    // Sort standings
    const sortedStandings = this.sortStandings(standings, this.sortColumn, this.sortDirection);

    html += `
      <table class="leaderboard-table">
        <thead>
          <tr>
            <th class="pos sortable" data-sort="pos">Pos</th>
            <th class="player sortable" data-sort="player">Player</th>
            <th class="round sortable" data-sort="r1">R1</th>
            <th class="round sortable" data-sort="r2">R2</th>
            <th class="round sortable" data-sort="r3">R3</th>
            <th class="round sortable" data-sort="r4">R4</th>
            <th class="total sortable" data-sort="total">Total</th>
          </tr>
        </thead>
        <tbody>
          ${sortedStandings.map(player => this.renderLeaderboardRow(player, currentUserId)).join('')}
        </tbody>
      </table>
    `;

    container.innerHTML = html;

    // Add round selector handlers
    container.querySelectorAll('.round-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedRound = parseInt(btn.dataset.round);
        container.querySelectorAll('.round-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Re-render expanded details if any are open
        container.querySelectorAll('.golfer-details.show').forEach(details => {
          const odUserId = details.previousElementSibling?.dataset?.userId;
          if (odUserId) {
            const player = this.currentStandings.find(p => p.userId === odUserId);
            if (player) {
              details.querySelector('td').innerHTML = this.renderHoleByHoleDetails(player, this.selectedRound, currentUserId);
            }
          }
        });
      });
    });

    // Add click handlers for expandable rows
    container.querySelectorAll('.leaderboard-row').forEach(row => {
      row.addEventListener('click', () => {
        row.classList.toggle('expanded');
        const details = row.nextElementSibling;
        if (details?.classList.contains('golfer-details')) {
          details.classList.toggle('show');
          // Re-render the details with current round when expanding
          if (details.classList.contains('show')) {
            const odUserId = row.dataset.userId;
            const player = this.currentStandings.find(p => p.userId === odUserId);
            if (player) {
              details.querySelector('td').innerHTML = this.renderHoleByHoleDetails(player, this.selectedRound, currentUserId);
            }
          }
        }
      });
    });

    // Add click handlers for sortable headers
    container.querySelectorAll('.sortable').forEach(th => {
      th.addEventListener('click', (e) => {
        e.stopPropagation();
        const column = th.dataset.sort;
        
        // Toggle direction if same column, otherwise default to asc (or desc for scores)
        if (this.sortColumn === column) {
          this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortColumn = column;
          // Default to ascending for player name, descending for remaining, ascending for scores
          this.sortDirection = column === 'player' ? 'asc' : column === 'remaining' ? 'desc' : 'asc';
        }
        
        // Re-render with new sort
        this.renderLeaderboard(containerId, this.currentStandings, currentUserId);
      });
    });
  },

  renderLeaderboardRow(player, currentUserId) {
    const isCurrentUser = AccountMerges.isSamePlayer(player.userId, currentUserId);
    const positionDisplay = player.tied ? `T${player.position}` : player.position;

    return `
      <tr class="leaderboard-row ${isCurrentUser ? 'current-user' : ''}" data-user-id="${player.userId}">
        <td class="pos">${positionDisplay}</td>
        <td class="player">
          <span class="player-name">${player.displayName}</span>
          <i class="expand-icon">▼</i>
        </td>
        <td class="round ${this.getScoreClass(player.rounds[0]?.toPar)}">${this.formatRoundScore(player.rounds[0])}</td>
        <td class="round ${this.getScoreClass(player.rounds[1]?.toPar)}">${this.formatRoundScore(player.rounds[1])}</td>
        <td class="round ${this.getScoreClass(player.rounds[2]?.toPar)}">${this.formatRoundScore(player.rounds[2])}</td>
        <td class="round ${this.getScoreClass(player.rounds[3]?.toPar)}">${this.formatRoundScore(player.rounds[3])}</td>
        <td class="total ${this.getScoreClass(player.totalToPar)}">${Scoring.formatToPar(player.totalToPar)}</td>
      </tr>
      <tr class="golfer-details">
        <td colspan="7">
          ${this.renderHoleByHoleDetails(player, this.selectedRound, currentUserId)}
        </td>
      </tr>
    `;
  },

  renderHoleByHoleDetails(player, roundNumber, currentUserId = null) {
    const roundIndex = roundNumber - 1;
    const isRounds12 = roundNumber <= 2;
    
    // Use individual round lineup if available, otherwise fall back to group lineup
    const roundKey = `golfersRound${roundNumber}`;
    const golfers = player[roundKey] || (isRounds12 ? player.golfersRounds12 : player.golfersRounds34) || [];
    
    // Check for lineup existence - individual round or group
    const hasIndividualRound = player[`hasIndividualRound${roundNumber}`];
    const hasGroupLineup = isRounds12 ? player.hasLineup1 : player.hasLineup2;
    const hasLineup = golfers.length > 0 && (hasIndividualRound || hasGroupLineup);
    
    const pars = this.cachedPars || Array(18).fill(null);
    
    // Check if this is the current user viewing their own lineup
    const isOwnLineup = AccountMerges.isSamePlayer(player.userId, currentUserId);
    
    // Check if the round has started (lineups become visible once round begins)
    const roundStarted = isRounds12 ? this.round1Started : this.round3Started;
    const roundLabel = isRounds12 ? 'Rounds 1-2' : 'Rounds 3-4';
    
    // Hide other users' lineups until the round has started
    if (!isOwnLineup && !roundStarted) {
      return `
        <div class="hole-by-hole-container">
          <h4 class="round-title">Round ${roundNumber}</h4>
          <div class="lineup-hidden-message">
            <p><strong>Lineup Hidden</strong></p>
            <p>This player's ${roundLabel} lineup will be revealed once Round ${isRounds12 ? '1' : '3'} begins.</p>
          </div>
        </div>
      `;
    }

    // Handle case where no lineup submitted for this round
    if (!golfers.length || !hasLineup) {
      return `
        <div class="hole-by-hole-container">
          <h4 class="round-title">Round ${roundNumber}</h4>
          <div class="no-lineup-message">
            <p><strong>No lineup submitted for Round ${roundNumber}</strong></p>
            <p>This player has not yet submitted a lineup for this round.</p>
          </div>
        </div>
      `;
    }

    // Get hole-by-hole data for each golfer
    const golferHoleData = golfers.map(golferName => {
      const normalized = Scoring.normalizeName(golferName);
      const golfer = this.cachedGolferScores[normalized];
      const roundData = golfer?.rounds?.[roundIndex];
      return {
        name: golferName,
        holes: roundData?.holes || Array(18).fill(null),
        totalToPar: roundData?.totalToPar ?? null,
        isComplete: roundData?.isComplete || false
      };
    });

    // Helper to safely get toPar from hole
    const getHoleToPar = (hole) => {
      if (!hole || hole.toPar === null || hole.toPar === undefined) return null;
      return hole.toPar;
    };

    // Calculate best ball for this round
    const bestBallHoles = Array(18).fill(null);
    golferHoleData.forEach(g => {
      g.holes.forEach((hole, i) => {
        const toPar = getHoleToPar(hole);
        if (toPar !== null) {
          if (bestBallHoles[i] === null || toPar < bestBallHoles[i]) {
            bestBallHoles[i] = toPar;
          }
        }
      });
    });

    const frontNine = bestBallHoles.slice(0, 9);
    const backNine = bestBallHoles.slice(9, 18);
    const frontPars = pars.slice(0, 9);
    const backPars = pars.slice(9, 18);

    // Check if any scores exist
    const hasAnyScores = golferHoleData.some(g => g.holes.some(h => getHoleToPar(h) !== null));

    return `
      <div class="hole-by-hole-container">
        ${!hasAnyScores ? `
          <div class="no-scores-message">
            <p>Scores will appear once Round ${roundNumber} begins.</p>
          </div>
        ` : ''}
        <div class="scorecard-scroll">
          <table class="hole-scorecard">
            <thead>
              <tr>
                <th class="golfer-col"></th>
                ${[1,2,3,4,5,6,7,8,9].map(h => `<th>${h}</th>`).join('')}
                ${[10,11,12,13,14,15,16,17,18].map(h => `<th>${h}</th>`).join('')}
                <th class="total-col">Tot</th>
              </tr>
            </thead>
            <tbody>
              <tr class="par-row">
                <td>Par</td>
                ${frontPars.map(p => `<td>${p || '-'}</td>`).join('')}
                ${backPars.map(p => `<td>${p || '-'}</td>`).join('')}
                <td class="total-col">${pars.reduce((s, p) => s + (p || 0), 0) || '-'}</td>
              </tr>
              ${golferHoleData.map(g => {
                const gFront = g.holes.slice(0, 9);
                const gBack = g.holes.slice(9, 18);
                const salary = this.getGolferSalary(g.name);
                const salaryDisplay = salary ? ` <span class="golfer-salary">(${this.formatSalary(salary)})</span>` : '';
                return `
                <tr class="golfer-row">
                  <td class="golfer-col">${g.name}${salaryDisplay}</td>
                  ${gFront.map((h, i) => {
                    const toPar = getHoleToPar(h);
                    const isBest = toPar !== null && toPar === bestBallHoles[i];
                    return `<td class="${this.getScoreClass(toPar)} ${isBest ? 'best-score' : ''}">${toPar !== null ? Scoring.formatToPar(toPar) : '-'}</td>`;
                  }).join('')}
                  ${gBack.map((h, i) => {
                    const toPar = getHoleToPar(h);
                    const isBest = toPar !== null && toPar === bestBallHoles[i + 9];
                    return `<td class="${this.getScoreClass(toPar)} ${isBest ? 'best-score' : ''}">${toPar !== null ? Scoring.formatToPar(toPar) : '-'}</td>`;
                  }).join('')}
                  <td class="total-col ${this.getScoreClass(g.totalToPar)}">${g.totalToPar !== null ? Scoring.formatToPar(g.totalToPar) : '-'}</td>
                </tr>`;
              }).join('')}
              <tr class="best-ball-row">
                <td class="golfer-col"><strong>Best Ball</strong></td>
                ${frontNine.map(h => `<td class="${this.getScoreClass(h)}"><strong>${h !== null ? Scoring.formatToPar(h) : '-'}</strong></td>`).join('')}
                ${backNine.map(h => `<td class="${this.getScoreClass(h)}"><strong>${h !== null ? Scoring.formatToPar(h) : '-'}</strong></td>`).join('')}
                <td class="total-col ${this.getScoreClass(player.rounds?.[roundIndex]?.toPar)}"><strong>${this.formatRoundScore(player.rounds?.[roundIndex])}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  formatGolferRoundScore(round) {
    if (!round || round.toPar === null || round.toPar === undefined) return '-';
    if (round.holesPlayed > 0) return Scoring.formatToPar(round.toPar);
    return '-';
  },

  formatRoundScore(round) {
    if (!round || round.holesPlayed === 0) return '-';
    return Scoring.formatToPar(round.toPar);
  },

  getScoreClass(toPar) {
    if (toPar === null || toPar === undefined) return '';
    if (toPar < 0) return 'under-par';
    if (toPar > 0) return 'over-par';
    return 'even-par';
  },

  startLiveUpdates(tournamentId, containerId) {
    this.currentTournamentId = tournamentId;
    this.stopLiveUpdates();

    const refreshTournamentViews = async () => {
      const standings = await this.calculateStandings(tournamentId);
      const sub = typeof App !== 'undefined' ? App.leaderboardTournamentSubview : 'standings';
      if (sub === 'field') {
        this.renderFieldView('leaderboard-field-content', tournamentId, Auth.currentUser?.uid, standings);
      } else {
        this.renderLeaderboard(containerId, standings, Auth.currentUser?.uid);
      }
      this.updateLastUpdatedDisplay('leaderboard-last-updated');
    };

    // Listen for score updates
    this.unsubscribeScores = firebaseDb.collection('scores').doc(tournamentId)
      .onSnapshot(() => refreshTournamentViews());

    // Listen for lineup changes
    this.unsubscribeLineups = firebaseDb.collection('lineups')
      .where('tournamentId', '==', tournamentId)
      .onSnapshot(() => refreshTournamentViews());
  },

  stopLiveUpdates() {
    if (this.unsubscribeScores) {
      this.unsubscribeScores();
      this.unsubscribeScores = null;
    }
    if (this.unsubscribeLineups) {
      this.unsubscribeLineups();
      this.unsubscribeLineups = null;
    }
  },

  async renderPlayerScorecard(containerId, userId, tournamentId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Load both lineups
    const lineups = await Lineup.loadUserLineups(tournamentId, userId);
    const lineup1 = lineups.rounds_1_2;
    const lineup2 = lineups.rounds_3_4;
    
    if (!lineup1 && !lineup2) {
      container.innerHTML = '<div class="no-data">No lineup found</div>';
      return;
    }

    const golfersR12 = lineup1?.golfers || [];
    const golfersR34 = lineup2?.golfers || [];
    const hasLineup1 = lineup1 !== null && lineup1 !== undefined && golfersR12.length > 0;
    const hasLineup2 = lineup2 !== null && lineup2 !== undefined && golfersR34.length > 0;

    const scoresDoc = await firebaseDb.collection('scores').doc(tournamentId).get();
    const scoresData = scoresDoc.exists ? scoresDoc.data() : {};
    const golferScores = scoresData.golferScores || {};
    const pars = scoresData.pars || null;
    
    // Cache the last updated timestamp for display
    this.cachedLastUpdated = scoresData.lastUpdated || null;
    
    // Check if there are any scores yet
    const hasScores = Object.keys(golferScores).length > 0;
    
    // Calculate best ball using split lineups (only for rounds with lineups)
    const bestBall = hasLineup1 && hasLineup2
      ? Scoring.calculateTotalBestBallSplit(golfersR12, golfersR34, golferScores)
      : Scoring.calculateTotalBestBall(golfersR12, golferScores);
    
    if (!hasScores) {
      container.innerHTML = `
        <div class="scorecard">
          <h3>Your Lineups</h3>
          <div class="lineup-display">
            <div class="lineup-section">
              <h4>Rounds 1-2</h4>
              <div class="golfers-picked">
                ${hasLineup1 ? golfersR12.map(g => `<span class="golfer-chip">${g}</span>`).join('') : '<span class="no-lineup">No lineup submitted</span>'}
              </div>
            </div>
            <div class="lineup-section">
              <h4>Rounds 3-4</h4>
              <div class="golfers-picked">
                ${hasLineup2 ? golfersR34.map(g => `<span class="golfer-chip">${g}</span>`).join('') : '<span class="no-lineup">No lineup submitted</span>'}
              </div>
            </div>
          </div>
          <div class="no-data">
            <p>Scores will appear here once the tournament begins.</p>
            <p style="color: var(--text-secondary); font-size: 14px; margin-top: 8px;">
              Live scoring updates automatically every 10 minutes during the tournament.
            </p>
          </div>
        </div>
      `;
      return;
    }

    const html = `
      <div class="scorecard">
        <h3>Your Scorecard</h3>
        ${bestBall.rounds.map((round, i) => {
          const roundNumber = i + 1;
          const isRounds12 = roundNumber <= 2;
          const golfers = isRounds12 ? golfersR12 : golfersR34;
          const hasLineupForRound = isRounds12 ? hasLineup1 : hasLineup2;
          return this.renderRoundScorecard(round, roundNumber, pars, golfers, golferScores, hasLineup1, hasLineup2, hasLineupForRound);
        }).join('')}
        <div class="scorecard-total">
          <strong>Tournament Total:</strong> 
          <span class="${this.getScoreClass(bestBall.totalToPar)}">${Scoring.formatToPar(bestBall.totalToPar)}</span>
        </div>
      </div>
    `;

    container.innerHTML = html;
  },

  renderRoundScorecard(round, roundNumber, pars, golferNames, golferScores, hasLineup1 = true, hasLineup2 = true, hasLineupForRound = true) {
    const isRounds12 = roundNumber <= 2;
    const roundLabel = isRounds12 ? 'Rounds 1-2' : 'Rounds 3-4';
    
    // Show lineup badge to indicate which lineup is being used
    const lineupBadge = `<span class="lineup-badge ${isRounds12 ? 'r12' : 'r34'}">${isRounds12 ? 'R1-2 Lineup' : 'R3-4 Lineup'}</span>`;
    
    // If no lineup submitted for this round, show a message
    if (!hasLineupForRound) {
      return `
        <div class="round-scorecard">
          <div class="round-header">
            <h4>Round ${roundNumber}</h4>
            ${lineupBadge}
          </div>
          <div class="no-lineup-message">
            <p><strong>No lineup submitted for ${roundLabel}</strong></p>
            <p>Submit a lineup for ${roundLabel} to see scores for this round.</p>
          </div>
        </div>
      `;
    }

    const holes = round.holes;
    const frontNine = holes.slice(0, 9);
    const backNine = holes.slice(9, 18);
    const frontPars = pars ? pars.slice(0, 9) : Array(9).fill(null);
    const backPars = pars ? pars.slice(9, 18) : Array(9).fill(null);

    return `
      <div class="round-scorecard">
        <div class="round-header">
          <h4>Round ${roundNumber} ${round.isComplete ? '(Complete)' : ''}</h4>
          ${lineupBadge}
        </div>
        <div class="round-golfers">
          ${(golferNames || []).map(g => `<span class="golfer-chip small">${g}</span>`).join('')}
        </div>
        <table class="scorecard-table">
          <thead>
            <tr>
              <th>Hole</th>
              ${[1,2,3,4,5,6,7,8,9].map(h => `<th>${h}</th>`).join('')}
              <th>Out</th>
              ${[10,11,12,13,14,15,16,17,18].map(h => `<th>${h}</th>`).join('')}
              <th>In</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr class="par-row">
              <td>Par</td>
              ${frontPars.map(p => `<td>${p || '-'}</td>`).join('')}
              <td>${frontPars.reduce((s, p) => s + (p || 0), 0) || '-'}</td>
              ${backPars.map(p => `<td>${p || '-'}</td>`).join('')}
              <td>${backPars.reduce((s, p) => s + (p || 0), 0) || '-'}</td>
              <td>${pars ? pars.reduce((s, p) => s + (p || 0), 0) : '-'}</td>
            </tr>
            <tr class="best-ball-row">
              <td>Best Ball</td>
              ${frontNine.map(h => `<td class="${this.getScoreClass(h)}">${h !== null ? Scoring.formatToPar(h) : '-'}</td>`).join('')}
              <td class="${this.getScoreClass(frontNine.reduce((s, h) => s + (h || 0), 0))}">${Scoring.formatToPar(frontNine.reduce((s, h) => s + (h || 0), 0))}</td>
              ${backNine.map(h => `<td class="${this.getScoreClass(h)}">${h !== null ? Scoring.formatToPar(h) : '-'}</td>`).join('')}
              <td class="${this.getScoreClass(backNine.reduce((s, h) => s + (h || 0), 0))}">${Scoring.formatToPar(backNine.reduce((s, h) => s + (h || 0), 0))}</td>
              <td class="${this.getScoreClass(round.totalToPar)}">${Scoring.formatToPar(round.totalToPar)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  },

  // Season Standings Methods
  async calculateSeasonStandings(season = null) {
    await AccountMerges.loadMerges();

    // Get all tournaments
    const tournamentsSnap = await firebaseDb.collection('tournaments')
      .orderBy('startDate', 'asc')
      .get();
    
    const tournaments = [];
    const tournamentAbbrevs = {
      'Masters': 'MAS',
      'PGA Championship': 'PGA',
      'U.S. Open': 'USO',
      'US Open': 'USO',
      'The Open': 'BRI',
      'British Open': 'BRI',
      'Open Championship': 'BRI'
    };

    tournamentsSnap.forEach(doc => {
      const data = doc.data();
      
      // Filter by status (active tournaments: lineup_open, in_progress, or completed)
      const activeStatuses = ['lineup_open', 'in_progress', 'completed'];
      if (!activeStatuses.includes(data.status)) return;
      
      // Filter by season if specified
      if (season) {
        const startDate = data.startDate?.toDate ? data.startDate.toDate() : new Date(data.startDate);
        const tournamentSeason = startDate.getFullYear();
        if (tournamentSeason !== season) return;
      }
      
      const abbrev = tournamentAbbrevs[data.name] || data.name.substring(0, 3).toUpperCase();
      tournaments.push({
        id: doc.id,
        name: data.name,
        abbrev,
        status: data.status
      });
    });

    if (!tournaments.length) {
      return { tournaments: [], standings: [], bogeyPot: 0, eagleLeaders: [], bogeyTracker: [] };
    }

    // Load manual bogeys
    let manualBogeys = [];
    try {
      const manualBogeysDoc = await firebaseDb.collection('config').doc('manualBogeys').get();
      if (manualBogeysDoc.exists) {
        const allBogeys = manualBogeysDoc.data().bogeys || [];
        // Filter by season if specified
        if (season) {
          manualBogeys = allBogeys.filter(b => b.season === season.toString());
        } else {
          manualBogeys = allBogeys;
        }
      }
    } catch (error) {
      console.error('Error loading manual bogeys:', error);
    }

    // Get all users who have played
    const playersMap = new Map();

    for (const tournament of tournaments) {
      const standings = await this.calculateStandings(tournament.id);
      
      // Get scores for eagle/bogey calculation
      const scoresDoc = await firebaseDb.collection('scores').doc(tournament.id).get();
      const golferScores = scoresDoc.exists ? (scoresDoc.data().golferScores || {}) : {};
      
      // Get lineups for this tournament
      const lineups = await Lineup.getAllLineups(tournament.id);
      
      standings.forEach(player => {
        const userId = AccountMerges.resolveUserId(player.userId);
        const displayName = AccountMerges.getDisplayName(userId, player.displayName) || player.displayName;

        if (!playersMap.has(userId)) {
          playersMap.set(userId, {
            userId,
            displayName,
            tournamentScores: {},
            totalToPar: 0,
            tournamentsPlayed: 0,
            totalEagles: 0,
            totalBogeys: 0,
            manualBogeys: 0,
            eaglesByTournament: {},
            bogeysByTournament: {},
            bogeyDetails: [],
            eagleDetails: []
          });
        }
        
        const playerData = playersMap.get(userId);
        
        // Use real-time eagles/bogeys from calculateStandings (already calculated with proper rules)
        playerData.totalEagles += player.eagles || 0;
        playerData.totalBogeys += player.bogeys || 0;
        playerData.eaglesByTournament[tournament.id] =
          (playerData.eaglesByTournament[tournament.id] || 0) + (player.eagles || 0);
        playerData.bogeysByTournament[tournament.id] =
          (playerData.bogeysByTournament[tournament.id] || 0) + (player.bogeys || 0);
        
        playerData.tournamentScores[tournament.id] = {
          toPar: player.totalToPar,
          position: player.position,
          tied: player.tied,
          isComplete: tournament.status === 'completed'
        };
        playerData.totalToPar += player.totalToPar;
        playerData.tournamentsPlayed++;
      });
    }

    // Add manual bogeys to player totals
    for (const bogey of manualBogeys) {
      // Find player by display name
      for (const [userId, playerData] of playersMap) {
        if (playerData.displayName === bogey.playerName) {
          playerData.totalBogeys += 1;
          playerData.manualBogeys += 1;
          if (bogey.tournamentId) {
            playerData.bogeysByTournament[bogey.tournamentId] =
              (playerData.bogeysByTournament[bogey.tournamentId] || 0) + 1;
          }
          break;
        }
      }
    }

    // Convert to array and sort
    const standings = Array.from(playersMap.values());
    standings.sort((a, b) => a.totalToPar - b.totalToPar);

    // Assign positions
    let position = 1;
    standings.forEach((player, index) => {
      if (index > 0 && player.totalToPar === standings[index - 1].totalToPar) {
        player.position = standings[index - 1].position;
        player.tied = true;
        standings[index - 1].tied = true;
      } else {
        player.position = position;
        player.tied = false;
      }
      position++;
    });

    // Calculate bogey pot total ($5 per bogey)
    const totalBogeys = standings.reduce((sum, p) => sum + p.totalBogeys, 0);
    const bogeyPot = totalBogeys * 5;

    // Create eagle leaderboard (sorted by most eagles)
    const eagleLeaders = [...standings]
      .filter(p => p.totalEagles > 0)
      .sort((a, b) => b.totalEagles - a.totalEagles);

    // Create bogey tracker (sorted by most bogeys)
    const bogeyTracker = [...standings]
      .filter(p => p.totalBogeys > 0)
      .sort((a, b) => b.totalBogeys - a.totalBogeys);

    return { tournaments, standings, bogeyPot, eagleLeaders, bogeyTracker };
  },

  // Calculate eagles and bogeys for a player's best ball scores
  // Handles golfers who withdrew - only withdrawn golfers are excluded from blocking bogeys
  // Golfers who haven't started still block bogey counting
  calculateEaglesAndBogeys(golfersR12, golfersR34, golferScores, tournamentName) {
    const eagles = { count: 0, details: [] };
    const bogeys = { count: 0, details: [] };
    
    // Process all 4 rounds
    for (let roundNum = 1; roundNum <= 4; roundNum++) {
      const roundIndex = roundNum - 1;
      const golfers = roundNum <= 2 ? golfersR12 : golfersR34;
      
      if (!golfers || golfers.length === 0) continue;
      
      // Relevant golfers = all lineup golfers MINUS withdrawn ones
      // Golfers who haven't started yet still block bogey counting
      const relevantGolfers = golfers.filter(golferName => 
        !Scoring.isGolferWithdrawnForRound(golferScores, golferName, roundNum)
      );
      
      // If all golfers withdrew, skip this round
      if (relevantGolfers.length === 0) continue;
      
      // Calculate best ball for each hole
      for (let holeNum = 1; holeNum <= 18; holeNum++) {
        const holeIndex = holeNum - 1;
        let bestScore = null;
        let hasAnyScore = false;
        let allRelevantGolfersCompletedHole = true;
        
        // Check all golfers in lineup for best score
        golfers.forEach(golferName => {
          const normalized = Scoring.normalizeName(golferName);
          const golfer = golferScores[normalized];
          const hole = golfer?.rounds?.[roundIndex]?.holes?.[holeIndex];
          
          if (hole && hole.toPar !== null && hole.toPar !== undefined) {
            hasAnyScore = true;
            if (bestScore === null || hole.toPar < bestScore) {
              bestScore = hole.toPar;
            }
          }
        });
        
        // Check if all RELEVANT (non-withdrawn) golfers have completed this hole
        // This includes golfers who haven't started - they block bogey counting
        relevantGolfers.forEach(golferName => {
          const normalized = Scoring.normalizeName(golferName);
          const golfer = golferScores[normalized];
          const hole = golfer?.rounds?.[roundIndex]?.holes?.[holeIndex];
          
          if (!hole || hole.toPar === null || hole.toPar === undefined) {
            allRelevantGolfersCompletedHole = false;
          }
        });
        
        // Eagle: count immediately when best ball is -2 or better
        if (hasAnyScore && bestScore !== null && bestScore <= -2) {
          eagles.count++;
          eagles.details.push({
            tournament: tournamentName,
            round: roundNum,
            hole: holeNum,
            score: bestScore
          });
        }
        
        // Bogey: only count when ALL non-withdrawn golfers have completed the hole
        // Golfers who haven't started yet will block this
        if (allRelevantGolfersCompletedHole && bestScore !== null && bestScore >= 1) {
          bogeys.count++;
          bogeys.details.push({
            tournament: tournamentName,
            round: roundNum,
            hole: holeNum,
            score: bestScore
          });
        }
      }
    }
    
    return { eagles, bogeys };
  },

  seasonTournaments: [],
  seasonStandings: [],
  seasonEagleLeaders: [],
  seasonBogeyTracker: [],
  seasonBogeyPot: 0,
  seasonStandingsSort: { col: 'total', descending: false },
  /** Columns: 'player' | 'total' | 'tid:${tournamentId}' */
  seasonStatsSortEagles: { col: 'total', descending: true },
  seasonStatsSortBogeys: { col: 'total', descending: true },
  _seasonStatSortHandler: null,
  _seasonStatSortContainer: null,
  unsubscribeSeasonScores: null,
  seasonContainerId: null,
  seasonCurrentUserId: null,
  seasonValue: null,

  async renderSeasonStandings(containerId, currentUserId = null, season = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Store for live updates
    this.seasonContainerId = containerId;
    this.seasonCurrentUserId = currentUserId;
    this.seasonValue = season;

    container.innerHTML = '<div class="loading">Loading season standings...</div>';

    const { tournaments, standings, bogeyPot, eagleLeaders, bogeyTracker } = await this.calculateSeasonStandings(season);
    this.seasonTournaments = tournaments;
    this.seasonStandings = standings;
    this.seasonEagleLeaders = eagleLeaders;
    this.seasonBogeyTracker = bogeyTracker;
    this.seasonBogeyPot = bogeyPot;

    if (!tournaments.length) {
      const seasonText = season ? `the ${season} season` : 'this season';
      container.innerHTML = `<div class="no-data">No completed or in-progress tournaments yet for ${seasonText}.</div>`;
      return;
    }

    if (!standings.length) {
      container.innerHTML = '<div class="no-data">No lineups submitted yet.</div>';
      return;
    }

    const html = this.buildSeasonStandingsHTML(tournaments, standings, bogeyPot, eagleLeaders, bogeyTracker, currentUserId);
    container.innerHTML = html;

    this.attachSeasonStandingsExpandHandlers(container);

    // Subscribe to live updates for in-progress tournaments (only if not already subscribed)
    this.subscribeToSeasonUpdates(tournaments);
    this.detachSeasonStatSortDelegation();
    this.attachSeasonStatSortDelegation(container);
  },

  seasonSubscribedTournamentId: null,

  subscribeToSeasonUpdates(tournaments) {
    // Find active tournaments (lineup_open or in_progress)
    const activeTournaments = tournaments.filter(t => t.status === 'in_progress' || t.status === 'lineup_open');
    if (activeTournaments.length === 0) {
      this.stopSeasonLiveUpdates();
      return;
    }

    // Get the active tournament
    const activeTournament = activeTournaments[0];
    
    // Don't re-subscribe if we're already subscribed to this tournament
    if (this.seasonSubscribedTournamentId === activeTournament.id && this.unsubscribeSeasonScores) {
      return;
    }

    // Unsubscribe from previous listener if different tournament
    if (this.unsubscribeSeasonScores) {
      this.unsubscribeSeasonScores();
      this.unsubscribeSeasonScores = null;
    }

    this.seasonSubscribedTournamentId = activeTournament.id;
    
    this.unsubscribeSeasonScores = firebaseDb.collection('scores').doc(activeTournament.id)
      .onSnapshot(async () => {
        // Re-render season standings without re-subscribing
        if (this.seasonContainerId) {
          await this.refreshSeasonStandings();
        }
      });
  },

  async refreshSeasonStandings() {
    const container = document.getElementById(this.seasonContainerId);
    if (!container) return;

    const { tournaments, standings, bogeyPot, eagleLeaders, bogeyTracker } = await this.calculateSeasonStandings(this.seasonValue);
    this.seasonTournaments = tournaments;
    this.seasonStandings = standings;
    this.seasonEagleLeaders = eagleLeaders;
    this.seasonBogeyTracker = bogeyTracker;
    this.seasonBogeyPot = bogeyPot;

    if (!tournaments.length || !standings.length) return;

    // Re-render the HTML
    const currentUserId = this.seasonCurrentUserId;
    const html = this.buildSeasonStandingsHTML(tournaments, standings, bogeyPot, eagleLeaders, bogeyTracker, currentUserId);
    container.innerHTML = html;

    this.attachSeasonStandingsExpandHandlers(container);

    this.detachSeasonStatSortDelegation();
    this.attachSeasonStatSortDelegation(container);
  },

  attachSeasonStandingsExpandHandlers(containerEl) {
    if (!containerEl) return;
    containerEl.querySelectorAll('table[data-stats-table-kind="season"] .season-row').forEach((row) => {
      row.addEventListener('click', () => {
        row.classList.toggle('expanded');
        const details = row.nextElementSibling;
        if (details?.classList.contains('season-details')) {
          details.classList.toggle('show');
        }
      });
    });
  },

  refreshSeasonMainStandingsTable(containerEl) {
    const prev = containerEl.querySelector('table[data-stats-table-kind="season"]');
    if (!prev || !this.seasonStandings?.length) return;
    const html = this.buildSeasonMainStandingsTableHtml(
      this.seasonTournaments,
      this.seasonStandings,
      this.seasonCurrentUserId
    );
    prev.outerHTML = html;
    this.attachSeasonStandingsExpandHandlers(containerEl);
  },

  /** Same row tie-break after primary sort comparison. */
  compareSeasonStandingsTiebreaker(a, b) {
    return String(a.displayName || '').localeCompare(String(b.displayName || ''), undefined, {
      sensitivity: 'base'
    });
  },

  compareSeasonStandingsRows(a, b, cfg) {
    const { col, descending } = cfg;

    if (col === 'player') {
      const sa = String(a.displayName || '').toLowerCase();
      const sb = String(b.displayName || '').toLowerCase();
      const c = sa.localeCompare(sb, undefined, { sensitivity: 'base' });
      if (c !== 0) return descending ? -c : c;
      return 0;
    }

    if (col === 'total') {
      const va = a.totalToPar;
      const vb = b.totalToPar;
      if (va !== vb) return descending ? vb - va : va - vb;
      return 0;
    }

    const tidPref = 'tid:';
    if (col.startsWith(tidPref)) {
      const tid = col.slice(tidPref.length);
      const sa = a.tournamentScores[tid];
      const sb = b.tournamentScores[tid];
      const va =
        sa != null && sa.toPar != null && sa.toPar !== undefined ? Number(sa.toPar) : null;
      const vb =
        sb != null && sb.toPar != null && sb.toPar !== undefined ? Number(sb.toPar) : null;
      const miss = this._compareAbsentLastNumeric(va, vb);
      if (miss !== null && miss !== 0) return miss;
      if (va !== vb) return descending ? vb - va : va - vb;
      return 0;
    }

    return 0;
  },

  sortSeasonStandingsPlayers(standings) {
    const cfg = this.seasonStandingsSort;
    return [...standings].sort((a, b) => {
      const p = this.compareSeasonStandingsRows(a, b, cfg);
      if (p !== 0) return p;
      return this.compareSeasonStandingsTiebreaker(a, b);
    });
  },

  /** First click defaults to ascending: lower totals / lower per-event scores, A→Z players. */
  seasonStandingsDefaultDescending() {
    return false;
  },

  /**
   * Main season standings grid (sorted by seasonStandingsSort).
   */
  buildSeasonMainStandingsTableHtml(tournaments, standings, currentUserId) {
    const escAttr = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');

    const sorted = this.sortSeasonStandingsPlayers(standings);
    const sortCfg = this.seasonStandingsSort;

    const headerSortCls = (colKey) => {
      if (sortCfg.col !== colKey) return '';
      return sortCfg.descending ? 'sorted-desc' : 'sorted-asc';
    };

    const thSortSeason = (classNames, sortColKey, innerHtml) =>
      `<th class="${classNames} stats-sort-col ${headerSortCls(sortColKey)}" `
      + `scope="col" data-stats-sort-col="${escAttr(sortColKey)}">${innerHtml}`
      + '<span class="sort-indicator" aria-hidden="true"></span></th>';

    const headerTournaments = tournaments
      .map(t =>
        thSortSeason('tournament', `tid:${t.id}`, `<span title="${escAttr(t.name)}">${t.name}</span>`)
      )
      .join('');

    const tbodyHtml = sorted
      .map(player => this.renderSeasonRow(player, tournaments, currentUserId))
      .join('');

    return `
      <table class="season-standings-table" data-stats-table-kind="season">
        <thead>
          <tr>
            <th class="pos" scope="col">Pos</th>
            ${thSortSeason('player', 'player', 'Player')}
            ${headerTournaments}
            ${thSortSeason('season-total', 'total', 'Total')}
          </tr>
        </thead>
        <tbody>${tbodyHtml}</tbody>
      </table>
    `;
  },

  buildSeasonStandingsHTML(tournaments, standings, bogeyPot, eagleLeaders, bogeyTracker, currentUserId) {
    return `
      <div class="season-info">
        <span><strong>${tournaments.length}</strong> tournament${tournaments.length > 1 ? 's' : ''} played</span>
        <span><strong>${standings.length}</strong> players</span>
      </div>

      <!-- Season Standings Table (moved to top) -->
      <h3 class="section-title">Season Standings <span class="sort-col-hint"></span></h3>
      ${this.buildSeasonMainStandingsTableHtml(tournaments, standings, currentUserId)}

      <!-- Bogey Pot Banner -->
      <div class="bogey-pot-banner" style="margin-top: 30px;">
        <div class="bogey-pot-icon">💰</div>
        <div class="bogey-pot-info">
          <div class="bogey-pot-label">Bogey Pot</div>
          <div class="bogey-pot-amount">$${bogeyPot.toFixed(2)}</div>
        </div>
        <div class="bogey-pot-details">
          <span>${bogeyTracker.reduce((sum, p) => sum + p.totalBogeys, 0)} total bogeys × $5</span>
        </div>
      </div>

      <!-- Eagles & Bogeys Section -->
      <div class="eagles-bogeys-section">
        <!-- Eagles Leaderboard -->
        <div class="stat-card eagles-card">
          <h3>🦅 Eagles Leaderboard</h3>
          <p class="stat-subtitle">Players compete for the Bogey Pot with most eagles <span class="sort-col-hint"></span></p>
          ${this.buildSeasonEaglesBogeysSpreadHtml(tournaments, eagleLeaders, currentUserId, 'eagles')}
        </div>

        <!-- Bogey Tracker -->
        <div class="stat-card bogeys-card">
          <h3>💸 Bogey Tracker</h3>
          <p class="stat-subtitle">$5 per bogey into the pot <span class="sort-col-hint"></span></p>
          ${this.buildSeasonEaglesBogeysSpreadHtml(tournaments, bogeyTracker, currentUserId, 'bogeys')}
        </div>
      </div>
    `;
  },

  getSeasonStatSortConfig(kind) {
    return kind === 'eagles' ? this.seasonStatsSortEagles : this.seasonStatsSortBogeys;
  },

  setSeasonStatSortConfig(kind, cfg) {
    if (kind === 'eagles') this.seasonStatsSortEagles = cfg;
    else this.seasonStatsSortBogeys = cfg;
  },

  /** Numeric columns sort high-first on first click; player column is A–Z first. */
  seasonStatDefaultDescending(sortCol) {
    return sortCol !== 'player';
  },

  /** Absent lineup for a tournament column sorts last. */
  _compareAbsentLastNumeric(va, vb) {
    const mA = va == null || va === undefined || Number.isNaN(va);
    const mB = vb == null || vb === undefined || Number.isNaN(vb);
    if (mA && mB) return 0;
    if (mA) return 1;
    if (mB) return -1;
    return null;
  },

  compareSeasonStatRows(a, b, kind, cfg) {
    const totalField = kind === 'eagles' ? 'totalEagles' : 'totalBogeys';
    const byKey = kind === 'eagles' ? 'eaglesByTournament' : 'bogeysByTournament';
    const { col, descending } = cfg;

    if (col === 'player') {
      const sa = String(a.displayName || '').toLowerCase();
      const sb = String(b.displayName || '').toLowerCase();
      const c = sa.localeCompare(sb, undefined, { sensitivity: 'base' });
      if (c !== 0) return descending ? -c : c;
      return 0;
    }

    if (col === 'total') {
      const va = a[totalField] ?? 0;
      const vb = b[totalField] ?? 0;
      if (va !== vb) return descending ? vb - va : va - vb;
      return 0;
    }

    const tidPref = 'tid:';
    if (col.startsWith(tidPref)) {
      const tid = col.slice(tidPref.length);
      const playedA = !!a.tournamentScores[tid];
      const playedB = !!b.tournamentScores[tid];
      const va = playedA ? ((a[byKey] && a[byKey][tid]) || 0) : null;
      const vb = playedB ? ((b[byKey] && b[byKey][tid]) || 0) : null;
      const miss = this._compareAbsentLastNumeric(va, vb);
      if (miss !== null && miss !== 0) return miss;
      if (va !== vb) return descending ? vb - va : va - vb;
      return 0;
    }

    return 0;
  },

  sortSeasonStatPlayers(players, kind, tournaments) {
    const cfg = this.getSeasonStatSortConfig(kind);
    return [...players].sort((a, b) => {
      const p = this.compareSeasonStatRows(a, b, kind, cfg);
      if (p !== 0) return p;
      return String(a.displayName || '').localeCompare(String(b.displayName || ''), undefined, {
        sensitivity: 'base'
      });
    });
  },

  attachSeasonStatSortDelegation(containerEl) {
    if (!containerEl?.querySelector?.('[data-stats-sort-col]')) return;

    this.detachSeasonStatSortDelegation();

    const fn = (e) => {
      const th = e.target.closest('th.stats-sort-col');
      if (!th || !containerEl.contains(th)) return;
      const table = th.closest('table[data-stats-table-kind]');
      if (!table || !containerEl.contains(table)) return;
      const k = table.getAttribute('data-stats-table-kind');
      if (!k || (k !== 'season' && k !== 'eagles' && k !== 'bogeys')) return;

      const col = th.getAttribute('data-stats-sort-col');
      if (!col) return;
      e.preventDefault();

      if (k === 'season') {
        let cfg = this.seasonStandingsSort;
        cfg = cfg.col === col
          ? { col, descending: !cfg.descending }
          : { col, descending: this.seasonStandingsDefaultDescending() };
        this.seasonStandingsSort = cfg;
        this.refreshSeasonMainStandingsTable(containerEl);
        return;
      }

      let cfg = this.getSeasonStatSortConfig(k);
      cfg = cfg.col === col
        ? { col, descending: !cfg.descending }
        : { col, descending: this.seasonStatDefaultDescending(col) };
      this.setSeasonStatSortConfig(k, cfg);
      this.refreshSeasonSpreadTables(containerEl);
    };

    this._seasonStatSortHandler = fn;
    this._seasonStatSortContainer = containerEl;
    containerEl.addEventListener('click', fn);
  },

  detachSeasonStatSortDelegation() {
    if (this._seasonStatSortHandler && this._seasonStatSortContainer) {
      this._seasonStatSortContainer.removeEventListener('click', this._seasonStatSortHandler);
    }
    this._seasonStatSortHandler = null;
    this._seasonStatSortContainer = null;
  },

  /** Rebuild only eagle/bogey spreadsheet DOM after sorting (full container still holds listener). */
  refreshSeasonSpreadTables(containerEl) {
    ['eagles', 'bogeys'].forEach((kind) => {
      const root = containerEl.querySelector(`.season-stats-spread-root[data-spread-kind="${kind}"]`);
      if (!root) return;
      const players = kind === 'eagles' ? this.seasonEagleLeaders : this.seasonBogeyTracker;
      const tournaments = this.seasonTournaments;
      root.outerHTML = this.buildSeasonEaglesBogeysSpreadHtml(tournaments, players, this.seasonCurrentUserId, kind);
    });
  },

  /** Season eagle/bogey tables: per-tournament columns + Total; headers sort rows. */
  buildSeasonEaglesBogeysSpreadHtml(tournaments, players, currentUserId, kind) {
    const emptyMsg = kind === 'eagles'
      ? 'No eagles recorded yet'
      : 'No bogeys recorded yet';
    if (!players.length) {
      return `<div class="no-stat-data">${emptyMsg}</div>`;
    }

    const byKey = kind === 'eagles' ? 'eaglesByTournament' : 'bogeysByTournament';
    const totalKey = kind === 'eagles' ? 'totalEagles' : 'totalBogeys';
    const colClass = kind === 'eagles' ? 'stat-value eagles' : 'stat-value bogeys';
    const sortCfg = this.getSeasonStatSortConfig(kind);
    const sortedPlayers = this.sortSeasonStatPlayers(players, kind, tournaments);

    const escAttr = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');

    const headerSortCls = (col) => {
      if (sortCfg.col !== col) return '';
      return sortCfg.descending ? 'sorted-desc' : 'sorted-asc';
    };

    const thSortCol = (classNames, sortColKey, innerHtml) =>
      `<th class="${classNames} stats-sort-col ${headerSortCls(sortColKey)}" `
      + `scope="col" data-stats-sort-col="${escAttr(sortColKey)}">${innerHtml}`
      + '<span class="sort-indicator" aria-hidden="true"></span></th>';

    const headerTournaments = tournaments
      .map(t => {
        const colKey = `tid:${t.id}`;
        return thSortCol('tournament', colKey,
          `<span title="${escAttr(t.name)}">${t.abbrev}</span>`);
      })
      .join('');

    const tbody = sortedPlayers.map((player, index) => {
      const cols = tournaments
        .map((t) => {
          const played = !!player.tournamentScores[t.id];
          const n = played ? ((player[byKey] && player[byKey][t.id]) || 0) : null;
          const cell = n === null ? '-' : String(n);
          return `<td class="num">${cell}</td>`;
        })
        .join('');
      let totalCell;
      if (kind === 'eagles') {
        totalCell = `${player[totalKey]} 🦅`;
      } else {
        const tb = player[totalKey];
        totalCell = `${tb} ($${(tb * 5).toFixed(0)})`;
      }

      const rowCls = AccountMerges.isSamePlayer(player.userId, currentUserId) ? ' current-user' : '';
      const rankCell =
        kind === 'eagles' ? `<td class="pos">${index + 1}</td>` : '';
      return `
        <tr class="season-stats-row${rowCls}">
          ${rankCell}
          <td class="player">${player.displayName}</td>
          ${cols}
          <td class="season-total ${colClass}">${totalCell}</td>
        </tr>
      `;
    }).join('');

    const rankHeader =
      kind === 'eagles' ? '<th class="pos" scope="col">Rank</th>' : '';

    return `
      <div class="stat-breakdown-scroll season-stats-spread-root" data-spread-kind="${kind}">
        <table class="season-standings-table season-stats-spread-table" data-stats-table-kind="${kind}">
          <thead>
            <tr>
              ${rankHeader}
              ${thSortCol('player', 'player', 'Player')}
              ${headerTournaments}
              ${thSortCol('season-total', 'total', 'Total')}
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    `;
  },

  stopSeasonLiveUpdates() {
    if (this.unsubscribeSeasonScores) {
      this.unsubscribeSeasonScores();
      this.unsubscribeSeasonScores = null;
    }
    this.seasonSubscribedTournamentId = null;
  },

  renderSeasonRow(player, tournaments, currentUserId) {
    const isCurrentUser = AccountMerges.isSamePlayer(player.userId, currentUserId);
    const positionDisplay = player.tied ? `T${player.position}` : player.position;

    // Build tournament details
    const tournamentDetailsHtml = tournaments.map(t => {
      const score = player.tournamentScores[t.id];
      if (!score) {
        return `
          <div class="tournament-detail-card no-entry">
            <div class="tournament-detail-name">${t.name}</div>
            <div class="tournament-detail-score">Did not enter</div>
          </div>
        `;
      }
      const posDisplay = score.tied ? `T${score.position}` : score.position;
      return `
        <div class="tournament-detail-card">
          <div class="tournament-detail-name">${t.name}</div>
          <div class="tournament-detail-position">${posDisplay}${getOrdinalSuffix(score.position)} place</div>
          <div class="tournament-detail-score ${this.getScoreClass(score.toPar)}">
            ${Scoring.formatToPar(score.toPar)}
            ${score.isComplete ? '' : ' (in progress)'}
          </div>
        </div>
      `;
    }).join('');

    return `
      <tr class="season-row ${isCurrentUser ? 'current-user' : ''}" data-user-id="${player.userId}">
        <td class="pos">${positionDisplay}</td>
        <td class="player">
          <span class="player-name">${player.displayName}</span>
          <i class="expand-icon">▼</i>
        </td>
        ${tournaments.map(t => {
          const score = player.tournamentScores[t.id];
          if (!score) return '<td>-</td>';
          const scoreClass = this.getScoreClass(score.toPar);
          const displayScore = Scoring.formatToPar(score.toPar);
          return `<td class="${scoreClass}">${displayScore}</td>`;
        }).join('')}
        <td class="season-total ${this.getScoreClass(player.totalToPar)}">${Scoring.formatToPar(player.totalToPar)}</td>
      </tr>
      <tr class="season-details">
        <td colspan="${tournaments.length + 3}">
          <div class="tournament-details-grid">
            ${tournamentDetailsHtml}
          </div>
        </td>
      </tr>
    `;
  }
};

// Helper function for ordinal suffix
function getOrdinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
