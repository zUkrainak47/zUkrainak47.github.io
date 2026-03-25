import { load, save } from './storage.js';

let randomScrambleForEvent;
let _cubingInitPromise = null;
let _scrambowCtor = null;
let _scrambowInitPromise = null;
const _queueFillPromises = new Map();
const _bootstrapQueueFillScheduled = new Set();
const _queueFillScheduled = new Set();

const LEGACY_SCRAMBLE_QUEUE_STORAGE_KEY = 'scrambleQueue333';
const SCRAMBLE_QUEUES_STORAGE_KEY = 'scrambleQueues';
const SCRAMBLE_TYPE_STORAGE_KEY = 'scrambleType';
const SCRAMBLE_QUEUE_TARGET = 6;
const SCRAMBLE_QUEUE_MAX = 12;
const SUBSET_REDRAW_LIMIT = 24;
const SCRAMBOW_SCRIPT_SRC = 'https://unpkg.com/scrambow@1.8.1/dist/scrambow.js';
const SUBSET_BOOTSTRAP_QUEUE_FILL_DELAY_MS = 280;

export const SCRAMBLE_TYPE_OPTIONS = Object.freeze([
    { id: '333', menuLabel: '3x3x3', buttonLabel: '3x3x3', generator: 'cubing', eventId: '333' },
    { id: '222', menuLabel: '2x2x2', buttonLabel: '2x2', generator: 'cubing', eventId: '222' },
    { id: '444', menuLabel: '4x4x4', buttonLabel: '4x4', generator: 'cubing', eventId: '444' },
    { id: '555', menuLabel: '5x5x5', buttonLabel: '5x5', generator: 'cubing', eventId: '555' },
    { id: '666', menuLabel: '6x6x6', buttonLabel: '6x6', generator: 'cubing', eventId: '666' },
    { id: '777', menuLabel: '7x7x7', buttonLabel: '7x7', generator: 'cubing', eventId: '777' },
    { id: 'pyram', menuLabel: 'Pyraminx', buttonLabel: 'Pyra', generator: 'cubing', eventId: 'pyram' },
    { id: 'minx', menuLabel: 'Megaminx', buttonLabel: 'Mega', generator: 'cubing', eventId: 'minx' },
    { id: 'skewb', menuLabel: 'Skewb', buttonLabel: 'Skewb', generator: 'cubing', eventId: 'skewb' },
    { id: 'sq1', menuLabel: 'Square-1', buttonLabel: 'Sq-1', generator: 'cubing', eventId: 'sq1' },
    { id: 'clock', menuLabel: 'Clock', buttonLabel: 'Clock', generator: 'cubing', eventId: 'clock' },
    { id: 'll', menuLabel: 'OLL', buttonLabel: 'OLL', generator: 'scrambow' },
    { id: 'pll', menuLabel: 'PLL', buttonLabel: 'PLL', generator: 'scrambow' },
    { id: 'zbll', menuLabel: 'ZBLL', buttonLabel: 'ZBLL', generator: 'scrambow' },
    { id: 'lsll', menuLabel: 'LSLL', buttonLabel: 'LSLL', generator: 'scrambow' },
]);

const SCRAMBLE_TYPE_SET = new Set(SCRAMBLE_TYPE_OPTIONS.map((option) => option.id));
const SCRAMBOW_SCRAMBLE_TYPES = new Set(
    SCRAMBLE_TYPE_OPTIONS
        .filter((option) => option.generator === 'scrambow')
        .map((option) => option.id),
);
const CUBING_SCRAMBLE_EVENTS = new Map(
    SCRAMBLE_TYPE_OPTIONS
        .filter((option) => option.generator === 'cubing')
        .map((option) => [option.id, option.eventId]),
);
const SCRAMBLE_QUEUE_TYPES = Object.freeze(SCRAMBLE_TYPE_OPTIONS.map((option) => option.id));
const SCRAMBLE_QUEUE_TYPE_SET = new Set(SCRAMBLE_QUEUE_TYPES);
const DEFERRED_QUEUE_FILL_TYPES = new Set(SCRAMBLE_QUEUE_TYPES.filter((type) => type !== '333'));

const _scrambowInstances = new Map();
const _legacy333ScrambleQueue = sanitizeScrambleQueue(load(LEGACY_SCRAMBLE_QUEUE_STORAGE_KEY, []));
const _scrambleQueues = sanitizeScrambleQueues(load(SCRAMBLE_QUEUES_STORAGE_KEY, null), _legacy333ScrambleQueue);
let _scrambleType = sanitizeScrambleType(load(SCRAMBLE_TYPE_STORAGE_KEY, '333'));

