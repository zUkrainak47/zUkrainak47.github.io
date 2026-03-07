import { timer } from './timer.js';
import { getScramble, getCurrentScramble, getPrevScramble, getNextScramble, setCurrentScramble, isCurrentScrambleManual, hasPrevScramble } from './scramble.js';
import { sessionManager } from './session.js';
import { settings, DEFAULTS } from './settings.js';
import { computeAll, perSolveStats } from './stats.js';
import { formatTime, formatSolveTime, formatTimerDisplayTime, getEffectiveTime, formatDate } from './utils.js';
import { initModal, showSolveDetail, showAverageDetail, closeModal, customConfirm, customPrompt } from './modal.js';
import { initCubeDisplay, updateCubeDisplay } from './cube-display.js';
import { initGraph, updateGraph, setLineVisibility, getLineVisibility, applyAction, graphEvents } from './graph.js';
import { exportAll, importAll, isCsTimerFormat, importCsTimer, exportCsTimer } from './storage.js';

let currentScramble = '';
let currentSortCol = null;
let currentSortDir = null; // 'asc' or 'desc'
const popupState = {
    inspection: { elementId: 'inspection-alert', hideTimeout: null, clearTimeout: null },
    newBest: { elementId: 'new-best-alert', hideTimeout: null, clearTimeout: null },
};
const bestPopupTypes = [
    { key: 'time', label: 'single' },
    { key: 'mo3', label: 'mo3' },
    { key: 'ao5', label: 'ao5' },
    { key: 'ao12', label: 'ao12' },
    { key: 'ao100', label: 'ao100' },
];

// ──── Bootstrap ────
async function init() {
    initModal();
    timer.init(document.getElementById('timer-display'));
    initCubeDisplay(document.getElementById('cube-canvas'));
    initGraph(document.getElementById('graph-canvas'));

    // Load first scramble
    await loadNewScramble();

    // Wire events
    timer.on('stopped', onSolveComplete);
    timer.on('started', onTimerStarted);
    timer.on('stateChange', onTimerStateChange);
    timer.on('inspectionAlert', onInspectionAlert);

    sessionManager.on('solveAdded', refreshUI);
    sessionManager.on('solveUpdated', refreshUI);
    sessionManager.on('solveDeleted', refreshUI);
    sessionManager.on('sessionChanged', onSessionChanged);
    sessionManager.on('sessionDeleted', refreshSessionList);

    settings.on('change', (key) => {
        if (key === 'inspectionAlerts') clearInspectionAlert();
        if (key === 'statsFilter' || key === 'customFilterDuration' || key === 'showDelta' || key.startsWith('graphColor') || key === 'newBestColor') refreshUI();
    });

    // Init UI
    refreshSessionList();
    refreshUI();
    initSettingsPanel();
    initSessionControls();
    initFilterControls();
    initCollapsiblePanels();
    initZenMode();
    initScrambleControls();
    initTimerInfoControls();
    initTableSorting();
    initGraphLineToggles();
    initKeyboardShortcuts();
    initTimerClick();

    graphEvents.on('nodeClick', (idx) => {
        const solves = sessionManager.getFilteredSolves();
        const stats = computeAll(solves);
        if (idx >= 0 && idx < solves.length) {
            const isBest = getEffectiveTime(solves[idx]) === stats.best.time;
            showSolveDetail(solves[idx], idx, isBest);
        }
    });
}

// ──── Graph Line Toggles ────
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
}

// ──── Timer Info Click ────
function initTimerInfoControls() {
    const ao5Box = document.getElementById('info-ao5-box');
    const ao12Box = document.getElementById('info-ao12-box');

    ao5Box.addEventListener('click', () => {
        const solves = sessionManager.getFilteredSolves();
        const stats = computeAll(solves);
        if (stats.current.ao5 != null) {
            showAverageDetail('ao5', stats.current.ao5, solves.slice(-5), 1);
        }
    });

    ao12Box.addEventListener('click', () => {
        const solves = sessionManager.getFilteredSolves();
        const stats = computeAll(solves);
        if (stats.current.ao12 != null) {
            showAverageDetail('ao12', stats.current.ao12, solves.slice(-12), 1);
        }
    });
}

