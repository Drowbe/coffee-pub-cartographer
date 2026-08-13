// How a thumbnail frames a map.
//
// A whole dungeon shrunk into 96px puts several squares in a pixel, so every map
// comes back the same grey blob. Squares are held to a minimum size instead and
// the map is cropped to whatever fits. This checks the framing maths: that small
// maps are untouched, that large ones are cropped around where the squares
// actually are, and that the crop always lands on ink.
import fs from 'node:fs';

const src = fs.readFileSync('scripts/window-mapping.js', 'utf8');
const SIZE = Number(src.match(/const THUMBNAIL_SIZE = (\d+)/)[1]);
const MIN = Number(src.match(/const MIN_THUMBNAIL_SQUARE = (\d+)/)[1]);

// The framing, lifted from _mapThumbnail so the sums under test are the shipped
// ones. Only the canvas calls are left behind.
const body = src.slice(src.indexOf('        const columns = maxColumn - minColumn + 1;'),
    src.indexOf('        // Themed here rather than read from CSS'));
const frame = eval(`(cells => {
    const THUMBNAIL_SIZE = ${SIZE}, MIN_THUMBNAIL_SQUARE = ${MIN};
    let minColumn = Infinity, minRow = Infinity, maxColumn = -Infinity, maxRow = -Infinity;
    let sumColumn = 0, sumRow = 0;
    for (const [column, row] of cells) {
        minColumn = Math.min(minColumn, column); minRow = Math.min(minRow, row);
        maxColumn = Math.max(maxColumn, column); maxRow = Math.max(maxRow, row);
        sumColumn += column; sumRow += row;
    }
${body}
    return { scale, windowSize, startColumn, startRow, columns, rows, minColumn, minRow, maxColumn, maxRow };
})`);

let bad = 0;
const check = (label, actual, expected) => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) { console.log('  ok    ' + label); return; }
    bad++; console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};
const near = (label, actual, expected, tolerance = 0.01) => {
    if (Math.abs(actual - expected) <= tolerance) { console.log('  ok    ' + label); return; }
    bad++; console.log(`  FAIL  ${label}: expected ~${expected}, got ${actual}`);
};
const block = (x0, y0, x1, y1) => {
    const cells = [];
    for (let row = y0; row <= y1; row++) for (let column = x0; column <= x1; column++) cells.push([column, row]);
    return cells;
};
// How much of the tile the drawing actually covers.
const covered = (cells, f) => {
    let painted = 0;
    for (const [column, row] of cells) {
        const x = (column - f.startColumn) * f.scale;
        const y = (row - f.startRow) * f.scale;
        if (x <= -f.scale || y <= -f.scale || x >= SIZE || y >= SIZE) continue;
        painted++;
    }
    return painted;
};

console.log(`tile ${SIZE}px, squares no smaller than ${MIN}px`);

console.log('\na small map still fits whole, exactly as before');
{
    const cells = block(0, 0, 5, 5);       // 6x6
    const f = frame(cells);
    near('scaled to fit', f.scale, SIZE / 6);
    check('nothing is cropped', covered(cells, f), cells.length);
    near('and it is centred', f.startColumn, 0);
}

console.log('\na large map is cropped rather than shrunk');
{
    const cells = block(0, 0, 199, 149);   // 200x150 -- a whole level
    const f = frame(cells);
    check('squares are not allowed below the minimum', f.scale, MIN);
    near('so the tile shows a window of squares', f.windowSize, SIZE / MIN);
    const shown = covered(cells, f);
    // Squares straddling the edge are drawn and clipped by the tile, so the
    // count is the window plus its border rather than the window exactly.
    const least = Math.floor(f.windowSize) ** 2;
    const most = Math.ceil(f.windowSize + 1) ** 2;
    if (shown < least || shown > most) {
        bad++; console.log(`  FAIL  the window is not full: ${shown} not in ${least}..${most}`);
    } else console.log(`  ok    the window is full of map (${shown} squares)`);
    if (shown >= cells.length) { bad++; console.log('  FAIL  nothing was cropped'); }
    else console.log(`  ok    ${shown} of ${cells.length} squares shown, the rest cropped`);
}

console.log('\nthe crop lands on the squares, not on empty ground');
{
    // A big room in one corner with a long thin corridor running away from it.
    // The bounding box's middle is out in the dark; the squares are not.
    const cells = [...block(0, 0, 19, 19), ...block(20, 10, 120, 10)];
    const f = frame(cells);
    const shown = covered(cells, f);
    if (!shown) { bad++; console.log('  FAIL  the thumbnail came back blank'); }
    else console.log(`  ok    ${shown} squares land in the tile`);
    // The midpoint of the bounding box would sit in the corridor's empty half.
    const boxMiddle = (f.minColumn + f.maxColumn + 1) / 2;
    const windowMiddle = f.startColumn + (f.windowSize / 2);
    if (windowMiddle >= boxMiddle) {
        bad++; console.log('  FAIL  framed on the bounding box rather than the squares');
    } else console.log('  ok    framed nearer the mass of squares than the box middle');
}

console.log('\nthe window never runs off the end of the map');
{
    for (const [label, cells] of [
        ['squares crowded at the low corner', [...block(0, 0, 30, 30), [200, 200]]],
        ['squares crowded at the high corner', [...block(170, 170, 200, 200), [0, 0]]]
    ]) {
        const f = frame(cells);
        const withinLow = f.startColumn >= f.minColumn - 0.001 && f.startRow >= f.minRow - 0.001;
        const withinHigh = f.startColumn + f.windowSize <= f.maxColumn + 1.001
            && f.startRow + f.windowSize <= f.maxRow + 1.001;
        if (!withinLow || !withinHigh) { bad++; console.log(`  FAIL  ${label}: window escaped the map`); }
        else console.log(`  ok    ${label}`);
        if (!covered(cells, f)) { bad++; console.log(`  FAIL  ${label}: tile is blank`); }
    }
}

console.log('\na map wide but not tall is centred on the short axis');
{
    const cells = block(0, 0, 199, 3);     // 200x4
    const f = frame(cells);
    check('squares held at the minimum', f.scale, MIN);
    // Four rows cannot fill a window of windowSize, so they sit in the middle.
    near('rows centred rather than pinned to the top',
        f.startRow, f.minRow - ((f.windowSize - 4) / 2));
    if (!covered(cells, f)) { bad++; console.log('  FAIL  blank'); }
    else console.log('  ok    and the strip is drawn');
}

console.log('\na single square does not divide by zero or vanish');
{
    const f = frame([[7, 7]]);
    check('scaled to the whole tile', f.scale, SIZE);
    if (!covered([[7, 7]], f)) { bad++; console.log('  FAIL  the one square is not drawn'); }
    else console.log('  ok    the one square is drawn');
}

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);
