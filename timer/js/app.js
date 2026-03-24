import { timer } from './timer.js?v=5';
import { SCRAMBLE_TYPE_OPTIONS, getScramble, getCurrentScramble, getCurrentScrambleType, getPrevScramble, getNextScramble, getSelectedScrambleType, setCurrentScramble, setScrambleType, isCurrentScrambleManual, hasPrevScramble, isViewingPreviousScramble } from './scramble.js?v=9';
import { sessionManager } from './session.js';
import { settings, DEFAULTS } from './settings.js';
import { parseGraphStatType, parseRollingStatType, rollingStatAt, StatsCache } from './stats.js?v=2';
import { formatTime, formatSolveTime, formatTimerDisplayTime, getEffectiveTime, formatDate } from './utils.js';
import { initModal, showSolveDetail, showAverageDetail, closeModal, customConfirm, customPrompt, getModalSelectionContext, setModalStatNavigator, setModalStatButtons, armModalGhostClickGuard } from './modal.js?v=12';
import { applyScramble, initCubeDisplay, updateCubeDisplay } from './cube-display.js';
import { initGraph, updateGraph, updateGraphData, setLineVisibility, getLineVisibility, applyAction, graphEvents, getGraphLineDefinitions } from './graph.js?v=8';
import { exportAll, importAll, isCsTimerFormat, importCsTimer, exportCsTimer } from './storage.js';

let currentScramble = '';
let currentSortCol = null;
let currentSortDir = null; // 'asc' or 'desc'
let commentsOnlyFilterActive = false;
const statsCache = new StatsCache();
let _skipSolveAddedRefresh = false; // set true when commitSolve manages the refresh itself

// ──── Solves table virtualization state ────
const TABLE_ROW_HEIGHT = 27; // px per row, matches CSS
let _tableScrollHandler = null;
let _tableSortedIndices = null; // cached sorted index order
let _tableSolves = null; // reference to current solves array
const popupState = {
    inspection: { elementId: 'inspection-alert', hideTimeout: null, clearTimeout: null },
    newBest: { elementId: 'new-best-alert', hideTimeout: null, clearTimeout: null },
    penaltyShortcut: { elementId: 'penalty-shortcut-alert', hideTimeout: null, clearTimeout: null },
};
const SUMMARY_STAT_PRESETS = {
    basic: ['mo3', 'ao5', 'ao12', 'ao100'],
    extended: ['mo3', 'ao5', 'ao12', 'ao25', 'ao50', 'ao100'],
    full: ['mo3', 'ao5', 'ao12', 'ao25', 'ao50', 'ao100', 'ao200', 'ao500', 'ao1000', 'ao2000', 'ao5000', 'ao10000'],
};
const MAX_CUSTOM_SUMMARY_STATS = 12;
const SHIFT_STAT_SHORTCUT_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];
const SHIFT_STAT_SHORTCUT_DISPLAY = {
    Digit1: '1',
    Digit2: '2',
    Digit3: '3',
    Digit4: '4',
    Digit5: '5',
    Digit6: '6',
    Digit7: '7',
    Digit8: '8',
    Digit9: '9',
    Digit0: '0',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
};
const buttonShortcutTooltipBindings = [
    { selector: '#btn-settings', binding: ['/'], placement: 'right' },
    { selector: '#scramble-text', binding: ['C'] },
    { selector: '#btn-copy-scramble', binding: ['C'] },
    { selector: '#btn-prev-scramble', binding: [','] },
    { selector: '#btn-next-scramble', binding: ['.'] },
    { selector: '#btn-zen', binding: ['Z'] },
    { selector: 'button[data-action="last25"]', binding: ['Shift', 'Enter'] },
    { selector: 'button[data-action="reset"]', binding: ['Enter'] },
    { selector: 'button[data-action="zoom-x-in"]', binding: ['Shift', 'ArrowLeft'] },
    { selector: 'button[data-action="zoom-x-out"]', binding: ['Shift', 'ArrowRight'] },
    { selector: 'button[data-action="pan-left"]', binding: ['ArrowLeft'] },
    { selector: 'button[data-action="pan-right"]', binding: ['ArrowRight'] },
    { selector: 'button[data-action="zoom-y-in"]', binding: ['Shift', 'ArrowUp'] },
    { selector: 'button[data-action="zoom-y-out"]', binding: ['Shift', 'ArrowDown'] },
    { selector: 'button[data-action="pan-up"]', binding: ['ArrowUp'] },
    { selector: 'button[data-action="pan-down"]', binding: ['ArrowDown'] },
    { selector: '#modal-btn-dnf', binding: ['-'] },
    { selector: '#modal-btn-plus2', binding: ['+'] },
    { selector: '#modal-btn-delete', binding: ['Backspace'] },
];
const keyboardShortcutGroups = [
    {
        title: 'Settings',
        items: [
            {
                action: 'Open keyboard shortcuts',
                bindings: [['Ctrl', '/']],
            },
            {
                action: 'Open settings',
                bindings: [['/']],
            },
        ],
    },
    {
        title: 'Timer',
        items: [
            {
                action: 'Start timer',
                bindings: [['Space']],
            },
            {
                action: 'Stackmat-style start',
                // detail: 'Press both hands together',
                bindings: [['Left Ctrl', 'Right Ctrl']],
            },
            {
                action: 'Stop timer',
                bindings: [['Any key']],
            },
            {
                action: 'Stop timer and mark as DNF',
                // detail: 'While the timer is running',
                bindings: [['Esc'], ['Backspace']],
            },

        ],
    },
    {
        title: 'Solves',
        items: [
            {
                action: 'Comment on last solve',
                bindings: [['Tab']],
            },
            {
                action: 'Delete solve',
                detail: 'Deletes last solve or selected solve',
                bindings: [['Backspace']],
            },
            {
                action: 'Add or remove +2',
                // detail: 'Affects the last solve or selected solve',
                bindings: [['='], ['+']],
            },
            {
                action: 'Add or remove DNF',
                // detail: 'Affects the last solve or selected solve',
                bindings: [['-']],
            },
            {
                action: 'Open single details',
                bindings: [['Shift', '`']],
            },
            {
                action: 'Open configured summary stats',
                detail: 'Shift + 1..0, -, = (based on Summary rows setting)',
                bindings: [['Shift', '1'], ['Shift', '2'], ['Shift', '3'], ['Shift', '4'], ['Shift', '5'], ['Shift', '6'], ['Shift', '7'], ['Shift', '8'], ['Shift', '9'], ['Shift', '0'], ['Shift', '-'], ['Shift', '=']],
            },
        ],
    },
    {
        title: 'Scramble and layout',
        items: [
            {
                action: 'Toggle zen mode',
                bindings: [['Z']],
            },
    {
                action: 'Toggle delta display',
                bindings: [['D']],
            },
            {
                action: 'Copy current scramble',
                bindings: [['C']],
            },
            {
                action: 'Previous scramble',
                bindings: [[',']],
            },
            {
                action: 'Next scramble',
                bindings: [['.']],
            },
            {
                action: 'Toggle scramble preview',
                bindings: [['S']],
            },
            {
                action: 'Toggle graph panel',
                bindings: [['T']],
            },
        ],
    },
    {
        title: 'Graph',
        items: [
            {
                action: 'Pan graph',
                bindings: [['Arrow keys']],
            },
            {
                action: 'Zoom graph',
                bindings: [['Shift', 'Arrow keys']],
            },
            {
                action: 'Reset graph view',
                bindings: [['Enter']],
            },
            {
                action: 'Show last 25 solves',
                bindings: [['Shift', 'Enter']],
            },
        ],
    },
];
const blockingOverlayIds = ['modal-overlay', 'scramble-preview-overlay', 'confirm-overlay', 'prompt-overlay', 'shortcuts-overlay'];
let settingsOverlayEl = null;
let shortcutsOverlayEl = null;
let scramblePreviewOverlayEl = null;
let scramblePreviewModalCanvas = null;
let syncSettingsRowSeparators = () => {};
let shortcutTooltipEl = null;
let viewportLayoutFrame = null;
let instantTimerTabLayoutCleanupFrame = null;
let summaryRowsCache = { signature: '', rows: [] };
const rollingStatSummaryCache = new Map();
const domCache = new Map();
const customSelectControllers = new Map();
const viewportLayoutState = {
    timerTransform: null,
    scrambleTransform: null,
};
const quickActionsState = {
    visible: false,
    pinned: false,
    swipeVisibilityOverride: false,
    manualEntryActive: false,
    manualEntryHistoryManaged: false,
    manualDigits: '',
    restoreVisibleAfterManual: false,
    restorePinnedAfterManual: false,
    swipePointerId: null,
    swipeStartTimerState: null,
    swipeStartTime: 0,
    swipeStartX: 0,
    swipeStartY: 0,
    swipeHandled: false,
};
const mobilePanelIds = new Set(['timer', 'stats', 'trend']);
const mobileViewportQuery = window.matchMedia('(max-width: 1100px), (pointer: coarse)');
const shortMobileLandscapeQuery = window.matchMedia('(max-width: 1100px) and (orientation: landscape) and (max-height: 750px), (pointer: coarse) and (orientation: landscape) and (max-height: 750px)');
const mobileLandscapeQuery = window.matchMedia('(max-width: 1100px) and (orientation: landscape), (pointer: coarse) and (orientation: landscape)');
const touchPrimaryQuery = window.matchMedia('(hover: none) and (pointer: coarse)');
const inspectionSpeechUnlockState = {
    required: false,
    unlocked: false,
    inFlight: false,
    dismissed: false,
};
const cubeFaceColors = ['#FFF', '#F00', '#33CD32', '#FFFF05', '#FFA503', '#00F'];
const INITIAL_SUBSET_STARTUP_SCRAMBLE_DELAY_MS = 220;
const yellowTopPreviewFaceMap = Object.freeze({
    U: 'D',
    D: 'U',
    R: 'L',
    L: 'R',
    F: 'F',
    B: 'B',
});

// ──── History & Back Button ────

function pushHistoryState() {
    // Only push if we're not already in a pushed state to avoid nested pushes for simple overlays
    if (window.history.state?.isBackIntercepted) return;
    window.history.pushState({ isBackIntercepted: true }, '');
}

function backToDismiss() {
    if (window.history.state?.isBackIntercepted) {
        window.history.back();
    }
}

function handlePopState(event) {
    if (event.state?.isBackIntercepted) return;

    // Check overlays in order of priority (most specific/blocking first)
    if (document.getElementById('confirm-overlay').classList.contains('active')) {
        // Custom confirm usually needs explicit action, but we can treat back as cancel
        const cancelBtn = document.getElementById('confirm-btn-cancel');
        cancelBtn?.click();
        return;
    }

    if (document.getElementById('prompt-overlay').classList.contains('active')) {
        const cancelBtn = document.getElementById('prompt-btn-cancel');
        cancelBtn?.click();
        return;
    }

    if (isShortcutsOverlayOpen()) {
        closeKeyboardShortcutsOverlay({ isPopState: true });
        return;
    }

    if (settingsOverlayEl?.classList.contains('active')) {
        closeSettingsPanel({ isPopState: true });
        return;
    }

    if (scramblePreviewOverlayEl?.classList.contains('active')) {
        closeScramblePreviewModal({ isPopState: true });
        return;
    }

    if (document.getElementById('modal-overlay').classList.contains('active')) {
        closeModal({ isPopState: true });
        return;
    }

    if (isManualTimeEntryActive() && !isDesktopTypingEntryModeEnabled()) {
        closeManualTimeEntry({
            restoreQuickActions: isMobileTimerPanelActive(),
            pinned: quickActionsState.restorePinnedAfterManual,
            isPopState: true,
        });
        return;
    }

    // Special case: Timer running
    if (timer.getState() === 'running') {
        // Stop timer without penalty (no DNF)
        timer.stop();
        return;
    }

    // Special case: Timer primed/holding/ready
    const state = timer.getState();
    if (state === 'holding' || state === 'ready' || isInspectionState(state)) {
        timer.cancelPendingStart();
    }
}

window.addEventListener('popstate', handlePopState);

function isTouchPrimaryInput() {
    return touchPrimaryQuery.matches;
}