let _currentScramble = null;
let _prevScramble = null;
let _isViewingPrev = false;

function sanitizeScrambleQueue(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((entry) => typeof entry === 'string' && entry.trim())
        .map((entry) => normalizeScrambleText(entry))
        .slice(0, SCRAMBLE_QUEUE_MAX);
}

function sanitizeScrambleQueues(value, legacy333Queue = []) {
    const queues = Object.fromEntries(SCRAMBLE_QUEUE_TYPES.map((type) => [type, []]));

    if (value && typeof value === 'object' && !Array.isArray(value)) {
        SCRAMBLE_QUEUE_TYPES.forEach((type) => {
            queues[type] = sanitizeScrambleQueue(value[type]);
        });
    }

    if (queues['333'].length === 0 && legacy333Queue.length > 0) {
        queues['333'] = [...legacy333Queue];
    }

    return queues;
}

function sanitizeScrambleType(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return SCRAMBLE_TYPE_SET.has(normalized) ? normalized : '333';
}

function normalizeScrambleText(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isOnlyUpperFaceTurnsScramble(scramble) {
    const tokens = normalizeScrambleText(scramble).split(' ').filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => /^U(?:2|'|)?$/.test(token));
}

function getScrambleQueue(type) {
    const normalizedType = sanitizeScrambleType(type);
    return SCRAMBLE_QUEUE_TYPE_SET.has(normalizedType) ? _scrambleQueues[normalizedType] : [];
}

function persistScrambleQueues() {
    const queuesToSave = {};

    SCRAMBLE_QUEUE_TYPES.forEach((type) => {
        queuesToSave[type] = getScrambleQueue(type).slice(0, SCRAMBLE_QUEUE_MAX);
    });

    save(SCRAMBLE_QUEUES_STORAGE_KEY, queuesToSave);
    save(LEGACY_SCRAMBLE_QUEUE_STORAGE_KEY, queuesToSave['333']);
}

function persistScrambleType() {
    save(SCRAMBLE_TYPE_STORAGE_KEY, _scrambleType);
}

async function initCubingScrambler() {
    if (randomScrambleForEvent) return randomScrambleForEvent;
    if (_cubingInitPromise) return _cubingInitPromise;

    _cubingInitPromise = (async () => {
        try {
            const module = await import('https://cdn.cubing.net/v0/js/cubing/scramble');
            randomScrambleForEvent = module.randomScrambleForEvent;
            return randomScrambleForEvent;
        } catch (e) {
            console.error('Failed to load cubing.js scramble module:', e);
            throw e;
        } finally {
            if (!randomScrambleForEvent) {
                _cubingInitPromise = null;
            }
        }
    })();

    return _cubingInitPromise;
}

function resolveScrambowCtor() {
    if (_scrambowCtor) return _scrambowCtor;
    if (typeof window === 'undefined') return null;

    const maybeCtor = window.scrambow?.Scrambow;
    if (typeof maybeCtor === 'function') {
        _scrambowCtor = maybeCtor;
    }

    return _scrambowCtor;
}

async function initScrambow() {
    const existingCtor = resolveScrambowCtor();
    if (existingCtor) return existingCtor;
    if (_scrambowInitPromise) return _scrambowInitPromise;

    _scrambowInitPromise = new Promise((resolve, reject) => {
        let script = document.querySelector('script[data-scrambow-loader="true"]');

        if (script?.dataset.scrambowFailed === 'true') {
            script.remove();
            script = null;
        }

        const cleanup = () => {
            script?.removeEventListener('load', handleLoad);
            script?.removeEventListener('error', handleError);
        };

        const handleLoad = () => {
            cleanup();
            const ctor = resolveScrambowCtor();
            if (ctor) {
                if (script) script.dataset.scrambowLoaded = 'true';
                resolve(ctor);
                return;
            }
            reject(new Error('Scrambow loaded without exposing Scrambow.'));
        };

        const handleError = () => {
            cleanup();
            if (script) {
                script.dataset.scrambowFailed = 'true';
                script.remove();
            }
            reject(new Error('Failed to load Scrambow script.'));
        };

        if (script?.dataset.scrambowLoaded === 'true') {
            handleLoad();
            return;
        }

        if (!script) {
            script = document.createElement('script');
            script.src = SCRAMBOW_SCRIPT_SRC;
            script.async = true;
            script.dataset.scrambowLoader = 'true';
            document.head.append(script);
        }

        script.addEventListener('load', handleLoad, { once: true });
        script.addEventListener('error', handleError, { once: true });
    }).finally(() => {
        if (!_scrambowCtor) {
            _scrambowInitPromise = null;
        }
    });

    return _scrambowInitPromise;
}

async function createCubingScramble(eventId) {
    if (!randomScrambleForEvent) {
        await initCubingScrambler();
    }

    const alg = await randomScrambleForEvent(eventId);
    return normalizeScrambleText(alg.toString());
}

function takeQueuedScramble(type) {
    const queue = getScrambleQueue(type);
    if (queue.length === 0) return null;

    const scramble = queue.shift();
    persistScrambleQueues();
    scheduleQueueFill(type);
    return scramble;
}

async function fillScrambleQueue(type) {
    const normalizedType = sanitizeScrambleType(type);
    if (!SCRAMBLE_QUEUE_TYPE_SET.has(normalizedType)) return null;

    const existingPromise = _queueFillPromises.get(normalizedType);
    if (existingPromise) return existingPromise;

    const fillPromise = (async () => {
        try {
            const queue = getScrambleQueue(normalizedType);
            while (queue.length < SCRAMBLE_QUEUE_TARGET) {
                queue.push(await createScrambleForType(normalizedType));
                persistScrambleQueues();
                if (queue.length < SCRAMBLE_QUEUE_TARGET) {
                    await yieldQueueFillTurn(normalizedType);
                }
            }
        } catch (e) {
            console.error(`Failed to prefill ${normalizedType} scramble queue:`, e);
        } finally {
            _queueFillPromises.delete(normalizedType);
        }
    })();

    _queueFillPromises.set(normalizedType, fillPromise);
    return fillPromise;
}

function scheduleQueueFill(type = _scrambleType) {
    const normalizedType = sanitizeScrambleType(type);
    if (!SCRAMBLE_QUEUE_TYPE_SET.has(normalizedType)) return;

    if (
        getScrambleQueue(normalizedType).length >= SCRAMBLE_QUEUE_TARGET
        || _queueFillPromises.has(normalizedType)
        || _queueFillScheduled.has(normalizedType)
    ) {
        return;
    }

    const run = () => {
        _queueFillScheduled.delete(normalizedType);

        if (getScrambleQueue(normalizedType).length >= SCRAMBLE_QUEUE_TARGET || _queueFillPromises.has(normalizedType)) {
            return;
        }

        void fillScrambleQueue(normalizedType);
    };

    const shouldDefer = DEFERRED_QUEUE_FILL_TYPES.has(normalizedType);
    if (!shouldDefer) {
        run();
        return;
    }

    _queueFillScheduled.add(normalizedType);
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 600 });
        return;
    }

    window.setTimeout(run, 60);
}

