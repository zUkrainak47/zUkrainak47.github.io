import { formatTime, formatSolveTime, formatReadableDate, formatDateTime, getEffectiveTime } from './utils.js?v=202604049';
import { sessionManager } from './session.js?v=202604049';

let _overlay = null;
let _textarea = null;
let _commentInput = null;
let _modalActions = null;
let _statNav = null;
let _mobileSummary = null;
let _mobileSummaryValue = null;
let _mobileSummaryMeta = null;
let _mobileShareActions = null;
let _mobileCopyButton = null;
let _mobileShareButton = null;
let _mobileListPanel = null;
let _mobileList = null;
let _mobileExportToast = null;
let _copyOptionIncludeCommentsBtn = null;
let _copyOptionIncludeDateBtn = null;
let _copyOptionIncludeAbsoluteIndexBtn = null;
let _currentSolveIndex = null;
let _selectedStatContext = null;
let _onStatNavigate = null;
let _currentDetailPayload = null;
let _currentModalSource = null;
let _ghostClickGuardCleanup = null;
let _ghostClickGuardTimeout = null;
let _mobileExportToastTimeout = null;
const mobileDetailQuery = window.matchMedia('(max-width: 1100px), (pointer: coarse)');
const MODAL_GHOST_CLICK_GUARD_MS = 450;
const MODAL_GHOST_CLICK_RADIUS_PX = 42;
const MODAL_COPY_OPTIONS_STORAGE_KEY = 'ukratimer_modal_copy_options_v1';
const SUMMARY_TIMESTAMP_DISPLAY_OFF = 'off';
const SUMMARY_TIMESTAMP_DISPLAY_DATE_TIME = 'date-time';
const SUMMARY_TIMESTAMP_DISPLAY_TIME = 'time';
const modalCopyOptions = {
    includeComments: false,
    scrambleTimestampDisplay: SUMMARY_TIMESTAMP_DISPLAY_OFF,
    includeAbsoluteIndex: false,
};

function parseSummaryTimestampDisplay(value) {
    switch (value) {
    case SUMMARY_TIMESTAMP_DISPLAY_OFF:
    case SUMMARY_TIMESTAMP_DISPLAY_DATE_TIME:
    case SUMMARY_TIMESTAMP_DISPLAY_TIME:
        return value;
    default:
        return null;
    }
}

function getNextSummaryTimestampDisplay(value) {
    switch (value) {
    case SUMMARY_TIMESTAMP_DISPLAY_DATE_TIME:
        return SUMMARY_TIMESTAMP_DISPLAY_TIME;
    case SUMMARY_TIMESTAMP_DISPLAY_TIME:
        return SUMMARY_TIMESTAMP_DISPLAY_OFF;
    default:
        return SUMMARY_TIMESTAMP_DISPLAY_DATE_TIME;
    }
}

