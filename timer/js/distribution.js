import { formatReadableDate, formatTime, getEffectiveTime } from './utils.js'

const BIN_WIDTH_OPTIONS = Object.freeze([
    { label: '1:00', ms: 60000 },
    { label: '30s', ms: 30000 },
    { label: '10s', ms: 10000 },
    { label: '5s', ms: 5000 },
    { label: '2s', ms: 2000 },
    { label: '1s', ms: 1000 },
    { label: '0.5s', ms: 500 },
    { label: '0.2s', ms: 200 },
    { label: '0.1s', ms: 100 },
])

const RANGE_OPTIONS = Object.freeze([
    { value: 'auto', label: 'Auto', ms: null },
    { value: '30000', label: '0-30s', ms: 30000 },
    { value: '60000', label: '0-60s', ms: 60000 },
    { value: '120000', label: '0-120s', ms: 120000 },
    { value: '300000', label: '0-300s', ms: 300000 },
    { value: '600000', label: '0-600s', ms: 600000 },
])

const DEFAULT_RANGE_VALUE = 'auto'
const touchPrimaryQuery = window.matchMedia('(hover: none) and (pointer: coarse)')

let _overlay = null
let _copyImageButton = null
let _copyTextButton = null
let _closeButton = null
let _canvasShell = null
let _canvas = null
let _tooltip = null
let _tooltipRange = null
let _tooltipCount = null
let _tooltipShare = null
let _emptyState = null
let _sessionEl = null
let _summaryEl = null
let _footerEl = null
let _rangeSelect = null
let _binWidthSelect = null
let _binCoarserButton = null
let _binFinerButton = null
let _escapeHandlerBound = false
let _resizeObserver = null

let _state = null
let _hoveredBinIndex = -1
let _touchFocusedBinIndex = -1
let _activeTouchPointerId = null
let _binHitAreas = []
let _plotBounds = null

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
}

function isTouchLikePointer(pointerType) {
    return pointerType === 'touch' || pointerType === 'pen'
}

function shouldUseTouchInteraction(pointerType = null) {
    if (pointerType === 'mouse') return false
    if (isTouchLikePointer(pointerType)) return true
    return touchPrimaryQuery.matches
}

function getThemeColors() {
    const styles = getComputedStyle(document.documentElement)
    const readVar = (name, fallback) => styles.getPropertyValue(name).trim() || fallback

    return {
        grid: readVar('--graph-grid', '#21262d'),
        axis: readVar('--surface-border', '#30363d'),
        text: readVar('--text-secondary', '#8b949e'),
        textMuted: readVar('--text-tertiary', '#6e7681'),
        surfaceStrong: readVar('--bg-primary', '#0d1117'),
        green: '#41b36d',
        orange: '#f0a11c',
        red: '#ef4444',
        selectedStroke: '#ffd580',
    }
}

function hexToRgb(hex) {
    const normalized = hex.replace('#', '')
    const value = normalized.length === 3
        ? normalized.split('').map((char) => char + char).join('')
        : normalized

    return {
        r: Number.parseInt(value.slice(0, 2), 16),
        g: Number.parseInt(value.slice(2, 4), 16),
        b: Number.parseInt(value.slice(4, 6), 16),
    }
}

function interpolateColor(startHex, endHex, ratio) {
    const start = hexToRgb(startHex)
    const end = hexToRgb(endHex)
    const t = clamp(ratio, 0, 1)
    const channel = (a, b) => Math.round(a + ((b - a) * t))
    return `rgb(${channel(start.r, end.r)}, ${channel(start.g, end.g)}, ${channel(start.b, end.b)})`
}

function getMedian(sortedTimes) {
    if (!sortedTimes.length) return null
    const mid = Math.floor(sortedTimes.length / 2)
    if (sortedTimes.length % 2 === 1) return sortedTimes[mid]
    return (sortedTimes[mid - 1] + sortedTimes[mid]) / 2
}