// ──── Timer Click ────
function initTimerClick() {
    const timerDisplay = document.getElementById('timer-display');
    if (!timerDisplay) return;

    timerDisplay.addEventListener('click', () => {
        const state = timer.getState();
        // Only open modal when the timer is idle.
        if (state === 'idle') {
            const solves = sessionManager.getFilteredSolves();
            if (solves.length > 0) {
                // Open the most recent solve (at the end of the array)
                const idx = solves.length - 1;
                const stats = computeAll(solves);
                const isBest = getEffectiveTime(solves[idx]) === stats.best.time;
                showSolveDetail(solves[idx], idx, isBest);
            }
        }
    });
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
function initZenMode() {
    const btn = document.getElementById('btn-zen');
    const isZen = settings.get('zenMode');
    if (isZen) document.body.classList.add('zen');

    btn.addEventListener('click', () => {
        const currentlyZen = document.body.classList.toggle('zen');
        settings.set('zenMode', currentlyZen);
    });
}

// ──── Scramble ────
async function loadNewScramble() {
    const el = document.getElementById('scramble-text');
    el.textContent = 'Generating...';
    el.classList.add('loading');

    currentScramble = await getScramble();

    updateScrambleUI(currentScramble);
}

function updateScrambleUI(scrambleStr) {
    const el = document.getElementById('scramble-text');
    currentScramble = scrambleStr;
    el.textContent = currentScramble;
    el.classList.remove('loading');
    updateCubeDisplay(document.getElementById('cube-canvas'), currentScramble);

    // Update nav button states
    document.getElementById('btn-prev-scramble').disabled = !hasPrevScramble();
}

function initScrambleControls() {
    const textEl = document.getElementById('scramble-text');
    const inputEl = document.getElementById('scramble-input');
    const editBtn = document.getElementById('btn-edit-scramble');
    const prevBtn = document.getElementById('btn-prev-scramble');
    const nextBtn = document.getElementById('btn-next-scramble');

    // 1. Copy
    textEl.addEventListener('click', () => {
        if (!textEl.classList.contains('loading')) {
            navigator.clipboard.writeText(currentScramble);
            const origColor = textEl.style.color;
            textEl.style.color = 'var(--stat-best)';
            setTimeout(() => textEl.style.color = origColor, 500);
        }
    });

    // 2. Edit
    function startEdit() {
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
            updateCubeDisplay(document.getElementById('cube-canvas'), currentScramble);
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
        updateCubeDisplay(document.getElementById('cube-canvas'), val);
    });

    // 3. Navigation
    prevBtn.addEventListener('click', () => {
        const s = getPrevScramble();
        if (s) updateScrambleUI(s);
    });

    nextBtn.addEventListener('click', async () => {
        textEl.textContent = 'Generating...';
        textEl.classList.add('loading');
        const s = await getNextScramble();
        updateScrambleUI(s);
    });
}

