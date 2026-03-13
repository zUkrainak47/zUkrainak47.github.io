import * as db from './db.js';

const STORAGE_PREFIX = 'cubetimer_';
const STORAGE_VERSION = 1;

/**
 * Load data from localStorage.
 * @param {string} key
 * @param {*} defaultValue
 * @returns {*}
 */
export function load(key, defaultValue = null) {
    try {
        const raw = localStorage.getItem(STORAGE_PREFIX + key);
        if (raw === null) return defaultValue;
        const parsed = JSON.parse(raw);
        return parsed;
    } catch (e) {
        console.warn(`Failed to load "${key}" from storage:`, e);
        return defaultValue;
    }
}

/**
 * Save data to localStorage.
 * @param {string} key
 * @param {*} data
 */
export function save(key, data) {
    try {
        localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data));
    } catch (e) {
        console.warn(`Failed to save "${key}" to storage:`, e);
    }
}

/**
 * Remove a key from localStorage.
 * @param {string} key
 */
export function remove(key) {
    localStorage.removeItem(STORAGE_PREFIX + key);
}

/**
 * Export all timer data as a single JSON object.
 * Reads sessions + solves from IndexedDB, settings from localStorage.
 * @returns {Promise<object>}
 */
export async function exportAll() {
    const { sessions, solves } = await db.getAllData();

    // Reconstruct the old embedded format for export compatibility
    const sessionsWithSolves = sessions.map(session => ({
        ...session,
        solves: solves
            .filter(s => s.sessionId === session.id)
            .sort((a, b) => a.timestamp - b.timestamp)
            .map(({ sessionId, ...rest }) => rest), // strip sessionId from export
    }));

    const data = { version: STORAGE_VERSION, sessions: sessionsWithSolves };

    // Include localStorage settings
    for (let i = 0; i < localStorage.length; i++) {
        const fullKey = localStorage.key(i);
        if (fullKey.startsWith(STORAGE_PREFIX)) {
            const key = fullKey.slice(STORAGE_PREFIX.length);
            if (key !== 'sessions') { // sessions are in IndexedDB now
                data[key] = load(key);
            }
        }
    }

    return data;
}

/**
 * Import data from a JSON object, overwriting existing data.
 * @param {object} data
 */
export async function importAll(data) {
    if (!data || typeof data !== 'object') return;

    // Clear existing localStorage timer data
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(STORAGE_PREFIX)) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));

    // Separate sessions from other data
    const sessions = data.sessions || [];
    const dbSessions = [];
    const dbSolves = [];

    for (const session of sessions) {
        dbSessions.push({
            id: session.id,
            name: session.name,
            createdAt: session.createdAt,
        });

        if (Array.isArray(session.solves)) {
            for (const solve of session.solves) {
                dbSolves.push({
                    ...solve,
                    sessionId: session.id,
                });
            }
        }
    }

    // Write to IndexedDB
    await db.replaceAllData(dbSessions, dbSolves);

    // Write remaining keys to localStorage (settings, activeSessionId, etc.)
    for (const [key, value] of Object.entries(data)) {
        if (key === 'version' || key === 'sessions') continue;
        save(key, value);
    }
}

// ──── csTimer Format Conversion ────

function _genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Detect whether a parsed JSON object is in csTimer format.
 */
export function isCsTimerFormat(data) {
    if (!data || typeof data !== 'object') return false;
    // csTimer files always have "session1" as a key
    return 'session1' in data;
}

/**
 * Convert csTimer JSON → internal format and import it.
 */
