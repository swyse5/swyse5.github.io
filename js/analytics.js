/**
 * Signed-in site usage for admin dashboards.
 * Firestore collections:
 *   - siteUsageByUser/{uid} — rollups per user (sessions + visible seconds)
 *   - sitePresenceBuckets/{dow}_{hour} — heatmap pings in **UTC**
 *     (`getUTCDay()` / `getUTCHours()`, 0 = Sunday UTC … 6 = Saturday UTC)
 */
const SiteAnalytics = {
  /** Foreground tick interval; also sets seconds credited per tick (ms / 1000). */
  HEARTBEAT_MS: 60000,
  VERSION: '1',
  _intervalId: null,
  _uid: null,

  _sessionStorageKey() {
    return `majors_site_usage_sess_v${this.VERSION}`;
  },

  start(user) {
    if (!user || typeof firebaseDb === 'undefined' || !firebase?.firestore) return;
    this.stop();
    this._uid = user.uid;

    const ref = firebaseDb.collection('siteUsageByUser').doc(user.uid);
    const email = user.email || '';
    const displayName = user.displayName || (email ? email.split('@')[0] : 'Unknown');

    const isNewBrowserSession = !sessionStorage.getItem(this._sessionStorageKey());
    if (isNewBrowserSession) {
      sessionStorage.setItem(this._sessionStorageKey(), '1');
    }

    const basePayload = {
      email,
      displayName,
      lastActiveAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    const opener = {};
    if (isNewBrowserSession) {
      opener.sessionStarts = firebase.firestore.FieldValue.increment(1);
    }

    ref.set({ ...basePayload, ...opener }, { merge: true }).catch((e) => {
      console.warn('SiteAnalytics: session start write failed', e);
    });

    const tick = () => {
      if (document.visibilityState !== 'visible' || !this._uid) return;
      const secs = Math.round(this.HEARTBEAT_MS / 1000);
      ref
        .set(
          {
            email,
            displayName,
            totalActiveSeconds: firebase.firestore.FieldValue.increment(secs),
            lastActiveAt: firebase.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        )
        .catch((err) => {
          if (!SiteAnalytics._warnedHeartbeat) {
            SiteAnalytics._warnedHeartbeat = true;
            console.warn(
              'SiteAnalytics: heartbeat write failed — merge firestore.rules for siteUsageByUser (authenticated user must write own uid)',
              err
            );
          }
        });

      // Same instant for everyone: bucket by UTC weekday × UTC hour (0=Sun UTC … 6=Sat UTC).
      const now = new Date();
      const bucketId = `${now.getUTCDay()}_${now.getUTCHours()}`;
      firebaseDb
        .collection('sitePresenceBuckets')
        .doc(bucketId)
        .set({ count: firebase.firestore.FieldValue.increment(1) }, { merge: true })
        .catch((err) => {
          if (!SiteAnalytics._warnedPresence) {
            SiteAnalytics._warnedPresence = true;
            console.warn('SiteAnalytics: presence bucket write failed — check sitePresenceBuckets rules.', err);
          }
        });
    };

    this._intervalId = window.setInterval(tick, this.HEARTBEAT_MS);
  },

  stop() {
    if (this._intervalId) {
      window.clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._uid = null;
    this._warnedHeartbeat = false;
    this._warnedPresence = false;
  },

  /** Admin dashboard helpers */
  formatDuration(totalSeconds) {
    const s = Math.max(0, Math.round(Number(totalSeconds || 0)));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${r}s`;
    return `${s}s`;
  },

  async fetchStatsForDashboard() {
    const snap = await firebaseDb.collection('siteUsageByUser').get();
    return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  },

  /**
   * @returns {{ [bucketKey: string]: number }} Keys `d_h` — UTC dow (0 Sun) and hour 0–23.
   */
  async fetchPresenceBucketsForDashboard() {
    const snap = await firebaseDb.collection('sitePresenceBuckets').get();
    const m = {};
    snap.forEach((doc) => {
      const raw = doc.data()?.count;
      const n = typeof raw === 'number' ? raw : Number(raw || 0);
      m[doc.id] = Number.isFinite(n) ? n : 0;
    });
    return m;
  }
};
