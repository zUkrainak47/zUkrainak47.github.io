import { formatTime, getEffectiveTime, EventEmitter } from './utils.js';
import { settings } from './settings.js';

/**
 * Time trend graph with pan/zoom controls.
 */

const _isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
const PADDING = {
    top: 12, right: 15, left: 22,
    get bottom() { return _isSafari && window.innerWidth < 500 ? 35 : 22; },
};
const mobileViewportQuery = window.matchMedia('(max-width: 1100px), (pointer: coarse)');
function getColors() {
    const styles = getComputedStyle(document.documentElement);
    const readVar = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;

    return {
        time: settings.get('graphColorTime') || '#8b949e',
        ao5: settings.get('graphColorAo5') || 'rgba(255, 32, 32, 1)',
        ao12: settings.get('graphColorAo12') || '#2b91ffff',
        ao100: settings.get('graphColorAo100') || '#a371f7',
        grid: readVar('--graph-grid', '#21262d'),
        axis: readVar('--surface-border', '#30363d'),
        text: readVar('--text-tertiary', '#6e7681'),
        textPrimary: readVar('--text-primary', '#e6edf3'),
        accent: readVar('--accent', '#58a6ff'),
        bg: readVar('--bg-primary', '#0d1117'),
    };
}

let _canvas = null;
let _ctx = null;
let _solves = [];
let _perSolve = [];
let _statsCache = null;
let _newBestSingles = [];
let _hoveredIndex = -1;
let _touchFocusedIndex = -1;
let _activeTouchPointerId = null;
let _tooltipHitArea = null;
let _tooltipTapPending = false;
export const graphEvents = new EventEmitter();

// Line visibility state
let _lineVisibility = settings.get('graphLines') || { time: true, ao5: true, ao12: true, ao100: true };

export function setLineVisibility(line, visible) {
    _lineVisibility[line] = visible;
    settings.set('graphLines', _lineVisibility);
    render();
}

export function getLineVisibility() {
    return { ..._lineVisibility };
}

// View state — target and animated current
let savedView = settings.get('graphView');
if (savedView && savedView.xZoom !== undefined) {
    savedView = { visibleCount: 0, yZoom: savedView.yZoom, xPan: savedView.xPan, yPan: savedView.yPan };
}
let _target = savedView || { visibleCount: 0, yZoom: 1, xPan: 1, yPan: 0 };
let _view = { ..._target };
let _animating = false;
const BASE_PAN_STEP = 0.15;

function saveView() {
    settings.set('graphView', _target);
}

function resetView() {
    _target = { visibleCount: 0, yZoom: 1, xPan: 1, yPan: 0 };
    saveView();
    startAnimation();
}

function showLast25() {
    if (_solves.length <= 25) {
        resetView();
        return;
    }
    _target = {
        ..._target,
        visibleCount: 25,
        xPan: 1, // Pan to end
        yZoom: 1,
        yPan: 0
    };
    saveView();
    startAnimation();
}

function startAnimation() {
    if (_animating) return;
    _animating = true;
    animateStep();
}

function animateStep() {
    const speed = 0.18;
    let done = true;
    for (const key of ['visibleCount', 'yZoom', 'xPan', 'yPan']) {
        let tVal = _target[key];
        let vVal = _view[key];

        // Handle "fit all" dynamic state for visual animation
        if (key === 'visibleCount') {
            const tot = Math.max(2, _solves.length);
            if (tVal === 0) tVal = tot;
            if (vVal === 0) vVal = tot;

            const diff = tVal - vVal;
            if (Math.abs(diff) > 0.05) {
                let nextVal = vVal + diff * speed;
                // If target is 0 and we are very close to total, snap to 0
                if (_target.visibleCount === 0 && Math.abs(nextVal - tot) < 0.1) {
                    _view.visibleCount = 0;
                } else {
                    _view.visibleCount = nextVal;
                    done = false;
                }
            } else {
                _view.visibleCount = _target.visibleCount;
            }
            continue;
        }

        const diff = tVal - vVal;
        // Use a much tighter threshold for large solve counts (e.g. 50k+)
        // where a 0.001 difference in xPan (0 to 1) can equal 50+ solves.
        if (Math.abs(diff) > 1e-8) {
            _view[key] += diff * speed;
            done = false;
        } else {
            _view[key] = tVal;
        }
    }
    render();
    if (!done) {
        requestAnimationFrame(animateStep);
    } else {
        _animating = false;
    }
}