export async function importCsTimer(csData) {
    if (!csData || typeof csData !== 'object') return;

    // Parse session metadata (names) from properties.sessionData
    let sessionMeta = {};
    try {
        if (csData.properties && csData.properties.sessionData) {
            sessionMeta = JSON.parse(csData.properties.sessionData);
        }
    } catch (_) { /* ignore */ }

    const dbSessions = [];
    const dbSolves = [];

    // Iterate session1..sessionN
    for (const [key, solves] of Object.entries(csData)) {
        const match = key.match(/^session(\d+)$/);
        if (!match) continue;
        const num = match[1];
        if (!Array.isArray(solves)) continue;

        // Get session name from metadata, fallback to "Session N"
        const meta = sessionMeta[num];
        const name = (meta && meta.name && typeof meta.name === 'string')
            ? meta.name
            : `Session ${num}`;

        const sessionId = _genId() + num;
        let sessionCreatedAt = Date.now();
        let hasSolves = false;

        for (const entry of solves) {
            if (!Array.isArray(entry) || entry.length < 4) continue;
            const [penaltyAndTime, scramble, _comment, timestampSec] = entry;
            if (!Array.isArray(penaltyAndTime) || penaltyAndTime.length < 2) continue;

            const [penaltyFlag, rawTime] = penaltyAndTime;

            // Map penalty: 0 = none, 2000 = +2, -1 = DNF
            let penalty = null;
            if (penaltyFlag === 2000) penalty = '+2';
            else if (penaltyFlag === -1) penalty = 'DNF';

            // For +2 solves, csTimer stores the time WITH the +2 already added,
            // but our internal format stores the raw time and applies +2 in display.
            // So subtract 2000ms for +2 penalties.
            let time = rawTime;
            // if (penalty === '+2') time = Math.max(0, rawTime - 2000);

            const timestamp = timestampSec * 1000;

            dbSolves.push({
                id: _genId(),
                sessionId,
                time,
                scramble: scramble || '',
                isManual: false,
                penalty,
                timestamp,
            });

            if (!hasSolves) {
                sessionCreatedAt = timestamp;
                hasSolves = true;
            }
        }

        if (hasSolves) {
            dbSessions.push({ id: sessionId, name, createdAt: sessionCreatedAt });
        }
    }

    if (dbSessions.length === 0) return;

    // Map timer update frequency from csTimer
    const timeU = csData.properties ? csData.properties.timeU : null;
    let timerUpdate = '0.1s'; // default
    if (timeU === 'n') timerUpdate = 'none';
    else if (timeU === 's') timerUpdate = '1s';
    else if (timeU === 'u') timerUpdate = '0.01s';
    else if (timeU === 'i') timerUpdate = 'inspection';

    // Clear existing localStorage data
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(STORAGE_PREFIX)) keysToRemove.push(k);
    }

    // Load existing settings to preserve what we can
    const existingSettings = load('settings', {});
    const newSettings = { ...existingSettings, timerUpdate };

    keysToRemove.forEach(k => localStorage.removeItem(k));

    // Write to IndexedDB
    await db.replaceAllData(dbSessions, dbSolves);

    // Write settings to localStorage
    save('activeSessionId', dbSessions[0].id);
    save('settings', newSettings);
}

/**
 * Export internal data → csTimer JSON format.
 */
export async function exportCsTimer() {
    const { sessions, solves } = await db.getAllData();
    const csData = {};
    const sessionMeta = {};

    sessions.forEach((session, i) => {
        const num = i + 1;
        const key = `session${num}`;

        const sessionSolves = solves
            .filter(s => s.sessionId === session.id)
            .sort((a, b) => a.timestamp - b.timestamp);

        csData[key] = sessionSolves.map(solve => {
            // Map penalty: null → 0, '+2' → 2000, 'DNF' → -1
            let penaltyFlag = 0;
            let time = solve.time;
            if (solve.penalty === '+2') {
                penaltyFlag = 2000;
                // time = solve.time + 2000; // csTimer stores +2 inclusive
            } else if (solve.penalty === 'DNF') {
                penaltyFlag = -1;
            }

            return [
                [penaltyFlag, time],
                solve.scramble || '',
                '',  // comment (unused)
                Math.floor(solve.timestamp / 1000), // ms → seconds
            ];
        });

        sessionMeta[String(num)] = {
            name: session.name || `Session ${num}`,
            opt: {},
            rank: num - 1,
        };
    });

    // Pad to 15 sessions (csTimer convention)
    for (let i = sessions.length + 1; i <= 15; i++) {
        csData[`session${i}`] = [];
        sessionMeta[String(i)] = {
            name: i,
            opt: {},
            rank: i - 1,
        };
    }

    // Map timer update frequency to csTimer
    const settingsData = load('settings', {});
    const timerUpdate = settingsData.timerUpdate || '0.01s';
    let timeU = 'u';
    if (timerUpdate === 'none') timeU = 'n';
    else if (timerUpdate === '1s') timeU = 's';
    else if (timerUpdate === '0.1s') timeU = null; // omitted
    else if (timerUpdate === 'inspection') timeU = 'i';

    csData.properties = {
        sessionData: JSON.stringify(sessionMeta),
        showad: false,
        tools: true,
        color: '4',
        'col-back': '#000000',
        'col-board': '#555555',
        'col-button': '#888888',
        'col-logo': '#000000',
        'col-font': '#ffffff',
        'col-link': '#aaaaaa',
        'col-logoback': '#aaaaaa',
        timeU,
        toolsfunc: '["trend","stats","cross","distribution"]',
    };
    if (timeU === null) delete csData.properties.timeU;

    return csData;
}