function getDefaultBinWidthIndex(validTimes) {
    if (validTimes.length < 2) return 5

    const sorted = [...validTimes].sort((a, b) => a - b)
    const target = Math.max((sorted[sorted.length - 1] - sorted[0]) / 14, 100)
    let bestIndex = BIN_WIDTH_OPTIONS.length - 1
    let bestDistance = Infinity

    BIN_WIDTH_OPTIONS.forEach((option, index) => {
        const distance = Math.abs(option.ms - target)
        if (distance < bestDistance) {
            bestDistance = distance
            bestIndex = index
        }
    })

    return bestIndex
}

function getRangeOption(value) {
    return RANGE_OPTIONS.find((option) => option.value === value) || RANGE_OPTIONS[0]
}

function getCurrentBinWidth() {
    if (!_state) return BIN_WIDTH_OPTIONS[5]
    return BIN_WIDTH_OPTIONS[_state.binWidthIndex] || BIN_WIDTH_OPTIONS[5]
}

function getDisplayDigits(step) {
    if (step < 1000) return 2
    if (step < 10000) return 1
    return 0
}

function formatTimeSpan(ms) {
    const option = BIN_WIDTH_OPTIONS.find((entry) => entry.ms === ms)
    if (option) return option.label
    return formatTime(ms, getDisplayDigits(ms))
}

function formatRangeLabel(start, end, digits) {
    if (start === end) return formatTime(start, digits)
    return `${formatTime(start, digits)}–${formatTime(end, digits)}`
}

function buildDistribution(times, binWidthMs, rangeValue) {
    const sortedTimes = [...times].sort((a, b) => a - b)
    if (!sortedTimes.length) {
        return {
            validTimes: [],
            visibleTimes: [],
            median: null,
            bins: [],
            binWidth: binWidthMs,
            min: null,
            max: null,
            domainMin: 0,
            domainMax: binWidthMs,
            maxCount: 0,
            visibleCount: 0,
            clippedLow: 0,
            clippedHigh: 0,
        }
    }

    const min = sortedTimes[0]
    const max = sortedTimes[sortedTimes.length - 1]
    const rangeOption = getRangeOption(rangeValue)
    const median = getMedian(sortedTimes)

    let domainMin = 0
    let domainMax = binWidthMs

    if (rangeOption.ms == null) {
        domainMin = Math.max(0, Math.floor(min / binWidthMs) * binWidthMs)
        domainMax = Math.max(domainMin + binWidthMs, Math.ceil(max / binWidthMs) * binWidthMs)
    } else {
        domainMin = 0
        domainMax = Math.max(binWidthMs, rangeOption.ms)
    }

    const binCount = Math.max(1, Math.ceil((domainMax - domainMin) / binWidthMs))
    const bins = Array.from({ length: binCount }, (_, index) => ({
        start: domainMin + (index * binWidthMs),
        end: domainMin + ((index + 1) * binWidthMs),
        count: 0,
    }))

    const visibleTimes = []
    let clippedLow = 0
    let clippedHigh = 0

    sortedTimes.forEach((time) => {
        if (time < domainMin) {
            clippedLow += 1
            return
        }
        if (time > domainMax) {
            clippedHigh += 1
            return
        }

        const rawIndex = time === domainMax
            ? binCount - 1
            : Math.floor((time - domainMin) / binWidthMs)
        const index = clamp(rawIndex, 0, binCount - 1)
        bins[index].count += 1
        visibleTimes.push(time)
    })

    return {
        validTimes: sortedTimes,
        visibleTimes,
        median,
        bins,
        binWidth: binWidthMs,
        min,
        max,
        domainMin,
        domainMax,
        maxCount: Math.max(...bins.map((bin) => bin.count), 0),
        visibleCount: visibleTimes.length,
        clippedLow,
        clippedHigh,
    }
}