function formatTimestampTimeOnly(timestamp) {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function formatSummaryTimestamp(timestamp) {
    switch (modalCopyOptions.scrambleTimestampDisplay) {
    case SUMMARY_TIMESTAMP_DISPLAY_DATE_TIME:
        return formatDateTime(timestamp);
    case SUMMARY_TIMESTAMP_DISPLAY_TIME:
        return formatTimestampTimeOnly(timestamp);
    default:
        return '';
    }
}

function getSummaryTimestampButtonState() {
    switch (modalCopyOptions.scrambleTimestampDisplay) {
    case SUMMARY_TIMESTAMP_DISPLAY_DATE_TIME:
        return {
            title: 'Show time only',
            ariaLabel: 'Summary timestamp shows date and time. Click to show time only.',
            ariaPressed: 'true',
        };
    case SUMMARY_TIMESTAMP_DISPLAY_TIME:
        return {
            title: 'Hide date and time',
            ariaLabel: 'Summary timestamp shows time only. Click to turn it off.',
            ariaPressed: 'mixed',
        };
    default:
        return {
            title: 'Show date and time',
            ariaLabel: 'Summary timestamp is off. Click to show date and time.',
            ariaPressed: 'false',
        };
    }
}

function getSummaryTimestampToastMessage() {
    switch (modalCopyOptions.scrambleTimestampDisplay) {
    case SUMMARY_TIMESTAMP_DISPLAY_DATE_TIME:
        return 'Date and time will now be included in summary.';
    case SUMMARY_TIMESTAMP_DISPLAY_TIME:
        return 'Only the time will now be included in summary.';
    default:
        return 'Date and time will no longer be included in summary.';
    }
}

function loadModalCopyOptions() {
    try {
        const raw = localStorage.getItem(MODAL_COPY_OPTIONS_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const parsedTimestampDisplay = parseSummaryTimestampDisplay(parsed?.scrambleTimestampDisplay);
        modalCopyOptions.includeComments = Boolean(parsed?.includeComments);
        modalCopyOptions.scrambleTimestampDisplay = parsedTimestampDisplay
            || (parsed?.includeScrambleDate ? SUMMARY_TIMESTAMP_DISPLAY_DATE_TIME : SUMMARY_TIMESTAMP_DISPLAY_OFF);
        modalCopyOptions.includeAbsoluteIndex = Boolean(parsed?.includeAbsoluteIndex);
    } catch {
        modalCopyOptions.includeComments = false;
        modalCopyOptions.scrambleTimestampDisplay = SUMMARY_TIMESTAMP_DISPLAY_OFF;
        modalCopyOptions.includeAbsoluteIndex = false;
    }
}

function saveModalCopyOptions() {
    try {
        localStorage.setItem(MODAL_COPY_OPTIONS_STORAGE_KEY, JSON.stringify({
            includeComments: modalCopyOptions.includeComments,
            scrambleTimestampDisplay: modalCopyOptions.scrambleTimestampDisplay,
            includeAbsoluteIndex: modalCopyOptions.includeAbsoluteIndex,
        }));
    } catch {
    }
}

function renderModalCopyOptionButtons() {
    if (_copyOptionIncludeCommentsBtn) {
        _copyOptionIncludeCommentsBtn.classList.toggle('active-toggle', modalCopyOptions.includeComments);
        _copyOptionIncludeCommentsBtn.setAttribute('aria-pressed', String(modalCopyOptions.includeComments));
    }
    if (_copyOptionIncludeDateBtn) {
        const buttonState = getSummaryTimestampButtonState();
        const hasTimestamp = modalCopyOptions.scrambleTimestampDisplay !== SUMMARY_TIMESTAMP_DISPLAY_OFF;
        const isTimeOnly = modalCopyOptions.scrambleTimestampDisplay === SUMMARY_TIMESTAMP_DISPLAY_TIME;
        _copyOptionIncludeDateBtn.classList.toggle('active-toggle', hasTimestamp);
        _copyOptionIncludeDateBtn.classList.toggle('time-only-toggle', isTimeOnly);
        _copyOptionIncludeDateBtn.dataset.state = modalCopyOptions.scrambleTimestampDisplay;
        _copyOptionIncludeDateBtn.setAttribute('aria-pressed', buttonState.ariaPressed);
        _copyOptionIncludeDateBtn.setAttribute('aria-label', buttonState.ariaLabel);
        _copyOptionIncludeDateBtn.title = buttonState.title;
    }
    if (_copyOptionIncludeAbsoluteIndexBtn) {
        _copyOptionIncludeAbsoluteIndexBtn.classList.toggle('active-toggle', modalCopyOptions.includeAbsoluteIndex);
        _copyOptionIncludeAbsoluteIndexBtn.setAttribute('aria-pressed', String(modalCopyOptions.includeAbsoluteIndex));
    }
}

function updateModalCopyOptionVisibility() {
    if (!_copyOptionIncludeAbsoluteIndexBtn) return;
    const shouldShowAbsoluteIndex = _currentModalSource?.type === 'average';
    _copyOptionIncludeAbsoluteIndexBtn.style.display = shouldShowAbsoluteIndex ? '' : 'none';
}

function getCommentSuffix(solve) {
    const comment = String(solve?.comment ?? '').trim();
    if (!modalCopyOptions.includeComments || !comment) return '';
    return ` [${comment}]`;
}

function getScrambleDateSuffix(solve) {
    const timestampText = formatSummaryTimestamp(solve.timestamp);
    if (!timestampText) return '';
    return `  |  ${timestampText}`;
}

function getAbsoluteSolveIndex(solve, fallbackIndex = null) {
    if (solve?.id) {
        const activeSessionSolves = sessionManager.getActiveSession()?.solves || [];
        const absoluteIndex = activeSessionSolves.findIndex((entry) => entry.id === solve.id);
        if (absoluteIndex >= 0) return absoluteIndex + 1;
    }

    return Number.isInteger(fallbackIndex) ? fallbackIndex + 1 : null;
}

function buildSolveShareText(singleLabel, solveIndex, timeStr, solve) {
    const displayIndex = getAbsoluteSolveIndex(solve, solveIndex);
    return [
        `Generated by UkraTimer on ${formatReadableDate(Date.now())}`,
        `${singleLabel}: ${timeStr}`,
        '',
        `${displayIndex ?? (solveIndex + 1)}. ${timeStr}${getCommentSuffix(solve)}    ${solve.scramble}${getScrambleDateSuffix(solve)}`,
    ].join('\n');
}

function buildAverageShareContent(label, valueStr, solves, trim = 1) {
    const times = solves.map(s => getEffectiveTime(s));
    const sorted = [...times].map((t, i) => ({ time: t, index: i }))
        .sort((a, b) => a.time - b.time);
    const bestIndices = trim > 0 ? new Set(sorted.slice(0, trim).map(s => s.index)) : new Set();
    const worstIndices = trim > 0 ? new Set(sorted.slice(-trim).map(s => s.index)) : new Set();
    const activeSessionSolves = sessionManager.getActiveSession()?.solves || [];
    const absoluteIndexById = new Map(activeSessionSolves.map((solve, index) => [solve.id, index + 1]));
    const displayIndices = solves.map((solve, index) => {
        if (!modalCopyOptions.includeAbsoluteIndex) return index + 1;
        return absoluteIndexById.get(solve.id) || (index + 1);
    });
    const indexPadWidth = String(Math.max(...displayIndices, 1)).length;

    const lines = [
        `Generated by UkraTimer on ${formatReadableDate(Date.now())}`,
        `${label}: ${valueStr}`,
        '',
        'Time List:',
    ];
    const mobileEntries = [];

    solves.forEach((solve, i) => {
        const tStr = formatSolveTime(solve);
        const displayIndex = displayIndices[i];
        const isBest = bestIndices.has(i);
        const isWorst = worstIndices.has(i);
        const display = (isBest || isWorst) ? `(${tStr})` : tStr;
        const lineTime = `${display}${getCommentSuffix(solve)}`;
        const lineScramble = `${solve.scramble}${getScrambleDateSuffix(solve)}`;
        lines.push(`${String(displayIndex).padStart(indexPadWidth)}. ${lineTime}    ${lineScramble}`);
        mobileEntries.push({
            position: displayIndex,
            time: display,
            scramble: solve.scramble,
            date: formatSummaryTimestamp(solve.timestamp),
            trimmed: isBest || isWorst,
        });
    });

    return {
        shareText: lines.join('\n'),
        mobileEntries,
    };
}

function showMobileExportToast(message) {
    if (!_mobileExportToast || !isMobileDetailLayout() || !_overlay?.classList.contains('active')) return;

    _mobileExportToast.textContent = message;
    _mobileExportToast.classList.add('visible');
    window.clearTimeout(_mobileExportToastTimeout);
    _mobileExportToastTimeout = window.setTimeout(() => {
        _mobileExportToast?.classList.remove('visible');
    }, 1700);
}

function clearModalGhostClickGuard() {
    _ghostClickGuardCleanup?.();
    _ghostClickGuardCleanup = null;

    if (_ghostClickGuardTimeout !== null) {
        clearTimeout(_ghostClickGuardTimeout);
        _ghostClickGuardTimeout = null;
    }
}

export function armModalGhostClickGuard(point = null) {
    clearModalGhostClickGuard();

    const expiresAt = performance.now() + MODAL_GHOST_CLICK_GUARD_MS;
    const origin = point && Number.isFinite(point.x) && Number.isFinite(point.y)
        ? { x: point.x, y: point.y }
        : null;

    const handleCapturedClick = (event) => {
        if (!event.isTrusted) return;

        if (performance.now() > expiresAt) {
            clearModalGhostClickGuard();
            return;
        }

        if (origin) {
            const dx = event.clientX - origin.x;
            const dy = event.clientY - origin.y;
            if ((dx * dx) + (dy * dy) > MODAL_GHOST_CLICK_RADIUS_PX ** 2) return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        clearModalGhostClickGuard();
    };

    document.addEventListener('click', handleCapturedClick, true);
    _ghostClickGuardCleanup = () => {
        document.removeEventListener('click', handleCapturedClick, true);
    };
    _ghostClickGuardTimeout = window.setTimeout(clearModalGhostClickGuard, MODAL_GHOST_CLICK_GUARD_MS);
}

export function initModal() {
    _overlay = document.getElementById('modal-overlay');
    _textarea = document.getElementById('modal-textarea');
    _commentInput = document.getElementById('modal-solve-comment');
    _modalActions = document.getElementById('modal-actions');
    _statNav = document.getElementById('modal-stat-nav');
    _mobileSummary = document.getElementById('modal-mobile-summary');
    _mobileSummaryValue = document.getElementById('modal-mobile-value');
    _mobileSummaryMeta = document.getElementById('modal-mobile-meta');
    _mobileShareActions = document.getElementById('modal-mobile-share-actions');
    _mobileCopyButton = document.getElementById('modal-copy-detail');
    _mobileShareButton = document.getElementById('modal-share-detail');
    _mobileListPanel = document.getElementById('modal-mobile-list-panel');
    _mobileList = document.getElementById('modal-mobile-list');
    _mobileExportToast = document.getElementById('modal-mobile-export-toast');
    _copyOptionIncludeCommentsBtn = document.getElementById('modal-option-include-comments');
    _copyOptionIncludeDateBtn = document.getElementById('modal-option-include-date');
    _copyOptionIncludeAbsoluteIndexBtn = document.getElementById('modal-option-include-absolute-index');

    loadModalCopyOptions();
    renderModalCopyOptionButtons();
    updateModalCopyOptionVisibility();

    _overlay.addEventListener('click', (e) => {
        if (e.target === _overlay) closeModal();
    });

    const closeBtn = _overlay.querySelector('.modal-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }

    document.addEventListener('keydown', (e) => {
        // Ignore Escape if the confirm modal is active so it doesn't close both
        const isConfirmActive = document.getElementById('confirm-overlay').classList.contains('active');
        if (e.code === 'Escape' && _overlay.classList.contains('active') && !isConfirmActive) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeModal();
        }
    });

    // Delegate modal action buttons
    document.getElementById('modal-btn-plus2').onclick = () => {
        const id = _modalActions.dataset.solveId;
        if (id) {
            sessionManager.togglePenalty(id, '+2');
            if (_currentSolveIndex !== null) {
                const solve = sessionManager.getActiveSession().solves.find(s => s.id === id);
                if (solve) showSolveDetail(solve, _currentSolveIndex);
            }
        }
    };
    document.getElementById('modal-btn-dnf').onclick = () => {
        const id = _modalActions.dataset.solveId;
        if (id) {
            sessionManager.togglePenalty(id, 'DNF');
            if (_currentSolveIndex !== null) {
                const solve = sessionManager.getActiveSession().solves.find(s => s.id === id);
                if (solve) showSolveDetail(solve, _currentSolveIndex);
            }
        }
    };
    document.getElementById('modal-btn-delete').onclick = async () => {
        const id = _modalActions.dataset.solveId;
        if (id && await customConfirm('Are you sure you want to delete this solve?')) {
            sessionManager.deleteSolve(id);
            closeModal();
        }
    };

    _commentInput.addEventListener('change', (e) => {
        const id = _modalActions.dataset.solveId;
        if (id) {
            const nextComment = String(e.target.value ?? '').trim();
            sessionManager.setSolveComment(id, nextComment);
            refreshSingleSolveSharePreview();
        }
    });

    _commentInput.addEventListener('input', () => {
        autoResizeTextarea(_commentInput);
        refreshSingleSolveSharePreview();
    });

    // Make enter key in comment input also blur to save
    _commentInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            _commentInput.blur();
        }
    });

    _statNav?.addEventListener('click', (e) => {
        const button = e.target.closest('button[data-stat-type]');
        if (!button || button.disabled || typeof _onStatNavigate !== 'function') return;
        _onStatNavigate(button.dataset.statType);
    });

    _mobileCopyButton?.addEventListener('click', () => {
        copyCurrentDetailToClipboard();
    });

    _mobileShareButton?.addEventListener('click', () => {
        shareCurrentDetail();
    });

    _copyOptionIncludeCommentsBtn?.addEventListener('click', () => {
        modalCopyOptions.includeComments = !modalCopyOptions.includeComments;
        saveModalCopyOptions();
        renderModalCopyOptionButtons();
        rerenderCurrentModalSource();
        showMobileExportToast(
            modalCopyOptions.includeComments
                ? 'Comments will now be included in summary.'
                : 'Comments will no longer be included in summary.'
        );
    });

    _copyOptionIncludeDateBtn?.addEventListener('click', () => {
        modalCopyOptions.scrambleTimestampDisplay = getNextSummaryTimestampDisplay(modalCopyOptions.scrambleTimestampDisplay);
        saveModalCopyOptions();
        renderModalCopyOptionButtons();
        rerenderCurrentModalSource();
        showMobileExportToast(getSummaryTimestampToastMessage());
    });

    _copyOptionIncludeAbsoluteIndexBtn?.addEventListener('click', () => {
        modalCopyOptions.includeAbsoluteIndex = !modalCopyOptions.includeAbsoluteIndex;
        saveModalCopyOptions();
        renderModalCopyOptionButtons();
        rerenderCurrentModalSource();
        showMobileExportToast(
            modalCopyOptions.includeAbsoluteIndex
                ? 'Absolute index will now be included in summary.'
                : 'Absolute index will no longer be included in summary.'
        );
    });

    const handleMobileDetailViewportChange = () => {
        if (_overlay?.classList.contains('active')) {
            renderMobileDetail(_currentDetailPayload);
        }
    };

    if (typeof mobileDetailQuery.addEventListener === 'function') {
        mobileDetailQuery.addEventListener('change', handleMobileDetailViewportChange);
    } else {
        mobileDetailQuery.addListener(handleMobileDetailViewportChange);
    }
}