function isLikelyIOSDevice() {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isSafariBrowser() {
    const ua = navigator.userAgent || '';
    const isSafari = /Safari\//.test(ua) && /Version\//.test(ua);
    const isOtherBrowserOnWebKit = /CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Chromium|Firefox|Edg|OPR/.test(ua);
    return isSafari && !isOtherBrowserOnWebKit;
}

function initInspectionSpeechUnlockState() {
    const speechSupported = 'speechSynthesis' in window;
    const requiresUnlock = speechSupported && isLikelyIOSDevice();
    inspectionSpeechUnlockState.required = requiresUnlock;
    inspectionSpeechUnlockState.unlocked = !requiresUnlock;
    inspectionSpeechUnlockState.inFlight = false;
    inspectionSpeechUnlockState.dismissed = false;
}

function shouldShowInspectionSpeechUnlockPrompt() {
    if (!inspectionSpeechUnlockState.required) return false;
    if (inspectionSpeechUnlockState.unlocked) return false;
    if (inspectionSpeechUnlockState.dismissed) return false;
    const timerState = timer.getState();
    if (timerState !== 'idle' && timerState !== 'stopped') return false;
    if (settings.get('inspectionTime') !== '15s') return false;

    const alertMode = settings.get('inspectionAlerts');
    return alertMode === 'voice' || alertMode === 'both';
}

function syncInspectionSpeechUnlockPromptVisibility() {
    const promptWrap = getEl('inspection-voice-unlock-wrap');
    if (!promptWrap) return;
    promptWrap.hidden = !shouldShowInspectionSpeechUnlockPrompt();
}

function syncInspectionCancelControl(state = timer.getState()) {
    const cancelWrap = getEl('inspection-cancel-wrap');
    if (!cancelWrap) return;

    const shouldShow = mobileViewportQuery.matches
        && document.body.dataset.mobilePanel === 'timer'
        && isInspectionState(state);

    cancelWrap.hidden = !shouldShow;
}

function initInspectionCancelControl() {
    const cancelBtn = getEl('inspection-cancel-btn');
    if (!cancelBtn) return;

    cancelBtn.addEventListener('click', (event) => {
        event.preventDefault();
        timer.cancelInspection();
    });

    syncInspectionCancelControl();
}

function initInspectionSpeechUnlockPrompt() {
    const promptBtn = getEl('inspection-voice-unlock-btn');
    if (!promptBtn) return;

    syncInspectionSpeechUnlockPromptVisibility();

    promptBtn.onclick = async () => {
        inspectionSpeechUnlockState.dismissed = true;
        syncInspectionSpeechUnlockPromptVisibility();
        await unlockInspectionSpeechFromGesture();
    };
}

function unlockInspectionSpeechFromGesture() {
    if (!('speechSynthesis' in window)) return Promise.resolve(false);
    if (!inspectionSpeechUnlockState.required) {
        inspectionSpeechUnlockState.unlocked = true;
        return Promise.resolve(true);
    }
    if (inspectionSpeechUnlockState.unlocked) return Promise.resolve(true);
    if (inspectionSpeechUnlockState.inFlight) return Promise.resolve(false);

    inspectionSpeechUnlockState.inFlight = true;

    return new Promise((resolve) => {
        let settled = false;

        const finish = (ok) => {
            if (settled) return;
            settled = true;
            inspectionSpeechUnlockState.inFlight = false;
            if (ok) inspectionSpeechUnlockState.unlocked = true;
            resolve(ok);
        };

        try {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance('Voice alerts enabled');
            utterance.volume = 0;
            utterance.rate = 1;
            utterance.onstart = () => finish(true);
            utterance.onend = () => finish(true);
            utterance.onerror = () => finish(false);
            window.speechSynthesis.speak(utterance);

            setTimeout(() => {
                finish(inspectionSpeechUnlockState.unlocked);
            }, 900);
        } catch (error) {
            finish(false);
        }
    });
}

function areShortcutTooltipsAvailable() {
    return !mobileViewportQuery.matches;
}

function getEl(id) {
    if (!domCache.has(id)) {
        domCache.set(id, document.getElementById(id));
    }
    return domCache.get(id);
}

function isMobileTimerPanelActive() {
    return mobileViewportQuery.matches && document.body.dataset.mobilePanel === 'timer';
}

function isQuickActionsSwipeOpenState(state) {
    return state === 'idle'
        || state === 'stopped';
}

function isDesktopTypingEntryModeEnabled() {
    return settings.get('timeEntryMode') === 'typing' && !mobileViewportQuery.matches;
}

function isManualTimeEntryActive() {
    return quickActionsState.manualEntryActive;
}

function isManualTimeInputFocused() {
    const hiddenInput = getEl('manual-time-hidden-input');
    return Boolean(hiddenInput) && document.activeElement === hiddenInput;
}

function syncManualTimeInputFocusState() {
    document.body.classList.toggle('manual-time-input-focused', isManualTimeInputFocused());
}

function sanitizeManualDigits(value) {
    return String(value ?? '').replace(/\D/g, '').slice(0, 7);
}

function getManualTimeParts(digits) {
    const sanitized = sanitizeManualDigits(digits);
    const integerSource = sanitized.slice(0, -2);
    const fractionSource = sanitized.slice(-2);

    return {
        sanitized,
        integerText: integerSource || '0',
        fractionText: fractionSource.padStart(2, '0') || '00',
        integerTypedCount: integerSource.length,
        fractionTypedCount: fractionSource.length,
    };
}

function formatManualTimeDigits(digits) {
    const { integerText, fractionText } = getManualTimeParts(digits);
    return `${integerText}.${fractionText}`;
}

function renderManualTimeMarkup(digits) {
    const {
        integerText,
        fractionText,
        integerTypedCount,
        fractionTypedCount,
    } = getManualTimeParts(digits);

    const integerTypedStart = Math.max(0, integerText.length - integerTypedCount);
    const fractionTypedStart = Math.max(0, fractionText.length - fractionTypedCount);

    const integerMarkup = Array.from(integerText, (char, index) => (
        `<span class="manual-time-char${index >= integerTypedStart ? ' is-typed' : ''}">${char}</span>`
    )).join('');

    const dotIsTyped = integerTypedCount > 0 && fractionTypedCount > 0;
    const dotMarkup = `<span class="manual-time-char${dotIsTyped ? ' is-typed' : ''}">.</span>`;

    const fractionMarkup = Array.from(fractionText, (char, index) => (
        `<span class="manual-time-char${index >= fractionTypedStart ? ' is-typed' : ''}">${char}</span>`
    )).join('');

    return `${integerMarkup}${dotMarkup}${fractionMarkup}`;
}

function getLastSessionSolve() {
    const session = sessionManager.getActiveSession();
    if (!session || session.solves.length === 0) return null;
    return session.solves[session.solves.length - 1];
}

function promptForSolveComment(solve, title = 'Comment on last solve') {
    if (!solve) return Promise.resolve();

    return customPrompt('', solve.comment || '', 1000, title, 'Type a comment and press Enter...').then(comment => {
        if (comment !== null && comment !== (solve.comment || '')) {
            sessionManager.setSolveComment(solve.id, comment);
        }
    });
}

function toggleLastSolvePenaltyFromMainTimerShortcut(penalty) {
    const session = sessionManager.getActiveSession();
    if (!session || session.solves.length === 0) return;

    const lastSolve = session.solves[session.solves.length - 1];
    const solveNumber = session.solves.length;

    const previousPenalty = lastSolve.penalty;
    const updatedSolve = sessionManager.togglePenalty(lastSolve.id, penalty);
    if (!updatedSolve) return;

    if (mobileViewportQuery.matches) return;

    if (updatedSolve.penalty === penalty) {
        showPenaltyShortcutAlert('applied', penalty, solveNumber);
        return;
    }

    if (previousPenalty === penalty && updatedSolve.penalty == null) {
        showPenaltyShortcutAlert('cleared', null, solveNumber);
    }
}

function ensurePanelExpanded(panelId) {
    const panel = getEl(panelId);
    const body = panel?.querySelector('.collapsible-body');
    const header = panel?.querySelector('.panel-header');
    if (!panel?.classList.contains('collapsed')) return;

    if (panel.id === 'graph-panel' && mobileViewportQuery.matches && body) {
        panel.classList.remove('collapsed');
        body.style.maxHeight = 'none';
        settings.set('graphCollapsed', false);
        return;
    }

    if (header) {
        header.click();
    }
}

function hideMobileScrambleActions() {
    getEl('scramble-container')?.classList.remove('scramble-actions-visible');
}

function getSessionSelects() {
    return Array.from(document.querySelectorAll('#session-select, #mobile-session-select'));
}

function getLayoutRect(el) {
    if (!el) return null;

    const width = el.offsetWidth;
    const height = el.offsetHeight;
    if (!width && !height) return el.getBoundingClientRect();

    let left = 0;
    let top = 0;
    let node = el;
    while (node) {
        left += node.offsetLeft || 0;
        top += node.offsetTop || 0;
        node = node.offsetParent;
    }

    left -= window.scrollX;
    top -= window.scrollY;

    return {
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
    };
}

function combineLayoutRects(...rects) {
    const validRects = rects.filter(Boolean);
    if (!validRects.length) return null;

    const left = Math.min(...validRects.map((rect) => rect.left));
    const top = Math.min(...validRects.map((rect) => rect.top));
    const right = Math.max(...validRects.map((rect) => rect.right));
    const bottom = Math.max(...validRects.map((rect) => rect.bottom));

    return {
        left,
        top,
        width: right - left,
        height: bottom - top,
        right,
        bottom,
    };
}

function updateManualTimeEntryUI() {
    const hiddenInput = getEl('manual-time-hidden-input');
    const formattedEl = getEl('manual-time-formatted');
    const submitBtn = getEl('manual-time-submit');
    const hasValue = Number(quickActionsState.manualDigits || 0) > 0;

    if (hiddenInput) hiddenInput.value = quickActionsState.manualDigits;
    if (formattedEl) formattedEl.innerHTML = renderManualTimeMarkup(quickActionsState.manualDigits);
    if (submitBtn) submitBtn.disabled = !hasValue;
}

function updateQuickActionButtons() {
    const lastSolve = getLastSessionSolve();
    const plus2Btn = getEl('timer-action-plus2');
    const dnfBtn = getEl('timer-action-dnf');
    const deleteBtn = getEl('timer-action-delete');
    const commentBtn = getEl('timer-action-comment');
    const addBtn = getEl('timer-action-add');

    if (plus2Btn) {
        plus2Btn.disabled = !lastSolve;
        plus2Btn.classList.toggle('is-active', lastSolve?.penalty === '+2');
    }

    if (dnfBtn) {
        dnfBtn.disabled = !lastSolve;
        dnfBtn.classList.toggle('is-active', lastSolve?.penalty === 'DNF');
    }

    if (deleteBtn) {
        deleteBtn.disabled = !lastSolve;
        deleteBtn.classList.remove('is-active');
    }

    if (commentBtn) {
        commentBtn.disabled = !lastSolve;
        commentBtn.classList.toggle('is-active', Boolean(lastSolve?.comment?.trim()));
    }

    if (addBtn) {
        addBtn.classList.toggle('is-active', quickActionsState.manualEntryActive);
    }
}

function syncQuickActionsUI() {
    const quickActionsEl = getEl('timer-quick-actions');
    if (!quickActionsEl) return;

    const shouldShow = quickActionsState.visible && isMobileTimerPanelActive() && !quickActionsState.manualEntryActive;
    quickActionsEl.hidden = false;
    quickActionsEl.classList.toggle('is-visible', shouldShow);
    quickActionsEl.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    document.body.classList.toggle('timer-quick-actions-visible', shouldShow);
    updateQuickActionButtons();
    scheduleViewportLayoutSync();
}

function setQuickActionsVisible(visible, { pinned = quickActionsState.pinned } = {}) {
    quickActionsState.visible = Boolean(visible);
    quickActionsState.pinned = quickActionsState.visible ? Boolean(pinned) : false;
    if (!quickActionsState.visible) quickActionsState.swipeVisibilityOverride = false;
    syncQuickActionsUI();
}

function syncManualTimeInputMode() {
    const hiddenInput = getEl('manual-time-hidden-input');
    if (!hiddenInput) return;
    hiddenInput.tabIndex = isDesktopTypingEntryModeEnabled() ? -1 : 0;
    syncManualTimeInputFocusState();
}

function focusManualTimeInput() {
    const hiddenInput = getEl('manual-time-hidden-input');
    if (!hiddenInput) return;
    hiddenInput.focus({ preventScroll: true });
    if (typeof hiddenInput.setSelectionRange === 'function') {
        const len = hiddenInput.value.length;
        hiddenInput.setSelectionRange(len, len);
    }
    syncManualTimeInputFocusState();
}

function blurManualTimeInput() {
    const hiddenInput = getEl('manual-time-hidden-input');
    if (!hiddenInput) return;
    if (document.activeElement === hiddenInput) hiddenInput.blur();
    syncManualTimeInputFocusState();
}

function openManualTimeEntry({ initialDigits = '', focusStrategy = 'deferred' } = {}) {
    if (timer.getState() !== 'idle' && timer.getState() !== 'stopped') return;

    const manualEntryEl = getEl('manual-time-entry');
    if (!manualEntryEl) return;

    const shouldManageHistory = !isDesktopTypingEntryModeEnabled();

    if (!quickActionsState.manualEntryActive && shouldManageHistory) {
        pushHistoryState();
    }

    if (!quickActionsState.manualEntryActive) {
        quickActionsState.restoreVisibleAfterManual = quickActionsState.visible;
        quickActionsState.restorePinnedAfterManual = quickActionsState.pinned;
    }

    quickActionsState.manualEntryActive = true;
    quickActionsState.manualEntryHistoryManaged = shouldManageHistory;
    quickActionsState.manualDigits = sanitizeManualDigits(initialDigits || quickActionsState.manualDigits);
    manualEntryEl.hidden = false;
    document.body.classList.add('manual-time-entry-active');
    syncManualTimeInputMode();
    updateManualTimeEntryUI();
    syncQuickActionsUI();
    syncManualTimeInputFocusState();

    if (focusStrategy === 'immediate') {
        focusManualTimeInput();
        return;
    }

    window.requestAnimationFrame(() => {
        if (!isManualTimeInputFocused()) focusManualTimeInput();
    });
}

function closeManualTimeEntry({ restoreQuickActions = quickActionsState.restoreVisibleAfterManual, pinned = quickActionsState.restorePinnedAfterManual, resetDigits = true, isPopState = false } = {}) {
    if (!isPopState && quickActionsState.manualEntryHistoryManaged) {
        backToDismiss();
    }

    const manualEntryEl = getEl('manual-time-entry');
    const hiddenInput = getEl('manual-time-hidden-input');

    quickActionsState.manualEntryActive = false;
    quickActionsState.manualEntryHistoryManaged = false;
    document.body.classList.remove('manual-time-entry-active');

    if (manualEntryEl) manualEntryEl.hidden = true;
    if (hiddenInput && document.activeElement === hiddenInput) hiddenInput.blur();

    if (resetDigits) quickActionsState.manualDigits = '';
    syncManualTimeInputMode();
    syncManualTimeInputFocusState();
    updateManualTimeEntryUI();

    if (restoreQuickActions && isMobileTimerPanelActive()) {
        setQuickActionsVisible(true, { pinned });
    } else {
        setQuickActionsVisible(false);
    }
}

function syncPersistentManualEntryMode() {
    syncManualTimeInputMode();

    if (isDesktopTypingEntryModeEnabled()) {
        openManualTimeEntry();
        return;
    }

    if (!mobileViewportQuery.matches && quickActionsState.manualEntryActive) {
        closeManualTimeEntry({ restoreQuickActions: false });
    }
}

async function commitSolve(elapsed, penalty = null, { isManual = false } = {}) {
    const previousStats = statsCache.getStats();
    _skipSolveAddedRefresh = true;
    const solve = sessionManager.addSolve(elapsed, currentScramble, isManual, penalty);
    _skipSolveAddedRefresh = false;
    statsCache.append(solve);
    const currentStats = statsCache.getStats();
    maybeShowNewBestAlert(previousStats, currentStats);
    refreshUI();
    await loadNewScramble();
}

async function submitManualTimeEntry({ closeEntry = false } = {}) {
    const digits = quickActionsState.manualDigits;
    if (Number(digits || 0) <= 0) return;

    if (isDesktopTypingEntryModeEnabled()) {
        const elapsed = Number(digits) * 10;
        quickActionsState.manualDigits = '';
        updateManualTimeEntryUI();
        await commitSolve(elapsed, null, { isManual: true });
        return;
    }

    if (closeEntry) {
        closeManualTimeEntry({
            restoreQuickActions: isMobileTimerPanelActive(),
            pinned: true,
        });
    } else {
        // Keep open and clear digits for rapid entry
        quickActionsState.manualDigits = '';
        updateManualTimeEntryUI();
    }

    await commitSolve(Number(digits) * 10, null, { isManual: true });

    if (isMobileTimerPanelActive() && closeEntry) {
        setQuickActionsVisible(true, { pinned: true });
    }
}

function applyCachedTransform(el, stateKey, transform) {
    const normalizedTransform = transform || '';
    if (!el || viewportLayoutState[stateKey] === normalizedTransform) return;
    el.style.transform = normalizedTransform;
    viewportLayoutState[stateKey] = normalizedTransform;
}

function scheduleViewportLayoutSync() {
    if (viewportLayoutFrame != null) return;
    viewportLayoutFrame = window.requestAnimationFrame(() => {
        viewportLayoutFrame = null;
        syncViewportLayout();
    });
}

function syncTimerTabLayoutWithoutAnimation() {
    if (instantTimerTabLayoutCleanupFrame != null) {
        window.cancelAnimationFrame(instantTimerTabLayoutCleanupFrame);
        instantTimerTabLayoutCleanupFrame = null;
    }

    document.body.classList.add('instant-mobile-timer-layout');
    syncViewportLayout();

    instantTimerTabLayoutCleanupFrame = window.requestAnimationFrame(() => {
        syncViewportLayout();
        document.body.classList.remove('instant-mobile-timer-layout');
        instantTimerTabLayoutCleanupFrame = null;
    });
}

function syncDesktopPanelScale() {
    const root = document.documentElement;
    if (!root) return;

    if (mobileViewportQuery.matches) {
        root.style.setProperty('--desktop-panel-scale', '1');
        return;
    }

    const minViewportHeight = 250;
    const maxViewportHeight = 850;
    const minScale = 0.25;
    const maxScale = 1;
    const viewportHeight = window.innerHeight;
    const ratio = (viewportHeight - minViewportHeight) / (maxViewportHeight - minViewportHeight);
    const clampedRatio = Math.min(1, Math.max(0, ratio));
    const scale = minScale + ((maxScale - minScale) * clampedRatio);

    root.style.setProperty('--desktop-panel-scale', scale.toFixed(4));
}

function syncLandscapeMobileScrambleSingleLineFit() {
    const scrambleText = getEl('scramble-text');
    const scrambleTextWrapper = getEl('scramble-text-wrapper');
    const appLayout = getEl('app-layout');
    if (!scrambleText || !scrambleTextWrapper) return;

    const shouldFit = mobileLandscapeQuery.matches
        && mobileViewportQuery.matches
        && scrambleText.style.display !== 'none';

    if (!shouldFit) {
        scrambleText.style.removeProperty('font-size');
        scrambleText.style.removeProperty('max-width');
        scrambleText.style.removeProperty('white-space');
        return;
    }

    let appLayoutContentWidth = 0;
    if (appLayout) {
        const appLayoutStyles = getComputedStyle(appLayout);
        const paddingLeft = parseFloat(appLayoutStyles.paddingLeft) || 0;
        const paddingRight = parseFloat(appLayoutStyles.paddingRight) || 0;
        appLayoutContentWidth = Math.max(0, appLayout.clientWidth - paddingLeft - paddingRight);
    }

    const widthBasis = appLayoutContentWidth > 0 ? appLayoutContentWidth : window.innerWidth;
    const designatedWidthPx = Math.floor(widthBasis * 0.86);
    const availableWidth = Math.max(0, Math.min(scrambleTextWrapper.clientWidth, designatedWidthPx, widthBasis));
    if (availableWidth <= 0) return;

    scrambleText.style.fontSize = '';
    scrambleText.style.maxWidth = `${availableWidth}px`;
    scrambleText.style.whiteSpace = 'nowrap';

    if (scrambleText.scrollWidth <= scrambleText.clientWidth + 0.5) return;

    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const minFontSizePx = rootFontSize * 0.72;
    let currentFontSizePx = parseFloat(getComputedStyle(scrambleText).fontSize) || rootFontSize;

    while (currentFontSizePx > minFontSizePx && scrambleText.scrollWidth > scrambleText.clientWidth + 0.5) {
        currentFontSizePx -= 0.25;
        scrambleText.style.fontSize = `${currentFontSizePx}px`;
    }

    if (scrambleText.scrollWidth > scrambleText.clientWidth + 0.5) {
        scrambleText.style.whiteSpace = 'normal';
    }
}

function syncViewportLayout() {
    syncDesktopPanelScale();
    syncLandscapeMobileScrambleSingleLineFit();

    const timerDisplayWrapper = getEl('timer-display-wrapper');
    const timerDisplay = getEl('timer-display');
    const scrambleContainer = getEl('scramble-container');
    const scrambleText = getEl('scramble-text');
    const scrambleTextWrapper = getEl('scramble-text-wrapper');
    const quickActions = getEl('timer-quick-actions');
    const rightPanel = getEl('right-panel');
    const zenButton = getEl('btn-zen');

    if (!timerDisplayWrapper) return;

    const state = timer.getState();
    const isZen = document.body.classList.contains('zen');
    const isSolving = document.body.classList.contains('solving');
    const isMobileTimerView = mobileViewportQuery.matches && document.body.dataset.mobilePanel === 'timer';
    const centerTimerEnabled = settings.get('centerTimer');
    const hideUIWhileSolving = settings.get('hideUIWhileSolving');
    const effectiveCenterTimer = mobileViewportQuery.matches ? centerTimerEnabled : (centerTimerEnabled && hideUIWhileSolving);
    const shouldApplyMobileTimerPositioning = isMobileTimerView && (centerTimerEnabled || isZen);
    const shouldFocusTimer = state === 'running' || state === 'ready' || isInspectionState(state);
    const shouldViewportCenterTimer = shouldFocusTimer && (effectiveCenterTimer || (isMobileTimerView && isZen));
    const shouldPositionIdleMobileTimer = shouldApplyMobileTimerPositioning && !shouldFocusTimer;
    const shouldPositionMobileScramble = isMobileTimerView
        && !isSolving
        && scrambleContainer
        && scrambleTextWrapper
        && zenButton;
    const shouldFreezeMobileManualEntryLayout = isMobileTimerView && quickActionsState.manualEntryActive;

    let targetTimerCenterY = null;
    let targetTimerCenterX = null;
    let targetTimerRect = null;
    let targetScrambleCenterY = null;

    if (shouldFreezeMobileManualEntryLayout) return;

    if (shouldViewportCenterTimer) {
        if (isMobileTimerView) targetTimerCenterX = window.innerWidth / 2;
        targetTimerCenterY = window.innerHeight / 2;
    } else if (isMobileTimerView && !shouldFocusTimer) {
        const rightRect = rightPanel?.getBoundingClientRect();
        const zenRect = zenButton?.getBoundingClientRect();
        const scrambleRect = getLayoutRect(scrambleText || scrambleTextWrapper);
        const timerRect = getLayoutRect(timerDisplay || timerDisplayWrapper);
        const quickActionsRect = quickActions && !quickActions.hidden
            ? getLayoutRect(quickActions)
            : null;
        const duetRect = combineLayoutRects(timerRect, quickActionsRect);
        const zenCenterY = zenRect ? zenRect.top + zenRect.height / 2 : 0;
        const freeBottom = rightRect?.top ?? window.innerHeight;
        const preservedScrambleCenterY = scrambleRect
            ? ((3 * zenCenterY) + (freeBottom - 12)) / 4
            : zenCenterY;
        if (isZen) {
            if (mobileLandscapeQuery.matches) {
                targetScrambleCenterY = preservedScrambleCenterY;
            }
            if (shouldPositionIdleMobileTimer) {
                targetTimerCenterX = window.innerWidth / 2;
                targetTimerCenterY = window.innerHeight / 2;
            }
        } else {
            targetScrambleCenterY = preservedScrambleCenterY;
            if (shouldPositionIdleMobileTimer) {
                const scrambleBottom = scrambleRect
                    ? preservedScrambleCenterY + (scrambleRect.height / 2)
                    : zenCenterY;
                targetTimerCenterY = (scrambleBottom + freeBottom) / 2;
                targetTimerRect = duetRect || timerRect;
            }
        }
    }

    if (targetTimerCenterY != null) {
        if (isMobileTimerView && shortMobileLandscapeQuery.matches && (state === 'idle' || state === 'stopped' || state === 'holding')) {
            targetTimerCenterY += 30;
        }
        const targetRect = targetTimerRect || getLayoutRect(timerDisplay || timerDisplayWrapper);
        const timerCenterX = targetRect.left + targetRect.width / 2;
        const timerCenterY = targetRect.top + targetRect.height / 2;
        const offsetX = targetTimerCenterX != null && targetRect.width < window.innerWidth - 24
            ? targetTimerCenterX - timerCenterX
            : 0;
        const offsetY = targetTimerCenterY - timerCenterY;
        applyCachedTransform(
            timerDisplayWrapper,
            'timerTransform',
            `translate(${Math.round(offsetX * 10) / 10}px, ${Math.round(offsetY * 10) / 10}px)`,
        );
    } else {
        applyCachedTransform(timerDisplayWrapper, 'timerTransform', '');
    }

    if (!shouldPositionMobileScramble || (targetScrambleCenterY == null && targetTimerCenterY == null)) {
        if (!isSolving) applyCachedTransform(scrambleContainer, 'scrambleTransform', '');
        return;
    }

    const zenRect = zenButton.getBoundingClientRect();
    const scrambleRect = getLayoutRect(scrambleTextWrapper);
    const resolvedScrambleCenterY = targetScrambleCenterY ?? (((zenRect.top + zenRect.height / 2) + targetTimerCenterY) / 2);
    const scrambleOffsetY = resolvedScrambleCenterY - (scrambleRect.top + scrambleRect.height / 2);
    applyCachedTransform(
        scrambleContainer,
        'scrambleTransform',
        `translateY(${Math.round(scrambleOffsetY * 10) / 10}px)`,
    );
}

function setActiveMobilePanel(panel) {
    if (!mobilePanelIds.has(panel)) return;
    const previousPanel = document.body.dataset.mobilePanel;

    if (panel !== 'timer' && quickActionsState.manualEntryActive) {
        closeManualTimeEntry({ restoreQuickActions: false });
    }

    document.body.dataset.mobilePanel = panel;
    document.querySelectorAll('.mobile-panel-tab').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mobilePanel === panel);
    });
    hideMobileScrambleActions();
    syncQuickActionsUI();
    syncInspectionCancelControl();

    if (mobileViewportQuery.matches) {
        if (panel === 'timer') ensurePanelExpanded('cube-panel');
        if (panel === 'trend') ensurePanelExpanded('graph-panel');
    }

    if (mobileViewportQuery.matches && panel === 'timer' && previousPanel && previousPanel !== 'timer') {
        syncTimerTabLayoutWithoutAnimation();
        return;
    }

    scheduleViewportLayoutSync();
}

