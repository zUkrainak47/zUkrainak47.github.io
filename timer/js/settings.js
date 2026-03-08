import { load, save } from './storage.js';
import { EventEmitter } from './utils.js';

const DEFAULTS = {
    inspectionTime: 'off',  // 'off', '15s'
    inspectionAlerts: 'off', // 'off', 'voice', 'screen', 'both'
    timerUpdate: '0.01s',   // 'none', 'inspection', '1s', '0.1s', '0.01s'
    timeEntryMode: 'timer', // 'timer', 'typing'
    holdDuration: 300,       // ms
    animationsEnabled: true,
    displayFont: 'jetbrains-mono',
    pillSize: 'small',       // 'small', 'medium', 'large', 'hidden'
    statsFilter: 'all',     // 'all', 'today', 'week', 'month', 'custom'
    customFilterDuration: '', // e.g. '3d', '2h'
    zenMode: false,
    cubeCollapsed: false,
    graphCollapsed: false,
    graphView: { visibleCount: 0, yZoom: 1, xPan: 1, yPan: 0 },
    showDelta: false,
    newBestPopupEnabled: true,
    newBestColor: '#FE2B2B',
    graphColorTime: '#8b949e',
    graphColorAo5: '#ff2020',
    graphColorAo12: '#2b91ff',
    graphColorAo100: '#a371f7',
    centerTimer: true,
    shortcutTooltipsEnabled: true,
};

export { DEFAULTS };

const DISPLAY_FONT_STACKS = {
    arial: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
    'jetbrains-mono': "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
    'roboto-mono': "'Roboto Mono', 'JetBrains Mono', 'Consolas', monospace",
    monospace: "monospace",
};

class Settings extends EventEmitter {
    constructor() {
        super();
        this._settings = { ...DEFAULTS, ...load('settings', {}) };
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

    set(key, value) {
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
        save('settings', this._settings);
        this._apply();
        this.emit('reset');
    }

    _apply() {
        document.body.classList.toggle('no-animations', !this._settings.animationsEnabled);
        document.body.classList.toggle('shortcut-tooltips-disabled', !this._settings.shortcutTooltipsEnabled);
        document.body.classList.toggle('typing-entry-mode', this._settings.timeEntryMode === 'typing');

        document.body.classList.remove('pill-size-small', 'pill-size-medium', 'pill-size-large', 'pill-size-hidden');
        document.body.classList.add(`pill-size-${this._settings.pillSize}`);

        const displayFont = DISPLAY_FONT_STACKS[this._settings.displayFont] || DISPLAY_FONT_STACKS[DEFAULTS.displayFont];
        document.documentElement.style.setProperty('--font-mono', displayFont);
        document.documentElement.style.setProperty('--font-timer', displayFont);
        document.documentElement.style.setProperty('--stat-new-best', this._settings.newBestColor);
        document.documentElement.style.setProperty('--graph-color-time', this._settings.graphColorTime);
        document.documentElement.style.setProperty('--graph-color-ao5', this._settings.graphColorAo5);
        document.documentElement.style.setProperty('--graph-color-ao12', this._settings.graphColorAo12);
        document.documentElement.style.setProperty('--graph-color-ao100', this._settings.graphColorAo100);
    }
}

export const settings = new Settings();
