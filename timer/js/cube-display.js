/**
 * Canvas scramble preview renderers.
 * Supports NxN cube nets, a flat pyraminx preview, and a two-star megaminx net.
 */

// Face indices: U=0, R=1, F=2, D=3, L=4, B=5
const U = 0, R = 1, F = 2, D = 3, L = 4, B = 5;

const COLORS = ['#FFF', '#F00', '#33CD32', '#FFFF05', '#FFA503', '#00F'];
const AXIS_INDEX = Object.freeze({ x: 0, y: 1, z: 2 });
const STICKER_GAP_TO_CELL_RATIO = 1 / 38;

const FACE_VECTORS = Object.freeze({
    [U]: Object.freeze({ normal: [0, 1, 0], right: [1, 0, 0], down: [0, 0, 1] }),
    [R]: Object.freeze({ normal: [1, 0, 0], right: [0, 0, -1], down: [0, -1, 0] }),
    [F]: Object.freeze({ normal: [0, 0, 1], right: [1, 0, 0], down: [0, -1, 0] }),
    [D]: Object.freeze({ normal: [0, -1, 0], right: [1, 0, 0], down: [0, 0, -1] }),
    [L]: Object.freeze({ normal: [-1, 0, 0], right: [0, 0, 1], down: [0, -1, 0] }),
    [B]: Object.freeze({ normal: [0, 0, -1], right: [-1, 0, 0], down: [0, -1, 0] }),
});

const NORMAL_TO_FACE = new Map(
    Object.entries(FACE_VECTORS).map(([face, meta]) => [meta.normal.join(','), Number(face)]),
);

const BASIC_MOVE_CONFIG = Object.freeze({
    U: Object.freeze({ axis: 'y', side: 1, baseQuarterTurns: 3 }),
    D: Object.freeze({ axis: 'y', side: -1, baseQuarterTurns: 1 }),
    R: Object.freeze({ axis: 'x', side: 1, baseQuarterTurns: 3 }),
    L: Object.freeze({ axis: 'x', side: -1, baseQuarterTurns: 1 }),
    F: Object.freeze({ axis: 'z', side: 1, baseQuarterTurns: 3 }),
    B: Object.freeze({ axis: 'z', side: -1, baseQuarterTurns: 1 }),
});

const ROTATION_MOVE_CONFIG = Object.freeze({
    X: Object.freeze({ axis: 'x', side: 1, baseQuarterTurns: 3 }),
    Y: Object.freeze({ axis: 'y', side: 1, baseQuarterTurns: 3 }),
    Z: Object.freeze({ axis: 'z', side: 1, baseQuarterTurns: 3 }),
});

const FACE_POSITIONS = Object.freeze({
    [U]: [1, 0],
    [L]: [0, 1],
    [F]: [1, 1],
    [R]: [2, 1],
    [B]: [3, 1],
    [D]: [1, 2],
});

// Pyraminx preview face order: left, front, right, bottom.
const PYRAMINX_FACE_SIZE = 3;
const PYRAMINX_COLORS = ['#FFFF05', '#33CD32', '#F00', '#00F'];
const PYRAMINX_TRIANGLE_HEIGHT_RATIO = Math.sqrt(3) / 2;
const PYRAMINX_FACE_HORIZONTAL_STEP_RATIO = 0.58;
const PYRAMINX_FACE_VERTICAL_GAP_RATIO = 0.08;
const PYRAMINX_STICKER_OUTLINE = 'rgba(0, 0, 0, 0.4)';
const PYRAMINX_VERTICES = Object.freeze({
    U: Object.freeze([1, 1, 1]),
    L: Object.freeze([-1, -1, 1]),
    R: Object.freeze([1, -1, -1]),
    B: Object.freeze([-1, 1, -1]),
});
const PYRAMINX_FACE_LAYOUT = Object.freeze([
    Object.freeze({ vertices: Object.freeze(['U', 'L', 'B']), opposite: 'R', color: 2 }),
    Object.freeze({ vertices: Object.freeze(['U', 'L', 'R']), opposite: 'B', color: 1 }),
    Object.freeze({ vertices: Object.freeze(['U', 'R', 'B']), opposite: 'L', color: 3 }),
    Object.freeze({ vertices: Object.freeze(['L', 'R', 'B']), opposite: 'U', color: 0 }),
]);
const PYRAMINX_FACE_DRAW_CONFIGS = Object.freeze([
    Object.freeze({ orientation: 'down', vertexOrder: Object.freeze([1, 2, 0]) }),
    Object.freeze({ orientation: 'up', vertexOrder: Object.freeze([2, 0, 1]) }),
    Object.freeze({ orientation: 'down', vertexOrder: Object.freeze([0, 2, 1]) }),
    Object.freeze({ orientation: 'down', vertexOrder: Object.freeze([0, 1, 2]) }),
]);

