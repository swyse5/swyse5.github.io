/**
 * Golfer pick popularity: how often each golfer appears in submitted lineups per tournament.
 * Each deduped lineup doc (rounds_1_2, rounds_3_4, round_N, etc.) counts once per golfer listed.
 */

function picksLineupUpdatedMillis(lineup) {
  if (!lineup) return 0;
  const ts = lineup.updatedAt || lineup.submittedAt;
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') {
    return ts.seconds * 1000 + (ts.nanoseconds || 0) / 1e6;
  }
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? parsed : 0;
}

function picksPickNewerLineup(incumbent, candidate) {
  if (!candidate) return incumbent || null;
  if (!incumbent) return candidate;
  const cMs = picksLineupUpdatedMillis(candidate);
  const iMs = picksLineupUpdatedMillis(incumbent);
  if (cMs > iMs) return candidate;
  if (iMs > cMs) return incumbent;
  return String(candidate.id || '') > String(incumbent.id || '') ? candidate : incumbent;
}

function dedupeLineupDocumentsForPicks(lineupDocs) {
  const byKey = new Map();
  lineupDocs.forEach((raw) => {
    const data = raw && raw.userId != null ? raw : null;
    if (!data) return;
    const type = data.lineupType || 'rounds_1_2';
    const key = `${data.userId}|${type}`;
    byKey.set(key, picksPickNewerLineup(byKey.get(key), data));
  });
  return [...byKey.values()];
}

function lineupGolferNamesForPicks(lineup) {
  const list = lineup.golfers || lineup.golferNames || lineup.selectedGolfers || [];
  return Array.isArray(list) ? list : [];
}

function countGolferPicksFromLineups(dedupedLineups) {
  const counts = {};
  dedupedLineups.forEach((lineup) => {
    lineupGolferNamesForPicks(lineup).forEach((name) => {
      if (!name) return;
      counts[name] = (counts[name] || 0) + 1;
    });
  });
  return counts;
}