function yieldQueueFillTurn(type) {
    if (!DEFERRED_QUEUE_FILL_TYPES.has(type)) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(() => resolve(), { timeout: 120 });
            return;
        }

        window.setTimeout(resolve, 0);
    });
}

function scheduleBootstrapQueueFill(type = _scrambleType) {
    const normalizedType = sanitizeScrambleType(type);
    if (!SCRAMBLE_QUEUE_TYPE_SET.has(normalizedType) || _bootstrapQueueFillScheduled.has(normalizedType)) return;

    _bootstrapQueueFillScheduled.add(normalizedType);

    const run = () => {
        const flush = () => {
            _bootstrapQueueFillScheduled.delete(normalizedType);
            scheduleQueueFill(normalizedType);
        };

        if (DEFERRED_QUEUE_FILL_TYPES.has(normalizedType) && typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(flush, { timeout: 1400 });
            return;
        }

        flush();
    };

    if (DEFERRED_QUEUE_FILL_TYPES.has(normalizedType)) {
        window.setTimeout(run, SUBSET_BOOTSTRAP_QUEUE_FILL_DELAY_MS);
        return;
    }

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 800 });
        return;
    }

    window.setTimeout(run, 150);
}

async function generateNextScrambleForType(type) {
    const normalizedType = sanitizeScrambleType(type);
    const cachedScramble = takeQueuedScramble(normalizedType);
    if (cachedScramble) {
        return cachedScramble;
    }

    const scramble = await createScrambleForType(normalizedType);
    scheduleQueueFill(normalizedType);
    return scramble;
}

