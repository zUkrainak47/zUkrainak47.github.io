import * as db from './db.js';

const STORAGE_PREFIX = 'cubetimer_';
const STORAGE_VERSION = 1;
const SESSION_CSV_HEADERS = ['Puzzle', 'Category', 'Time(millis)', 'Date(millis)', 'Scramble', 'Penalty', 'Comment'];
const IMPORT_PRESERVED_LOCAL_KEYS = Object.freeze([
    'scrambleQueues',
    'scrambleQueue333',
    'cubingWarmupState',
]);

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

    // Preserve device-local scramble caches so imports do not force the
    // offline warmup/bootstrap path to run again on the same browser.
    const preservedLocalValues = new Map(
        IMPORT_PRESERVED_LOCAL_KEYS.map((key) => [key, load(key, null)]),
    );

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
            order: Number.isFinite(session.order) ? session.order : dbSessions.length,
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

    preservedLocalValues.forEach((value, key) => {
        if (value === null) {
            remove(key);
            return;
        }

        save(key, value);
    });
}

function _parseDelimitedRecords(text, delimiter = ';') {
    const records = [];
    let currentRecord = [];
    let currentField = '';
    let inQuotes = false;
    let lineNumber = 1;

    const pushRecord = () => {
        currentRecord.push(currentField);
        const hasContent = currentRecord.some(field => field.length > 0);
        if (hasContent) {
            records.push(currentRecord);
        }
        currentRecord = [];
        currentField = '';
    };

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (char === '"') {
            if (inQuotes && text[i + 1] === '"') {
                currentField += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === delimiter && !inQuotes) {
            currentRecord.push(currentField);
            currentField = '';
            continue;
        }

        if (char === '\n' && !inQuotes) {
            pushRecord();
            lineNumber += 1;
            continue;
        }

        currentField += char;

        if (char === '\n') {
            lineNumber += 1;
        }
    }

    if (inQuotes) {
        throw new Error(`Unterminated quoted field near line ${lineNumber}.`);
    }

    if (currentField.length > 0 || currentRecord.length > 0) {
        pushRecord();
    }

    return records;
}

function _normalizeImportText(text) {
    return String(text || '')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n?/g, '\n');
}

function _isSessionCsvHeader(fields) {
    return fields.length === SESSION_CSV_HEADERS.length
        && SESSION_CSV_HEADERS.every((header, index) => fields[index] === header);
}

function _mapSessionCsvPenalty(value) {
    if (value === '1') return '+2';
    if (value === '2') return 'DNF';
    return null;
}

export function isSessionCsvFormat(text) {
    const normalized = _normalizeImportText(text);
    const [firstRecord] = _parseDelimitedRecords(normalized);
    if (!firstRecord) return false;

    try {
        return _isSessionCsvHeader(firstRecord);
    } catch (_) {
        return false;
    }
}

export function convertSessionCsv(text) {
    const normalized = _normalizeImportText(text);
    const records = _parseDelimitedRecords(normalized);
    if (records.length === 0) {
        throw new Error('Empty import file.');
    }

    const header = records[0];
    if (!_isSessionCsvHeader(header)) {
        throw new Error(`Unsupported session CSV header. Expected: ${SESSION_CSV_HEADERS.join(' | ')}. Received: ${header.join(' | ')}`);
    }

    const sessionsByName = new Map();
    const sessionOrder = [];

    for (let lineIndex = 1; lineIndex < records.length; lineIndex++) {
        const fields = records[lineIndex];
        if (fields.length !== SESSION_CSV_HEADERS.length) {
            throw new Error(`Invalid row at line ${lineIndex + 1}. Expected ${SESSION_CSV_HEADERS.length} fields, received ${fields.length}.`);
        }

        const [, rawCategory, rawTime, rawDate, rawScramble, rawPenalty, rawComment] = fields;
        const name = rawCategory.trim() || `Session ${sessionOrder.length + 1}`;
        const time = Number(rawTime);
        const timestamp = Number(rawDate);

        if (!Number.isFinite(time) || time < 0 || !Number.isFinite(timestamp) || timestamp < 0) {
            throw new Error(`Invalid time data at line ${lineIndex + 1}. Time="${rawTime}", Date="${rawDate}"`);
        }

        let session = sessionsByName.get(name);
        if (!session) {
            session = {
                id: _genId(),
                name,
                createdAt: timestamp,
                order: sessionOrder.length,
                solves: [],
            };
            sessionsByName.set(name, session);
            sessionOrder.push(session);
        } else {
            session.createdAt = Math.min(session.createdAt, timestamp);
        }

        session.solves.push({
            id: _genId(),
            time: Math.round(time),
            scramble: rawScramble || '',
            isManual: false,
            penalty: _mapSessionCsvPenalty(rawPenalty.trim()),
            timestamp,
            comment: rawComment || '',
        });
    }

    sessionOrder.forEach(session => {
        session.solves.sort((a, b) => a.timestamp - b.timestamp);
    });

    return {
        version: STORAGE_VERSION,
        sessions: sessionOrder,
        activeSessionId: sessionOrder[0]?.id ?? null,
    };
}

export async function importSessionCsv(text) {
    await importAll(convertSessionCsv(text));
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
        const sessionOrder = dbSessions.length;
        let sessionCreatedAt = Date.now();
        let hasSolves = false;

        for (const entry of solves) {
            if (!Array.isArray(entry) || entry.length < 4) continue;
            const [penaltyAndTime, scramble, comment, timestampSec] = entry;
            if (!Array.isArray(penaltyAndTime) || penaltyAndTime.length < 2) continue;

            const [penaltyFlag, rawTime] = penaltyAndTime;

            // Map penalty: 0 = none, 2000 = +2, -1 = DNF
            let penalty = null;
            if (penaltyFlag === 2000) penalty = '+2';
            else if (penaltyFlag === -1) penalty = 'DNF';

            let time = rawTime;

            const timestamp = timestampSec * 1000;

            dbSolves.push({
                id: _genId(),
                sessionId,
                time,
                scramble: scramble || '',
                isManual: false,
                penalty,
                timestamp,
                comment: (comment && typeof comment === 'string') ? comment : '',
            });

            if (!hasSolves) {
                sessionCreatedAt = timestamp;
                hasSolves = true;
            }
        }

        if (hasSolves) {
            dbSessions.push({ id: sessionId, name, createdAt: sessionCreatedAt, order: sessionOrder });
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
            } else if (solve.penalty === 'DNF') {
                penaltyFlag = -1;
            }

            return [
                [penaltyFlag, time],
                solve.scramble || '',
                solve.comment || '',
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
