const DB_NAME = 'UkraTimerDB';
const DB_VERSION = 1;
const STORAGE_PREFIX = 'cubetimer_';

let _db = null;

function _sessionOrderValue(session) {
    return Number.isFinite(session?.order) ? session.order : Number.POSITIVE_INFINITY;
}

function _compareSessions(a, b) {
    const orderDiff = _sessionOrderValue(a) - _sessionOrderValue(b);
    if (orderDiff !== 0) return orderDiff;

    const createdAtA = Number.isFinite(a?.createdAt) ? a.createdAt : Number.POSITIVE_INFINITY;
    const createdAtB = Number.isFinite(b?.createdAt) ? b.createdAt : Number.POSITIVE_INFINITY;
    if (createdAtA !== createdAtB) return createdAtA - createdAtB;

    return String(a?.name || '').localeCompare(String(b?.name || ''));
}

/**
 * Open (or create/upgrade) the IndexedDB database.
 * On first run, migrates data from localStorage if present.
 * @returns {Promise<IDBDatabase>}
 */
export async function openDB() {
    if (_db) return _db;

    _db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains('sessions')) {
                db.createObjectStore('sessions', { keyPath: 'id' });
            }

            if (!db.objectStoreNames.contains('solves')) {
                const solveStore = db.createObjectStore('solves', { keyPath: 'id' });
                solveStore.createIndex('sessionId', 'sessionId', { unique: false });
            }
        };

        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });

    // Migrate from localStorage on first run
    await _migrateFromLocalStorage();

    return _db;
}

// ──── Migration ────

async function _migrateFromLocalStorage() {
    const raw = localStorage.getItem(STORAGE_PREFIX + 'sessions');
    if (!raw) return; // No old data to migrate

    let oldSessions;
    try {
        oldSessions = JSON.parse(raw);
    } catch (e) {
        console.warn('Failed to parse old sessions for migration:', e);
        return;
    }

    if (!Array.isArray(oldSessions) || oldSessions.length === 0) return;

    // Check if solves are embedded (old format)
    const hasEmbeddedSolves = oldSessions.some(s => Array.isArray(s.solves));
    if (!hasEmbeddedSolves) return; // Already migrated or empty

    console.log('Migrating from localStorage to IndexedDB...');

    const tx = _db.transaction(['sessions', 'solves'], 'readwrite');
    const sessionStore = tx.objectStore('sessions');
    const solveStore = tx.objectStore('solves');

    for (const session of oldSessions) {
        // Write session metadata (without solves)
        sessionStore.put({
            id: session.id,
            name: session.name,
            createdAt: session.createdAt,
            order: Number.isFinite(session.order) ? session.order : 0,
        });

        // Write individual solves
        if (Array.isArray(session.solves)) {
            for (const solve of session.solves) {
                solveStore.put({
                    ...solve,
                    sessionId: session.id,
                });
            }
        }
    }

    await _txComplete(tx);

    // Remove old localStorage key
    localStorage.removeItem(STORAGE_PREFIX + 'sessions');
    console.log('Migration complete.');
}

// ──── Sessions ────

export async function getAllSessions() {
    const db = await openDB();
    const sessions = await _getAll(db, 'sessions');
    sessions.sort(_compareSessions);
    return sessions;
}

export async function addSession(session) {
    const db = await openDB();
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put(session);
    return _txComplete(tx);
}

export async function updateSession(session) {
    const db = await openDB();
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put(session);
    return _txComplete(tx);
}

export async function deleteSession(sessionId) {
    const db = await openDB();
    const tx = db.transaction(['sessions', 'solves'], 'readwrite');
    tx.objectStore('sessions').delete(sessionId);

    // Delete all solves for this session
    const solveStore = tx.objectStore('solves');
    const index = solveStore.index('sessionId');
    const range = IDBKeyRange.only(sessionId);
    const cursor = index.openCursor(range);

    await new Promise((resolve, reject) => {
        cursor.onsuccess = (event) => {
            const c = event.target.result;
            if (c) {
                c.delete();
                c.continue();
            } else {
                resolve();
            }
        };
        cursor.onerror = (event) => reject(event.target.error);
    });

    return _txComplete(tx);
}

// ──── Solves ────

export async function getSolvesBySession(sessionId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('solves', 'readonly');
        const store = tx.objectStore('solves');
        const index = store.index('sessionId');
        const request = index.getAll(sessionId);

        request.onsuccess = () => {
            // Sort by timestamp ascending (oldest first)
            const solves = request.result;
            solves.sort((a, b) => a.timestamp - b.timestamp);
            resolve(solves);
        };
        request.onerror = (event) => reject(event.target.error);
    });
}