const MEGAMINX_FACE_SIZE = 11;
const MEGAMINX_COLORS = [
    '#F8F8F5',
    '#F9C91C',
    '#FFF6B4',
    '#9C9C9C',
    '#EC1111',
    '#0A7F12',
    '#74FB00',
    '#FF9136',
    '#1223C8',
    '#8A28FF',
    '#E28DEE',
    '#8BD6F8',
];
const MEGAMINX_FACE_NORMALS = Object.freeze([
    Object.freeze([0, 0.5257311121191336, 0.85065080835204]),
    Object.freeze([0, -0.5257311121191336, 0.85065080835204]),
    Object.freeze([0, 0.5257311121191336, -0.85065080835204]),
    Object.freeze([0, -0.5257311121191336, -0.85065080835204]),
    Object.freeze([0.5257311121191336, 0.85065080835204, 0]),
    Object.freeze([-0.5257311121191336, 0.85065080835204, 0]),
    Object.freeze([0.5257311121191336, -0.85065080835204, 0]),
    Object.freeze([-0.5257311121191336, -0.85065080835204, 0]),
    Object.freeze([0.85065080835204, 0, 0.5257311121191336]),
    Object.freeze([-0.85065080835204, 0, 0.5257311121191336]),
    Object.freeze([0.85065080835204, 0, -0.5257311121191336]),
    Object.freeze([-0.85065080835204, 0, -0.5257311121191336]),
]);
const MEGAMINX_FACE_NEIGHBORS = Object.freeze([
    Object.freeze([9, 1, 8, 4, 5]),
    Object.freeze([7, 6, 8, 0, 9]),
    Object.freeze([10, 3, 11, 5, 4]),
    Object.freeze([6, 7, 11, 2, 10]),
    Object.freeze([8, 10, 2, 5, 0]),
    Object.freeze([11, 9, 0, 4, 2]),
    Object.freeze([1, 7, 3, 10, 8]),
    Object.freeze([3, 6, 1, 9, 11]),
    Object.freeze([1, 6, 10, 4, 0]),
    Object.freeze([7, 1, 0, 5, 11]),
    Object.freeze([6, 3, 2, 4, 8]),
    Object.freeze([3, 7, 9, 5, 2]),
]);
const MEGAMINX_U_FACE = 0;
const MEGAMINX_D_FACE = 3;
const MEGAMINX_FRONT_FACE = 5;
const MEGAMINX_LEFT_FACE = 9;
const MEGAMINX_RIGHT_AXIS_FACE = 10;
const MEGAMINX_CENTER_WEIGHT = 3;
const MEGAMINX_LAYER_THRESHOLD = 0.58;
const MEGAMINX_FIFTH_TURN_RAD = (2 * Math.PI) / 5;
const MEGAMINX_STICKER_OUTLINE = 'rgba(0, 0, 0, 0.45)';
const MEGAMINX_INNER_PENTAGON_SCALE = 0.54;
const MEGAMINX_EDGE_SPLIT_RATIO = 0.33;
const MEGAMINX_U_STAR_ROTATION = -Math.PI / 10;
const MEGAMINX_D_STAR_ROTATION = Math.PI / 10;
const MEGAMINX_RIGHT_STAR_OFFSET_X = 4.98;
const MEGAMINX_RIGHT_STAR_OFFSET_Y = 0;
const MEGAMINX_U_STAR_EDGE_TO_FACE = Object.freeze([4, 5, 9, 1, 8]);
const MEGAMINX_D_STAR_EDGE_TO_FACE = Object.freeze([11, 2, 10, 6, 7]);
const MEGAMINX_LABEL_STYLE = Object.freeze({
    fill: 'rgba(42, 24, 18, 0.9)',
    stroke: 'rgba(255, 255, 255, 0.88)',
});

function normalizeCubeSize(size = 3) {
    const parsed = Number(size);
    if (!Number.isFinite(parsed)) return 3;
    return Math.max(2, Math.round(parsed));
}

function getFaceSize(face) {
    const length = Array.isArray(face) ? face.length : 9;
    return Math.max(2, Math.round(Math.sqrt(length)));
}

function getCoordinateValue(index, size) {
    return (index * 2) - (size - 1);
}

function dot(a, b) {
    return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
}

function addVectors(a, b) {
    return [
        a[0] + b[0],
        a[1] + b[1],
        a[2] + b[2],
    ];
}

function subtractVectors(a, b) {
    return [
        a[0] - b[0],
        a[1] - b[1],
        a[2] - b[2],
    ];
}

function scaleVector(vector, scalar) {
    return [
        vector[0] * scalar,
        vector[1] * scalar,
        vector[2] * scalar,
    ];
}

function sumVectors(...vectors) {
    return vectors.reduce(
        (total, vector) => addVectors(total, vector),
        [0, 0, 0],
    );
}

function cross(a, b) {
    return [
        (a[1] * b[2]) - (a[2] * b[1]),
        (a[2] * b[0]) - (a[0] * b[2]),
        (a[0] * b[1]) - (a[1] * b[0]),
    ];
}

function magnitude(vector) {
    return Math.sqrt(dot(vector, vector));
}

function normalizeVector(vector) {
    const length = magnitude(vector);
    if (!length) return [0, 0, 0];
    return scaleVector(vector, 1 / length);
}

function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
}

function averagePoints(points) {
    if (!Array.isArray(points) || points.length === 0) return [];

    const dimension = points[0].length;
    const sums = new Array(dimension).fill(0);

    points.forEach((point) => {
        for (let index = 0; index < dimension; index += 1) {
            sums[index] += point[index];
        }
    });

    return sums.map((value) => value / points.length);
}

function interpolateTrianglePoint(a, b, c, u, v, size = PYRAMINX_FACE_SIZE) {
    const uRatio = u / size;
    const vRatio = v / size;

    return a.map((coord, index) => (
        coord
        + ((b[index] - coord) * uRatio)
        + ((c[index] - coord) * vRatio)
    ));
}

function rotateVectorAroundAxis(vector, axis, angle) {
    const normalizedAxis = normalizeVector(axis);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    return addVectors(
        addVectors(
            scaleVector(vector, cos),
            scaleVector(cross(normalizedAxis, vector), sin),
        ),
        scaleVector(normalizedAxis, dot(normalizedAxis, vector) * (1 - cos)),
    );
}

function distanceSquared(a, b) {
    return (
        ((a[0] - b[0]) ** 2)
        + ((a[1] - b[1]) ** 2)
        + ((a[2] - b[2]) ** 2)
    );
}

function distance2D(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function createPyraminxTriangleDefinitions(size = PYRAMINX_FACE_SIZE) {
    const referenceA = [0, 0];
    const referenceB = [1, 0];
    const referenceC = [0.5, PYRAMINX_TRIANGLE_HEIGHT_RATIO];
    const definitions = [];

    const pushTriangle = (gridPoints) => {
        const centroid = averagePoints(
            gridPoints.map(([u, v]) => interpolateTrianglePoint(referenceA, referenceB, referenceC, u, v, size)),
        );
        definitions.push({ gridPoints, centroid });
    };

    for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size - row; col += 1) {
            pushTriangle([
                [row, col],
                [row + 1, col],
                [row, col + 1],
            ]);
        }
    }

    for (let row = 0; row < size - 1; row += 1) {
        for (let col = 0; col < size - 1 - row; col += 1) {
            pushTriangle([
                [row + 1, col],
                [row + 1, col + 1],
                [row, col + 1],
            ]);
        }
    }

    return definitions
        .sort((a, b) => {
            const verticalDelta = a.centroid[1] - b.centroid[1];
            if (Math.abs(verticalDelta) > 1e-9) return verticalDelta;
            return a.centroid[0] - b.centroid[0];
        })
        .map(({ gridPoints }) => gridPoints.map(([u, v]) => [u, v]));
}

const PYRAMINX_TRIANGLE_DEFINITIONS = Object.freeze(createPyraminxTriangleDefinitions());

