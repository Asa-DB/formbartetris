// waifu data ----- add samisu or smith chan or whatever later maybe
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
const remoteCanvas = document.getElementById('remote-board');
const remoteCtx = remoteCanvas ? remoteCanvas.getContext('2d') : null;

ctx.imageSmoothingEnabled = false;
nextCtx.imageSmoothingEnabled = false;
holdCtx.imageSmoothingEnabled = false;
if (remoteCtx) remoteCtx.imageSmoothingEnabled = false;

ctx.scale(20, 20);
nextCtx.scale(20, 20);
holdCtx.scale(20, 20);
if (remoteCtx) remoteCtx.scale(10, 10);

let colors = [null, '#d95f5f', '#5fd6ff', '#66d17a', '#d07cff', '#f2a74b', '#5b80ff', '#ead94c', '#50616f'];
const PIECE_LABELS = [null, 'T', 'I', 'S', 'Z', 'L', 'J', 'O', 'GARBAGE'];

const LOCK_DELAY = 500;
const LOCK_MOVE_LIMIT = 12;
let socket = null;
let gameMode = 'singleplayer';
let playerRole = null;
let currentRoom = null;
let gameOverSent = false;
let remoteState = null;
let spectatorBoards = {};
let spectatorMessage = '';
let lastStateSentAt = 0;
let onlineMenuOpen = false;
let activeRooms = [];
let selectedRoomName = '';
let isRoomCreator = false;
let uiScale = 1;

