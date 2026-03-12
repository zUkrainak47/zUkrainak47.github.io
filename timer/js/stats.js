import { getEffectiveTime } from './utils.js';

/**
 * Trim best and worst values from an array.
 * @param {number[]} times - Array of effective times
 * @param {number} trimCount - Number of best AND worst to remove
 * @returns {number[]} Trimmed array
 */
function trimmedArray(times, trimCount) {
    if (times.length <= trimCount * 2) return [];
    const sorted = [...times].sort((a, b) => a - b);
    return sorted.slice(trimCount, sorted.length - trimCount);
}

/**
 * Calculate mean of an array of times.
 * If any time is Infinity (DNF), result is Infinity.
 * @param {number[]} times
 * @returns {number}
 */
function mean(times) {
    if (times.length === 0) return null;
    if (times.some(t => t === Infinity)) return Infinity;
    return times.reduce((s, t) => s + t, 0) / times.length;
}

/**
 * Mean of 3 (no trimming).
 * @param {number[]} times - effective times, most recent at end
 * @returns {number|null}
 */
export function mo3(times) {
    if (times.length < 3) return null;
    const last3 = times.slice(-3);
    return mean(last3);
}

/**
 * Compute mo3 at a specific index (using solves up to and including index).
 */
export function mo3At(times, index) {
    if (index < 2) return null;
    return mean(times.slice(index - 2, index + 1));
}

/**
 * Average of N with trimming.
 * @param {number[]} times
 * @param {number} n - window size
 * @param {number} trim - how many to trim from each end
 * @returns {number|null}
 */
function aoN(times, n, trim) {
    if (times.length < n) return null;
    const window = times.slice(-n);
    // Count DNFs
    const dnfCount = window.filter(t => t === Infinity).length;
    // If more DNFs than trim allows, result is DNF
    if (dnfCount > trim) return Infinity;
    const trimmed = trimmedArray(window, trim);
    return mean(trimmed);
}

/**
 * Average of 5 (trim 1 best, 1 worst).
 */
export function ao5(times) {
    return aoN(times, 5, 1);
}

/**
 * Average of 12 (trim 1 best, 1 worst).
 */
export function ao12(times) {
    return aoN(times, 12, 1);
}

/**
 * Average of 100 (trim 5 best, 5 worst).
 */
export function ao100(times) {
    return aoN(times, 100, 5);
}

/**
 * Compute ao5 at a specific index (using solves up to and including index).
 */
export function ao5At(times, index) {
    if (index < 4) return null;
    const window = times.slice(index - 4, index + 1);
    const dnfs = window.filter(t => t === Infinity).length;
    if (dnfs > 1) return Infinity;
    const trimmed = trimmedArray(window, 1);
    return mean(trimmed);
}

/**
 * Compute ao12 at a specific index.
 */
export function ao12At(times, index) {
    if (index < 11) return null;
    const window = times.slice(index - 11, index + 1);
    const dnfs = window.filter(t => t === Infinity).length;
    if (dnfs > 1) return Infinity;
    const trimmed = trimmedArray(window, 1);
    return mean(trimmed);
}

/**
 * Compute ao100 at a specific index.
 */
export function ao100At(times, index) {
    if (index < 99) return null;
    const window = times.slice(index - 99, index + 1);
    const dnfs = window.filter(t => t === Infinity).length;
    if (dnfs > 5) return Infinity;
    const trimmed = trimmedArray(window, 5);
    return mean(trimmed);
}

/**
 * Find the best (minimum) value in an array, ignoring nulls.
 * @param {(number|null)[]} values
 * @returns {number|null}
 */
function best(values) {
    const valid = values.filter(v => v != null && v !== Infinity);
    if (valid.length === 0) return null;
    return Math.min(...valid);
}

/**
 * Compute all statistics from a list of solves.
 * @param {object[]} solves - Array of solve objects (oldest first)
 * @returns {object} { current, best, count, sessionMean }
 */
