import { settings } from './settings.js';
import { EventEmitter, formatTime } from './utils.js';

const State = {
    IDLE: 'idle',
    HOLDING: 'holding',
    READY: 'ready',
    RUNNING: 'running',
    STOPPED: 'stopped',
};

class Timer extends EventEmitter {
    constructor() {
        super();
        this.state = State.IDLE;
        this.startTime = 0;
        this.elapsed = 0;
        this._holdTimer = null;
        this._rafId = null;
        this._displayEl = null;
        this._spaceDown = false;

        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
        this._tick = this._tick.bind(this);
    }

    init(displayEl) {
        this._displayEl = displayEl;
        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);
        this._updateDisplay('0.00');
        this._setColor('idle');
    }

    destroy() {
        document.removeEventListener('keydown', this._onKeyDown);
        document.removeEventListener('keyup', this._onKeyUp);
        this._cancelHold();
        this._cancelRaf();
    }

    _onKeyDown(e) {
        // Ignore if typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        // Ignore if modal is open
        if (document.querySelector('.modal-overlay.active')) return;

        const isEscape = e.code === 'Escape' || e.key === 'Escape' || e.keyCode === 27;

        if (isEscape) {
            if (this.state === State.RUNNING) {
                this._stopTimer(true); // Stop and trigger DNF
                e.preventDefault();
                return;
            } else if (this.state === State.HOLDING || this.state === State.READY) {
                this._cancelHold();
                this._setState(State.IDLE);
                this._setColor('idle');
                e.preventDefault();
                return;
            }
        }

        if (this.state === State.RUNNING) {
            // Any key stops the timer
            e.preventDefault();
            this._stopTimer();
            return;
        }

        if (e.code === 'Space') {
            e.preventDefault();
            if (this._spaceDown) return; // Prevent key repeat
            this._spaceDown = true;

            if (this.state === State.IDLE || this.state === State.STOPPED) {
                this._startHold();
            }
        }
    }

    _onKeyUp(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

        if (e.code === 'Space') {
            e.preventDefault();
            this._spaceDown = false;

            if (this.state === State.HOLDING) {
                // Released too early - keep old time visible
                this._cancelHold();
                this._setState(State.STOPPED);
                this._setColor('stopped');
            } else if (this.state === State.READY) {
                // GO!
                this._startTimer();
            }
        }
    }

    _startHold() {
        this._setState(State.HOLDING);
        this._setColor('holding');
        // Keep old time visible - don't reset display

        const holdDuration = settings.get('holdDuration');
        this._holdTimer = setTimeout(() => {
            this._holdTimer = null;
            this._setState(State.READY);
            this._setColor('ready');
        }, holdDuration);
    }

    _cancelHold() {
        if (this._holdTimer) {
            clearTimeout(this._holdTimer);
            this._holdTimer = null;
        }
    }

    _startTimer() {
        this._setState(State.RUNNING);
        this._setColor('running');
        this.startTime = performance.now();
        this.elapsed = 0;

        if (settings.get('timerUpdate') === 'none') {
            this._updateDisplay('...');
        }

        this.emit('started');
        this._tick();
    }

    _tick() {
        if (this.state !== State.RUNNING) return;
        this.elapsed = performance.now() - this.startTime;

        const updateMode = settings.get('timerUpdate');
        if (updateMode !== 'none') {
            let displayTime = this.elapsed;
            let digits = 2; // '0.01s' default
            if (updateMode === '1s') {
                displayTime = Math.floor(displayTime / 1000) * 1000;
                digits = 0;
            } else if (updateMode === '0.1s') {
                displayTime = Math.floor(displayTime / 100) * 100;
                digits = 1;
            }
            this._updateDisplay(formatTime(displayTime, digits));
        }

        this._rafId = requestAnimationFrame(this._tick);
    }

    _stopTimer(isDNF = false) {
        this._cancelRaf();
        this.elapsed = performance.now() - this.startTime;
        this._setState(State.STOPPED);
        this._setColor('stopped');
        this._updateDisplay(formatTime(this.elapsed));
        this.emit('stopped', this.elapsed, isDNF);
    }

    _cancelRaf() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    _setState(state) {
        this.state = state;
        this.emit('stateChange', state);
    }

    _setColor(state) {
        if (!this._displayEl) return;
        this._displayEl.dataset.timerState = state;
    }

    _updateDisplay(text) {
        if (!this._displayEl) return;
        this._displayEl.textContent = text;
    }

    /** Manually set display text (e.g. after penalty change) */
    setDisplay(text) {
        this._updateDisplay(text);
    }

    /** Reset display to 0.00 (e.g. when current solve is deleted) */
    resetDisplay() {
        this._updateDisplay('0.00');
        this._setColor('idle');
        this._setState(State.IDLE);
    }

    getState() {
        return this.state;
    }
}

export const timer = new Timer();