function niceIntegerStep(maxValue, maxTicks = 4) {
    if (maxValue <= 1) return 1
    const rough = maxValue / maxTicks
    const magnitude = 10 ** Math.floor(Math.log10(rough))
    const normalized = rough / magnitude
    if (normalized <= 1) return magnitude
    if (normalized <= 2) return 2 * magnitude
    if (normalized <= 5) return 5 * magnitude
    return 10 * magnitude
}

function getXAxisStep(domainRange, plotWidth) {
    const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000]
    const maxTicks = Math.max(2, Math.floor(plotWidth / 72))
    for (const step of steps) {
        if ((domainRange / step) <= maxTicks) return step
    }
    return steps[steps.length - 1]
}

function buildDistributionTextSummary() {
    if (!_state) return ''

    const distribution = _state.distribution
    const rangeOption = getRangeOption(_state.rangeValue)

    if (!distribution.validTimes.length) {
        return [
            `Generated by UkraTimer on ${formatReadableDate(Date.now())}`,
            `Time distribution for ${_state.sessionName}`,
            '',
            'No valid solves available for a distribution.',
            `Total solves: ${_state.solveCount}`,
            `DNFs: ${_state.dnfCount}`,
        ].join('\n')
    }

    const digits = getDisplayDigits(distribution.binWidth)
    const peak = Math.max(...distribution.bins.map((bin) => bin.count), 1)
    const bins = distribution.bins
        .filter((bin) => bin.count > 0)
        .map((bin) => {
            const barLength = Math.max(1, Math.round((bin.count / peak) * 24))
            return `${formatRangeLabel(bin.start, bin.end, digits).padEnd(18)} | ${'█'.repeat(barLength)} ${bin.count}`
        })

    return [
        `Generated by UkraTimer on ${formatReadableDate(Date.now())}`,
        `Time distribution for ${_state.sessionName}`,
        '',
        `Median: ${formatTime(distribution.median)}`,
        `Data range: ${formatTime(distribution.min)}–${formatTime(distribution.max)}`,
        `Visible range: ${rangeOption.ms == null ? 'Auto' : formatRangeLabel(distribution.domainMin, distribution.domainMax, digits)}`,
        `Bin width: ${formatTimeSpan(distribution.binWidth)}`,
        `Visible solves: ${distribution.visibleCount}/${distribution.validTimes.length}`,
        `DNFs excluded: ${_state.dnfCount}`,
        distribution.clippedLow || distribution.clippedHigh
            ? `Clipped by range: ${distribution.clippedLow + distribution.clippedHigh}`
            : 'Clipped by range: 0',
        '',
        ...bins,
    ].join('\n')
}

function setButtonFeedback(button, label) {
    if (!button) return
    const originalLabel = button.dataset.originalLabel || button.textContent
    if (!button.dataset.originalLabel) button.dataset.originalLabel = originalLabel
    button.textContent = label
    window.clearTimeout(button._feedbackTimeout)
    button._feedbackTimeout = window.setTimeout(() => {
        button.textContent = button.dataset.originalLabel || originalLabel
    }, 1400)
}

function canvasToBlob(canvas) {
    return new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/png')
    })
}