export function setModalStatNavigator(callback) {
    _onStatNavigate = callback;
}

export function setModalStatButtons(buttons) {
    if (!_statNav) return;

    const normalized = Array.isArray(buttons) ? buttons : [];
    _statNav.innerHTML = normalized.map((button) => {
        const statType = String(button.statType ?? '');
        const minIndex = Number.isInteger(button.minIndex) ? button.minIndex : 0;
        const label = String(button.label ?? statType);
        const title = String(button.title ?? label);
        return `<button class="btn-action" data-stat-type="${statType}" data-min-index="${minIndex}" title="${title}">${label}</button>`;
    }).join('');
}

function expandReadableStatLabel(rawLabel) {
    return String(rawLabel ?? '').replace(/\b(mo|ao)([1-9]\d*)\b/gi, (_, kind, n) => (
        kind.toLowerCase() === 'mo' ? `Mean of ${n}` : `Average of ${n}`
    ));
}

/**
 * Custom async confirm modal matching the application aesthetics.
 * Returns a Promise that resolves to true (OK) or false (Cancel).
 */
export function customConfirm(message) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirm-overlay');
        const msgEl = document.getElementById('confirm-message');
        const btnOk = document.getElementById('confirm-btn-ok');
        const btnCancel = document.getElementById('confirm-btn-cancel');
        const btnClose = document.getElementById('confirm-btn-close');

        // Set message
        msgEl.textContent = message;

        if (!window.history.state?.isBackIntercepted) {
            window.history.pushState({ isBackIntercepted: true }, '');
        }

        // Cleanup function
        const cleanup = () => {
            overlay.classList.remove('active');
            btnOk.removeEventListener('click', onOk);
            btnCancel.removeEventListener('click', onCancel);
            btnClose.removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onOverlayClick);
            document.removeEventListener('keydown', onKeydown);
            if (document.activeElement) document.activeElement.blur();
        };

        // Handlers
        const onOk = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };
        const onOverlayClick = (e) => { if (e.target === overlay) onCancel(); };
        const onKeydown = (e) => {
            if (!overlay.classList.contains('active')) return;
            if (e.key === 'Escape') {
                e.stopImmediatePropagation();
                e.preventDefault();
                onCancel();
            }
            if (e.key === 'Enter') onOk();
            e.stopPropagation();
        };

        // Attach listeners
        btnOk.addEventListener('click', onOk);
        btnCancel.addEventListener('click', onCancel);
        btnClose.addEventListener('click', onCancel);
        overlay.addEventListener('click', onOverlayClick);
        document.addEventListener('keydown', onKeydown);

        // Show modal and wait for user interaction
        overlay.classList.add('active');

        // Focus OK button for enter key support
        requestAnimationFrame(() => btnOk.focus());
    });
}