function syncMobilePanelState() {
    const isMobileViewport = mobileViewportQuery.matches;
    hideShortcutTooltip();
    document.body.classList.toggle('mobile-viewport', isMobileViewport);
    syncManualTimeInputMode();

    if (!isMobileViewport) {
        if (quickActionsState.manualEntryActive) {
            closeManualTimeEntry({ restoreQuickActions: false });
        }
        delete document.body.dataset.mobilePanel;
        document.querySelectorAll('.mobile-panel-tab').forEach((btn) => btn.classList.remove('active'));
        hideMobileScrambleActions();
        syncQuickActionsUI();
        syncInspectionCancelControl();
        syncPersistentManualEntryMode();
        return;
    }

    const activePanel = mobilePanelIds.has(document.body.dataset.mobilePanel)
        ? document.body.dataset.mobilePanel
        : 'timer';
    setActiveMobilePanel(activePanel);
    syncInspectionCancelControl();

    if (isMobileViewport && settings.get('timeEntryMode') === 'typing' && quickActionsState.manualEntryActive) {
        closeManualTimeEntry({ restoreQuickActions: false });
    }
}

function isScramblePreviewModalOpen() {
    return Boolean(scramblePreviewOverlayEl?.classList.contains('active'));
}

function getScramblePreviewOrientation(type = getCurrentScrambleType()) {
    return type === '333' ? 'standard' : 'yellow-top';
}

function mapScrambleForPreview(scramble, type = getCurrentScrambleType()) {
    const normalizedScramble = String(scramble ?? '').trim().replace(/\s+/g, ' ');
    if (!normalizedScramble || type === '333') return normalizedScramble;

    return normalizedScramble
        .split(' ')
        .map((token) => {
            const mappedFace = yellowTopPreviewFaceMap[token[0]];
            if (!mappedFace) return token;
            return mappedFace + token.slice(1);
        })
        .join(' ');
}

function updateScramblePreviewButtonFace(scramble, type = getCurrentScrambleType()) {
    const icon = getEl('btn-scramble-preview')?.querySelector('.scramble-preview-face-icon');
    if (!icon) return;

    const stickers = icon.querySelectorAll('span');
    if (stickers.length !== 9) return;

    const previewScramble = mapScrambleForPreview(scramble, type);
    const cube = applyScramble(previewScramble, getScramblePreviewOrientation(type));
    const upFace = cube?.[0];
    if (!Array.isArray(upFace) || upFace.length !== 9) return;

    upFace.forEach((faceIndex, index) => {
        const color = cubeFaceColors[faceIndex] || '#FFF';
        stickers[index].style.backgroundColor = color;
    });
}

function renderScramblePreviewDisplays(scramble, type = getCurrentScrambleType()) {
    const normalizedScramble = String(scramble ?? '');
    const previewScramble = mapScrambleForPreview(normalizedScramble, type);
    const orientation = getScramblePreviewOrientation(type);
    const mainCanvas = getEl('cube-canvas');
    if (mainCanvas) updateCubeDisplay(mainCanvas, previewScramble, orientation);
    if (scramblePreviewModalCanvas) updateCubeDisplay(scramblePreviewModalCanvas, previewScramble, orientation);
    updateScramblePreviewButtonFace(normalizedScramble, type);
}

function openScramblePreviewModal() {
    if (!scramblePreviewOverlayEl || isScramblePreviewModalOpen()) return;
    pushHistoryState();
    scramblePreviewOverlayEl.classList.add('active');
    renderScramblePreviewDisplays(currentScramble);
}

function closeScramblePreviewModal({ isPopState = false } = {}) {
    if (!scramblePreviewOverlayEl || !isScramblePreviewModalOpen()) return;
    if (!isPopState) backToDismiss();
    scramblePreviewOverlayEl.classList.remove('active');
}

function initScramblePreviewModal() {
    scramblePreviewOverlayEl = getEl('scramble-preview-overlay');
    scramblePreviewModalCanvas = getEl('scramble-preview-modal-canvas');

    if (!scramblePreviewOverlayEl || !scramblePreviewModalCanvas) return;

    initCubeDisplay(scramblePreviewModalCanvas);

    const openBtn = getEl('btn-scramble-preview');
    const closeBtn = getEl('scramble-preview-close');

    openBtn?.addEventListener('click', () => {
        openScramblePreviewModal();
        openBtn.blur();
    });

    closeBtn?.addEventListener('click', () => {
        closeScramblePreviewModal();
    });

    scramblePreviewOverlayEl.addEventListener('click', (event) => {
        if (event.target === scramblePreviewOverlayEl) closeScramblePreviewModal();
    });

    document.addEventListener('keydown', (event) => {
        if (event.code !== 'Escape') return;
        if (!isScramblePreviewModalOpen()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        closeScramblePreviewModal();
    });
}

// ──── Bootstrap ────
async function init() {
    initInspectionSpeechUnlockState();
    const sessionInitPromise = sessionManager.init();
    initCubeDisplay(document.getElementById('cube-canvas'));
    initScramblePreviewModal();
    syncHiddenScrambleTypeSetting();
    syncScrambleTypeMenus();
    const shouldLoadInitialScramble = !syncInitialScrambleUI();
    await sessionInitPromise;
    initModal();
    setModalStatNavigator(openShortcutStatDetail);
    initShortcutTooltips();
    syncModalStatNavigation();
    timer.init(
        document.getElementById('timer-display'),
        [
            document.getElementById('timer-display'),
            document.getElementById('center-panel'),
            document.getElementById('scramble-bar'),
        ],
    );
    initGraph(document.getElementById('graph-canvas'));
    syncScrambleTypeMenus();

    // Wire events
    timer.on('stopped', onSolveComplete);
    timer.on('started', onTimerStarted);
    timer.on('stateChange', onTimerStateChange);
    timer.on('inspectionAlert', onInspectionAlert);

    sessionManager.on('solveAdded', () => { if (!_skipSolveAddedRefresh) refreshUI(); });
    sessionManager.on('solveUpdated', () => { rebuildStatsCache(); refreshUI(); });
    sessionManager.on('solveDeleted', () => { rebuildStatsCache(); refreshUI(); });
    sessionManager.on('sessionChanged', onSessionChanged);
    sessionManager.on('sessionDeleted', refreshSessionList);

    settings.on('change', (key) => {
        if (key === 'inspectionAlerts') clearInspectionAlert();
        if (key === 'inspectionAlerts' || key === 'inspectionTime') {
            syncInspectionSpeechUnlockPromptVisibility();
        }
        if (key === 'newBestPopupEnabled' && !settings.get('newBestPopupEnabled')) clearNewBestAlert();
        if (key === 'shortcutTooltipsEnabled' && !settings.get('shortcutTooltipsEnabled')) hideShortcutTooltip();
        if (key === 'showScrambleTypeButton' && !settings.get('showScrambleTypeButton')) {
            closeScrambleTypeMenus();
            void applyHiddenScrambleTypeSetting();
        }
        if (key === 'statsFilter' || key === 'customFilterDuration' || key === 'showDelta' || key.startsWith('graphColor') || key.startsWith('graphLine') || key === 'graphTooltipDateEnabled' || key === 'newBestColor' || key === 'summaryStatsList') {
            if (key === 'statsFilter' || key === 'customFilterDuration') rebuildStatsCache();
            if (key === 'summaryStatsList') {
                syncModalStatNavigation();
                renderKeyboardShortcuts();
            }
            if (key.startsWith('graphLine')) {
                syncGraphLineLabels();
            }
            refreshUI();
        }
        if (key === 'timeEntryMode') {
            clearPenaltyShortcutAlert();
            syncPersistentManualEntryMode();
        }
        if (key === 'centerTimer' || key === 'displayFont' || key === 'pillSize' || key === 'showScrambleTypeButton') scheduleViewportLayoutSync();
    });

    // Init UI
    initCustomSelectMenus();
    refreshSessionList();
    rebuildStatsCache();
    refreshUI();
    initSettingsPanel();
    initInspectionSpeechUnlockPrompt();
    initInspectionCancelControl();
    initShortcutsOverlay();
    initSessionControls();
    initFilterControls();
    initCollapsiblePanels();
    initZenMode();
    initScrambleControls();
    initTimerInfoControls();
    initTableSorting();
    initGraphLineToggles();
    initMobilePanels();
    initTimerQuickActions();
    syncPersistentManualEntryMode();
    initKeyboardShortcuts();
    initTimerClick();
    window.addEventListener('resize', scheduleViewportLayoutSync);
    window.addEventListener('orientationchange', scheduleViewportLayoutSync);
    scheduleViewportLayoutSync();

    if (shouldLoadInitialScramble) {
        const startInitialScrambleLoad = () => {
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    void loadNewScramble();
                });
            });
        };

        if (getSelectedScrambleType() === '333') {
            startInitialScrambleLoad();
        } else {
            window.setTimeout(startInitialScrambleLoad, INITIAL_SUBSET_STARTUP_SCRAMBLE_DELAY_MS);
        }
    }

    graphEvents.on('nodeClick', (payload) => {
        const interaction = typeof payload === 'number' ? { idx: payload } : payload;
        const idx = interaction?.idx;
        const solves = sessionManager.getFilteredSolves();
        const stats = statsCache.getStats();
        if (idx >= 0 && idx < solves.length) {
            if (interaction?.source === 'touch') {
                armModalGhostClickGuard({
                    x: interaction.clientX,
                    y: interaction.clientY,
                });
            }
            const isBest = getEffectiveTime(solves[idx]) === stats.best.time;
            showSolveDetail(solves[idx], idx, isBest);
        }
    });
}

function initMobilePanels() {
    document.querySelectorAll('.mobile-panel-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
            setActiveMobilePanel(btn.dataset.mobilePanel);
        });
    });

    document.querySelectorAll('#mobile-summary-card [data-mobile-summary-action]').forEach((cell) => {
        cell.addEventListener('click', () => {
            if (!mobileViewportQuery.matches) return;

            const action = cell.dataset.mobileSummaryAction;
            if (action === 'stats') {
                setActiveMobilePanel('stats');
                return;
            }

            const solves = sessionManager.getFilteredSolves();
            if (solves.length === 0) return;

            const stats = statsCache.getStats();
            openStatDetailAtIndex(action, solves, stats, solves.length - 1);
        });
    });

    const handleViewportChange = () => syncMobilePanelState();
    if (typeof mobileViewportQuery.addEventListener === 'function') {
        mobileViewportQuery.addEventListener('change', handleViewportChange);
    } else {
        mobileViewportQuery.addListener(handleViewportChange);
    }

    syncMobilePanelState();
}

// ──── Graph Line Toggles ────
function syncGraphLineLabels() {
    const lineDefs = getGraphLineDefinitions();
    lineDefs.forEach(({ id, statType }) => {
        const legendLabelEl = document.getElementById(`graph-legend-${id}-label`);
        if (legendLabelEl) legendLabelEl.textContent = statType;

        const toggleBtn = document.getElementById(`graph-line-toggle-${id}`);
        if (!toggleBtn) return;
        toggleBtn.dataset.mobileLabel = statType.toUpperCase();
        toggleBtn.title = `Toggle ${statType} line`;
    });
}

function initGraphLineToggles() {
    const vis = getLineVisibility();
    document.querySelectorAll('.graph-line-toggle').forEach(btn => {
        const line = btn.dataset.line;
        // Restore persisted state
        if (!vis[line]) btn.classList.remove('active');

        btn.addEventListener('click', () => {
            const isActive = btn.classList.toggle('active');
            setLineVisibility(line, isActive);
        });
    });

    syncGraphLineLabels();
}

// ──── Timer Info Click ────
function initTimerInfoControls() {
    const ao5Box = document.getElementById('info-ao5-box');
    const ao12Box = document.getElementById('info-ao12-box');

    ao5Box.addEventListener('click', () => {
        const solves = sessionManager.getFilteredSolves();
        if (solves.length === 0) return;
        const stats = statsCache.getStats();
        openStatDetailAtIndex('ao5', solves, stats, solves.length - 1);
    });

    ao12Box.addEventListener('click', () => {
        const solves = sessionManager.getFilteredSolves();
        if (solves.length === 0) return;
        const stats = statsCache.getStats();
        openStatDetailAtIndex('ao12', solves, stats, solves.length - 1);
    });
}

// ──── Timer Click ────
function initTimerClick() {
    const timerDisplay = document.getElementById('timer-display');
    if (!timerDisplay) return;

    timerDisplay.addEventListener('click', () => {
        if (mobileViewportQuery.matches) return;
        const state = timer.getState();
        // Open modal when timer is not actively solving.
        if (state === 'idle' || state === 'stopped') {
            const solves = sessionManager.getFilteredSolves();
            if (solves.length > 0) {
                // Open the most recent solve (at the end of the array)
                const idx = solves.length - 1;
                const stats = statsCache.getStats();
                const isBest = getEffectiveTime(solves[idx]) === stats.best.time;
                showSolveDetail(solves[idx], idx, isBest);
            }
        }
    });
}

function initTimerQuickActions() {
    const centerPanel = getEl('center-panel');
    const manualEntryEl = getEl('manual-time-entry');
    const hiddenInput = getEl('manual-time-hidden-input');
    const submitBtn = getEl('manual-time-submit');
    const plus2Btn = getEl('timer-action-plus2');
    const dnfBtn = getEl('timer-action-dnf');
    const deleteBtn = getEl('timer-action-delete');
    const commentBtn = getEl('timer-action-comment');
    const addBtn = getEl('timer-action-add');

    if (!centerPanel || !manualEntryEl || !hiddenInput) return;

    plus2Btn?.addEventListener('click', () => {
        const lastSolve = getLastSessionSolve();
        if (!lastSolve) return;
        sessionManager.togglePenalty(lastSolve.id, '+2');
        updateQuickActionButtons();
    });

    dnfBtn?.addEventListener('click', () => {
        const lastSolve = getLastSessionSolve();
        if (!lastSolve) return;
        sessionManager.togglePenalty(lastSolve.id, 'DNF');
        updateQuickActionButtons();
    });

    deleteBtn?.addEventListener('click', async () => {
        const lastSolve = getLastSessionSolve();
        if (!lastSolve) return;
        const confirmed = await customConfirm('Are you sure you want to delete the last solve?');
        if (!confirmed) return;
        sessionManager.deleteSolve(lastSolve.id);
        updateQuickActionButtons();
    });

    commentBtn?.addEventListener('click', () => {
        promptForSolveComment(getLastSessionSolve());
    });

    addBtn?.addEventListener('click', () => {
        openManualTimeEntry({ focusStrategy: 'immediate' });
    });

    manualEntryEl.addEventListener('click', (event) => {
        if (!quickActionsState.manualEntryActive) return;
        if (settingsOverlayEl?.classList.contains('active') || hasBlockingOverlayOpen()) return;
        if (event.target instanceof Element && event.target.closest('button')) return;
        focusManualTimeInput();
    });

    hiddenInput.addEventListener('focus', () => {
        syncManualTimeInputFocusState();
    });

    hiddenInput.addEventListener('blur', () => {
        syncManualTimeInputFocusState();
    });

    hiddenInput.addEventListener('input', (event) => {
        quickActionsState.manualDigits = sanitizeManualDigits(event.target.value);
        updateManualTimeEntryUI();
    });

    hiddenInput.addEventListener('keydown', (event) => {
        if (event.key === '.' || event.key === ',') {
            event.preventDefault();
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            submitManualTimeEntry({ closeEntry: false });
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            if (isDesktopTypingEntryModeEnabled()) {
                hiddenInput.blur();
                return;
            }
            closeManualTimeEntry({
                restoreQuickActions: isMobileTimerPanelActive(),
                pinned: quickActionsState.restorePinnedAfterManual,
            });
        }
    });

    submitBtn?.addEventListener('click', () => {
        submitManualTimeEntry({ closeEntry: true });
    });

    document.addEventListener('pointerdown', (event) => {
        if (!isDesktopTypingEntryModeEnabled()) return;
        if (!isManualTimeEntryActive() || !isManualTimeInputFocused()) return;
        if (!(event.target instanceof Node)) return;
        if (manualEntryEl.contains(event.target)) return;
        hiddenInput.blur();
    });

    const handleQuickActionsSwipeStart = (event) => {
        if (!isMobileTimerPanelActive()) return;
        if (hasBlockingOverlayOpen() || settingsOverlayEl?.classList.contains('active')) return;
        if (quickActionsState.manualEntryActive) return;
        if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
        if (event.target instanceof Element && event.target.closest('input[type="text"], input[type="search"], input[type="number"], input[type="email"], input[type="url"], input[type="tel"], textarea, [contenteditable="true"]')) return;
        if (!quickActionsState.visible && !settings.get('swipeDownGestureEnabled')) return;

        quickActionsState.swipeVisibilityOverride = false;

        const swipeStartTimerState = timer.getState();
        if (!quickActionsState.visible && !isQuickActionsSwipeOpenState(swipeStartTimerState)) return;

        quickActionsState.swipePointerId = event.pointerId;
        quickActionsState.swipeStartTimerState = swipeStartTimerState;
        quickActionsState.swipeStartTime = performance.now();
        quickActionsState.swipeStartX = event.clientX;
        quickActionsState.swipeStartY = event.clientY;
        quickActionsState.swipeHandled = false;
    };

    document.addEventListener('pointerdown', handleQuickActionsSwipeStart, { capture: true });

    document.addEventListener('pointermove', (event) => {
        if (!isMobileTimerPanelActive()) return;
        if (quickActionsState.swipePointerId !== event.pointerId) return;
        if (quickActionsState.swipeHandled) return;

        const deltaX = event.clientX - quickActionsState.swipeStartX;
        const deltaY = event.clientY - quickActionsState.swipeStartY;

        if (performance.now() - quickActionsState.swipeStartTime > 300) return;

        const canOpenQuickActions = isQuickActionsSwipeOpenState(quickActionsState.swipeStartTimerState);

        if (Math.abs(deltaY) < 18 || Math.abs(deltaY) < Math.abs(deltaX) + 6) return;

        if (deltaY > 0) {
            if (!canOpenQuickActions) return;
            quickActionsState.swipeHandled = true;
            quickActionsState.swipeVisibilityOverride = true;
            timer.cancelPendingStart();
            setQuickActionsVisible(true, { pinned: true });
            return;
        }

        if (deltaY < 0 && quickActionsState.visible) {
            quickActionsState.swipeHandled = true;
            timer.cancelPendingStart();
            setQuickActionsVisible(false);
        }
    }, { capture: true });

    const resetSwipeState = (event) => {
        if (event && quickActionsState.swipePointerId !== event.pointerId) return;
        quickActionsState.swipePointerId = null;
        quickActionsState.swipeStartTimerState = null;
        quickActionsState.swipeHandled = false;
    };

    document.addEventListener('pointerup', resetSwipeState, { capture: true });
    document.addEventListener('pointercancel', resetSwipeState, { capture: true });

    document.addEventListener('pointerdown', (event) => {
        if (!quickActionsState.manualEntryActive) return;
        if (isDesktopTypingEntryModeEnabled()) return;
        if (manualEntryEl.contains(event.target)) return;

        closeManualTimeEntry({
            restoreQuickActions: isMobileTimerPanelActive(),
            pinned: quickActionsState.restorePinnedAfterManual || quickActionsState.pinned,
        });
    });

    updateManualTimeEntryUI();
    syncQuickActionsUI();
}

