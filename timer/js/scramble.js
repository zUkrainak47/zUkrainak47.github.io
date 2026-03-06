let randomScrambleForEvent;

/**
 * Initialize scramble module by loading cubing.js.
 */
async function init() {
    try {
        const module = await import('https://cdn.cubing.net/v0/js/cubing/scramble');
        randomScrambleForEvent = module.randomScrambleForEvent;
        // Pre-fetch first scramble
        prefetch();
    } catch (e) {
        console.error('Failed to load cubing.js scramble module:', e);
    }
}


let _nextScramble = null;

/**
 * Pre-fetch the next scramble in background.
 */
function prefetch() {
    if (!randomScrambleForEvent) return;
    _nextScramble = randomScrambleForEvent('333').then(alg => alg.toString());
}

/**
 * Generate a new scramble and add it to history.
 * @returns {Promise<string>}
 */
async function generateNextScramble() {
    if (!randomScrambleForEvent) {
        await init();
    }
    let scramble;
    if (_nextScramble) {
        scramble = await _nextScramble;
        _nextScramble = null;
    } else {
        scramble = await randomScrambleForEvent('333').then(alg => alg.toString());
    }
    prefetch();
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
init();