const GolferPicksStats = {
  tournamentAbbrevs: {
    'Masters': 'MAS',
    'PGA Championship': 'PGA',
    'U.S. Open': 'USO',
    'US Open': 'USO',
    'The Open': 'BRI',
    'British Open': 'BRI',
    'Open Championship': 'BRI'
  },

  chartColors: [
    '#2c5232',
    '#d4af37',
    '#2563eb',
    '#dc2626',
    '#7c3aed',
    '#0891b2',
    '#ea580c',
    '#4b5563'
  ],

  _tournamentStartDate(t) {
    if (!t.startDate) return 0;
    if (t.startDate.toDate) return t.startDate.toDate().getTime();
    if (t.startDate.seconds) return t.startDate.seconds * 1000;
    return new Date(t.startDate).getTime() || 0;
  },

  _tournamentSeason(t) {
    if (t.season != null && t.season !== '') {
      return Number(t.season);
    }
    const ms = this._tournamentStartDate(t);
    if (!ms) return null;
    return new Date(ms).getFullYear();
  },

  abbrevForTournament(t) {
    return t.abbrev || this.tournamentAbbrevs[t.name] || String(t.name || '').substring(0, 3).toUpperCase();
  },

  _isCompletedTournament(t) {
    return t.status === 'completed';
  },

  availableSeasons(allTournaments) {
    const years = new Set();
    allTournaments.forEach((t) => {
      if (!this._isCompletedTournament(t)) return;
      const y = this._tournamentSeason(t);
      if (y != null) years.add(y);
    });
    return [...years].sort((a, b) => b - a);
  },

  tournamentsForSeason(allTournaments, season) {
    const year = Number(season);
    return allTournaments.filter((t) => {
      if (!this._isCompletedTournament(t)) return false;
      const tSeason = this._tournamentSeason(t);
      return tSeason != null && tSeason === year;
    });
  },

  async buildAllSeasonPickData(allTournaments, seasons) {
    const bySeason = {};
    await Promise.all(seasons.map(async (year) => {
      const tournaments = this.tournamentsForSeason(allTournaments, year);
      bySeason[year] = tournaments.length
        ? await this.buildSeasonPickData(tournaments)
        : { tournaments: [], pickCountsByTournamentId: {}, totals: {} };
    }));
    return bySeason;
  },

  async fetchLineupsForTournament(tournamentId) {
    const snap = await firebaseDb.collection('lineups')
      .where('tournamentId', '==', tournamentId)
      .get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  },

  /**
   * @param {Array<object>} tournaments — already filtered to one season
   * @returns {{ tournaments: Array, pickCountsByTournamentId: Object, totals: Object }}
   */
  async buildSeasonPickData(tournaments) {
    const sorted = [...tournaments].sort(
      (a, b) => this._tournamentStartDate(a) - this._tournamentStartDate(b)
    );

    const pickCountsByTournamentId = {};
    const totals = {};

    await Promise.all(sorted.map(async (t) => {
      const forTournament = await this.fetchLineupsForTournament(t.id);
      const deduped = dedupeLineupDocumentsForPicks(forTournament);
      const counts = countGolferPicksFromLineups(deduped);
      pickCountsByTournamentId[t.id] = counts;

      Object.entries(counts).forEach(([name, n]) => {
        totals[name] = (totals[name] || 0) + n;
      });
    }));

    return { tournaments: sorted, pickCountsByTournamentId, totals };
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * @param {Array<{ label: string, title?: string }>} xAxis — one point per column
   */
  renderLineChart(container, xAxis, series, maxY, ariaLabel) {
    if (!xAxis.length) {
      container.innerHTML = '<p class="no-stat-data">No data to chart yet.</p>';
      return;
    }

    const width = 640;
    const height = 280;
    const padL = 44;
    const padR = 16;
    const padT = 16;
    const padB = 52;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const n = xAxis.length;
    const yMax = Math.max(maxY, 1);

    const xAt = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const yAt = (v) => padT + plotH - (v / yMax) * plotH;

    const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const y = padT + plotH * (1 - f);
      const val = Math.round(yMax * f);
      return `
        <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" class="picks-chart-grid"/>
        <text x="${padL - 8}" y="${y + 4}" text-anchor="end" class="picks-chart-axis">${val}</text>`;
    }).join('');

    const xLabels = xAxis.map((pt, i) => {
      const x = xAt(i);
      return `<text x="${x}" y="${height - 12}" text-anchor="middle" class="picks-chart-axis">${this.escapeHtml(pt.label)}</text>`;
    }).join('');

    const paths = series.map((s) => {
      const color = s.color || this.chartColors[0];
      const points = s.values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ');
      const dots = s.values.map((v, i) => {
        const tip = xAxis[i].title || xAxis[i].label;
        return `<circle cx="${xAt(i)}" cy="${yAt(v)}" r="4" fill="${color}" class="picks-chart-dot">
           <title>${this.escapeHtml(s.name)} — ${this.escapeHtml(tip)}: ${v}</title>
         </circle>`;
      }).join('');
      return `
        <polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" points="${points}"/>
        ${dots}`;
    }).join('');

    container.innerHTML = `
      <svg class="picks-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${this.escapeHtml(ariaLabel || 'Golfer pick counts')}">
        ${gridLines}
        <line x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}" class="picks-chart-axis-line"/>
        ${paths}
        ${xLabels}
      </svg>`;
  },

  _xAxisForTournaments(tournaments) {
    return tournaments.map((t) => ({
      label: this.abbrevForTournament(t),
      title: t.name
    }));
  },

  _xAxisForSeasons(seasonsAsc) {
    return seasonsAsc.map((y) => ({
      label: String(y),
      title: `${y} season total`
    }));
  },

  _grandTotalsAcrossSeasons(bySeason, seasons) {
    const grand = {};
    seasons.forEach((y) => {
      Object.entries(bySeason[y]?.totals || {}).forEach(([name, n]) => {
        grand[name] = (grand[name] || 0) + n;
      });
    });
    return grand;
  },

  _seriesColor(colorIndex) {
    return this.chartColors[colorIndex % this.chartColors.length];
  },

  _createSeriesItem(name, values, colorIndex) {
    return {
      name,
      visible: true,
      values,
      color: this._seriesColor(colorIndex)
    };
  },

  _seriesForSeasonTotals(golfers, seasonsAsc, bySeason) {
    return golfers.map((name, i) => this._createSeriesItem(
      name,
      seasonsAsc.map((y) => bySeason[y]?.totals?.[name] || 0),
      i
    ));
  },

  renderSeasonTotalsTable(container, seasonsAsc, bySeason) {
    const grand = this._grandTotalsAcrossSeasons(bySeason, seasonsAsc);
    const golfers = Object.keys(grand).sort(
      (a, b) => grand[b] - grand[a] || a.localeCompare(b)
    );

    if (!golfers.length) {
      container.innerHTML = '<p class="no-stat-data">No picks recorded across these seasons yet.</p>';
      return;
    }

    const headers = seasonsAsc.map((y) => `<th scope="col">${y}</th>`).join('');
    const rows = golfers.map((name) => {
      const cells = seasonsAsc.map((y) => {
        const n = bySeason[y]?.totals?.[name] || 0;
        return `<td class="num">${n}</td>`;
      }).join('');
      return `
        <tr>
          <td class="player">${this.escapeHtml(name)}</td>
          ${cells}
          <td class="num picks-total-col"><strong>${grand[name]}</strong></td>
        </tr>`;
    }).join('');

    container.innerHTML = `
      <div class="picks-table-scroll">
        <table class="season-standings-table picks-stats-table">
          <thead>
            <tr>
              <th scope="col" class="player">Golfer</th>
              ${headers}
              <th scope="col" class="picks-total-col">All seasons</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  },

  mountSeasonOverview(bySeason, seasonsDesc) {
    const seasonsAsc = [...seasonsDesc].sort((a, b) => a - b);
    const chartEl = document.getElementById('golfer-picks-season-chart');
    const legendEl = document.getElementById('golfer-picks-season-legend');
    const tableEl = document.getElementById('golfer-picks-season-table');
    if (!chartEl) return;

    const grand = this._grandTotalsAcrossSeasons(bySeason, seasonsAsc);
    if (!Object.keys(grand).length) {
      chartEl.innerHTML = '<p class="no-stat-data">No picks recorded across seasons yet.</p>';
      if (legendEl) legendEl.innerHTML = '';
      if (tableEl) tableEl.innerHTML = '';
      return;
    }

    const chartGolfers = this._defaultChartGolfers(grand, 5);
    let series = this._seriesForSeasonTotals(chartGolfers, seasonsAsc, bySeason);
    const xAxis = this._xAxisForSeasons(seasonsAsc);

    const refreshChart = () => {
      const visible = series.filter((s) => s.visible !== false);
      if (!visible.length) {
        chartEl.innerHTML = '<p class="no-stat-data">Select at least one golfer in the legend.</p>';
        return;
      }
      this.renderLineChart(
        chartEl,
        xAxis,
        visible,
        this._maxInSeries(series),
        'Golfer pick counts by season'
      );
    };

    if (legendEl) {
      this.renderLegend(legendEl, series, refreshChart);
    }
    refreshChart();
    if (tableEl) {
      this.renderSeasonTotalsTable(tableEl, seasonsAsc, bySeason);
    }
  },

  renderLegend(container, series, onToggle) {
    container.innerHTML = series.map((s, i) => {
      const color = s.color || this._seriesColor(i);
      const checked = s.visible !== false ? 'checked' : '';
      return `
        <label class="picks-legend-item">
          <input type="checkbox" data-series-index="${i}" ${checked}>
          <span class="picks-legend-swatch" style="background:${color}"></span>
          <span>${this.escapeHtml(s.name)}</span>
        </label>`;
    }).join('');

    container.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.seriesIndex, 10);
        if (series[idx]) series[idx].visible = input.checked;
        onToggle();
      });
    });
  },

  _escAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  },

  _picksTableSortDefaultDescending(col) {
    return col !== 'player';
  },

  _sortPicksGolfers(golfers, sortCfg, pickCountsByTournamentId, totals) {
    const { col, descending } = sortCfg;
    return [...golfers].sort((a, b) => {
      let cmp = 0;
      if (col === 'player') {
        cmp = a.localeCompare(b, undefined, { sensitivity: 'base' });
      } else if (col === 'total') {
        cmp = (totals[a] || 0) - (totals[b] || 0);
      } else if (col.startsWith('tid:')) {
        const tid = col.slice(4);
        cmp = (pickCountsByTournamentId[tid]?.[a] || 0) - (pickCountsByTournamentId[tid]?.[b] || 0);
      }
      if (cmp !== 0) return descending ? -cmp : cmp;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
  },

  _thSortPicks(colKey, innerHtml, sortCfg, classNames = '') {
    const sortCls = sortCfg.col === colKey
      ? (sortCfg.descending ? 'sorted-desc' : 'sorted-asc')
      : '';
    return `<th class="${classNames} stats-sort-col ${sortCls}" scope="col" `
      + `data-picks-sort-col="${this._escAttr(colKey)}">${innerHtml}`
      + '<span class="sort-indicator" aria-hidden="true"></span></th>';
  },

  attachPicksTableSort(container) {
    if (container._picksSortHandler) return;

    const fn = (e) => {
      const th = e.target.closest('th[data-picks-sort-col]');
      if (!th || !container.contains(th)) return;
      const state = container._picksTableState;
      if (!state) return;

      const col = th.getAttribute('data-picks-sort-col');
      if (!col) return;
      e.preventDefault();

      const btn = container.querySelector('.picks-table-expand-btn');
      if (btn) {
        state.expanded = btn.getAttribute('aria-expanded') === 'true';
      }

      if (state.sort.col === col) {
        state.sort = { col, descending: !state.sort.descending };
      } else {
        state.sort = { col, descending: this._picksTableSortDefaultDescending(col) };
      }

      this.renderTable(
        container,
        state.tournaments,
        state.totals,
        state.pickCountsByTournamentId,
        {
          defaultLimit: state.defaultLimit,
          sort: state.sort,
          expanded: state.expanded
        }
      );
    };

    container._picksSortHandler = fn;
    container.addEventListener('click', fn);
  },

  renderTable(container, tournaments, totals, pickCountsByTournamentId, options = {}) {
    const defaultLimit = options.defaultLimit ?? 5;
    const allGolfers = Object.keys(totals);

    if (!allGolfers.length) {
      container.innerHTML = '<p class="no-stat-data">No lineup picks recorded for this season yet.</p>';
      container._picksTableState = null;
      return;
    }

    const prev = container._picksTableState;
    const sort = options.sort || prev?.sort || { col: 'total', descending: true };
    const expanded = options.expanded != null ? options.expanded : (prev?.expanded || false);

    container._picksTableState = {
      tournaments,
      totals,
      pickCountsByTournamentId,
      defaultLimit,
      sort,
      expanded
    };

    const golfers = this._sortPicksGolfers(allGolfers, sort, pickCountsByTournamentId, totals);

    const sortCfg = sort;
    const tournamentHeaders = tournaments.map((t) =>
      this._thSortPicks(
        `tid:${t.id}`,
        `<span title="${this.escapeHtml(t.name)}">${this.escapeHtml(this.abbrevForTournament(t))}</span>`,
        sortCfg,
        'tournament'
      )
    ).join('');

    const rows = golfers.map((name) => {
      const cells = tournaments.map((t) => {
        const n = pickCountsByTournamentId[t.id]?.[name] || 0;
        return `<td class="num">${n}</td>`;
      }).join('');
      return `
        <tr data-golfer="${this.escapeHtml(name)}">
          <td class="player">${this.escapeHtml(name)}</td>
          ${cells}
          <td class="num picks-total-col"><strong>${totals[name]}</strong></td>
        </tr>`;
    }).join('');

    const canCollapse = golfers.length > defaultLimit;
    const collapsedClass = canCollapse && !expanded ? ' picks-stats-table--collapsed' : '';

    container.innerHTML = `
      <div class="picks-table-scroll">
        <table class="season-standings-table picks-stats-table${collapsedClass}" data-picks-row-limit="${defaultLimit}">
          <thead>
            <tr>
              ${this._thSortPicks('player', 'Golfer', sortCfg, 'player')}
              ${tournamentHeaders}
              ${this._thSortPicks('total', 'Total', sortCfg, 'picks-total-col')}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${canCollapse ? `
        <button type="button" class="btn btn-outline picks-table-expand-btn" aria-expanded="${expanded ? 'true' : 'false'}">
          ${expanded ? 'Show top 5 only' : `Show all ${golfers.length} golfers`}
        </button>
      ` : ''}`;

    this.attachPicksTableSort(container);

    if (canCollapse) {
      const table = container.querySelector('.picks-stats-table');
      const btn = container.querySelector('.picks-table-expand-btn');
      btn.addEventListener('click', () => {
        const isExpanded = btn.getAttribute('aria-expanded') === 'true';
        const nextExpanded = !isExpanded;
        container._picksTableState.expanded = nextExpanded;
        btn.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        table.classList.toggle('picks-stats-table--collapsed', !nextExpanded);
        btn.textContent = nextExpanded
          ? 'Show top 5 only'
          : `Show all ${golfers.length} golfers`;
      });
    }
  },

  _defaultChartGolfers(totals, limit = 5) {
    return Object.keys(totals)
      .sort((a, b) => totals[b] - totals[a] || a.localeCompare(b))
      .slice(0, limit);
  },

  _seriesForGolfers(golfers, tournaments, pickCountsByTournamentId) {
    return golfers.map((name, i) => this._createSeriesItem(
      name,
      tournaments.map((t) => pickCountsByTournamentId[t.id]?.[name] || 0),
      i
    ));
  },

  _maxInSeries(series) {
    let m = 0;
    series.forEach((s) => {
      if (s.visible === false) return;
      s.values.forEach((v) => { if (v > m) m = v; });
    });
    return m;
  },

  _seasonSelectOptions(seasons, selectedSeason) {
    return seasons.map((y) =>
      `<option value="${y}"${Number(y) === Number(selectedSeason) ? ' selected' : ''}>${y}</option>`
    ).join('');
  },

  async loadDetailForSeason(allTournaments, seasons, season) {
    const detailWrap = document.getElementById('golfer-picks-detail-wrap');
    if (!detailWrap) return;

    detailWrap.innerHTML = `<div class="loading">Loading ${season}…</div>`;

    const tournaments = this.tournamentsForSeason(allTournaments, season);
    if (!tournaments.length) {
      detailWrap.innerHTML = `<p class="no-stat-data">No completed tournaments for the ${season} season yet.</p>`;
      return;
    }

    const { tournaments: sorted, pickCountsByTournamentId, totals } =
      await this.buildSeasonPickData(tournaments);

    this.mountSeasonDetail(season, sorted, pickCountsByTournamentId, totals, allTournaments, seasons);
  },

  mountSeasonDetail(season, sorted, pickCountsByTournamentId, totals, allTournaments, seasons) {
    const detailWrap = document.getElementById('golfer-picks-detail-wrap');
    if (!detailWrap) return;

    const seasonToolbarHtml = seasons.length
      ? `
        <div class="picks-season-toolbar">
          <label class="picks-chart-control">
            <span>Season</span>
            <select id="golfer-picks-chart-season-select" class="tournament-selector" aria-label="Season">
              ${this._seasonSelectOptions(seasons, season)}
            </select>
          </label>
        </div>`
      : '';

    const wireSeasonSelect = () => {
      const seasonSelectEl = document.getElementById('golfer-picks-chart-season-select');
      if (!seasonSelectEl || !allTournaments || !seasons) return;
      seasonSelectEl.onchange = () => {
        const y = parseInt(seasonSelectEl.value, 10);
        if (typeof App !== 'undefined') {
          App.picksStatsSelectedSeason = y;
        }
        this.loadDetailForSeason(allTournaments, seasons, y);
      };
    };

    if (!Object.keys(totals).length) {
      detailWrap.innerHTML = `
        ${seasonToolbarHtml}
        <p class="no-stat-data">No lineup picks found for the ${season} season yet.</p>`;
      wireSeasonSelect();
      return;
    }

    detailWrap.innerHTML = `
      ${seasonToolbarHtml}
      <div id="golfer-picks-chart-wrap">
        <div id="golfer-picks-chart"></div>
        <div id="golfer-picks-legend" class="picks-legend"></div>
        <div class="picks-chart-controls">
          <label class="picks-chart-control">
            <span>Add to chart</span>
            <select id="golfer-picks-add-golfer" class="tournament-selector" aria-label="Add golfer to chart"></select>
          </label>
        </div>
      </div>
      <h3 class="picks-table-heading">Pick counts by tournament</h3>
      <div id="golfer-picks-table"></div>
    `;

    wireSeasonSelect();

    const chartEl = document.getElementById('golfer-picks-chart');
    const legendEl = document.getElementById('golfer-picks-legend');
    const tableEl = document.getElementById('golfer-picks-table');
    const selectEl = document.getElementById('golfer-picks-add-golfer');
    const xAxis = this._xAxisForTournaments(sorted);

    let chartGolfers = this._defaultChartGolfers(totals, 5);
    let series = this._seriesForGolfers(chartGolfers, sorted, pickCountsByTournamentId);

    const refreshChart = () => {
      const visible = series.filter((s) => s.visible !== false);
      if (!chartEl) return;
      if (!visible.length) {
        chartEl.innerHTML = '<p class="no-stat-data">Select at least one golfer in the legend.</p>';
        return;
      }
      this.renderLineChart(
        chartEl,
        xAxis,
        visible,
        this._maxInSeries(series),
        `Golfer pick counts by tournament in ${season}`
      );
    };

    const refreshLegend = () => {
      this.renderLegend(legendEl, series, refreshChart);
    };

    refreshLegend();
    refreshChart();
    this.renderTable(tableEl, sorted, totals, pickCountsByTournamentId, { defaultLimit: 5 });

    if (selectEl) {
      const addGolferOptions = (golfers) => {
        selectEl.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Add golfer to chart…';
        selectEl.appendChild(placeholder);
        golfers
          .filter((g) => !chartGolfers.includes(g))
          .sort((a, b) => a.localeCompare(b))
          .forEach((g) => {
            const opt = document.createElement('option');
            opt.value = g;
            opt.textContent = g;
            selectEl.appendChild(opt);
          });
      };
      addGolferOptions(Object.keys(totals));

      selectEl.onchange = () => {
        const name = selectEl.value;
        if (!name || chartGolfers.includes(name)) return;
        if (chartGolfers.length >= 8) {
          chartGolfers.shift();
          series.shift();
        }
        chartGolfers.push(name);
        series.push(this._createSeriesItem(
          name,
          sorted.map((t) => pickCountsByTournamentId[t.id]?.[name] || 0),
          series.length
        ));
        selectEl.value = '';
        refreshLegend();
        refreshChart();
        addGolferOptions(Object.keys(totals));
      };
    }
  },

  async loadDashboard(allTournaments, selectedSeason) {
    const body = document.getElementById('golfer-picks-body');
    if (!body) return;

    const seasons = this.availableSeasons(allTournaments);
    const season = Number(selectedSeason) || seasons[0];
    const showOverview = seasons.length > 1;

    let overviewHtml = '';
    if (showOverview) {
      overviewHtml = `
        <div id="golfer-picks-overview-wrap" class="picks-overview-wrap">
          <h3 class="picks-table-heading">Season totals</h3>
          <div id="golfer-picks-season-chart"></div>
          <div id="golfer-picks-season-legend" class="picks-legend"></div>
          <div id="golfer-picks-season-table"></div>
        </div>`;
    }

    body.innerHTML = `${overviewHtml}
      <div id="golfer-picks-detail-wrap">
        <div class="loading">Loading ${season}…</div>
      </div>`;

    if (showOverview) {
      const bySeason = await this.buildAllSeasonPickData(allTournaments, seasons);
      this.mountSeasonOverview(bySeason, seasons);
    }

    const tournaments = this.tournamentsForSeason(allTournaments, season);
    if (!tournaments.length) {
      const detailWrap = document.getElementById('golfer-picks-detail-wrap');
      if (detailWrap) {
        detailWrap.innerHTML = `<p class="no-stat-data">No completed tournaments for the ${season} season yet.</p>`;
      }
      return;
    }

    await this.loadDetailForSeason(allTournaments, seasons, season);
  }
};