// ──── Collapsible Panels ────
function initCollapsiblePanels() {
    document.querySelectorAll('.panel.collapsible').forEach(panel => {
        const header = panel.querySelector('.panel-header');
        const body = panel.querySelector('.collapsible-body');
        if (!body || !header) return;

        // Load persisted state
        let isCollapsed = false;
        if (panel.id === 'cube-panel') {
            isCollapsed = settings.get('cubeCollapsed');
        } else if (panel.id === 'graph-panel') {
            isCollapsed = settings.get('graphCollapsed');
        } else {
            isCollapsed = panel.classList.contains('collapsed');
        }

        if (panel.id === 'graph-panel' && mobileViewportQuery.matches) {
            isCollapsed = false;
        }

        if (isCollapsed) panel.classList.add('collapsed');
        else panel.classList.remove('collapsed');

        // Set initial state
        if (isCollapsed) {
            body.style.maxHeight = '0px';
        } else {
            body.style.maxHeight = 'none';
        }

        // After expand transition completes, remove max-height constraint
        body.addEventListener('transitionend', (e) => {
            if (e.propertyName === 'max-height' && !panel.classList.contains('collapsed')) {
                body.style.maxHeight = 'none';
            }
        });

        header.addEventListener('click', () => {
            if (panel.id === 'graph-panel' && mobileViewportQuery.matches) return;

            if (panel.classList.contains('collapsed')) {
                // EXPAND: 0 → scrollHeight → (transitionend) → none
                panel.classList.remove('collapsed');
                // Start from 0
                body.style.maxHeight = '0px';
                // Force reflow so browser sees the 0
                body.offsetHeight;
                // Now animate to full height
                body.style.maxHeight = body.scrollHeight + 'px';

                if (panel.id === 'cube-panel') settings.set('cubeCollapsed', false);
                if (panel.id === 'graph-panel') settings.set('graphCollapsed', false);
            } else {
                // COLLAPSE: none → scrollHeight → 0
                // First set to explicit value (can't transition from 'none')
                body.style.maxHeight = body.scrollHeight + 'px';
                // Force reflow
                body.offsetHeight;
                // Now collapse
                panel.classList.add('collapsed');
                body.style.maxHeight = '0px';

                if (panel.id === 'cube-panel') settings.set('cubeCollapsed', true);
                if (panel.id === 'graph-panel') {
                    settings.set('graphCollapsed', true);
                    const toggleBtn = document.getElementById('btn-graph-tools');
                    const drawer = document.getElementById('graph-tools-drawer');
                    if (toggleBtn && drawer && !drawer.classList.contains('collapsed')) {
                        toggleBtn.click();
                    }
                }
            }
        });
    });
}

// ──── Zen Mode ────
function syncZenButtonState() {
    const btn = getEl('btn-zen');
    if (!btn) return;

    const isZen = document.body.classList.contains('zen');
    btn.textContent = isZen ? '✕' : '✦';
    btn.title = isZen ? 'Exit zen mode' : 'Zen mode (hide panels)';
    btn.setAttribute('aria-label', btn.title);
    btn.classList.toggle('is-active', isZen);
}

function setZenMode(isZen) {
    const nextZen = Boolean(isZen);
    document.body.classList.toggle('zen', nextZen);
    settings.set('zenMode', nextZen);
    syncZenButtonState();
    scheduleViewportLayoutSync();
}

function toggleZenMode() {
    setZenMode(!document.body.classList.contains('zen'));
}

function initZenMode() {
    const btn = getEl('btn-zen');
    document.body.classList.toggle('zen', Boolean(settings.get('zenMode')));
    syncZenButtonState();
    scheduleViewportLayoutSync();

    btn?.addEventListener('click', () => {
        toggleZenMode();
        btn.blur();
    });
}

// ──── Scramble ────
function getScrambleTypeMeta(type = getSelectedScrambleType()) {
    return SCRAMBLE_TYPE_OPTIONS.find((option) => option.id === type) || SCRAMBLE_TYPE_OPTIONS[0];
}

function closeScrambleTypeMenus() {
    document.querySelectorAll('.scramble-type-menu').forEach((menuEl) => {
        menuEl.classList.remove('open');
        menuEl.querySelector('.scramble-type-btn')?.setAttribute('aria-expanded', 'false');
    });
}

function syncHiddenScrambleTypeSetting() {
    if (settings.get('showScrambleTypeButton')) return false;
    return setScrambleType('333');
}

async function applyHiddenScrambleTypeSetting() {
    if (settings.get('showScrambleTypeButton')) return false;

    const changed = syncHiddenScrambleTypeSetting();
    syncScrambleTypeMenus('333');

    if (!changed) {
        scheduleViewportLayoutSync();
        return false;
    }

    currentScramble = '';
    const scrambleTextEl = document.getElementById('scramble-text');
    if (scrambleTextEl) {
        scrambleTextEl.textContent = '';
        scrambleTextEl.classList.add('loading');
    }

    renderScramblePreviewDisplays('');
    const prevScrambleButton = document.getElementById('btn-prev-scramble');
    if (prevScrambleButton) prevScrambleButton.disabled = true;
    scheduleViewportLayoutSync();
    await loadNewScramble();
    return true;
}

function closeCustomSelectMenus() {
    document.querySelectorAll('.custom-select-menu').forEach((menuEl) => {
        menuEl.classList.remove('open');
        menuEl.querySelector('.custom-select-btn')?.setAttribute('aria-expanded', 'false');
    });
    syncCustomSelectOverflowState();
}

function syncCustomSelectMenu(selectId) {
    customSelectControllers.get(selectId)?.sync();
}

function syncCustomSelectOverflowState() {
    const hasOpenCustomSelect = Boolean(document.querySelector('.custom-select-menu.open'));
    getEl('left-panel')?.classList.toggle('custom-select-open', hasOpenCustomSelect);
    getEl('stats-panel')?.classList.toggle('custom-select-open', hasOpenCustomSelect);
}

function registerCustomSelectMenu({ selectId, menuId, buttonId, dropdownId, ariaLabel }) {
    const selectEl = getEl(selectId);
    const menuEl = getEl(menuId);
    const buttonEl = getEl(buttonId);
    const dropdownEl = getEl(dropdownId);
    const labelEl = buttonEl?.querySelector('.custom-select-label');

    if (!selectEl || !menuEl || !buttonEl || !dropdownEl || !labelEl) return;

    const sync = () => {
        const options = Array.from(selectEl.options);
        const selectedOption = options.find((option) => option.value === selectEl.value) || options[0] || null;

        labelEl.textContent = selectedOption?.textContent || '';
        buttonEl.title = selectedOption?.textContent || '';
        buttonEl.setAttribute('aria-label', selectedOption ? `${ariaLabel}: ${selectedOption.textContent}` : ariaLabel);
        buttonEl.disabled = options.length === 0;

        const fragment = document.createDocumentFragment();
        options.forEach((option) => {
            const optionButton = document.createElement('button');
            optionButton.type = 'button';
            optionButton.className = 'custom-select-option';
            optionButton.dataset.value = option.value;
            optionButton.setAttribute('role', 'option');

            const isActive = option.value === selectEl.value;
            optionButton.classList.toggle('active', isActive);
            optionButton.setAttribute('aria-selected', String(isActive));
            optionButton.textContent = option.textContent;
            fragment.appendChild(optionButton);
        });

        dropdownEl.replaceChildren(fragment);
    };

    buttonEl.addEventListener('click', (event) => {
        event.stopPropagation();
        const shouldOpen = !menuEl.classList.contains('open');
        closeScrambleTypeMenus();
        closeCustomSelectMenus();
        if (!shouldOpen || buttonEl.disabled) return;
        menuEl.classList.add('open');
        buttonEl.setAttribute('aria-expanded', 'true');
        syncCustomSelectOverflowState();
    });

    dropdownEl.addEventListener('click', (event) => {
        const optionButton = event.target instanceof Element
            ? event.target.closest('.custom-select-option')
            : null;
        if (!(optionButton instanceof HTMLButtonElement)) return;

        const nextValue = optionButton.dataset.value || '';
        closeCustomSelectMenus();

        if (selectEl.value !== nextValue) {
            selectEl.value = nextValue;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            sync();
        }

        buttonEl.blur();
    });

    selectEl.addEventListener('change', sync);
    customSelectControllers.set(selectId, { sync });
    sync();
}

function initCustomSelectMenus() {
    registerCustomSelectMenu({
        selectId: 'mobile-session-select',
        menuId: 'mobile-session-select-menu',
        buttonId: 'btn-mobile-session-select',
        dropdownId: 'mobile-session-select-dropdown',
        ariaLabel: 'Session',
    });

    registerCustomSelectMenu({
        selectId: 'session-select',
        menuId: 'session-select-menu',
        buttonId: 'btn-session-select',
        dropdownId: 'session-select-dropdown',
        ariaLabel: 'Session',
    });

    registerCustomSelectMenu({
        selectId: 'stats-filter-select',
        menuId: 'stats-filter-menu',
        buttonId: 'btn-stats-filter-select',
        dropdownId: 'stats-filter-dropdown',
        ariaLabel: 'Time filter',
    });

    document.addEventListener('pointerdown', (event) => {
        if (event.target instanceof Element && event.target.closest('.custom-select-menu')) return;
        closeCustomSelectMenus();
    }, true);

    document.addEventListener('keydown', (event) => {
        if (event.code !== 'Escape') return;
        closeCustomSelectMenus();
        closeScrambleTypeMenus();
    });
}

function syncScrambleTypeMenus(type = getSelectedScrambleType()) {
    const activeType = getScrambleTypeMeta(type).id;
    const activeMeta = getScrambleTypeMeta(activeType);

    document.querySelectorAll('.scramble-type-btn').forEach((buttonEl) => {
        buttonEl.textContent = activeMeta.buttonLabel;
        buttonEl.title = `Scramble type: ${activeMeta.menuLabel}`;
        buttonEl.setAttribute('aria-label', `Scramble type: ${activeMeta.menuLabel}`);
    });

    document.querySelectorAll('.scramble-type-option').forEach((optionEl) => {
        const isActive = optionEl.dataset.scrambleType === activeType;
        optionEl.classList.toggle('active', isActive);
        optionEl.setAttribute('aria-checked', String(isActive));
    });
}

async function loadNewScramble() {
    const el = document.getElementById('scramble-text');
    let loadingTimer = window.setTimeout(() => {
        el.textContent = 'Generating...';
        el.classList.add('loading');
    }, 120);

    try {
        currentScramble = await getScramble();
        updateScrambleUI(currentScramble);
    } catch (error) {
        console.error('Failed to load scramble:', error);
        el.textContent = 'Scrambler unavailable';
        el.classList.remove('loading');
    } finally {
        window.clearTimeout(loadingTimer);
    }
}

function syncInitialScrambleUI() {
    const initialScramble = getCurrentScramble();
    if (!initialScramble) return false;

    updateScrambleUI(initialScramble);
    return true;
}

function updateScrambleUI(scrambleStr) {
    const el = document.getElementById('scramble-text');
    currentScramble = scrambleStr;
    el.textContent = currentScramble;
    el.classList.remove('loading');
    el.classList.toggle('is-previous-selected', isViewingPreviousScramble());
    renderScramblePreviewDisplays(currentScramble);
    syncScrambleTypeMenus(getCurrentScrambleType());

    // Update nav button states
    document.getElementById('btn-prev-scramble').disabled = !hasPrevScramble();
    scheduleViewportLayoutSync();
}

