// ==================================================================
// ===== MAPPING SYMBOL CATALOG =====================================
// ==================================================================

const frame = '<rect class="symbol-frame" x="7" y="9" width="86" height="82"></rect>';
const text = (value, x = 50, y = 53, className = '') =>
    `<text class="symbol-text ${className}" x="${x}" y="${y}">${value}</text>`;
const boxed = content => `${frame}${content}`;
const line = (x1, y1, x2, y2, className = '') =>
    `<line class="${className}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line>`;
const circle = (cx, cy, r, className = '') =>
    `<circle class="${className}" cx="${cx}" cy="${cy}" r="${r}"></circle>`;
const rect = (x, y, width, height, className = '') =>
    `<rect class="${className}" x="${x}" y="${y}" width="${width}" height="${height}"></rect>`;

function stairs(direction = 'up') {
    const bars = [26, 34, 42, 50, 58, 66, 74].map(x => line(x, 25, x, 75, 'symbol-thin')).join('');
    const arrow = direction === 'up'
        ? `${line(20, 50, 79, 50)}<polyline points="69,40 79,50 69,60"></polyline>${text('U', 17, 54, 'symbol-small')}`
        : `${line(80, 50, 21, 50)}<polyline points="31,40 21,50 31,60"></polyline>${text('D', 83, 54, 'symbol-small')}`;
    return boxed(`${bars}${arrow}`);
}

function spiralStairs(direction = 'up') {
    const spokes = [
        line(50, 50, 50, 21, 'symbol-thin'), line(50, 50, 71, 29, 'symbol-thin'),
        line(50, 50, 79, 50, 'symbol-thin'), line(50, 50, 71, 71, 'symbol-thin'),
        line(50, 50, 50, 79, 'symbol-thin'), line(50, 50, 29, 71, 'symbol-thin'),
        line(50, 50, 21, 50, 'symbol-thin'), line(50, 50, 29, 29, 'symbol-thin')
    ].join('');
    const arrow = direction === 'up'
        ? '<path d="M22 61 A31 31 0 0 1 69 27"></path><polyline points="57,26 70,27 68,40"></polyline>'
        : '<path d="M78 39 A31 31 0 0 1 31 73"></path><polyline points="43,74 30,73 32,60"></polyline>';
    return boxed(`${circle(50, 50, 29, 'symbol-thin')}${spokes}${arrow}${text(direction === 'up' ? 'U' : 'D', 50, 54, 'symbol-small')}`);
}

function ladder(direction = 'up') {
    const rungs = [31, 41, 51, 61, 71].map(y => line(38, y, 62, y, 'symbol-thin')).join('');
    const arrow = direction === 'up'
        ? `${line(73, 70, 73, 29)}<polyline points="65,38 73,28 81,38"></polyline>`
        : `${line(73, 30, 73, 71)}<polyline points="65,62 73,72 81,62"></polyline>`;
    return boxed(`${line(38, 24, 38, 77)}${line(62, 24, 62, 77)}${rungs}${arrow}${text(direction === 'up' ? 'U' : 'D', 25, 54, 'symbol-small')}`);
}

const symbol = (labelKey, markup) => Object.freeze({ labelKey, markup });

