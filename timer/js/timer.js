import { settings } from './settings.js';
import { EventEmitter, formatTime } from './utils.js';

const State = {
    IDLE: 'idle',
    HOLDING: 'holding',
    READY: 'ready',
    INSPECTION_PRIMED: 'inspection-primed',
    INSPECTING: 'inspecting',
    INSPECTION_HOLDING: 'inspection-holding',
    INSPECTION_READY: 'inspection-ready',
    RUNNING: 'running',
    STOPPED: 'stopped',
};

class Timer extends EventEmitter {
    constructor() {
        super();
        this.state = State.IDLE;
        this.startTime = 0;
        this.elapsed = 0;
        this._inspectionStartTime = 0;
        this._inspectionElapsed = 0;
        this._pendingPenalty = null;
        this._inspectionSnapshot = null;
        this._inspectionAlertsFired = new Set();
        this._holdTimer = null;
        this._rafId = null;
        this._displayEl = null;
        this._spaceDown = false;
        this._leftDown = false;
        this._rightDown = false;
        this._leftAltDown = false;
        this._rightAltDown = false;

        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
        this._tick = this._tick.bind(this);
    }

    init(displayEl) {
        this._displayEl = displayEl;
        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);
        this._updateDisplay('0.00');
        this._setColor(State.IDLE);
    }

    destroy() {
        document.removeEventListener('keydown', this._onKeyDown);
        document.removeEventListener('keyup', this._onKeyUp);
        this._cancelHold();
        this._cancelRaf();
    }

    _onKeyDown(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if (this._hasBlockingOverlayOpen()) return;

        const isStackmatKey = this._isStackmatKey(e);
        const isEscape = e.code === 'Escape' || e.key === 'Escape' || e.keyCode === 27;
        const isDnfKey = isEscape || e.code === 'Backspace' || e.key === 'Backspace' || e.keyCode === 8 || e.code === 'Delete' || e.key === 'Delete' || e.keyCode === 46;

        if ((e.ctrlKey || e.metaKey) && !isStackmatKey && !isEscape) return;

        if (isDnfKey && this.state === State.RUNNING) {
            this._stopTimer('DNF');
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }

        if (isEscape && this._isInspectionPreSolveState(this.state)) {
            this._cancelInspection();
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }

        if (isEscape && (this.state === State.HOLDING || this.state === State.READY)) {
            this._cancelHold();
            this._setState(State.IDLE);
            this._setColor(State.IDLE);
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }

        if (this.state === State.RUNNING) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this._stopTimer();
            return;
        }

        if (e.code === 'Space') {
            e.preventDefault();
            if (this._spaceDown) return;
            this._spaceDown = true;
            this._handleStartPress();
            return;
        }

        if (!isStackmatKey) return;

        e.preventDefault();
        const wasStackmatReady = this._isStackmatActive();
        this._setStackmatFlag(e.code, true);
        if (!wasStackmatReady && this._isStackmatActive()) {
            this._handleStartPress();
        }
    }

    _onKeyUp(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        const isStackmatKey = this._isStackmatKey(e);

        if (this._hasBlockingOverlayOpen()) {
            if (e.code === 'Space') this._spaceDown = false;
            if (isStackmatKey) this._setStackmatFlag(e.code, false);
            return;
        }

        if ((e.ctrlKey || e.metaKey) && !isStackmatKey) return;

        if (e.code === 'Space') {
            e.preventDefault();
            this._spaceDown = false;
            this._handleStartRelease();
            return;
        }

        if (!isStackmatKey) return;

        e.preventDefault();
        const wasStackmatReady = this._isStackmatActive();
        this._setStackmatFlag(e.code, false);
        if (wasStackmatReady && !this._isStackmatActive()) {
            this._handleStartRelease();
        }
    }

    _handleStartPress() {
        if (this.state === State.IDLE || this.state === State.STOPPED) {
            if (this._inspectionEnabled()) {
                this._armInspection();
            } else {
                this._startHold();
            }
            return;
        }

        if (this.state === State.INSPECTING) {
            this._startInspectionHold();
        }
    }

    _handleStartRelease() {
        if (this.state === State.HOLDING) {
            this._cancelHold();
            this._setState(State.STOPPED);
            this._setColor(State.STOPPED);
            return;
        }

        if (this.state === State.READY) {
            this._startTimer();
            return;
        }

        if (this.state === State.INSPECTION_PRIMED) {
            this._startInspection();
            return;
        }

        if (this.state === State.INSPECTION_HOLDING) {
            this._cancelHold();
            this._setState(State.INSPECTING);
            this._setColor(State.INSPECTING);
            return;
        }

        if (this.state === State.INSPECTION_READY) {
            this._startTimer();
        }
    }

    _startHold() {
        this._setState(State.HOLDING);
        this._setColor(State.HOLDING);

        const holdDuration = settings.get('holdDuration');
        this._holdTimer = setTimeout(() => {
            this._holdTimer = null;
            this._setState(State.READY);
            this._setColor(State.READY);
        }, holdDuration);
    }

    _armInspection() {
        if (!this._inspectionSnapshot) {
            this._inspectionSnapshot = {
                state: this.state,
                text: this._displayEl ? this._displayEl.textContent : '0.00',
            };
        }

        this._pendingPenalty = null;
        this._setState(State.INSPECTION_PRIMED);
        this._setColor(State.INSPECTION_PRIMED);
    }

    _startInspection() {
        this._cancelHold();
        this._cancelRaf();
        this._inspectionStartTime = performance.now();
        this._inspectionElapsed = 0;
        this._inspectionAlertsFired.clear();
        this._pendingPenalty = null;

        this._setState(State.INSPECTING);
        this._setColor(State.INSPECTING);

        if (this._shouldShowInspectionCount()) {
            this._updateDisplay('0');
        } else {
            this._updateDisplay('Inspect');
        }

        this._tick();
    }

    _startInspectionHold() {
        this._setState(State.INSPECTION_HOLDING);
        this._setColor(State.INSPECTION_HOLDING);

        const holdDuration = settings.get('holdDuration');
        this._holdTimer = setTimeout(() => {
            this._holdTimer = null;
            this._setState(State.INSPECTION_READY);
            this._setColor(State.INSPECTION_READY);
        }, holdDuration);
    }

    _cancelInspection() {
        this._cancelHold();
        this._cancelRaf();
        this._inspectionStartTime = 0;
        this._inspectionElapsed = 0;
        this._pendingPenalty = null;
        this._inspectionAlertsFired.clear();

        const snapshot = this._inspectionSnapshot;
        this._inspectionSnapshot = null;

        if (snapshot) {
            this._updateDisplay(snapshot.text);
            this._setState(snapshot.state);
            this._setColor(snapshot.state);
            return;
        }

        this._setState(State.STOPPED);
        this._setColor(State.STOPPED);
    }

    _cancelHold() {
        if (this._holdTimer) {
            clearTimeout(this._holdTimer);
            this._holdTimer = null;
        }
    }

    _startTimer() {
        const fromInspection = this._isInspectionTickingState(this.state);

        this._cancelHold();
        this._cancelRaf();

        if (!fromInspection) {
            this._pendingPenalty = null;
        }

        this._inspectionSnapshot = null;
        this._inspectionStartTime = 0;
        this._inspectionElapsed = 0;
        this._inspectionAlertsFired.clear();

        this._setState(State.RUNNING);
        this._setColor(State.RUNNING);
        this.startTime = performance.now();
        this.elapsed = 0;

        if (!this._shouldShowRunningTime()) {
            this._updateDisplay('...');
        }

        this.emit('started', this._pendingPenalty);
        this._tick();
    }

    _tick() {
        if (this.state === State.RUNNING) {
            this.elapsed = performance.now() - this.startTime;

            if (this._shouldShowRunningTime()) {
                let displayTime = this.elapsed;
                let digits = 2;
                const updateMode = settings.get('timerUpdate');
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
            return;
        }

        if (!this._isInspectionTickingState(this.state)) {
            this._rafId = null;
            return;
        }

        this._inspectionElapsed = performance.now() - this._inspectionStartTime;
        this._pendingPenalty = this._getInspectionPenalty(this._inspectionElapsed);

        this._emitInspectionAlert(8, 8000);
        this._emitInspectionAlert(12, 12000);

        if (this._shouldShowInspectionCount()) {
            this._updateDisplay(this._formatInspectionDisplay(this._inspectionElapsed));
        }

        this._rafId = requestAnimationFrame(this._tick);
    }

    _emitInspectionAlert(seconds, thresholdMs) {
        if (this._inspectionAlertsFired.has(seconds) || this._inspectionElapsed < thresholdMs) return;
        this._inspectionAlertsFired.add(seconds);
        this.emit('inspectionAlert', seconds);
    }

    _stopTimer(penaltyOverride = null) {
        this._cancelRaf();
        this.elapsed = performance.now() - this.startTime;

        const finalPenalty = penaltyOverride ?? this._pendingPenalty ?? null;

        this._setState(State.STOPPED);
        this._setColor(State.STOPPED);
        this._updateDisplay(this._formatStoppedDisplay(this.elapsed, finalPenalty));

        this._pendingPenalty = null;
        this._inspectionSnapshot = null;
        this.emit('stopped', this.elapsed, finalPenalty);
    }

    _cancelRaf() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    _inspectionEnabled() {
        return settings.get('inspectionTime') === '15s';
    }

    _shouldShowInspectionCount() {
        return settings.get('timerUpdate') !== 'none';
    }

    _shouldShowRunningTime() {
        const updateMode = settings.get('timerUpdate');
        return updateMode !== 'none' && updateMode !== 'inspection';
    }

    _getInspectionPenalty(elapsed) {
        if (elapsed >= 17000) return 'DNF';
        if (elapsed >= 15000) return '+2';
        return null;
    }

    _formatInspectionDisplay(elapsed) {
        const penalty = this._getInspectionPenalty(elapsed);
        if (penalty) return penalty;
        return String(Math.floor(elapsed / 1000));
    }

    _formatStoppedDisplay(elapsed, penalty) {
        if (penalty === 'DNF') return formatTime(elapsed);

        let display = formatTime(penalty === '+2' ? elapsed + 2000 : elapsed);
        if (penalty === '+2') display += '+';
        return display;
    }

    _isInspectionTickingState(state) {
        return state === State.INSPECTING
            || state === State.INSPECTION_HOLDING
            || state === State.INSPECTION_READY;
    }

    _isInspectionPreSolveState(state) {
        return state === State.INSPECTION_PRIMED || this._isInspectionTickingState(state);
    }

    _hasBlockingOverlayOpen() {
        return Boolean(document.querySelector('.modal-overlay.active, .settings-overlay.active'));
    }

    _isStackmatKey(e) {
        return e.code === 'ControlLeft'
            || e.code === 'ControlRight'
            || e.code === 'MetaLeft'
            || e.code === 'MetaRight'
            || e.code === 'AltLeft'
            || e.code === 'AltRight';
    }

    _isStackmatActive() {
        const isBothCtrlCmd = this._leftDown && this._rightDown;
        const isBothAltOpt = this._leftAltDown && this._rightAltDown;
        return isBothCtrlCmd || isBothAltOpt;
    }

    _setStackmatFlag(code, isDown) {
        if (code === 'ControlLeft' || code === 'MetaLeft') this._leftDown = isDown;
        if (code === 'ControlRight' || code === 'MetaRight') this._rightDown = isDown;
        if (code === 'AltLeft') this._leftAltDown = isDown;
        if (code === 'AltRight') this._rightAltDown = isDown;
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

    setDisplay(text) {
        this._updateDisplay(text);
    }

    resetDisplay() {
        this._updateDisplay('0.00');
        this._setColor(State.IDLE);
        this._setState(State.IDLE);
    }

    getState() {
        return this.state;
    }
}

export const timer = new Timer();