// Holdable button support
let _holdInterval = null;
let _holdTimeout = null;

function getTargetVisibleCount() {
    const tot = Math.max(2, _solves.length);
    return _target.visibleCount === 0 ? tot : Math.max(2, Math.min(tot, _target.visibleCount));
}

function getPanStep(action) {
    if (action === 'pan-left' || action === 'pan-right') {
        const tot = Math.max(2, _solves.length);
        const visibleCount = getTargetVisibleCount();
        const maxStart = Math.max(0, _solves.length - visibleCount);
        if (maxStart === 0) return 0;

        const scaledStep = BASE_PAN_STEP * (visibleCount / tot);
        const minSingleSolveStep = 1 / maxStart;
        return Math.min(1, Math.max(minSingleSolveStep, scaledStep));
    }

    if (action === 'pan-up' || action === 'pan-down') {
        return BASE_PAN_STEP / Math.max(1, _target.yZoom);
    }

    return BASE_PAN_STEP;
}

export function applyAction(action) {
    const tot = Math.max(2, _solves.length);
    let curVis = getTargetVisibleCount();
    const panStep = getPanStep(action);

    // Use immutable-style updates for better persistence reliability
    let nextTarget = { ..._target };

    switch (action) {
        case 'zoom-x-in':
            nextTarget.visibleCount = Math.max(2, curVis / 1.15);
            break;
        case 'zoom-x-out':
            let nextVisCount = curVis * 1.15;
            if (_target.visibleCount === 0 || nextVisCount >= tot) {
                nextTarget.visibleCount = 0;
            } else {
                nextTarget.visibleCount = nextVisCount;
            }
            break;
        case 'zoom-y-in': nextTarget.yZoom = Math.min(10, _target.yZoom * 1.15); break;
        case 'zoom-y-out': nextTarget.yZoom = Math.max(0.3, _target.yZoom / 1.15); break;
        case 'pan-left': nextTarget.xPan = Math.max(0, _target.xPan - panStep); break;
        case 'pan-right': nextTarget.xPan = Math.min(1, _target.xPan + panStep); break;
        case 'pan-up': nextTarget.yPan = Math.max(-1, _target.yPan - panStep); break;
        case 'pan-down': nextTarget.yPan = Math.min(1, _target.yPan + panStep); break;
        case 'reset': resetView(); return;
        case 'last25': showLast25(); return;
    }

    if (['pan-left', 'pan-right'].includes(action)) nextTarget.xPan = Math.max(0, Math.min(1, nextTarget.xPan));
    if (['pan-up', 'pan-down'].includes(action)) nextTarget.yPan = Math.max(-1, Math.min(1, nextTarget.yPan));

    _target = nextTarget;
    saveView();
    startAnimation();
}

function stopHold() {
    if (_holdTimeout) { clearTimeout(_holdTimeout); _holdTimeout = null; }
    if (_holdInterval) { clearInterval(_holdInterval); _holdInterval = null; }
}

function getActiveFocusedIndex() {
    return _hoveredIndex >= 0 ? _hoveredIndex : _touchFocusedIndex;
}

function getCanvasPointerPosition(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    return {
        rect,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
    };
}

function getSolveIndexAtCanvasX(rect, x) {
    const drawW = rect.width - PADDING.left - PADDING.right;
    if (_solves.length < 1 || drawW <= 0) return -1;

    const totalCount = _solves.length;
    const tot = Math.max(2, totalCount);
    const visibleCount = _view.visibleCount === 0 ? tot : Math.max(2, Math.min(tot, Math.ceil(_view.visibleCount)));
    const maxStart = Math.max(0, totalCount - visibleCount);
    const startIdx = Math.round(_view.xPan * maxStart);
    const clampedX = Math.max(PADDING.left, Math.min(rect.width - PADDING.right, x));
    const step = visibleCount > 1 ? drawW / (visibleCount - 1) : drawW;
    const idx = startIdx + Math.round((clampedX - PADDING.left) / step);

    return idx >= 0 && idx < _solves.length ? idx : -1;
}

