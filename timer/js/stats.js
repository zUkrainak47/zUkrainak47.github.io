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