async function copyChartImage(button = _copyImageButton) {
    try {
        if (!_canvas || !_state?.distribution.validTimes.length) throw new Error('No chart')
        if (typeof window.ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('Image copy unsupported')

        const blob = await canvasToBlob(_canvas)
        if (!blob) throw new Error('No image blob')

        await navigator.clipboard.write([
            new ClipboardItem({
                'image/png': blob,
            }),
        ])
        setButtonFeedback(button, 'Copied image')
        return true
    } catch {
        if (!navigator.clipboard?.writeText) {
            setButtonFeedback(button, 'Copy failed')
            return false
        }

        await navigator.clipboard.writeText(buildDistributionTextSummary())
        setButtonFeedback(button, 'Copied text')
        return false
    }
}

async function copyDistributionText(button = _copyTextButton) {
    try {
        if (!navigator.clipboard?.writeText) throw new Error('Text copy unsupported')
        await navigator.clipboard.writeText(buildDistributionTextSummary())
        setButtonFeedback(button, 'Copied text')
    } catch {
        setButtonFeedback(button, 'Copy failed')
    }
}

function syncControls() {
    if (!_state || !_rangeSelect || !_binWidthSelect || !_binCoarserButton || !_binFinerButton) return
    _rangeSelect.value = _state.rangeValue
    _binWidthSelect.value = String(_state.binWidthIndex)
    _binCoarserButton.disabled = _state.binWidthIndex <= 0
    _binFinerButton.disabled = _state.binWidthIndex >= BIN_WIDTH_OPTIONS.length - 1
}

function hideTooltip() {
    if (!_tooltip) return
    _tooltip.hidden = true
}

function getActiveBinIndex() {
    return _touchFocusedBinIndex >= 0 ? _touchFocusedBinIndex : _hoveredBinIndex
}

function positionTooltip(index, point = null) {
    if (!_tooltip || !_canvasShell || index < 0 || !_binHitAreas[index]) return

    const area = _binHitAreas[index]
    const shellRect = _canvasShell.getBoundingClientRect()
    const localX = point?.x ?? (area.x + (area.width / 2))
    const localY = point?.y ?? area.y

    _tooltip.hidden = false
    const tooltipWidth = _tooltip.offsetWidth || 180
    const tooltipHeight = _tooltip.offsetHeight || 72
    const left = clamp(localX, 10 + (tooltipWidth / 2), shellRect.width - 10 - (tooltipWidth / 2))
    const top = clamp(localY, tooltipHeight + 16, shellRect.height - 10)

    _tooltip.style.left = `${left}px`
    _tooltip.style.top = `${top}px`
}

function showTooltipForBin(index, point = null) {
    if (!_tooltip || !_tooltipRange || !_tooltipCount || !_tooltipShare || !_state || index < 0) {
        hideTooltip()
        return
    }

    const distribution = _state.distribution
    const bin = distribution.bins[index]
    if (!bin) {
        hideTooltip()
        return
    }

    const digits = getDisplayDigits(distribution.binWidth)
    const share = distribution.visibleCount > 0 ? (bin.count / distribution.visibleCount) * 100 : 0

    _tooltipRange.textContent = formatRangeLabel(bin.start, bin.end, digits)
    _tooltipCount.textContent = `${bin.count} solve${bin.count === 1 ? '' : 's'} in this bin`
    _tooltipShare.textContent = `${share.toFixed(1)}% of the visible distribution`
    positionTooltip(index, point)
}

function updateTooltipVisibility() {
    const activeIndex = getActiveBinIndex()
    if (activeIndex < 0) {
        hideTooltip()
        return
    }
    showTooltipForBin(activeIndex)
}

function clearTouchFocus() {
    _touchFocusedBinIndex = -1
    _activeTouchPointerId = null
    updateTooltipVisibility()
}

function getCanvasPointerPosition(event) {
    const rect = _canvas.getBoundingClientRect()
    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
    }
}

function getBinIndexAtPoint(x, y) {
    if (!_plotBounds) return -1
    if (x < _plotBounds.left || x > _plotBounds.right || y < _plotBounds.top || y > _plotBounds.bottom) return -1

    return _binHitAreas.findIndex((area) => (
        x >= area.x &&
        x <= area.x + area.width &&
        y >= area.hitTop &&
        y <= area.hitBottom
    ))
}

function getCanvasSize() {
    if (!_canvasShell) return { width: 640, height: 360 }
    return {
        width: Math.max(320, Math.floor(_canvasShell.clientWidth)),
        height: Math.max(240, Math.floor(_canvasShell.clientHeight)),
    }
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
    const rr = Math.min(radius, width / 2, height / 2)
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.arcTo(x + width, y, x + width, y + height, rr)
    ctx.arcTo(x + width, y + height, x, y + height, rr)
    ctx.arcTo(x, y + height, x, y, rr)
    ctx.arcTo(x, y, x + width, y, rr)
    ctx.closePath()
}

