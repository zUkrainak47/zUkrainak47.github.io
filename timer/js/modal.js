import { formatTime, formatSolveTime, formatReadableDate, formatDateTime, getEffectiveTime } from './utils.js';
import { sessionManager } from './session.js';

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
let _currentSolveIndex = null;
let _selectedStatContext = null;
let _onStatNavigate = null;
let _currentDetailPayload = null;
const mobileDetailQuery = window.matchMedia('(max-width: 900px)');

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
            sessionManager.setSolveComment(id, e.target.value.trim());
        }
    });

    _commentInput.addEventListener('input', () => autoResizeTextarea(_commentInput));

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
export function customPrompt(message, defaultValue = '', maxLength = 100, title = 'Session name', placeholder = '') {
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
        inputEl.value = defaultValue;
        inputEl.maxLength = maxLength;
        inputEl.placeholder = placeholder;

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
        const onInput = () => autoResizeTextarea(inputEl);
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
    el.style.height = 'auto';
    // Constrain maximum height to avoid breaking the modal
    const maxHeight = window.innerHeight * 0.4;
    if (el.scrollHeight > maxHeight) {
        el.style.height = maxHeight + 'px';
        el.style.overflowY = 'auto';
    } else {
        el.style.height = el.scrollHeight + 'px';
        el.style.overflowY = 'hidden';
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
    head.append(timeBlock, date);
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
    _mobileListPanel.querySelector('.modal-mobile-list-heading').textContent = detailPayload.listTitle;

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
        listTitle: 'Solve',
        shareText,
        entries: [{
            position: index + 1,
            time: timeStr,
            scramble: solve.scramble,
            date: formatDateTime(solve.timestamp),
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
        listTitle: 'Times',
        shareText,
        entries,
    };
}

export function closeModal() {
    _overlay.classList.remove('active');
    _currentSolveIndex = null;
    _selectedStatContext = null;
    _currentDetailPayload = null;
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
        const effectiveTimes = solves.map(s => getEffectiveTime(s)).filter(t => t !== Infinity);
        const bestTime = effectiveTimes.length > 0 ? Math.min(...effectiveTimes) : Infinity;
        isBest = getEffectiveTime(solve) === bestTime && bestTime !== Infinity;
    }

    const singleLabel = isBest ? 'Best single' : 'Single';

    const text = [
        `Generated by CubeTimer on ${formatReadableDate(Date.now())}`,
        ``,
        `${singleLabel}: ${timeStr}`,
        `Scramble: ${solve.scramble}`,
    ].join('\n');

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

    // Expand label for title: "Best ao5" -> "Best Average of 5"
    let title = label
        .replace(/\bao5\b/g, 'Average of 5')
        .replace(/\bao12\b/g, 'Average of 12')
        .replace(/\bao100\b/g, 'Average of 100')
        .replace(/\bmo3\b/g, 'Mean of 3');

    const times = solves.map(s => getEffectiveTime(s));
    const sorted = [...times].map((t, i) => ({ time: t, index: i }))
        .sort((a, b) => a.time - b.time);

    // Mark best and worst
    const bestIndices = trim > 0 ? new Set(sorted.slice(0, trim).map(s => s.index)) : new Set();
    const worstIndices = trim > 0 ? new Set(sorted.slice(-trim).map(s => s.index)) : new Set();

    const lines = [
        `Generated by CubeTimer on ${formatReadableDate(Date.now())}`,
        `${label}: ${valueStr}`,
        ``,
        `Time List:`,
    ];
    const mobileEntries = [];

    solves.forEach((solve, i) => {
        const tStr = formatSolveTime(solve);
        const isBest = bestIndices.has(i);
        const isWorst = worstIndices.has(i);
        const display = (isBest || isWorst) ? `(${tStr})` : tStr;
        const pad = display.length < 10 ? ' '.repeat(10 - display.length) : ' ';
        lines.push(`${String(i + 1).padStart(2)}. ${display}${pad}${solve.scramble}`);
        mobileEntries.push({
            position: i + 1,
            time: display,
            scramble: solve.scramble,
            date: formatDateTime(solve.timestamp),
            trimmed: isBest || isWorst,
        });
    });

    const shareText = lines.join('\n');
    const detailPayload = buildAverageDetailPayload(title, valueStr, label, mobileEntries, shareText);
    _showModal(title, shareText, null, detailPayload);
}

function updateStatNavigation() {
    if (!_statNav) return;

    if (!_selectedStatContext) {
        _statNav.style.display = 'none';
        return;
    }

    const currentType = _selectedStatContext.statType || 'time';
    const endIndex = Number.isInteger(_selectedStatContext.endIndex) ? _selectedStatContext.endIndex : -1;

    _statNav.style.display = 'flex';
    _statNav.querySelectorAll('button[data-stat-type]').forEach(button => {
        const statType = button.dataset.statType;
        const minIndex = parseInt(button.dataset.minIndex, 10) || 0;
        const isCurrent = statType === currentType;
        const isAvailable = endIndex >= minIndex;

        button.disabled = isCurrent || !isAvailable;
        button.setAttribute('aria-pressed', String(isCurrent));
    });
}

function _showModal(title, text, solveContext = null, detailPayload = null) {
    document.getElementById('modal-title').textContent = title;
    _textarea.value = text;
    _currentDetailPayload = detailPayload;

    const lineCount = text.split('\n').length;
    if (lineCount <= 4) {
        _textarea.rows = 4;
        _textarea.style.height = 'auto';
        _textarea.style.minHeight = 'auto';
    } else if (lineCount <= 7) {
        _textarea.rows = 7;
        _textarea.style.height = 'auto';
        _textarea.style.minHeight = 'auto';
    } else if (lineCount <= 9) {
        _textarea.rows = 9;
        _textarea.style.height = 'auto';
        _textarea.style.minHeight = 'auto';
    } else {
        _textarea.rows = 16;
        _textarea.style.height = '359px';
        _textarea.style.minHeight = '359px';
    }

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

    _overlay.classList.add('active');

    if (!isMobileDetailLayout() || !detailPayload) {
        requestAnimationFrame(() => {
            _textarea.focus();
            _textarea.select();
        });
    }
}