/**
 * Custom async prompt modal matching the application aesthetics.
 * Returns a Promise that resolves to the input value (string) or null (Cancel).
 */
export function customPrompt(message, defaultValue = '', maxLength = 100, title = 'Session name', placeholder = '', onInputCb = null) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('prompt-overlay');
        const titleEl = document.getElementById('prompt-title');
        const msgEl = document.getElementById('prompt-message');
        const inputEl = document.getElementById('prompt-input');
        const btnOk = document.getElementById('prompt-btn-ok');
        const btnCancel = document.getElementById('prompt-btn-cancel');
        const btnClose = document.getElementById('prompt-btn-close');

        // Set title, message and default value
        titleEl.textContent = title;
        msgEl.textContent = message;
        msgEl.style.display = message ? 'block' : 'none';
        inputEl.value = String(defaultValue ?? '');
        inputEl.maxLength = maxLength;
        inputEl.placeholder = placeholder;

        if (!window.history.state?.isBackIntercepted) {
            window.history.pushState({ isBackIntercepted: true }, '');
        }

        const cleanup = () => {
            overlay.classList.remove('active');
            btnOk.removeEventListener('click', onOk);
            btnCancel.removeEventListener('click', onDiscard);
            btnClose.removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onOverlayClick);
            document.removeEventListener('keydown', onKeydown);
            inputEl.removeEventListener('input', onInput);
            if (document.activeElement) document.activeElement.blur();
        };

        // Handlers
        const onOk = () => { cleanup(); resolve(inputEl.value); };
        const onDiscard = () => { cleanup(); resolve(null); };
        const onCancel = () => { cleanup(); resolve(inputEl.value); };
        const onOverlayClick = (e) => { if (e.target === overlay) onCancel(); };
        const onInput = () => {
            autoResizeTextarea(inputEl);
            if (onInputCb) onInputCb(inputEl.value);
        };
        const onKeydown = (e) => {
            if (!overlay.classList.contains('active')) return;
            if (e.key === 'Escape') {
                e.stopImmediatePropagation();
                e.preventDefault();
                onCancel();
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onOk();
            }
            e.stopPropagation();
        };

        // Attach listeners
        btnOk.addEventListener('click', onOk);
        btnCancel.addEventListener('click', onDiscard);
        btnClose.addEventListener('click', onCancel);
        overlay.addEventListener('click', onOverlayClick);
        document.addEventListener('keydown', onKeydown);
        inputEl.addEventListener('input', onInput);

        // Show modal and wait for user interaction
        overlay.classList.add('active');

        // Focus input and move cursor to end, and trigger initial resize
        requestAnimationFrame(() => {
            inputEl.focus();
            inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
            autoResizeTextarea(inputEl);
        });
    });
}