function renderSummary() {
    if (!_state || !_sessionEl || !_summaryEl || !_footerEl) return

    const distribution = _state.distribution
    const clipped = distribution.clippedLow + distribution.clippedHigh
    const digits = getDisplayDigits(distribution.binWidth)

    _sessionEl.textContent = _state.sessionName
    _summaryEl.textContent = distribution.validTimes.length
        ? `Data range ${formatTime(distribution.min)}–${formatTime(distribution.max)}`
        : 'No valid solves in the current view'

    const footerParts = [
        `Visible range ${formatRangeLabel(distribution.domainMin, distribution.domainMax, digits)}`,
        `Bin width ${formatTimeSpan(distribution.binWidth)}`,
        `Showing ${distribution.visibleCount} of ${distribution.validTimes.length} valid solves`,
    ]

    if (clipped > 0) footerParts.push(`${clipped} clipped by range`)
    if (_state.dnfCount > 0) footerParts.push(`${_state.dnfCount} DNF${_state.dnfCount === 1 ? '' : 's'} excluded`)

    _footerEl.textContent = footerParts.join(' • ')
}

function drawChart() {
    if (!_canvas || !_state) return

    const { width, height } = getCanvasSize()
    const dpr = window.devicePixelRatio || 1
    _canvas.width = Math.max(1, Math.floor(width * dpr))
    _canvas.height = Math.max(1, Math.floor(height * dpr))
    _canvas.style.width = `${width}px`
    _canvas.style.height = `${height}px`

    const ctx = _canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    _binHitAreas = []
    _plotBounds = null

    const distribution = _state.distribution
    if (!distribution.validTimes.length) return

    const colors = getThemeColors()
    const padding = { top: 22, right: 24, bottom: 44, left: 52 }
    const plotWidth = Math.max(40, width - padding.left - padding.right)
    const plotHeight = Math.max(40, height - padding.top - padding.bottom)
    const plotLeft = padding.left
    const plotTop = padding.top
    const plotBottom = plotTop + plotHeight
    const plotRight = plotLeft + plotWidth

    _plotBounds = {
        left: plotLeft,
        right: plotRight,
        top: plotTop,
        bottom: plotBottom,
    }

    ctx.fillStyle = colors.surfaceStrong
    drawRoundedRect(ctx, plotLeft, plotTop, plotWidth, plotHeight, 16)
    ctx.fill()

    const maxCount = Math.max(1, distribution.maxCount)
    const yStep = niceIntegerStep(maxCount)
    ctx.font = '12px Inter, system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.strokeStyle = colors.grid
    ctx.fillStyle = colors.textMuted
    ctx.lineWidth = 1

    for (let value = 0; value <= maxCount; value += yStep) {
        const y = plotBottom - ((value / maxCount) * plotHeight)
        ctx.beginPath()
        ctx.moveTo(plotLeft, y)
        ctx.lineTo(plotRight, y)
        ctx.stroke()
        ctx.fillText(String(value), plotLeft - 8, y)
    }

    const stepWidth = plotWidth / Math.max(distribution.bins.length, 1)
    const barGap = stepWidth >= 6 ? 1 : 0
    const barWidth = Math.max(1, stepWidth - barGap)
    const activeIndex = getActiveBinIndex()

    distribution.bins.forEach((bin, index) => {
        const x = plotLeft + (index * stepWidth)
        const barHeight = bin.count <= 0 ? 0 : Math.max(2, (bin.count / maxCount) * plotHeight)
        const y = plotBottom - barHeight
        const ratio = distribution.bins.length <= 1 ? 0 : index / (distribution.bins.length - 1)
        const fillColor = interpolateColor(colors.green, colors.orange, ratio)

        _binHitAreas.push({
            index,
            x,
            y,
            width: Math.max(stepWidth, barWidth),
            height: barHeight,
            hitTop: plotTop,
            hitBottom: plotBottom,
        })

        if (barHeight > 0) {
            ctx.fillStyle = fillColor
            if (barWidth < 3 || barHeight < 3) {
                ctx.fillRect(x, y, barWidth, barHeight)
            } else {
                drawRoundedRect(ctx, x, y, barWidth, barHeight, Math.min(6, barWidth / 2))
                ctx.fill()
            }
        }

        if (index === activeIndex) {
            ctx.save()
            ctx.strokeStyle = colors.selectedStroke
            ctx.lineWidth = 2
            drawRoundedRect(ctx, x - 1, plotTop + 2, barWidth + 2, plotHeight - 2, 10)
            ctx.stroke()
            ctx.restore()
        }
    })

    const domainRange = Math.max(1, distribution.domainMax - distribution.domainMin)
    const medianInsideRange = distribution.median >= distribution.domainMin && distribution.median <= distribution.domainMax
    if (medianInsideRange) {
        const medianRatio = (distribution.median - distribution.domainMin) / domainRange
        const medianX = plotLeft + (medianRatio * plotWidth)

        ctx.save()
        ctx.setLineDash([6, 5])
        ctx.strokeStyle = colors.red
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(medianX, plotTop)
        ctx.lineTo(medianX, plotBottom)
        ctx.stroke()
        ctx.restore()

        ctx.font = '600 12px Inter, system-ui, sans-serif'
        ctx.textAlign = medianX > plotLeft + (plotWidth * 0.62) ? 'right' : 'left'
        ctx.textBaseline = 'top'
        ctx.fillStyle = colors.red
        ctx.fillText(
            `Median ${formatTime(distribution.median)}`,
            medianX > plotLeft + (plotWidth * 0.62) ? medianX - 8 : medianX + 8,
            plotTop + 8,
        )
    }

    const xStep = getXAxisStep(domainRange, plotWidth)
    const xDigits = getDisplayDigits(xStep)
    ctx.textBaseline = 'top'
    ctx.fillStyle = colors.text
    ctx.strokeStyle = colors.axis

    for (let value = distribution.domainMin; value <= distribution.domainMax + 1; value += xStep) {
        const ratio = (value - distribution.domainMin) / domainRange
        const x = plotLeft + (ratio * plotWidth)
        ctx.beginPath()
        ctx.moveTo(x, plotBottom)
        ctx.lineTo(x, plotBottom + 5)
        ctx.stroke()

        if (x <= plotLeft + 16) ctx.textAlign = 'left'
        else if (x >= plotRight - 16) ctx.textAlign = 'right'
        else ctx.textAlign = 'center'

        ctx.fillText(formatTime(value, xDigits), x, plotBottom + 8)
    }

    ctx.beginPath()
    ctx.moveTo(plotLeft, plotBottom)
    ctx.lineTo(plotRight, plotBottom)
    ctx.strokeStyle = colors.axis
    ctx.stroke()

    _canvas.setAttribute(
        'aria-label',
        `Distribution of ${distribution.visibleCount} visible solves. Median ${formatTime(distribution.median)}.`
    )

    updateTooltipVisibility()
}