// ──── Table Sorting ────
function initTableSorting() {
    const headers = document.querySelectorAll('#solves-table th[data-sort]');
    headers.forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;

            if (col === 'comments') {
                if (currentSortCol === 'comments') {
                    currentSortCol = null;
                } else {
                    currentSortCol = 'comments';
                }
                currentSortDir = null;
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

// ──── Keyboard Shortcuts ────
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ignore input fields, unless it's the modal textarea and we are pressing our special shortcut keys
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            const isModalTextarea = e.target.id === 'modal-textarea';
            const isShortcutKey = ['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract', 'KeyD', 'Backspace', 'Delete'].includes(e.code);
            const isSlashInSettings = e.code === 'Slash' && document.getElementById('settings-overlay').classList.contains('active');

            if (!(isModalTextarea && isShortcutKey) && !isSlashInSettings) {
                return;
            }
        }

        if (e.code === 'Slash') {
            if (document.getElementById('modal-overlay').classList.contains('active')) return;
            if (timer.getState() !== 'idle' && timer.getState() !== 'stopped') return;
            if (e.ctrlKey || e.metaKey) return;

            const overlay = document.getElementById('settings-overlay');
            if (overlay.classList.contains('active')) {
                document.getElementById('settings-close').click();
            } else {
                document.getElementById('btn-settings').click();
            }
            return;
        }

        // Ignore if confirm or settings modal is active
        if (document.getElementById('confirm-overlay').classList.contains('active') ||
            document.getElementById('settings-overlay').classList.contains('active')) return;

        // Ignore if Ctrl or Cmd is pressed (e.g. browser zoom Ctrl+/-)
        if (e.ctrlKey || e.metaKey) return;

        const isSolveModalActive = document.getElementById('modal-overlay').classList.contains('active');

        // Ignore if timer is running or holding
        if (timer.getState() !== 'idle' && timer.getState() !== 'stopped') return;

        switch (e.code) {
            case 'Tab':
                e.preventDefault();
                if (isSolveModalActive || document.getElementById('settings-overlay').classList.contains('active')) return;

                const activeSession = sessionManager.getActiveSession();
                if (activeSession && activeSession.solves.length > 0) {
                    const lastSolve = activeSession.solves[activeSession.solves.length - 1];
                    customPrompt('', lastSolve.comment || '', 1000, 'Comment on last solve', 'Type a comment and press Enter...').then(comment => {
                        if (comment !== null && comment !== (lastSolve.comment || '')) {
                            sessionManager.setSolveComment(lastSolve.id, comment);
                        }
                    });
                }
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
            case 'Equal':
            case 'NumpadAdd':
                if (isSolveModalActive) {
                    const btn = document.getElementById('modal-btn-plus2');
                    if (btn && btn.offsetParent !== null) btn.click();
                } else {
                    const session = sessionManager.getActiveSession();
                    if (session && session.solves.length > 0) {
                        sessionManager.togglePenalty(session.solves[session.solves.length - 1].id, '+2');
                    }
                }
                break;
            case 'KeyD':
            case 'Minus':
            case 'NumpadSubtract':
                if (isSolveModalActive) {
                    const btn = document.getElementById('modal-btn-dnf');
                    if (btn && btn.offsetParent !== null) btn.click();
                } else {
                    const session = sessionManager.getActiveSession();
                    if (session && session.solves.length > 0) {
                        sessionManager.togglePenalty(session.solves[session.solves.length - 1].id, 'DNF');
                    }
                }
                break;
            case 'KeyZ':
                if (isSolveModalActive) return;
                const currentlyZen = document.body.classList.toggle('zen');
                settings.set('zenMode', currentlyZen);
                break;
            case 'KeyT':
                if (isSolveModalActive) return;
                document.getElementById('graph-panel').querySelector('.panel-header').click();
                break;
            case 'KeyS':
                if (isSolveModalActive) return;
                document.getElementById('cube-panel').querySelector('.panel-header').click();
                break;
            case 'Digit1':
                if (isSolveModalActive) return;
                if (e.shiftKey) {
                    const el = document.querySelector('td[data-stat-type="time"][data-stat-which="current"]');
                    if (el) el.click();
                }
                break;
            case 'Digit2':
                if (isSolveModalActive) return;
                if (e.shiftKey) {
                    const el = document.querySelector('td[data-stat-type="ao5"][data-stat-which="current"]');
                    if (el) el.click();
                }
                break;
            case 'Digit3':
                if (isSolveModalActive) return;
                if (e.shiftKey) {
                    const el = document.querySelector('td[data-stat-type="ao12"][data-stat-which="current"]');
                    if (el) el.click();
                }
                break;
            case 'Digit4':
                if (isSolveModalActive) return;
                if (e.shiftKey) {
                    const el = document.querySelector('td[data-stat-type="ao100"][data-stat-which="current"]');
                    if (el) el.click();
                }
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
    const previousStats = computeAll(sessionManager.getFilteredSolves());
    const wasManual = isCurrentScrambleManual();
    sessionManager.addSolve(elapsed, currentScramble, wasManual, penalty);
    maybeShowNewBestAlert(previousStats, computeAll(sessionManager.getFilteredSolves()));
    await loadNewScramble();
}

function onTimerStarted() {
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
    showPopup('newBest', text, 4500);
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

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`${seconds} seconds`);
    utterance.rate = 1.5;
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

    const infoEl = document.getElementById('timer-info');
    const deltaEl = document.getElementById('timer-delta');
    const timerDisplayWrapper = document.getElementById('timer-display-wrapper');
    const shouldFocusTimer = state === 'running' || state === 'ready' || isInspectionState(state);

    // Toggle solving class for focus mode
    document.body.classList.toggle('solving', shouldFocusTimer);

    // Center timer perfectly based on actual screen position
    if (timerDisplayWrapper) {
        if (settings.get('centerTimer') && shouldFocusTimer) {
            if (!timerDisplayWrapper.style.transform) {
                const rect = timerDisplayWrapper.getBoundingClientRect();
                const centerPanel = document.getElementById('center-panel');
                const panelRect = centerPanel.getBoundingClientRect();
                const paddingBottom = parseFloat(getComputedStyle(centerPanel).paddingBottom);
                const targetY = panelRect.top + (panelRect.height - paddingBottom) / 2;
                const timerCenterY = rect.top + rect.height / 2;
                const offset = targetY - timerCenterY;
                timerDisplayWrapper.style.transform = `translateY(${offset}px)`;
            }
        } else {
            timerDisplayWrapper.style.transform = '';
        }
    }

    if (infoEl) {
        infoEl.style.visibility = '';
        infoEl.style.opacity = '';
    }

    if (state === 'inspection-primed' || !isInspectionState(state)) {
        clearInspectionAlert();
    }

    if (state !== 'idle' && state !== 'stopped') {
        clearNewBestAlert();
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
    const labels = bestPopupTypes
        .filter(({ key }) => currentStats.current[key] === currentStats.best[key]
            && didSetNewBest(previousStats.best[key], currentStats.best[key]))
        .map(({ label }) => label);

    if (labels.length === 0) return;
    showNewBestAlert(`Best ${labels.join(', ')}`);
}

// ──── UI Refresh ────
function refreshUI() {
    const solves = sessionManager.getFilteredSolves();
    const stats = computeAll(solves);
    const pss = perSolveStats(solves);

    renderSummaryStats(stats, solves);
    renderSolvesTable(solves, pss, stats);
    updateGraph(solves, pss);
    updateTimerInfo(stats);
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
}

function updateTimerInfo(stats) {
    const infoEl = document.getElementById('timer-info');

    infoEl.style.visibility = '';
    infoEl.style.opacity = '';

    const ao5El = document.getElementById('info-ao5');
    const ao12El = document.getElementById('info-ao12');
    ao5El.textContent = stats.current.ao5 != null ? formatTime(stats.current.ao5) : '-';
    ao12El.textContent = stats.current.ao12 != null ? formatTime(stats.current.ao12) : '-';
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

// ──── Summary Stats ────
function renderSummaryStats(stats, solves) {
    const tbody = document.getElementById('stats-summary-body');
    const rows = [
        { label: 'time', current: stats.current.time, best: stats.best.time, type: 'time' },
        { label: 'mo3', current: stats.current.mo3, best: stats.best.mo3, type: 'mo3' },
        { label: 'ao5', current: stats.current.ao5, best: stats.best.ao5, type: 'ao5' },
        { label: 'ao12', current: stats.current.ao12, best: stats.best.ao12, type: 'ao12' },
        { label: 'ao100', current: stats.current.ao100, best: stats.best.ao100, type: 'ao100' },
    ];

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
    const validTimes = solves.map(s => getEffectiveTime(s)).filter(t => t !== Infinity);
    const mean = validTimes.length > 0
        ? formatTime(validTimes.reduce((a, b) => a + b, 0) / validTimes.length)
        : '-';
    document.getElementById('solve-count').textContent = `solve: ${validTimes.length}/${solves.length}`;
    document.getElementById('session-mean').textContent = `mean: ${mean}`;

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
            showSolveDetail(solves[solves.length - 1], solves.length - 1);
        } else if (which === 'best') {
            const times = solves.map(s => getEffectiveTime(s));
            const bestTime = stats.best.time;
            const idx = times.indexOf(bestTime);
            if (idx >= 0) showSolveDetail(solves[idx], idx, true);
        }
        return;
    }

    const windowMap = { mo3: 3, ao5: 5, ao12: 12, ao100: 100 };
    const trimMap = { mo3: 0, ao5: 1, ao12: 1, ao100: 5 };
    const n = windowMap[type];
    const trim = trimMap[type];

    if (which === 'current' && solves.length >= n) {
        const window = solves.slice(-n);
        const value = stats.current[type];
        showAverageDetail(type, value, window, trim);
    } else if (which === 'best') {
        // Find the best window position
        const times = solves.map(s => getEffectiveTime(s));
        let bestVal = Infinity;
        let bestIdx = -1;

        for (let i = n - 1; i < times.length; i++) {
            const w = times.slice(i - n + 1, i + 1);
            const dnfs = w.filter(t => t === Infinity).length;
            let avg;
            if (type === 'mo3') {
                avg = w.some(t => t === Infinity) ? Infinity : w.reduce((a, b) => a + b, 0) / w.length;
            } else {
                if (dnfs > trim) { avg = Infinity; continue; }
                const sorted = [...w].sort((a, b) => a - b);
                const trimmed = sorted.slice(trim, sorted.length - trim);
                avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
            }
            if (avg < bestVal) { bestVal = avg; bestIdx = i; }
        }

        if (bestIdx >= 0) {
            const window = solves.slice(bestIdx - n + 1, bestIdx + 1);
            showAverageDetail(`Best ${type}`, bestVal, window, trim);
        }
    }
}

