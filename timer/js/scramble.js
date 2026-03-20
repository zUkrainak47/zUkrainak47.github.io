import { load, save } from './storage.js';

let randomScrambleForEvent;
let _initPromise = null;
let _queueFillPromise = null;

const SCRAMBLE_QUEUE_STORAGE_KEY = 'scrambleQueue333';
const SCRAMBLE_QUEUE_TARGET = 6;
const SCRAMBLE_QUEUE_MAX = 12;

let _scrambleQueue = sanitizeScrambleQueue(load(SCRAMBLE_QUEUE_STORAGE_KEY, []));

function sanitizeScrambleQueue(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((entry) => typeof entry === 'string' && entry.trim())
        .slice(0, SCRAMBLE_QUEUE_MAX);
}

function persistScrambleQueue() {
    save(SCRAMBLE_QUEUE_STORAGE_KEY, _scrambleQueue.slice(0, SCRAMBLE_QUEUE_MAX));
}

/**
 * Initialize scramble module by loading cubing.js.
 */
async function init() {
    if (randomScrambleForEvent) return randomScrambleForEvent;
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
        try {
            const module = await import('https://cdn.cubing.net/v0/js/cubing/scramble');
            randomScrambleForEvent = module.randomScrambleForEvent;
            scheduleQueueFill();
            return randomScrambleForEvent;
        } catch (e) {
            console.error('Failed to load cubing.js scramble module:', e);
            throw e;
        } finally {
            if (!randomScrambleForEvent) {
                _initPromise = null;
            }
        }
    })();

    return _initPromise;
}

async function createScramble() {
    if (!randomScrambleForEvent) {
        await init();
    }
    return randomScrambleForEvent('333').then((alg) => alg.toString());
}

function takeQueuedScramble() {
    if (_scrambleQueue.length === 0) return null;
    // Persist removal before returning so a page refresh advances to the next cached scramble.
    const scramble = _scrambleQueue.shift();
    persistScrambleQueue();
    scheduleQueueFill();
    return scramble;
}

async function fillScrambleQueue() {
    if (_queueFillPromise) return _queueFillPromise;

    _queueFillPromise = (async () => {
        try {
            await init();
            while (_scrambleQueue.length < SCRAMBLE_QUEUE_TARGET) {
                _scrambleQueue.push(await createScramble());
                persistScrambleQueue();
            }
        } catch (e) {
            console.error('Failed to prefill scramble queue:', e);
        } finally {
            _queueFillPromise = null;
        }
    })();

    return _queueFillPromise;
}

function scheduleQueueFill() {
    if (_scrambleQueue.length >= SCRAMBLE_QUEUE_TARGET || _queueFillPromise) return;
    fillScrambleQueue();
}

/**
 * Generate a new scramble and add it to history.
 * @returns {Promise<string>}
 */
async function generateNextScramble() {
    const cachedScramble = takeQueuedScramble();
    if (cachedScramble) {
        return cachedScramble;
    }

    const scramble = await createScramble();
    scheduleQueueFill();
    return scramble;
}

/**
 * Get a new scramble, adding it to history.
 * @returns {Promise<string>}
 */
let _currentScramble = null;
let _prevScramble = null;
let _isViewingPrev = false;

// Helper to set new current and push old to prev
function _pushNew(scrambleStr, isManual = false) {
    _prevScramble = _currentScramble;
    _currentScramble = { text: scrambleStr, isManual };
    _isViewingPrev = false;
}

/**
 * Get a new scramble, adding it to history.
 * @returns {Promise<string>}
 */
export async function getScramble() {
    const text = await generateNextScramble();
    _pushNew(text, false);
    return text;
}

/**
 * Go back to the previous scramble in history.
 * @returns {string|null} The previous scramble or null if at the beginning.
 */
export function getPrevScramble() {
    if (_prevScramble && !_isViewingPrev) {
        _isViewingPrev = true;
        return _prevScramble.text;
    }
    return null;
}

/**
 * Check if a previous scramble is available.
 */
export function hasPrevScramble() {
    return _prevScramble !== null && !_isViewingPrev;
}

/**
 * Go forward to the next scramble in history. If viewing previous, returns current. 
 * Otherwise, generates a new one.
 * @returns {Promise<string>}
 */
export async function getNextScramble() {
    if (_isViewingPrev) {
        _isViewingPrev = false;
        return _currentScramble.text;
    }
    return await getScramble();
}

/**
 * Get the current scramble string without generating a new one.
 * @returns {string}
 */
export function getCurrentScramble() {
    const active = _isViewingPrev ? _prevScramble : _currentScramble;
    return active ? active.text : '';
}

/**
 * Manually set the current scramble (e.g. from user edit).
 */
export function setCurrentScramble(scrambleStr) {
    if (_isViewingPrev) {
        // If editing while viewing prev, it effectively branches, so it becomes the new current
        _pushNew(scrambleStr, true);
    } else if (_currentScramble) {
        _currentScramble.text = scrambleStr;
        _currentScramble.isManual = true;
    } else {
        _pushNew(scrambleStr, true);
    }
}

/**
 * Check if the current scramble has been manually edited.
 */
export function isCurrentScrambleManual() {
    const active = _isViewingPrev ? _prevScramble : _currentScramble;
    return active ? active.isManual : false;
}

// Start init immediately
scheduleQueueFill();
