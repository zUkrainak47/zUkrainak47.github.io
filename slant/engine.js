/* ═══════════════════════════════════════════════════
   Slant Editor – Infinite Canvas Engine  v3
   Layers, click-click arrows, hover previews,
   customisable hotkeys, canvas browser with thumbnails
   ═══════════════════════════════════════════════════ */
(() => {
  "use strict";

  // ═══ CONSTANTS ═══════════════════════════════════
  const CELL = 40;
  const MIN_ZOOM = 0.15, MAX_ZOOM = 5, MAX_UNDO = 200;
  const ARROW_X = 0.75, ARROW_Y = 0.5; // anchor within cell

  const STORE_MANIFEST = "slant-manifest";
  const STORE_PREFIX = "slant-data-";
  const STORE_THEME = "slant-theme";
  const STORE_HOTKEYS = "slant-hotkeys";
  const STORE_NUM_STYLE = "slant-num-style";

  // Slope values for each number clue (index = clue value)
  const NUM_SLOPES = [null, 2, 0.5, -0.5, -2]; // 0=filled dot, 1..4=slope

  const HOTKEY_ACTIONS = [
    { id: "select", label: "Select / Pan" },
    { id: "diagonal", label: "Diagonal (cycle)" },
    { id: "diagFwd", label: "Diagonal \\" },
    { id: "diagBwd", label: "Diagonal /" },
    { id: "flipDiag", label: "Flip hovered diagonal" },
    { id: "number", label: "Number" },
    { id: "arrow", label: "Arrow" },
    { id: "highlight", label: "Highlight" },
    { id: "line", label: "Line" },
  ];
  const DEFAULT_HOTKEYS = { select: "v", diagonal: "d", diagFwd: "q", diagBwd: "e", flipDiag: "f", number: "n", arrow: "a", highlight: "h", line: "l" };

  const EYE_OPEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const EYE_SHUT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

  // ═══ DOM ═════════════════════════════════════════
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const $ = id => document.getElementById(id);

  // ═══ STATE ═══════════════════════════════════════
  let W, H, dpr = window.devicePixelRatio || 1;
  let camX = 0, camY = 0, zoom = 1;
  let activeTool = "select";
  let activeNumber = 0;
  let numberStyle = localStorage.getItem(STORE_NUM_STYLE) || "circle"; // "circle" or "slope"
  let diagonalDir = null; // null=cycle, 1=\, -1=/
  let highlightColour = "#ff6b6b40";
  let arrowColour = "#ff6b6b";
  let lineColour = "#ff6b6b";
  function themeArrowColor() { return document.documentElement.dataset.theme !== "light" ? "#e8e8e8" : "#2a2a3e"; }
  function themeLineColor() { return document.documentElement.dataset.theme !== "light" ? "#e8e8e8" : "#2a2a3e"; }
  function resolveLineColour(c) { return c === "theme" ? themeLineColor() : c; }

  // Layers
  let layers = [];
  let activeLayerIdx = 0;

  // Hover
  let hoverWX = 0, hoverWY = 0, hoverValid = false;

  // Arrow click‑click
  let arrowStart = null; // {cx,cy} or null

  // Drag / pan
  let dragging = false, dragStartX = 0, dragStartY = 0, camStartX = 0, camStartY = 0;
  let pointerDown = false, didDrag = false;
  let lastPaintedCell = null, lastPaintedHighlight = null, lastPaintedLine = null, lastPaintedLineCoord = null, lastPaintedNumber = null;
  let lineDragOrient = null, lineDragFixed = null; // lock orientation+axis during drag

  // Selection state variables
  let selection = null;
  let marqueeActive = false;
  let marqueeStart = null;
  let marqueeEnd = null;
  let draggingSelection = false;
  let dragSelectionStart = null;
  let dragSelectionOffset = { dcx: 0, dcy: 0 };


  // Canvas management
  let manifest = { activeId: null, canvases: [] };

  // Hotkeys
  let hotkeys = { ...DEFAULT_HOTKEYS };
  let recordingAction = null; // action id being recorded, or null
  let isolateLayer = false; // dim non-active layers

  // ═══ LAYER HELPERS ══════════════════════════════
  function createLayer(name) {
    return {
      id: genId(), name: name || `Layer ${layers.length + 1}`,
      visible: true, diagonals: new Map(), numbers: new Map(),
      highlights: new Map(), arrows: [], lines: new Map(),
    };
  }
  function L() { return layers[activeLayerIdx]; } // active layer shorthand

  // Global undo / redo stacks
  const undoStack = [], redoStack = [];

  // ═══ THEME ══════════════════════════════════════
  function tc() {
    const d = document.documentElement.dataset.theme !== "light";
    return {
      grid: d ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.07)",
      gridMajor: d ? "rgba(255,255,255,.13)" : "rgba(0,0,0,.13)",
      diag: d ? "#d4d4e0" : "#2a2a3e",
      num: d ? "#e8e8f0" : "#1a1a2e",
      dot: d ? "rgba(255,255,255,.25)" : "rgba(0,0,0,.18)",
      numBg: d ? "rgba(14,14,18,.85)" : "rgba(255,255,255,.92)",
      numBdr: d ? "rgba(255,255,255,.15)" : "rgba(0,0,0,.15)",
      bg: d ? "#0e0e12" : "#f0f0f4",
    };
  }

  function initTheme() { applyTheme(localStorage.getItem(STORE_THEME) || "light"); }
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    localStorage.setItem(STORE_THEME, t);
    $("icon-moon").style.display = t === "dark" ? "" : "none";
    $("icon-sun").style.display = t === "dark" ? "none" : "";
    // Update last arrow colour swatch based on theme
    const lastBtn = $("arrow-last-colour");
    if (lastBtn) {
      const col = t === "dark" ? "#e8e8e8" : "#2a2a3e";
      lastBtn.dataset.colour = "theme";
      lastBtn.style.setProperty("--swatch", col);
      lastBtn.title = t === "dark" ? "White" : "Black";
      // If active arrow colour is theme-dependent, keep it as sentinel
      if (arrowColour === "theme" || arrowColour === "#e8e8e8" || arrowColour === "#2a2a3e") arrowColour = "theme";
    }
    // Update line theme colour swatch
    const lineThemeBtn = $("line-theme-colour");
    if (lineThemeBtn) {
      const col = t === "dark" ? "#e8e8e8" : "#2a2a3e";
      lineThemeBtn.style.setProperty("--swatch", col);
      lineThemeBtn.title = t === "dark" ? "White" : "Black";
    }
    requestDraw();
  }
  function toggleTheme() { applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"); }

  // ═══ HELPERS ════════════════════════════════════
  function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function key(a, b) { return `${a},${b}`; }
  function lineKey(orient, a, b) { return `${orient},${a},${b}`; }
  function screenToWorld(sx, sy) { return { x: (sx - W / (2 * dpr)) / zoom + camX, y: (sy - H / (2 * dpr)) / zoom + camY }; }
  function worldToScreen(wx, wy) { return { x: (wx - camX) * zoom + W / (2 * dpr), y: (wy - camY) * zoom + H / (2 * dpr) }; }
  function nearestInt(wx, wy) { return { ix: Math.round(wx / CELL), iy: Math.round(wy / CELL) }; }
  function worldToCell(wx, wy) { return { cx: Math.floor(wx / CELL), cy: Math.floor(wy / CELL) }; }
  function arrowAnchor(cx, cy) { return { wx: cx * CELL + CELL * ARROW_X, wy: cy * CELL + CELL * ARROW_Y }; }
  function escHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  // Nearest cell edge to a world-space point. Returns { orient: "h"|"v", cx, cy }
  function nearestEdge(wx, wy) {
    const cx = Math.floor(wx / CELL), cy = Math.floor(wy / CELL);
    const fx = (wx / CELL) - cx, fy = (wy / CELL) - cy; // fractional pos within cell
    // Distances to each edge
    const dTop = fy, dBot = 1 - fy, dLeft = fx, dRight = 1 - fx;
    const min = Math.min(dTop, dBot, dLeft, dRight);
    if (min === dTop) return { orient: "h", cx, cy };       // top edge of this cell
    if (min === dBot) return { orient: "h", cx, cy: cy + 1 }; // bottom edge = top edge of cell below
    if (min === dLeft) return { orient: "v", cx, cy };      // left edge of this cell
    return { orient: "v", cx: cx + 1, cy };                  // right edge = left edge of cell to the right
  }

  // ═══ SELECTION HELPERS ══════════════════════════
  function themeAccentColor() { return document.documentElement.dataset.theme !== "light" ? "#7c6aef" : "#6554d4"; }

  function getSelectionBounds(sel) {
    if (!sel) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasItems = false;

    // Diagonals
    for (const k of sel.diagonals) {
      const [cx, cy] = k.split(",").map(Number);
      const x1 = cx * CELL, y1 = cy * CELL;
      const x2 = (cx + 1) * CELL, y2 = (cy + 1) * CELL;
      minX = Math.min(minX, x1); minY = Math.min(minY, y1);
      maxX = Math.max(maxX, x2); maxY = Math.max(maxY, y2);
      hasItems = true;
    }
    // Highlights
    for (const k of sel.highlights) {
      const [cx, cy] = k.split(",").map(Number);
      const x1 = cx * CELL, y1 = cy * CELL;
      const x2 = (cx + 1) * CELL, y2 = (cy + 1) * CELL;
      minX = Math.min(minX, x1); minY = Math.min(minY, y1);
      maxX = Math.max(maxX, x2); maxY = Math.max(maxY, y2);
      hasItems = true;
    }
    // Numbers
    for (const k of sel.numbers) {
      const [ix, iy] = k.split(",").map(Number);
      const x = ix * CELL, y = iy * CELL;
      minX = Math.min(minX, x - 10); minY = Math.min(minY, y - 10);
      maxX = Math.max(maxX, x + 10); maxY = Math.max(maxY, y + 10);
      hasItems = true;
    }
    // Lines
    for (const k of sel.lines) {
      const parts = k.split(",");
      const orient = parts[0], ex = +parts[1], ey = +parts[2];
      const x1 = ex * CELL, y1 = ey * CELL;
      const x2 = (ex + (orient === "h" ? 1 : 0)) * CELL;
      const y2 = (ey + (orient === "v" ? 1 : 0)) * CELL;
      minX = Math.min(minX, x1); minY = Math.min(minY, y1);
      maxX = Math.max(maxX, x2); maxY = Math.max(maxY, y2);
      hasItems = true;
    }
    // Arrows
    for (const a of sel.arrows) {
      const s = arrowAnchor(a.cx1, a.cy1);
      const e = arrowAnchor(a.cx2, a.cy2);
      minX = Math.min(minX, s.wx, e.wx); minY = Math.min(minY, s.wy, e.wy);
      maxX = Math.max(maxX, s.wx, e.wx); maxY = Math.max(maxY, s.wy, e.wy);
      hasItems = true;
    }

    if (!hasItems) return null;
    return { minX, minY, maxX, maxY };
  }

  function cloneSelection(sel) {
    if (!sel) return null;
    return {
      diagonals: new Set(sel.diagonals),
      numbers: new Set(sel.numbers),
      highlights: new Set(sel.highlights),
      arrows: new Set(sel.arrows),
      lines: new Set(sel.lines)
    };
  }

  function snapshotLayerState(al) {
    const arrowClones = new Map();
    al.arrows.forEach(a => {
      arrowClones.set(a, { ...a });
    });
    return {
      diagonals: new Map(al.diagonals),
      numbers: new Map(al.numbers),
      highlights: new Map(al.highlights),
      arrows: arrowClones,
      lines: new Map(al.lines)
    };
  }

  function restoreLayerState(al, snapshot) {
    al.diagonals = new Map(snapshot.diagonals);
    al.numbers = new Map(snapshot.numbers);
    al.highlights = new Map(snapshot.highlights);
    al.lines = new Map(snapshot.lines);
    al.arrows = Array.from(snapshot.arrows.values());
  }

  function restoreLayerStateAndSelection(al, snapshot, selectionToRestore) {
    restoreLayerState(al, snapshot);
    if (selectionToRestore) {
      const newArrows = new Set();
      for (const a of selectionToRestore.arrows) {
        const clone = snapshot.arrows.get(a);
        if (clone) {
          newArrows.add(clone);
        }
      }
      selectionToRestore.arrows = newArrows;
    }
  }

  function clearSelection() {
    selection = null;
    const btn = $("selection-delete-btn");
    if (btn) btn.style.display = "none";
    requestDraw();
  }

  function updateDeleteButtonPosition() {
    const btn = $("selection-delete-btn");
    if (!btn) return;
    const bounds = getSelectionBounds(selection);
    if (!bounds || activeTool !== "select") {
      btn.style.display = "none";
      return;
    }

    let topCenterWX = (bounds.minX + bounds.maxX) / 2;
    let topCenterWY = bounds.minY;

    if (draggingSelection && dragSelectionOffset) {
      topCenterWX += dragSelectionOffset.dcx * CELL;
      topCenterWY += dragSelectionOffset.dcy * CELL;
    }

    const s = worldToScreen(topCenterWX, topCenterWY);

    // Clamp coordinates so delete button stays within viewport bounds
    const btnWidth = btn.offsetWidth || 120;
    const btnHeight = btn.offsetHeight || 38;
    const minPadding = 12;

    const left = Math.max(btnWidth / 2 + minPadding, Math.min(innerWidth - btnWidth / 2 - minPadding, s.x));
    const top = Math.max(btnHeight + minPadding + 44, Math.min(innerHeight - minPadding, s.y - 12));

    btn.style.display = "";
    btn.style.left = `${left}px`;
    btn.style.top = `${top}px`;
  }

  function updateSelectionFromMarquee() {
    if (!marqueeStart || !marqueeEnd) return;
    const minWX = Math.min(marqueeStart.x, marqueeEnd.x);
    const maxWX = Math.max(marqueeStart.x, marqueeEnd.x);
    const minWY = Math.min(marqueeStart.y, marqueeEnd.y);
    const maxWY = Math.max(marqueeStart.y, marqueeEnd.y);

    const al = L();
    if (!al) return;

    selection = {
      diagonals: new Set(),
      numbers: new Set(),
      highlights: new Set(),
      arrows: new Set(),
      lines: new Set()
    };

    function overlaps(itemMinX, itemMinY, itemMaxX, itemMaxY) {
      return !(itemMaxX < minWX || itemMinX > maxWX || itemMaxY < minWY || itemMinY > maxWY);
    }

    // Diagonals
    for (const [k, dir] of al.diagonals) {
      const [cx, cy] = k.split(",").map(Number);
      if (overlaps(cx * CELL, cy * CELL, (cx + 1) * CELL, (cy + 1) * CELL)) {
        selection.diagonals.add(k);
      }
    }

    // Highlights
    for (const [k, col] of al.highlights) {
      const [cx, cy] = k.split(",").map(Number);
      if (overlaps(cx * CELL, cy * CELL, (cx + 1) * CELL, (cy + 1) * CELL)) {
        selection.highlights.add(k);
      }
    }

    // Numbers (vertices)
    for (const [k, num] of al.numbers) {
      const [ix, iy] = k.split(",").map(Number);
      const x = ix * CELL, y = iy * CELL;
      if (x >= minWX && x <= maxWX && y >= minWY && y <= maxWY) {
        selection.numbers.add(k);
      }
    }

    // Lines
    for (const [k, col] of al.lines) {
      const parts = k.split(",");
      const orient = parts[0], ex = +parts[1], ey = +parts[2];
      const x1 = ex * CELL, y1 = ey * CELL;
      const x2 = (ex + (orient === "h" ? 1 : 0)) * CELL;
      const y2 = (ey + (orient === "v" ? 1 : 0)) * CELL;
      if (overlaps(x1, y1, x2, y2)) {
        selection.lines.add(k);
      }
    }

    // Arrows
    for (const a of al.arrows) {
      const s = arrowAnchor(a.cx1, a.cy1);
      const e = arrowAnchor(a.cx2, a.cy2);
      const minAX = Math.min(s.wx, e.wx);
      const maxAX = Math.max(s.wx, e.wx);
      const minAY = Math.min(s.wy, e.wy);
      const maxAY = Math.max(s.wy, e.wy);
      if (overlaps(minAX, minAY, maxAX, maxAY)) {
        selection.arrows.add(a);
      }
    }

    // Clear selection if empty
    if (selection.diagonals.size === 0 &&
      selection.numbers.size === 0 &&
      selection.highlights.size === 0 &&
      selection.arrows.size === 0 &&
      selection.lines.size === 0) {
      selection = null;
    }
  }

  function moveSelection(dcx, dcy) {
    if (!selection || (dcx === 0 && dcy === 0)) return;
    const al = L();
    if (!al) return;

    const beforeState = snapshotLayerState(al);
    const beforeSelection = cloneSelection(selection);

    // Extract moved elements
    const movedDiagonals = [];
    for (const k of selection.diagonals) {
      if (al.diagonals.has(k)) {
        movedDiagonals.push({ key: k, val: al.diagonals.get(k) });
        al.diagonals.delete(k);
      }
    }
    const movedNumbers = [];
    for (const k of selection.numbers) {
      if (al.numbers.has(k)) {
        movedNumbers.push({ key: k, val: al.numbers.get(k) });
        al.numbers.delete(k);
      }
    }
    const movedHighlights = [];
    for (const k of selection.highlights) {
      if (al.highlights.has(k)) {
        movedHighlights.push({ key: k, val: al.highlights.get(k) });
        al.highlights.delete(k);
      }
    }
    const movedLines = [];
    for (const k of selection.lines) {
      if (al.lines.has(k)) {
        movedLines.push({ key: k, val: al.lines.get(k) });
        al.lines.delete(k);
      }
    }
    const movedArrows = [];
    for (const a of selection.arrows) {
      const idx = al.arrows.indexOf(a);
      if (idx >= 0) {
        movedArrows.push(a);
        al.arrows.splice(idx, 1);
      }
    }

    // Re-insert at new locations
    const afterSelection = {
      diagonals: new Set(),
      numbers: new Set(),
      highlights: new Set(),
      arrows: new Set(),
      lines: new Set()
    };

    for (const item of movedDiagonals) {
      const [cx, cy] = item.key.split(",").map(Number);
      const newK = key(cx + dcx, cy + dcy);
      al.diagonals.set(newK, item.val);
      afterSelection.diagonals.add(newK);
    }
    for (const item of movedNumbers) {
      const [ix, iy] = item.key.split(",").map(Number);
      const newK = key(ix + dcx, iy + dcy);
      al.numbers.set(newK, item.val);
      afterSelection.numbers.add(newK);
    }
    for (const item of movedHighlights) {
      const [cx, cy] = item.key.split(",").map(Number);
      const newK = key(cx + dcx, cy + dcy);
      al.highlights.set(newK, item.val);
      afterSelection.highlights.add(newK);
    }
    for (const item of movedLines) {
      const parts = item.key.split(",");
      const orient = parts[0], ex = +parts[1], ey = +parts[2];
      const newK = lineKey(orient, ex + dcx, ey + dcy);
      al.lines.set(newK, item.val);
      afterSelection.lines.add(newK);
    }
    for (const a of movedArrows) {
      a.cx1 += dcx; a.cy1 += dcy;
      a.cx2 += dcx; a.cy2 += dcy;
      al.arrows.push(a);
      afterSelection.arrows.add(a);
    }

    selection = afterSelection;
    const afterState = snapshotLayerState(al);
    const afterSelectionClone = cloneSelection(selection);

    pushUndo({
      undo: () => {
        restoreLayerStateAndSelection(al, beforeState, beforeSelection);
        selection = cloneSelection(beforeSelection);
        requestDraw();
      },
      redo: () => {
        restoreLayerStateAndSelection(al, afterState, afterSelectionClone);
        selection = cloneSelection(afterSelectionClone);
        requestDraw();
      }
    });

    scheduleSave();
    requestDraw();
  }

  function deleteSelection() {
    if (!selection) return;
    const al = L();
    if (!al) return;

    const beforeState = snapshotLayerState(al);
    const beforeSelection = cloneSelection(selection);

    // Delete elements
    for (const k of selection.diagonals) al.diagonals.delete(k);
    for (const k of selection.numbers) al.numbers.delete(k);
    for (const k of selection.highlights) al.highlights.delete(k);
    for (const k of selection.lines) al.lines.delete(k);
    for (const a of selection.arrows) {
      const idx = al.arrows.indexOf(a);
      if (idx >= 0) al.arrows.splice(idx, 1);
    }

    const afterState = snapshotLayerState(al);
    const count = selection.diagonals.size + selection.numbers.size + selection.highlights.size + selection.lines.size + selection.arrows.size;

    pushUndo({
      undo: () => {
        restoreLayerStateAndSelection(al, beforeState, beforeSelection);
        selection = cloneSelection(beforeSelection);
        requestDraw();
      },
      redo: () => {
        restoreLayerState(al, afterState);
        clearSelection();
        requestDraw();
      }
    });

    clearSelection();
    toast(`Deleted ${count} items`);
    scheduleSave();
    requestDraw();
  }


  // ═══ UNDO / REDO (global) ══════════════════════
  function pushUndo(action) {
    undoStack.push(action);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    scheduleSave();
  }
  function undo() { const a = undoStack.pop(); if (!a) return; a.undo(); redoStack.push(a); scheduleSave(); requestDraw(); populateLayers(); }
  function redo() { const a = redoStack.pop(); if (!a) return; a.redo(); undoStack.push(a); scheduleSave(); requestDraw(); populateLayers(); }

  function ptSegDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }


  // ═══ TOAST ══════════════════════════════════════
  let toastTimer = 0;
  function toast(m) { const e = $("toast"); e.textContent = m; e.classList.remove("hidden"); clearTimeout(toastTimer); toastTimer = setTimeout(() => e.classList.add("hidden"), 2000); }

  // ═══ RESIZE ═════════════════════════════════════
  function resize() { dpr = window.devicePixelRatio || 1; W = canvas.width = innerWidth * dpr; H = canvas.height = innerHeight * dpr; canvas.style.width = innerWidth + "px"; canvas.style.height = innerHeight + "px"; requestDraw(); }

  // ═══ CANVAS / PROJECT MANAGEMENT ════════════════
  function loadManifest() {
    try { const r = localStorage.getItem(STORE_MANIFEST); if (r) manifest = JSON.parse(r); } catch { }
    if (!manifest.canvases || !manifest.canvases.length) {
      const id = genId(); manifest = { activeId: id, canvases: [{ id, name: "Canvas 1" }] };
    }
    if (!manifest.activeId) manifest.activeId = manifest.canvases[0].id;
    saveManifest();
  }
  function saveManifest() { localStorage.setItem(STORE_MANIFEST, JSON.stringify(manifest)); }

  function saveActiveCanvas() {
    const id = manifest.activeId; if (!id) return;
    const data = {
      version: 3, camera: { x: camX, y: camY, zoom },
      layers: layers.map(l => ({
        id: l.id, name: l.name, visible: l.visible,
        diagonals: [...l.diagonals.entries()], numbers: [...l.numbers.entries()],
        highlights: [...l.highlights.entries()], arrows: l.arrows.slice(),
        lines: [...l.lines.entries()],
      })),
      activeLayerIdx,
    };
    localStorage.setItem(STORE_PREFIX + id, JSON.stringify(data));
  }

  function loadCanvas(id) {
    layers = []; activeLayerIdx = 0; camX = 0; camY = 0; zoom = 1; arrowStart = null;
    undoStack.length = 0; redoStack.length = 0;
    try {
      const raw = localStorage.getItem(STORE_PREFIX + id);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.camera) { camX = d.camera.x || 0; camY = d.camera.y || 0; zoom = d.camera.zoom || 1; }
        if (d.layers) {
          layers = d.layers.map(ld => {
            const l = createLayer(ld.name); l.id = ld.id; l.visible = ld.visible !== false;
            if (ld.diagonals) for (const [k, v] of ld.diagonals) l.diagonals.set(k, v);
            if (ld.numbers) for (const [k, v] of ld.numbers) l.numbers.set(k, v);
            if (ld.highlights) for (const [k, v] of ld.highlights) l.highlights.set(k, v);
            if (ld.arrows) l.arrows.push(...ld.arrows);
            if (ld.lines) for (const [k, v] of ld.lines) l.lines.set(k, v);
            return l;
          });
          activeLayerIdx = d.activeLayerIdx || 0;
        } else {
          // v1 migration
          const l = createLayer("Layer 1");
          if (d.diagonals) for (const [k, v] of d.diagonals) l.diagonals.set(k, v);
          if (d.numbers) for (const [k, v] of d.numbers) l.numbers.set(k, v);
          if (d.highlights) for (const [k, v] of d.highlights) l.highlights.set(k, v);
          if (d.arrows) l.arrows.push(...d.arrows.map(a => ({ cx1: a.x1, cy1: a.y1, cx2: a.x2, cy2: a.y2, colour: a.colour })));
          layers = [l];
        }
      }
    } catch { }
    if (!layers.length) layers = [createLayer("Layer 1")];
    if (activeLayerIdx >= layers.length) activeLayerIdx = 0;
    manifest.activeId = id; saveManifest();
    $("zoom-display").textContent = Math.round(zoom * 100) + "%";
    updateCanvasNameDisplay();
    populateLayers();
    requestDraw();
  }

  function switchCanvas(id) { if (id === manifest.activeId) return; saveActiveCanvas(); updateThumbnail(); loadCanvas(id); }
  function createCanvas(name) {
    saveActiveCanvas(); updateThumbnail();
    const id = genId(), n = name || `Canvas ${manifest.canvases.length + 1}`;
    manifest.canvases.push({ id, name: n }); manifest.activeId = id; saveManifest();
    loadCanvas(id); toast(`Created "${n}"`);
  }
  function deleteCanvas(id) {
    if (manifest.canvases.length <= 1) { toast("Can't delete the last canvas"); return; }
    const idx = manifest.canvases.findIndex(c => c.id === id); if (idx < 0) return;
    const name = manifest.canvases[idx].name; manifest.canvases.splice(idx, 1);
    localStorage.removeItem(STORE_PREFIX + id);
    if (manifest.activeId === id) { manifest.activeId = manifest.canvases[0].id; saveManifest(); loadCanvas(manifest.activeId); }
    else { saveManifest(); }
    toast(`Deleted "${name}"`);
  }
  function renameCanvas(id, newName) {
    const e = manifest.canvases.find(c => c.id === id); if (e) { e.name = newName; saveManifest(); updateCanvasNameDisplay(); }
  }
  function updateCanvasNameDisplay() {
    const e = manifest.canvases.find(c => c.id === manifest.activeId);
    $("canvas-name-display").textContent = e ? e.name : "Canvas";
  }

  function captureThumbnail() {
    // Use the current viewport (what you see on screen) as the thumbnail
    const cw = W / dpr, ch = H / dpr;
    const minX = camX - cw / (2 * zoom), minY = camY - ch / (2 * zoom);
    const vw = cw / zoom, vh = ch / zoom, c = tc();
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${vw} ${vh}" preserveAspectRatio="xMidYMid meet">`];
    parts.push(`<rect x="${minX}" y="${minY}" width="${vw}" height="${vh}" fill="${c.bg}"/>`);
    // Highlights
    for (const l of layers) { if (!l.visible) continue; for (const [k, col] of l.highlights) { const [cx, cy] = k.split(",").map(Number); parts.push(`<rect x="${cx * CELL}" y="${cy * CELL}" width="${CELL}" height="${CELL}" fill="${col}"/>`); } }
    // Lines
    for (const l of layers) { if (!l.visible) continue; for (const [k, col] of l.lines) { const parts2 = k.split(","); const orient = parts2[0], ex = +parts2[1], ey = +parts2[2]; const rc = col === "theme" ? c.diag : col; if (orient === "h") { parts.push(`<line x1="${ex * CELL}" y1="${ey * CELL}" x2="${(ex + 1) * CELL}" y2="${ey * CELL}" stroke="${rc}" stroke-width="2.5" stroke-linecap="round"/>`); } else { parts.push(`<line x1="${ex * CELL}" y1="${ey * CELL}" x2="${ex * CELL}" y2="${(ey + 1) * CELL}" stroke="${rc}" stroke-width="2.5" stroke-linecap="round"/>`); } } }
    // Diagonals
    for (const l of layers) { if (!l.visible) continue; for (const [k, dir] of l.diagonals) { const [cx, cy] = k.split(",").map(Number); const x1 = dir === 1 ? cx * CELL : (cx + 1) * CELL, y1 = cy * CELL, x2 = dir === 1 ? (cx + 1) * CELL : cx * CELL, y2 = (cy + 1) * CELL; parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c.diag}" stroke-width="2.5" stroke-linecap="round"/>`); } }
    // Arrows
    const hl = 10;
    for (const l of layers) { if (!l.visible) continue; for (const a of l.arrows) { const s = arrowAnchor(a.cx1, a.cy1), e = arrowAnchor(a.cx2, a.cy2); const col = resolveArrowColour(a.colour); const ang = Math.atan2(e.wy - s.wy, e.wx - s.wx); const lex = e.wx - hl * .5 * Math.cos(ang), ley = e.wy - hl * .5 * Math.sin(ang); parts.push(`<line x1="${s.wx}" y1="${s.wy}" x2="${lex}" y2="${ley}" stroke="${col}" stroke-width="2.5" stroke-linecap="round"/>`); const p1x = e.wx - hl * Math.cos(ang - Math.PI / 6), p1y = e.wy - hl * Math.sin(ang - Math.PI / 6), p2x = e.wx - hl * Math.cos(ang + Math.PI / 6), p2y = e.wy - hl * Math.sin(ang + Math.PI / 6); parts.push(`<polygon points="${e.wx},${e.wy} ${p1x},${p1y} ${p2x},${p2y}" fill="${col}"/>`); } }
    // Numbers
    for (const l of layers) { if (!l.visible) continue; for (const [k, num] of l.numbers) { const [ix, iy] = k.split(",").map(Number); const x = ix * CELL, y = iy * CELL; if (numberStyle === "slope") { if (num === 0) { parts.push(`<circle cx="${x}" cy="${y}" r="${CELL * 0.1}" fill="${c.diag}"/>`); } else { const slope = NUM_SLOPES[num]; if (slope !== undefined) { let dx, dy; if (Math.abs(slope) <= 1) { dx = CELL / 2; dy = slope * dx; } else { dy = (CELL / 2) * Math.sign(slope); dx = Math.abs(dy / slope); } parts.push(`<line x1="${x - dx}" y1="${y + dy}" x2="${x + dx}" y2="${y - dy}" stroke="${c.diag}" stroke-width="2.5" stroke-linecap="round"/>`); } } } else { const r = 10; parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${c.numBg}" stroke="${c.numBdr}" stroke-width="1"/>`); parts.push(`<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" fill="${c.num}" font-family="Inter,sans-serif" font-weight="600" font-size="14">${num}</text>`); } } }
    parts.push(`</svg>`);
    return parts.join("");
  }
  function updateThumbnail() {
    const e = manifest.canvases.find(c => c.id === manifest.activeId);
    if (e) { e.thumbnail = captureThumbnail(); saveManifest(); }
  }

  let saveTimer = 0;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveActiveCanvas, 300); }

  // ═══ HOTKEYS ════════════════════════════════════
  function loadHotkeys() { try { const r = localStorage.getItem(STORE_HOTKEYS); if (r) hotkeys = { ...DEFAULT_HOTKEYS, ...JSON.parse(r) }; } catch { } }
  function saveHotkeys() { localStorage.setItem(STORE_HOTKEYS, JSON.stringify(hotkeys)); }
  function getHotkeyCounts() {
    const counts = {};
    for (const act of HOTKEY_ACTIONS) {
      const val = (hotkeys[act.id] || "").toLowerCase();
      if (val) counts[val] = (counts[val] || 0) + 1;
    }
    return counts;
  }
  function updateToolTitles() {
    const counts = getHotkeyCounts();
    document.querySelectorAll(".tool-btn[data-tool]").forEach(b => {
      const t = b.dataset.tool, hk = hotkeys[t];
      b.title = `${b.querySelector("span").textContent} (${hk ? hk.toUpperCase() : "—"})`;
      let badge = b.querySelector(".tool-hotkey");
      if (!badge) { badge = document.createElement("span"); badge.className = "tool-hotkey"; b.appendChild(badge); }
      badge.textContent = hk ? hk.toUpperCase() : "";
      const isDuplicate = hk && counts[hk.toLowerCase()] > 1;
      badge.classList.toggle("duplicate", !!isDuplicate);
    });
  }



  function updateToolNamesForShift(isShift) {
    const names = {
      select: isShift ? "Select" : "Pan",
      diagonal: isShift ? "Erase Diagonal" : "Diagonal",
      number: isShift ? "Erase Number" : "Number",
      highlight: isShift ? "Erase Highlight" : "Highlight",
      arrow: isShift ? "Erase Arrow" : "Arrow",
      line: isShift ? "Erase Line" : "Line"
    };
    for (const [tool, name] of Object.entries(names)) {
      const btnSpan = document.querySelector(`.tool-btn[data-tool="${tool}"] span`);
      if (btnSpan) {
        btnSpan.textContent = name;
      }
    }
  }


  // ═══ LAYER UI ═══════════════════════════════════
  function populateLayers() {
    const list = $("layer-list"); list.innerHTML = "";
    // Show top layer first (reverse order)
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i], idx = i;
      const div = document.createElement("div");
      div.className = "layer-item" + (idx === activeLayerIdx ? " active" : "") + (layer.visible ? "" : " hidden-layer");

      const vis = document.createElement("button");
      vis.className = "layer-vis"; vis.innerHTML = layer.visible ? EYE_OPEN : EYE_SHUT;
      vis.title = layer.visible ? "Hide" : "Show";
      vis.addEventListener("click", (e) => { e.stopPropagation(); layer.visible = !layer.visible; scheduleSave(); populateLayers(); requestDraw(); });

      const nm = document.createElement("span");
      nm.className = "layer-name"; nm.textContent = layer.name;
      nm.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        showRenameDialog("Layer name", layer.name, (n) => { layer.name = n; scheduleSave(); populateLayers(); });
      });

      div.appendChild(vis); div.appendChild(nm);
      div.addEventListener("click", () => {
        if (activeLayerIdx !== idx) {
          clearSelection();
          activeLayerIdx = idx;
          populateLayers();
          requestDraw();
        }
      });


      list.appendChild(div);
    }
  }

  // ═══ DRAWING ════════════════════════════════════
  let drawQueued = false;
  function requestDraw() { if (!drawQueued) { drawQueued = true; requestAnimationFrame(draw); } }

  function draw() {
    drawQueued = false;
    const c = tc(), cw = W / dpr, ch = H / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = c.bg; ctx.fillRect(0, 0, cw, ch);
    drawGrid(c, cw, ch);
    // Per‑layer rendering (bottom to top)
    for (let i = 0; i < layers.length; i++) { const l = layers[i]; if (!l.visible) continue; const dim = isolateLayer && i !== activeLayerIdx; if (dim) ctx.globalAlpha = .15; drawLayerHighlights(l, cw, ch); if (dim) ctx.globalAlpha = 1; }
    for (let i = 0; i < layers.length; i++) { const l = layers[i]; if (!l.visible) continue; const dim = isolateLayer && i !== activeLayerIdx; if (dim) ctx.globalAlpha = .15; drawLayerLines(c, l, cw, ch); if (dim) ctx.globalAlpha = 1; }
    for (let i = 0; i < layers.length; i++) { const l = layers[i]; if (!l.visible) continue; const dim = isolateLayer && i !== activeLayerIdx; if (dim) ctx.globalAlpha = .15; drawLayerDiagonals(c, l, cw, ch); if (dim) ctx.globalAlpha = 1; }
    for (let i = 0; i < layers.length; i++) { const l = layers[i]; if (!l.visible) continue; const dim = isolateLayer && i !== activeLayerIdx; if (dim) ctx.globalAlpha = .15; drawLayerArrows(l, cw, ch); if (dim) ctx.globalAlpha = 1; }
    for (let i = 0; i < layers.length; i++) { const l = layers[i]; if (!l.visible) continue; const dim = isolateLayer && i !== activeLayerIdx; if (dim) ctx.globalAlpha = .15; drawLayerNumbers(c, l, cw, ch); if (dim) ctx.globalAlpha = 1; }
    if (hoverValid) drawHoverPreview(c, cw, ch);

    // Draw selection highlights and bounding box
    drawSelection(c, cw, ch);

    // Draw marquee selection box
    drawMarquee(cw, ch);

    // Sync delete button position
    updateDeleteButtonPosition();
  }

  function drawGrid(c, cw, ch) {
    const tl = screenToWorld(0, 0), br = screenToWorld(cw, ch);
    const sc = Math.floor(tl.x / CELL) - 1, ec = Math.ceil(br.x / CELL) + 1;
    const sr = Math.floor(tl.y / CELL) - 1, er = Math.ceil(br.y / CELL) + 1;
    ctx.lineWidth = 1;
    for (let col = sc; col <= ec; col++) { const x = (col * CELL - camX) * zoom + cw / 2; ctx.strokeStyle = (col % 5 === 0) ? c.gridMajor : c.grid; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke(); }
    for (let row = sr; row <= er; row++) { const y = (row * CELL - camY) * zoom + ch / 2; ctx.strokeStyle = (row % 5 === 0) ? c.gridMajor : c.grid; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke(); }
  }

  function drawLayerHighlights(l, cw, ch) {
    for (const [k, col] of l.highlights) {
      const [cx, cy] = k.split(",").map(Number);
      let drawCx = cx;
      let drawCy = cy;
      if (activeTool === "select" && selection && selection.highlights.has(k) && draggingSelection) {
        drawCx += dragSelectionOffset.dcx;
        drawCy += dragSelectionOffset.dcy;
      }
      const sx = (drawCx * CELL - camX) * zoom + cw / 2, sy = (drawCy * CELL - camY) * zoom + ch / 2, sz = CELL * zoom;
      ctx.fillStyle = col; ctx.fillRect(sx, sy, sz, sz);
    }
  }

  function drawLayerLines(c, l, cw, ch) {
    ctx.lineCap = "round"; ctx.lineWidth = Math.max(2, 2.5 * Math.min(zoom, 2));
    for (const [k, col] of l.lines) {
      const parts = k.split(","); const orient = parts[0], ex = +parts[1], ey = +parts[2];
      let drawEx = ex, drawEy = ey;
      if (activeTool === "select" && selection && selection.lines.has(k) && draggingSelection) {
        drawEx += dragSelectionOffset.dcx;
        drawEy += dragSelectionOffset.dcy;
      }
      ctx.strokeStyle = resolveLineColour(col);
      const sz = CELL * zoom;
      if (orient === "h") {
        const sx = (drawEx * CELL - camX) * zoom + cw / 2, sy = (drawEy * CELL - camY) * zoom + ch / 2;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + sz, sy); ctx.stroke();
      } else {
        const sx = (drawEx * CELL - camX) * zoom + cw / 2, sy = (drawEy * CELL - camY) * zoom + ch / 2;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy + sz); ctx.stroke();
      }
    }
    ctx.lineCap = "butt";
  }

  function drawLayerDiagonals(c, l, cw, ch) {
    ctx.strokeStyle = c.diag; ctx.lineCap = "round"; ctx.lineWidth = Math.max(2, 2.5 * Math.min(zoom, 2));
    for (const [k, dir] of l.diagonals) {
      const [cx, cy] = k.split(",").map(Number);
      let drawCx = cx;
      let drawCy = cy;
      if (activeTool === "select" && selection && selection.diagonals.has(k) && draggingSelection) {
        drawCx += dragSelectionOffset.dcx;
        drawCy += dragSelectionOffset.dcy;
      }
      const sx = (drawCx * CELL - camX) * zoom + cw / 2, sy = (drawCy * CELL - camY) * zoom + ch / 2, sz = CELL * zoom;
      ctx.beginPath();
      if (dir === 1) {
        ctx.moveTo(sx, sy); ctx.lineTo(sx + sz, sy + sz);
      } else {
        ctx.moveTo(sx + sz, sy); ctx.lineTo(sx, sy + sz);
      }
      ctx.stroke();
    }
    ctx.lineCap = "butt";
  }

  function drawArrowShape(x1, y1, x2, y2, col, lw) {
    const hl = 10 * Math.min(zoom, 2), ang = Math.atan2(y2 - y1, x2 - x1);
    // Shorten line so it ends inside the arrowhead, preventing round cap from overshooting
    const lineEndX = x2 - hl * 0.5 * Math.cos(ang), lineEndY = y2 - hl * 0.5 * Math.sin(ang);
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(lineEndX, lineEndY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - hl * Math.cos(ang - Math.PI / 6), y2 - hl * Math.sin(ang - Math.PI / 6));
    ctx.lineTo(x2 - hl * Math.cos(ang + Math.PI / 6), y2 - hl * Math.sin(ang + Math.PI / 6));
    ctx.closePath(); ctx.fill(); ctx.lineCap = "butt";
  }

  function resolveArrowColour(c) { return c === "theme" ? themeArrowColor() : c; }

  function drawLayerArrows(l, cw, ch) {
    const lw = Math.max(2, 2.5 * Math.min(zoom, 2));
    for (const a of l.arrows) {
      let dcx = 0, dcy = 0;
      if (activeTool === "select" && selection && selection.arrows.has(a) && draggingSelection) {
        dcx = dragSelectionOffset.dcx;
        dcy = dragSelectionOffset.dcy;
      }
      const s = arrowAnchor(a.cx1 + dcx, a.cy1 + dcy), e = arrowAnchor(a.cx2 + dcx, a.cy2 + dcy);
      const ss = worldToScreen(s.wx, s.wy), se = worldToScreen(e.wx, e.wy);
      drawArrowShape(ss.x, ss.y, se.x, se.y, resolveArrowColour(a.colour), lw);
    }
  }

  function drawSlopeGlyph(ctx, sx, sy, num, c) {
    if (num === 0) {
      // Filled dot
      const dotR = CELL * zoom * 0.1;
      ctx.fillStyle = c.diag;
      ctx.beginPath(); ctx.arc(sx, sy, dotR, 0, Math.PI * 2); ctx.fill();
    } else {
      const slope = NUM_SLOPES[num];
      if (slope === undefined) return;
      let dx, dy;
      if (Math.abs(slope) <= 1) {
        dx = (CELL / 2) * zoom;
        dy = slope * dx;
      } else {
        dy = (CELL / 2) * zoom * Math.sign(slope);
        dx = Math.abs(dy / slope);
      }
      ctx.strokeStyle = c.diag;
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(2, 2.5 * Math.min(zoom, 2));
      ctx.beginPath();
      ctx.moveTo(sx - dx, sy + dy);
      ctx.lineTo(sx + dx, sy - dy);
      ctx.stroke();
      ctx.lineCap = "butt";
    }
  }

  function drawLayerNumbers(c, l, cw, ch) {
    const fs = Math.max(8, 14 * Math.min(zoom, 2));
    ctx.font = `600 ${fs}px 'Inter',sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const [k, num] of l.numbers) {
      const [ix, iy] = k.split(",").map(Number);
      let drawIx = ix;
      let drawIy = iy;
      if (activeTool === "select" && selection && selection.numbers.has(k) && draggingSelection) {
        drawIx += dragSelectionOffset.dcx;
        drawIy += dragSelectionOffset.dcy;
      }
      const sx = (drawIx * CELL - camX) * zoom + cw / 2, sy = (drawIy * CELL - camY) * zoom + ch / 2;
      if (numberStyle === "slope") {
        drawSlopeGlyph(ctx, sx, sy, num, c);
      } else {
        const r = fs * .7;
        ctx.fillStyle = c.numBg; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = c.numBdr; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = c.num; ctx.fillText(String(num), sx, sy + 1);
      }
    }
  }

  function drawSelection(c, cw, ch) {
    if (activeTool !== "select" || !selection) return;

    ctx.save();
    const accent = themeAccentColor();
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1.5, 2 * Math.min(zoom, 1.5));
    ctx.setLineDash([4, 4]);

    const dcx = draggingSelection ? dragSelectionOffset.dcx : 0;
    const dcy = draggingSelection ? dragSelectionOffset.dcy : 0;

    // Collect cell boundaries to draw each unique segment exactly once
    const cellEdgesH = new Set();
    const cellEdgesV = new Set();

    function addCellEdges(cx, cy) {
      cellEdgesH.add(`${cx},${cy}`);     // top edge
      cellEdgesH.add(`${cx},${cy + 1}`); // bottom edge
      cellEdgesV.add(`${cx},${cy}`);     // left edge
      cellEdgesV.add(`${cx + 1},${cy}`); // right edge
    }

    for (const k of selection.diagonals) {
      const [cx, cy] = k.split(",").map(Number);
      addCellEdges(cx + dcx, cy + dcy);
    }
    for (const k of selection.highlights) {
      const [cx, cy] = k.split(",").map(Number);
      addCellEdges(cx + dcx, cy + dcy);
    }

    // Draw horizontal and vertical edges in a single path to maximize rendering speed
    ctx.beginPath();
    for (const edge of cellEdgesH) {
      const [cx, cy] = edge.split(",").map(Number);
      const sx = (cx * CELL - camX) * zoom + cw / 2;
      const sy = (cy * CELL - camY) * zoom + ch / 2;
      const sz = CELL * zoom;
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + sz, sy);
    }
    for (const edge of cellEdgesV) {
      const [cx, cy] = edge.split(",").map(Number);
      const sx = (cx * CELL - camX) * zoom + cw / 2;
      const sy = (cy * CELL - camY) * zoom + ch / 2;
      const sz = CELL * zoom;
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, sy + sz);
    }
    ctx.stroke();




    // Numbers
    for (const k of selection.numbers) {
      const [ix, iy] = k.split(",").map(Number);
      const sx = ((ix + dcx) * CELL - camX) * zoom + cw / 2;
      const sy = ((iy + dcy) * CELL - camY) * zoom + ch / 2;
      const r = (14 * Math.min(zoom, 2)) + 4;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Lines
    for (const k of selection.lines) {
      const parts = k.split(",");
      const orient = parts[0], ex = +parts[1], ey = +parts[2];
      const sx = ((ex + dcx) * CELL - camX) * zoom + cw / 2;
      const sy = ((ey + dcy) * CELL - camY) * zoom + ch / 2;
      const sz = CELL * zoom;
      if (orient === "h") {
        ctx.strokeRect(sx - 2, sy - 4, sz + 4, 8);
      } else {
        ctx.strokeRect(sx - 4, sy - 2, 8, sz + 4);
      }
    }

    // Arrows
    for (const a of selection.arrows) {
      const s = arrowAnchor(a.cx1 + dcx, a.cy1 + dcy);
      const e = arrowAnchor(a.cx2 + dcx, a.cy2 + dcy);
      const ss = worldToScreen(s.wx, s.wy);
      const se = worldToScreen(e.wx, e.wy);
      const minX = Math.min(ss.x, se.x) - 6;
      const maxX = Math.max(ss.x, se.x) + 6;
      const minY = Math.min(ss.y, se.y) - 6;
      const maxY = Math.max(ss.y, se.y) + 6;
      ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
    }

    // Outer boundary box for the whole selection
    const bounds = getSelectionBounds(selection);
    if (bounds) {
      const minS = worldToScreen(bounds.minX, bounds.minY);
      const maxS = worldToScreen(bounds.maxX, bounds.maxY);
      const sx = minS.x + dcx * CELL * zoom;
      const sy = minS.y + dcy * CELL * zoom;
      const sw = (maxS.x - minS.x);
      const sh = (maxS.y - minS.y);

      // Draw bounding box
      ctx.strokeStyle = accent + "66"; // 40% opacity
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(sx - 6, sy - 6, sw + 12, sh + 12);

      ctx.fillStyle = accent + "08"; // ~3% opacity
      ctx.fillRect(sx - 6, sy - 6, sw + 12, sh + 12);
    }

    ctx.restore();
  }

  function drawMarquee(cw, ch) {
    if (activeTool === "select" && marqueeActive && marqueeStart && marqueeEnd) {
      const sStart = worldToScreen(marqueeStart.x, marqueeStart.y);
      const sEnd = worldToScreen(marqueeEnd.x, marqueeEnd.y);
      ctx.save();
      const accent = themeAccentColor();
      ctx.strokeStyle = accent + "cc"; // 80% opacity
      ctx.lineWidth = 1.5;
      ctx.fillStyle = accent + "1a"; // 10% opacity
      ctx.beginPath();
      ctx.rect(sStart.x, sStart.y, sEnd.x - sStart.x, sEnd.y - sStart.y);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }


  // ── Hover preview ──
  function drawHoverPreview(c, cw, ch) {
    const al = L();
    if (!al || !al.visible) return;

    switch (activeTool) {
      case "diagonal": {
        const { cx, cy } = worldToCell(hoverWX, hoverWY);
        const k2 = key(cx, cy), cur = al.diagonals.get(k2);
        let dir;
        if (diagonalDir !== null) dir = cur === diagonalDir ? null : diagonalDir;
        else dir = cur === undefined ? 1 : cur === 1 ? -1 : null;
        if (dir === null) break;
        ctx.globalAlpha = .3; ctx.strokeStyle = c.diag; ctx.lineCap = "round"; ctx.lineWidth = Math.max(2, 2.5 * Math.min(zoom, 2));
        const sx = (cx * CELL - camX) * zoom + cw / 2, sy = (cy * CELL - camY) * zoom + ch / 2, sz = CELL * zoom;
        ctx.beginPath(); if (dir === 1) { ctx.moveTo(sx, sy); ctx.lineTo(sx + sz, sy + sz); } else { ctx.moveTo(sx + sz, sy); ctx.lineTo(sx, sy + sz); }
        ctx.stroke(); ctx.lineCap = "butt"; ctx.globalAlpha = 1;
        break;
      }
      case "number": {
        const { ix, iy } = nearestInt(hoverWX, hoverWY);
        const sx = (ix * CELL - camX) * zoom + cw / 2, sy = (iy * CELL - camY) * zoom + ch / 2;
        ctx.globalAlpha = .3;
        if (numberStyle === "slope") {
          drawSlopeGlyph(ctx, sx, sy, activeNumber, c);
        } else {
          const fs = Math.max(8, 14 * Math.min(zoom, 2)), r = fs * .7;
          ctx.fillStyle = c.numBg; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = c.numBdr; ctx.lineWidth = 1; ctx.stroke();
          ctx.font = `600 ${fs}px 'Inter',sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillStyle = c.num; ctx.fillText(String(activeNumber), sx, sy + 1);
        }
        ctx.globalAlpha = 1;
        break;
      }
      case "highlight": {
        const { cx, cy } = worldToCell(hoverWX, hoverWY);
        const sx = (cx * CELL - camX) * zoom + cw / 2, sy = (cy * CELL - camY) * zoom + ch / 2, sz = CELL * zoom;
        ctx.globalAlpha = .5; ctx.fillStyle = highlightColour; ctx.fillRect(sx, sy, sz, sz); ctx.globalAlpha = 1;
        break;
      }
      case "line": {
        const edge = nearestEdge(hoverWX, hoverWY);
        // During a drag, only preview edges on the locked axis
        if (pointerDown && lineDragOrient !== null) {
          if (edge.orient !== lineDragOrient) break;
          if (lineDragOrient === "h" && edge.cy !== lineDragFixed) break;
          if (lineDragOrient === "v" && edge.cx !== lineDragFixed) break;
        }
        const sz = CELL * zoom;
        ctx.globalAlpha = .4; ctx.strokeStyle = resolveLineColour(lineColour); ctx.lineCap = "round";
        ctx.lineWidth = Math.max(2, 2.5 * Math.min(zoom, 2));
        if (edge.orient === "h") {
          const sx = (edge.cx * CELL - camX) * zoom + cw / 2, sy = (edge.cy * CELL - camY) * zoom + ch / 2;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + sz, sy); ctx.stroke();
        } else {
          const sx = (edge.cx * CELL - camX) * zoom + cw / 2, sy = (edge.cy * CELL - camY) * zoom + ch / 2;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy + sz); ctx.stroke();
        }
        ctx.lineCap = "butt"; ctx.globalAlpha = 1;
        break;
      }
      case "arrow": {
        const { cx, cy } = worldToCell(hoverWX, hoverWY);
        if (arrowStart) {
          const s = arrowAnchor(arrowStart.cx, arrowStart.cy), e = arrowAnchor(cx, cy);
          const ss = worldToScreen(s.wx, s.wy), se = worldToScreen(e.wx, e.wy);
          const rc = resolveArrowColour(arrowColour);
          ctx.globalAlpha = .4;
          drawArrowShape(ss.x, ss.y, se.x, se.y, rc, Math.max(2, 2.5 * Math.min(zoom, 2)));
          ctx.globalAlpha = 1;
          // Start dot
          ctx.fillStyle = rc; ctx.globalAlpha = .7; ctx.beginPath(); ctx.arc(ss.x, ss.y, 4 * Math.min(zoom, 2), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        } else {
          const a = arrowAnchor(cx, cy), s = worldToScreen(a.wx, a.wy);
          const rc = resolveArrowColour(arrowColour);
          ctx.globalAlpha = .4; ctx.fillStyle = rc; ctx.beginPath(); ctx.arc(s.x, s.y, 5 * Math.min(zoom, 2), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        }
        break;
      }
    }
  }

  // ═══ POINTER EVENTS ═════════════════════════════
  function getP(e) { return { x: e.clientX, y: e.clientY }; }

  canvas.addEventListener("pointerdown", e => {
    const p = getP(e);
    const w = screenToWorld(p.x, p.y);
    dragStartX = p.x;
    dragStartY = p.y;

    if (e.button === 0 && activeTool === "select") {
      if (e.shiftKey) {
        marqueeActive = true;
        pointerDown = true;
        didDrag = false;
        marqueeStart = w;
        marqueeEnd = w;
        canvas.style.cursor = "crosshair";
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      const bounds = getSelectionBounds(selection);
      if (bounds && w.x >= bounds.minX && w.x <= bounds.maxX && w.y >= bounds.minY && w.y <= bounds.maxY) {
        draggingSelection = true;
        pointerDown = true;
        didDrag = false;
        dragSelectionStart = w;
        dragSelectionOffset = { dcx: 0, dcy: 0 };
        canvas.style.cursor = "move";
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }

    // Pan: middle button, or select tool, or alt+click
    if (e.button === 1 || (e.button === 0 && (e.altKey || activeTool === "select"))) {
      dragging = true; pointerDown = true; didDrag = false;
      camStartX = camX; camStartY = camY;
      canvas.style.cursor = "grabbing"; canvas.setPointerCapture(e.pointerId); return;
    }
    if (e.button === 0) {
      pointerDown = true; didDrag = false;
      if (activeTool === "line") {
        const w = screenToWorld(p.x, p.y), edge = nearestEdge(w.x, w.y);
        lineDragOrient = edge.orient;
        lineDragFixed = edge.orient === "h" ? edge.cy : edge.cx;
        lastPaintedLineCoord = edge.orient === "h" ? edge.cx : edge.cy;
        lastPaintedLine = null;
      }
    }
  });

  canvas.addEventListener("pointermove", e => {
    const p = getP(e), w = screenToWorld(p.x, p.y);
    hoverWX = w.x; hoverWY = w.y; hoverValid = true;
    const cell = worldToCell(w.x, w.y);
    $("coords-display").textContent = `${cell.cx}, ${cell.cy}`;

    if (activeTool === "select" && !pointerDown) {
      const bounds = getSelectionBounds(selection);
      if (bounds && w.x >= bounds.minX && w.x <= bounds.maxX && w.y >= bounds.minY && w.y <= bounds.maxY) {
        canvas.style.cursor = "move";
      } else {
        canvas.style.cursor = getCursor();
      }
    }

    if (marqueeActive) {
      if (Math.abs(p.x - dragStartX) + Math.abs(p.y - dragStartY) > 3) didDrag = true;
      marqueeEnd = w;
      updateSelectionFromMarquee();
      requestDraw();
      return;
    }

    if (draggingSelection) {
      if (Math.abs(p.x - dragStartX) + Math.abs(p.y - dragStartY) > 3) didDrag = true;
      const dcx = Math.round((w.x - dragSelectionStart.x) / CELL);
      const dcy = Math.round((w.y - dragSelectionStart.y) / CELL);
      dragSelectionOffset = { dcx, dcy };
      requestDraw();
      return;
    }

    if (dragging) {
      const dx = p.x - dragStartX, dy = p.y - dragStartY;
      if (Math.abs(dx) + Math.abs(dy) > 3) didDrag = true;
      camX = camStartX - dx / zoom; camY = camStartY - dy / zoom;
      requestDraw(); return;
    }

    if (pointerDown && activeTool === "diagonal") {
      const wasDragged = didDrag;
      if (Math.abs(p.x - dragStartX) + Math.abs(p.y - dragStartY) > 3) didDrag = true;
      if (didDrag) {
        if (!wasDragged) {
          const wStart = screenToWorld(dragStartX, dragStartY);
          handleDiagPaint(wStart, e.shiftKey);
        }
        handleDiagPaint(w, e.shiftKey);
      }
    }
    if (pointerDown && activeTool === "highlight") {
      const wasDragged = didDrag;
      if (Math.abs(p.x - dragStartX) + Math.abs(p.y - dragStartY) > 3) didDrag = true;
      if (didDrag) {
        if (!wasDragged) {
          const wStart = screenToWorld(dragStartX, dragStartY);
          handleHighPaint(wStart, e.shiftKey);
        }
        handleHighPaint(w, e.shiftKey);
      }
    }
    if (pointerDown && activeTool === "number") {
      const wasDragged = didDrag;
      if (Math.abs(p.x - dragStartX) + Math.abs(p.y - dragStartY) > 3) didDrag = true;
      if (didDrag) {
        if (!wasDragged) {
          const wStart = screenToWorld(dragStartX, dragStartY);
          handleNumberPaint(wStart, e.shiftKey);
        }
        handleNumberPaint(w, e.shiftKey);
      }
    }
    if (pointerDown && activeTool === "arrow") {
      const wasDragged = didDrag;
      if (Math.abs(p.x - dragStartX) + Math.abs(p.y - dragStartY) > 3) didDrag = true;
      if (didDrag && e.shiftKey) {
        if (!wasDragged) {
          const wStart = screenToWorld(dragStartX, dragStartY);
          removeArrowNear(wStart);
        }
        removeArrowNear(w);
        requestDraw();
      }
    }
    if (pointerDown && activeTool === "line") {
      didDrag = true;
      handleLinePaint(w, e.shiftKey);
    }

    requestDraw(); // for hover preview
  });

  canvas.addEventListener("pointerup", e => {
    const p = getP(e), w = screenToWorld(p.x, p.y);

    if (marqueeActive) {
      marqueeActive = false;
      pointerDown = false;
      canvas.style.cursor = getCursor();
      updateDeleteButtonPosition();
      requestDraw();
      return;
    }

    if (draggingSelection) {
      draggingSelection = false;
      pointerDown = false;
      canvas.style.cursor = getCursor();
      if (dragSelectionOffset.dcx !== 0 || dragSelectionOffset.dcy !== 0) {
        moveSelection(dragSelectionOffset.dcx, dragSelectionOffset.dcy);
      }
      dragSelectionOffset = { dcx: 0, dcy: 0 };
      updateDeleteButtonPosition();
      requestDraw();
      return;
    }

    if (dragging) {
      dragging = false; pointerDown = false; canvas.style.cursor = getCursor(); scheduleSave();
      if (!didDrag && activeTool === "select") handleClick(w, e);
      return;
    }

    if (e.button === 0 && !didDrag) handleClick(w, e);
    pointerDown = false; didDrag = false; lastPaintedCell = null; lastPaintedHighlight = null; lastPaintedLine = null; lastPaintedLineCoord = null; lastPaintedNumber = null; lineDragOrient = null; lineDragFixed = null;
  });


  canvas.addEventListener("mouseleave", () => { hoverValid = false; requestDraw(); });

  function handleDiagPaint(w, isErase) {
    const { cx, cy } = worldToCell(w.x, w.y), k2 = key(cx, cy); if (lastPaintedCell === k2) return; lastPaintedCell = k2;
    const al = L();
    if (isErase) {
      const cur = al.diagonals.get(k2);
      if (cur !== undefined) {
        al.diagonals.delete(k2);
        pushUndo({ redo: () => al.diagonals.delete(k2), undo: () => al.diagonals.set(k2, cur) });
        requestDraw();
      }
    } else {
      const dir = diagonalDir || 1;
      if (!al.diagonals.has(k2)) {
        al.diagonals.set(k2, dir);
        pushUndo({ redo: () => al.diagonals.set(k2, dir), undo: () => al.diagonals.delete(k2) });
        requestDraw();
      }
    }
  }
  function handleHighPaint(w, isErase) {
    const { cx, cy } = worldToCell(w.x, w.y), k2 = key(cx, cy); if (lastPaintedHighlight === k2) return; lastPaintedHighlight = k2;
    const al = L(), prev = al.highlights.get(k2), col = highlightColour;
    if (isErase) {
      if (prev !== undefined) {
        al.highlights.delete(k2);
        pushUndo({ redo: () => al.highlights.delete(k2), undo: () => al.highlights.set(k2, prev) });
        requestDraw();
      }
    } else {
      if (prev !== col) {
        al.highlights.set(k2, col);
        pushUndo({ redo: () => al.highlights.set(k2, col), undo: () => { if (prev) al.highlights.set(k2, prev); else al.highlights.delete(k2); } });
        requestDraw();
      }
    }
  }
  function handleNumberPaint(w, isErase) {
    if (!isErase) return;
    const { ix, iy } = nearestInt(w.x, w.y), k2 = key(ix, iy); if (lastPaintedNumber === k2) return; lastPaintedNumber = k2;
    const al = L(), cur = al.numbers.get(k2);
    if (cur !== undefined) {
      al.numbers.delete(k2);
      pushUndo({ redo: () => al.numbers.delete(k2), undo: () => al.numbers.set(k2, cur) });
      requestDraw();
    }
  }
  function handleLinePaint(w, isErase) {
    const edge = nearestEdge(w.x, w.y);
    // Only allow edges matching the locked orientation and axis (set at pointerdown)
    if (edge.orient !== lineDragOrient) return;
    if (lineDragOrient === "h" && edge.cy !== lineDragFixed) return;
    if (lineDragOrient === "v" && edge.cx !== lineDragFixed) return;

    // The varying coordinate along the locked axis
    const cur = lineDragOrient === "h" ? edge.cx : edge.cy;
    const lk = lineKey(edge.orient, edge.cx, edge.cy);
    if (lastPaintedLine === lk) return;

    // Interpolate from lastPaintedLineCoord to cur to fill gaps from fast drags
    const al = L(), col = lineColour;
    let start = cur, end = cur;
    if (lastPaintedLineCoord !== null) {
      start = Math.min(lastPaintedLineCoord, cur);
      end = Math.max(lastPaintedLineCoord, cur);
    }
    for (let i = start; i <= end; i++) {
      const ek = lineDragOrient === "h" ? lineKey("h", i, lineDragFixed) : lineKey("v", lineDragFixed, i);
      if (isErase) {
        const prev = al.lines.get(ek);
        if (prev !== undefined) {
          al.lines.delete(ek);
          pushUndo({ redo: () => al.lines.delete(ek), undo: () => al.lines.set(ek, prev) });
        }
      } else {
        const prev = al.lines.get(ek);
        if (prev !== col) {
          al.lines.set(ek, col);
          pushUndo({ redo: () => al.lines.set(ek, col), undo: () => { if (prev !== undefined) al.lines.set(ek, prev); else al.lines.delete(ek); } });
        }
      }
    }
    lastPaintedLine = lk;
    lastPaintedLineCoord = cur;
    requestDraw();
  }

  function handleClick(w, e) {
    const al = L();
    switch (activeTool) {
      case "select": {
        const bounds = getSelectionBounds(selection);
        if (bounds) {
          if (w.x >= bounds.minX && w.x <= bounds.maxX && w.y >= bounds.minY && w.y <= bounds.maxY) {
            // Clicked inside selection - do nothing
          } else {
            // Clicked outside selection - clear it
            clearSelection();
          }
        }
        break;
      }
      case "diagonal": {

        const { cx, cy } = worldToCell(w.x, w.y), k2 = key(cx, cy), cur = al.diagonals.get(k2);
        if (e.shiftKey) { if (cur !== undefined) { al.diagonals.delete(k2); pushUndo({ redo: () => al.diagonals.delete(k2), undo: () => al.diagonals.set(k2, cur) }); } }
        else if (diagonalDir !== null) {
          if (cur === diagonalDir) { al.diagonals.delete(k2); pushUndo({ redo: () => al.diagonals.delete(k2), undo: () => al.diagonals.set(k2, cur) }); }
          else { const d = diagonalDir; al.diagonals.set(k2, d); pushUndo({ redo: () => al.diagonals.set(k2, d), undo: () => { if (cur !== undefined) al.diagonals.set(k2, cur); else al.diagonals.delete(k2); } }); }
        }
        else if (cur === undefined) { al.diagonals.set(k2, 1); pushUndo({ redo: () => al.diagonals.set(k2, 1), undo: () => al.diagonals.delete(k2) }); }
        else if (cur === 1) { al.diagonals.set(k2, -1); pushUndo({ redo: () => al.diagonals.set(k2, -1), undo: () => al.diagonals.set(k2, 1) }); }
        else { al.diagonals.delete(k2); pushUndo({ redo: () => al.diagonals.delete(k2), undo: () => al.diagonals.set(k2, -1) }); }
        requestDraw(); break;
      }
      case "number": {
        const { ix, iy } = nearestInt(w.x, w.y), k2 = key(ix, iy), cur = al.numbers.get(k2), val = activeNumber;
        if (e.shiftKey) { if (cur !== undefined) { al.numbers.delete(k2); pushUndo({ redo: () => al.numbers.delete(k2), undo: () => al.numbers.set(k2, cur) }); } }
        else if (cur === val) { al.numbers.delete(k2); pushUndo({ redo: () => al.numbers.delete(k2), undo: () => al.numbers.set(k2, cur) }); }
        else { al.numbers.set(k2, val); pushUndo({ redo: () => al.numbers.set(k2, val), undo: () => { if (cur !== undefined) al.numbers.set(k2, cur); else al.numbers.delete(k2); } }); }
        requestDraw(); break;
      }
      case "highlight": {
        const { cx, cy } = worldToCell(w.x, w.y), k2 = key(cx, cy), cur = al.highlights.get(k2), col = highlightColour;
        if (e.shiftKey || cur === col) { if (cur !== undefined) { al.highlights.delete(k2); pushUndo({ redo: () => al.highlights.delete(k2), undo: () => al.highlights.set(k2, cur) }); } }
        else { al.highlights.set(k2, col); pushUndo({ redo: () => al.highlights.set(k2, col), undo: () => { if (cur !== undefined) al.highlights.set(k2, cur); else al.highlights.delete(k2); } }); }
        requestDraw(); break;
      }
      case "line": {
        const edge = nearestEdge(w.x, w.y), lk = lineKey(edge.orient, edge.cx, edge.cy);
        const cur = al.lines.get(lk), col = lineColour;
        if (e.shiftKey || cur === col) { if (cur !== undefined) { al.lines.delete(lk); pushUndo({ redo: () => al.lines.delete(lk), undo: () => al.lines.set(lk, cur) }); } }
        else { al.lines.set(lk, col); pushUndo({ redo: () => al.lines.set(lk, col), undo: () => { if (cur !== undefined) al.lines.set(lk, cur); else al.lines.delete(lk); } }); }
        requestDraw(); break;
      }
      case "arrow": {
        if (e.shiftKey) { removeArrowNear(w); requestDraw(); break; }
        const { cx, cy } = worldToCell(w.x, w.y);
        if (!arrowStart) { arrowStart = { cx, cy }; requestDraw(); }
        else {
          if (cx !== arrowStart.cx || cy !== arrowStart.cy) {
            const a = { cx1: arrowStart.cx, cy1: arrowStart.cy, cx2: cx, cy2: cy, colour: arrowColour };
            al.arrows.push(a);
            pushUndo({ redo: () => al.arrows.push(a), undo: () => { const i = al.arrows.indexOf(a); if (i >= 0) al.arrows.splice(i, 1); } });
          }
          arrowStart = null; requestDraw();
        }
        break;
      }
    }
  }

  function removeArrowNear(w) {
    const al = L(); let best = -1, bestD = CELL * .7;
    for (let i = 0; i < al.arrows.length; i++) {
      const a = al.arrows[i], s = arrowAnchor(a.cx1, a.cy1), e = arrowAnchor(a.cx2, a.cy2);
      const d = ptSegDist(w.x, w.y, s.wx, s.wy, e.wx, e.wy);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { const rm = al.arrows.splice(best, 1)[0]; pushUndo({ redo: () => { const i = al.arrows.indexOf(rm); if (i >= 0) al.arrows.splice(i, 1); }, undo: () => al.arrows.push(rm) }); }
  }

  // ── Context menu (right-click remove) ──
  canvas.addEventListener("contextmenu", e => {
    e.preventDefault(); const w = screenToWorld(e.clientX, e.clientY), al = L();
    if (activeTool === "diagonal") { const { cx, cy } = worldToCell(w.x, w.y), k2 = key(cx, cy), cur = al.diagonals.get(k2); if (cur !== undefined) { al.diagonals.delete(k2); pushUndo({ redo: () => al.diagonals.delete(k2), undo: () => al.diagonals.set(k2, cur) }); requestDraw(); } }
    else if (activeTool === "number") { const { ix, iy } = nearestInt(w.x, w.y), k2 = key(ix, iy), cur = al.numbers.get(k2); if (cur !== undefined) { al.numbers.delete(k2); pushUndo({ redo: () => al.numbers.delete(k2), undo: () => al.numbers.set(k2, cur) }); requestDraw(); } }
    else if (activeTool === "highlight") { const { cx, cy } = worldToCell(w.x, w.y), k2 = key(cx, cy), cur = al.highlights.get(k2); if (cur !== undefined) { al.highlights.delete(k2); pushUndo({ redo: () => al.highlights.delete(k2), undo: () => al.highlights.set(k2, cur) }); requestDraw(); } }
    else if (activeTool === "line") { const edge = nearestEdge(w.x, w.y), lk = lineKey(edge.orient, edge.cx, edge.cy), cur = al.lines.get(lk); if (cur !== undefined) { al.lines.delete(lk); pushUndo({ redo: () => al.lines.delete(lk), undo: () => al.lines.set(lk, cur) }); requestDraw(); } }
    else if (activeTool === "arrow") { removeArrowNear(w); requestDraw(); }
  });

  // ── Zoom ──
  canvas.addEventListener("wheel", e => {
    e.preventDefault(); const p = getP(e), wb = screenToWorld(p.x, p.y);
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    const cw = W / dpr, ch = H / dpr; camX = wb.x - (p.x - cw / 2) / zoom; camY = wb.y - (p.y - ch / 2) / zoom;
    $("zoom-display").textContent = Math.round(zoom * 100) + "%"; scheduleSave(); requestDraw();
  }, { passive: false });

  let lastPinchDist = 0;
  canvas.addEventListener("touchstart", e => { if (e.touches.length === 2) { const t = e.touches; lastPinchDist = Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY); } }, { passive: true });
  canvas.addEventListener("touchmove", e => { if (e.touches.length === 2) { e.preventDefault(); const t = e.touches, d = Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY), cx2 = (t[0].clientX + t[1].clientX) / 2, cy2 = (t[0].clientY + t[1].clientY) / 2; if (lastPinchDist > 0) { const wb = screenToWorld(cx2, cy2); zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (d / lastPinchDist))); const cw = W / dpr, ch = H / dpr; camX = wb.x - (cx2 - cw / 2) / zoom; camY = wb.y - (cy2 - ch / 2) / zoom; $("zoom-display").textContent = Math.round(zoom * 100) + "%"; } lastPinchDist = d; requestDraw(); } }, { passive: false });
  canvas.addEventListener("touchend", () => { lastPinchDist = 0; }, { passive: true });

  // ═══ KEYBOARD ═══════════════════════════════════
  function getCursor() { return activeTool === "select" ? "grab" : "crosshair"; }
  function setTool(tool, diagDir) {
    if (tool !== "select") {
      clearSelection();
    }
    activeTool = tool; arrowStart = null;

    diagonalDir = (tool === "diagonal" && diagDir !== undefined) ? diagDir : null;
    document.querySelectorAll(".tool-btn").forEach(b => b.classList.toggle("active", b.dataset.tool === tool));
    $("btn-diag-fwd").classList.toggle("active", tool === "diagonal" && diagonalDir === 1);
    $("btn-diag-bwd").classList.toggle("active", tool === "diagonal" && diagonalDir === -1);
    $("number-panel").style.display = tool === "number" ? "" : "none";
    $("highlight-panel").style.display = tool === "highlight" ? "" : "none";
    $("arrow-panel").style.display = tool === "arrow" ? "" : "none";
    $("line-panel").style.display = tool === "line" ? "" : "none";
    canvas.style.cursor = getCursor(); requestDraw();
  }

  document.addEventListener("keydown", e => {
    // Hotkey recording mode
    if (recordingAction) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") { recordingAction = null; populateHotkeyList(); return; }
      if (e.key === "Shift" || e.shiftKey) { return; }
      hotkeys[recordingAction] = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      saveHotkeys(); recordingAction = null; populateHotkeyList(); updateToolTitles(); return;
    }


    if (e.key === "Shift") {
      if (!e.repeat) updateToolNamesForShift(true);
    }

    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
    const ctrl = e.ctrlKey || e.metaKey;

    // Escape cancels arrow start or selection
    if (e.key === "Escape") {
      if (arrowStart) { arrowStart = null; requestDraw(); return; }
      if (selection) { clearSelection(); return; }
    }


    // Tool hotkeys
    const lk = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (!ctrl) {
      for (const act of HOTKEY_ACTIONS) {
        if (hotkeys[act.id] === lk) {

          if (act.id === "diagFwd") { setTool("diagonal", 1); return; }
          if (act.id === "diagBwd") { setTool("diagonal", -1); return; }
          if (act.id === "flipDiag") {
            if (!hoverValid) return;
            const al = L(); if (!al || !al.visible) return;
            const { cx, cy } = worldToCell(hoverWX, hoverWY), k2 = key(cx, cy);
            const cur = al.diagonals.get(k2);
            if (cur !== undefined) {
              const nv = cur === 1 ? -1 : 1;
              al.diagonals.set(k2, nv);
              pushUndo({ redo: () => al.diagonals.set(k2, nv), undo: () => al.diagonals.set(k2, cur) });
              requestDraw();
            }
            return;
          }
          setTool(act.id); return;
        }
      }
    }

    if (lk >= "0" && lk <= "4" && !ctrl) { activeNumber = parseInt(lk); setTool("number"); document.querySelectorAll(".num-btn").forEach(b => b.classList.toggle("active", b.dataset.num === lk)); return; }


    if (ctrl && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (ctrl && e.key.toLowerCase() === "z" && e.shiftKey) { e.preventDefault(); redo(); return; }
    if (ctrl && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    if (ctrl && e.key.toLowerCase() === "s") { e.preventDefault(); saveToFile(); return; }
    if (ctrl && e.key.toLowerCase() === "o") { e.preventDefault(); $("file-input").click(); return; }
    if (e.key === "Home" || (ctrl && e.key === "0")) { e.preventDefault(); camX = 0; camY = 0; zoom = 1; $("zoom-display").textContent = "100%"; scheduleSave(); requestDraw(); }
  });

  document.addEventListener("keyup", e => {
    if (e.key === "Shift") {
      updateToolNamesForShift(false);
    }
  });

  window.addEventListener("blur", () => {
    updateToolNamesForShift(false);
  });


  // ═══ UI EVENT HANDLERS ══════════════════════════
  document.querySelectorAll(".tool-btn").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));
  $("btn-diag-fwd").addEventListener("click", () => setTool("diagonal", 1));
  $("btn-diag-bwd").addEventListener("click", () => setTool("diagonal", -1));
  document.querySelectorAll(".num-btn").forEach(b => b.addEventListener("click", () => { activeNumber = parseInt(b.dataset.num); document.querySelectorAll(".num-btn").forEach(x => x.classList.toggle("active", x === b)); }));
  document.querySelectorAll(".numstyle-btn").forEach(b => b.addEventListener("click", () => { numberStyle = b.dataset.style; localStorage.setItem(STORE_NUM_STYLE, numberStyle); document.querySelectorAll(".numstyle-btn").forEach(x => x.classList.toggle("active", x === b)); requestDraw(); }));
  // Sync numstyle active class on load
  document.querySelectorAll(".numstyle-btn").forEach(b => b.classList.toggle("active", b.dataset.style === numberStyle));
  document.querySelectorAll("#highlight-panel .colour-btn").forEach(b => b.addEventListener("click", () => { highlightColour = b.dataset.colour; document.querySelectorAll("#highlight-panel .colour-btn").forEach(x => x.classList.toggle("active", x === b)); }));
  document.querySelectorAll("#arrow-panel .colour-btn").forEach(b => b.addEventListener("click", () => { arrowColour = b.dataset.colour; document.querySelectorAll("#arrow-panel .colour-btn").forEach(x => x.classList.toggle("active", x === b)); }));
  document.querySelectorAll("#line-panel .colour-btn").forEach(b => b.addEventListener("click", () => { lineColour = b.dataset.colour; document.querySelectorAll("#line-panel .colour-btn").forEach(x => x.classList.toggle("active", x === b)); }));
  $("btn-undo").addEventListener("click", undo);
  $("btn-redo").addEventListener("click", redo);




  $("btn-theme").addEventListener("click", toggleTheme);

  // Layer management (bottom panel)
  $("btn-add-layer").addEventListener("click", () => {
    const newLayer = createLayer(); layers.push(newLayer); const newIdx = layers.length - 1;
    const prevIdx = activeLayerIdx; activeLayerIdx = newIdx;
    pushUndo({
      redo: () => { layers.push(newLayer); activeLayerIdx = layers.length - 1; populateLayers(); },
      undo: () => { const i = layers.indexOf(newLayer); if (i >= 0) layers.splice(i, 1); activeLayerIdx = Math.min(prevIdx, layers.length - 1); populateLayers(); }
    });
    populateLayers(); requestDraw();
  });

  $("btn-delete-layer").addEventListener("click", () => {
    if (layers.length <= 1) { toast("Can't delete the last layer"); return; }
    const idx = activeLayerIdx, removed = layers[idx], prevActive = activeLayerIdx;
    layers.splice(idx, 1);
    if (activeLayerIdx >= layers.length) activeLayerIdx = layers.length - 1;
    const newActive = activeLayerIdx;
    pushUndo({
      redo: () => { const i = layers.indexOf(removed); if (i >= 0) layers.splice(i, 1); if (activeLayerIdx >= layers.length) activeLayerIdx = layers.length - 1; populateLayers(); },
      undo: () => { layers.splice(idx, 0, removed); activeLayerIdx = prevActive; populateLayers(); }
    });
    populateLayers(); requestDraw(); toast(`Deleted "${removed.name}"`);
  });

  $("btn-rename-layer").addEventListener("click", () => {
    const layer = L(); if (!layer) return;
    showRenameDialog("Layer name", layer.name, (n) => { const old = layer.name; layer.name = n; pushUndo({ redo: () => { layer.name = n; populateLayers(); }, undo: () => { layer.name = old; populateLayers(); } }); populateLayers(); });
  });

  $("btn-isolate-layer").addEventListener("click", () => {
    isolateLayer = !isolateLayer;
    $("btn-isolate-layer").classList.toggle("active", isolateLayer);
    requestDraw();
  });

  // ── Canvas browser modal ──
  $("btn-open-canvases").addEventListener("click", openCanvasModal);
  $("canvas-modal-close").addEventListener("click", () => $("canvas-modal").close());
  $("btn-new-canvas-modal").addEventListener("click", () => { $("canvas-modal").close(); createCanvas(); });

  function openCanvasModal() {
    saveActiveCanvas(); updateThumbnail();
    const grid = $("canvas-grid"); grid.innerHTML = "";
    for (const c of manifest.canvases) {
      const card = document.createElement("div");
      card.className = "canvas-card" + (c.id === manifest.activeId ? " active" : "");
      const thumbContent = c.thumbnail ? (c.thumbnail.startsWith("<svg") ? c.thumbnail : `<img src="${c.thumbnail}" alt="${escHtml(c.name)}">`) : `<span class="canvas-card__empty">No preview</span>`;
      card.innerHTML = `<div class="canvas-card__thumb">${thumbContent}</div><div class="canvas-card__info"><span class="canvas-card__name">${escHtml(c.name)}</span><div class="canvas-card__btns"><button class="canvas-card__btn" data-action="rename" title="Rename">✎</button><button class="canvas-card__btn" data-action="delete" title="Delete">✕</button></div></div>`;
      card.addEventListener("click", ev => {
        const btn = ev.target.closest("[data-action]");
        if (btn) {
          if (btn.dataset.action === "rename") { showRenameDialog("Canvas name", c.name, n => { renameCanvas(c.id, n); openCanvasModal(); }); }
          else if (btn.dataset.action === "delete") { if (manifest.canvases.length <= 1) { toast("Can't delete the last canvas"); } else if (confirm(`Delete "${c.name}"?`)) { deleteCanvas(c.id); openCanvasModal(); } }
          return;
        }
        $("canvas-modal").close(); switchCanvas(c.id);
      });
      grid.appendChild(card);
    }
    $("canvas-modal").showModal();
  }

  // ── Hotkey modal ──
  $("btn-hotkeys").addEventListener("click", openHotkeyModal);
  $("hotkey-modal-close").addEventListener("click", () => { recordingAction = null; $("hotkey-modal").close(); });
  $("btn-reset-hotkeys").addEventListener("click", () => { hotkeys = { ...DEFAULT_HOTKEYS }; saveHotkeys(); populateHotkeyList(); updateToolTitles(); toast("Hotkeys reset"); });

  function openHotkeyModal() { populateHotkeyList(); $("hotkey-modal").showModal(); }
  function populateHotkeyList() {
    const list = $("hotkey-list"); list.innerHTML = "";
    const counts = getHotkeyCounts();
    for (const act of HOTKEY_ACTIONS) {
      const row = document.createElement("div"); row.className = "hotkey-row";
      const label = document.createElement("span"); label.className = "hotkey-row__label"; label.textContent = act.label;
      const hk = (hotkeys[act.id] || "").toLowerCase();
      const isDuplicate = hk && counts[hk] > 1;
      const btn = document.createElement("button"); btn.className = "hotkey-row__key" + (recordingAction === act.id ? " recording" : "") + (isDuplicate ? " duplicate" : "");
      btn.textContent = recordingAction === act.id ? "Press a key…" : (hotkeys[act.id] || "—").toUpperCase();



      btn.addEventListener("click", () => { recordingAction = act.id; populateHotkeyList(); });
      row.appendChild(label); row.appendChild(btn); list.appendChild(row);
    }
  }

  // ── Rename dialog (reusable) ──
  function showRenameDialog(label, curName, onSave) {
    const dlg = $("rename-dialog"), inp = $("rename-input");
    $("rename-dialog-label").textContent = label; inp.value = curName;
    dlg.showModal(); inp.select();
    dlg.onclose = () => { if (dlg.returnValue === "ok" && inp.value.trim()) onSave(inp.value.trim()); };
  }

  // ── Save / Load (file export/import) ──
  function serialise() {
    return JSON.stringify({
      version: 3, camera: { x: camX, y: camY, zoom },
      layers: layers.map(l => ({
        id: l.id, name: l.name, visible: l.visible,
        diagonals: [...l.diagonals.entries()], numbers: [...l.numbers.entries()],
        highlights: [...l.highlights.entries()], arrows: l.arrows.slice(),
        lines: [...l.lines.entries()],
      })),
      activeLayerIdx,
    }, null, 2);
  }
  function deserialise(json) {
    const d = JSON.parse(json);
    if (d.camera) { camX = d.camera.x || 0; camY = d.camera.y || 0; zoom = d.camera.zoom || 1; }
    layers = [];
    if (d.layers) {
      layers = d.layers.map(ld => { const l = createLayer(ld.name); l.id = ld.id; l.visible = ld.visible !== false; if (ld.diagonals) for (const [k, v] of ld.diagonals) l.diagonals.set(k, v); if (ld.numbers) for (const [k, v] of ld.numbers) l.numbers.set(k, v); if (ld.highlights) for (const [k, v] of ld.highlights) l.highlights.set(k, v); if (ld.arrows) l.arrows.push(...ld.arrows); if (ld.lines) for (const [k, v] of ld.lines) l.lines.set(k, v); return l; });
      activeLayerIdx = d.activeLayerIdx || 0;
    } else {
      const l = createLayer("Layer 1");
      if (d.diagonals) for (const [k, v] of d.diagonals) l.diagonals.set(k, v);
      if (d.numbers) for (const [k, v] of d.numbers) l.numbers.set(k, v);
      if (d.highlights) for (const [k, v] of d.highlights) l.highlights.set(k, v);
      if (d.arrows) l.arrows.push(...d.arrows.map(a => ({ cx1: a.x1, cy1: a.y1, cx2: a.x2, cy2: a.y2, colour: a.colour })));
      layers = [l]; activeLayerIdx = 0;
    }
    if (!layers.length) layers = [createLayer("Layer 1")];
    if (activeLayerIdx >= layers.length) activeLayerIdx = 0;
    $("zoom-display").textContent = Math.round(zoom * 100) + "%";
    populateLayers(); scheduleSave(); requestDraw();
  }

  function saveToFile() {
    const blob = new Blob([serialise()], { type: "application/json" }), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; const entry = manifest.canvases.find(c => c.id === manifest.activeId);
    a.download = (entry ? entry.name.replace(/[^a-z0-9]/gi, "-").toLowerCase() : "slant-project") + ".json";
    a.click(); URL.revokeObjectURL(url); toast("Exported to file");
  }
  $("btn-save").addEventListener("click", saveToFile);
  $("btn-load").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", e => {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader(); r.onload = () => { try { deserialise(r.result); toast("Imported " + file.name); } catch (err) { toast("Error loading file"); console.error(err); } };
    r.readAsText(file); e.target.value = "";
  });

  const deleteBtn = $("selection-delete-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", e => {
      e.stopPropagation();
      deleteSelection();
    });
  }

  // ═══ INIT ═══════════════════════════════════════
  window.addEventListener("resize", resize);

  resize();
  initTheme();
  loadHotkeys();
  updateToolTitles();
  loadManifest();
  loadCanvas(manifest.activeId);
  canvas.style.cursor = getCursor();
})();