function extractScrambleText(result) {
    if (typeof result === 'string') return normalizeScrambleText(result);

    if (result && typeof result === 'object') {
        if (typeof result.scramble_string === 'string') return normalizeScrambleText(result.scramble_string);
        if (typeof result.scramble === 'string') return normalizeScrambleText(result.scramble);
    }

    throw new Error('Scrambler returned an unsupported scramble format.');
}

function getScrambowInstance(type) {
    if (!_scrambowCtor) {
        throw new Error('Scrambow is not initialized.');
    }

    if (!_scrambowInstances.has(type)) {
        _scrambowInstances.set(type, new _scrambowCtor(type));
    }

    return _scrambowInstances.get(type);
}

async function createSubsetScramble(type) {
    await initScrambow();
    const scrambler = getScrambowInstance(type);
    let lastScramble = '';

    for (let attempt = 0; attempt < SUBSET_REDRAW_LIMIT; attempt += 1) {
        const result = scrambler.get(1)?.[0];
        const scramble = extractScrambleText(result);
        if (!isOnlyUpperFaceTurnsScramble(scramble)) {
            return scramble;
        }
        lastScramble = scramble;
    }

    console.warn(`Subset scrambler kept returning only-U moves for ${type}; using the last generated scramble.`);
    return lastScramble;
}

async function createScrambleForType(type) {
    const normalizedType = sanitizeScrambleType(type);
    const cubingEventId = CUBING_SCRAMBLE_EVENTS.get(normalizedType);
    if (cubingEventId) return createCubingScramble(cubingEventId);
    if (SCRAMBOW_SCRAMBLE_TYPES.has(normalizedType)) return createSubsetScramble(normalizedType);
    throw new Error(`Unsupported scramble type: ${type}`);
}

function getActiveScrambleEntry() {
    return _isViewingPrev ? _prevScramble : _currentScramble;
}

function resetScrambleHistory() {
    _currentScramble = null;
    _prevScramble = null;
    _isViewingPrev = false;
}

function pushNewScramble(scrambleStr, type = _scrambleType, isManual = false) {
    _prevScramble = _currentScramble;
    _currentScramble = {
        text: normalizeScrambleText(scrambleStr),
        isManual,
        type: sanitizeScrambleType(type),
    };
    _isViewingPrev = false;
}

export function getSelectedScrambleType() {
    return _scrambleType;
}

export function getCurrentScrambleType() {
    return getActiveScrambleEntry()?.type ?? _scrambleType;
}

export function setScrambleType(type) {
    const nextType = sanitizeScrambleType(type);
    if (nextType === _scrambleType) return false;

    _scrambleType = nextType;
    persistScrambleType();
    resetScrambleHistory();
    return true;
}

export async function getScramble() {
    const type = _scrambleType;
    const text = await generateNextScrambleForType(type);
    pushNewScramble(text, type, false);
    return text;
}

export function getPrevScramble() {
    if (_prevScramble && !_isViewingPrev) {
        _isViewingPrev = true;
        return _prevScramble.text;
    }
    return null;
}

export function hasPrevScramble() {
    return _prevScramble !== null && !_isViewingPrev;
}

export function isViewingPreviousScramble() {
    return _isViewingPrev;
}

export async function getNextScramble() {
    if (_isViewingPrev && _currentScramble) {
        _isViewingPrev = false;
        return _currentScramble.text;
    }
    return getScramble();
}

export function getCurrentScramble() {
    return getActiveScrambleEntry()?.text ?? '';
}

export function setCurrentScramble(scrambleStr) {
    const normalized = normalizeScrambleText(scrambleStr);
    const active = getActiveScrambleEntry();
    const entryType = active?.type ?? _scrambleType;

    if (_isViewingPrev) {
        pushNewScramble(normalized, entryType, true);
    } else if (_currentScramble) {
        _currentScramble.text = normalized;
        _currentScramble.isManual = true;
        _currentScramble.type = entryType;
    } else {
        pushNewScramble(normalized, entryType, true);
    }
}

export function isCurrentScrambleManual() {
    const active = getActiveScrambleEntry();
    return active ? active.isManual : false;
}

function bootstrapInitialScrambleFromCache() {
    const queue = getScrambleQueue(_scrambleType);
    if (queue.length === 0) {
        return;
    }

    const cachedScramble = queue.shift();
    persistScrambleQueues();
    pushNewScramble(cachedScramble, _scrambleType, false);
    scheduleBootstrapQueueFill(_scrambleType);
}

bootstrapInitialScrambleFromCache();