function createPyraminxFaceMetas() {
    return PYRAMINX_FACE_LAYOUT.map((face, index) => {
        const vertices = face.vertices.map((vertex) => PYRAMINX_VERTICES[vertex]);
        let normal = normalizeVector(cross(
            subtractVectors(vertices[1], vertices[0]),
            subtractVectors(vertices[2], vertices[0]),
        ));

        if (dot(normal, PYRAMINX_VERTICES[face.opposite]) > 0) {
            normal = scaleVector(normal, -1);
        }

        const solvedSlots = PYRAMINX_TRIANGLE_DEFINITIONS.map((triangle) => averagePoints(
            triangle.map(([u, v]) => interpolateTrianglePoint(vertices[0], vertices[1], vertices[2], u, v)),
        ));

        return {
            index,
            color: face.color,
            normal,
            opposite: face.opposite,
            solvedSlots,
        };
    });
}

const PYRAMINX_FACE_METAS = Object.freeze(createPyraminxFaceMetas());

function rotateVectorQuarter(vector, axis) {
    const [x, y, z] = vector;

    switch (axis) {
        case 'x':
            return [x, -z, y];
        case 'y':
            return [z, y, -x];
        case 'z':
            return [-y, x, z];
        default:
            return [x, y, z];
    }
}

function createSolvedCubeState(size = 3) {
    const cubeSize = normalizeCubeSize(size);
    const max = cubeSize - 1;
    const stickers = [];

    for (let face = 0; face < 6; face += 1) {
        const meta = FACE_VECTORS[face];

        for (let row = 0; row < cubeSize; row += 1) {
            for (let col = 0; col < cubeSize; col += 1) {
                const horizontal = getCoordinateValue(col, cubeSize);
                const vertical = getCoordinateValue(row, cubeSize);
                stickers.push({
                    color: face,
                    position: [
                        (meta.normal[0] * max) + (meta.right[0] * horizontal) + (meta.down[0] * vertical),
                        (meta.normal[1] * max) + (meta.right[1] * horizontal) + (meta.down[1] * vertical),
                        (meta.normal[2] * max) + (meta.right[2] * horizontal) + (meta.down[2] * vertical),
                    ],
                    normal: [...meta.normal],
                });
            }
        }
    }

    return stickers;
}

function createSolvedCubeFaces(size = 3) {
    const cubeSize = normalizeCubeSize(size);
    return Array.from({ length: 6 }, (_, face) => new Array(cubeSize * cubeSize).fill(face));
}

function materializeCubeFaces(stickers, size = 3) {
    const cubeSize = normalizeCubeSize(size);
    const max = cubeSize - 1;
    const cube = createSolvedCubeFaces(cubeSize);

    stickers.forEach((sticker) => {
        const face = NORMAL_TO_FACE.get(sticker.normal.join(','));
        if (face == null) return;

        const meta = FACE_VECTORS[face];
        const col = Math.round((dot(sticker.position, meta.right) + max) / 2);
        const row = Math.round((dot(sticker.position, meta.down) + max) / 2);

        if (row < 0 || row >= cubeSize || col < 0 || col >= cubeSize) return;
        cube[face][(row * cubeSize) + col] = sticker.color;
    });

    return cube;
}

function rotateFace180(face, size) {
    const rotated = new Array(face.length);

    for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size; col += 1) {
            const sourceIndex = (row * size) + col;
            const targetIndex = ((size - 1 - row) * size) + (size - 1 - col);
            rotated[targetIndex] = face[sourceIndex];
        }
    }

    return rotated;
}

function orientCubeForDisplay(cube, orientation = 'standard') {
    const size = getFaceSize(cube?.[0]);

    if (orientation !== 'yellow-top') {
        return cube.map((face) => [...face]);
    }

    return [
        rotateFace180(cube[D], size),
        rotateFace180(cube[L], size),
        rotateFace180(cube[F], size),
        rotateFace180(cube[U], size),
        rotateFace180(cube[R], size),
        rotateFace180(cube[B], size),
    ];
}

function getModifierMultiplier(modifier = '') {
    if (modifier === '2') return 2;
    if (modifier === "'" || modifier === '\u2019') return 3;
    return 1;
}