function autoResizeTextarea(el) {
    const modalBody = el.closest('.modal-body');
    const scrollTop = modalBody ? modalBody.scrollTop : 0;

    // Use screen height on mobile to prevent the textarea from shrinking when the virtual keyboard pops up
    const isMobile = window.matchMedia('(max-width: 1100px), (pointer: coarse)').matches;
    const referenceHeight = isMobile ? (window.screen.availHeight || window.innerHeight) : window.innerHeight;
    const maxHeight = referenceHeight * 0.4;
    
    el.style.height = 'auto';
    const sHeight = el.scrollHeight;

    if (sHeight > maxHeight) {
        el.style.height = maxHeight + 'px';
        el.style.overflowY = 'auto';
    } else {
        el.style.height = sHeight + 'px';
        el.style.overflowY = 'hidden';
    }

    // Restore scroll position to prevent layout jumping
    if (modalBody && modalBody.scrollTop !== scrollTop) {
        modalBody.scrollTop = scrollTop;
    }
}

function isMobileDetailLayout() {
    return mobileDetailQuery.matches;
}

function getActiveSessionName() {
    return sessionManager.getActiveSession()?.name || 'Session';
}

function setActionButtonFeedback(button, label) {
    if (!button) return;
    const originalLabel = button.dataset.originalLabel || button.textContent;
    if (!button.dataset.originalLabel) button.dataset.originalLabel = originalLabel;
    button.textContent = label;
    window.clearTimeout(button._feedbackTimeout);
    button._feedbackTimeout = window.setTimeout(() => {
        button.textContent = button.dataset.originalLabel || originalLabel;
    }, 1200);
}