export function computeAll(solves) {
    const times = solves.map(s => getEffectiveTime(s));

    const currentTime = times.length > 0 ? times[times.length - 1] : null;
    const currentMo3 = mo3(times);
    const currentAo5 = ao5(times);
    const currentAo12 = ao12(times);
    const currentAo100 = ao100(times);

    // Best of each
    const allAo5 = [];
    const allAo12 = [];
    for (let i = 0; i < times.length; i++) {
        const a5 = ao5At(times, i);
        if (a5 != null) allAo5.push(a5);
        const a12 = ao12At(times, i);
        if (a12 != null) allAo12.push(a12);
    }

    // Best ao100 - compute rolling
    const allAo100 = [];
    if (times.length >= 100) {
        for (let i = 99; i < times.length; i++) {
            const window = times.slice(i - 99, i + 1);
            const dnfs = window.filter(t => t === Infinity).length;
            if (dnfs > 5) {
                allAo100.push(Infinity);
            } else {
                const trimmed = trimmedArray(window, 5);
                allAo100.push(mean(trimmed));
            }
        }
    }

    // All mo3
    const allMo3 = [];
    for (let i = 2; i < times.length; i++) {
        const m = mo3At(times, i);
        allMo3.push(m);
    }

    const validTimes = times.filter(t => t !== Infinity);
    const sessionMean = validTimes.length > 0
        ? validTimes.reduce((s, t) => s + t, 0) / validTimes.length
        : null;

    return {
        count: solves.length,
        sessionMean,
        current: {
            time: currentTime,
            mo3: currentMo3,
            ao5: currentAo5,
            ao12: currentAo12,
            ao100: currentAo100,
        },
        best: {
            time: best(times),
            mo3: best(allMo3),
            ao5: best(allAo5),
            ao12: best(allAo12),
            ao100: best(allAo100),
        },
    };
}

/**
 * Compute per-solve ao5 and ao12 for display in the solves table.
 * @param {object[]} solves
 * @returns {{ ao5: (number|null), ao12: (number|null), ao100: (number|null) }[]}
 */
export function perSolveStats(solves) {
    const times = solves.map(s => getEffectiveTime(s));
    return times.map((_, i) => ({
        ao5: ao5At(times, i),
        ao12: ao12At(times, i),
        ao100: ao100At(times, i),
    }));
}

// ──── Incremental Stats Cache ────

/**
 * A fixed-size sorted window for sliding-window average computation.
 * Uses binary insertion + splice to maintain a sorted array of at most `size` elements.
 * This avoids the slice+sort allocation pattern in the hot rebuild path.
 */
class SortedWindow {
    constructor(size, trim) {
        this._size = size;
        this._trim = trim;
        this._buf = [];     // circular chronological buffer (unsorted)
        this._sorted = [];  // sorted copy of _buf
        this._pos = 0;
        this._dnfs = 0;
        this._sumTrimmed = 0; // not maintained (we compute on query — window is small)
    }

    /**
     * Push a new value, evicting the oldest if full.
     * @param {number} val
     */
    push(val) {
        if (this._buf.length === this._size) {
            // Evict oldest
            const old = this._buf[this._pos];
            this._buf[this._pos] = val;
            // Remove old from sorted
            const oi = this._sorted.indexOf(old);
            if (oi >= 0) this._sorted.splice(oi, 1);
            if (old === Infinity) this._dnfs--;
        } else {
            this._buf.push(val);
        }
        this._pos = (this._pos + 1) % this._size;

        // Insert val into sorted
        if (val === Infinity) {
            this._sorted.push(val);
            this._dnfs++;
        } else {
            let lo = 0, hi = this._sorted.length;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (this._sorted[mid] < val) lo = mid + 1; else hi = mid;
            }
            this._sorted.splice(lo, 0, val);
        }
    }

    isReady() { return this._buf.length === this._size; }

    /**
     * Compute trimmed mean of the current window.
     * Returns null if not full, Infinity if too many DNFs.
     */
    average() {
        if (this._buf.length < this._size) return null;
        const sorted = this._sorted;
        const n = this._size;
        const tr = this._trim;
        if (this._dnfs > tr) return Infinity;
        // Trim from each end (sorted ascending; Infinities are at end)
        let sum = 0;
        const count = n - 2 * tr;
        for (let i = tr; i < n - tr; i++) sum += sorted[i];
        return sum / count;
    }
}

/**
 * A cache that maintains rolling statistics incrementally.
 */
export class StatsCache {
    constructor() {
        /** @type {number[]} effective times */
        this._times = [];
        /** @type {{ ao5: number|null, ao12: number|null, ao100: number|null }[]} */
        this._perSolve = [];

        this._bestTime = null;
        this._bestMo3 = null;
        this._bestAo5 = null;
        this._bestAo12 = null;
        this._bestAo100 = null;

        this._validSum = 0;
        this._validCount = 0;

        this._newBestFlags = [];
        this._rollingBestTime = Infinity;

        // Sliding windows (reused across appends)
        this._win5 = new SortedWindow(5, 1);
        this._win12 = new SortedWindow(12, 1);
        this._win100 = new SortedWindow(100, 5);
    }