// ──── Solves Table ────
function renderSolvesTable(solves, pss, stats) {
    const tbody = document.getElementById('solves-tbody');

    // Compute "New Best" highlights (chronologically)
    let rollingBestTime = Infinity;
    let rollingBestAo5 = Infinity;
    let rollingBestAo12 = Infinity;
    const isNewBestTimeArray = new Array(solves.length).fill(false);
    const isNewBestAo5Array = new Array(solves.length).fill(false);
    const isNewBestAo12Array = new Array(solves.length).fill(false);

    for (let i = 0; i < solves.length; i++) {
        const t = getEffectiveTime(solves[i]);
        if (t !== Infinity && t < rollingBestTime) {
            rollingBestTime = t;
            isNewBestTimeArray[i] = true;
        }
        const ps = pss[i];
        if (ps.ao5 != null && ps.ao5 < rollingBestAo5) {
            rollingBestAo5 = ps.ao5;
            isNewBestAo5Array[i] = true;
        }
        if (ps.ao12 != null && ps.ao12 < rollingBestAo12) {
            rollingBestAo12 = ps.ao12;
            isNewBestAo12Array[i] = true;
        }
    }

    // Update headers to show sort direction
    document.querySelectorAll('#solves-table th[data-sort]').forEach(th => {
        const col = th.dataset.sort;
        let text = col === 'comments' ? '#' : col;
        if (col === currentSortCol) {
            if (col === 'comments') {
                text += '\u2009*';
            } else {
                text += currentSortDir === 'asc' ? ' ▴' : ' ▾';
            }
        }
        th.textContent = text;
    });

    // Build rows according to sort order
    let html = '';

    // First, filter indices based on comment toggle if active
    let indices = [];
    if (currentSortCol === 'comments') {
        indices = solves.map((_, i) => i).filter(i => solves[i].comment && solves[i].comment.trim() !== '');
    } else {
        indices = solves.map((_, i) => i);
    }

    if (currentSortCol && currentSortCol !== 'comments') {
        indices.sort((a, b) => {
            let valA, valB;
            if (currentSortCol === 'time') {
                valA = getEffectiveTime(solves[a]);
                valB = getEffectiveTime(solves[b]);
            } else if (currentSortCol === 'ao5') {
                valA = pss[a].ao5 != null ? pss[a].ao5 : Infinity;
                valB = pss[b].ao5 != null ? pss[b].ao5 : Infinity;
            } else if (currentSortCol === 'ao12') {
                valA = pss[a].ao12 != null ? pss[a].ao12 : Infinity;
                valB = pss[b].ao12 != null ? pss[b].ao12 : Infinity;
            }

            if (valA === valB) {
                // Secondary sort: chronological (newest first fallback)
                return currentSortDir === 'asc' ? b - a : a - b;
            }

            // Always sink Infinity (DNF/empty) to the bottom
            if (valA === Infinity && valB !== Infinity) return 1;
            if (valB === Infinity && valA !== Infinity) return -1;

            if (currentSortDir === 'asc') return valA - valB;
            return valB - valA;
        });
    } else {
        indices.reverse(); // Default: newest first
    }

    for (let idx of indices) {
        let i = idx;
        const solve = solves[i];
        const ps = pss[i];
        const t = getEffectiveTime(solve);
        const timeStr = formatSolveTime(solve);

        const isBestTime = isNewBestTimeArray[i];
        const isBestAo5 = isNewBestAo5Array[i];
        const isBestAo12 = isNewBestAo12Array[i];

        const ao5Str = ps.ao5 != null ? formatTime(ps.ao5) : '';
        const ao12Str = ps.ao12 != null ? formatTime(ps.ao12) : '';

        let indicator = '';
        if (solve.comment) indicator += '*';
        if (solve.isManual) indicator += (indicator ? '\u2009' : '') + '✎';

        html += `<tr data-solve-id="${solve.id}" data-solve-index="${i}">
      <td style="white-space: nowrap; position: relative;">${i + 1}<span style="position: absolute; margin-left: 4px; z-index: 10;">${indicator}</span></td>
      <td class="solve-time-cell ${solve.penalty === 'DNF' ? 'dnf-time' : ''} ${isBestTime ? 'new-best-cell' : ''}">
        ${timeStr}
      </td>
      <td class="ao5-cell ${isBestAo5 ? 'new-best-cell' : ''}">${ao5Str}</td>
      <td class="ao12-cell ${isBestAo12 ? 'new-best-cell' : ''}">${ao12Str}</td>
    </tr>`;
    }

    tbody.innerHTML = html;

    // Click on time cell → show detail
    tbody.querySelectorAll('.solve-time-cell').forEach(cell => {
        cell.addEventListener('click', () => {
            const tr = cell.closest('tr');
            const idx = parseInt(tr.dataset.solveIndex);
            const stats = computeAll(solves);
            const isBest = getEffectiveTime(solves[idx]) === stats.best.time;
            showSolveDetail(solves[idx], idx, isBest);
        });
    });

    // Click on ao5/ao12 cell → show average detail
    tbody.querySelectorAll('.ao5-cell').forEach(cell => {
        cell.addEventListener('click', () => {
            const tr = cell.closest('tr');
            const idx = parseInt(tr.dataset.solveIndex);
            if (idx < 4) return;
            const window = solves.slice(idx - 4, idx + 1);
            const ps = pss[idx];
            showAverageDetail('ao5', ps.ao5, window, 1);
        });
    });

    tbody.querySelectorAll('.ao12-cell').forEach(cell => {
        cell.addEventListener('click', () => {
            const tr = cell.closest('tr');
            const idx = parseInt(tr.dataset.solveIndex);
            if (idx < 11) return;
            const window = solves.slice(idx - 11, idx + 1);
            const ps = pss[idx];
            showAverageDetail('ao12', ps.ao12, window, 1);
        });
    });
}

