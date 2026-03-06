import { formatTime, formatSolveTime, formatDate, getEffectiveTime } from './utils.js';
import { sessionManager } from './session.js';

let _overlay = null;
let _content = null;
let _textarea = null;
let _modalActions = null;
let _currentSolveIndex = null;

export function initModal() {
    _overlay = document.getElementById('modal-overlay');
    _content = document.getElementById('modal-content');
    _textarea = document.getElementById('modal-textarea');
    _modalActions = document.getElementById('modal-actions');

    _overlay.addEventListener('click', (e) => {
        if (e.target === _overlay) closeModal();
    });

    document.addEventListener('keydown', (e) => {
        // Ignore Escape if the confirm modal is active so it doesn't close both
        const isConfirmActive = document.getElementById('confirm-overlay').classList.contains('active');
        if (e.code === 'Escape' && _overlay.classList.contains('active') && !isConfirmActive) {
            closeModal();
            e.stopPropagation();
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
export function customPrompt(message, defaultValue = '', maxLength = 100, title = 'Session name') {
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

        // Cleanup function
        const cleanup = () => {
            overlay.classList.remove('active');
            btnOk.removeEventListener('click', onOk);
            btnCancel.removeEventListener('click', onCancel);
            btnClose.removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onOverlayClick);
            document.removeEventListener('keydown', onKeydown);
        };

        // Handlers
        const onOk = () => { cleanup(); resolve(inputEl.value); };
        const onCancel = () => { cleanup(); resolve(null); };
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

        // Focus input and select all text
        requestAnimationFrame(() => {
            inputEl.focus();
            inputEl.select();
        });
    });
}

export function closeModal() {
    _overlay.classList.remove('active');
    if (document.activeElement) document.activeElement.blur();
}

/**
 * Show a single solve detail.
 */
export function showSolveDetail(solve, index) {
    _currentSolveIndex = index;
    const timeStr = formatSolveTime(solve);
    const title = `Solve #${index + 1}`;

    const text = [
        `Generated by CubeTimer on ${formatDate(solve.timestamp)}`,
        ``,
        `Time: ${timeStr}`,
        `Scramble: ${solve.scramble}`,
    ].join('\n');

    _showModal(title, text, solve);
}

/**
 * Show an average detail (ao5, ao12, etc).
 * @param {string} label - e.g. "avg of 5"
 * @param {number} value - the average value
 * @param {object[]} solves - the solves in this average window
 * @param {number} trim - how many best/worst to mark
 */
export function showAverageDetail(label, value, solves, trim = 1) {
    const valueStr = formatTime(value);
    const title = label;

    const times = solves.map(s => getEffectiveTime(s));
    const sorted = [...times].map((t, i) => ({ time: t, index: i }))
        .sort((a, b) => a.time - b.time);

    // Mark best and worst
    const bestIndices = new Set(sorted.slice(0, trim).map(s => s.index));
    const worstIndices = new Set(sorted.slice(-trim).map(s => s.index));

    const lines = [
        `Generated by CubeTimer on ${formatDate(Date.now())}`,
        `${label}: ${valueStr}`,
        ``,
        `Time List:`,
    ];

    solves.forEach((solve, i) => {
        const tStr = formatSolveTime(solve);
        const isBest = bestIndices.has(i);
        const isWorst = worstIndices.has(i);
        const display = (isBest || isWorst) ? `(${tStr})` : tStr;
        const pad = display.length < 10 ? ' '.repeat(10 - display.length) : ' ';
        lines.push(`${String(i + 1).padStart(2)}. ${display}${pad}${solve.scramble}`);
    });

    _showModal(title, lines.join('\n'), null);
}

function _showModal(title, text, solveContext = null) {
    document.getElementById('modal-title').textContent = title;
    _textarea.value = text;

    // Toggle actions visibility based on context
    if (solveContext) {
        _modalActions.style.display = 'flex';
        _modalActions.dataset.solveId = solveContext.id;

        // Setup button states
        const btnPlus2 = document.getElementById('modal-btn-plus2');
        const btnDnf = document.getElementById('modal-btn-dnf');

        btnPlus2.classList.toggle('active-penalty', solveContext.penalty === '+2');
        btnDnf.classList.toggle('active-penalty', solveContext.penalty === 'DNF');

        btnPlus2.style.borderColor = solveContext.penalty === '+2' ? 'rgba(248, 81, 73, 0.5)' : 'var(--text-muted)';
        btnPlus2.style.background = solveContext.penalty === '+2' ? 'rgba(248, 81, 73, 0.1)' : 'var(--surface)';
        btnPlus2.style.color = solveContext.penalty === '+2' ? 'var(--stat-worst)' : 'var(--text-secondary)';

        btnDnf.style.borderColor = solveContext.penalty === 'DNF' ? 'rgba(248, 81, 73, 0.5)' : 'var(--text-muted)';
        btnDnf.style.background = solveContext.penalty === 'DNF' ? 'rgba(248, 81, 73, 0.1)' : 'var(--surface)';
        btnDnf.style.color = solveContext.penalty === 'DNF' ? 'var(--stat-worst)' : 'var(--text-secondary)';
    } else {
        _modalActions.style.display = 'none';
        delete _modalActions.dataset.solveId;
    }

    _overlay.classList.add('active');

    // Select all text for easy copy
    requestAnimationFrame(() => {
        _textarea.focus();
        _textarea.select();
    });
}
