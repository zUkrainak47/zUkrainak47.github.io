import { load, save } from './storage.js';
import { EventEmitter } from './utils.js';

const DEFAULTS = {
    inspectionTime: 'off',  // 'off', '15s'
    inspectionAlerts: 'off', // 'off', 'voice', 'screen', 'both'
    timerUpdate: '0.01s',   // 'none', 'inspection', '1s', '0.1s', '0.01s'
    timeEntryMode: 'timer', // 'timer', 'typing'
    holdDuration: 300,       // ms
    animationMode: 'auto',   // 'auto', 'on', 'off'
    animationsEnabled: true, // Legacy effective boolean kept for backwards compatibility.
    highContrastMode: false,
    displayFont: 'jetbrains-mono',
    largeScrambleText: false,
    pillSize: 'medium',       // 'small', 'medium', 'large', 'hidden'
    statsFilter: 'all',     // 'all', 'today', 'week', 'month', 'custom'
    customFilterDuration: '', // e.g. '3d', '2h', '100', '100 solves'
    summaryStatsPreset: 'basic', // 'basic', 'extended', 'full', 'custom'
    summaryStatsCustom: 'mo3 ao5 ao12 ao100',
    summaryStatsList: ['mo3', 'ao5', 'ao12', 'ao100'],
    solvesTableStat1: 'ao5',
    solvesTableStat2: 'ao12',
    zenMode: false,
    cubeCollapsed: false,
    graphCollapsed: false,
    graphView: { visibleCount: 0, yZoom: 1, xPan: 1, yPan: 0 },
    showDelta: false,
    newBestPopupEnabled: true,
    newBestColor: '#FE2B2B',
    graphColorTime: '#8b949e',
    graphLine1Stat: 'ao5',
    graphLine2Stat: 'ao12',
    graphLine3Stat: 'ao100',
    graphColorLine1: '#ff2020',
    graphColorLine2: '#2b91ff',
    graphColorLine3: '#a371f7',
    // Legacy keys kept for backwards compatibility with older exports/imports.
    graphColorAo5: '#ff2020',
    graphColorAo12: '#2b91ff',
    graphColorAo100: '#a371f7',
    graphTooltipDateEnabled: true,
    centerTimer: true,
    hideUIWhileSolving: true,
    backgroundSpacebarEnabled: false,
    swipeDownGestureEnabled: true,
    shortcutTooltipsEnabled: true,
};

export { DEFAULTS };

const ANIMATION_MODES = new Set(['auto', 'on', 'off']);

const DISPLAY_FONT_STACKS = {
    arial: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
    'jetbrains-mono': "'JetBrains Mono', 'Consolas', monospace",
    'roboto-mono': "'Roboto Mono', 'JetBrains Mono', 'Consolas', monospace",
    monospace: "monospace",
};

class Settings extends EventEmitter {
    constructor() {
        super();
        this._motionPreferenceQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : null;
        const loaded = load('settings', {});
        this._settings = { ...DEFAULTS, ...loaded };

        if (!ANIMATION_MODES.has(this._settings.animationMode)) {
            if (typeof loaded.animationsEnabled === 'boolean') {
                this._settings.animationMode = loaded.animationsEnabled ? 'on' : 'off';
            } else {
                this._settings.animationMode = DEFAULTS.animationMode;
            }
        }

        if (!('graphColorLine1' in loaded) && typeof loaded.graphColorAo5 === 'string') {
            this._settings.graphColorLine1 = loaded.graphColorAo5;
        }
        if (!('graphColorLine2' in loaded) && typeof loaded.graphColorAo12 === 'string') {
            this._settings.graphColorLine2 = loaded.graphColorAo12;
        }
        if (!('graphColorLine3' in loaded) && typeof loaded.graphColorAo100 === 'string') {
            this._settings.graphColorLine3 = loaded.graphColorAo100;
        }

        if (loaded.graphLines && typeof loaded.graphLines === 'object') {
            const nextGraphLines = { ...loaded.graphLines };
            if (!('line1' in nextGraphLines) && 'ao5' in nextGraphLines) nextGraphLines.line1 = !!nextGraphLines.ao5;
            if (!('line2' in nextGraphLines) && 'ao12' in nextGraphLines) nextGraphLines.line2 = !!nextGraphLines.ao12;
            if (!('line3' in nextGraphLines) && 'ao100' in nextGraphLines) nextGraphLines.line3 = !!nextGraphLines.ao100;
            this._settings.graphLines = nextGraphLines;
        }

        this._syncAnimationSettings();
        this._bindMotionPreferenceListener();
        this._apply();
    }

    get(key) {
        const val = this._settings[key];
        // Return a deep clone for objects so callers don't mutate internal state
        if (typeof val === 'object' && val !== null) {
            return JSON.parse(JSON.stringify(val));
        }
        return val;
    }

    getAll() {
        return JSON.parse(JSON.stringify(this._settings));
    }