// ──── Session Controls ────
function initSessionControls() {
    document.getElementById('btn-new-session').onclick = () => {
        sessionManager.createSession();
        refreshSessionList();
    };

    document.getElementById('btn-rename-session').onclick = async () => {
        const session = sessionManager.getActiveSession();
        const name = await customPrompt('', session.name, 50, 'Session name', 'Enter session name...');
        if (name && name.trim()) {
            sessionManager.renameSession(session.id, name.trim());
            refreshSessionList();
        }
    };

    document.getElementById('btn-delete-session').onclick = async () => {
        if (await customConfirm('Delete this session and all its solves?')) {
            sessionManager.deleteSession(sessionManager.getActiveSessionId());
            refreshSessionList();
        }
    };

    document.getElementById('session-select').onchange = (e) => {
        sessionManager.setActiveSession(e.target.value);
        e.target.blur();
    };
}

function refreshSessionList() {
    const select = document.getElementById('session-select');
    const sessions = sessionManager.getSessions();
    const activeId = sessionManager.getActiveSessionId();

    select.innerHTML = sessions.map(s =>
        `<option value="${s.id}" ${s.id === activeId ? 'selected' : ''}>${s.name} (${s.solveCount})</option>`
    ).join('');
}

function onSessionChanged() {
    refreshSessionList();
    refreshUI();
    // Reload scramble display
    const scramble = getCurrentScramble();
    if (scramble) {
        updateCubeDisplay(document.getElementById('cube-canvas'), scramble);
    }
}