export async function getSolveCountBySession(sessionId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('solves', 'readonly');
        const store = tx.objectStore('solves');
        const index = store.index('sessionId');
        const request = index.count(sessionId);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

export async function addSolve(solve) {
    const db = await openDB();
    const tx = db.transaction('solves', 'readwrite');
    tx.objectStore('solves').put(solve);
    return _txComplete(tx);
}

export async function updateSolve(solve) {
    const db = await openDB();
    const tx = db.transaction('solves', 'readwrite');
    tx.objectStore('solves').put(solve);
    return _txComplete(tx);
}

export async function updateSolves(solves, { batchSize = 2000, onProgress = null } = {}) {
    if (!Array.isArray(solves) || solves.length === 0) return;
    const db = await openDB();
    const size = Math.max(1, Math.floor(batchSize));
    let completed = 0;

    for (let index = 0; index < solves.length; index += size) {
        const tx = db.transaction('solves', 'readwrite');
        const store = tx.objectStore('solves');
        const batch = solves.slice(index, index + size);

        for (const solve of batch) {
            store.put(solve);
        }

        await _txComplete(tx);
        completed += batch.length;
        if (typeof onProgress === 'function') {
            onProgress({
                completed,
                total: solves.length,
            });
        }
    }
}

export async function deleteSolve(solveId) {
    const db = await openDB();
    const tx = db.transaction('solves', 'readwrite');
    tx.objectStore('solves').delete(solveId);
    return _txComplete(tx);
}

export async function deleteSolves(solveIds, { batchSize = 2000, onProgress = null } = {}) {
    if (!Array.isArray(solveIds) || solveIds.length === 0) return;
    const db = await openDB();
    const size = Math.max(1, Math.floor(batchSize));
    let completed = 0;

    for (let index = 0; index < solveIds.length; index += size) {
        const tx = db.transaction('solves', 'readwrite');
        const store = tx.objectStore('solves');
        const batch = solveIds.slice(index, index + size);

        for (const solveId of batch) {
            store.delete(solveId);
        }

        await _txComplete(tx);
        completed += batch.length;
        if (typeof onProgress === 'function') {
            onProgress({
                completed,
                total: solveIds.length,
            });
        }
    }
}

// ──── Bulk Operations (import/export) ────

/**
 * Get all data from the database.
 * @returns {Promise<{ sessions: object[], solves: object[] }>}
 */
export async function getAllData() {
    const db = await openDB();
    const tx = db.transaction(['sessions', 'solves'], 'readonly');
    const sessions = await _getAllFromStore(tx.objectStore('sessions'));
    const solves = await _getAllFromStore(tx.objectStore('solves'));
    sessions.sort(_compareSessions);
    return { sessions, solves };
}

/**
 * Replace all data in the database (for import).
 * Clears existing data first.
 * @param {object[]} sessions
 * @param {object[]} solves
 */
export async function replaceAllData(sessions, solves, { batchSize = 2000, onProgress = null } = {}) {
    const db = await openDB();
    const size = Math.max(1, Math.floor(batchSize));
    const total = 1 + sessions.length + solves.length;
    let completed = 0;

    if (typeof onProgress === 'function') {
        onProgress({
            stage: 'clearing',
            completed,
            total,
        });
    }

    const clearTx = db.transaction(['sessions', 'solves'], 'readwrite');
    clearTx.objectStore('sessions').clear();
    clearTx.objectStore('solves').clear();
    await _txComplete(clearTx);

    completed += 1;
    if (typeof onProgress === 'function') {
        onProgress({
            stage: 'sessions',
            completed,
            total,
        });
    }

    for (let index = 0; index < sessions.length; index += size) {
        const tx = db.transaction('sessions', 'readwrite');
        const store = tx.objectStore('sessions');
        const batch = sessions.slice(index, index + size);

        for (const session of batch) {
            store.put(session);
        }

        await _txComplete(tx);
        completed += batch.length;
        if (typeof onProgress === 'function') {
            onProgress({
                stage: 'sessions',
                completed,
                total,
            });
        }
    }

    if (typeof onProgress === 'function') {
        onProgress({
            stage: 'solves',
            completed,
            total,
        });
    }

    for (let index = 0; index < solves.length; index += size) {
        const tx = db.transaction('solves', 'readwrite');
        const store = tx.objectStore('solves');
        const batch = solves.slice(index, index + size);

        for (const solve of batch) {
            store.put(solve);
        }

        await _txComplete(tx);
        completed += batch.length;
        if (typeof onProgress === 'function') {
            onProgress({
                stage: 'solves',
                completed,
                total,
            });
        }
    }
}

// ──── Helpers ────

function _txComplete(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => reject(event.target.error);
        tx.onabort = (event) => reject(event.target.error || new Error('Transaction aborted'));
    });
}

function _getAll(db, storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

function _getAllFromStore(store) {
    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}