function byId(id) {
  return document.getElementById(id);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function saveUiScale() {
  try {
    localStorage.setItem('tetrisUiScale', String(uiScale));
  } catch (e) {}
}

function updateUiScaleLabel() {
  const el = byId('ui-scale-value');
  if (el) el.innerText = `${Math.round(uiScale * 100)}%`;
}

function applyUiScale() {
  const shell = document.querySelector('.app-shell');
  if (!shell) return;

  const wasScaled = shell.style.transform;
  shell.style.transform = 'scale(1)';

  const rect = shell.getBoundingClientRect();
  const naturalWidth = rect.width || shell.offsetWidth || 1;
  const naturalHeight = rect.height || shell.offsetHeight || 1;
  const freeWidth = Math.max(window.innerWidth - 20, 240);
  const freeHeight = Math.max(window.innerHeight - 20, 240);
  const fitScale = Math.min(freeWidth / naturalWidth, freeHeight / naturalHeight, 1.6);
  const appliedScale = clamp(Math.min(uiScale, fitScale), 0.72, 1.6);

  shell.style.transform = `scale(${appliedScale})`;
  document.documentElement.style.setProperty('--app-scale', appliedScale.toFixed(3));

  if (!wasScaled) return;
}

function setUiScale(nextScale) {
  uiScale = clamp(nextScale, 0.8, 1.35);
  updateUiScaleLabel();
  saveUiScale();
  applyUiScale();
}

function nudgeUiScale(amount) {
  setUiScale(Math.round((uiScale + amount) * 100) / 100);
}

function loadUiScale() {
  try {
    const saved = parseFloat(localStorage.getItem('tetrisUiScale'));
    if (!Number.isNaN(saved)) {
      uiScale = clamp(saved, 0.8, 1.35);
    }
  } catch (e) {}

  updateUiScaleLabel();
  applyUiScale();
}

function setStatus(message) {
  const el = byId('matchmaking-status');
  if (el) el.innerText = message;
}

function setRoomInfo(message) {
  const text = message || 'No room yet';
  const side = byId('room-info');
  const menu = byId('room-info-menu');
  if (side) side.innerText = text;
  if (menu) menu.innerText = text;
}

function setWatchLabel(message) {
  const el = byId('watch-label');
  if (el) el.innerText = message || 'Waiting';
}

function updateStartButton() {
  const button = byId('start-room-btn');
  if (!button) return;

  const showButton = gameState === 'MENU' && gameMode === 'multiplayer' && playerRole === 'player' && isRoomCreator;
  button.style.display = showButton ? 'block' : 'none';
}

function updatePrimaryButton() {
  const button = byId('primary-btn');
  if (!button) return;

  const hidePrimary = gameMode === 'multiplayer' && playerRole === 'player' && gameState !== 'PAUSED';
  button.style.display = hidePrimary ? 'none' : 'block';
}

function resetRoomState() {
  currentRoom = null;
  playerRole = null;
  remoteState = null;
  spectatorBoards = {};
  spectatorMessage = '';
  isRoomCreator = false;
  gameMode = 'singleplayer';
  selectedRoomName = '';
  onlineMenuOpen = false;
  setWatchLabel('Waiting');
}

function showRoomInputs(show) {
  const box = byId('online-panel');
  if (box) box.style.display = show ? 'block' : 'none';
}

function updateModeUi() {
  const isSpectator = gameMode === 'spectator';
  const roomLine = currentRoom
    ? `${currentRoom} (${playerRole || 'singleplayer'})`
    : (onlineMenuOpen ? 'Browsing online rooms' : 'Singleplayer only');
  setRoomInfo(roomLine);
  showRoomInputs(gameState === 'MENU' && onlineMenuOpen);
  byId('room-password').disabled = gameState === 'PLAYING' && !isSpectator;
  byId('online-btn').style.display = gameState === 'MENU' ? 'block' : 'none';
  byId('remote-wrap').style.display = (gameMode === 'multiplayer' || isSpectator) ? 'block' : 'none';
  byId('watching-line').style.display = isSpectator ? 'block' : 'none';
  updateStartButton();
  updatePrimaryButton();
}

function clearRoomForm() {
  byId('room-password').value = '';
}

function setSelectedRoom(roomName) {
  selectedRoomName = roomName || '';
  renderRoomList();
}

function renderRoomList() {
  const list = byId('room-list');
  if (!list) return;

  if (!activeRooms.length) {
    list.innerHTML = '<div class="room-empty">No active rooms on the board</div>';
    return;
  }

  list.innerHTML = '';
  activeRooms.forEach(room => {
    const card = document.createElement('div');
    card.className = 'room-card';
    if (selectedRoomName === room.roomName) {
      card.classList.add('selected');
    }
    card.onclick = () => {
      setSelectedRoom(room.roomName);
      tryJoinRoom(room.roomName, false);
    };

    const modeText = room.playerCount >= 2 ? 'full room' : 'join as player';
    card.innerHTML = `
      <div class="room-card-top">
        <span>${room.roomName}</span>
        <span>${room.passwordProtected ? 'LOCK' : 'OPEN'}</span>
      </div>
      <div class="room-card-bottom">
        <span>${room.playerCount}/2 players</span>
        <span>${modeText}</span>
        <span>${room.spectatorCount} watch</span>
      </div>
      <div style="display:flex; justify-content:flex-end; margin-top:6px;">
        <button class="tiny-btn dark room-spectate-btn">WATCH</button>
      </div>
    `;
    card.querySelector('.room-spectate-btn').onclick = e => {
      e.stopPropagation();
      setSelectedRoom(room.roomName);
      tryJoinRoom(room.roomName, true);
    };
    list.appendChild(card);
  });
}

function getRoomPassword(roomName) {
  const room = activeRooms.find(item => item.roomName === roomName);
  if (!room || !room.passwordProtected) return '';
  const typed = window.prompt(`Password for ${roomName}?`, '');
  if (typed === null) return null;
  return typed;
}

function openOnlineMenu() {
  onlineMenuOpen = true;
  if (!currentRoom) {
    setRoomInfo('Browsing online rooms');
  }
  setStatus('opening online rooms...');
  initSocket();
  if (socket) {
    socket.emit('requestRoomList');
  }
  updateModeUi();
}

function closeOnlineMenu() {
  onlineMenuOpen = false;
  if (!currentRoom) {
    setStatus('singleplayer ready');
    setRoomInfo('Singleplayer only');
  }
  updateModeUi();
}

function refreshRoomList() {
  if (!socket) {
    initSocket();
  }
  if (socket) {
    socket.emit('requestRoomList');
  }
}

function initSocket() {
  if (socket || typeof io === 'undefined') return;

  socket = io();

  socket.on('connect', () => {
    setStatus('online for rooms');
    socket.emit('requestRoomList');
  });

  socket.on('socketReady', data => {
    if (data && data.username) {
      setStatus(`ready, ${data.username}`);
    }
  });

  socket.on('roomCreated', data => {
    currentRoom = data.roomName;
    playerRole = 'player';
    isRoomCreator = !!(data && data.isCreator);
    gameMode = 'multiplayer';
    onlineMenuOpen = false;
    setRoomInfo(`${data.roomName} (player)`);
    setSelectedRoom(data.roomName);
    setStatus(data.passwordProtected ? `room made: ${data.roomName} (locked)` : `room made: ${data.roomName}`);
    showMenuOverlay(`room ready: ${data.roomName}`);
  });

  socket.on('roomJoined', data => {
    currentRoom = data.roomName;
    playerRole = data.role;
    isRoomCreator = !!(data && data.isCreator);
    gameMode = data.role === 'spectator' ? 'spectator' : 'multiplayer';
    onlineMenuOpen = false;
    setRoomInfo(`${data.roomName} (${data.role})`);
    setSelectedRoom(data.roomName);

    if (data.role === 'spectator') {
      startSpectating();
    } else {
      setStatus(`joined ${data.roomName} as player`);
      showMenuOverlay(`joined ${data.roomName}`);
    }
  });

  socket.on('roomState', data => {
    if (!data || !data.roomName) return;

    isRoomCreator = data.creatorSocketId === (socket && socket.id);

    const playerNames = (data.players || []).map(player => player.username).filter(Boolean);
    const playerText = playerNames.length ? playerNames.join(' vs ') : 'waiting for players';
    const watcherText = data.spectators === 1 ? '1 spectator' : `${data.spectators} spectators`;
    setStatus(`${data.roomName}: ${playerText} | ${watcherText}`);
    updateModeUi();
  });

  socket.on('roomsList', rooms => {
    activeRooms = Array.isArray(rooms) ? rooms : [];
    if (selectedRoomName && !activeRooms.find(room => room.roomName === selectedRoomName)) {
      selectedRoomName = '';
    }
    renderRoomList();
  });

  socket.on('playerStarted', data => {
    if (gameMode === 'spectator' && data && data.roomName) {
      spectatorMessage = `${data.username} started playing`;
    }
  });

  socket.on('gameStart', data => {
    if (gameMode === 'spectator') {
      setStatus(data && data.startedBy ? `${data.startedBy} started the game` : 'game started');
      return;
    }

    if (gameMode === 'multiplayer' && playerRole === 'player') {
      startGame();
    }
  });

  socket.on('garbage', data => {
    if (gameState !== 'PLAYING' || gameMode !== 'multiplayer' || playerRole !== 'player') return;
    const lines = Number(data && data.lines) || 0;
    if (lines > 0) {
      addGarbageRows(lines);
    }
  });

  socket.on('opponentWin', () => {
    handleOpponentWin();
  });

  socket.on('opponentState', data => {
    remoteState = data;
    if (data && data.username) {
      setWatchLabel(`Opponent: ${data.username}`);
    }
  });

  socket.on('spectatorState', data => {
    if (!data || !data.username) return;
    spectatorBoards[data.username] = data;
    if (!remoteState || !remoteState.username || remoteState.gameOver) {
      remoteState = data;
    }
    if (gameMode === 'spectator') {
      if (!remoteState || remoteState.username === data.username || remoteState.gameOver) {
        remoteState = data;
      }
      setWatchLabel(`Watching: ${remoteState.username}`);
    }
  });

  socket.on('roomMessage', data => {
    spectatorMessage = data && data.message ? data.message : '';
    if (gameMode === 'spectator' && spectatorMessage) {
      setStatus(spectatorMessage);
    }
  });

  socket.on('roomError', data => {
    setStatus(data && data.message ? data.message : 'room error');
  });

  socket.on('disconnect', () => {
    const hadRoom = !!currentRoom;
    resetRoomState();
    setStatus('offline');
    activeRooms = [];
    renderRoomList();
    if (hadRoom && gameState !== 'PLAYING') {
      showMenuOverlay('connection lost');
      return;
    }
    updateModeUi();
  });
}

function leaveRoom() {
  if (socket && currentRoom) {
    socket.emit('leaveRoom');
  }

  resetRoomState();
  updateModeUi();
}

function createRoomClicked() {
  initSocket();
  if (!socket) return;
  leaveRoom();
  socket.emit('createRoom', { password: byId('room-password').value });
  clearRoomForm();
}

function tryJoinRoom(roomName, forceSpectate) {
  const targetRoom = roomName || selectedRoomName;
  if (!targetRoom) {
    setStatus('pick a room first');
    return;
  }

  const password = getRoomPassword(targetRoom);
  if (password === null) return;

  initSocket();
  if (!socket) return;
  leaveRoom();

  if (forceSpectate) {
    socket.emit('spectateRoom', {
      roomName: targetRoom,
      password
    });
  } else {
    socket.emit('joinRoom', {
      roomName: targetRoom,
      password
    });
  }
}

function chooseSingleplayer() {
  if (gameMode !== 'singleplayer') {
    leaveRoom();
  }
  resetRoomState();
  setStatus('singleplayer ready');
  setRoomInfo('Singleplayer only');
  updateModeUi();
  startGame();
}

function initColorPickers() {
  const container = byId('color-pickers');
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
  const b = byId('speech-bubble');
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
    byId(p).style.display = (p === id ? 'flex' : 'none');
  });
}

