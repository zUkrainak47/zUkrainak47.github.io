import { formatTime, getEffectiveTime } from './utils.js';
import { settings } from './settings.js';

/**
 * Time trend graph with pan/zoom controls.
 */

const PADDING = { top: 12, right: 15, bottom: 22, left: 45 };
function getColors() {
    return {
        time: settings.get('graphColorTime') || '#8b949e',
        ao5: settings.get('graphColorAo5') || 'rgba(255, 32, 32, 1)',
        ao12: settings.get('graphColorAo12') || '#2b91ffff',
        ao100: settings.get('graphColorAo100') || '#a371f7',
        grid: '#21262d',
        axis: '#30363d',
        text: '#6e7681',
    };
}

let _canvas = null;
let _ctx = null;
let _solves = [];
let _perSolve = [];
let _hoveredIndex = -1;

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
        if (Math.abs(diff) > 0.001) {
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

export function applyAction(action) {
    const step = 0.15;
    const tot = Math.max(2, _solves.length);
    let curVis = _target.visibleCount === 0 ? tot : _target.visibleCount;

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
        case 'pan-left': nextTarget.xPan = Math.max(0, _target.xPan - step); break;
        case 'pan-right': nextTarget.xPan = Math.min(1, _target.xPan + step); break;
        case 'pan-up': nextTarget.yPan = Math.max(-1, _target.yPan - step); break;
        case 'pan-down': nextTarget.yPan = Math.min(1, _target.yPan + step); break;
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

export function initGraph(canvas) {
    _canvas = canvas;
    _ctx = canvas.getContext('2d');

    const observer = new ResizeObserver(() => {
        const parent = canvas.parentElement;
        canvas.width = parent.clientWidth * devicePixelRatio;
        canvas.height = parent.clientHeight * devicePixelRatio;
        render();
    });
    observer.observe(canvas.parentElement);

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const drawW = rect.width - PADDING.left - PADDING.right;
        if (_solves.length < 2) return;

        const tot = Math.max(2, _solves.length);
        const visibleCount = _view.visibleCount === 0 ? tot : Math.max(2, Math.min(tot, Math.ceil(_view.visibleCount)));
        const maxStart = Math.max(0, _solves.length - visibleCount);
        const startIdx = Math.round(_view.xPan * maxStart);
        const step = drawW / (visibleCount - 1);
        const idx = startIdx + Math.round((x - PADDING.left) / step);
        if (idx >= 0 && idx < _solves.length && idx !== _hoveredIndex) {
            _hoveredIndex = idx;
            render();
        }
    });

    canvas.addEventListener('mouseleave', () => {
        _hoveredIndex = -1;
        render();
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

        controls.addEventListener('mousedown', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const action = btn.dataset.action;
            if (!action) return; // Skip non-action buttons like ⚙

            // Immediate first action
            applyAction(action);

            // After 300ms delay, repeat every 60ms
            _holdTimeout = setTimeout(() => {
                _holdInterval = setInterval(() => applyAction(action), 60);
            }, 300);
        });

        // Stop holding on mouseup/mouseleave
        controls.addEventListener('mouseup', stopHold);
        controls.addEventListener('mouseleave', stopHold);
    }

    return observer;
}