// ──── Filter Controls ────
function initFilterControls() {
    const filterSelect = document.getElementById('stats-filter-select');
    const customInput = document.getElementById('custom-filter-input');

    filterSelect.value = settings.get('statsFilter');
    customInput.value = settings.get('customFilterDuration');
    customInput.style.display = settings.get('statsFilter') === 'custom' ? 'block' : 'none';

    filterSelect.onchange = () => {
        settings.set('statsFilter', filterSelect.value);
        customInput.style.display = filterSelect.value === 'custom' ? 'block' : 'none';
        filterSelect.blur();
    };

    customInput.onchange = () => {
        settings.set('customFilterDuration', customInput.value);
    };
}

// ──── Settings Panel ────
function initSettingsPanel() {
    const overlay = document.getElementById('settings-overlay');
    const btn = document.getElementById('btn-settings');

    const closeSettings = () => {
        overlay.classList.remove('active');
        if (document.activeElement) document.activeElement.blur();
    };

    btn.onclick = () => overlay.classList.add('active');
    document.getElementById('settings-close').onclick = closeSettings;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeSettings();
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Escape' && overlay.classList.contains('active')) {
            closeSettings();
            e.stopPropagation();
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

    // Animations toggle
    const animToggle = document.getElementById('setting-animations');
    animToggle.checked = settings.get('animationsEnabled');
    animToggle.onchange = () => settings.set('animationsEnabled', animToggle.checked);

    // Center Timer toggle
    const centerTimerToggle = document.getElementById('setting-center-timer');
    if (centerTimerToggle) {
        centerTimerToggle.checked = settings.get('centerTimer');
        centerTimerToggle.onchange = () => settings.set('centerTimer', centerTimerToggle.checked);
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

    // Colors
    const setupColorSetting = (inputId, resetId, settingKey) => {
        const input = document.getElementById(inputId);
        const resetBtn = document.getElementById(resetId);
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
    setupColorSetting('setting-graph-ao5-color', 'btn-reset-ao5-color', 'graphColorAo5');
    setupColorSetting('setting-graph-ao12-color', 'btn-reset-ao12-color', 'graphColorAo12');
    setupColorSetting('setting-graph-ao100-color', 'btn-reset-ao100-color', 'graphColorAo100');

    // Export
    document.getElementById('btn-export').onclick = () => {
        const data = exportAll();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cubetimer-backup-${formatDate(Date.now())}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Export as csTimer
    document.getElementById('btn-export-cstimer').onclick = () => {
        const data = exportCsTimer();
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
            document.getElementById('settings-overlay').classList.remove('active');
            if (await customConfirm('This will replace all your current data. Continue?')) {
                if (isCsTimerFormat(data)) {
                    importCsTimer(data);
                } else {
                    importAll(data);
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

// ──── Init ────
init();