export const MAPPING_SYMBOLS = Object.freeze({
    'stairs-up': symbol('mapping.symbolStairsUp', stairs('up')),
    'stairs-down': symbol('mapping.symbolStairsDown', stairs('down')),
    'spiral-stairs-up': symbol('mapping.symbolSpiralStairsUp', spiralStairs('up')),
    'spiral-stairs-down': symbol('mapping.symbolSpiralStairsDown', spiralStairs('down')),
    'ladder-up': symbol('mapping.symbolLadderUp', ladder('up')),
    'ladder-down': symbol('mapping.symbolLadderDown', ladder('down')),
    slide: symbol('mapping.symbolSlide', boxed('<path d="M22 62 C31 31 57 71 76 38"></path><polyline points="65,40 77,37 76,50"></polyline>')),

    'trap-door-floor': symbol('mapping.symbolTrapDoorFloor', boxed(circle(50, 50, 25) + text('F'))),
    'trap-door-ceiling': symbol('mapping.symbolTrapDoorCeiling', boxed(circle(50, 50, 25) + text('C'))),
    'secret-trap-door': symbol('mapping.symbolSecretTrapDoor', boxed(circle(50, 50, 25) + text('S'))),
    trap: symbol('mapping.symbolTrap', boxed(text('T', 50, 54, 'symbol-large'))),
    trigger: symbol('mapping.symbolTrigger', boxed(`${line(50, 24, 50, 76)}${line(24, 50, 76, 50)}${line(31, 31, 69, 69)}${line(69, 31, 31, 69)}`)),
    lever: symbol('mapping.symbolLever', boxed('<path d="M32 69 L50 57 L67 69 Z"></path>' + line(50, 57, 68, 29) + circle(70, 26, 5, 'symbol-fill'))),
    'stairs-slide-trap': symbol('mapping.symbolStairsSlideTrap', stairs('up').replace(frame, frame + '<path class="symbol-heavy" d="M25 69 L75 31"></path><polyline points="64,31 76,30 75,42"></polyline>')),

    'open-pit-square': symbol('mapping.symbolOpenPitSquare', boxed(rect(29, 29, 42, 42) + rect(36, 36, 28, 28, 'symbol-fill'))),
    'covered-pit-square': symbol('mapping.symbolCoveredPitSquare', boxed(`${rect(27, 27, 46, 46)}${line(27, 27, 73, 73)}${line(73, 27, 27, 73)}`)),
    'open-pit-round': symbol('mapping.symbolOpenPitRound', boxed(circle(50, 50, 24) + circle(50, 50, 15, 'symbol-fill'))),
    'covered-pit-round': symbol('mapping.symbolCoveredPitRound', boxed(`${circle(50, 50, 24)}${line(33, 33, 67, 67)}${line(67, 33, 33, 67)}`)),
    'hole-ceiling': symbol('mapping.symbolHoleCeiling', boxed('<path d="M21 50 L31 43 L27 32 L41 34 L50 21 L59 34 L73 32 L69 43 L79 50 L69 57 L73 68 L59 66 L50 79 L41 66 L27 68 L31 57 Z"></path>' + text('C', 50, 54, 'symbol-small'))),
    'hole-floor': symbol('mapping.symbolHoleFloor', boxed('<path d="M18 51 L29 42 L25 30 L40 34 L49 20 L59 34 L74 29 L70 43 L82 51 L69 59 L74 72 L59 67 L49 81 L40 67 L25 72 L30 59 Z"></path>' + text('F', 50, 54, 'symbol-small'))),

    pool: symbol('mapping.symbolPool', boxed(`${rect(20, 27, 60, 48)}<path class="symbol-thin" d="M26 43 Q34 35 42 43 T58 43 T74 43"></path><path class="symbol-thin" d="M26 57 Q34 49 42 57 T58 57 T74 57"></path>`)),
    fountain: symbol('mapping.symbolFountain', boxed(`${circle(50, 50, 25)}${circle(50, 50, 5, 'symbol-fill')}<path class="symbol-thin" d="M50 45 Q35 35 32 50 M50 45 Q65 35 68 50 M50 55 Q35 65 32 50 M50 55 Q65 65 68 50"></path>`)),
    'well-square': symbol('mapping.symbolWellSquare', boxed(`${rect(29, 29, 42, 42)}${rect(40, 40, 20, 20, 'symbol-fill')}`)),
    'well-round': symbol('mapping.symbolWellRound', boxed(`${circle(50, 50, 24)}${circle(50, 50, 12, 'symbol-fill')}`)),

    'fire-pit': symbol('mapping.symbolFirePit', boxed(`${circle(50, 53, 27)}<path class="symbol-fill" d="M50 73 C30 61 41 49 36 37 C47 41 48 29 54 21 C58 36 70 41 68 54 C67 66 59 72 50 73 Z"></path>`)),
    fireplace: symbol('mapping.symbolFireplace', boxed('<path d="M23 69 L23 39 L34 39 L34 30 L66 30 L66 39 L77 39 L77 69 Z"></path><path class="symbol-fill" d="M38 68 L38 50 Q50 39 62 50 L62 68 Z"></path>')),

    dais: symbol('mapping.symbolDais', boxed('<path d="M20 72 A30 30 0 0 1 80 72"></path><path class="symbol-thin" d="M28 72 A22 22 0 0 1 72 72 M36 72 A14 14 0 0 1 64 72"></path>')),
    altar: symbol('mapping.symbolAltar', boxed(`${rect(22, 36, 56, 30)}${circle(37, 51, 4, 'symbol-fill')}${circle(63, 51, 4, 'symbol-fill')}`)),
    'pillar-square': symbol('mapping.symbolPillarSquare', boxed(rect(40, 40, 20, 20, 'symbol-fill'))),
    'pillar-round': symbol('mapping.symbolPillarRound', boxed(circle(50, 50, 11, 'symbol-fill'))),
    'tunnel-subterranean': symbol('mapping.symbolTunnelSubterranean', boxed(`${rect(16, 31, 68, 38, 'symbol-fill')}<path class="symbol-cutout symbol-dash" d="M18 50 L82 50"></path>`)),

    chair: symbol('mapping.symbolChair', boxed(`${rect(36, 35, 28, 28)}${line(35, 31, 65, 31)}${line(37, 63, 34, 74)}${line(63, 63, 66, 74)}`)),
    'padded-chair': symbol('mapping.symbolPaddedChair', boxed(`${rect(34, 33, 32, 34)}${rect(39, 38, 22, 20, 'symbol-fill-soft')}${line(35, 29, 65, 29)}${line(37, 67, 34, 75)}${line(63, 67, 66, 75)}`)),
    throne: symbol('mapping.symbolThrone', boxed('<path d="M31 72 L31 30 L39 30 L43 22 L50 31 L57 22 L61 30 L69 30 L69 72 Z"></path>' + rect(38, 43, 24, 22, 'symbol-fill-soft'))),
    stool: symbol('mapping.symbolStool', boxed(`${circle(50, 39, 15)}${line(42, 52, 35, 72)}${line(58, 52, 65, 72)}${line(39, 61, 61, 61, 'symbol-thin')}`)),
    bench: symbol('mapping.symbolBench', boxed(`${rect(22, 38, 56, 22)}${line(28, 60, 25, 72)}${line(72, 60, 75, 72)}`)),
    hammock: symbol('mapping.symbolHammock', boxed(`${line(20, 25, 20, 75)}${line(80, 25, 80, 75)}<path d="M20 38 Q50 78 80 38 Q50 66 20 38 Z"></path>`)),

    desk: symbol('mapping.symbolDesk', boxed(`${rect(22, 34, 56, 34)}${rect(29, 41, 13, 20, 'symbol-thin')}${rect(58, 41, 13, 20, 'symbol-thin')}`)),
    table: symbol('mapping.symbolTable', boxed(`${rect(20, 34, 60, 32)}${line(28, 66, 25, 74)}${line(72, 66, 75, 74)}`)),

    'bookcase-cupboard': symbol('mapping.symbolBookcaseCupboard', boxed(`${rect(22, 28, 56, 44)}${line(22, 43, 78, 43, 'symbol-thin')}${line(22, 57, 78, 57, 'symbol-thin')}${line(50, 28, 50, 72, 'symbol-thin')}`)),
    chest: symbol('mapping.symbolChest', boxed(`${rect(22, 40, 56, 31)}<path d="M22 43 Q50 22 78 43"></path>${line(22, 49, 78, 49, 'symbol-thin')}${rect(45, 45, 10, 12, 'symbol-fill')}`)),
    cask: symbol('mapping.symbolCask', boxed(`<ellipse cx="50" cy="30" rx="21" ry="8"></ellipse><path d="M29 30 L34 71 Q50 79 66 71 L71 30"></path><ellipse cx="50" cy="71" rx="16" ry="6"></ellipse>${line(32, 43, 68, 43, 'symbol-thin')}${line(33, 59, 67, 59, 'symbol-thin')}`)),
    sack: symbol('mapping.symbolSack', boxed('<path d="M39 30 L61 30 L57 40 Q76 55 66 73 Q50 82 34 73 Q24 55 43 40 Z"></path>' + line(39, 39, 61, 39, 'symbol-thin'))),

    bed: symbol('mapping.symbolBed', boxed(`${rect(20, 30, 60, 43)}${rect(25, 35, 18, 14, 'symbol-fill-soft')}${line(47, 30, 47, 73, 'symbol-thin')}`)),

    'statue-small-medium': symbol('mapping.symbolStatueSmallMedium', boxed(`${circle(50, 48, 20)}${text('★', 50, 53, 'symbol-medium')}`)),
    'statue-large': symbol('mapping.symbolStatueLarge', boxed(`${circle(50, 50, 28)}${circle(50, 50, 20, 'symbol-thin')}${text('★', 50, 54, 'symbol-medium')}`)),
    curtain: symbol('mapping.symbolCurtain', boxed('<path d="M18 50 Q26 30 34 50 T50 50 T66 50 T82 50"></path>')),

    stove: symbol('mapping.symbolStove', boxed(`${rect(25, 28, 50, 47)}${circle(42, 47, 9, 'symbol-fill-soft')}${circle(60, 47, 7, 'symbol-fill-soft')}${line(33, 65, 67, 65, 'symbol-thin')}`)),
    cage: symbol('mapping.symbolCage', boxed(`${rect(23, 24, 54, 52)}${[32, 41, 50, 59, 68].map(x => line(x, 24, x, 76, 'symbol-thin')).join('')}${line(23, 50, 77, 50, 'symbol-thin')}`)),

    // Kept for maps created by early mapper builds.
    stairs: symbol('mapping.symbolStairsUp', stairs('up')),
    treasure: symbol('mapping.symbolTreasure', boxed(`${rect(22, 40, 56, 31)}<path d="M22 43 Q50 22 78 43"></path>${line(22, 49, 78, 49, 'symbol-thin')}${rect(45, 45, 10, 12, 'symbol-fill')}`))
});