function isPointInsideTooltip(x, y) {
    if (!_tooltipHitArea) return false;

    return x >= _tooltipHitArea.x &&
        x <= _tooltipHitArea.x + _tooltipHitArea.width &&
        y >= _tooltipHitArea.y &&
        y <= _tooltipHitArea.y + _tooltipHitArea.height;
}

function clearTouchInteraction() {
    _activeTouchPointerId = null;
    _tooltipTapPending = false;
}

function clearTouchFocus() {
    clearTouchInteraction();
    if (_touchFocusedIndex === -1) return;
    _touchFocusedIndex = -1;
    render();
}

const handleViewportChange = (event) => {
    if (!event.matches) clearTouchFocus();
};

if (typeof mobileViewportQuery.addEventListener === 'function') {
    mobileViewportQuery.addEventListener('change', handleViewportChange);
} else {
    mobileViewportQuery.addListener(handleViewportChange);
}

export function initGraph(canvas) {
    _canvas = canvas;
    _ctx = canvas.getContext('2d');
    const panel = document.getElementById('graph-panel');

    const observer = new ResizeObserver(() => {
        canvas.width = canvas.clientWidth * devicePixelRatio;
        canvas.height = canvas.clientHeight * devicePixelRatio;
        render();
    });
    observer.observe(canvas.parentElement);

    canvas.addEventListener('mousemove', (e) => {
        if (mobileViewportQuery.matches) return;
        const { rect, x } = getCanvasPointerPosition(canvas, e);
        const idx = getSolveIndexAtCanvasX(rect, x);
        if (idx !== _hoveredIndex) {
            _hoveredIndex = idx;
            render();
        }
    });

    canvas.addEventListener('pointerdown', (e) => {
        if (!mobileViewportQuery.matches) return;
        if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
        if (e.button !== undefined && e.button !== 0) return;

        const { rect, x, y } = getCanvasPointerPosition(canvas, e);
        if (_touchFocusedIndex >= 0) {
            if (isPointInsideTooltip(x, y)) {
                _activeTouchPointerId = e.pointerId;
                _tooltipTapPending = true;
                canvas.setPointerCapture?.(e.pointerId);
                e.preventDefault();
                return;
            }

            clearTouchFocus();
            e.preventDefault();
            return;
        }

        const idx = getSolveIndexAtCanvasX(rect, x);
        if (idx < 0) return;

        _activeTouchPointerId = e.pointerId;
        _tooltipTapPending = false;
        _hoveredIndex = -1;
        _touchFocusedIndex = idx;
        canvas.setPointerCapture?.(e.pointerId);
        render();
        e.preventDefault();
    });

    canvas.addEventListener('pointermove', (e) => {
        if (_activeTouchPointerId !== e.pointerId) return;

        const { rect, x, y } = getCanvasPointerPosition(canvas, e);
        if (_tooltipTapPending) {
            _tooltipTapPending = isPointInsideTooltip(x, y);
            e.preventDefault();
            return;
        }

        const idx = getSolveIndexAtCanvasX(rect, x);
        if (idx >= 0 && idx !== _touchFocusedIndex) {
            _touchFocusedIndex = idx;
            render();
        }

        e.preventDefault();
    });

    canvas.addEventListener('click', (e) => {
        if (mobileViewportQuery.matches) return;
        const { rect, x } = getCanvasPointerPosition(canvas, e);
        const idx = getSolveIndexAtCanvasX(rect, x);
        if (idx >= 0) {
            graphEvents.emit('nodeClick', idx);
        }
    });

    canvas.addEventListener('mouseleave', () => {
        _hoveredIndex = -1;
        render();
    });

    const finishTouchInteraction = (e) => {
        if (_activeTouchPointerId !== e.pointerId) return;

        const { x, y } = getCanvasPointerPosition(canvas, e);
        if (_tooltipTapPending && isPointInsideTooltip(x, y) && _touchFocusedIndex >= 0) {
            const focusedIndex = _touchFocusedIndex;
            const touchPoint = { clientX: e.clientX, clientY: e.clientY };
            e.preventDefault();

            // Defer opening the detail view until the touch interaction fully settles.
            window.setTimeout(() => {
                graphEvents.emit('nodeClick', {
                    idx: focusedIndex,
                    source: 'touch',
                    ...touchPoint,
                });
            }, 0);
        }

        canvas.releasePointerCapture?.(e.pointerId);
        clearTouchInteraction();
    };

    canvas.addEventListener('pointerup', finishTouchInteraction);
    canvas.addEventListener('pointercancel', (e) => {
        if (_activeTouchPointerId !== e.pointerId) return;
        canvas.releasePointerCapture?.(e.pointerId);
        clearTouchInteraction();
    });

    panel?.addEventListener('pointerdown', (e) => {
        if (!mobileViewportQuery.matches || _touchFocusedIndex < 0) return;
        if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
        if (e.button !== undefined && e.button !== 0) return;
        if (e.target === canvas) return;
        clearTouchFocus();
    });

    document.addEventListener('pointerdown', (e) => {
        if (!mobileViewportQuery.matches || _touchFocusedIndex < 0) return;
        if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
        if (e.button !== undefined && e.button !== 0) return;
        if (!(e.target instanceof Node)) return;
        if (panel?.contains(e.target)) return;
        clearTouchFocus();
    });

    // Wire controls with holdable buttons
    const controls = document.getElementById('graph-controls');
    if (controls) {
        // Tools drawer toggle
        const toggleBtn = document.getElementById('btn-graph-tools');
        const drawer = document.getElementById('graph-tools-drawer');
        if (toggleBtn && drawer) {
            toggleBtn.addEventListener('click', () => {
                const isCollapsed = drawer.classList.contains('collapsed');
                if (isCollapsed) {
                    // Opening
                    drawer.classList.remove('collapsed');
                    toggleBtn.classList.add('active');
                    const body = document.getElementById('graph-body');
                    const panel = document.getElementById('graph-panel');
                    if (body) body.classList.add('overflow-visible');
                    if (panel) {
                        panel.classList.add('overflow-visible');
                        panel.classList.add('drawer-open');
                    }
                } else {
                    // Closing
                    drawer.classList.add('collapsed');
                    toggleBtn.classList.remove('active');
                    const body = document.getElementById('graph-body');
                    const panel = document.getElementById('graph-panel');
                    if (panel) panel.classList.remove('drawer-open');
                    setTimeout(() => {
                        if (body) body.classList.remove('overflow-visible');
                        if (panel) panel.classList.remove('overflow-visible');
                    }, 250);
                }
            });
        }

        controls.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            const btn = e.target.closest('button');
            if (!btn) return;
            const action = btn.dataset.action;
            if (!action) return; // Skip non-action buttons like ⚙

            e.preventDefault();

            // Immediate first action
            applyAction(action);

            // After 300ms delay, repeat every 60ms
            _holdTimeout = setTimeout(() => {
                _holdInterval = setInterval(() => applyAction(action), 60);
            }, 300);
        });

        controls.addEventListener('pointerup', stopHold);
        controls.addEventListener('pointerleave', stopHold);
        controls.addEventListener('pointercancel', stopHold);
    }

    return observer;
}