function initScrambleControls() {
    const textEl = document.getElementById('scramble-text');
    const inputEl = document.getElementById('scramble-input');
    const copyBtn = document.getElementById('btn-copy-scramble');
    const editBtn = document.getElementById('btn-edit-scramble');
    const prevBtn = document.getElementById('btn-prev-scramble');
    const nextBtn = document.getElementById('btn-next-scramble');
    const containerEl = document.getElementById('scramble-container');
    const scrambleTypeMenus = Array.from(document.querySelectorAll('.scramble-type-menu'));

    function setScrambleActionsVisible(visible) {
        if (!mobileViewportQuery.matches) return;
        containerEl.classList.toggle('scramble-actions-visible', visible);
    }

    function copyCurrentScramble() {
        if (textEl.classList.contains('loading')) return;
        navigator.clipboard.writeText(currentScramble);
        const origColor = textEl.style.color;
        textEl.style.color = 'var(--stat-best)';
        setTimeout(() => textEl.style.color = origColor, 500);
    }

    async function handleScrambleTypeSelection(nextType) {
        if (textEl.classList.contains('loading')) return;
        const changed = setScrambleType(nextType);
        closeScrambleTypeMenus();
        syncScrambleTypeMenus();
        if (!changed) return;

        setScrambleActionsVisible(false);
        currentScramble = '';
        textEl.textContent = '';
        textEl.classList.add('loading');
        renderScramblePreviewDisplays('');
        prevBtn.disabled = true;
        scheduleViewportLayoutSync();
        await loadNewScramble();
    }

    // 1. Copy
    textEl.addEventListener('click', () => {
        if (textEl.classList.contains('loading')) return;
        closeScrambleTypeMenus();
        if (mobileViewportQuery.matches) {
            clearNewBestAlert();
            containerEl.classList.toggle('scramble-actions-visible');
        } else {
            copyCurrentScramble();
        }
    });

    copyBtn?.addEventListener('click', () => {
        closeScrambleTypeMenus();
        copyCurrentScramble();
        setScrambleActionsVisible(false);
    });

    scrambleTypeMenus.forEach((menuEl) => {
        const buttonEl = menuEl.querySelector('.scramble-type-btn');
        const optionEls = menuEl.querySelectorAll('.scramble-type-option');

        buttonEl?.addEventListener('click', (event) => {
            event.stopPropagation();
            if (textEl.classList.contains('loading')) return;
            const shouldOpen = !menuEl.classList.contains('open');
            closeScrambleTypeMenus();
            if (!shouldOpen) return;
            menuEl.classList.add('open');
            buttonEl.setAttribute('aria-expanded', 'true');
        });

        optionEls.forEach((optionEl) => {
            optionEl.addEventListener('click', async () => {
                await handleScrambleTypeSelection(optionEl.dataset.scrambleType || '333');
            });
        });
    });

    // 2. Edit
    function startEdit() {
        if (textEl.classList.contains('loading')) return;
        setScrambleActionsVisible(false);
        closeScrambleTypeMenus();
        textEl.style.display = 'none';
        inputEl.style.display = 'block';
        inputEl.value = currentScramble;
        inputEl.focus();
        // Pause timer keys optionally, but timer.js ignores input tags.
    }

    function commitEdit() {
        const val = inputEl.value.trim();
        textEl.style.display = 'block';
        inputEl.style.display = 'none';

        if (val && val !== currentScramble) {
            setCurrentScramble(val);
            updateScrambleUI(val);
        } else {
            // Restore visualizer if it was changed during input
            renderScramblePreviewDisplays(currentScramble);
        }
    }

    editBtn.addEventListener('click', startEdit);
    inputEl.addEventListener('blur', commitEdit);
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commitEdit();
        if (e.key === 'Escape') {
            textEl.style.display = 'block';
            inputEl.style.display = 'none';
            inputEl.blur();
        }
    });
    inputEl.addEventListener('input', (e) => {
        let val = e.target.value;

        // 1. Normalize all possible apostrophes/backticks to a single '
        val = val.replace(/[`´‘’′]/g, "'");

        // 2. Auto-capitalize available letters
        val = val.toUpperCase();

        // 3. Keep only allowed characters: R, L, U, D, B, F, 2, ', and Space
        // We include 'x','y','z' and 'M','E','S' if you want full cube notation, 
        // but user specifically asked for "RLUDBF, space, 2, and apostrophes".
        val = val.replace(/[^RLUDBF2' ]/g, '');

        // 4. Force a space if a letter is written before another letter or modifier
        // e.g. "RU" -> "R U", "R2U" -> "R2 U", "R'U" -> "R' U"
        val = val.replace(/([RLUDBF2'])([RLUDBF])/g, '$1 $2');

        // 5. Stricter modifiers: only allow ' or 2 directly after a letter
        // Remove standalone modifiers at start or after a space
        val = val.replace(/(^| )['2]+/g, '$1');
        // Remove repeated modifiers or invalid sequences like '2 or 2'
        // (Keeping it simple recursively: only the first modifier after a letter stays)
        val = val.replace(/([RLUDBF])(['2])(['2]+)/g, '$1$2');

        // 6. Disallow two spaces next to each other
        val = val.replace(/ +/g, ' ');

        // Update the input value and the cube display
        e.target.value = val;
        renderScramblePreviewDisplays(val);
    });

    // 3. Navigation
    prevBtn.addEventListener('click', () => {
        if (textEl.classList.contains('loading')) return;
        closeScrambleTypeMenus();
        const s = getPrevScramble();
        if (s) updateScrambleUI(s);
    });

    nextBtn.addEventListener('click', async () => {
        if (textEl.classList.contains('loading')) return;
        closeScrambleTypeMenus();
        let loadingTimer = window.setTimeout(() => {
            textEl.textContent = 'Generating...';
            textEl.classList.add('loading');
        }, 120);

        try {
            const s = await getNextScramble();
            updateScrambleUI(s);
        } catch (error) {
            console.error('Failed to load next scramble:', error);
            textEl.textContent = 'Scrambler unavailable';
            textEl.classList.remove('loading');
        } finally {
            window.clearTimeout(loadingTimer);
        }
    });

    document.addEventListener('pointerdown', (event) => {
        if (event.target instanceof Element && event.target.closest('.scramble-type-menu')) return;
        closeScrambleTypeMenus();
        if (!mobileViewportQuery.matches) return;
        if (containerEl.contains(event.target)) return;
        setScrambleActionsVisible(false);
    }, true);

    syncScrambleTypeMenus(getSelectedScrambleType());
}

// ──── Table Sorting ────
function initTableSorting() {
    const headers = document.querySelectorAll('#solves-table th[data-sort]');
    headers.forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;

            if (col === 'comments') {
                commentsOnlyFilterActive = !commentsOnlyFilterActive;
            } else {
                if (currentSortCol === col) {
                    if (currentSortDir === 'asc') {
                        currentSortDir = 'desc';
                    } else {
                        currentSortCol = null;
                        currentSortDir = null;
                    }
                } else {
                    currentSortCol = col;
                    currentSortDir = 'asc';
                }
            }
            refreshUI();
        });
    });
}

function hasBlockingOverlayOpen() {
    return blockingOverlayIds.some(id => document.getElementById(id)?.classList.contains('active'));
}

function isSlashShortcut(event) {
    return event.code === 'Slash' || event.key === '/' || event.key === '?';
}

function formatShortcutTooltip(binding) {
    const tokenMap = {
        Shift: '⇧',
        Backspace: '⌫',
        Delete: '⌫',
        Enter: '⏎',
        ArrowLeft: '←',
        ArrowRight: '→',
        ArrowUp: '↑',
        ArrowDown: '↓',
        Control: 'Ctrl',
        Ctrl: 'Ctrl',
        Meta: 'Ctrl',
        Alt: 'Ctrl',
        Option: 'Ctrl',
        Equal: '+',
        NumpadAdd: '+',
        Minus: '-',
        NumpadSubtract: '-',
    };

    return binding.map(token => tokenMap[token] || token).join('');
}

function positionShortcutTooltip(target) {
    if (!shortcutTooltipEl) return;

    const rect = target.getBoundingClientRect();
    const gap = 10;
    const margin = 8;
    const placement = target.dataset.shortcutTooltipPlacement || 'bottom';

    if (placement === 'right') {
        shortcutTooltipEl.style.left = `${rect.right + gap}px`;
        shortcutTooltipEl.style.top = `${rect.top + rect.height / 2}px`;

        const tooltipRect = shortcutTooltipEl.getBoundingClientRect();
        const minLeft = margin;
        const maxLeft = window.innerWidth - margin - tooltipRect.width;
        const preferredLeft = rect.right + gap;
        const centeredTop = rect.top + rect.height / 2;
        const minTop = margin + tooltipRect.height / 2;
        const maxTop = window.innerHeight - margin - tooltipRect.height / 2;
        const clampedLeft = Math.min(Math.max(preferredLeft, minLeft), maxLeft);
        const clampedTop = Math.min(Math.max(centeredTop, minTop), maxTop);

        shortcutTooltipEl.style.left = `${clampedLeft}px`;
        shortcutTooltipEl.style.top = `${clampedTop}px`;
        return;
    }

    shortcutTooltipEl.style.left = `${rect.left + rect.width / 2}px`;
    shortcutTooltipEl.style.top = `${rect.bottom + gap}px`;

    const tooltipRect = shortcutTooltipEl.getBoundingClientRect();
    const minLeft = margin + tooltipRect.width / 2;
    const maxLeft = window.innerWidth - margin - tooltipRect.width / 2;
    const centeredLeft = rect.left + rect.width / 2;
    const clampedLeft = Math.min(Math.max(centeredLeft, minLeft), maxLeft);
    const maxTop = window.innerHeight - margin - tooltipRect.height;
    const preferredTop = rect.bottom + gap;

    shortcutTooltipEl.style.left = `${clampedLeft}px`;
    shortcutTooltipEl.style.top = `${Math.min(preferredTop, maxTop)}px`;
}

function showShortcutTooltip(target) {
    if (!areShortcutTooltipsAvailable() || !settings.get('shortcutTooltipsEnabled')) return;
    if (!shortcutTooltipEl || !target?.dataset.shortcutTooltip) return;

    const wasActive = shortcutTooltipEl.classList.contains('active');
    shortcutTooltipEl.dataset.placement = target.dataset.shortcutTooltipPlacement || 'bottom';
    shortcutTooltipEl.textContent = target.dataset.shortcutTooltip;

    if (!wasActive) {
        shortcutTooltipEl.classList.add('no-transition');
        positionShortcutTooltip(target);
        shortcutTooltipEl.getBoundingClientRect();
        shortcutTooltipEl.classList.remove('no-transition');
    }

    shortcutTooltipEl.classList.add('active');
    positionShortcutTooltip(target);
}

function hideShortcutTooltip() {
    if (!shortcutTooltipEl) return;
    shortcutTooltipEl.classList.remove('active');
}

function registerShortcutTooltip(element, binding, placement = 'bottom') {
    if (!element) return;

    const shortcut = formatShortcutTooltip(binding);
    if (!shortcut) return;

    if (element.title && !element.getAttribute('aria-label')) {
        element.setAttribute('aria-label', element.title);
    }

    element.dataset.shortcutTooltip = shortcut;
    element.dataset.shortcutTooltipPlacement = placement;
    element.removeAttribute('title');
    element.addEventListener('mouseenter', () => showShortcutTooltip(element));
    element.addEventListener('mouseleave', hideShortcutTooltip);
    element.addEventListener('focus', () => showShortcutTooltip(element));
    element.addEventListener('blur', hideShortcutTooltip);
}

function initShortcutTooltips() {
    shortcutTooltipEl = document.getElementById('shortcut-tooltip');
    if (!shortcutTooltipEl) {
        shortcutTooltipEl = document.createElement('div');
        shortcutTooltipEl.id = 'shortcut-tooltip';
        shortcutTooltipEl.setAttribute('aria-hidden', 'true');
        document.body.appendChild(shortcutTooltipEl);
    }

    buttonShortcutTooltipBindings.forEach(({ selector, binding, placement }) => {
        document.querySelectorAll(selector).forEach(element => {
            registerShortcutTooltip(element, binding, placement);
        });
    });

    window.addEventListener('resize', hideShortcutTooltip);
    document.addEventListener('scroll', hideShortcutTooltip, true);
    document.addEventListener('pointerdown', hideShortcutTooltip, true);
}

function normalizeSummaryStatToken(token) {
    return String(token ?? '').trim().toLowerCase();
}

function parseGraphLineStatInput(rawInput) {
    const token = normalizeSummaryStatToken(rawInput);
    const parsed = parseGraphStatType(token);
    if (!parsed) {
        return {
            ok: false,
            token,
            message: token
                ? `Invalid stat: ${token}`
                : 'Enter a stat like mean, mo3, or ao12',
        };
    }

    return {
        ok: true,
        token: parsed.type,
        message: '',
    };
}

function parseSummaryStatInput(rawInput, { truncate = true } = {}) {
    const source = String(rawInput ?? '');
    const parts = source.split(/[\s,]+/).map(normalizeSummaryStatToken).filter(Boolean);
    const tokens = [];
    const seen = new Set();

    for (const part of parts) {
        const config = parseRollingStatType(part);
        if (!config) {
            return {
                ok: false,
                message: `Invalid token: ${part}`,
                tokens,
                truncated: false,
            };
        }

        if (seen.has(config.type)) continue;
        seen.add(config.type);
        tokens.push(config.type);
    }

    // if (tokens.length === 0) {
    //     return {
    //         ok: false,
    //         message: 'Enter at least one stat token (e.g. mo3 ao12)',
    //         tokens: [],
    //         truncated: false,
    //     };
    // }

    if (tokens.length > MAX_CUSTOM_SUMMARY_STATS && !truncate) {
        return {
            ok: false,
            message: `Maximum ${MAX_CUSTOM_SUMMARY_STATS} summary rows.`,
            tokens: tokens.slice(0, MAX_CUSTOM_SUMMARY_STATS),
            truncated: true,
        };
    }

    return {
        ok: true,
        message: '',
        tokens: truncate ? tokens.slice(0, MAX_CUSTOM_SUMMARY_STATS) : tokens,
        truncated: tokens.length > MAX_CUSTOM_SUMMARY_STATS,
    };
}

function getPresetSummaryTokens(preset) {
    const key = String(preset ?? '').toLowerCase();
    const list = SUMMARY_STAT_PRESETS[key] || SUMMARY_STAT_PRESETS.basic;
    return list.slice(0, MAX_CUSTOM_SUMMARY_STATS);
}

function getConfiguredSummaryStatTokens() {
    const stored = settings.get('summaryStatsList');
    if (Array.isArray(stored) && stored.length) {
        const parsed = parseSummaryStatInput(stored.join(' '));
        if (parsed.ok) return parsed.tokens;
    }

    const preset = settings.get('summaryStatsPreset');
    if (preset && preset !== 'custom') {
        return getPresetSummaryTokens(preset);
    }

    const custom = parseSummaryStatInput(settings.get('summaryStatsCustom'));
    if (custom.ok) return custom.tokens;

    return [...SUMMARY_STAT_PRESETS.basic];
}

function getShiftStatShortcutSlots() {
    return getConfiguredSummaryStatTokens()
        .slice(0, SHIFT_STAT_SHORTCUT_CODES.length)
        .map((statType, index) => {
            const code = SHIFT_STAT_SHORTCUT_CODES[index];
            return {
                statType,
                code,
                shortcutDisplay: SHIFT_STAT_SHORTCUT_DISPLAY[code] || '?',
            };
        });
}

function getStatWindowLabel(statType) {
    const parsed = parseRollingStatType(statType);
    return parsed ? String(parsed.windowSize) : statType;
}

function syncModalStatNavigation() {
    const slots = getShiftStatShortcutSlots();
    const timeButton = {
        statType: 'time',
        minIndex: 0,
        label: '1',
        title: 'Single (Shift+`)'
    };

    const statButtons = slots.map(({ statType, shortcutDisplay }) => {
        const parsed = parseRollingStatType(statType);
        return {
            statType,
            minIndex: parsed ? parsed.windowSize - 1 : 0,
            label: getStatWindowLabel(statType),
            title: `${statType} (Shift+${shortcutDisplay})`,
        };
    });

    setModalStatButtons([timeButton, ...statButtons]);

    document.querySelectorAll('#modal-stat-nav button[data-stat-type]').forEach((button) => {
        const type = button.dataset.statType;
        if (type === 'time') {
            registerShortcutTooltip(button, ['Shift', '`']);
            return;
        }

        const slot = slots.find((entry) => entry.statType === type);
        if (!slot) return;
        registerShortcutTooltip(button, ['Shift', slot.shortcutDisplay]);
    });
}

function getShiftStatShortcutType(event) {
    if (!event.shiftKey) return null;
    if (event.code === 'Backquote') return 'time';

    const slotIndex = SHIFT_STAT_SHORTCUT_CODES.indexOf(event.code);
    if (slotIndex < 0) return null;
    const slots = getShiftStatShortcutSlots();
    return slots[slotIndex]?.statType || null;
}

function canOpenSettingsPanel() {
    const state = timer.getState();
    return state === 'idle' || state === 'stopped';
}

function toggleDeltaDisplayShortcut() {
    const nextShowDelta = !settings.get('showDelta');
    settings.set('showDelta', nextShowDelta);

    const deltaToggle = document.getElementById('setting-show-delta');
    if (deltaToggle) deltaToggle.checked = nextShowDelta;
}

function isShortcutsOverlayOpen() {
    return shortcutsOverlayEl?.classList.contains('active');
}

function openSettingsPanel({ isSwitching = false } = {}) {
    if (!settingsOverlayEl) return false;
    if (!settingsOverlayEl.classList.contains('active') && !canOpenSettingsPanel()) return false;

    if (!isSwitching) pushHistoryState();
    settingsOverlayEl.classList.add('active');
    window.requestAnimationFrame(() => syncSettingsRowSeparators());
    blurManualTimeInput();
    return true;
}

function closeSettingsPanel({ isPopState = false, isSwitching = false } = {}) {
    if (!settingsOverlayEl) return;
    if (!isPopState && !isSwitching) backToDismiss();

    settingsOverlayEl.classList.remove('active');
    if (document.activeElement) document.activeElement.blur();
}

function openKeyboardShortcutsOverlay({ closeSettings = false, isSwitching = false } = {}) {
    if (!shortcutsOverlayEl) return false;
    if (!shortcutsOverlayEl.classList.contains('active') && !canOpenSettingsPanel()) return false;

    if (closeSettings) closeSettingsPanel({ isSwitching: true });
    if (!isSwitching) pushHistoryState();
    shortcutsOverlayEl.classList.add('active');
    blurManualTimeInput();
    return true;
}

function closeKeyboardShortcutsOverlay({ isPopState = false, isSwitching = false } = {}) {
    if (!shortcutsOverlayEl) return;
    if (!isPopState && !isSwitching) backToDismiss();

    shortcutsOverlayEl.classList.remove('active');
    if (document.activeElement) document.activeElement.blur();
}

function renderShortcutBinding(binding) {
    return `<span class="shortcut-binding">${binding.map(key => `<kbd>${key}</kbd>`).join('<span class="shortcut-plus">+</span>')}</span>`;
}

function getKeyboardShortcutGroups() {
    const dynamicStatItems = getShiftStatShortcutSlots().map(({ statType, shortcutDisplay }) => ({
        action: `Open ${statType} details`,
        bindings: [['Shift', shortcutDisplay]],
    }));

    return keyboardShortcutGroups.map((group) => {
        if (group.title !== 'Solves') return group;

        const preservedItems = group.items.filter((item) => item.action !== 'Open configured summary stats');
        return {
            ...group,
            items: [...preservedItems, ...dynamicStatItems],
        };
    });
}

function renderKeyboardShortcuts() {
    const container = document.getElementById('shortcut-groups');
    if (!container) return;

    const groups = getKeyboardShortcutGroups();

    container.innerHTML = groups.map(group => `
        <section class="shortcut-group">
            <div class="shortcut-group-title">${group.title}</div>
            ${group.items.map(item => `
                <div class="shortcut-row">
                    <div class="shortcut-label">
                        ${item.action}
                        ${item.detail ? `<small>${item.detail}</small>` : ''}
                    </div>
                    <div class="shortcut-bindings">
                        ${item.bindings.map(renderShortcutBinding).join('<span class="shortcut-binding-separator">or</span>')}
                    </div>
                </div>
            `).join('')}
        </section>
    `).join('');
}

// ──── Keyboard Shortcuts ────
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented) return;
        if (e.key !== 'Escape') return;
        if (!isDesktopTypingEntryModeEnabled() || isManualTimeInputFocused()) return;
        if (hasBlockingOverlayOpen() || settingsOverlayEl?.classList.contains('active')) return;
        if (timer.getState() !== 'idle' && timer.getState() !== 'stopped') return;
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

        e.preventDefault();
        if (!isManualTimeEntryActive()) {
            openManualTimeEntry({ focusStrategy: 'immediate' });
            return;
        }

        focusManualTimeInput();
    }, true);

    document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented) return;

        const slashShortcutPressed = isSlashShortcut(e);
        const isShortcutHelpKey = slashShortcutPressed && (e.ctrlKey || e.metaKey);
        if (isShortcutHelpKey) {
            e.preventDefault();

            if (isShortcutsOverlayOpen()) {
                closeKeyboardShortcutsOverlay();
                return;
            }

            if (document.getElementById('modal-overlay').classList.contains('active') ||
                document.getElementById('scramble-preview-overlay').classList.contains('active') ||
                document.getElementById('confirm-overlay').classList.contains('active') ||
                document.getElementById('prompt-overlay').classList.contains('active')) return;

            openKeyboardShortcutsOverlay({ closeSettings: settingsOverlayEl?.classList.contains('active'), isSwitching: settingsOverlayEl?.classList.contains('active') });

            e.stopPropagation();
            return;
        }

        // Ignore input fields, unless they are one of the explicit shortcut passthrough cases.
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            const isManualTimeInput = e.target.id === 'manual-time-hidden-input';
            const isModalTextarea = e.target.id === 'modal-textarea';
            const isShortcutKey = ['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract', 'Backspace', 'Delete'].includes(e.code);
            const isShiftStatShortcut = Boolean(getShiftStatShortcutType(e));
            const isSlashInSettings = slashShortcutPressed && settingsOverlayEl?.classList.contains('active');
            const isGraphShortcut = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.code);
            const isManualInputEditingKey = isManualTimeInput && (
                /^\d$/.test(e.key)
                || e.key === 'Backspace'
                || e.key === 'Delete'
                || e.key === 'Enter'
                || e.key === 'Escape'
                || e.key === '.'
                || e.key === ','
            );
            const isManualInputPassthrough = isManualTimeInput && (
                (isDesktopTypingEntryModeEnabled() && !isManualInputEditingKey)
                || e.ctrlKey
                || e.metaKey
                || e.altKey
                || isGraphShortcut
            );

            if (!(isModalTextarea && (isShortcutKey || isShiftStatShortcut))
                && !isSlashInSettings
                && !isManualInputPassthrough) {
                return;
            }
        }

        if (slashShortcutPressed) {
            if (isShortcutsOverlayOpen()) {
                e.preventDefault();
                closeKeyboardShortcutsOverlay({ isSwitching: true });
                openSettingsPanel({ isSwitching: true });
                return;
            }

            if (hasBlockingOverlayOpen()) return;

            e.preventDefault();
            if (settingsOverlayEl?.classList.contains('active')) {
                closeSettingsPanel();
                return;
            }

            openSettingsPanel();
            return;
        }

        // Ignore if confirm or settings modal is active
        if (document.getElementById('confirm-overlay').classList.contains('active') ||
            settingsOverlayEl?.classList.contains('active') ||
            isShortcutsOverlayOpen()) return;

        // Ignore if Ctrl or Cmd is pressed (e.g. browser zoom Ctrl+/-)
        if (e.ctrlKey || e.metaKey) return;

        const isSolveModalActive = document.getElementById('modal-overlay').classList.contains('active')
            || document.getElementById('scramble-preview-overlay').classList.contains('active');

        if (isManualTimeInputFocused() && (e.code === 'Period' || e.code === 'Comma')) return;

        // Ignore if timer is running or holding
        if (timer.getState() !== 'idle' && timer.getState() !== 'stopped') return;

        if (isDesktopTypingEntryModeEnabled() && !isSolveModalActive && !isManualTimeInputFocused()) {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (!isManualTimeEntryActive()) {
                    openManualTimeEntry({ focusStrategy: 'immediate' });
                    return;
                }

                focusManualTimeInput();
                return;
            }

            if (/^\d$/.test(e.key)) {
                e.preventDefault();
                if (!isManualTimeEntryActive()) {
                    openManualTimeEntry({ initialDigits: e.key, focusStrategy: 'immediate' });
                    return;
                }

                focusManualTimeInput();
                quickActionsState.manualDigits = sanitizeManualDigits(`${quickActionsState.manualDigits}${e.key}`);
                updateManualTimeEntryUI();
                return;
            }
        }

        const shortcutStatType = getShiftStatShortcutType(e);
        if (shortcutStatType) {
            e.preventDefault();
            openShortcutStatDetail(shortcutStatType);
            return;
        }

        switch (e.code) {
            case 'Tab':
                e.preventDefault();
                if (isSolveModalActive || document.getElementById('settings-overlay').classList.contains('active')) return;

                const lastSolve = getMostRecentSummarySolve();
                if (!lastSolve) break;

                promptForSolveComment(lastSolve);
                break;
            case 'KeyC':
                document.getElementById('scramble-text').click();
                break;
            case 'Backspace':
            case 'Delete':
                if (isSolveModalActive) {
                    const btn = document.getElementById('modal-btn-delete');
                    if (btn && btn.offsetParent !== null) btn.click();
                } else {
                    const session = sessionManager.getActiveSession();
                    if (session && session.solves.length > 0) {
                        const targetId = session.solves[session.solves.length - 1].id;
                        customConfirm('Are you sure you want to delete the last solve?').then(confirmed => {
                            if (confirmed) sessionManager.deleteSolve(targetId);
                        });
                    }
                }
                break;
            case 'KeyD':
                if (isSolveModalActive) return;
                e.preventDefault();
                toggleDeltaDisplayShortcut();
                break;
            case 'Equal':
            case 'NumpadAdd':
                if (isSolveModalActive) {
                    const btn = document.getElementById('modal-btn-plus2');
                    if (btn && btn.offsetParent !== null) btn.click();
                } else {
                    toggleLastSolvePenaltyFromMainTimerShortcut('+2');
                }
                break;
            case 'Minus':
            case 'NumpadSubtract':
                if (isSolveModalActive) {
                    const btn = document.getElementById('modal-btn-dnf');
                    if (btn && btn.offsetParent !== null) btn.click();
                } else {
                    toggleLastSolvePenaltyFromMainTimerShortcut('DNF');
                }
                break;
            case 'KeyZ':
                if (isSolveModalActive) return;
                if (mobileViewportQuery.matches && !isMobileTimerPanelActive()) return;
                toggleZenMode();
                break;
            case 'KeyT':
                if (isSolveModalActive) return;
                document.getElementById('graph-panel').querySelector('.panel-header').click();
                break;
            case 'KeyS':
                if (isSolveModalActive) return;
                document.getElementById('cube-panel').querySelector('.panel-header').click();
                break;
            case 'Period':
                if (isSolveModalActive) return;
                document.getElementById('btn-next-scramble').click();
                break;
            case 'Comma':
                if (isSolveModalActive) return;
                if (!document.getElementById('btn-prev-scramble').disabled) {
                    document.getElementById('btn-prev-scramble').click();
                }
                break;
            case 'ArrowLeft':
                if (isSolveModalActive) return;
                e.preventDefault();
                if (e.shiftKey) applyAction('zoom-x-in');
                else applyAction('pan-left');
                break;
            case 'ArrowRight':
                if (isSolveModalActive) return;
                e.preventDefault();
                if (e.shiftKey) applyAction('zoom-x-out');
                else applyAction('pan-right');
                break;
            case 'ArrowUp':
                if (isSolveModalActive) return;
                e.preventDefault();
                if (e.shiftKey) applyAction('zoom-y-in');
                else applyAction('pan-up');
                break;
            case 'ArrowDown':
                if (isSolveModalActive) return;
                e.preventDefault();
                if (e.shiftKey) applyAction('zoom-y-out');
                else applyAction('pan-down');
                break;
            case 'Enter':
                if (isSolveModalActive) return;
                e.preventDefault();
                if (e.shiftKey) applyAction('last25');
                else applyAction('reset');
                break;
        }
    });
}