function refreshSingleSolveSharePreview() {
    if (!_overlay?.classList.contains('active')) return;
    if (_currentModalSource?.type !== 'single') return;

    const activeSession = sessionManager.getActiveSession();
    const fallbackSolve = _currentModalSource.solve;
    const solve = activeSession?.solves?.find(s => s.id === _currentModalSource.solveId) || fallbackSolve;
    if (!solve) return;

    const singleLabel = _currentModalSource.isBest ? 'Best single' : 'Single';
    const timeStr = formatSolveTime(solve);
    const previewSolve = {
        ...solve,
        comment: String(_commentInput?.value ?? solve.comment ?? '').trim(),
    };

    const nextShareText = buildSolveShareText(singleLabel, _currentModalSource.index, timeStr, previewSolve);
    _textarea.value = nextShareText;

    if (_currentDetailPayload) {
        _currentDetailPayload.shareText = nextShareText;
    }
}

function rerenderCurrentModalSource() {
    if (!_overlay?.classList.contains('active') || !_currentModalSource) return;

    if (_currentModalSource.type === 'single') {
        const activeSession = sessionManager.getActiveSession();
        const fallbackSolve = _currentModalSource.solve;
        const solve = activeSession?.solves?.find(s => s.id === _currentModalSource.solveId) || fallbackSolve;
        if (!solve) return;
        showSolveDetail(solve, _currentModalSource.index, _currentModalSource.isBest);
        return;
    }

    if (_currentModalSource.type === 'average') {
        showAverageDetail(
            _currentModalSource.label,
            _currentModalSource.value,
            _currentModalSource.solves,
            _currentModalSource.trim,
            _currentModalSource.selectionContext,
        );
    }
}

async function copyCurrentDetailToClipboard(feedbackButton = _mobileCopyButton) {
    if (!_currentDetailPayload?.shareText) return false;

    try {
        await navigator.clipboard.writeText(_currentDetailPayload.shareText);
        setActionButtonFeedback(feedbackButton, 'Copied');
        return true;
    } catch {
        setActionButtonFeedback(feedbackButton, 'Copy failed');
        return false;
    }
}

async function shareCurrentDetail() {
    if (!_currentDetailPayload?.shareText) return;

    if (navigator.share) {
        try {
            await navigator.share({
                title: _currentDetailPayload.title,
                text: _currentDetailPayload.shareText,
            });
            return;
        } catch (error) {
            if (error?.name === 'AbortError') return;
        }
    }

    await copyCurrentDetailToClipboard(_mobileShareButton);
}

function clearMobileList() {
    if (_mobileList) _mobileList.replaceChildren();
}

function createMobileEntry(entry) {
    const item = document.createElement('div');
    item.className = 'modal-mobile-entry';
    if (entry.trimmed) item.classList.add('trimmed');

    const head = document.createElement('div');
    head.className = 'modal-mobile-entry-head';

    const timeBlock = document.createElement('div');
    timeBlock.className = 'modal-mobile-entry-time';

    const index = document.createElement('span');
    index.className = 'modal-mobile-entry-index';
    index.textContent = `${entry.position}.`;

    const time = document.createElement('span');
    time.textContent = entry.time;

    const date = document.createElement('div');
    date.className = 'modal-mobile-entry-date';
    date.textContent = entry.date;

    const scramble = document.createElement('div');
    scramble.className = 'modal-mobile-entry-scramble';
    scramble.textContent = entry.scramble;

    timeBlock.append(index, time);
    head.append(timeBlock);
    if (entry.date) head.append(date);
    item.append(head, scramble);
    return item;
}

function renderMobileDetail(detailPayload) {
    if (!_overlay || !_mobileSummary || !_mobileShareActions || !_mobileListPanel) return;

    const shouldUseMobileDetail = Boolean(detailPayload) && isMobileDetailLayout();
    _overlay.classList.toggle('mobile-detail-active', shouldUseMobileDetail);
    _mobileSummary.hidden = !shouldUseMobileDetail;
    _mobileShareActions.hidden = !shouldUseMobileDetail;
    _mobileListPanel.hidden = !shouldUseMobileDetail;

    if (!shouldUseMobileDetail) {
        clearMobileList();
        return;
    }

    _mobileSummaryValue.textContent = detailPayload.value;
    _mobileSummaryMeta.textContent = detailPayload.meta;
    _mobileCopyButton.textContent = detailPayload.copyLabel;
    _mobileCopyButton.dataset.originalLabel = detailPayload.copyLabel;
    _mobileShareButton.textContent = detailPayload.shareLabel;
    _mobileShareButton.dataset.originalLabel = detailPayload.shareLabel;

    clearMobileList();
    _mobileList.append(...detailPayload.entries.map(createMobileEntry));
    _mobileList.scrollTop = 0;
}

