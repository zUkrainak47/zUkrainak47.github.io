/**
 * 2D Cube net renderer on Canvas.
 * Draws the unfolded cube state after applying a scramble.
 */

// Face indices: U=0, R=1, F=2, D=3, L=4, B=5
const U = 0, R = 1, F = 2, D = 3, L = 4, B = 5;

// Color map for face indices
const COLORS = ['#FFF', '#F00', '#33CD32', '#FFFF05', '#FFA503', '#00F'];

/**
 * Create a solved cube state (54 stickers).
 * Each face has 9 stickers, indexed 0-8.
 */
function createSolvedCube() {
    const cube = [];
    for (let face = 0; face < 6; face++) {
        cube[face] = new Array(9).fill(face);
    }
    return cube;
}

function rotateFace180(face) {
    return [...face].reverse();
}

function orientCubeForDisplay(cube, orientation = 'standard') {
    if (orientation !== 'yellow-top') {
        return cube.map((face) => [...face]);
    }

    return [
        rotateFace180(cube[D]),
        rotateFace180(cube[L]),
        rotateFace180(cube[F]),
        rotateFace180(cube[U]),
        rotateFace180(cube[R]),
        rotateFace180(cube[B]),
    ];
}

/**
 * Rotate a face 90° clockwise (in-place).
 */
function rotateFaceCW(face) {
    const c = [...face];
    face[0] = c[6]; face[1] = c[3]; face[2] = c[0];
    face[3] = c[7]; face[5] = c[1];
    face[6] = c[8]; face[7] = c[5]; face[8] = c[2];
}

/**
 * Cycle four values: a←b←c←d←a (shift items along the cycle).
 */
function cycle4(cube, a, b, c, d) {
    const temp = cube[a[0]][a[1]];
    cube[a[0]][a[1]] = cube[d[0]][d[1]];
    cube[d[0]][d[1]] = cube[c[0]][c[1]];
    cube[c[0]][c[1]] = cube[b[0]][b[1]];
    cube[b[0]][b[1]] = temp;
}

/**
 * Apply a single move to the cube.
 */
function applyMove(cube, move) {
    switch (move) {
        case 'U':
            rotateFaceCW(cube[U]);
            cycle4(cube, [F, 0], [L, 0], [B, 0], [R, 0]);
            cycle4(cube, [F, 1], [L, 1], [B, 1], [R, 1]);
            cycle4(cube, [F, 2], [L, 2], [B, 2], [R, 2]);
            break;
        case 'D':
            rotateFaceCW(cube[D]);
            cycle4(cube, [F, 6], [R, 6], [B, 6], [L, 6]);
            cycle4(cube, [F, 7], [R, 7], [B, 7], [L, 7]);
            cycle4(cube, [F, 8], [R, 8], [B, 8], [L, 8]);
            break;
        case 'R':
            rotateFaceCW(cube[R]);
            cycle4(cube, [F, 2], [U, 2], [B, 6], [D, 2]);
            cycle4(cube, [F, 5], [U, 5], [B, 3], [D, 5]);
            cycle4(cube, [F, 8], [U, 8], [B, 0], [D, 8]);
            break;
        case 'L':
            rotateFaceCW(cube[L]);
            cycle4(cube, [F, 0], [D, 0], [B, 8], [U, 0]);
            cycle4(cube, [F, 3], [D, 3], [B, 5], [U, 3]);
            cycle4(cube, [F, 6], [D, 6], [B, 2], [U, 6]);
            break;
        case 'F':
            rotateFaceCW(cube[F]);
            cycle4(cube, [U, 6], [R, 0], [D, 2], [L, 8]);
            cycle4(cube, [U, 7], [R, 3], [D, 1], [L, 5]);
            cycle4(cube, [U, 8], [R, 6], [D, 0], [L, 2]);
            break;
        case 'B':
            rotateFaceCW(cube[B]);
            cycle4(cube, [U, 2], [L, 0], [D, 6], [R, 8]);
            cycle4(cube, [U, 1], [L, 3], [D, 7], [R, 5]);
            cycle4(cube, [U, 0], [L, 6], [D, 8], [R, 2]);
            break;
    }
}

