// Account merge helpers — combine duplicate Firebase Auth identities for one player.
const AccountMerges = {
  merges: [],
  aliasToCanonical: new Map(),
  loaded: false,

  invalidateCache() {
    this.merges = [];
    this.aliasToCanonical.clear();
    this.loaded = false;
  },

  async loadMerges(force = false) {
    if (this.loaded && !force) return this.merges;

    try {
      const doc = await firebaseDb.collection('config').doc('accountMerges').get();
      this.merges = doc.exists ? (doc.data().merges || []) : [];
    } catch (error) {
      console.warn('Could not load account merges:', error);
      this.merges = [];
    }

    this.aliasToCanonical.clear();
    for (const merge of this.merges) {
      const canonical = merge.canonicalUserId;
      if (!canonical) continue;
      for (const uid of merge.userIds || []) {
        this.aliasToCanonical.set(uid, canonical);
      }
    }

    this.loaded = true;
    return this.merges;
  },

  resolveUserId(userId) {
    if (!userId) return userId;
    return this.aliasToCanonical.get(userId) || userId;
  },

  getEffectiveUserId(userId) {
    return this.resolveUserId(userId);
  },

  findMergeContaining(userId) {
    if (!userId) return null;
    return this.merges.find((merge) => (merge.userIds || []).includes(userId)) || null;
  },

  getDisplayName(userId, fallback = '') {
    const canonical = this.resolveUserId(userId);
    const merge = this.findMergeContaining(canonical);
    return merge?.displayName || fallback;
  },

  isSamePlayer(userIdA, userIdB) {
    if (!userIdA || !userIdB) return false;
    return this.resolveUserId(userIdA) === this.resolveUserId(userIdB);
  },

  normalizeEmail(email) {
    return (email || '').trim().toLowerCase();
  },

  collectEmailsFromUserDoc(data) {
    const emails = new Set();
    if (!data) return emails;
    const primary = this.normalizeEmail(data.email);
    if (primary) emails.add(primary);
    (data.emails || []).forEach((e) => {
      const normalized = this.normalizeEmail(e);
      if (normalized) emails.add(normalized);
    });
    return emails;
  },

  async fetchUserProfile(userId) {
    try {
      const doc = await firebaseDb.collection('users').doc(userId).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (error) {
      console.warn('Could not load user profile:', userId, error);
      return null;
    }
  },

  async collectEmailsForUserIds(userIds) {
    const emails = new Set();
    for (const userId of userIds) {
      const merge = this.findMergeContaining(userId);
      (merge?.emails || []).forEach((e) => {
        const normalized = this.normalizeEmail(e);
        if (normalized) emails.add(normalized);
      });
      const profile = await this.fetchUserProfile(userId);
      this.collectEmailsFromUserDoc(profile).forEach((e) => emails.add(e));
    }
    return [...emails];
  },

  consolidateStandings(standings) {
    if (!standings?.length || !this.aliasToCanonical.size) return standings;

    const byCanonical = new Map();
    for (const player of standings) {
      const canonicalId = this.resolveUserId(player.userId);
      const displayName = this.getDisplayName(canonicalId, player.displayName) || player.displayName;
      const normalized = { ...player, userId: canonicalId, displayName };

      if (!byCanonical.has(canonicalId)) {
        byCanonical.set(canonicalId, normalized);
        continue;
      }

      const existing = byCanonical.get(canonicalId);
      if (normalized.totalToPar < existing.totalToPar) {
        byCanonical.set(canonicalId, normalized);
      }
    }

    return Array.from(byCanonical.values());
  },

  async mergeAccounts({ primaryUserId, secondaryUserId, displayName, extraEmails = [], mergedBy }) {
    if (!primaryUserId || !secondaryUserId) {
      throw new Error('Select both a primary account and an account to merge into it.');
    }
    if (primaryUserId === secondaryUserId) {
      throw new Error('Choose two different accounts.');
    }

    const trimmedName = (displayName || '').trim();
    if (!trimmedName) {
      throw new Error('Enter the display name to use on leaderboards.');
    }

    await this.loadMerges(true);

    const primaryMerge = this.findMergeContaining(primaryUserId);
    const secondaryMerge = this.findMergeContaining(secondaryUserId);

    if (secondaryMerge && secondaryMerge.canonicalUserId !== (primaryMerge?.canonicalUserId || primaryUserId)) {
      throw new Error('The account to merge is already linked to a different primary account.');
    }

    let mergeRecord = primaryMerge;
    const mergedAt = firebase.firestore.Timestamp.now();
    if (!mergeRecord) {
      mergeRecord = {
        canonicalUserId: primaryUserId,
        displayName: trimmedName,
        userIds: [primaryUserId],
        emails: [],
        mergedAt,
        mergedBy: mergedBy || null
      };
      this.merges.push(mergeRecord);
    } else {
      mergeRecord.displayName = trimmedName;
      mergeRecord.mergedAt = mergedAt;
      mergeRecord.mergedBy = mergedBy || null;
    }

    if (!mergeRecord.userIds.includes(secondaryUserId)) {
      mergeRecord.userIds.push(secondaryUserId);
    }
    if (!mergeRecord.userIds.includes(mergeRecord.canonicalUserId)) {
      mergeRecord.userIds.unshift(mergeRecord.canonicalUserId);
    }

    const emails = new Set(await this.collectEmailsForUserIds([primaryUserId, secondaryUserId, ...(mergeRecord.userIds || [])]));
    extraEmails.forEach((e) => {
      const normalized = this.normalizeEmail(e);
      if (normalized) emails.add(normalized);
    });
    mergeRecord.emails = [...emails].sort();

    const canonicalUserId = mergeRecord.canonicalUserId;
    const canonicalLineupsSnap = await firebaseDb.collection('lineups')
      .where('userId', '==', canonicalUserId)
      .get();
    const canonicalKeys = new Set(canonicalLineupsSnap.docs.map((doc) => {
      const data = doc.data();
      return `${data.tournamentId}|${data.lineupType || 'rounds_1_2'}`;
    }));

    const secondaryLineupsSnap = await firebaseDb.collection('lineups')
      .where('userId', '==', secondaryUserId)
      .get();

    let movedLineups = 0;
    let removedDuplicates = 0;
    const batch = firebaseDb.batch();

    secondaryLineupsSnap.forEach((doc) => {
      const data = doc.data();
      const key = `${data.tournamentId}|${data.lineupType || 'rounds_1_2'}`;
      if (canonicalKeys.has(key)) {
        batch.delete(doc.ref);
        removedDuplicates += 1;
      } else {
        batch.update(doc.ref, {
          userId: canonicalUserId,
          userDisplayName: trimmedName
        });
        canonicalKeys.add(key);
        movedLineups += 1;
      }
    });

    const secondaryProfile = await this.fetchUserProfile(secondaryUserId);
    const canonicalUserRef = firebaseDb.collection('users').doc(canonicalUserId);

    batch.set(canonicalUserRef, {
      displayName: trimmedName,
      emails: mergeRecord.emails,
      mergedUserIds: mergeRecord.userIds.filter((uid) => uid !== canonicalUserId),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    if (secondaryProfile) {
      batch.set(firebaseDb.collection('users').doc(secondaryUserId), {
        mergedInto: canonicalUserId,
        mergedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    batch.set(firebaseDb.collection('config').doc('accountMerges'), {
      merges: this.merges
    }, { merge: true });

    await batch.commit();
    this.invalidateCache();
    await this.loadMerges(true);

    return { movedLineups, removedDuplicates, mergeRecord };
  }
};
