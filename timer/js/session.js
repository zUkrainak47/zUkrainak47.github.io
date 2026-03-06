import { load, save } from './storage.js';
import { generateId, EventEmitter, getStartOfToday, getStartOfWeek, getStartOfMonth, parseDuration } from './utils.js';
import { settings } from './settings.js';

class SessionManager extends EventEmitter {
    constructor() {
        super();
        this._sessions = load('sessions', []);
        this._activeId = load('activeSessionId', null);

        if (this._sessions.length === 0) {
            this._createDefault();
        }
        if (!this._activeId || !this._sessions.find(s => s.id === this._activeId)) {
            this._activeId = this._sessions[0].id;
            save('activeSessionId', this._activeId);
        }
    }

    _createDefault() {
        const session = {
            id: generateId(),
            name: 'Session 1',
            createdAt: Date.now(),
            solves: [],
        };
        this._sessions.push(session);
        this._save();
    }

    _save() {
        save('sessions', this._sessions);
    }

    // --- Session CRUD ---

    getSessions() {
        return this._sessions.map(s => ({ id: s.id, name: s.name, createdAt: s.createdAt, solveCount: s.solves.length }));
    }

    getActiveSession() {
        return this._sessions.find(s => s.id === this._activeId);
    }

    getActiveSessionId() {
        return this._activeId;
    }

    setActiveSession(id) {
        if (!this._sessions.find(s => s.id === id)) return;
        this._activeId = id;
        save('activeSessionId', id);
        this.emit('sessionChanged', id);
    }

    createSession(name) {
        const num = this._sessions.length + 1;
        const session = {
            id: generateId(),
            name: name || `Session ${num}`,
            createdAt: Date.now(),
            solves: [],
        };
        this._sessions.push(session);
        this._save();
        this.setActiveSession(session.id);
        return session;
    }

    renameSession(id, name) {
        const session = this._sessions.find(s => s.id === id);
        if (session) {
            session.name = name;
            this._save();
            this.emit('sessionUpdated', id);
        }
    }

    deleteSession(id) {
        if (this._sessions.length <= 1) return;
        this._sessions = this._sessions.filter(s => s.id !== id);
        this._save();
        if (this._activeId === id) {
            this.setActiveSession(this._sessions[0].id);
        }
        this.emit('sessionDeleted', id);
    }

    // --- Solve CRUD ---

    addSolve(time, scramble, isManual = false, penalty = null) {
        const session = this.getActiveSession();
        const solve = {
            id: generateId(),
            time: Math.round(time),
            scramble,
            isManual,
            penalty,
            timestamp: Date.now(),
        };
        session.solves.push(solve);
        this._save();
        this.emit('solveAdded', solve);
        return solve;
    }

    togglePenalty(solveId, penalty) {
        const session = this.getActiveSession();
        const solve = session.solves.find(s => s.id === solveId);
        if (!solve) return;
        solve.penalty = solve.penalty === penalty ? null : penalty;
        this._save();
        this.emit('solveUpdated', solve);
    }

    deleteSolve(solveId) {
        const session = this.getActiveSession();
        session.solves = session.solves.filter(s => s.id !== solveId);
        this._save();
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
                const dur = parseDuration(settings.get('customFilterDuration'));
                if (dur) cutoff = Date.now() - dur;
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
