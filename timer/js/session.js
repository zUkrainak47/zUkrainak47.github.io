import * as db from './db.js?v=2026041401';
import { load, save } from './storage.js?v=2026041401';
import { generateId, EventEmitter, getStartOfToday, getStartOfWeek, getStartOfMonth, parseCustomStatsFilter } from './utils.js?v=2026041401';
import { settings } from './settings.js?v=2026041401';
import { SCRAMBLE_TYPE_OPTIONS } from './scramble.js?v=2026041401';

const DEFAULT_SCRAMBLE_TYPE = '333';
const LEGACY_SCRAMBLE_TYPE_STORAGE_KEY = 'scrambleType';
const SCRAMBLE_TYPE_SET = new Set(SCRAMBLE_TYPE_OPTIONS.map((option) => option.id));

function sanitizeSessionScrambleType(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return SCRAMBLE_TYPE_SET.has(normalized) ? normalized : DEFAULT_SCRAMBLE_TYPE;
}

function getLegacyScrambleTypeFallback() {
    return sanitizeSessionScrambleType(load(LEGACY_SCRAMBLE_TYPE_STORAGE_KEY, DEFAULT_SCRAMBLE_TYPE));
}

class SessionManager extends EventEmitter {
    constructor() {
        super();
        /** @type {{ id: string, name: string, createdAt: number, order: number, scrambleType: string, solveCount: number, solves: object[] }[]} */
        this._sessions = [];
        this._activeId = null;
        this._ready = false;
    }

    _getNextSessionOrder() {
        if (this._sessions.length === 0) return 0;
        return this._sessions.reduce((maxOrder, session) => {
            const order = Number.isFinite(session.order) ? session.order : -1;
            return Math.max(maxOrder, order);
        }, -1) + 1;
    }

    /**
     * Initialize the session manager by loading data from IndexedDB.
     * Must be called (and awaited) before any other methods.
     */
    async init() {
        await db.openDB();

        // Load session metadata from IndexedDB
        const dbSessions = await db.getAllSessions();
        const legacyScrambleType = getLegacyScrambleTypeFallback();
        const solveCounts = await Promise.all(
            dbSessions.map(session => db.getSolveCountBySession(session.id))
        );
        const sessionsToBackfill = [];

        // Build in-memory session objects (metadata + empty solves array)
        this._sessions = dbSessions.map((s, index) => ({
            id: s.id,
            name: s.name,
            createdAt: s.createdAt,
            order: Number.isFinite(s.order) ? s.order : 0,
            scrambleType: (() => {
                const nextScrambleType = sanitizeSessionScrambleType(s.scrambleType ?? legacyScrambleType);
                if (s.scrambleType !== nextScrambleType) {
                    sessionsToBackfill.push({
                        id: s.id,
                        name: s.name,
                        createdAt: s.createdAt,
                        order: Number.isFinite(s.order) ? s.order : 0,
                        scrambleType: nextScrambleType,
                    });
                }
                return nextScrambleType;
            })(),
            solveCount: solveCounts[index] ?? 0,
            solves: [],
            solvesLoaded: false,
        }));

        if (sessionsToBackfill.length > 0) {
            await Promise.all(sessionsToBackfill.map((session) => db.updateSession(session)));
        }

        this._activeId = load('activeSessionId', null);

        if (this._sessions.length === 0) {
            await this._createDefault({ scrambleType: legacyScrambleType });
        }
        if (!this._activeId || !this._sessions.find(s => s.id === this._activeId)) {
            this._activeId = this._sessions[0].id;
            save('activeSessionId', this._activeId);
        }

        // Load solves for the active session
        await this._loadSolvesFor(this._activeId);
        this._ready = true;
    }

    async _loadSolvesFor(sessionId) {
        const session = this._sessions.find(s => s.id === sessionId);
        if (!session) return;
        session.solves = await db.getSolvesBySession(sessionId);
        session.solveCount = session.solves.length;
        session.solvesLoaded = true;
    }

    _serializeSession(session) {
        return {
            id: session.id,
            name: session.name,
            createdAt: session.createdAt,
            order: session.order,
            scrambleType: sanitizeSessionScrambleType(session.scrambleType),
        };
    }

