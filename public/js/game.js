// waifu data ----- add samisu or smith chan or whatever later make these cost pogs when you figure it out
const COMPANIONS = {
  'FL Chan': { file: 'fl_chan.gif', phrases: ["You've got this!", "You're awesome!", 'I lubb uu!', 'Yay!', 'Make me FL beats!'] },
  'Miku': { file: 'miku.gif', phrases: ['Miku Miku Beam!', 'Baka!!', 'Leek power!', 'Melody!'] },
  'Chika': { file: 'chika.gif', phrases: ['Yo yo yo!', 'Love Detective!', 'Wah!?', 'Dance dance!'] },
  'Tohru': { file: 'tohru.gif', phrases: ['D is for Dragon!', 'Eat my tail!', 'Kobayashi-san!', 'Moe moe kyun!'] },
  'Teto': { file: 'teto.gif', phrases: ['tetotetotetotetotetotetotetotetoteto', 'BAAAKA', "THEY'RE NOT DRILLS", 'mmmmgh!'] },
  'Steve': { file: 'minecraft-steve.gif', phrases: ['Minecraft', 'Breaking blocks and stuff', 'BOOM BOOM BOOM', "don't mine at night"] },
  'Freddy': { file: 'freddy.gif', phrases: ['Haur hur ha huar har', 'HAUR Hur hur', 'Bite of 87', 'UwU'] },
  'Baldi': { file: 'baldi-dance.gif', phrases: ['Welcome to my schoolhouse!', 'Time for some math!', 'Oh oh oh hi there!', 'Welcome to my isla- Schoolhouse!', '[Insert lyrics to DAGames Baldi song here]'] }
};

const canvas = document.getElementById('tetris');
const ctx = canvas.getContext('2d');
const nextCtx = document.getElementById('next').getContext('2d');
const holdCtx = document.getElementById('hold').getContext('2d');

ctx.scale(20, 20);
nextCtx.scale(20, 20);
holdCtx.scale(20, 20);

let colors = [null, '#FF0D72', '#0DC2FF', '#0DFF72', '#F538FF', '#FF8E0D', '#3877FF', '#FFE138', '#555555'];
const PIECE_LABELS = [null, 'T', 'I', 'S', 'Z', 'L', 'J', 'O', 'GARBAGE'];

const LOCK_DELAY = 500;
const LOCK_MOVE_LIMIT = 12;
let socket = null;
let matchmakingState = 'idle';
let currentMatch = null;
let gameOverSent = false;

function setMatchmakingStatus(message) {
  const el = document.getElementById('matchmaking-status');
  if (el) el.innerText = message;
}

function initSocket() {
  if (typeof io === 'undefined') return;

  socket = io();

  socket.on('connect', () => {
    setMatchmakingStatus('online. ready to queue.');
  });

  socket.on('socketReady', data => {
    if (data && data.username) {
      setMatchmakingStatus(`ready, ${data.username}`);
    }
  });

  socket.on('queueJoined', data => {
    matchmakingState = 'queued';
    const spot = data && data.position ? ` spot ${data.position}` : '';
    setMatchmakingStatus(`finding somebody...${spot}`);
  });

  socket.on('matchFound', data => {
    currentMatch = data;
    matchmakingState = 'matched';
    const myId = Number(playerProfile.userId);
    const otherPlayer = data.players.find(p => Number(p.id) !== myId) || data.players[0];
    setMatchmakingStatus(`match found vs ${otherPlayer.username}`);
    startGame();
  });

  socket.on('garbage', data => {
    if (gameState !== 'PLAYING') return;
    const lines = Number(data && data.lines) || 0;
    if (lines > 0) {
      addGarbageRows(lines);
    }
  });

  socket.on('opponentWin', () => {
    handleOpponentWin();
  });

  socket.on('queueError', data => {
    matchmakingState = 'idle';
    setMatchmakingStatus(data && data.message ? data.message : 'queue broke somehow');
  });

  socket.on('disconnect', () => {
    if (matchmakingState !== 'matched') matchmakingState = 'idle';
    setMatchmakingStatus('offline');
  });
}