    _normalizeAnimationMode(value) {
        if (value === true) return 'on';
        if (value === false) return 'off';
        return ANIMATION_MODES.has(value) ? value : DEFAULTS.animationMode;
    }

    _areAnimationsEnabled() {
        const animationMode = this._normalizeAnimationMode(this._settings.animationMode);
        if (animationMode === 'on') return true;
        if (animationMode === 'off') return false;
        return !Boolean(this._motionPreferenceQuery?.matches);
    }

    _syncAnimationSettings() {
        this._settings.animationMode = this._normalizeAnimationMode(this._settings.animationMode);
        this._settings.animationsEnabled = this._areAnimationsEnabled();
    }

    _bindMotionPreferenceListener() {
        if (!this._motionPreferenceQuery) return;

        const handleMotionPreferenceChange = () => {
            if (this._settings.animationMode !== 'auto') return;

            const previousEnabled = this._settings.animationsEnabled;
            this._syncAnimationSettings();

            if (previousEnabled === this._settings.animationsEnabled) return;

            save('settings', this._settings);
            this._apply();
        };

        if (typeof this._motionPreferenceQuery.addEventListener === 'function') {
            this._motionPreferenceQuery.addEventListener('change', handleMotionPreferenceChange);
        } else if (typeof this._motionPreferenceQuery.addListener === 'function') {
            this._motionPreferenceQuery.addListener(handleMotionPreferenceChange);
        }
    }

    set(key, value) {
        if (key === 'animationsEnabled') {
            key = 'animationMode';
            value = value ? 'on' : 'off';
        }

        if (key === 'animationMode') {
            const nextAnimationMode = this._normalizeAnimationMode(value);
            if (this._settings.animationMode === nextAnimationMode) return;

            this._settings.animationMode = nextAnimationMode;
            this._syncAnimationSettings();
            save('settings', this._settings);
            this._apply();
            this.emit('change', 'animationMode', nextAnimationMode);
            this.emit('change', 'animationsEnabled', this._settings.animationsEnabled);
            return;
        }

        // Deep clone the incoming value if it's an object to prevent external mutation
        const isObj = typeof value === 'object' && value !== null;
        const nextVal = isObj ? JSON.parse(JSON.stringify(value)) : value;

        // Primitive equality check
        if (!isObj && this._settings[key] === nextVal) return;

        this._settings[key] = nextVal;
        save('settings', this._settings);
        this._apply();
        this.emit('change', key, nextVal);
    }

    reset() {
        this._settings = { ...DEFAULTS };
        this._syncAnimationSettings();
        save('settings', this._settings);
        this._apply();
        this.emit('reset');
    }

    _apply() {
        this._syncAnimationSettings();
        document.body.classList.toggle('no-animations', !this._settings.animationsEnabled);
        document.body.classList.toggle('high-contrast-mode', Boolean(this._settings.highContrastMode));
        document.body.classList.toggle('shortcut-tooltips-disabled', !this._settings.shortcutTooltipsEnabled);
        document.body.classList.toggle('typing-entry-mode', this._settings.timeEntryMode === 'typing');
        document.body.classList.toggle('background-spacebar-enabled', Boolean(this._settings.backgroundSpacebarEnabled));

        document.body.classList.remove('pill-size-small', 'pill-size-medium', 'pill-size-large', 'pill-size-hidden');
        document.body.classList.add(`pill-size-${this._settings.pillSize}`);

        const displayFont = DISPLAY_FONT_STACKS[this._settings.displayFont] || DISPLAY_FONT_STACKS[DEFAULTS.displayFont];
        document.documentElement.style.setProperty('--font-mono', displayFont);
        document.documentElement.style.setProperty('--font-timer', displayFont);
        document.documentElement.style.setProperty('--stat-new-best', this._settings.newBestColor);
        document.documentElement.style.setProperty('--graph-color-time', this._settings.graphColorTime);
        const line1Color = this._settings.graphColorLine1 || this._settings.graphColorAo5 || DEFAULTS.graphColorLine1;
        const line2Color = this._settings.graphColorLine2 || this._settings.graphColorAo12 || DEFAULTS.graphColorLine2;
        const line3Color = this._settings.graphColorLine3 || this._settings.graphColorAo100 || DEFAULTS.graphColorLine3;

        document.documentElement.style.setProperty('--graph-color-line1', line1Color);
        document.documentElement.style.setProperty('--graph-color-line2', line2Color);
        document.documentElement.style.setProperty('--graph-color-line3', line3Color);
        document.documentElement.style.setProperty('--graph-color-ao5', line1Color);
        document.documentElement.style.setProperty('--graph-color-ao12', line2Color);
        document.documentElement.style.setProperty('--graph-color-ao100', line3Color);

        const themeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (themeColorMeta) {
            themeColorMeta.setAttribute('content', this._settings.highContrastMode ? '#000000' : '#0d1117');
        }
    }
}

export const settings = new Settings();
