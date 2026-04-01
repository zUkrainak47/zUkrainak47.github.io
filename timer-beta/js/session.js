import * as db from './db.js';
import { load, save } from './storage.js';
import { generateId, EventEmitter, getStartOfToday, getStartOfWeek, getStartOfMonth, parseCustomStatsFilter } from './utils.js';
import { settings } from './settings.js?v=4';

class SessionManager extends EventEmitter {
    constructor() {
        super();
        /** @type {{ id: string, name: string, createdAt: number, order: number, solveCount: number, solves: object[] }[]} */
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
        const solveCounts = await Promise.all(
            dbSessions.map(session => db.getSolveCountBySession(session.id))
        );

        // Build in-memory session objects (metadata + empty solves array)
        this._sessions = dbSessions.map((s, index) => ({
            id: s.id,
            name: s.name,
            createdAt: s.createdAt,
            order: Number.isFinite(s.order) ? s.order : 0,
            solveCount: solveCounts[index] ?? 0,
            solves: [],
        }));

        this._activeId = load('activeSessionId', null);

        if (this._sessions.length === 0) {
            await this._createDefault();
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
    }

    async _createDefault() {
        const session = {
            id: generateId(),
            name: 'Session 1',
            createdAt: Date.now(),
            order: this._getNextSessionOrder(),
            solveCount: 0,
            solves: [],
        };
        this._sessions.push(session);
        await db.addSession({ id: session.id, name: session.name, createdAt: session.createdAt, order: session.order });
    }

    // --- Session CRUD ---

    getSessions() {
        return this._sessions.map(s => ({ id: s.id, name: s.name, createdAt: s.createdAt, order: s.order, solveCount: s.solveCount }));
    }

    getActiveSession() {
        return this._sessions.find(s => s.id === this._activeId);
    }

    getActiveSessionId() {
        return this._activeId;
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
        const session = {
            id: generateId(),
            name: name || `Session ${num}`,
            createdAt: Date.now(),
            order: this._getNextSessionOrder(),
            solveCount: 0,
            solves: [],
        };
        this._sessions.push(session);
        await db.addSession({ id: session.id, name: session.name, createdAt: session.createdAt, order: session.order });
        await this.setActiveSession(session.id);
        return session;
    }

    async renameSession(id, name) {
        const session = this._sessions.find(s => s.id === id);
        if (session) {
            session.name = name;
            await db.updateSession({ id: session.id, name: session.name, createdAt: session.createdAt, order: session.order });
            this.emit('sessionUpdated', id);
        }
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

    togglePenalty(solveId, penalty) {
        const session = this.getActiveSession();
        const solve = session.solves.find(s => s.id === solveId);
        if (!solve) return null;
        solve.penalty = solve.penalty === penalty ? null : penalty;
        db.updateSolve(solve);
        this.emit('solveUpdated', solve);
        return solve;
    }

    setSolveComment(solveId, comment) {
        const session = this.getActiveSession();
        const solve = session.solves.find(s => s.id === solveId);
        if (!solve) return;
        solve.comment = comment;
        db.updateSolve(solve);
        this.emit('solveUpdated', solve);
    }

    deleteSolve(solveId) {
        const session = this.getActiveSession();
        const nextSolves = session.solves.filter(s => s.id !== solveId);
        if (nextSolves.length === session.solves.length) return;
        session.solves = nextSolves;
        session.solveCount = Math.max(0, session.solveCount - 1);
        db.deleteSolve(solveId);
        this.emit('solveDeleted', solveId);
    }

    /**
     * Get solves for the active session, filtered by current stats filter.
     * Always returns oldest-first order.
     * @returns {object[]}
     */
    getFilteredSolves() {
        const session = this.getActiveSession();
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