    async _createDefault({ scrambleType = getLegacyScrambleTypeFallback() } = {}) {
        const session = {
            id: generateId(),
            name: 'Session 1',
            createdAt: Date.now(),
            order: this._getNextSessionOrder(),
            scrambleType: sanitizeSessionScrambleType(scrambleType),
            solveCount: 0,
            solves: [],
            solvesLoaded: false,
        };
        this._sessions.push(session);
        await db.addSession(this._serializeSession(session));
    }

    // --- Session CRUD ---

    getSessions() {
        return this._sessions.map((s) => ({
            id: s.id,
            name: s.name,
            createdAt: s.createdAt,
            order: s.order,
            scrambleType: s.scrambleType,
            solveCount: s.solveCount,
        }));
    }

    getActiveSession() {
        return this._sessions.find(s => s.id === this._activeId);
    }

    getActiveSessionId() {
        return this._activeId;
    }

    getSessionById(id) {
        return this._sessions.find((session) => session.id === id) || null;
    }

    getActiveSessionScrambleType() {
        return this.getActiveSession()?.scrambleType ?? getLegacyScrambleTypeFallback();
    }

    async ensureSessionSolvesLoaded(id) {
        const session = this.getSessionById(id);
        if (!session) return null;
        if (!session.solvesLoaded) {
            await this._loadSolvesFor(id);
        }
        return session;
    }

    async setActiveSession(id) {
        if (!this._sessions.find(s => s.id === id)) return;
        this._activeId = id;
        save('activeSessionId', id);
        await this._loadSolvesFor(id);
        this.emit('sessionChanged', id);
    }

    async createSession(name) {
        const num = this._sessions.length + 1;
        const activeSession = this.getActiveSession();
        const session = {
            id: generateId(),
            name: name || `Session ${num}`,
            createdAt: Date.now(),
            order: this._getNextSessionOrder(),
            scrambleType: sanitizeSessionScrambleType(activeSession?.scrambleType ?? getLegacyScrambleTypeFallback()),
            solveCount: 0,
            solves: [],
            solvesLoaded: false,
        };
        this._sessions.push(session);
        await db.addSession(this._serializeSession(session));
        await this.setActiveSession(session.id);
        return session;
    }

    async renameSession(id, name) {
        const session = this._sessions.find(s => s.id === id);
        if (session) {
            session.name = name;
            await db.updateSession(this._serializeSession(session));
            this.emit('sessionUpdated', id);
        }
    }

    async setSessionScrambleType(id, scrambleType) {
        const session = this._sessions.find((s) => s.id === id);
        if (!session) return false;

        const nextScrambleType = sanitizeSessionScrambleType(scrambleType);
        if (session.scrambleType === nextScrambleType) return false;

        session.scrambleType = nextScrambleType;
        await db.updateSession(this._serializeSession(session));
        this.emit('sessionUpdated', id);
        return true;
    }

    async deleteSession(id) {
        const deletedIndex = this._sessions.findIndex(s => s.id === id);
        if (deletedIndex === -1) return;

        this._sessions = this._sessions.filter(s => s.id !== id);
        await db.deleteSession(id);

        if (this._sessions.length === 0) {
            await this._createDefault();
            this._activeId = this._sessions[0].id;
            save('activeSessionId', this._activeId);
            this.emit('sessionDeleted', id);
            this.emit('sessionChanged', this._activeId);
        } else {
            if (this._activeId === id) {
                await this.setActiveSession(this._sessions[0].id);
            }
            this.emit('sessionDeleted', id);
        }
    }

    // --- Solve CRUD ---

    addSolve(time, scramble, isManual = false, penalty = null) {
        const session = this.getActiveSession();
        const solve = {
            id: generateId(),
            sessionId: this._activeId,
            time: Math.round(time),
            scramble,
            isManual,
            penalty,
            timestamp: Date.now(),
        };
        session.solves.push(solve);
        session.solveCount += 1;
        // Fire-and-forget write — in-memory state is already updated
        db.addSolve(solve);
        this.emit('solveAdded', solve);
        return solve;
    }

    _findSolveLocation(solveId) {
        for (const session of this._sessions) {
            const index = session.solves.findIndex((solve) => solve.id === solveId);
            if (index >= 0) {
                return {
                    session,
                    index,
                    solve: session.solves[index],
                };
            }
        }

        return null;
    }