function renderDistribution() {
    if (!_state || !_emptyState || !_canvasShell) return

    const hasData = _state.distribution.validTimes.length > 0
    _emptyState.hidden = hasData
    _canvasShell.hidden = !hasData

    if (!hasData) {
        _binHitAreas = []
        _plotBounds = null
        hideTooltip()
    }

    syncControls()
    renderSummary()
    drawChart()
}

function rebuildDistribution() {
    if (!_state) return
    const binWidth = getCurrentBinWidth().ms
    _state.distribution = buildDistribution(_state.validTimes, binWidth, _state.rangeValue)

    const activeIndex = getActiveBinIndex()
    if (activeIndex >= _state.distribution.bins.length) {
        _hoveredBinIndex = -1
        _touchFocusedBinIndex = -1
    }

    renderDistribution()
}

function setBinWidthIndex(nextIndex) {
    if (!_state) return
    const clamped = clamp(nextIndex, 0, BIN_WIDTH_OPTIONS.length - 1)
    if (clamped === _state.binWidthIndex) return
    _state.binWidthIndex = clamped
    rebuildDistribution()
}

function setRangeValue(nextValue) {
    if (!_state) return
    const resolved = getRangeOption(nextValue).value
    if (resolved === _state.rangeValue) return
    _state.rangeValue = resolved
    rebuildDistribution()
}