export function updateGraph(solves, perSolveStats) {
    _solves = solves;
    _perSolve = perSolveStats;

    // Conditionally show/hide the "25" button
    const last25Btn = document.querySelector('#graph-controls button[data-action="last25"]');
    if (last25Btn) {
        last25Btn.style.display = _solves.length > 25 ? '' : 'none';
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

function render() {
    if (!_canvas || !_ctx) return;
    const ctx = _ctx;
    const COLORS = getColors();
    const w = _canvas.width / devicePixelRatio;
    const h = _canvas.height / devicePixelRatio;

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

    // Determine visible X range based on zoom/pan
    const totalCount = _solves.length;
    const tot = Math.max(2, totalCount);
    const visibleCount = _view.visibleCount === 0 ? tot : Math.max(2, Math.min(tot, Math.ceil(_view.visibleCount)));
    const maxStart = Math.max(0, totalCount - visibleCount);
    const startIdx = Math.round(_view.xPan * maxStart);
    const endIdx = Math.min(totalCount - 1, startIdx + visibleCount - 1);

    // Collect visible values for Y range
    const visibleValues = [];
    for (let i = startIdx; i <= endIdx; i++) {
        const t = allTimes[i];
        if (t !== Infinity) visibleValues.push(t);
        const ps = _perSolve[i];
        if (ps) {
            if (_lineVisibility.ao5 && ps.ao5 != null && ps.ao5 !== Infinity) visibleValues.push(ps.ao5);
            if (_lineVisibility.ao12 && ps.ao12 != null && ps.ao12 !== Infinity) visibleValues.push(ps.ao12);
            if (_lineVisibility.ao100 && ps.ao100 != null && ps.ao100 !== Infinity) visibleValues.push(ps.ao100);
        }
    }
    if (visibleValues.length === 0) return;

    let dataMin = Math.min(...visibleValues);
    let dataMax = Math.max(...visibleValues);
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
        const visCnt = endIdx - startIdx;
        if (visCnt === 0) return drawX + drawW / 2;
        return drawX + ((i - startIdx) / visCnt) * drawW;
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
    if (_lineVisibility.ao5) drawLine(i => _perSolve[i]?.ao5, COLORS.ao5);
    if (_lineVisibility.ao12) drawLine(i => _perSolve[i]?.ao12, COLORS.ao12);
    if (_lineVisibility.ao100) drawLine(i => _perSolve[i]?.ao100, COLORS.ao100);

    // Hover dot only
    if (_hoveredIndex >= startIdx && _hoveredIndex <= endIdx && allTimes[_hoveredIndex] !== Infinity) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(toX(_hoveredIndex), toY(allTimes[_hoveredIndex]), 3.5, 0, Math.PI * 2);
        ctx.fill();
    }

    // Hover tooltip
    if (_hoveredIndex >= startIdx && _hoveredIndex <= endIdx &&
        allTimes[_hoveredIndex] !== undefined && allTimes[_hoveredIndex] !== Infinity) {
        const x = toX(_hoveredIndex);
        const y = toY(allTimes[_hoveredIndex]);
        const text = formatTime(allTimes[_hoveredIndex]);
        const ps = _perSolve[_hoveredIndex];

        ctx.font = '11px JetBrains Mono, monospace';
        let lines = [`#${_hoveredIndex + 1}: ${text}`];
        if (ps && ps.ao5 != null) lines.push(`ao5: ${formatTime(ps.ao5)}`);
        if (ps && ps.ao12 != null) lines.push(`ao12: ${formatTime(ps.ao12)}`);
        if (ps && ps.ao100 != null) lines.push(`ao100: ${formatTime(ps.ao100)}`);

        const lineHeight = 15;
        const maxWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
        const boxW = maxWidth + 12;
        const boxH = lines.length * lineHeight + 8;

        // Position to the right of the dot; flip left if near right edge
        const gap = 10;
        let boxX = x + gap;
        let boxY = y - boxH / 2;
        if (boxX + boxW > w) boxX = x - boxW - gap;
        if (boxY < 0) boxY = 4;
        if (boxY + boxH > h) boxY = h - boxH - 4;

        ctx.fillStyle = 'rgba(22, 27, 34, 0.95)';
        ctx.beginPath();
        const rr = 4;
        ctx.moveTo(boxX + rr, boxY);
        ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, rr);
        ctx.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, rr);
        ctx.arcTo(boxX, boxY + boxH, boxX, boxY, rr);
        ctx.arcTo(boxX, boxY, boxX + boxW, boxY, rr);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = COLORS.axis;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#e6edf3';
        ctx.textAlign = 'left';
        lines.forEach((line, idx) => {
            ctx.fillText(line, boxX + 6, boxY + 14 + idx * lineHeight);
        });
    }
}