    togglePenalty(solveId, penalty) {
        const location = this._findSolveLocation(solveId);
        const solve = location?.solve;
        if (!solve) return null;
        solve.penalty = solve.penalty === penalty ? null : penalty;
        db.updateSolve(solve);
        this.emit('solveUpdated', solve);
        return solve;
    }

    setSolveComment(solveId, comment) {
        const location = this._findSolveLocation(solveId);
        const solve = location?.solve;
        if (!solve) return;
        solve.comment = comment;
        db.updateSolve(solve);
        this.emit('solveUpdated', solve);
    }

    deleteSolve(solveId) {
        const location = this._findSolveLocation(solveId);
        const session = location?.session;
        if (!session) return;
        const nextSolves = session.solves.filter(s => s.id !== solveId);
        if (nextSolves.length === session.solves.length) return;
        session.solves = nextSolves;
        session.solveCount = Math.max(0, session.solveCount - 1);
        db.deleteSolve(solveId);
        this.emit('solveDeleted', solveId);
    }

    async moveSolve(solveId, targetSessionId) {
        const location = this._findSolveLocation(solveId);
        const sourceSession = location?.session;
        const targetSession = this._sessions.find((session) => session.id === targetSessionId);

        if (!sourceSession || !targetSession || sourceSession.id === targetSession.id) return null;

        const sourceIndex = location.index;
        if (sourceIndex === -1) return null;

        const [solve] = sourceSession.solves.splice(sourceIndex, 1);
        const shouldSyncTargetSolves = Boolean(targetSession.solvesLoaded || targetSession.solveCount === 0);
        const wasTargetSolvesLoaded = targetSession.solvesLoaded;

        sourceSession.solveCount = Math.max(0, sourceSession.solveCount - 1);
        targetSession.solveCount += 1;
        solve.sessionId = targetSession.id;

        if (shouldSyncTargetSolves) {
            targetSession.solvesLoaded = true;
            targetSession.solves.push(solve);
            targetSession.solves.sort((a, b) => a.timestamp - b.timestamp);
        }

        try {
            await db.updateSolve(solve);
        } catch (error) {
            solve.sessionId = sourceSession.id;
            sourceSession.solves.splice(sourceIndex, 0, solve);
            sourceSession.solveCount += 1;
            targetSession.solveCount = Math.max(0, targetSession.solveCount - 1);

            if (shouldSyncTargetSolves) {
                targetSession.solvesLoaded = wasTargetSolvesLoaded;
                targetSession.solves = targetSession.solves.filter((entry) => entry.id !== solve.id);
            }

            throw error;
        }

        this.emit('solveMoved', {
            solve,
            fromSessionId: sourceSession.id,
            toSessionId: targetSession.id,
        });

        return solve;
    }

    /**
     * Get solves for the active session, filtered by current stats filter.
     * Always returns oldest-first order.
     * @returns {object[]}
     */
    getFilteredSolves() {
        return this.getFilteredSolvesForSessionId(this._activeId);
    }

    getFilteredSolvesForSessionId(sessionId) {
        const session = this.getSessionById(sessionId);
        if (!session) return [];

        const filter = settings.get('statsFilter');
        let cutoff = 0;

        switch (filter) {
            case 'today':
                cutoff = getStartOfToday();
                break;
            case 'week':
                cutoff = getStartOfWeek();
                break;
            case 'month':
                cutoff = getStartOfMonth();
                break;
            case 'custom': {
                const customFilter = parseCustomStatsFilter(settings.get('customFilterDuration'));
                if (customFilter?.mode === 'count') {
                    return session.solves.slice(-customFilter.solveCount);
                }
                if (customFilter?.mode === 'duration') {
                    cutoff = Date.now() - customFilter.durationMs;
                }
                break;
            }
            default: // 'all'
                cutoff = 0;
        }

        return session.solves.filter(s => s.timestamp >= cutoff);
    }

    /**
     * Get ALL solves for the active session (unfiltered).
     * @returns {object[]}
     */
    getAllSolves() {
        const session = this.getActiveSession();
        return session ? session.solves : [];
    }
}

export const sessionManager = new SessionManager();