function parseMoveToken(token, size = 3) {
    const normalized = String(token ?? '')
        .trim()
        .replace(/[`´‘’′]/g, "'");

    if (!normalized) return null;

    const rotationMatch = normalized.match(/^([xyzXYZ])([2']?)$/);
    if (rotationMatch) {
        const config = ROTATION_MOVE_CONFIG[rotationMatch[1].toUpperCase()];
        const quarterTurns = (config.baseQuarterTurns * getModifierMultiplier(rotationMatch[2])) % 4;

        return {
            axis: config.axis,
            side: config.side,
            layers: normalizeCubeSize(size),
            quarterTurns,
        };
    }

    const faceMatch = normalized.match(/^(?:(\d+))?([URFDLBurfdlb])(w)?([2']?)$/);
    if (!faceMatch) return null;

    const [, prefixText, rawFace, wideMarker, modifier] = faceMatch;
    const face = rawFace.toUpperCase();
    const config = BASIC_MOVE_CONFIG[face];
    if (!config) return null;

    const prefixLayers = prefixText ? Number.parseInt(prefixText, 10) : null;
    const isLowercaseWide = rawFace !== face;
    const isWideMove = Boolean(wideMarker) || isLowercaseWide || prefixLayers != null;
    const defaultLayers = isWideMove ? (prefixLayers ?? 2) : 1;
    const layers = Math.min(normalizeCubeSize(size), Math.max(1, defaultLayers));
    const quarterTurns = (config.baseQuarterTurns * getModifierMultiplier(modifier)) % 4;

    return {
        axis: config.axis,
        side: config.side,
        layers,
        quarterTurns,
    };
}

function shouldRotateSticker(sticker, axisIndex, side, threshold) {
    const axisValue = sticker.position[axisIndex];
    return side > 0 ? axisValue >= threshold : axisValue <= -threshold;
}

function applyParsedMove(stickers, parsedMove, size = 3) {
    if (!parsedMove || parsedMove.quarterTurns === 0) return;

    const cubeSize = normalizeCubeSize(size);
    const axisIndex = AXIS_INDEX[parsedMove.axis];
    const threshold = (cubeSize - 1) - ((Math.min(parsedMove.layers, cubeSize) - 1) * 2);
    const rotatingStickers = stickers.filter((sticker) => (
        shouldRotateSticker(sticker, axisIndex, parsedMove.side, threshold)
    ));

    for (let step = 0; step < parsedMove.quarterTurns; step += 1) {
        rotatingStickers.forEach((sticker) => {
            sticker.position = rotateVectorQuarter(sticker.position, parsedMove.axis);
            sticker.normal = rotateVectorQuarter(sticker.normal, parsedMove.axis);
        });
    }
}

export function applyScramble(scramble, orientation = 'standard', size = 3) {
    const cubeSize = normalizeCubeSize(size);
    const stickers = createSolvedCubeState(cubeSize);

    if (scramble) {
        const moves = String(scramble).trim().split(/\s+/);
        moves.forEach((token) => {
            const parsedMove = parseMoveToken(token, cubeSize);
            applyParsedMove(stickers, parsedMove, cubeSize);
        });
    }

    return orientCubeForDisplay(materializeCubeFaces(stickers, cubeSize), orientation);
}

function getPyraminxMoveTurns(modifier = '') {
    if (modifier === '2') return 2;
    if (modifier === "'" || modifier === '\u2019') return 2;
    return 1;
}

function parsePyraminxMoveToken(token) {
    const normalized = String(token ?? '')
        .trim()
        .replace(/[`´‘’′]/g, "'");

    if (!normalized) return null;

    const match = normalized.match(/^([ULRBulrb])([2']?)$/);
    if (!match) return null;

    const [, base, modifier] = match;

    return {
        axis: base.toUpperCase(),
        tipOnly: base !== base.toUpperCase(),
        turns: getPyraminxMoveTurns(modifier) % 3,
    };
}

function createSolvedPyraminxState() {
    const stickers = [];

    PYRAMINX_FACE_METAS.forEach((face) => {
        face.solvedSlots.forEach((position) => {
            stickers.push({
                color: face.color,
                position: [...position],
                normal: [...face.normal],
            });
        });
    });

    return stickers;
}

function getPyraminxVertexWeight(position, vertexKey) {
    return (dot(position, PYRAMINX_VERTICES[vertexKey]) + 1) / 4;
}

function applyPyraminxMove(stickers, move) {
    if (!move || move.turns === 0) return;

    const threshold = move.tipOnly ? (2 / 3) : (1 / 3);
    const axis = PYRAMINX_VERTICES[move.axis];
    const angle = -((2 * Math.PI) / 3) * move.turns;

    stickers.forEach((sticker) => {
        if (getPyraminxVertexWeight(sticker.position, move.axis) > threshold + 1e-9) {
            sticker.position = rotateVectorAroundAxis(sticker.position, axis, angle);
            sticker.normal = rotateVectorAroundAxis(sticker.normal, axis, angle);
        }
    });
}

function resolvePyraminxFaceIndex(normal) {
    let bestFaceIndex = 0;
    let bestDot = -Infinity;

    PYRAMINX_FACE_METAS.forEach((face) => {
        const similarity = dot(normal, face.normal);
        if (similarity > bestDot) {
            bestDot = similarity;
            bestFaceIndex = face.index;
        }
    });

    return bestFaceIndex;
}

function materializePyraminxFaces(stickers) {
    const faces = PYRAMINX_FACE_METAS.map((face) => new Array(PYRAMINX_TRIANGLE_DEFINITIONS.length).fill(face.color));
    const occupiedSlots = PYRAMINX_FACE_METAS.map(() => new Set());

    stickers.forEach((sticker) => {
        const faceIndex = resolvePyraminxFaceIndex(sticker.normal);
        const face = PYRAMINX_FACE_METAS[faceIndex];
        const slotCandidates = face.solvedSlots
            .map((slot, index) => ({ index, distance: distanceSquared(sticker.position, slot) }))
            .sort((a, b) => a.distance - b.distance);
        const nextSlot = slotCandidates.find(({ index }) => !occupiedSlots[faceIndex].has(index)) ?? slotCandidates[0];

        occupiedSlots[faceIndex].add(nextSlot.index);
        faces[faceIndex][nextSlot.index] = sticker.color;
    });

    return faces;
}

export function applyPyraminxScramble(scramble) {
    const stickers = createSolvedPyraminxState();

    if (scramble) {
        String(scramble)
            .trim()
            .split(/\s+/)
            .forEach((token) => {
                const parsedMove = parsePyraminxMoveToken(token);
                applyPyraminxMove(stickers, parsedMove);
            });
    }

    return materializePyraminxFaces(stickers);
}

function createMegaminxFaceMetas() {
    return MEGAMINX_FACE_NORMALS.map((normal, face) => {
        const neighbors = MEGAMINX_FACE_NEIGHBORS[face];
        const solvedSlots = [[...normal]];

        for (let index = 0; index < neighbors.length; index += 1) {
            const nextIndex = (index + 1) % neighbors.length;
            const currentNeighbor = MEGAMINX_FACE_NORMALS[neighbors[index]];
            const nextNeighbor = MEGAMINX_FACE_NORMALS[neighbors[nextIndex]];
            solvedSlots.push(normalizeVector(sumVectors(
                scaleVector(normal, MEGAMINX_CENTER_WEIGHT),
                currentNeighbor,
                nextNeighbor,
            )));
            solvedSlots.push(normalizeVector(addVectors(
                scaleVector(normal, MEGAMINX_CENTER_WEIGHT),
                nextNeighbor,
            )));
        }

        return {
            face,
            normal,
            neighbors,
            solvedSlots,
        };
    });
}

const MEGAMINX_FACE_METAS = Object.freeze(createMegaminxFaceMetas());

function parseMegaminxMoveToken(token) {
    const normalized = String(token ?? '')
        .trim()
        .replace(/[`´‘’′]/g, "'");

    if (!normalized) return null;

    const sliceMatch = normalized.match(/^([RD])(\+\+|--)$/i);
    if (sliceMatch) {
        return {
            kind: sliceMatch[1].toUpperCase(),
            turns: sliceMatch[2] === '++' ? 2 : -2,
        };
    }

    const upperMatch = normalized.match(/^U([2']?)$/i);
    if (!upperMatch) return null;

    const [, modifier] = upperMatch;

    return {
        kind: 'U',
        turns: modifier === '2'
            ? 2
            : modifier === "'"
                ? -1
                : 1,
    };
}

function createSolvedMegaminxState() {
    const stickers = [];

    MEGAMINX_FACE_METAS.forEach((face) => {
        face.solvedSlots.forEach((position) => {
            stickers.push({
                color: face.face,
                position: [...position],
                normal: [...face.normal],
            });
        });
    });

    return stickers;
}

function resolveMegaminxFaceIndex(normal) {
    let bestFaceIndex = 0;
    let bestDot = -Infinity;

    MEGAMINX_FACE_METAS.forEach((face) => {
        const similarity = dot(normal, face.normal);
        if (similarity > bestDot) {
            bestDot = similarity;
            bestFaceIndex = face.face;
        }
    });

    return bestFaceIndex;
}

function applyMegaminxMove(stickers, move) {
    if (!move || move.turns === 0) return;

    let axis = MEGAMINX_FACE_NORMALS[MEGAMINX_U_FACE];
    let shouldRotate = (sticker) => dot(sticker.position, axis) > MEGAMINX_LAYER_THRESHOLD;

    if (move.kind === 'D') {
        axis = MEGAMINX_FACE_NORMALS[MEGAMINX_D_FACE];
        shouldRotate = (sticker) => dot(sticker.position, MEGAMINX_FACE_NORMALS[MEGAMINX_U_FACE]) < MEGAMINX_LAYER_THRESHOLD;
    } else if (move.kind === 'R') {
        axis = MEGAMINX_FACE_NORMALS[MEGAMINX_RIGHT_AXIS_FACE];
        shouldRotate = (sticker) => dot(sticker.position, MEGAMINX_FACE_NORMALS[MEGAMINX_LEFT_FACE]) < MEGAMINX_LAYER_THRESHOLD;
    }

    const angle = move.turns * MEGAMINX_FIFTH_TURN_RAD;

    stickers.forEach((sticker) => {
        if (!shouldRotate(sticker)) return;
        sticker.position = rotateVectorAroundAxis(sticker.position, axis, angle);
        sticker.normal = rotateVectorAroundAxis(sticker.normal, axis, angle);
    });
}

function materializeMegaminxFaces(stickers) {
    const faces = MEGAMINX_FACE_METAS.map((face) => new Array(MEGAMINX_FACE_SIZE).fill(face.face));
    const occupiedSlots = MEGAMINX_FACE_METAS.map(() => new Set());

    stickers.forEach((sticker) => {
        const faceIndex = resolveMegaminxFaceIndex(sticker.normal);
        const face = MEGAMINX_FACE_METAS[faceIndex];
        const slotCandidates = face.solvedSlots
            .map((slot, index) => ({ index, distance: distanceSquared(sticker.position, slot) }))
            .sort((a, b) => a.distance - b.distance);
        const nextSlot = slotCandidates.find(({ index }) => !occupiedSlots[faceIndex].has(index)) ?? slotCandidates[0];

        occupiedSlots[faceIndex].add(nextSlot.index);
        faces[faceIndex][nextSlot.index] = sticker.color;
    });

    return faces;
}

export function applyMegaminxScramble(scramble) {
    const stickers = createSolvedMegaminxState();

    if (scramble) {
        String(scramble)
            .trim()
            .split(/\s+/)
            .forEach((token) => {
                const parsedMove = parseMegaminxMoveToken(token);
                applyMegaminxMove(stickers, parsedMove);
            });
    }

    return materializeMegaminxFaces(stickers);
}

export function drawCube(canvas, cube) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;
    const cubeSize = getFaceSize(cube?.[0]);

    const faceGap = Math.max(2, Math.min(w, h) * 0.02);
    const availW = w - (faceGap * 3);
    const availH = h - (faceGap * 2);
    const cellSize = Math.min(availW / (cubeSize * 4), availH / (cubeSize * 3));
    const faceSize = cellSize * cubeSize;
    const stickerGap = cellSize * STICKER_GAP_TO_CELL_RATIO;

    const totalW = (faceSize * 4) + (faceGap * 3);
    const totalH = (faceSize * 3) + (faceGap * 2);
    const offsetX = (w - totalW) / 2;
    const offsetY = (h - totalH) / 2;

    ctx.clearRect(0, 0, w, h);

    for (let face = 0; face < 6; face += 1) {
        const [fc, fr] = FACE_POSITIONS[face];
        const fx = offsetX + (fc * (faceSize + faceGap));
        const fy = offsetY + (fr * (faceSize + faceGap));

        for (let row = 0; row < cubeSize; row += 1) {
            for (let col = 0; col < cubeSize; col += 1) {
                const x = fx + (col * cellSize) + stickerGap;
                const y = fy + (row * cellSize) + stickerGap;
                const sizePx = cellSize - (stickerGap * 2);
                const sticker = cube[face][(row * cubeSize) + col];

                ctx.fillStyle = COLORS[sticker] || '#FFF';
                ctx.beginPath();
                const radius = Math.max(0.6, sizePx * 0.08);
                ctx.moveTo(x + radius, y);
                ctx.arcTo(x + sizePx, y, x + sizePx, y + sizePx, radius);
                ctx.arcTo(x + sizePx, y + sizePx, x, y + sizePx, radius);
                ctx.arcTo(x, y + sizePx, x, y, radius);
                ctx.arcTo(x, y, x + sizePx, y, radius);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = 'rgba(0,0,0,0.4)';
                ctx.lineWidth = Math.max(0.45, Math.min(1, cellSize * 0.06));
                ctx.stroke();
            }
        }
    }
}

function tracePolygon(ctx, points) {
    if (!Array.isArray(points) || points.length === 0) return;

    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);

    for (let index = 1; index < points.length; index += 1) {
        ctx.lineTo(points[index][0], points[index][1]);
    }

    ctx.closePath();
}

function createInsetTriangle(points, insetDistance) {
    const centroid = averagePoints(points);
    const sideLength = distance2D(points[0], points[1]);
    const inradius = (sideLength * Math.sqrt(3)) / 6;
    const scale = inradius > 0 ? Math.max(0, 1 - (insetDistance / inradius)) : 1;

    return points.map((point) => [
        centroid[0] + ((point[0] - centroid[0]) * scale),
        centroid[1] + ((point[1] - centroid[1]) * scale),
    ]);
}

function createInsetPolygon(points, insetDistance) {
    const centroid = averagePoints(points);
    const maxDistance = Math.max(
        ...points.map((point) => distance2D(point, centroid)),
        0,
    );
    const scale = maxDistance > 0 ? Math.max(0, 1 - (insetDistance / maxDistance)) : 1;

    return points.map((point) => [
        centroid[0] + ((point[0] - centroid[0]) * scale),
        centroid[1] + ((point[1] - centroid[1]) * scale),
    ]);
}

function createRegularPentagonVertices(centerX, centerY, radius, rotation = 0) {
    return Array.from({ length: 5 }, (_, index) => {
        const angle = rotation + (index * ((2 * Math.PI) / 5));
        return [
            centerX + (Math.cos(angle) * radius),
            centerY + (Math.sin(angle) * radius),
        ];
    });
}

function reflectPointAcrossLine2D(point, lineStart, lineEnd) {
    const [px, py] = point;
    const [ax, ay] = lineStart;
    const [bx, by] = lineEnd;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = (dx * dx) + (dy * dy);
    if (lengthSquared === 0) return [px, py];

    const factor = (((px - ax) * dx) + ((py - ay) * dy)) / lengthSquared;
    const projection = [
        ax + (factor * dx),
        ay + (factor * dy),
    ];

    return [
        (projection[0] * 2) - px,
        (projection[1] * 2) - py,
    ];
}

function reflectPolygon2D(points, edgeIndex) {
    const edgeStart = points[edgeIndex];
    const edgeEnd = points[(edgeIndex + 1) % points.length];
    return points.map((point) => reflectPointAcrossLine2D(point, edgeStart, edgeEnd));
}

function getPolygonBounds(polygons) {
    const allPoints = polygons.flat();
    const xs = allPoints.map(([x]) => x);
    const ys = allPoints.map(([, y]) => y);

    return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
    };
}

function getSignedPolygonArea(points) {
    let area = 0;

    for (let index = 0; index < points.length; index += 1) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        area += (current[0] * next[1]) - (next[0] * current[1]);
    }

    return area / 2;
}

function scaleAndTranslatePolygon(points, scale, offsetX, offsetY) {
    return points.map(([x, y]) => [
        offsetX + (x * scale),
        offsetY + (y * scale),
    ]);
}

function interpolatePoint2D(a, b, ratio) {
    return [
        a[0] + ((b[0] - a[0]) * ratio),
        a[1] + ((b[1] - a[1]) * ratio),
    ];
}

function getMegaminxEdgeSlotIndex(neighborIndex) {
    return neighborIndex === 0 ? 10 : neighborIndex * 2;
}

function getMegaminxCornerSlotIndex(neighborIndex) {
    return neighborIndex === 0 ? 9 : (neighborIndex * 2) - 1;
}

function findMegaminxEdgeNeighborStartForStep(faceId, anchorFaceId, anchorEdge = 0, edgeNeighborStep = 1) {
    const anchorNeighborIndex = MEGAMINX_FACE_NEIGHBORS[faceId].indexOf(anchorFaceId);
    return edgeNeighborStep >= 0
        ? positiveModulo(anchorNeighborIndex - anchorEdge, 5)
        : positiveModulo(anchorNeighborIndex + anchorEdge, 5);
}

function getPyraminxScreenTriangleVertices(x, y, sideLength, triangleHeight, orientation = 'down') {
    if (orientation === 'up') {
        return [
            [x, y + triangleHeight],
            [x + sideLength, y + triangleHeight],
            [x + (sideLength / 2), y],
        ];
    }

    return [
        [x, y],
        [x + sideLength, y],
        [x + (sideLength / 2), y + triangleHeight],
    ];
}

function drawPyraminxFace(ctx, face, vertices, sideLength) {
    const smallSide = sideLength / PYRAMINX_FACE_SIZE;
    const stickerGap = smallSide * STICKER_GAP_TO_CELL_RATIO;
    const outlineWidth = Math.max(0.45, Math.min(1, smallSide * 0.06));
    const [a, b, c] = vertices;

    PYRAMINX_TRIANGLE_DEFINITIONS.forEach((triangle, index) => {
        const stickerPoints = createInsetTriangle(
            triangle.map(([u, v]) => interpolateTrianglePoint(a, b, c, u, v)),
            stickerGap,
        );
        const stickerColor = face[index];

        ctx.fillStyle = PYRAMINX_COLORS[stickerColor] || PYRAMINX_COLORS[0];
        tracePolygon(ctx, stickerPoints);
        ctx.fill();

        ctx.strokeStyle = PYRAMINX_STICKER_OUTLINE;
        ctx.lineWidth = outlineWidth;
        ctx.stroke();
    });
}

export function drawPyraminx(canvas, pyraminx) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;

    ctx.clearRect(0, 0, w, h);

    if (!Array.isArray(pyraminx) || pyraminx.length === 0) {
        return;
    }

    const margin = Math.max(10, Math.min(w, h) * 0.06);
    const maxWidthUnits = 1 + (PYRAMINX_FACE_HORIZONTAL_STEP_RATIO * 2);
    const maxHeightUnits = (PYRAMINX_TRIANGLE_HEIGHT_RATIO * 2) + PYRAMINX_FACE_VERTICAL_GAP_RATIO;
    const sideLength = Math.max(0, Math.min(
        (w - (margin * 2)) / maxWidthUnits,
        (h - (margin * 2)) / maxHeightUnits,
    ));
    const triangleHeight = sideLength * PYRAMINX_TRIANGLE_HEIGHT_RATIO;
    const verticalGap = sideLength * PYRAMINX_FACE_VERTICAL_GAP_RATIO;
    const offsetX = (w - (sideLength * maxWidthUnits)) / 2;
    const offsetY = (h - ((triangleHeight * 2) + verticalGap)) / 2;
    const faceOrigins = [
        [offsetX, offsetY],
        [offsetX + (sideLength * PYRAMINX_FACE_HORIZONTAL_STEP_RATIO), offsetY],
        [offsetX + (sideLength * PYRAMINX_FACE_HORIZONTAL_STEP_RATIO * 2), offsetY],
        [offsetX + (sideLength * PYRAMINX_FACE_HORIZONTAL_STEP_RATIO), offsetY + triangleHeight + verticalGap],
    ];

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    faceOrigins.forEach(([x, y], faceIndex) => {
        const config = PYRAMINX_FACE_DRAW_CONFIGS[faceIndex] || PYRAMINX_FACE_DRAW_CONFIGS[3];
        const baseVertices = getPyraminxScreenTriangleVertices(
            x,
            y,
            sideLength,
            triangleHeight,
            config.orientation,
        );
        const faceVertices = config.vertexOrder.map((vertexIndex) => baseVertices[vertexIndex]);

        drawPyraminxFace(
            ctx,
            pyraminx[faceIndex] || [],
            faceVertices,
            sideLength,
        );
    });

    ctx.restore();
}

function createMegaminxLayoutTemplate() {
    const layouts = [];
    const leftCenterPolygon = createRegularPentagonVertices(0, 0, 1, MEGAMINX_U_STAR_ROTATION);
    const rightCenterPolygon = createRegularPentagonVertices(
        MEGAMINX_RIGHT_STAR_OFFSET_X,
        MEGAMINX_RIGHT_STAR_OFFSET_Y,
        1,
        MEGAMINX_D_STAR_ROTATION,
    );
    const referenceOrientationSign = Math.sign(getSignedPolygonArea(leftCenterPolygon)) || 1;
    const getEdgeNeighborStep = (polygon) => (
        (Math.sign(getSignedPolygonArea(polygon)) || referenceOrientationSign) === referenceOrientationSign ? 1 : -1
    );
    const leftCenterStep = getEdgeNeighborStep(leftCenterPolygon);
    const rightCenterStep = getEdgeNeighborStep(rightCenterPolygon);

    layouts.push({
        faceId: MEGAMINX_U_FACE,
        polygon: leftCenterPolygon,
        edgeNeighborStart: findMegaminxEdgeNeighborStartForStep(
            MEGAMINX_U_FACE,
            MEGAMINX_U_STAR_EDGE_TO_FACE[0],
            0,
            leftCenterStep,
        ),
        edgeNeighborStep: leftCenterStep,
        label: 'U',
    });
    MEGAMINX_U_STAR_EDGE_TO_FACE.forEach((faceId, edgeIndex) => {
        const polygon = reflectPolygon2D(leftCenterPolygon, edgeIndex);
        const edgeNeighborStep = getEdgeNeighborStep(polygon);
        layouts.push({
            faceId,
            polygon,
            edgeNeighborStart: findMegaminxEdgeNeighborStartForStep(
                faceId,
                MEGAMINX_U_FACE,
                edgeIndex,
                edgeNeighborStep,
            ),
            edgeNeighborStep,
            label: faceId === MEGAMINX_FRONT_FACE ? 'F' : '',
        });
    });

    layouts.push({
        faceId: MEGAMINX_D_FACE,
        polygon: rightCenterPolygon,
        edgeNeighborStart: findMegaminxEdgeNeighborStartForStep(
            MEGAMINX_D_FACE,
            MEGAMINX_D_STAR_EDGE_TO_FACE[0],
            0,
            rightCenterStep,
        ),
        edgeNeighborStep: rightCenterStep,
        label: '',
    });
    MEGAMINX_D_STAR_EDGE_TO_FACE.forEach((faceId, edgeIndex) => {
        const polygon = reflectPolygon2D(rightCenterPolygon, edgeIndex);
        const edgeNeighborStep = getEdgeNeighborStep(polygon);
        layouts.push({
            faceId,
            polygon,
            edgeNeighborStart: findMegaminxEdgeNeighborStartForStep(
                faceId,
                MEGAMINX_D_FACE,
                edgeIndex,
                edgeNeighborStep,
            ),
            edgeNeighborStep,
            label: '',
        });
    });

    return {
        faces: layouts,
        bounds: getPolygonBounds(layouts.map(({ polygon }) => polygon)),
    };
}

const MEGAMINX_LAYOUT_TEMPLATE = createMegaminxLayoutTemplate();
const MEGAMINX_PREVIEW_FACE_EDGE_NEIGHBOR_START = MEGAMINX_LAYOUT_TEMPLATE.faces.find(
    ({ faceId }) => faceId === MEGAMINX_U_FACE,
)?.edgeNeighborStart ?? 0;

function drawMegaminxSticker(ctx, polygon, color, insetDistance, outlineWidth) {
    const insetPolygon = createInsetPolygon(polygon, insetDistance);
    ctx.fillStyle = color;
    tracePolygon(ctx, insetPolygon);
    ctx.fill();

    ctx.strokeStyle = MEGAMINX_STICKER_OUTLINE;
    ctx.lineWidth = outlineWidth;
    ctx.stroke();
}

function drawMegaminxFace(ctx, face, polygon, edgeNeighborStart = 0, edgeNeighborStep = 1) {
    const centroid = averagePoints(polygon);
    const innerPolygon = polygon.map(([x, y]) => [
        centroid[0] + ((x - centroid[0]) * MEGAMINX_INNER_PENTAGON_SCALE),
        centroid[1] + ((y - centroid[1]) * MEGAMINX_INNER_PENTAGON_SCALE),
    ]);
    const edgeCutsNearStart = polygon.map((point, edgeIndex) => (
        interpolatePoint2D(point, polygon[(edgeIndex + 1) % 5], MEGAMINX_EDGE_SPLIT_RATIO)
    ));
    const edgeCutsNearEnd = polygon.map((point, edgeIndex) => (
        interpolatePoint2D(point, polygon[(edgeIndex + 1) % 5], 1 - MEGAMINX_EDGE_SPLIT_RATIO)
    ));
    const sideLength = distance2D(polygon[0], polygon[1]);
    const insetDistance = Math.max(0.4, sideLength * 0.032);
    const outlineWidth = Math.max(0.55, Math.min(1.25, sideLength * 0.03));

    for (let edgeIndex = 0; edgeIndex < 5; edgeIndex += 1) {
        const neighborIndex = positiveModulo(edgeNeighborStart + (edgeNeighborStep * edgeIndex), 5);
        const cornerNeighborIndex = edgeNeighborStep >= 0
            ? neighborIndex
            : positiveModulo(neighborIndex + 1, 5);
        const cornerSlot = getMegaminxCornerSlotIndex(cornerNeighborIndex);
        const edgeSlot = getMegaminxEdgeSlotIndex(neighborIndex);
        const nextIndex = (edgeIndex + 1) % 5;
        const previousIndex = positiveModulo(edgeIndex - 1, 5);
        const cornerColor = MEGAMINX_COLORS[face?.[cornerSlot]] || MEGAMINX_COLORS[0];
        const edgeColor = MEGAMINX_COLORS[face?.[edgeSlot]] || MEGAMINX_COLORS[0];

        drawMegaminxSticker(
            ctx,
            [
                edgeCutsNearEnd[previousIndex],
                polygon[edgeIndex],
                edgeCutsNearStart[edgeIndex],
                innerPolygon[edgeIndex],
            ],
            cornerColor,
            insetDistance,
            outlineWidth,
        );
        drawMegaminxSticker(
            ctx,
            [
                edgeCutsNearStart[edgeIndex],
                edgeCutsNearEnd[edgeIndex],
                innerPolygon[nextIndex],
                innerPolygon[edgeIndex],
            ],
            edgeColor,
            insetDistance,
            outlineWidth,
        );
    }

    drawMegaminxSticker(
        ctx,
        innerPolygon,
        MEGAMINX_COLORS[face?.[0]] || MEGAMINX_COLORS[0],
        insetDistance * 0.72,
        outlineWidth,
    );
}

function drawMegaminxFaceLabel(ctx, polygon, label) {
    if (!label) return;

    const centroid = averagePoints(polygon);
    const sideLength = distance2D(polygon[0], polygon[1]);
    const fontSize = Math.max(13, Math.min(34, sideLength * 0.36));

    ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(1.4, fontSize * 0.14);
    ctx.strokeStyle = MEGAMINX_LABEL_STYLE.stroke;
    ctx.fillStyle = MEGAMINX_LABEL_STYLE.fill;
    ctx.strokeText(label, centroid[0], centroid[1] + (fontSize * 0.02));
    ctx.fillText(label, centroid[0], centroid[1] + (fontSize * 0.02));
}

function drawMegaminxLayout(ctx, megaminx, layoutFaces, scale, offsetX, offsetY, { showLabels = true } = {}) {
    layoutFaces.forEach(({ faceId, polygon, edgeNeighborStart, edgeNeighborStep = 1 }) => {
        const transformedPolygon = scaleAndTranslatePolygon(polygon, scale, offsetX, offsetY);
        drawMegaminxFace(
            ctx,
            megaminx?.[faceId] || [],
            transformedPolygon,
            edgeNeighborStart,
            edgeNeighborStep,
        );
    });

    if (!showLabels) return;

    layoutFaces.forEach(({ polygon, label }) => {
        if (!label) return;
        const transformedPolygon = scaleAndTranslatePolygon(polygon, scale, offsetX, offsetY);
        drawMegaminxFaceLabel(ctx, transformedPolygon, label);
    });
}

export function drawMegaminx(canvas, megaminx) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;

    ctx.clearRect(0, 0, w, h);

    if (!Array.isArray(megaminx) || megaminx.length === 0) {
        return;
    }

    const margin = Math.max(4, Math.min(w, h) * 0.02);
    const templateWidth = MEGAMINX_LAYOUT_TEMPLATE.bounds.maxX - MEGAMINX_LAYOUT_TEMPLATE.bounds.minX;
    const templateHeight = MEGAMINX_LAYOUT_TEMPLATE.bounds.maxY - MEGAMINX_LAYOUT_TEMPLATE.bounds.minY;
    const scale = Math.max(0, Math.min(
        (w - (margin * 2)) / templateWidth,
        (h - (margin * 2)) / templateHeight,
    ));
    const offsetX = ((w - (templateWidth * scale)) / 2) - (MEGAMINX_LAYOUT_TEMPLATE.bounds.minX * scale);
    const offsetY = ((h - (templateHeight * scale)) / 2) - (MEGAMINX_LAYOUT_TEMPLATE.bounds.minY * scale);

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    drawMegaminxLayout(
        ctx,
        megaminx,
        MEGAMINX_LAYOUT_TEMPLATE.faces,
        scale,
        offsetX,
        offsetY,
        { showLabels: true },
    );
    ctx.restore();
}

export function drawMegaminxFacePreview(canvas, face, { label = '' } = {}) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;
    const margin = Math.max(1.4, Math.min(w, h) * 0.08);
    const radius = Math.max(0, Math.min(w, h) - (margin * 2)) / 2;
    const polygon = createRegularPentagonVertices(w / 2, h / 2, radius, MEGAMINX_U_STAR_ROTATION);

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    drawMegaminxFace(ctx, face, polygon, MEGAMINX_PREVIEW_FACE_EDGE_NEIGHBOR_START, 1);
    if (label) drawMegaminxFaceLabel(ctx, polygon, label);
    ctx.restore();
}

let _lastDisplay = null;

function redrawLastDisplay(canvas) {
    if (!_lastDisplay) return;

    if (_lastDisplay.puzzle === 'pyraminx') {
        drawPyraminx(canvas, _lastDisplay.state);
        return;
    }

    if (_lastDisplay.puzzle === 'megaminx') {
        drawMegaminx(canvas, _lastDisplay.state);
        return;
    }

    drawCube(canvas, _lastDisplay.state);
}

export function clearCubeDisplay(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;
    _lastDisplay = null;
    ctx.clearRect(0, 0, w, h);
}

export function initCubeDisplay(canvas) {
    const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
            const { width, height } = entry.contentRect;
            if (width === 0 || height === 0) return;
            canvas.width = width * devicePixelRatio;
            canvas.height = height * devicePixelRatio;
            const ctx = canvas.getContext('2d');
            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
            if (_lastDisplay) {
                redrawLastDisplay(canvas);
            } else {
                clearCubeDisplay(canvas);
            }
        }
    });

    observer.observe(canvas.parentElement);
    return observer;
}

export function updateCubeDisplay(canvas, scramble, orientation = 'standard', size = 3) {
    _lastDisplay = {
        puzzle: 'cube',
        state: applyScramble(scramble, orientation, size),
    };
    const ctx = canvas.getContext('2d');
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    redrawLastDisplay(canvas);
}

export function updatePyraminxDisplay(canvas, scramble) {
    _lastDisplay = {
        puzzle: 'pyraminx',
        state: applyPyraminxScramble(scramble),
    };
    const ctx = canvas.getContext('2d');
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    redrawLastDisplay(canvas);
}

export function updateMegaminxDisplay(canvas, scramble) {
    _lastDisplay = {
        puzzle: 'megaminx',
        state: applyMegaminxScramble(scramble),
    };
    const ctx = canvas.getContext('2d');
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    redrawLastDisplay(canvas);
}