function populateCompanions() {
  const list = byId('companion-list');
  list.innerHTML = '';
  Object.keys(COMPANIONS).forEach(name => {
    const item = document.createElement('div');
    item.className = 'companion-item ' + (activeCompanion === name ? 'active' : '');
    item.innerHTML = `<span>${name}${activeCompanion === name ? ' (Active)' : ''}</span>`;
    item.onclick = () => {
      activeCompanion = name;
      byId('companion-gif').src = COMPANIONS[name].file;
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
  lastStateSentAt = 0;
  updateScoreUi();
}

function startGame() {
  if (gameMode === 'spectator') return;

  arena.forEach(row => row.fill(0));
  bag = [];
  pieceQueue = [];
  remoteState = null;
  resetRunStats();
  fillPieceQueue();
  try {
    sounds.bgm.play();
  } catch (e) {}
  gameState = 'PLAYING';
  byId('overlay').style.display = 'none';
  byId('primary-btn').onclick = handlePrimaryBtn;
  byId('primary-btn').innerText = 'PLAY AGAIN';
  byId('restart-btn').style.display = 'none';
  playerReset();
  updateModeUi();

  if (socket && currentRoom && playerRole === 'player') {
    socket.emit('playerReady');
    sendStateUpdate(false);
  }
}

function startSpectating() {
  gameState = 'SPECTATING';
  remoteState = null;
  spectatorBoards = {};
  byId('overlay').style.display = 'none';
  setWatchLabel(currentRoom ? `Watching: ${currentRoom}` : 'Watching room');
  setStatus(currentRoom ? `watching ${currentRoom}` : 'watching');
  updateModeUi();
}

function handlePrimaryBtn() {
  if (gameState === 'PAUSED') {
    unpause();
    return;
  }

  if (gameMode === 'spectator') {
    startSpectating();
    return;
  }

  if (gameMode === 'multiplayer') {
    if (!isRoomCreator) {
      setStatus('waiting for room creator to start');
      return;
    }
    requestRoomStart();
    return;
  }

  startGame();
}

function requestRoomStart() {
  if (!socket || !currentRoom || playerRole !== 'player' || !isRoomCreator) return;
  socket.emit('startGame');
  setStatus('starting room...');
}

function canPauseGame() {
  return !(gameMode === 'multiplayer' && playerRole === 'player');
}

function unpause() {
  gameState = 'PLAYING';
  sounds.bgm.play();
  byId('overlay').style.display = 'none';
}

function showLoseOverlay(text) {
  if (gameState !== 'SPECTATING') {
    gameState = 'GAMEOVER';
    sounds.bgm.pause();
    sounds.gameover.play();
  }

  byId('overlay').style.display = 'flex';
  byId('main-menu-panel').style.display = 'flex';
  byId('settings-panel').style.display = 'none';
  byId('companion-panel').style.display = 'none';
  byId('primary-btn').onclick = handlePrimaryBtn;
  byId('primary-btn').innerText = gameMode === 'spectator' ? 'WATCH' : 'PLAY AGAIN';
  byId('restart-btn').style.display = 'block';
  setStatus(text);
  updateModeUi();
}

function showMenuOverlay(text) {
  if (gameState === 'PLAYING') {
    sounds.bgm.pause();
  }

  gameState = 'MENU';
  byId('overlay').style.display = 'flex';
  byId('main-menu-panel').style.display = 'flex';
  byId('settings-panel').style.display = 'none';
  byId('companion-panel').style.display = 'none';
  byId('primary-btn').onclick = handlePrimaryBtn;
  byId('primary-btn').innerText = gameMode === 'spectator' ? 'WATCH' : (gameMode === 'multiplayer' ? 'START ROOM GAME' : 'PLAY SINGLEPLAYER');
  byId('restart-btn').style.display = currentRoom ? 'block' : 'none';
  setStatus(text);
  updateModeUi();
}

function handleLocalGameOver() {
  if (gameState === 'GAMEOVER') return;
  if (!gameOverSent && socket && currentRoom && playerRole === 'player') {
    socket.emit('gameOver');
    gameOverSent = true;
    sendStateUpdate(true);
  }
  showLoseOverlay('you lost');
}

function handleOpponentWin() {
  if (gameState === 'GAMEOVER' && gameMode !== 'spectator') return;
  alert('you win lol');
  showLoseOverlay('opponent died. you win');
}

function buildBoardSnapshot() {
  const board = arena.map(row => row.slice());
  if (player.matrix && gameMode !== 'spectator') {
    player.matrix.forEach((row, y) => {
      row.forEach((value, x) => {
        if (!value) return;
        const boardY = y + player.pos.y;
        const boardX = x + player.pos.x;
        if (board[boardY] && typeof board[boardY][boardX] !== 'undefined') {
          board[boardY][boardX] = value;
        }
      });
    });
  }
  return board;
}

function sendStateUpdate(forceGameOver) {
  if (!socket || !currentRoom || playerRole !== 'player' || gameMode !== 'multiplayer') return;

  const now = performance.now();
  if (!forceGameOver && now - lastStateSentAt < 120) return;
  lastStateSentAt = now;

  socket.emit('stateUpdate', {
    board: buildBoardSnapshot(),
    score: player.score,
    level: player.level,
    lines: player.lines,
    gameOver: !!forceGameOver
  });
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

    if (gameMode === 'multiplayer' && playerRole === 'player') {
      sendStateUpdate(false);
    }
  }

  draw();
  requestAnimationFrame(update);
}

window.addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  if (e.key.toLowerCase() === 'p') {
    if (!canPauseGame()) {
      setStatus('pause disabled during online matches');
      return;
    }

    if (gameState === 'PLAYING' && gameMode !== 'spectator') {
      gameState = 'PAUSED';
      sounds.bgm.pause();
      byId('overlay').style.display = 'flex';
      byId('primary-btn').innerText = 'RESUME';
      byId('restart-btn').style.display = 'block';
    } else if (gameState === 'PAUSED') {
      unpause();
    }
  }
  if (gameState !== 'PLAYING' || gameMode === 'spectator') return;
  if (e.key in keys) keys[e.key].down = true;
  if (e.key === 'ArrowUp') playerRotate(1);
  if (e.key === 'z') playerRotate(-1);
  if (e.key === ' ') {
    hardDrop();
  }
  if (e.key.toLowerCase() === 'c' && player.canHold) {
    const cur = {
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

window.addEventListener('resize', applyUiScale);

initColorPickers();
populateCompanions();
loadUiScale();
updateScoreUi();
setStatus('singleplayer ready');
setRoomInfo('Singleplayer only');
setWatchLabel('Waiting');
updateModeUi();
update();