export function isTimeDistributionModalOpen() {
    return Boolean(_overlay?.classList.contains('active'))
}

export function closeTimeDistributionModal({ isPopState = false } = {}) {
    if (!_overlay?.classList.contains('active')) return
    if (!isPopState && window.history.state?.isBackIntercepted) {
        window.history.back()
    }
    _overlay.classList.remove('active')
    _hoveredBinIndex = -1
    _touchFocusedBinIndex = -1
    _activeTouchPointerId = null
    hideTooltip()
    if (document.activeElement) document.activeElement.blur()
}

export function showTimeDistributionModal(solves, { sessionName = 'Session' } = {}) {
    if (!_overlay) return

    const validTimes = solves
        .map((solve) => getEffectiveTime(solve))
        .filter((time) => Number.isFinite(time))

    const dnfCount = solves.length - validTimes.length
    const nextBinWidthIndex = _state?.binWidthIndex ?? getDefaultBinWidthIndex(validTimes)
    const nextRangeValue = _state?.rangeValue ?? DEFAULT_RANGE_VALUE

    _state = {
        sessionName,
        solveCount: solves.length,
        dnfCount,
        validTimes,
        binWidthIndex: nextBinWidthIndex,
        rangeValue: nextRangeValue,
        distribution: buildDistribution(validTimes, BIN_WIDTH_OPTIONS[nextBinWidthIndex].ms, nextRangeValue),
    }

    if (!window.history.state?.isBackIntercepted) {
        window.history.pushState({ isBackIntercepted: true }, '')
    }

    _overlay.classList.add('active')
    requestAnimationFrame(() => {
        renderDistribution()
        _copyImageButton?.focus()
    })
}

function bindCanvasInteractions() {
    if (!_canvas || !_canvasShell) return

    _canvas.addEventListener('mousemove', (event) => {
        if (shouldUseTouchInteraction()) return
        const point = getCanvasPointerPosition(event)
        const index = getBinIndexAtPoint(point.x, point.y)
        const changed = index !== _hoveredBinIndex
        _hoveredBinIndex = index
        if (changed) drawChart()
        if (index >= 0) showTooltipForBin(index, point)
        else updateTooltipVisibility()
    })

    _canvas.addEventListener('mouseleave', () => {
        const hadHover = _hoveredBinIndex >= 0
        _hoveredBinIndex = -1
        if (hadHover) drawChart()
        updateTooltipVisibility()
    })

    _canvas.addEventListener('pointerdown', (event) => {
        if (!shouldUseTouchInteraction(event.pointerType)) return
        if (!isTouchLikePointer(event.pointerType)) return
        if (event.button !== undefined && event.button !== 0) return

        const point = getCanvasPointerPosition(event)
        const index = getBinIndexAtPoint(point.x, point.y)
        if (index < 0) {
            const hadTouchFocus = _touchFocusedBinIndex >= 0
            clearTouchFocus()
            if (hadTouchFocus) drawChart()
            return
        }

        _activeTouchPointerId = event.pointerId
        _touchFocusedBinIndex = index
        _hoveredBinIndex = -1
        _canvas.setPointerCapture?.(event.pointerId)
        showTooltipForBin(index, point)
        drawChart()
        event.preventDefault()
    })

    _canvas.addEventListener('pointermove', (event) => {
        if (_activeTouchPointerId !== event.pointerId) return
        const point = getCanvasPointerPosition(event)
        const index = getBinIndexAtPoint(point.x, point.y)
        if (index >= 0) {
            _touchFocusedBinIndex = index
            showTooltipForBin(index, point)
            drawChart()
        }
        event.preventDefault()
    })

    const finishTouchInteraction = (event) => {
        if (_activeTouchPointerId !== event.pointerId) return
        _canvas.releasePointerCapture?.(event.pointerId)
        _activeTouchPointerId = null
    }

    _canvas.addEventListener('pointerup', finishTouchInteraction)
    _canvas.addEventListener('pointercancel', finishTouchInteraction)

    document.addEventListener('pointerdown', (event) => {
        if (_touchFocusedBinIndex < 0) return
        if (!(event.target instanceof Node)) return
        if (_canvasShell.contains(event.target)) return
        clearTouchFocus()
        drawChart()
    })
}