export function updateGraph(solves, perSolveStats) {
    _solves = solves;
    _perSolve = perSolveStats;
    _statsCache = null;
    _newBestSingles = getNewBestSingleFlags(solves);
    _tooltipHitArea = null;

    if (_hoveredIndex >= _solves.length) _hoveredIndex = -1;
    if (_touchFocusedIndex >= _solves.length) _touchFocusedIndex = _solves.length - 1;
    if (_solves.length === 0) clearTouchInteraction();

    // Conditionally show/hide the "25" button
    const last25Btn = document.querySelector('#graph-controls button[data-action="last25"]');
    const primaryControls = document.querySelector('.graph-controls-primary');
    if (last25Btn) {
        const showLast25Button = _solves.length > 25;
        last25Btn.style.display = showLast25Button ? '' : 'none';
        primaryControls?.classList.toggle('graph-controls-primary-single-action', !showLast25Button);
    }

    render();
}

/**
 * Update graph with a StatsCache for efficient per-solve lookups.
 * @param {object[]} solves
 * @param {import('./stats.js').StatsCache} cache
 */
export function updateGraphData(solves, cache) {
    _solves = solves;
    _perSolve = [];
    _statsCache = cache;
    _newBestSingles = null; // computed lazily from cache
    _tooltipHitArea = null;

    if (_hoveredIndex >= _solves.length) _hoveredIndex = -1;
    if (_touchFocusedIndex >= _solves.length) _touchFocusedIndex = _solves.length - 1;
    if (_solves.length === 0) clearTouchInteraction();

    const last25Btn = document.querySelector('#graph-controls button[data-action="last25"]');
    const primaryControls = document.querySelector('.graph-controls-primary');
    if (last25Btn) {
        const showLast25Button = _solves.length > 25;
        last25Btn.style.display = showLast25Button ? '' : 'none';
        primaryControls?.classList.toggle('graph-controls-primary-single-action', !showLast25Button);
    }

    render();
}