function buildSolveDetailPayload(title, timeStr, solve, index, singleLabel, shareText) {
    return {
        title,
        value: timeStr,
        meta: `${getActiveSessionName()} | ${singleLabel.toLowerCase()}`,
        copyLabel: 'Copy Solve',
        shareLabel: 'Share Solve',
        shareText,
        entries: [{
            position: index + 1,
            time: timeStr,
            scramble: solve.scramble,
            date: formatSummaryTimestamp(solve.timestamp),
            trimmed: false,
        }],
    };
}

function buildAverageDetailPayload(title, valueStr, label, entries, shareText) {
    return {
        title,
        value: valueStr,
        meta: `${getActiveSessionName()} | ${label.toLowerCase()}`,
        copyLabel: 'Copy Average',
        shareLabel: 'Share Average',
        shareText,
        entries,
    };
}

export function closeModal({ isPopState = false } = {}) {
    if (!isPopState && window.history.state?.isBackIntercepted) {
        window.history.back();
    }
    clearModalGhostClickGuard();
    _overlay.classList.remove('active');
    _overlay.classList.remove('stats-detail-active');
    _currentSolveIndex = null;
    _selectedStatContext = null;
    _currentDetailPayload = null;
    _currentModalSource = null;
    _mobileExportToast?.classList.remove('visible');
    window.clearTimeout(_mobileExportToastTimeout);
    renderMobileDetail(null);
    if (document.activeElement) document.activeElement.blur();
}

export function getModalSelectionContext() {
    if (!_overlay?.classList.contains('active')) return null;
    return _selectedStatContext;
}

/**
 * Show a single solve detail.
 */
export function showSolveDetail(solve, index, isBest = null) {
    _currentSolveIndex = index;
    _selectedStatContext = {
        statType: 'time',
        endIndex: index,
        endSolveId: solve.id,
    };
    const timeStr = formatSolveTime(solve);
    const title = `Solve #${index + 1}`;

    if (isBest === null) {
        const solves = sessionManager.getFilteredSolves();
        let bestTime = Infinity;
        for (const currentSolve of solves) {
            const currentTime = getEffectiveTime(currentSolve);
            if (currentTime !== Infinity && currentTime < bestTime) {
                bestTime = currentTime;
            }
        }
        isBest = getEffectiveTime(solve) === bestTime && bestTime !== Infinity;
    }

    const singleLabel = isBest ? 'Best single' : 'Single';

    _currentModalSource = {
        type: 'single',
        solveId: solve.id,
        solve,
        index,
        isBest,
    };

    const text = buildSolveShareText(singleLabel, index, timeStr, solve);

    const detailPayload = buildSolveDetailPayload(title, timeStr, solve, index, singleLabel, text);
    _showModal(title, text, solve, detailPayload);
}

/**
 * Show an average detail (ao5, ao12, etc).
 * @param {string} label - e.g. "ao5" or "Best ao5"
 * @param {number} value - the average value
 * @param {object[]} solves - the solves in this average window
 * @param {number} trim - how many best/worst to mark
 * @param {{ statType?: string, endIndex?: number, endSolveId?: string } | null} selectionContext
 */
export function showAverageDetail(label, value, solves, trim = 1, selectionContext = null) {
    _currentSolveIndex = null;
    _selectedStatContext = selectionContext ? {
        ...selectionContext,
        endSolveId: selectionContext.endSolveId ?? solves[solves.length - 1]?.id ?? null,
    } : null;
    const valueStr = formatTime(value);

    _currentModalSource = {
        type: 'average',
        label,
        value,
        solves,
        trim,
        selectionContext,
    };

    // Expand label for title: "Best ao5" -> "Best Average of 5"
    const title = expandReadableStatLabel(label);

    const { shareText, mobileEntries } = buildAverageShareContent(label, valueStr, solves, trim);
    const detailPayload = buildAverageDetailPayload(title, valueStr, label, mobileEntries, shareText);
    _showModal(title, shareText, null, detailPayload);
}

function updateStatNavigation() {
    if (!_statNav) return;

    if (!_selectedStatContext) {
        _statNav.style.display = 'none';
        _overlay?.classList.remove('stats-detail-active');
        return;
    }

    const currentType = _selectedStatContext.statType || 'time';
    const endIndex = Number.isInteger(_selectedStatContext.endIndex) ? _selectedStatContext.endIndex : -1;

    _statNav.style.display = 'flex';
    _overlay?.classList.add('stats-detail-active');
    _statNav.querySelectorAll('button[data-stat-type]').forEach(button => {
        const statType = button.dataset.statType;
        const minIndex = parseInt(button.dataset.minIndex, 10) || 0;
        const isCurrent = statType === currentType;
        const isAvailable = endIndex >= minIndex;

        button.disabled = isCurrent || !isAvailable;
        button.setAttribute('aria-pressed', String(isCurrent));
    });
}