// ──── Timer Events ────
async function onSolveComplete(elapsed, penalty = null) {
    backToDismiss();
    await commitSolve(elapsed, penalty, { isManual: isCurrentScrambleManual() });
}

function onTimerStarted() {
    pushHistoryState();
    // Info hidden via onTimerStateChange
}

function isInspectionState(state) {
    return state === 'inspection-primed'
        || state === 'inspecting'
        || state === 'inspection-holding'
        || state === 'inspection-ready';
}

function clearInspectionAlert() {
    clearPopup('inspection');
}

function clearNewBestAlert() {
    clearPopup('newBest');
}

function clearPenaltyShortcutAlert() {
    clearPopup('penaltyShortcut');
}

function clearPopup(kind) {
    const popup = popupState[kind];
    if (!popup) return;

    const alertEl = document.getElementById(popup.elementId);
    if (!alertEl) return;

    if (popup.hideTimeout) {
        clearTimeout(popup.hideTimeout);
        popup.hideTimeout = null;
    }

    if (popup.clearTimeout) {
        clearTimeout(popup.clearTimeout);
        popup.clearTimeout = null;
    }

    alertEl.classList.remove('visible');
    popup.clearTimeout = setTimeout(() => {
        if (!alertEl.classList.contains('visible')) {
            alertEl.textContent = '';
        }
        popup.clearTimeout = null;
    }, 220);
}

function showInspectionAlert(text) {
    showPopup('inspection', text);
}

function showNewBestAlert(text) {
    if (!settings.get('newBestPopupEnabled')) return;
    showPopup('newBest', text, 4500);
}

function showPenaltyShortcutAlert(state, penalty = null, solveNumber = null) {
    const alertEl = document.getElementById(popupState.penaltyShortcut.elementId);
    if (!alertEl) return;

    const isApplied = state === 'applied' && (penalty === '+2' || penalty === 'DNF');
    const isCleared = state === 'cleared';
    if (!isApplied && !isCleared) return;

    alertEl.classList.toggle('timer-popup-danger', isApplied);
    alertEl.classList.toggle('timer-popup-success', isCleared);
    clearNewBestAlert();

    showPopup(
        'penaltyShortcut',
        isCleared ? `#${solveNumber}: OK` : `#${solveNumber}: ${penalty} applied`,
        1700,
    );
}

function showPopup(kind, text, duration = 1500) {
    const popup = popupState[kind];
    if (!popup) return;

    const alertEl = document.getElementById(popup.elementId);
    if (!alertEl) return;

    if (popup.hideTimeout) {
        clearTimeout(popup.hideTimeout);
        popup.hideTimeout = null;
    }

    if (popup.clearTimeout) {
        clearTimeout(popup.clearTimeout);
        popup.clearTimeout = null;
    }

    alertEl.textContent = text;
    alertEl.classList.add('visible');
    popup.hideTimeout = setTimeout(() => {
        alertEl.classList.remove('visible');
        popup.clearTimeout = setTimeout(() => {
            if (!alertEl.classList.contains('visible')) {
                alertEl.textContent = '';
            }
            popup.clearTimeout = null;
        }, 220);
        popup.hideTimeout = null;
    }, duration);
}

function speakInspectionAlert(seconds) {
    if (!('speechSynthesis' in window)) return;
    if (inspectionSpeechUnlockState.required && !inspectionSpeechUnlockState.unlocked) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`${seconds} seconds`);
    utterance.rate = isSafariBrowser() ? 1.2 : 1.5;
    window.speechSynthesis.speak(utterance);
}

function onInspectionAlert(seconds) {
    const alertMode = settings.get('inspectionAlerts');
    if (alertMode === 'screen' || alertMode === 'both') {
        showInspectionAlert(`${seconds}s`);
    }
    if (alertMode === 'voice' || alertMode === 'both') {
        speakInspectionAlert(seconds);
    }
}

function onTimerStateChange(state) {
    syncInspectionSpeechUnlockPromptVisibility();
    syncInspectionCancelControl(state);

    const infoEl = document.getElementById('timer-info');
    const deltaEl = document.getElementById('timer-delta');
    const timerDisplayWrapper = document.getElementById('timer-display-wrapper');
    const shouldFocusTimer = state === 'running' || state === 'ready' || isInspectionState(state);

    if (mobileViewportQuery.matches && shouldFocusTimer) {
        setActiveMobilePanel('timer');
    }

    const isPreSolveState = state === 'holding' || state === 'ready' || isInspectionState(state);

    if (state !== 'idle' && state !== 'stopped') {
        if (quickActionsState.manualEntryActive) {
            closeManualTimeEntry({ restoreQuickActions: false });
        } else if (quickActionsState.visible) {
            const shouldKeepQuickActionsVisible = quickActionsState.swipeVisibilityOverride && isPreSolveState;
            if (!shouldKeepQuickActionsVisible) {
                setQuickActionsVisible(false);
            }
        }
    } else {
        quickActionsState.swipeVisibilityOverride = false;
    }

    // Toggle solving class for focus mode
    const hideUIWhileSolving = settings.get('hideUIWhileSolving');
    const actualShouldHideUI = mobileViewportQuery.matches ? shouldFocusTimer : (shouldFocusTimer && hideUIWhileSolving);
    document.body.classList.toggle('solving', actualShouldHideUI);

    if (timerDisplayWrapper) scheduleViewportLayoutSync();

    if (infoEl) {
        infoEl.style.visibility = '';
        infoEl.style.opacity = '';
    }

    if (state === 'inspection-primed' || !isInspectionState(state)) {
        clearInspectionAlert();
    }

    if (state !== 'idle' && state !== 'stopped') {
        clearNewBestAlert();
        clearPenaltyShortcutAlert();
    }

    // Hide delta when timer is ready, running, or in inspection
    if (deltaEl) {
        if (state === 'running' || state === 'ready' || isInspectionState(state)) {
            deltaEl.classList.remove('visible');
        } else if (state === 'idle' || state === 'stopped') {
            updateDelta(sessionManager.getFilteredSolves());
        }
    }


}

function didSetNewBest(previousBest, currentBest) {
    if (currentBest == null || currentBest === Infinity) return false;
    if (previousBest == null || previousBest === Infinity) return true;
    return currentBest < previousBest;
}

function maybeShowNewBestAlert(previousStats, currentStats) {
    const labels = [];

    if (didSetNewBest(previousStats.best.time, currentStats.best.time)) {
        labels.push('single');
    }

    const times = statsCache.getTimes();
    const lastIndex = times.length - 1;
    const configuredRows = getConfiguredSummaryStatTokens();

    configuredRows.forEach((statType) => {
        const config = getRollingStatConfig(statType);
        if (!config || lastIndex < config.windowSize - 1) return;

        const summary = getRollingStatSummary(times, statType);
        if (summary.value == null || summary.value === Infinity) return;
        if (summary.current == null || summary.current === Infinity) return;

        if (summary.index === lastIndex && summary.current === summary.value) {
            labels.push(statType);
        }
    });

    if (labels.length === 0) return;
    showNewBestAlert(`Best ${labels.join(', ')}`);
}

// ──── UI Refresh ────
/**
 * Rebuild the stats cache from scratch for the current filtered solves.
 * Called on session switch, filter change, import, delete, penalty toggle.
 */
function rebuildStatsCache() {
    const solves = sessionManager.getFilteredSolves();
    statsCache.rebuild(solves);
    summaryRowsCache = { signature: '', rows: [] };
    rollingStatSummaryCache.clear();
}

function refreshUI() {
    const solves = sessionManager.getFilteredSolves();
    const stats = statsCache.getStats();

    renderSummaryStats(stats, solves);
    renderSolvesTable(solves, stats);
    updateGraphData(solves, statsCache);
    updateTimerInfo(stats, solves);
    refreshSessionList();

    // Sync timer display with last solve if not running
    const state = timer.getState();
    if (state === 'idle' || state === 'stopped') {
        const lastSolve = solves[solves.length - 1];
        if (lastSolve) {
            timer.setDisplay(formatTimerDisplayTime(lastSolve));
        } else {
            timer.resetDisplay();
        }
    }

    // Update delta display
    updateDelta(solves);
    updateQuickActionButtons();
    scheduleViewportLayoutSync();
}

function updateTimerInfo(stats, solves) {
    const infoEl = document.getElementById('timer-info');

    infoEl.style.visibility = '';
    infoEl.style.opacity = '';

    const ao5El = document.getElementById('info-ao5');
    const ao12El = document.getElementById('info-ao12');
    ao5El.textContent = stats.current.ao5 != null ? formatTime(stats.current.ao5) : '-';
    ao12El.textContent = stats.current.ao12 != null ? formatTime(stats.current.ao12) : '-';

    const validTimes = solves.map(s => getEffectiveTime(s)).filter(t => t !== Infinity);
    const mean = validTimes.length > 0
        ? formatTime(validTimes.reduce((a, b) => a + b, 0) / validTimes.length)
        : '-';

    document.getElementById('mobile-summary-ao5').textContent = stats.current.ao5 != null ? formatTime(stats.current.ao5) : '-';
    document.getElementById('mobile-summary-ao12').textContent = stats.current.ao12 != null ? formatTime(stats.current.ao12) : '-';
    document.getElementById('mobile-summary-ao100').textContent = stats.current.ao100 != null ? formatTime(stats.current.ao100) : '-';
    document.getElementById('mobile-summary-mean').textContent = mean;

    document.querySelectorAll('#mobile-summary-card [data-mobile-summary-action]').forEach((cell) => {
        const action = cell.dataset.mobileSummaryAction;
        cell.disabled = action !== 'stats' && stats.current[action] == null;
    });
}

function updateDelta(solves) {
    const deltaEl = document.getElementById('timer-delta');
    if (!deltaEl) return;

    const state = timer.getState();
    const showDelta = settings.get('showDelta');
    const isTimerActive = state === 'running' || state === 'ready' || isInspectionState(state);

    // Clear if disabled, not enough solves, or timer is active
    if (!showDelta || solves.length < 2 || isTimerActive) {
        // However, if the current solve is a DNF, we still want to show (DNF) regardless of showDelta
        if (solves.length > 0 && solves[solves.length - 1].penalty === 'DNF' && !isTimerActive) {
            deltaEl.textContent = '(DNF)';
            deltaEl.classList.remove('delta-negative', 'delta-zero');
            deltaEl.classList.add('delta-positive', 'visible');
            return;
        }

        deltaEl.classList.remove('visible');
        return;
    }

    const current = solves[solves.length - 1];

    // If we have >= 2 solves and delta is enabled, we still first check if current is DNF
    if (current.penalty === 'DNF') {
        deltaEl.textContent = '(DNF)';
        deltaEl.classList.remove('delta-negative', 'delta-zero');
        deltaEl.classList.add('delta-positive', 'visible');
        return;
    }

    const previous = solves[solves.length - 2];
    const curTime = getEffectiveTime(current);
    const prevTime = getEffectiveTime(previous);

    // Hide if either is DNF
    if (curTime === Infinity || prevTime === Infinity) {
        deltaEl.classList.remove('visible');
        return;
    }

    const diff = curTime - prevTime;
    const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
    const formatted = formatTime(Math.abs(diff));
    deltaEl.textContent = `(${sign}${formatted})`;

    deltaEl.classList.remove('delta-negative', 'delta-positive', 'delta-zero');
    if (diff < 0) deltaEl.classList.add('delta-negative');
    else if (diff > 0) deltaEl.classList.add('delta-positive');
    else deltaEl.classList.add('delta-zero');

    deltaEl.classList.add('visible');
}

function getRollingStatConfig(type) {
    const parsed = parseRollingStatType(type);
    if (!parsed) return null;
    return {
        type: parsed.type,
        kind: parsed.kind,
        windowSize: parsed.windowSize,
        trim: parsed.trim,
        getValue: (times, index) => rollingStatAt(times, index, parsed.type),
    };
}

function getSelectedStatSolveIndex(solves) {
    const selection = getModalSelectionContext();
    if (!selection) return solves.length - 1;

    if (selection.endSolveId) {
        const solveIndex = solves.findIndex(solve => solve.id === selection.endSolveId);
        if (solveIndex >= 0) return solveIndex;
    }

    if (Number.isInteger(selection.endIndex) && selection.endIndex >= 0 && selection.endIndex < solves.length) {
        return selection.endIndex;
    }

    return solves.length - 1;
}

function openStatDetailAtIndex(type, solves, stats, index, options = {}) {
    if (index < 0 || index >= solves.length) return false;

    if (type === 'time') {
        const isBest = options.isBest ?? (stats.best.time != null && getEffectiveTime(solves[index]) === stats.best.time);
        showSolveDetail(solves[index], index, isBest);
        return true;
    }

    const config = getRollingStatConfig(type);
    if (!config || index < config.windowSize - 1) return false;

    const times = statsCache.getTimes();
    const value = config.getValue(times, index);
    if (value == null) return false;

    const window = solves.slice(index - config.windowSize + 1, index + 1);
    showAverageDetail(options.label || type, value, window, config.trim, {
        statType: type,
        endIndex: index,
        endSolveId: solves[index].id,
    });
    return true;
}