/**
 * Pick nice Y-axis tick increment (whole seconds or 0.5s).
 */
function niceTickInterval(range, maxTicks) {
    const rangeS = range / 1000;
    const rough = rangeS / maxTicks;
    const niceSteps = [0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    for (const s of niceSteps) {
        if (s >= rough) return s * 1000;
    }
    return Math.ceil(rough / 600) * 600 * 1000;
}

/**
 * Pick nice X-axis tick interval for solve numbers.
 */
function niceXTickInterval(visibleCount) {
    const rough = visibleCount / 6;
    const niceSteps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
    for (const s of niceSteps) {
        if (s >= rough) return s;
    }
    return Math.ceil(rough / 1000) * 1000;
}

function roundedRectPath(ctx, x, y, width, height, radius) {
    const rr = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + width, y, x + width, y + height, rr);
    ctx.arcTo(x + width, y + height, x, y + height, rr);
    ctx.arcTo(x, y + height, x, y, rr);
    ctx.arcTo(x, y, x + width, y, rr);
    ctx.closePath();
}

function getNewBestSingleFlags(solves) {
    let rollingBestTime = Infinity;
    const flags = new Array(solves.length).fill(false);

    for (let i = 0; i < solves.length; i++) {
        const t = getEffectiveTime(solves[i]);
        if (t !== Infinity && t < rollingBestTime) {
            rollingBestTime = t;
            flags[i] = true;
        }
    }

    return flags;
}

/** Get per-solve stats at index, from cache or array */
function _getPerSolve(i) {
    if (_statsCache) return _statsCache.getPerSolveAt(i);
    return _perSolve[i] || null;
}

/** Get new-best-single flag at index, from cache or array */
function _isNewBest(i) {
    if (_statsCache) return _statsCache.isNewBestAt(i);
    if (!_newBestSingles) return false;
    return !!_newBestSingles[i];
}