    get length() { return this._times.length; }

    _reset() {
        this._times = [];
        this._perSolve = [];
        this._bestTime = null;
        this._bestMo3 = null;
        this._bestAo5 = null;
        this._bestAo12 = null;
        this._bestAo100 = null;
        this._validSum = 0;
        this._validCount = 0;
        this._newBestFlags = [];
        this._rollingBestTime = Infinity;
        this._win5 = new SortedWindow(5, 1);
        this._win12 = new SortedWindow(12, 1);
        this._win100 = new SortedWindow(100, 5);
    }

    /**
     * Full rebuild from a solve array.
     * @param {object[]} solves
     */
    rebuild(solves) {
        this._reset();
        for (const solve of solves) {
            this._appendTime(getEffectiveTime(solve));
        }
    }

    /**
     * Append a single solve (used after addSolve).
     * @param {object} solve
     */
    append(solve) {
        this._appendTime(getEffectiveTime(solve));
    }

    /** Internal: append a time value and update all caches */
    _appendTime(t) {
        this._times.push(t);
        const i = this._times.length - 1;

        // Session mean
        if (t !== Infinity) {
            this._validSum += t;
            this._validCount++;
        }

        // Sliding window averages — O(log k) per window, no allocation
        this._win5.push(t);
        this._win12.push(t);
        this._win100.push(t);

        const a5 = this._win5.isReady() ? this._win5.average() : null;
        const a12 = this._win12.isReady() ? this._win12.average() : null;
        const a100 = this._win100.isReady() ? this._win100.average() : null;
        this._perSolve.push({ ao5: a5, ao12: a12, ao100: a100 });

        // Update running bests
        if (t !== Infinity) {
            if (this._bestTime === null || t < this._bestTime) this._bestTime = t;
        }
        const m3 = i >= 2 ? mo3At(this._times, i) : null;
        if (m3 != null && m3 !== Infinity) {
            if (this._bestMo3 === null || m3 < this._bestMo3) this._bestMo3 = m3;
        }
        if (a5 != null && a5 !== Infinity) {
            if (this._bestAo5 === null || a5 < this._bestAo5) this._bestAo5 = a5;
        }
        if (a12 != null && a12 !== Infinity) {
            if (this._bestAo12 === null || a12 < this._bestAo12) this._bestAo12 = a12;
        }
        if (a100 != null && a100 !== Infinity) {
            if (this._bestAo100 === null || a100 < this._bestAo100) this._bestAo100 = a100;
        }

        // New best single flag
        if (t !== Infinity && t < this._rollingBestTime) {
            this._rollingBestTime = t;
            this._newBestFlags.push(true);
        } else {
            this._newBestFlags.push(false);
        }
    }

    /**
     * Get the same shape as computeAll() returns, but from the cache.
     */
    getStats() {
        const n = this._times.length;
        const lastTime = n > 0 ? this._times[n - 1] : null;
        const lastMo3 = n >= 3 ? mo3At(this._times, n - 1) : null;
        const lastPs = n > 0 ? this._perSolve[n - 1] : { ao5: null, ao12: null, ao100: null };

        return {
            count: n,
            sessionMean: this._validCount > 0 ? this._validSum / this._validCount : null,
            current: {
                time: lastTime,
                mo3: lastMo3,
                ao5: lastPs.ao5,
                ao12: lastPs.ao12,
                ao100: lastPs.ao100,
            },
            best: {
                time: this._bestTime,
                mo3: this._bestMo3,
                ao5: this._bestAo5,
                ao12: this._bestAo12,
                ao100: this._bestAo100,
            },
        };
    }

    /** Get per-solve stats at index i. */
    getPerSolveAt(i) {
        return this._perSolve[i] || null;
    }

    /** Get new-best-single flag at index i. */
    isNewBestAt(i) {
        return !!this._newBestFlags[i];
    }

    /** Get effective time at index i. */
    getTimeAt(i) {
        return this._times[i];
    }

    /** Get the full times array. */
    getTimes() {
        return this._times;
    }
}