function openShortcutStatDetail(type) {
    const solves = sessionManager.getFilteredSolves();
    if (solves.length === 0) return false;

    const stats = statsCache.getStats();
    const index = getSelectedStatSolveIndex(solves);
    return openStatDetailAtIndex(type, solves, stats, index);
}

function getMostRecentSummarySolve() {
    const solves = sessionManager.getFilteredSolves();
    if (solves.length === 0) return null;
    return solves[solves.length - 1];
}

// ──── Summary Stats ────
class FenwickTree {
    constructor(size) {
        this.size = size;
        this.tree = new Float64Array(size + 1);
    }

    add(index, delta) {
        for (let i = index; i <= this.size; i += i & -i) {
            this.tree[i] += delta;
        }
    }
}

function sumOfSmallestK(countTree, sumTree, indexToValue, k, totalCount, totalSum) {
    if (k <= 0) return 0;
    if (k >= totalCount) return totalSum;

    let idx = 0;
    let bit = 1;
    while ((bit << 1) <= countTree.size) bit <<= 1;

    let countSoFar = 0;
    let sumSoFar = 0;

    while (bit > 0) {
        const next = idx + bit;
        if (next <= countTree.size && (countSoFar + countTree.tree[next]) < k) {
            idx = next;
            countSoFar += countTree.tree[next];
            sumSoFar += sumTree.tree[next];
        }
        bit >>= 1;
    }

    const targetIndex = idx + 1;
    const remaining = k - countSoFar;
    const pivotValue = indexToValue[targetIndex - 1] ?? 0;
    return sumSoFar + (remaining * pivotValue);
}

function computeBestMeanWindow(times, windowSize) {
    if (times.length < windowSize) return { value: null, index: -1 };

    let sum = 0;
    let dnfCount = 0;
    let bestVal = Infinity;
    let bestIdx = -1;

    for (let i = 0; i < times.length; i++) {
        const t = times[i];
        if (t === Infinity) dnfCount++; else sum += t;

        if (i >= windowSize) {
            const old = times[i - windowSize];
            if (old === Infinity) dnfCount--; else sum -= old;
        }

        if (i < windowSize - 1) continue;
        if (dnfCount > 0) continue;

        const value = sum / windowSize;
        if (value < bestVal) {
            bestVal = value;
            bestIdx = i;
        }
    }

    return bestIdx >= 0 ? { value: bestVal, index: bestIdx } : { value: null, index: -1 };
}

function computeBestAverageWindow(times, windowSize, trim) {
    if (times.length < windowSize) return { value: null, index: -1 };

    const finiteValues = times.filter(t => t !== Infinity);
    if (finiteValues.length === 0) return { value: null, index: -1 };

    const indexToValue = Array.from(new Set(finiteValues)).sort((a, b) => a - b);
    const valueToIndex = new Map(indexToValue.map((value, idx) => [value, idx + 1]));

    const countTree = new FenwickTree(indexToValue.length);
    const sumTree = new FenwickTree(indexToValue.length);

    let dnfCount = 0;
    let finiteCount = 0;
    let finiteSum = 0;
    let bestVal = Infinity;
    let bestIdx = -1;

    const addTime = (t) => {
        if (t === Infinity) {
            dnfCount++;
            return;
        }
        const index = valueToIndex.get(t);
        if (!index) return;
        countTree.add(index, 1);
        sumTree.add(index, t);
        finiteCount++;
        finiteSum += t;
    };

    const removeTime = (t) => {
        if (t === Infinity) {
            dnfCount--;
            return;
        }
        const index = valueToIndex.get(t);
        if (!index) return;
        countTree.add(index, -1);
        sumTree.add(index, -t);
        finiteCount--;
        finiteSum -= t;
    };

    for (let i = 0; i < times.length; i++) {
        addTime(times[i]);

        if (i >= windowSize) {
            removeTime(times[i - windowSize]);
        }

        if (i < windowSize - 1) continue;
        if (dnfCount > trim) continue;

        const lowTrim = trim;
        const highTrim = trim - dnfCount;
        const rightRank = finiteCount - highTrim;
        const leftRankMinusOne = lowTrim;
        if (rightRank <= leftRankMinusOne) continue;

        const rightSum = sumOfSmallestK(countTree, sumTree, indexToValue, rightRank, finiteCount, finiteSum);
        const leftSum = sumOfSmallestK(countTree, sumTree, indexToValue, leftRankMinusOne, finiteCount, finiteSum);
        const value = (rightSum - leftSum) / (windowSize - (trim * 2));

        if (value < bestVal) {
            bestVal = value;
            bestIdx = i;
        }
    }

    return bestIdx >= 0 ? { value: bestVal, index: bestIdx } : { value: null, index: -1 };
}

function getRollingStatSummary(times, statType) {
    const config = getRollingStatConfig(statType);
    if (!config) return { current: null, value: null, index: -1 };
    if (times.length < config.windowSize) return { current: null, value: null, index: -1 };

    const current = config.getValue(times, times.length - 1);
    const cached = rollingStatSummaryCache.get(statType);

    if (cached && cached.timesRef === times && cached.lengthComputed === times.length) {
        return { current, value: cached.best, index: cached.bestIndex };
    }

    if (cached && cached.timesRef === times && cached.lengthComputed === (times.length - 1)) {
        const nextBest = (current != null && current !== Infinity && (cached.best == null || current < cached.best))
            ? current
            : cached.best;
        const nextBestIndex = (current != null && current !== Infinity && (cached.best == null || current < cached.best))
            ? (times.length - 1)
            : cached.bestIndex;

        rollingStatSummaryCache.set(statType, {
            timesRef: times,
            lengthComputed: times.length,
            best: nextBest,
            bestIndex: nextBestIndex,
        });
        return { current, value: nextBest, index: nextBestIndex };
    }

    const full = config.kind === 'mo'
        ? computeBestMeanWindow(times, config.windowSize)
        : computeBestAverageWindow(times, config.windowSize, config.trim);

    rollingStatSummaryCache.set(statType, {
        timesRef: times,
        lengthComputed: times.length,
        best: full.value,
        bestIndex: full.index,
    });

    return { current, value: full.value, index: full.index };
}

function findBestRollingStat(times, statType) {
    const summary = getRollingStatSummary(times, statType);
    return { value: summary.value, index: summary.index };
}

function renderSummaryStats(stats, solves) {
    const summaryEl = document.getElementById('stats-summary');
    const tbody = document.getElementById('stats-summary-body');
    const times = statsCache.getTimes();
    const configuredRows = getConfiguredSummaryStatTokens();
    const cacheSignature = [
        solves.length,
        solves[solves.length - 1]?.id || '',
        stats.current.time ?? 'none',
        configuredRows.join(','),
    ].join('|');

    let rows;
    if (summaryRowsCache.signature === cacheSignature) {
        rows = summaryRowsCache.rows;
    } else {
        rows = [
            { label: 'time', current: stats.current.time, best: stats.best.time, type: 'time' },
        ];

        configuredRows.forEach((statType) => {
            const config = getRollingStatConfig(statType);
            if (!config) return;
            if (times.length < config.windowSize) return;

            const summary = getRollingStatSummary(times, statType);
            const current = summary.current;
            const best = summary.value;
            rows.push({ label: statType, current, best, type: statType });
        });

        summaryRowsCache = { signature: cacheSignature, rows };
    }

    summaryEl?.classList.toggle('compact-summary-rows', rows.length > 5);

    tbody.innerHTML = rows.map(r => {
        const currentStr = r.current != null ? formatTime(r.current) : '-';
        const bestStr = r.best != null ? formatTime(r.best) : '-';
        const isBest = r.current != null && r.best != null && r.current === r.best && r.current !== Infinity;
        return `<tr>
      <td>${r.label}</td>
      <td class="${isBest ? 'best-value' : ''}" data-stat-type="${r.type}" data-stat-which="current">${currentStr}</td>
      <td data-stat-type="${r.type}" data-stat-which="best">${bestStr}</td>
    </tr>`;
    }).join('');

    // Session info
    const solveCount = stats.count;
    const validCount = solves.filter(s => s.penalty !== 'DNF').length;
    const meanStr = stats.sessionMean != null ? formatTime(stats.sessionMean) : '-';
    document.getElementById('solve-count').textContent = `solve: ${validCount}/${solveCount}`;
    document.getElementById('session-mean').textContent = `mean: ${meanStr}`;

    // Click handlers for summary stats
    tbody.querySelectorAll('td[data-stat-type]').forEach(td => {
        td.onclick = () => {
            const type = td.dataset.statType;
            const which = td.dataset.statWhich;
            handleStatClick(type, which, solves, stats);
        };
    });
}

function handleStatClick(type, which, solves, stats) {
    if (type === 'time') {
        // Show the single solve
        if (which === 'current' && solves.length > 0) {
            openStatDetailAtIndex(type, solves, stats, solves.length - 1);
        } else if (which === 'best') {
            const times = solves.map(s => getEffectiveTime(s));
            const bestTime = stats.best.time;
            const idx = times.indexOf(bestTime);
            if (idx >= 0) showSolveDetail(solves[idx], idx, true);
        }
        return;
    }

    const config = getRollingStatConfig(type);
    if (!config) return;

    if (which === 'current' && solves.length >= config.windowSize) {
        openStatDetailAtIndex(type, solves, stats, solves.length - 1);
    } else if (which === 'best') {
        const bestMatch = findBestRollingStat(statsCache.getTimes(), type);
        if (bestMatch.index >= 0) {
            openStatDetailAtIndex(type, solves, stats, bestMatch.index, { label: `Best ${type}` });
        }
    }
}

// ──── Solves Table ────
function renderSolvesTable(solves, stats) {
    const container = document.getElementById('solves-container');
    const tbody = document.getElementById('solves-tbody');

    // Compute new-best flags for ao5/ao12 (rolling)
    // These are lightweight O(n) scans over the cached per-solve data
    const isNewBestAo5Array = new Array(solves.length).fill(false);
    const isNewBestAo12Array = new Array(solves.length).fill(false);
    let rollingBestAo5 = Infinity;
    let rollingBestAo12 = Infinity;
    for (let i = 0; i < solves.length; i++) {
        const ps = statsCache.getPerSolveAt(i);
        if (ps && ps.ao5 != null && ps.ao5 < rollingBestAo5) {
            rollingBestAo5 = ps.ao5;
            isNewBestAo5Array[i] = true;
        }
        if (ps && ps.ao12 != null && ps.ao12 < rollingBestAo12) {
            rollingBestAo12 = ps.ao12;
            isNewBestAo12Array[i] = true;
        }
    }

    // Update headers to show sort direction
    document.querySelectorAll('#solves-table th[data-sort]').forEach(th => {
        const col = th.dataset.sort;
        let text = col === 'comments' ? '#' : col;
        if (col === 'comments' && commentsOnlyFilterActive) {
            text += '\u2009*';
        } else if (col === currentSortCol) {
            text += currentSortDir === 'asc' ? ' ▴' : ' ▾';
        }
        th.textContent = text;
    });

    // Build sorted index order
    let indices = [];
    if (commentsOnlyFilterActive) {
        indices = solves.map((_, i) => i).filter(i => solves[i].comment && solves[i].comment.trim() !== '');
    } else {
        indices = solves.map((_, i) => i);
    }

    if (currentSortCol) {
        indices.sort((a, b) => {
            let valA, valB;
            if (currentSortCol === 'time') {
                valA = getEffectiveTime(solves[a]);
                valB = getEffectiveTime(solves[b]);
            } else if (currentSortCol === 'ao5') {
                const psA = statsCache.getPerSolveAt(a);
                const psB = statsCache.getPerSolveAt(b);
                valA = psA && psA.ao5 != null ? psA.ao5 : Infinity;
                valB = psB && psB.ao5 != null ? psB.ao5 : Infinity;
            } else if (currentSortCol === 'ao12') {
                const psA = statsCache.getPerSolveAt(a);
                const psB = statsCache.getPerSolveAt(b);
                valA = psA && psA.ao12 != null ? psA.ao12 : Infinity;
                valB = psB && psB.ao12 != null ? psB.ao12 : Infinity;
            }

            if (valA === valB) {
                return currentSortDir === 'asc' ? b - a : a - b;
            }
            if (valA === Infinity && valB !== Infinity) return 1;
            if (valB === Infinity && valA !== Infinity) return -1;
            if (currentSortDir === 'asc') return valA - valB;
            return valB - valA;
        });
    } else {
        indices.reverse(); // Default: newest first
    }

    // Cache for virtualized rendering
    _tableSortedIndices = indices;
    _tableSolves = solves;

    // ── Virtual scroll: only render visible rows ──
    const totalRows = indices.length;
    const totalHeight = totalRows * TABLE_ROW_HEIGHT;

    // Remove old scroll listener
    if (_tableScrollHandler) {
        container.removeEventListener('scroll', _tableScrollHandler);
    }

    function renderVisibleRows() {
        const scrollTop = container.scrollTop;
        const viewportHeight = container.clientHeight;
        const headerHeight = 28; // approximate sticky header height

        const startRow = Math.max(0, Math.floor((scrollTop - headerHeight) / TABLE_ROW_HEIGHT) - 5);
        const visibleRows = Math.ceil(viewportHeight / TABLE_ROW_HEIGHT) + 15;
        const endRow = Math.min(totalRows, startRow + visibleRows);

        const topPad = startRow * TABLE_ROW_HEIGHT;
        const bottomPad = Math.max(0, (totalRows - endRow) * TABLE_ROW_HEIGHT);

        let html = '';
        if (topPad > 0) {
            html += `<tr style="height:${topPad}px"><td colspan="4"></td></tr>`;
        }

        for (let row = startRow; row < endRow; row++) {
            const i = _tableSortedIndices[row];
            const solve = solves[i];
            const ps = statsCache.getPerSolveAt(i);
            const timeStr = formatSolveTime(solve);

            const isBestTime = statsCache.isNewBestAt(i);
            const isBestAo5 = isNewBestAo5Array[i];
            const isBestAo12 = isNewBestAo12Array[i];

            const ao5Str = ps && ps.ao5 != null ? formatTime(ps.ao5) : '';
            const ao12Str = ps && ps.ao12 != null ? formatTime(ps.ao12) : '';

            let indicator = '';
            if (solve.comment) indicator += '*';

            html += `<tr data-solve-id="${solve.id}" data-solve-index="${i}">
      <td>${i + 1}${indicator ? `<span class="solve-index-indicator">${indicator}</span>` : ''}</td>
      <td class="solve-time-cell ${solve.penalty === 'DNF' ? 'dnf-time' : ''} ${isBestTime ? 'new-best-cell' : ''}">
        ${timeStr}
      </td>
      <td class="ao5-cell ${isBestAo5 ? 'new-best-cell' : ''}">${ao5Str}</td>
      <td class="ao12-cell ${isBestAo12 ? 'new-best-cell' : ''}">${ao12Str}</td>
    </tr>`;
        }

        if (bottomPad > 0) {
            html += `<tr style="height:${bottomPad}px"><td colspan="4"></td></tr>`;
        }

        tbody.innerHTML = html;
    }

    renderVisibleRows();

    // Scroll handler with rAF debounce
    let rafPending = false;
    _tableScrollHandler = () => {
        if (!rafPending) {
            rafPending = true;
            requestAnimationFrame(() => {
                renderVisibleRows();
                rafPending = false;
            });
        }
    };
    container.addEventListener('scroll', _tableScrollHandler, { passive: true });

    // Click delegation on tbody for all cell types
    tbody.onclick = (e) => {
        const td = e.target.closest('td');
        if (!td) return;
        const tr = td.closest('tr');
        if (!tr || !tr.dataset.solveIndex) return;
        const idx = parseInt(tr.dataset.solveIndex);

        if (td.classList.contains('solve-time-cell')) {
            openStatDetailAtIndex('time', solves, stats, idx);
        } else if (td.classList.contains('ao5-cell')) {
            openStatDetailAtIndex('ao5', solves, stats, idx);
        } else if (td.classList.contains('ao12-cell')) {
            openStatDetailAtIndex('ao12', solves, stats, idx);
        }
    };
}

// ──── Session Controls ────
function initSessionControls() {
    getSessionSelects().forEach((select) => {
        select.onchange = async (e) => {
            await sessionManager.setActiveSession(e.target.value);
        };
    });

    document.getElementById('btn-new-session').onclick = async () => {
        await sessionManager.createSession();
        refreshSessionList();
    };

    document.getElementById('btn-rename-session').onclick = async () => {
        const session = sessionManager.getActiveSession();
        const name = await customPrompt('', session.name, 50, 'Session name', 'Enter session name...');
        if (name && name.trim()) {
            await sessionManager.renameSession(session.id, name.trim());
            refreshSessionList();
        }
    };

    document.getElementById('btn-delete-session').onclick = async () => {
        if (await customConfirm('Delete this session and all its solves?')) {
            await sessionManager.deleteSession(sessionManager.getActiveSessionId());
            refreshSessionList();
        }
    };
}

function refreshSessionList() {
    const sessions = sessionManager.getSessions();
    const activeId = sessionManager.getActiveSessionId();
    const optionsMarkup = sessions.map(s =>
        `<option value="${s.id}" ${s.id === activeId ? 'selected' : ''}>${s.name} (${s.solveCount})</option>`
    ).join('');

    getSessionSelects().forEach((select) => {
        select.innerHTML = optionsMarkup;
        select.value = activeId;
    });

    syncCustomSelectMenu('session-select');
    syncCustomSelectMenu('mobile-session-select');
}

function onSessionChanged() {
    refreshSessionList();
    rebuildStatsCache();
    refreshUI();
    // Reload scramble display
    const scramble = getCurrentScramble();
    if (scramble) {
        renderScramblePreviewDisplays(scramble);
    }
}

