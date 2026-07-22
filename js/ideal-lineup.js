// Ideal (optimal salary-cap) lineups for a completed tournament — computed once, stored on scores/{id}.
const IdealLineup = {
  /** Sentinel for a hole with no score (larger than any realistic toPar). */
  MISSING: 99,

  async load(tournamentId) {
    if (!tournamentId) return null;
    try {
      const doc = await firebaseDb.collection('scores').doc(tournamentId).get();
      if (!doc.exists) return null;
      return doc.data().idealLineups || null;
    } catch (error) {
      console.warn('Could not load ideal lineups:', error);
      return null;
    }
  },

  /**
   * Brute-force optimal 4-golfer lineup under salaryCap for each round.
   * Uses every golfer in the tournament field who has ESPN hole scores for that round.
   */
  async computeAndSave(tournamentId, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

    onProgress('Loading tournament…');
    const tournamentDoc = await firebaseDb.collection('tournaments').doc(tournamentId).get();
    if (!tournamentDoc.exists) throw new Error('Tournament not found');
    const tournament = { id: tournamentDoc.id, ...tournamentDoc.data() };
    const salaryCap = Number(tournament.salaryCap) || 100;
    const golferField = tournament.golferField || [];

    onProgress('Loading scores…');
    const scoresDoc = await firebaseDb.collection('scores').doc(tournamentId).get();
    if (!scoresDoc.exists) throw new Error('No scores document — update scores from ESPN first');
    const golferScores = scoresDoc.data().golferScores || {};

    const rounds = [];
    for (let roundNumber = 1; roundNumber <= 4; roundNumber++) {
      onProgress(`Optimizing Round ${roundNumber}…`);
      await new Promise((r) => setTimeout(r, 0));
      rounds.push(
        await this.findOptimalForRound(roundNumber, golferField, golferScores, salaryCap, onProgress)
      );
    }

    const idealLineups = {
      computedAt: firebase.firestore.FieldValue.serverTimestamp(),
      salaryCap,
      tournamentName: tournament.name || '',
      rounds
    };

    onProgress('Saving…');
    await firebaseDb.collection('scores').doc(tournamentId).set({ idealLineups }, { merge: true });
    onProgress('Done');
    return idealLineups;
  },

  buildCandidates(roundNumber, golferField, golferScores) {
    const roundIndex = roundNumber - 1;
    const candidates = [];

    for (const g of golferField) {
      const salary = Number(g.salary);
      if (!Number.isFinite(salary)) continue;

      const normalized = Scoring.normalizeName(g.name);
      const golfer = golferScores[normalized];
      const round = golfer?.rounds?.[roundIndex];
      if (!round?.holes?.length) continue;

      const holes = new Int8Array(18);
      let played = 0;
      for (let h = 0; h < 18; h++) {
        const hole = round.holes[h];
        if (hole && hole.toPar !== null && hole.toPar !== undefined) {
          holes[h] = hole.toPar;
          played += 1;
        } else {
          holes[h] = this.MISSING;
        }
      }
      if (played === 0) continue;

      candidates.push({
        name: g.name,
        salary,
        holes,
        played
      });
    }

    // Ascending salary — enables pruning / early break in the inner loop
    candidates.sort((a, b) => {
      if (a.salary !== b.salary) return a.salary - b.salary;
      return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
    });

    return candidates;
  },

  bestBallTotal(holesA, holesB, holesC, holesD) {
    let total = 0;
    for (let h = 0; h < 18; h++) {
      let m = holesA[h];
      if (holesB[h] < m) m = holesB[h];
      if (holesC[h] < m) m = holesC[h];
      if (holesD[h] < m) m = holesD[h];
      // Match Scoring.calculateBestBall: unplayed holes contribute 0
      if (m < this.MISSING) total += m;
    }
    return total;
  },

  bestBallHoles(holesA, holesB, holesC, holesD) {
    const out = [];
    for (let h = 0; h < 18; h++) {
      let m = holesA[h];
      if (holesB[h] < m) m = holesB[h];
      if (holesC[h] < m) m = holesC[h];
      if (holesD[h] < m) m = holesD[h];
      out.push(m < this.MISSING ? m : null);
    }
    return out;
  },

  async findOptimalForRound(roundNumber, golferField, golferScores, salaryCap, onProgress) {
    const candidates = this.buildCandidates(roundNumber, golferField, golferScores);
    if (candidates.length < 4) {
      return {
        roundNumber,
        golfers: [],
        lineups: [],
        totalSalary: 0,
        totalToPar: null,
        holes: Array(18).fill(null),
        candidateCount: candidates.length,
        error: 'Fewer than 4 golfers with scores for this round'
      };
    }

    const n = candidates.length;
    const salaries = candidates.map((c) => c.salary);
    const holeArrays = candidates.map((c) => c.holes);

    let bestScore = Infinity;
    let bestCombos = []; // [{ idx: [i,j,k,l], salary }]
    let checked = 0;

    for (let i = 0; i < n - 3; i++) {
      for (let j = i + 1; j < n - 2; j++) {
        const s2 = salaries[i] + salaries[j];
        if (s2 + salaries[j + 1] + salaries[j + 2] > salaryCap) continue;

        for (let k = j + 1; k < n - 1; k++) {
          const s3 = s2 + salaries[k];
          if (s3 + salaries[k + 1] > salaryCap) continue;

          for (let l = k + 1; l < n; l++) {
            const sal = s3 + salaries[l];
            if (sal > salaryCap) break;

            const score = this.bestBallTotal(
              holeArrays[i],
              holeArrays[j],
              holeArrays[k],
              holeArrays[l]
            );
            checked += 1;
            if (score < bestScore) {
              bestScore = score;
              bestCombos = [{ idx: [i, j, k, l], salary: sal }];
            } else if (score === bestScore) {
              bestCombos.push({ idx: [i, j, k, l], salary: sal });
            }
            if (checked % 400000 === 0) {
              if (onProgress) {
                onProgress(`Optimizing Round ${roundNumber}… (${checked.toLocaleString()} lineups checked)`);
              }
              await new Promise((r) => setTimeout(r, 0));
            }
          }
        }
      }

      if (i % 5 === 0 && onProgress) {
        onProgress(`Optimizing Round ${roundNumber}… (${i + 1}/${n - 3})`);
      }
    }

    if (!bestCombos.length) {
      return {
        roundNumber,
        golfers: [],
        lineups: [],
        totalSalary: 0,
        totalToPar: null,
        holes: Array(18).fill(null),
        candidateCount: n,
        combinationsChecked: checked,
        error: 'No valid 4-golfer lineup under the salary cap'
      };
    }

    const lineups = bestCombos.map((combo) => {
      const [i, j, k, l] = combo.idx;
      const pick = [candidates[i], candidates[j], candidates[k], candidates[l]];
      pick.sort((a, b) => b.salary - a.salary || a.name.localeCompare(b.name));
      return {
        golfers: pick.map((c) => ({ name: c.name, salary: c.salary })),
        totalSalary: Math.round(combo.salary * 100) / 100,
        holes: this.bestBallHoles(
          candidates[i].holes,
          candidates[j].holes,
          candidates[k].holes,
          candidates[l].holes
        )
      };
    });

    // Stable order: cheaper total salary first, then golfer names
    lineups.sort((a, b) => {
      if (a.totalSalary !== b.totalSalary) return a.totalSalary - b.totalSalary;
      const na = a.golfers.map((g) => g.name).join('|');
      const nb = b.golfers.map((g) => g.name).join('|');
      return na.localeCompare(nb, undefined, { sensitivity: 'base' });
    });

    // Cap stored ties to keep the Firestore doc small (still report full count)
    const MAX_STORED = 100;
    const storedLineups = lineups.slice(0, MAX_STORED);

    const first = storedLineups[0];
    return {
      roundNumber,
      // Legacy single-lineup fields (first of ties) for older readers
      golfers: first.golfers,
      totalSalary: first.totalSalary,
      totalToPar: bestScore,
      holes: first.holes,
      lineups: storedLineups,
      lineupCount: lineups.length,
      lineupCountStored: storedLineups.length,
      candidateCount: n,
      combinationsChecked: checked
    };
  },

  /** Normalize stored round data to always expose a lineups[]. */
  getRoundLineups(roundResult) {
    if (!roundResult) return [];
    if (Array.isArray(roundResult.lineups) && roundResult.lineups.length) {
      return roundResult.lineups.filter((l) => l?.golfers?.length);
    }
    if (roundResult.golfers?.length) {
      return [{
        golfers: roundResult.golfers,
        totalSalary: roundResult.totalSalary,
        holes: roundResult.holes
      }];
    }
    return [];
  },

  formatRoundHtml(roundResult, salaryCap) {
    if (!roundResult) return '';
    const lineups = this.getRoundLineups(roundResult);
    if (roundResult.error || !lineups.length) {
      return `
        <div class="ideal-round">
          <h5>Round ${roundResult.roundNumber}</h5>
          <p class="ideal-empty">${roundResult.error || 'No ideal lineup available'}</p>
        </div>
      `;
    }

    const score = Scoring.formatToPar(roundResult.totalToPar);
    const scoreClass = typeof Leaderboard !== 'undefined'
      ? Leaderboard.getScoreClass(roundResult.totalToPar)
      : '';
    const multi = lineups.length > 1;
    const totalTied = roundResult.lineupCount || lineups.length;
    const panels = lineups.map((lineup, idx) => `
      <div class="ideal-lineup-panel" data-ideal-index="${idx}" ${idx === 0 ? '' : 'hidden'}>
        <ul class="ideal-golfer-list">
          ${lineup.golfers.map((g) => `
            <li>
              <span class="ideal-golfer-name">${g.name}</span>
              <span class="ideal-golfer-salary">$${Number(g.salary).toFixed(2)}</span>
            </li>
          `).join('')}
        </ul>
        <div class="ideal-round-salary">$${Number(lineup.totalSalary).toFixed(2)} / $${Number(salaryCap).toFixed(2)}</div>
      </div>
    `).join('');

    return `
      <div class="ideal-round" data-ideal-round="${roundResult.roundNumber}" data-ideal-count="${lineups.length}">
        <div class="ideal-round-header">
          <h5>Round ${roundResult.roundNumber}</h5>
          <span class="ideal-round-score ${scoreClass}">${score}</span>
          ${multi ? `
            <div class="ideal-carousel">
              <button type="button" class="ideal-nav-btn" data-ideal-dir="-1" aria-label="Previous ideal lineup">‹</button>
              <span class="ideal-carousel-label">1 / ${lineups.length}</span>
              <button type="button" class="ideal-nav-btn" data-ideal-dir="1" aria-label="Next ideal lineup">›</button>
            </div>
          ` : ''}
        </div>
        ${multi ? `<p class="ideal-tie-note">${totalTied} lineup${totalTied === 1 ? '' : 's'} tied at ${score}${totalTied > lineups.length ? ` (showing ${lineups.length})` : ''}</p>` : ''}
        <div class="ideal-lineup-panels">
          ${panels}
        </div>
      </div>
    `;
  },

  bindCarousel(container) {
    if (!container) return;
    container.querySelectorAll('.ideal-round[data-ideal-count]').forEach((roundEl) => {
      const count = parseInt(roundEl.dataset.idealCount, 10) || 1;
      if (count <= 1) return;
      let index = 0;
      const label = roundEl.querySelector('.ideal-carousel-label');
      const panels = [...roundEl.querySelectorAll('.ideal-lineup-panel')];

      const show = (next) => {
        index = ((next % count) + count) % count;
        panels.forEach((p, i) => {
          p.hidden = i !== index;
        });
        if (label) label.textContent = `${index + 1} / ${count}`;
      };

      roundEl.querySelectorAll('.ideal-nav-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const dir = parseInt(btn.dataset.idealDir, 10) || 1;
          show(index + dir);
        });
      });
    });
  },

  renderSectionHtml(idealLineups) {
    const rounds = (idealLineups?.rounds || []).filter((r) => this.getRoundLineups(r).length > 0);
    if (!rounds.length) {
      return '';
    }

    const cap = idealLineups.salaryCap || 100;
    const seasonTotal = rounds.reduce((sum, r) => {
      return sum + (r.totalToPar != null ? r.totalToPar : 0);
    }, 0);

    return `
      <div class="ideal-lineups-section">
        <div class="ideal-lineups-header">
          <h4>Ideal lineups</h4>
          <span class="ideal-season-total ${typeof Leaderboard !== 'undefined' ? Leaderboard.getScoreClass(seasonTotal) : ''}">
            4-round total ${Scoring.formatToPar(seasonTotal)}
          </span>
        </div>
        <p class="ideal-lineups-note">
          Optimal 4-golfer best ball lineups under the $${Number(cap).toFixed(2)} cap for each round
        </p>
        <div class="ideal-rounds-grid">
          ${rounds.map((r) => this.formatRoundHtml(r, cap)).join('')}
        </div>
      </div>
    `;
  }
};