function parsePx(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getTextareaHeightForRows(rowCount) {
    if (!_textarea) return;

    const computed = window.getComputedStyle(_textarea);
    const lineHeight = parsePx(computed.lineHeight) || (parsePx(computed.fontSize) * 1.6);
    const paddingY = parsePx(computed.paddingTop) + parsePx(computed.paddingBottom);
    const borderY = parsePx(computed.borderTopWidth) + parsePx(computed.borderBottomWidth);
    const safeRowCount = Math.max(1, Number.isFinite(rowCount) ? rowCount : 1);
    return Math.ceil((lineHeight * safeRowCount) + paddingY + borderY);
}

function getTextareaVisualRowCount(text) {
    if (!_textarea) return 1;

    const computed = window.getComputedStyle(_textarea);
    const lineHeight = parsePx(computed.lineHeight) || (parsePx(computed.fontSize) * 1.6);
    const paddingY = parsePx(computed.paddingTop) + parsePx(computed.paddingBottom);
    const previousValue = _textarea.value;
    const previousRows = _textarea.rows;
    const previousCssText = _textarea.style.cssText;

    _textarea.value = text;
    _textarea.rows = 1;
    _textarea.style.setProperty('height', '0px', 'important');
    _textarea.style.setProperty('min-height', '0px', 'important');
    _textarea.style.setProperty('overflow-y', 'hidden', 'important');

    const contentHeight = Math.max(0, _textarea.scrollHeight - paddingY);
    // scrollHeight is integer-rounded, so allow a 1px tolerance to avoid reserving
    // a full extra row when the measured height lands just above an exact line multiple.
    const adjustedContentHeight = Math.max(0, contentHeight - 1);
    const visualRowCount = Math.max(1, Math.ceil(adjustedContentHeight / lineHeight));

    _textarea.value = previousValue;
    _textarea.rows = previousRows;
    _textarea.style.cssText = previousCssText;

    return visualRowCount;
}

function syncTextareaRegularHeight(rowCount) {
    if (!_textarea) return;

    const measuredHeight = getTextareaHeightForRows(rowCount);

    if (measuredHeight > 0) {
        _textarea.style.setProperty('--modal-textarea-regular-height', `${measuredHeight}px`);
    }
}

function _showModal(title, text, solveContext = null, detailPayload = null) {
    document.getElementById('modal-title').textContent = title;
    _textarea.value = text;
    _currentDetailPayload = detailPayload;
    updateModalCopyOptionVisibility();

    const visualRowCount = getTextareaVisualRowCount(text);
    const targetRowCount = Math.min(Math.max(1, visualRowCount), 16);
    const isRowCountCapped = visualRowCount > 16;
    _textarea.rows = targetRowCount;

    if (!isRowCountCapped) {
        _textarea.style.height = 'auto';
        _textarea.style.minHeight = 'auto';
    // } else if (lineCount <= 7) {
    //     _textarea.rows = 7;
    //     _textarea.style.height = 'auto';
    //     _textarea.style.minHeight = 'auto';
    // } else if (lineCount <= 9) {
    //     _textarea.rows = 9;
    //     _textarea.style.height = 'auto';
    //     _textarea.style.minHeight = 'auto';
    } else {
        const cappedHeight = getTextareaHeightForRows(targetRowCount);
        if (cappedHeight > 0) {
            const cappedHeightPx = `${cappedHeight}px`;
            _textarea.style.height = cappedHeightPx;
            _textarea.style.minHeight = cappedHeightPx;
        }
    }

    syncTextareaRegularHeight(targetRowCount);

    const dateInfo = document.getElementById('modal-date-info');

    // Toggle actions visibility based on context
    if (solveContext) {
        _modalActions.style.display = 'flex';
        _modalActions.dataset.solveId = solveContext.id;

        // Show solve date/time in header
        if (dateInfo) {
            dateInfo.textContent = formatDateTime(solveContext.timestamp);
            dateInfo.style.display = 'block';
        }

        // Setup button states
        const btnPlus2 = document.getElementById('modal-btn-plus2');
        const btnDnf = document.getElementById('modal-btn-dnf');

        btnPlus2.classList.toggle('active-penalty', solveContext.penalty === '+2');
        btnDnf.classList.toggle('active-penalty', solveContext.penalty === 'DNF');
        btnPlus2.style.borderColor = '';
        btnPlus2.style.background = '';
        btnPlus2.style.color = '';
        btnDnf.style.borderColor = '';
        btnDnf.style.background = '';
        btnDnf.style.color = '';

        // Setup comment input
        _commentInput.style.display = 'block';
        _commentInput.value = solveContext.comment || '';
        requestAnimationFrame(() => autoResizeTextarea(_commentInput));
    } else {
        _modalActions.style.display = 'none';
        delete _modalActions.dataset.solveId;

        // Hide date info for non-solve modals (averages)
        if (dateInfo) {
            dateInfo.textContent = '';
            dateInfo.style.display = 'none';
        }
        _commentInput.style.display = 'none';
    }

    updateStatNavigation();
    renderMobileDetail(detailPayload);

    if (!window.history.state?.isBackIntercepted) {
        window.history.pushState({ isBackIntercepted: true }, '');
    }

    _overlay.classList.add('active');

    if (!isMobileDetailLayout() || !detailPayload) {
        requestAnimationFrame(() => {
            _textarea.focus();
            _textarea.select();
        });
    }
}