export function initTimeDistributionModal() {
    _overlay = document.getElementById('distribution-overlay')
    _copyImageButton = document.getElementById('distribution-copy-image')
    _copyTextButton = document.getElementById('distribution-copy-text')
    _closeButton = document.getElementById('distribution-close')
    _canvasShell = document.getElementById('distribution-chart-shell')
    _canvas = document.getElementById('distribution-canvas')
    _tooltip = document.getElementById('distribution-tooltip')
    _tooltipRange = document.getElementById('distribution-tooltip-range')
    _tooltipCount = document.getElementById('distribution-tooltip-count')
    _tooltipShare = document.getElementById('distribution-tooltip-share')
    _emptyState = document.getElementById('distribution-empty-state')
    _sessionEl = document.getElementById('distribution-session-name')
    _summaryEl = document.getElementById('distribution-summary-text')
    _footerEl = document.getElementById('distribution-footer')
    _rangeSelect = document.getElementById('distribution-range-select')
    _binWidthSelect = document.getElementById('distribution-bin-width-select')
    _binCoarserButton = document.getElementById('distribution-bin-coarser')
    _binFinerButton = document.getElementById('distribution-bin-finer')

    if (!_overlay) return

    _overlay.addEventListener('click', (event) => {
        if (event.target === _overlay) closeTimeDistributionModal()
    })

    _closeButton?.addEventListener('click', () => {
        closeTimeDistributionModal()
    })

    _copyImageButton?.addEventListener('click', () => {
        void copyChartImage(_copyImageButton)
    })

    _copyTextButton?.addEventListener('click', () => {
        void copyDistributionText(_copyTextButton)
    })

    _rangeSelect?.addEventListener('change', (event) => {
        setRangeValue(String(event.target.value || DEFAULT_RANGE_VALUE))
    })

    _binWidthSelect?.addEventListener('change', (event) => {
        const nextIndex = Number.parseInt(event.target.value, 10)
        setBinWidthIndex(Number.isFinite(nextIndex) ? nextIndex : 5)
    })

    _binCoarserButton?.addEventListener('click', () => {
        setBinWidthIndex((_state?.binWidthIndex ?? 5) - 1)
    })

    _binFinerButton?.addEventListener('click', () => {
        setBinWidthIndex((_state?.binWidthIndex ?? 5) + 1)
    })

    bindCanvasInteractions()

    if (!_escapeHandlerBound) {
        document.addEventListener('keydown', (event) => {
            if (event.code !== 'Escape') return
            if (!isTimeDistributionModalOpen()) return
            if (document.getElementById('confirm-overlay')?.classList.contains('active')) return
            event.preventDefault()
            event.stopImmediatePropagation()
            closeTimeDistributionModal()
        })
        _escapeHandlerBound = true
    }

    if (_canvasShell && typeof ResizeObserver !== 'undefined') {
        _resizeObserver?.disconnect?.()
        _resizeObserver = new ResizeObserver(() => {
            if (isTimeDistributionModalOpen()) drawChart()
        })
        _resizeObserver.observe(_canvasShell)
    }
}