// ──── Filter Controls ────
function initFilterControls() {
    const filterSelect = document.getElementById('stats-filter-select');
    const customInput = document.getElementById('custom-filter-input');
    if (!filterSelect || !customInput) return;

    const syncCustomInputVisibility = ({ focus = false } = {}) => {
        const isCustom = filterSelect.value === 'custom';

        if (!isCustom && document.activeElement === customInput) {
            customInput.blur();
        }

        customInput.style.display = isCustom ? 'block' : 'none';
        customInput.hidden = !isCustom;
        customInput.disabled = !isCustom;
        customInput.setAttribute('aria-hidden', String(!isCustom));

        if (!isCustom || !focus) return;

        window.requestAnimationFrame(() => {
            if (filterSelect.value !== 'custom') return;
            customInput.focus({ preventScroll: true });
            if (typeof customInput.setSelectionRange === 'function') {
                const len = customInput.value.length;
                customInput.setSelectionRange(len, len);
            }
        });
    };

    const syncFilterControlsFromSettings = () => {
        const isEditingCustomInput = document.activeElement === customInput;
        const nextCustomFilterDuration = settings.get('customFilterDuration');
        filterSelect.value = settings.get('statsFilter');
        if (!isEditingCustomInput || customInput.value !== nextCustomFilterDuration) {
            customInput.value = nextCustomFilterDuration;
        }
        syncCustomInputVisibility();
        syncCustomSelectMenu('stats-filter-select');
    };

    const commitCustomFilterDuration = () => {
        const nextValue = customInput.value.trim();
        if (filterSelect.value !== 'custom') {
            filterSelect.value = 'custom';
            settings.set('statsFilter', 'custom');
        }
        settings.set('customFilterDuration', nextValue);
    };

    syncFilterControlsFromSettings();

    filterSelect.onchange = () => {
        settings.set('statsFilter', filterSelect.value);
        syncCustomInputVisibility({ focus: filterSelect.value === 'custom' });
    };

    customInput.addEventListener('input', commitCustomFilterDuration);
    customInput.addEventListener('blur', commitCustomFilterDuration);
    customInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            commitCustomFilterDuration();
            customInput.blur();
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            customInput.value = settings.get('customFilterDuration');
            customInput.blur();
        }
    });

    settings.on('change', (key) => {
        if (key !== 'statsFilter' && key !== 'customFilterDuration') return;
        syncFilterControlsFromSettings();
    });
}

// ──── Settings Panel ────
function initSettingsPanel() {
    settingsOverlayEl = document.getElementById('settings-overlay');
    const btn = document.getElementById('btn-settings');

    btn.onclick = () => {
        openSettingsPanel();
        btn.blur();
    };
    document.getElementById('btn-show-shortcuts').onclick = () => {
        openKeyboardShortcutsOverlay({ closeSettings: true, isSwitching: true });
    };
    document.getElementById('settings-close').onclick = closeSettingsPanel;
    settingsOverlayEl.addEventListener('click', (e) => {
        if (e.target === settingsOverlayEl) closeSettingsPanel();
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Escape' && settingsOverlayEl.classList.contains('active')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeSettingsPanel();
        }
    });

    // WCA inspection toggle
    const inspectionTimeToggle = document.getElementById('setting-inspection-time');
    inspectionTimeToggle.checked = settings.get('inspectionTime') === '15s';
    inspectionTimeToggle.onchange = () => {
        settings.set('inspectionTime', inspectionTimeToggle.checked ? '15s' : 'off');
        inspectionTimeToggle.blur();
    };

    const inspectionAlertsSelect = document.getElementById('setting-inspection-alerts');
    inspectionAlertsSelect.value = settings.get('inspectionAlerts');
    inspectionAlertsSelect.onchange = () => {
        settings.set('inspectionAlerts', inspectionAlertsSelect.value);
        inspectionAlertsSelect.blur();
    };

    const timerUpdateSelect = document.getElementById('setting-timer-update');
    timerUpdateSelect.value = settings.get('timerUpdate');
    timerUpdateSelect.onchange = () => {
        settings.set('timerUpdate', timerUpdateSelect.value);
        timerUpdateSelect.blur();
    };

    const timeEntryModeSelect = document.getElementById('setting-time-entry-mode');
    if (timeEntryModeSelect) {
        timeEntryModeSelect.value = settings.get('timeEntryMode');
        timeEntryModeSelect.onchange = () => {
            settings.set('timeEntryMode', timeEntryModeSelect.value);
            timeEntryModeSelect.blur();
        };
    }

    // Animations toggle
    const animToggle = document.getElementById('setting-animations');
    animToggle.checked = settings.get('animationsEnabled');
    animToggle.onchange = () => settings.set('animationsEnabled', animToggle.checked);

    const highContrastToggle = document.getElementById('setting-high-contrast');
    if (highContrastToggle) {
        highContrastToggle.checked = settings.get('highContrastMode');
        highContrastToggle.onchange = () => settings.set('highContrastMode', highContrastToggle.checked);
    }

    // Hide UI toggle
    const hideUIToggle = document.getElementById('setting-hide-ui');
    const centerTimerToggle = document.getElementById('setting-center-timer');
    const swipeDownGestureToggle = document.getElementById('setting-swipe-down-gesture');
    const swipeDownGestureRow = document.getElementById('setting-swipe-down-gesture-row');

    syncSettingsRowSeparators = () => {
        const groups = settingsOverlayEl?.querySelectorAll('.setting-group');
        if (!groups) return;

        groups.forEach((group) => {
            const rows = Array.from(group.querySelectorAll('.setting-row'));
            rows.forEach((row) => row.classList.remove('setting-row-last-visible'));

            const visibleRows = rows.filter((row) => {
                if (row.hidden) return false;
                return window.getComputedStyle(row).display !== 'none';
            });

            const lastVisibleRow = visibleRows[visibleRows.length - 1];
            if (lastVisibleRow) {
                lastVisibleRow.classList.add('setting-row-last-visible');
            }
        });
    };

    const updateCenterTimerState = () => {
        if (!centerTimerToggle) return;

        const isMobile = mobileViewportQuery.matches;
        const hideUIEnabled = settings.get('hideUIWhileSolving');
        const shouldDisable = !isMobile && !hideUIEnabled;

        centerTimerToggle.disabled = shouldDisable;
        const row = centerTimerToggle.closest('.setting-row');
        if (row) {
            row.style.opacity = shouldDisable ? '0.5' : '';
            row.style.pointerEvents = shouldDisable ? 'none' : '';
        }
    };

    const updateSwipeDownGestureVisibility = () => {
        if (!swipeDownGestureRow) return;
        swipeDownGestureRow.style.display = mobileViewportQuery.matches ? '' : 'none';
        syncSettingsRowSeparators();
    };

    if (hideUIToggle) {
        hideUIToggle.checked = settings.get('hideUIWhileSolving');

        hideUIToggle.onchange = () => {
            settings.set('hideUIWhileSolving', hideUIToggle.checked);
            updateCenterTimerState();
            hideUIToggle.blur();
        };
    }

    // Initial state sync and responsive listener
    updateCenterTimerState();
    updateSwipeDownGestureVisibility();

    const handleSettingsViewportChange = () => {
        updateCenterTimerState();
        updateSwipeDownGestureVisibility();
        syncSettingsRowSeparators();
    };

    if (typeof mobileViewportQuery.addEventListener === 'function') {
        mobileViewportQuery.addEventListener('change', handleSettingsViewportChange);
    } else {
        mobileViewportQuery.addListener(handleSettingsViewportChange);
    }

    // Center Timer toggle
    if (centerTimerToggle) {
        centerTimerToggle.checked = settings.get('centerTimer');
        centerTimerToggle.onchange = () => settings.set('centerTimer', centerTimerToggle.checked);
    }

    if (swipeDownGestureToggle) {
        swipeDownGestureToggle.checked = settings.get('swipeDownGestureEnabled');
        swipeDownGestureToggle.onchange = () => settings.set('swipeDownGestureEnabled', swipeDownGestureToggle.checked);
    }

    const displayFontSelect = document.getElementById('setting-display-font');
    if (displayFontSelect) {
        displayFontSelect.value = settings.get('displayFont');
        if (!displayFontSelect.value) {
            displayFontSelect.value = DEFAULTS.displayFont;
        }
        displayFontSelect.onchange = () => {
            settings.set('displayFont', displayFontSelect.value);
            displayFontSelect.blur();
        };
    }

    const showScrambleTypeToggle = document.getElementById('setting-show-scramble-type');
    if (showScrambleTypeToggle) {
        showScrambleTypeToggle.checked = settings.get('showScrambleTypeButton');
        showScrambleTypeToggle.onchange = () => {
            settings.set('showScrambleTypeButton', showScrambleTypeToggle.checked);
            showScrambleTypeToggle.blur();
        };
    }

    const shortcutTooltipsToggle = document.getElementById('setting-shortcut-tooltips');
    if (shortcutTooltipsToggle) {
        shortcutTooltipsToggle.checked = settings.get('shortcutTooltipsEnabled');
        shortcutTooltipsToggle.onchange = () => settings.set('shortcutTooltipsEnabled', shortcutTooltipsToggle.checked);
    }

    const summaryPresetSelect = document.getElementById('setting-summary-stats-preset');
    const summaryCustomRow = document.getElementById('setting-summary-stats-custom-row');
    const summaryCustomInput = document.getElementById('setting-summary-stats-custom');
    const summaryFeedback = document.getElementById('setting-summary-stats-feedback');

    const autoGrowSummaryCustomInput = () => {
        if (!summaryCustomInput) return;
        if (!summaryCustomInput.offsetParent) return;
        summaryCustomInput.style.height = '0px';
        summaryCustomInput.style.height = `${Math.max(summaryCustomInput.scrollHeight, 32)}px`;
    };

    const updateSummarySettingsUI = () => {
        if (!summaryPresetSelect || !summaryCustomRow || !summaryCustomInput || !summaryFeedback) return;

        const isCustom = summaryPresetSelect.value === 'custom';
        summaryCustomRow.style.display = isCustom ? 'flex' : 'none';

        if (isCustom) autoGrowSummaryCustomInput();

        if (!isCustom) {
            const presetTokens = getPresetSummaryTokens(summaryPresetSelect.value);
            summaryFeedback.classList.remove('is-error');
            summaryFeedback.textContent = `Will show: ${presetTokens.join(', ')}`;
            syncSettingsRowSeparators();
            return;
        }

        const parsed = parseSummaryStatInput(summaryCustomInput.value, { truncate: true });
        if (!parsed.ok) {
            summaryFeedback.classList.add('is-error');
            summaryFeedback.textContent = parsed.message;
            syncSettingsRowSeparators();
            return;
        }

        summaryFeedback.classList.remove('is-error');
        summaryFeedback.textContent = parsed.truncated
            ? `Will show first ${MAX_CUSTOM_SUMMARY_STATS}: ${parsed.tokens.join(', ')}`
            : parsed.tokens.length === 0
            ? 'Will show: none'
            : `Will show: ${parsed.tokens.join(', ')}`;
        syncSettingsRowSeparators();
    };

    if (summaryPresetSelect && summaryCustomRow && summaryCustomInput && summaryFeedback) {
        const savedPreset = String(settings.get('summaryStatsPreset') || 'basic').toLowerCase();
        summaryPresetSelect.value = (savedPreset in SUMMARY_STAT_PRESETS || savedPreset === 'custom') ? savedPreset : 'basic';

        const fallbackCustom = getConfiguredSummaryStatTokens().join(' ');
        summaryCustomInput.value = settings.get('summaryStatsCustom') || fallbackCustom;
        autoGrowSummaryCustomInput();
        updateSummarySettingsUI();

        summaryPresetSelect.onchange = () => {
            const preset = summaryPresetSelect.value;
            settings.set('summaryStatsPreset', preset);

            if (preset !== 'custom') {
                const tokens = getPresetSummaryTokens(preset);
                settings.set('summaryStatsList', tokens);
            } else {
                const parsed = parseSummaryStatInput(summaryCustomInput.value, { truncate: true });
                if (parsed.ok) settings.set('summaryStatsList', parsed.tokens);
            }

            updateSummarySettingsUI();
            summaryPresetSelect.blur();
        };

        summaryCustomInput.addEventListener('input', () => {
            autoGrowSummaryCustomInput();
            settings.set('summaryStatsCustom', summaryCustomInput.value);
            if (summaryPresetSelect.value !== 'custom') return;

            const parsed = parseSummaryStatInput(summaryCustomInput.value, { truncate: true });
            if (parsed.ok) {
                settings.set('summaryStatsList', parsed.tokens);
            }

            updateSummarySettingsUI();
        });
    }

    // Pill size select
    const pillSizeSelect = document.getElementById('setting-pill-size');
    pillSizeSelect.value = settings.get('pillSize');
    pillSizeSelect.onchange = () => {
        settings.set('pillSize', pillSizeSelect.value);
        pillSizeSelect.blur();
    };

    // Show delta toggle
    const deltaToggle = document.getElementById('setting-show-delta');
    deltaToggle.checked = settings.get('showDelta');
    deltaToggle.onchange = () => settings.set('showDelta', deltaToggle.checked);

    const newBestPopupToggle = document.getElementById('setting-new-best-popup');
    newBestPopupToggle.checked = settings.get('newBestPopupEnabled');
    newBestPopupToggle.onchange = () => settings.set('newBestPopupEnabled', newBestPopupToggle.checked);

    const graphTooltipDateToggle = document.getElementById('setting-graph-tooltip-date');
    if (graphTooltipDateToggle) {
        graphTooltipDateToggle.checked = settings.get('graphTooltipDateEnabled');
        graphTooltipDateToggle.onchange = () => settings.set('graphTooltipDateEnabled', graphTooltipDateToggle.checked);
    }

    const graphLineSettingRows = [
        { inputId: 'setting-graph-line1-stat', feedbackId: 'setting-graph-line1-feedback', settingKey: 'graphLine1Stat' },
        { inputId: 'setting-graph-line2-stat', feedbackId: 'setting-graph-line2-feedback', settingKey: 'graphLine2Stat' },
        { inputId: 'setting-graph-line3-stat', feedbackId: 'setting-graph-line3-feedback', settingKey: 'graphLine3Stat' },
    ];

    graphLineSettingRows.forEach(({ inputId, feedbackId, settingKey }) => {
        const input = document.getElementById(inputId);
        const feedback = document.getElementById(feedbackId);
        if (!input || !feedback) return;

        input.value = settings.get(settingKey) || DEFAULTS[settingKey];

        const updateFeedback = () => {
            const parsed = parseGraphLineStatInput(input.value);
            if (!parsed.ok) {
                feedback.classList.add('is-error');
                feedback.textContent = parsed.message;
                return false;
            }

            feedback.classList.remove('is-error');
            feedback.textContent = `Using ${parsed.token}`;
            return parsed.token;
        };

        updateFeedback();

        input.addEventListener('input', () => {
            const parsedToken = updateFeedback();
            if (!parsedToken) return;
            settings.set(settingKey, parsedToken);
        });
    });

    // Colors
    const setupColorSetting = (inputId, resetId, settingKey) => {
        const input = document.getElementById(inputId);
        const resetBtn = document.getElementById(resetId);
        if (!input || !resetBtn) return;
        input.value = settings.get(settingKey);
        input.onchange = () => settings.set(settingKey, input.value);
        input.oninput = () => settings.set(settingKey, input.value);
        resetBtn.onclick = () => {
            input.value = DEFAULTS[settingKey];
            settings.set(settingKey, DEFAULTS[settingKey]);
        };
    };

    setupColorSetting('setting-new-best-color', 'btn-reset-best-color', 'newBestColor');
    setupColorSetting('setting-graph-time-color', 'btn-reset-time-color', 'graphColorTime');
    setupColorSetting('setting-graph-line1-color', 'btn-reset-line1-color', 'graphColorLine1');
    setupColorSetting('setting-graph-line2-color', 'btn-reset-line2-color', 'graphColorLine2');
    setupColorSetting('setting-graph-line3-color', 'btn-reset-line3-color', 'graphColorLine3');

    syncSettingsRowSeparators();

    // // Export
    // document.getElementById('btn-export').onclick = async () => {
    //     const data = await exportAll();
    //     const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    //     const url = URL.createObjectURL(blob);
    //     const a = document.createElement('a');
    //     a.href = url;
    //     a.download = `ukratimer-backup-${formatDate(Date.now())}.json`;
    //     a.click();
    //     URL.revokeObjectURL(url);
    // };

    // Export as csTimer
    document.getElementById('btn-export-cstimer').onclick = async () => {
        const data = await exportCsTimer();
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cstimer-export-${formatDate(Date.now())}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Import — uses modern File System Access API (Chrome/Edge) to avoid
    // the <input type="file"> change-event bugs entirely. Falls back to
    // a one-shot file input for Firefox/Safari.
    document.getElementById('btn-import').onclick = async () => {
        try {
            let text;

            if (window.showOpenFilePicker) {
                // Promise-based: no change events, no re-firing
                const [handle] = await window.showOpenFilePicker({
                    types: [{
                        description: 'Timer backup files',
                        accept: { 'application/json': ['.json', '.txt'] },
                    }],
                    multiple: false,
                });
                const file = await handle.getFile();
                text = await file.text();
            } else {
                // Fallback for browsers without showOpenFilePicker
                text = await new Promise((resolve, reject) => {
                    const inp = document.createElement('input');
                    inp.type = 'file';
                    inp.accept = '.json,.txt';
                    inp.style.position = 'fixed';
                    inp.style.left = '-9999px';
                    document.body.appendChild(inp);

                    inp.addEventListener('change', () => {
                        const f = inp.files[0];
                        document.body.removeChild(inp);
                        if (!f) { reject(new Error('no-file')); return; }
                        f.text().then(resolve, reject);
                    }, { once: true });

                    inp.addEventListener('cancel', () => {
                        document.body.removeChild(inp);
                        reject(new Error('cancelled'));
                    }, { once: true });

                    inp.click();
                });
            }

            const data = JSON.parse(text);
            // Close UI without popping history to avoid back-navigation race condition
            // and ensure confirmation is visible (history state is reused by customConfirm)
            closeSettingsPanel({ isPopState: true });

            if (await customConfirm('This will replace all your current data. Continue?')) {
                if (isCsTimerFormat(data)) {
                    await importCsTimer(data);
                } else {
                    await importAll(data);
                }
                location.reload();
            }
        } catch (e) {
            // Silently ignore user-cancelled or AbortError
            if (e.name === 'AbortError') return;
            if (e.message === 'cancelled' || e.message === 'no-file') return;
            alert('Invalid file format.');
        }
    };
}

function initShortcutsOverlay() {
    shortcutsOverlayEl = document.getElementById('shortcuts-overlay');
    renderKeyboardShortcuts();

    document.getElementById('shortcuts-close').onclick = closeKeyboardShortcutsOverlay;
    shortcutsOverlayEl.addEventListener('click', (e) => {
        if (e.target === shortcutsOverlayEl) closeKeyboardShortcutsOverlay();
    });

    document.addEventListener('keydown', (e) => {
        if (e.code === 'Escape' && shortcutsOverlayEl.classList.contains('active')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeKeyboardShortcutsOverlay();
        }
    });
}

// ──── Init ────
init();