function initColorPickers() {
  const container = document.getElementById('color-pickers');
  container.innerHTML = '';
  colors.forEach((color, i) => {
    if (i === 0) return;
    const div = document.createElement('div');
    div.className = 'setting-item';
    div.innerHTML = `<label style="font-size:0.6rem">${PIECE_LABELS[i]}</label>
                     <input type="color" value="${color}" oninput="updateColor(${i}, this.value)">`;
    container.appendChild(div);
  });
}

function updateColor(index, val) {
  colors[index] = val;
}

function exportColors() {
  const blob = new Blob([JSON.stringify(colors)], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tetris_colors.txt';
  a.click();
}

function importColors(input) {
  const reader = new FileReader();
  reader.onload = e => {
    colors = JSON.parse(e.target.result);
    initColorPickers();
  };
  reader.readAsText(input.files[0]);
}

let gameState = 'MENU';
let activeCompanion = 'FL Chan';
const playerProfile = window.TETRIS_PLAYER || { userId: null, username: 'player' };
const arena = createMatrix(12, 20);
let lastTime = 0;
let dropCounter = 0;
let dropInterval = 1000;
const player = {
  pos: { x: 0, y: 0 },
  matrix: null,
  type: null,
  rotation: 0,
  score: 0,
  level: 1,
  lines: 0,
  holdPiece: null,
  canHold: true,
  combo: -1,
  backToBack: 0,
  lastClearWasB2B: false,
  lockTimer: 0,
  lockMoves: 0
};

const keys = {
  ArrowLeft: { down: false, timer: 0 },
  ArrowRight: { down: false, timer: 0 },
  ArrowDown: { down: false, timer: 0 }
};
const DAS_DELAY = 170;
const DAS_SPEED = 50;

function cheer() {
  const comp = COMPANIONS[activeCompanion];
  const b = document.getElementById('speech-bubble');
  b.innerText = comp.phrases[Math.floor(Math.random() * comp.phrases.length)];
  b.style.opacity = '1';
  b.style.transform = 'translateY(0px)';
  setTimeout(() => {
    b.style.opacity = '0';
    b.style.transform = 'translateY(10px)';
  }, 2000);
}

function openPanel(id) {
  ['main-menu-panel', 'settings-panel', 'companion-panel'].forEach(p => {
    document.getElementById(p).style.display = (p === id ? 'flex' : 'none');
  });
}

function populateCompanions() {
  const list = document.getElementById('companion-list');
  list.innerHTML = '';
  Object.keys(COMPANIONS).forEach(name => {
    const item = document.createElement('div');
    item.className = 'companion-item ' + (activeCompanion === name ? 'active' : '');
    item.innerHTML = `<span>${name}${activeCompanion === name ? ' (Active)' : ''}</span>`;
    item.onclick = () => {
      activeCompanion = name;
      document.getElementById('companion-gif').src = COMPANIONS[name].file;
      populateCompanions();
    };
    list.appendChild(item);
  });
}

function resetRunStats() {
  player.score = 0;
  player.lines = 0;
  player.level = 1;
  player.holdPiece = null;
  player.canHold = true;
  player.combo = -1;
  player.backToBack = 0;
  player.lastClearWasB2B = false;
  player.lockTimer = 0;
  player.lockMoves = 0;
  gameOverSent = false;
  GARBAGE.pending = 0;
  dropInterval = 1000;
  updateScoreUi();
}

function startGame() {
  arena.forEach(row => row.fill(0));
  bag = [];
  pieceQueue = [];
  resetRunStats();
  fillPieceQueue();
  try {
    sounds.bgm.play();
  } catch (e) {}
  gameState = 'PLAYING';
  document.getElementById('overlay').style.display = 'none';
  document.getElementById('primary-btn').onclick = handlePrimaryBtn;
  document.getElementById('primary-btn').innerText = 'PLAY AGAIN';
  document.getElementById('restart-btn').style.display = 'none';
  playerReset();
}

function handlePrimaryBtn() {
  if (gameState === 'PAUSED') {
    unpause();
    return;
  }

  if (gameState === 'MENU' && socket && matchmakingState !== 'matched') {
    joinQueue();
    return;
  }

  startGame();
}

function unpause() {
  gameState = 'PLAYING';
  sounds.bgm.play();
  document.getElementById('overlay').style.display = 'none';
}

function joinQueue() {
  if (!socket) {
    setMatchmakingStatus('no socket');
    return;
  }

  matchmakingState = 'queueing';
  setMatchmakingStatus('joining queue...');
  socket.emit('joinQueue');
}

function showLoseOverlay(text) {
  gameState = 'GAMEOVER';
  sounds.bgm.pause();
  sounds.gameover.play();
  document.getElementById('overlay').style.display = 'flex';
  document.getElementById('main-menu-panel').style.display = 'flex';
  document.getElementById('settings-panel').style.display = 'none';
  document.getElementById('companion-panel').style.display = 'none';
  document.getElementById('primary-btn').onclick = () => window.location.href = '/';
  document.getElementById('primary-btn').innerText = 'RESTART';
  setMatchmakingStatus(text);
  currentMatch = null;
  matchmakingState = 'idle';
}

function handleLocalGameOver() {
  if (gameState === 'GAMEOVER') return;
  if (!gameOverSent && socket && currentMatch) {
    socket.emit('gameOver');
    gameOverSent = true;
  }
  showLoseOverlay('you lost');
}

function handleOpponentWin() {
  if (gameState === 'GAMEOVER') return;
  alert('you win lol');
  showLoseOverlay('opponent died. you win');
}

function update(time = 0) {
  let delta = time - lastTime;
  lastTime = time;
  if (delta > 1000) delta = 16;
  if (gameState === 'PLAYING') {
    ['ArrowLeft', 'ArrowRight'].forEach(k => {
      if (keys[k].down) {
        if (keys[k].timer === 0) {
          movePlayer(k === 'ArrowRight' ? 1 : -1);
        }
        keys[k].timer += delta;
        if (keys[k].timer > DAS_DELAY) {
          if ((keys[k].timer - DAS_DELAY) % DAS_SPEED < delta) {
            movePlayer(k === 'ArrowRight' ? 1 : -1);
          }
        }
      } else {
        keys[k].timer = 0;
      }
    });

    if (keys.ArrowDown.down) {
      dropCounter += delta * 12;
      while (dropCounter > dropInterval) {
        softDropStep();
        dropCounter -= dropInterval;
      }
    } else {
      dropCounter += delta;
      while (dropCounter > dropInterval) {
        stepDown();
        dropCounter -= dropInterval;
      }
    }

    if (isGrounded()) {
      player.lockTimer += delta;
      if (player.lockTimer >= LOCK_DELAY) {
        lockPiece();
      }
    } else {
      player.lockTimer = 0;
      player.lockMoves = 0;
    }
  }
  draw();
  requestAnimationFrame(update);
}

window.addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  if (e.key.toLowerCase() === 'p') {
    if (gameState === 'PLAYING') {
      gameState = 'PAUSED';
      sounds.bgm.pause();
      document.getElementById('overlay').style.display = 'flex';
      document.getElementById('primary-btn').innerText = 'RESUME';
      document.getElementById('restart-btn').style.display = 'block';
    } else if (gameState === 'PAUSED') {
      unpause();
    }
  }
  if (gameState !== 'PLAYING') return;
  if (e.key in keys) keys[e.key].down = true;
  if (e.key === 'ArrowUp') playerRotate(1);
  if (e.key === 'z') playerRotate(-1);
  if (e.key === ' ') {
    hardDrop();
  }
  if (e.key.toLowerCase() === 'c' && player.canHold) {
    let cur = {
      type: player.type,
      matrix: cloneMatrix(player.matrix),
      rotation: 0
    };
    if (player.holdPiece) {
      player.type = player.holdPiece.type;
      player.matrix = cloneMatrix(player.holdPiece.matrix);
      player.rotation = player.holdPiece.rotation || 0;
      player.holdPiece = cur;
      player.pos.y = 0;
      player.pos.x = (arena[0].length / 2 | 0) - (player.matrix[0].length / 2 | 0);
      player.lockTimer = 0;
      player.lockMoves = 0;
      if (collide(arena, player)) {
        handleLocalGameOver();
      }
    } else {
      player.holdPiece = cur;
      playerReset();
    }
    player.canHold = false;
  }
});

window.addEventListener('keyup', e => {
  if (e.key in keys) keys[e.key].down = false;
});

initColorPickers();
populateCompanions();
updateScoreUi();
setMatchmakingStatus('connecting...');
initSocket();
update();
