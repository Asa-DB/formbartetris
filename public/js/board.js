const ROTATION_KICKS = {
  normal: {
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
  },
  I: {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
  }
};

const GARBAGE = {
  pending: 0
};

function createMatrix(w, h) {
  const m = [];
  while (h--) m.push(new Array(w).fill(0));
  return m;
}

function cloneMatrix(matrix) {
  return matrix.map(row => [...row]);
}

function rotateMatrix(matrix, dir) {
  const m = cloneMatrix(matrix);
  for (let y = 0; y < m.length; ++y) {
    for (let x = 0; x < y; ++x) {
      [m[x][y], m[y][x]] = [m[y][x], m[x][y]];
    }
  }
  if (dir > 0) m.forEach(row => row.reverse());
  else m.reverse();
  return m;
}

function addPendingGarbage(lines) {
  GARBAGE.pending += lines;
}

function addGarbageRows(lines) {
  for (let i = 0; i < lines; i++) {
    arena.shift();
    const row = new Array(12).fill(8);
    const hole = Math.floor(Math.random() * 12);
    row[hole] = 0;
    arena.push(row);
  }

  if (player.matrix && collide(arena, player)) {
    player.pos.y--;
    if (player.pos.y < 0 || collide(arena, player)) {
      handleLocalGameOver();
    }
  }
}

function collide(arena, player) {
  if (!player.matrix) return false;
  const [m, o] = [player.matrix, player.pos];
  for (var y = 0; y < m.length; ++y) {
    for (let x = 0; x < m[y].length; ++x) {
      if (m[y][x] !== 0 && (arena[y + o.y] && arena[y + o.y][x + o.x]) !== 0) return true;
    }
  }
  return false;
}

function updateScoreUi() {
  document.getElementById('score').innerText = player.score;
  document.getElementById('level').innerText = player.level;
  document.getElementById('combo').innerText = player.combo > 0 ? player.combo : '-';
  document.getElementById('b2b').innerText = player.backToBack > 0 ? player.backToBack : '-';
}

function arenaSweep() {
  let rowCount = 0;
  outer: for (let y = arena.length - 1; y > 0; --y) {
    for (let x = 0; x < arena[y].length; ++x) {
      if (arena[y][x] === 0) continue outer;
    }
    arena.unshift(arena.splice(y, 1)[0].fill(0));
    ++y;
    rowCount++;
  }

  const isBigClear = rowCount >= 4;

  if (rowCount === 0) {
    player.combo = -1;
    player.backToBack = 0;
    player.lastClearWasB2B = false;
    updateScoreUi();
    return 0;
  }

  player.combo += 1;
  player.lines += rowCount;

  let points = rowCount * 10 * rowCount;
  if (player.combo > 0) {
    points += player.combo * 15;
  }

  if (isBigClear) {
    if (player.lastClearWasB2B) {
      player.backToBack += 1;
      points += rowCount * 40;
    } else {
      player.backToBack = 1;
    }
    player.lastClearWasB2B = true;
  } else {
    player.backToBack = 0;
    player.lastClearWasB2B = false;
  }

  player.score += points;
  sounds.clear.play();
  cheer();

  const newLevel = Math.floor(player.lines / 10) + 1;
  if (newLevel > player.level) {
    player.level = newLevel;
  }

  dropInterval = Math.max(80, Math.pow(0.85, player.level - 1) * 1000);
  updateScoreUi();

  if (socket && currentMatch) {
    socket.emit('clearLines', { lines: rowCount });
  }

  return rowCount;
}

let bag = [];
let pieceQueue = [];

function shuffleBag() {
  const nextBag = 'IJLOSTZ'.split('');
  for (let i = nextBag.length - 1; i > 0; --i) {
    const j = Math.floor(Math.random() * (i + 1));
    [nextBag[i], nextBag[j]] = [nextBag[j], nextBag[i]];
  }
  return nextBag;
}

function makePiece(type) {
  return {
    type,
    matrix: cloneMatrix(PIECES[type]),
    rotation: 0
  };
}

function fillPieceQueue() {
  while (pieceQueue.length < 5) {
    if (bag.length === 0) bag = shuffleBag();
    pieceQueue.push(makePiece(bag.pop()));
  }
}

function playerReset() {
  fillPieceQueue();
  const nextPiece = pieceQueue.shift();
  fillPieceQueue();
  player.type = nextPiece.type;
  player.matrix = nextPiece.matrix;
  player.rotation = nextPiece.rotation;
  player.pos.y = 0;
  player.pos.x = (arena[0].length / 2 | 0) - (player.matrix[0].length / 2 | 0);
  player.canHold = true;
  player.lockTimer = 0;
  player.lockMoves = 0;
  if (collide(arena, player)) {
    handleLocalGameOver();
  }
}

function merge() {
  player.matrix.forEach((row, y) => {
    row.forEach((v, x) => {
      if (v !== 0) arena[y + player.pos.y][x + player.pos.x] = v;
    });
  });
  sounds.land.play();
}

function isGrounded() {
  if (!player.matrix) return false;
  player.pos.y++;
  const grounded = collide(arena, player);
  player.pos.y--;
  return grounded;
}

function touchGround() {
  if (isGrounded() && player.lockTimer === 0) {
    player.lockTimer = 1;
  }
}

function resetLockDelay() {
  if (!isGrounded()) {
    player.lockTimer = 0;
    player.lockMoves = 0;
    return;
  }

  if (player.lockMoves < LOCK_MOVE_LIMIT) {
    player.lockMoves++;
    player.lockTimer = 1;
  }
}

function movePlayer(dir) {
  player.pos.x += dir;
  if (collide(arena, player)) {
    player.pos.x -= dir;
    return false;
  }
  sounds.move.play();
  resetLockDelay();
  return true;
}

function playerRotate(dir) {
  if (!player.matrix || player.type === 'O') return false;

  const from = player.rotation;
  const to = (from + dir + 4) % 4;
  const rotated = rotateMatrix(player.matrix, dir);
  const kickKey = `${from}>${to}`;
  const kickTable = player.type === 'I' ? ROTATION_KICKS.I : ROTATION_KICKS.normal;
  const kicks = kickTable[kickKey] || [[0, 0]];
  const oldX = player.pos.x;
  const oldY = player.pos.y;
  const oldMatrix = player.matrix;

  for (let i = 0; i < kicks.length; i++) {
    const [kickX, kickY] = kicks[i];
    player.matrix = rotated;
    player.rotation = to;
    player.pos.x = oldX + kickX;
    player.pos.y = oldY - kickY;

    if (!collide(arena, player)) {
      sounds.rotate.play();
      resetLockDelay();
      return true;
    }
  }

  player.matrix = oldMatrix;
  player.rotation = from;
  player.pos.x = oldX;
  player.pos.y = oldY;
  return false;
}

function lockPiece() {
  merge();
  arenaSweep();
  playerReset();
}

function hardDrop() {
  let distance = 0;
  while (!collide(arena, player)) {
    player.pos.y++;
    distance++;
  }
  player.pos.y--;
  distance--;
  player.score += Math.max(0, distance) * 2;
  updateScoreUi();
  lockPiece();
}

function softDropStep() {
  player.pos.y++;
  if (collide(arena, player)) {
    player.pos.y--;
    touchGround();
    return false;
  }
  player.score += 1;
  updateScoreUi();
  player.lockTimer = 0;
  player.lockMoves = 0;
  return true;
}

function stepDown() {
  player.pos.y++;
  if (collide(arena, player)) {
    player.pos.y--;
    touchGround();
    return false;
  }
  player.lockTimer = 0;
  player.lockMoves = 0;
  return true;
}