/**
 * Parse a scramble string and apply to a solved cube.
 */
export function applyScramble(scramble, orientation = 'standard') {
    const cube = createSolvedCube();
    if (!scramble) return orientCubeForDisplay(cube, orientation);

    const moves = scramble.trim().split(/\s+/);
    for (const token of moves) {
        const base = token[0];
        const modifier = token.slice(1);
        let count = 1;
        // Handle both ASCII apostrophe and Unicode right single quote
        if (modifier === "'" || modifier === "\u2019") count = 3;
        else if (modifier === "2") count = 2;

        for (let i = 0; i < count; i++) {
            applyMove(cube, base);
        }
    }
    return orientCubeForDisplay(cube, orientation);
}

/**
 * Draw the cube net on a canvas.
 * Layout (each face is 3x3 cells):
 *       [U]
 *  [L] [F] [R] [B]
 *       [D]
 */
export function drawCube(canvas, cube) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;

    // Face gap = visual separation between faces
    // Sticker gap = small gap between stickers within a face
    const faceGap = Math.max(2, Math.min(w, h) * 0.02);
    const stickerGap = 0.6;

    // Total grid: 4 faces wide + 3 face gaps, 3 faces tall + 2 face gaps
    const availW = w - faceGap * 3;
    const availH = h - faceGap * 2;
    const cellSize = Math.min(availW / 12, availH / 9);
    const faceSize = cellSize * 3;

    // Center the net
    const totalW = faceSize * 4 + faceGap * 3;
    const totalH = faceSize * 3 + faceGap * 2;
    const offsetX = (w - totalW) / 2;
    const offsetY = (h - totalH) / 2;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Face positions in the net (col, row of the top-left corner in face units)
    const facePositions = {
        [U]: [1, 0],
        [L]: [0, 1],
        [F]: [1, 1],
        [R]: [2, 1],
        [B]: [3, 1],
        [D]: [1, 2],
    };

    for (let face = 0; face < 6; face++) {
        const [fc, fr] = facePositions[face];
        // Add faceGap between faces
        const fx = offsetX + fc * (faceSize + faceGap);
        const fy = offsetY + fr * (faceSize + faceGap);

        for (let i = 0; i < 9; i++) {
            const row = Math.floor(i / 3);
            const col = i % 3;
            const x = fx + col * cellSize + stickerGap;
            const y = fy + row * cellSize + stickerGap;
            const size = cellSize - stickerGap * 2;

            ctx.fillStyle = COLORS[cube[face][i]];
            ctx.beginPath();
            const r = Math.max(1, size * 0.08);
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + size, y, x + size, y + size, r);
            ctx.arcTo(x + size, y + size, x, y + size, r);
            ctx.arcTo(x, y + size, x, y, r);
            ctx.arcTo(x, y, x + size, y, r);
            ctx.closePath();
            ctx.fill();

            // Subtle border
            ctx.strokeStyle = 'rgba(0,0,0,0.4)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }
}

let _lastCube = null;
let _cubeCanvas = null;

/**
 * Initialize the cube display: watch for canvas resize and auto-redraw.
 */
export function initCubeDisplay(canvas) {
    _cubeCanvas = canvas;
    const observer = new ResizeObserver(entries => {
        for (const entry of entries) {
            const { width, height } = entry.contentRect;
            if (width === 0 || height === 0) return; // collapsed
            canvas.width = width * devicePixelRatio;
            canvas.height = height * devicePixelRatio;
            if (_lastCube) {
                const ctx = canvas.getContext('2d');
                ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
                drawCube(canvas, _lastCube);
            }
        }
    });
    observer.observe(canvas.parentElement);
    return observer;
}

export function updateCubeDisplay(canvas, scramble, orientation = 'standard') {
    _lastCube = applyScramble(scramble, orientation);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    drawCube(canvas, _lastCube);
}