export const MAPPING_SYMBOL_TYPES = new Set(Object.keys(MAPPING_SYMBOLS));

export const MAPPING_SYMBOL_CATEGORIES = Object.freeze([
    { labelKey: 'mapping.categoryStairsLadders', icon: 'fa-solid fa-stairs', types: ['stairs-up', 'stairs-down', 'spiral-stairs-up', 'spiral-stairs-down', 'ladder-up', 'ladder-down', 'slide'] },
    { labelKey: 'mapping.categoryTrapsMechanisms', icon: 'fa-solid fa-gears', types: ['trap-door-floor', 'trap-door-ceiling', 'secret-trap-door', 'trap', 'trigger', 'lever', 'stairs-slide-trap'] },
    { labelKey: 'mapping.categoryPitsShafts', icon: 'fa-regular fa-square', types: ['open-pit-square', 'covered-pit-square', 'open-pit-round', 'covered-pit-round', 'hole-ceiling', 'hole-floor'] },
    { labelKey: 'mapping.categoryWaterFeatures', icon: 'fa-solid fa-water', types: ['pool', 'fountain', 'well-square', 'well-round'] },
    { labelKey: 'mapping.categoryFireFeatures', icon: 'fa-solid fa-fire-flame-curved', types: ['fire-pit', 'fireplace'] },
    { labelKey: 'mapping.categoryStructuralFeatures', icon: 'fa-solid fa-landmark', types: ['dais', 'altar', 'pillar-square', 'pillar-round', 'tunnel-subterranean'] },
    { labelKey: 'mapping.categorySeating', icon: 'fa-solid fa-chair', types: ['chair', 'padded-chair', 'throne', 'stool', 'bench', 'hammock'] },
    { labelKey: 'mapping.categoryTablesWorkspaces', icon: 'fa-solid fa-table', types: ['desk', 'table'] },
    { labelKey: 'mapping.categoryStorage', icon: 'fa-solid fa-box-archive', types: ['bookcase-cupboard', 'chest', 'cask', 'sack'] },
    { labelKey: 'mapping.categorySleeping', icon: 'fa-solid fa-bed', types: ['bed'] },
    { labelKey: 'mapping.categoryDecor', icon: 'fa-solid fa-monument', types: ['statue-small-medium', 'statue-large', 'curtain'] },
    { labelKey: 'mapping.categoryUtility', icon: 'fa-solid fa-toolbox', types: ['stove', 'cage'] }
]);

export function getMappingSymbol(type) {
    return MAPPING_SYMBOLS[type] ?? null;
}