function render() {
    if (!_canvas || !_ctx) return;
    const ctx = _ctx;
    const COLORS = getColors();
    const w = _canvas.width / devicePixelRatio;
    const h = _canvas.height / devicePixelRatio;
    const activeIndex = getActiveFocusedIndex();
    _tooltipHitArea = null;

    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (_solves.length === 0) {
        ctx.fillStyle = COLORS.text;
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No solves yet', w / 2, h / 2);
        return;
    }

    const allTimes = _solves.map(s => getEffectiveTime(s));
    const validTimes = allTimes.filter(t => t !== Infinity);
    if (validTimes.length === 0) return;

    // Determine visible X range based on zoom/pan using fractional offsets
    const totalCount = _solves.length;
    const tot = Math.max(2, totalCount);
    // Use fractional visibleCount and xPan-derived offset for perfectly smooth movement
    const visibleCount = _view.visibleCount === 0 ? tot : Math.max(2, Math.min(tot, _view.visibleCount));
    const maxStart = Math.max(0, totalCount - visibleCount);
    const viewOffset = _view.xPan * maxStart;
    
    // Bounds for looping (ensure we cover the fractional range)
    const startIdx = Math.max(0, Math.floor(viewOffset));
    const endIdx = Math.min(totalCount - 1, Math.ceil(viewOffset + visibleCount));

    // Collect visible values for Y range
    const visibleValues = [];
    for (let i = startIdx; i <= endIdx; i++) {
        const t = allTimes[i];
        if (t !== Infinity) visibleValues.push(t);
        const ps = _getPerSolve(i);
        if (ps) {
            if (_lineVisibility.ao5 && ps.ao5 != null && ps.ao5 !== Infinity) visibleValues.push(ps.ao5);
            if (_lineVisibility.ao12 && ps.ao12 != null && ps.ao12 !== Infinity) visibleValues.push(ps.ao12);
            if (_lineVisibility.ao100 && ps.ao100 != null && ps.ao100 !== Infinity) visibleValues.push(ps.ao100);
        }
    }
    if (visibleValues.length === 0) return;

    let dataMin = visibleValues[0];
    let dataMax = visibleValues[0];
    for (let i = 1; i < visibleValues.length; i++) {
        const v = visibleValues[i];
        if (v < dataMin) dataMin = v;
        if (v > dataMax) dataMax = v;
    }
    const dataRange = dataMax - dataMin || 1000;

    // Apply Y zoom/pan
    const yCenter = (dataMin + dataMax) / 2 - _view.yPan * dataRange;
    const yHalf = (dataRange * 1.15) / (2 * _view.yZoom);
    const yMin = yCenter - yHalf;
    const yMax = yCenter + yHalf;

    const drawX = PADDING.left;
    const drawY = PADDING.top;
    const drawW = w - PADDING.left - PADDING.right;
    const drawH = h - PADDING.top - PADDING.bottom;

    const toY = (val) => drawY + drawH - ((val - yMin) / (yMax - yMin)) * drawH;
    const toX = (i) => {
        // Linear mapping from solve index to pixel X, using fractional offset and count
        return drawX + ((i - viewOffset) / (visibleCount - 1)) * drawW;
    };

    // Y-axis grid with nice ticks
    const tickInterval = niceTickInterval(yMax - yMin, 7);
    const firstTick = Math.ceil(yMin / tickInterval) * tickInterval;

    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    for (let val = firstTick; val <= yMax; val += tickInterval) {
        if (val < 0) continue;
        const y = toY(val);
        if (y < drawY - 2 || y > drawY + drawH + 2) continue;

        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(drawX, y);
        ctx.lineTo(drawX + drawW, y);
        ctx.stroke();

        // Format label: remove unnecessary .00 decimals
        let label = formatTime(val);
        if (label.endsWith('.00')) label = label.slice(0, -3);
        else if (label.endsWith('0') && label.includes('.')) label = label.slice(0, -1);

        ctx.fillStyle = COLORS.text;
        ctx.fillText(label, drawX - 4, y + 3);
    }

    // X-axis ticks (solve numbers)
    const xTickInterval = niceXTickInterval(endIdx - startIdx + 1);
    const firstXTick = Math.ceil((startIdx + 1) / xTickInterval) * xTickInterval;
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.text;
    for (let solveNum = firstXTick; solveNum <= endIdx + 1; solveNum += xTickInterval) {
        const i = solveNum - 1; // 0-indexed
        if (i < startIdx || i > endIdx) continue;
        const x = toX(i);
        ctx.fillText(solveNum.toString(), x, drawY + drawH + 14);
    }

    // Draw line helper
    function drawLine(getData, color, lineWidth = 2, breakOnEmpty = true) {
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        let started = false;
        for (let i = startIdx; i <= endIdx; i++) {
            const val = getData(i);
            if (val == null || val === Infinity) {
                if (breakOnEmpty) started = false;
                continue;
            }
            const x = toX(i);
            const y = toY(val);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    // Lines
    if (_lineVisibility.time) drawLine(i => allTimes[i], COLORS.time, 2, false);
    if (_lineVisibility.ao5) drawLine(i => _getPerSolve(i)?.ao5, COLORS.ao5);
    if (_lineVisibility.ao12) drawLine(i => _getPerSolve(i)?.ao12, COLORS.ao12);
    if (_lineVisibility.ao100) drawLine(i => _getPerSolve(i)?.ao100, COLORS.ao100);

    const activeMarkers = [];
    if (activeIndex >= startIdx && activeIndex <= endIdx) {
        const ps = _getPerSolve(activeIndex);
        if (_lineVisibility.time && allTimes[activeIndex] !== Infinity) {
            activeMarkers.push({ value: allTimes[activeIndex], color: COLORS.time, radius: 4.25 });
        }
        if (_lineVisibility.ao5 && ps?.ao5 != null && ps.ao5 !== Infinity) {
            activeMarkers.push({ value: ps.ao5, color: COLORS.ao5, radius: 3.5 });
        }
        if (_lineVisibility.ao12 && ps?.ao12 != null && ps.ao12 !== Infinity) {
            activeMarkers.push({ value: ps.ao12, color: COLORS.ao12, radius: 3.5 });
        }
        if (_lineVisibility.ao100 && ps?.ao100 != null && ps.ao100 !== Infinity) {
            activeMarkers.push({ value: ps.ao100, color: COLORS.ao100, radius: 3.5 });
        }
    }

    activeMarkers.forEach((marker) => {
        ctx.fillStyle = COLORS.bg;
        ctx.strokeStyle = marker.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(toX(activeIndex), toY(marker.value), marker.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    });

    // Hover tooltip
    if (activeIndex >= startIdx && activeIndex <= endIdx &&
        allTimes[activeIndex] !== undefined && allTimes[activeIndex] !== Infinity) {
        const anchor = activeMarkers[0];
        const x = toX(activeIndex);
        const y = toY(anchor?.value ?? allTimes[activeIndex]);
        const text = formatTime(allTimes[activeIndex]);
        const solve = _solves[activeIndex];
        const hasComment = !!solve?.comment?.trim();
        const isNewBestSingle = _isNewBest(activeIndex);
        const highlightColor = isNewBestSingle ? '#e3b341' : hasComment ? COLORS.accent : null;
        const showTapHint = mobileViewportQuery.matches;

        ctx.font = '11px JetBrains Mono, monospace';
        const solveLabelPrefix = hasComment ? '*' : '#';
        const lines = [`${solveLabelPrefix}${activeIndex + 1}: ${text}`];
        const ps = _getPerSolve(activeIndex);
        if (ps && ps.ao5 != null) lines.push(`ao5: ${formatTime(ps.ao5)}`);
        if (ps && ps.ao12 != null) lines.push(`ao12: ${formatTime(ps.ao12)}`);
        if (ps && ps.ao100 != null) lines.push(`ao100: ${formatTime(ps.ao100)}`);

        const lineHeight = 15;
        const maxWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
        const boxW = maxWidth + 12 + (showTapHint ? 16 : 0);
        const boxH = lines.length * lineHeight + 8;

        // Position to the right of the dot; flip left if near right edge
        const gap = 10;
        let boxX = x + gap;
        let boxY = y - boxH / 2;
        if (boxX + boxW > w) boxX = x - boxW - gap;
        if (boxY < 0) boxY = 4;
        if (boxY + boxH > h) boxY = h - boxH - 4;

        ctx.fillStyle = 'rgba(22, 27, 34, 0.95)';
        roundedRectPath(ctx, boxX, boxY, boxW, boxH, 4);
        ctx.fill();
        ctx.strokeStyle = highlightColor || COLORS.axis;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.textAlign = 'left';
        lines.forEach((line, idx) => {
            ctx.font = idx === 0 && highlightColor ? '600 11px JetBrains Mono, monospace' : '11px JetBrains Mono, monospace';
            ctx.fillStyle = idx === 0 && highlightColor ? highlightColor : COLORS.textPrimary;
            ctx.fillText(line, boxX + 6, boxY + 14 + idx * lineHeight);
        });

        if (showTapHint) {
            ctx.font = '600 12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = COLORS.text;
            ctx.fillText('▸', boxX + boxW - 8, boxY + (boxH / 2) + 4);
        }

        _tooltipHitArea = { x: boxX, y: boxY, width: boxW, height: boxH };
    }
}
