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
const FORTY_LINE_TARGET = 40;
const BOT_MATCH_MODE = 'botMatch';
let socket = null;
let gameMode = 'singleplayer';
let playerRole = null;
let currentRoom = null;
let currentRoomType = 'standard';
let currentRoomRanked = true;
let currentTournament = null;
let gameOverSent = false;
let remoteState = null;
let spectatorBoards = {};
let spectatorMessage = '';
let lastStateSentAt = 0;
let onlineMenuOpen = false;
let selectedOnlinePlayMode = 'ranked';
let activeRooms = [];
let selectedRoomName = '';
let isRoomCreator = false;
let uiScale = 1;
let pieceRandom = Math.random;
let pendingTournamentJoinRoom = '';
let pendingBotMatchSetup = null;
let currentBotMatch = null;
let overlayCloseTimer = 0;
const CONTROLS_STORAGE_KEY = 'tetrisControls';
let currentPlayerSummary = {
  eloRating: 1000,
  rank: null,
  totalWins: 0,
  totalLosses: 0,
  botWinsEasy: 0,
  botWinsMedium: 0,
  botWinsHard: 0,
  playerVsPlayerWins: 0
};
let currentPlayerProfile = window.TETRIS_PLAYER && window.TETRIS_PLAYER.profile
  ? { ...window.TETRIS_PLAYER.profile }
  : {
      playerId: null,
      username: window.TETRIS_PLAYER && window.TETRIS_PLAYER.username ? window.TETRIS_PLAYER.username : 'player',
      bio: '',
      avatarVersion: 0,
      avatarUrl: ''
    };
const PROFILE_BIO_MAX_LENGTH = 200;
const playerDirectoryState = {
  entries: [],
  searchTerm: '',
  isInitialized: false,
  loading: false,
  queuedAvatarDataUrl: ''
};

const BOT_MATCH_SETTINGS = {
  easyBot: {
    botId: 'easyBot',
    botName: 'Easy Bot',
    thinkDelayMin: 520,
    thinkDelayMax: 980,
    topChoices: 5,
    mistakeChance: 0.5,
    attackStrength: 0.75
  },
  mediumBot: {
    botId: 'mediumBot',
    botName: 'Medium Bot',
    thinkDelayMin: 260,
    thinkDelayMax: 520,
    topChoices: 3,
    mistakeChance: 0.22,
    attackStrength: 1
  },
  hardBot: {
    botId: 'hardBot',
    botName: 'Hard Bot',
    thinkDelayMin: 110,
    thinkDelayMax: 240,
    topChoices: 2,
    mistakeChance: 0.08,
    attackStrength: 1.2
  }
};

const LEADERBOARD_PAGE_SIZE = 6;
const LEADERBOARD_TABS = [
  {
    key: 'eloNoBots',
    label: 'ELO (No Bot Play)',
    emptyText: 'No ranked player-versus-player entries yet.'
  },
  {
    key: 'eloWithBots',
    label: 'ELO (With Bot Play)',
    emptyText: 'No ranked players yet.'
  },
  {
    key: 'fortyLineTimes',
    label: '40-Line Times',
    emptyText: 'No 40-line times recorded yet.'
  }
];

const leaderboardState = {
  activeTabKey: LEADERBOARD_TABS[0].key,
  searchTerm: '',
  currentPage: 1,
  loadingTabKey: '',
  isInitialized: false,
  entriesByTab: {},
  errorMessageByTab: {},
  profileByPlayerId: {},
  activeProfilePlayerId: null,
  activeProfileEntry: null
};
const PLAYER_PROFILE_CLOSE_MS = 180;
const playerProfileState = {
  anchorElement: null,
  closeTimer: 0,
  requestId: 0
};

function byId(id) {
  return document.getElementById(id);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sameUserId(a, b) {
  return String(a) === String(b);
}

function isOwnedByPlayer(ownerUserId) {
  return ownerUserId != null && sameUserId(ownerUserId, playerProfile.userId);
}

function isTournamentMode() {
  return gameMode === 'tournament';
}

function isFortyLineMode() {
  return gameMode === 'fortyLine';
}

function getSelectedRoom() {
  return activeRooms.find(room => room.roomName === selectedRoomName) || null;
}

function createSeededRandom(seed) {
  let state = (Number(seed) || 1) >>> 0;
  if (!state) state = 1;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function resetPieceRandom() {
  if (isTournamentMode() && currentTournament && currentTournament.seed) {
    pieceRandom = createSeededRandom(currentTournament.seed);
    return;
  }

  pieceRandom = Math.random;
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

function buildStoredAvatarUrl(playerId, avatarVersion) {
  const normalizedVersion = Number(avatarVersion) || 0;
  if (playerId == null || normalizedVersion <= 0) {
    return '';
  }

  return `/avatars/${encodeURIComponent(String(playerId))}.webp?v=${normalizedVersion}`;
}

const CONTROL_DEFINITIONS = [
  { action: 'moveLeft', label: 'Move left', group: 'Movement', defaultCode: 'ArrowLeft' },
  { action: 'moveRight', label: 'Move right', group: 'Movement', defaultCode: 'ArrowRight' },
  { action: 'softDrop', label: 'Soft drop', group: 'Movement', defaultCode: 'ArrowDown' },
  { action: 'hardDrop', label: 'Hard drop', group: 'Movement', defaultCode: 'Space' },
  { action: 'rotateClockwise', label: 'Rotate clockwise', group: 'Rotation', defaultCode: 'ArrowUp' },
  { action: 'rotateCounterclockwise', label: 'Rotate counterclockwise', group: 'Rotation', defaultCode: 'KeyZ' },
  { action: 'holdPiece', label: 'Hold piece', group: 'Rotation', defaultCode: 'KeyC' },
  { action: 'pause', label: 'Pause or resume', group: 'System', defaultCode: 'KeyP' }
];
const CONTROL_GROUP_ORDER = ['Movement', 'Rotation', 'System'];
const controlDefinitionByAction = CONTROL_DEFINITIONS.reduce((map, definition) => {
  map[definition.action] = definition;
  return map;
}, {});
const defaultControls = CONTROL_DEFINITIONS.reduce((map, definition) => {
  map[definition.action] = definition.defaultCode;
  return map;
}, {});
let controls = { ...defaultControls };
let controlCodesByAction = { ...defaultControls };
let controlActionByCode = {};
let pendingControlAction = '';

function getControlCode(action) {
  return controlCodesByAction[action] || defaultControls[action] || '';
}

function formatControlCode(code) {
  const input = String(code || '');
  if (!input) return 'Unbound';

  const namedKeys = {
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    Space: 'Space',
    Escape: 'Esc',
    Enter: 'Enter',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
    Backspace: 'Backspace',
    Tab: 'Tab'
  };
  if (namedKeys[input]) return namedKeys[input];
  if (/^Key[A-Z]$/.test(input)) return input.slice(3);
  if (/^Digit[0-9]$/.test(input)) return input.slice(5);
  if (/^Numpad[0-9]$/.test(input)) return `Num ${input.slice(6)}`;
  if (input === 'NumpadDecimal') return 'Num .';
  if (input === 'NumpadEnter') return 'Num Enter';
  if (input === 'BracketLeft') return '[';
  if (input === 'BracketRight') return ']';
  if (input === 'Semicolon') return ';';
  if (input === 'Quote') return "'";
  if (input === 'Comma') return ',';
  if (input === 'Period') return '.';
  if (input === 'Slash') return '/';
  if (input === 'Backslash') return '\\';
  if (input === 'Minus') return '-';
  if (input === 'Equal') return '=';
  if (input === 'Backquote') return '`';
  return input;
}

function buildControlCodeMap() {
  controlCodesByAction = { ...defaultControls, ...controls };
  controlActionByCode = {};
  Object.entries(controlCodesByAction).forEach(([action, code]) => {
    if (!code) return;
    controlActionByCode[code] = action;
  });
}

function saveControls() {
  try {
    localStorage.setItem(CONTROLS_STORAGE_KEY, JSON.stringify(controlCodesByAction));
  } catch (e) {}
}

function loadControls() {
  try {
    const saved = JSON.parse(localStorage.getItem(CONTROLS_STORAGE_KEY) || '{}');
    if (saved && typeof saved === 'object') {
      CONTROL_DEFINITIONS.forEach(({ action }) => {
        const nextCode = typeof saved[action] === 'string' ? saved[action] : defaultControls[action];
        controls[action] = nextCode;
      });
    }
  } catch (e) {}

  buildControlCodeMap();
}

function getControlActionForCode(code) {
  return controlActionByCode[String(code || '')] || '';
}

function getControlButton(action) {
  return document.querySelector(`[data-control-action="${action}"]`);
}

function updateControlButtons() {
  CONTROL_DEFINITIONS.forEach(({ action }) => {
    const button = getControlButton(action);
    if (!button) return;
    const code = getControlCode(action);
    button.innerText = pendingControlAction === action ? 'Press key...' : formatControlCode(code);
    button.classList.toggle('is-listening', pendingControlAction === action);
    button.title = code || '';
  });
}

function setPendingControlAction(action) {
  pendingControlAction = action || '';
  updateControlButtons();
}

function setControlBinding(action, code) {
  if (!controlDefinitionByAction[action] || !code) return;

  const previousAction = getControlActionForCode(code);
  if (previousAction && previousAction !== action) {
    controls[previousAction] = '';
  }

  controls[action] = code;
  buildControlCodeMap();
  saveControls();
  updateControlButtons();
}

function resetControlsToDefault() {
  controls = { ...defaultControls };
  buildControlCodeMap();
  saveControls();
  setPendingControlAction('');
}

function renderControlsMenu() {
  const groupsWrap = byId('controls-groups');
  if (!groupsWrap) return;

  groupsWrap.innerHTML = CONTROL_GROUP_ORDER.map(groupName => {
    const items = CONTROL_DEFINITIONS
      .filter(definition => definition.group === groupName)
      .map(definition => `
        <div class="controls-item">
          <span class="controls-action">${definition.label}</span>
          <button
            type="button"
            class="controls-key controls-key-btn"
            data-control-action="${definition.action}"
            onclick="beginControlRebind('${definition.action}')"
          ></button>
        </div>
      `)
      .join('');

    return `
      <section class="mode-option-card controls-modal-group">
        <strong>${groupName}</strong>
        <div class="controls-list">${items}</div>
      </section>
    `;
  }).join('');

  updateControlButtons();
}

function beginControlRebind(action) {
  if (!controlDefinitionByAction[action]) return;
  setPendingControlAction(action);
}

function cancelControlRebind() {
  if (!pendingControlAction) return false;
  setPendingControlAction('');
  return true;
}

function handleControlRebindKeydown(event) {
  if (!pendingControlAction) return false;

  event.preventDefault();

  if (event.code === 'Escape') {
    cancelControlRebind();
    return true;
  }

  if (['MetaLeft', 'MetaRight'].includes(event.code)) {
    return true;
  }

  setControlBinding(pendingControlAction, event.code);
  setPendingControlAction('');
  return true;
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

function getCurrentBotSettings() {
  if (!currentBotMatch || !currentBotMatch.botDifficulty) {
    return null;
  }

  return BOT_MATCH_SETTINGS[currentBotMatch.botDifficulty] || null;
}

function renderPlayerSummaryUi() {
  const eloEl = byId('menu-player-elo');
  const rankEl = byId('menu-player-rank');
  const recordEl = byId('menu-player-record');
  const quickStatsEl = byId('menu-quick-stats');

  if (eloEl) eloEl.innerText = currentPlayerSummary.eloRating || 1000;
  if (rankEl) rankEl.innerText = currentPlayerSummary.rank ? `#${currentPlayerSummary.rank}` : '-';
  if (recordEl) recordEl.innerText = `${currentPlayerSummary.totalWins || 0} / ${currentPlayerSummary.totalLosses || 0}`;
  if (quickStatsEl) {
    const totalBotWins = (currentPlayerSummary.botWinsEasy || 0)
      + (currentPlayerSummary.botWinsMedium || 0)
      + (currentPlayerSummary.botWinsHard || 0);
    quickStatsEl.innerText = `PVP wins ${currentPlayerSummary.playerVsPlayerWins || 0} | bot wins ${totalBotWins}`;
  }

  const statsTotalWins = byId('stats-total-wins');
  const statsTotalLosses = byId('stats-total-losses');
  const statsPlayerVsPlayerWins = byId('stats-player-vs-player-wins');
  const statsBotWinsEasy = byId('stats-bot-wins-easy');
  const statsBotWinsMedium = byId('stats-bot-wins-medium');
  const statsBotWinsHard = byId('stats-bot-wins-hard');

  if (statsTotalWins) statsTotalWins.innerText = currentPlayerSummary.totalWins || 0;
  if (statsTotalLosses) statsTotalLosses.innerText = currentPlayerSummary.totalLosses || 0;
  if (statsPlayerVsPlayerWins) statsPlayerVsPlayerWins.innerText = currentPlayerSummary.playerVsPlayerWins || 0;
  if (statsBotWinsEasy) statsBotWinsEasy.innerText = currentPlayerSummary.botWinsEasy || 0;
  if (statsBotWinsMedium) statsBotWinsMedium.innerText = currentPlayerSummary.botWinsMedium || 0;
  if (statsBotWinsHard) statsBotWinsHard.innerText = currentPlayerSummary.botWinsHard || 0;
}

function applyPlayerProfile(playerProfile) {
  if (!playerProfile) {
    return;
  }

  currentPlayerProfile = {
    ...currentPlayerProfile,
    ...playerProfile
  };

  if (!currentPlayerProfile.avatarUrl) {
    currentPlayerProfile.avatarUrl = buildStoredAvatarUrl(currentPlayerProfile.playerId, currentPlayerProfile.avatarVersion);
  }

  renderProfileSettings();
}

function syncPlayerProfileAcrossUi(playerProfile) {
  if (!playerProfile || playerProfile.playerId == null) {
    return;
  }

  Object.keys(leaderboardState.entriesByTab).forEach(tabKey => {
    leaderboardState.entriesByTab[tabKey] = (leaderboardState.entriesByTab[tabKey] || []).map(entry => {
      if (String(entry.playerId) !== String(playerProfile.playerId)) {
        return entry;
      }

      return {
        ...entry,
        username: playerProfile.username || entry.username,
        avatarVersion: playerProfile.avatarVersion || 0,
        avatarUrl: playerProfile.avatarUrl || ''
      };
    });
  });

  playerDirectoryState.entries = playerDirectoryState.entries.map(entry => {
    if (String(entry.playerId) !== String(playerProfile.playerId)) {
      return entry;
    }

    return {
      ...entry,
      username: playerProfile.username || entry.username,
      bio: playerProfile.bio || '',
      avatarVersion: playerProfile.avatarVersion || 0,
      avatarUrl: playerProfile.avatarUrl || ''
    };
  });
}

function updateProfileBioCount() {
  const bioInput = byId('profile-bio-input');
  const count = byId('profile-bio-count');
  if (!bioInput || !count) {
    return;
  }

  count.innerText = `${bioInput.value.length} / ${PROFILE_BIO_MAX_LENGTH}`;
}

function renderProfileSettings() {
  const avatar = byId('profile-settings-avatar');
  const name = byId('profile-settings-name');
  const id = byId('profile-settings-id');
  const bioInput = byId('profile-bio-input');
  const saveNote = byId('profile-save-note');

  if (avatar) {
    avatar.src = playerDirectoryState.queuedAvatarDataUrl || getPlayerAvatarUrl(currentPlayerProfile);
    avatar.alt = `${currentPlayerProfile.username || 'Player'} avatar`;
  }

  if (name) name.innerText = currentPlayerProfile.username || 'Player';
  if (id) id.innerText = currentPlayerProfile.playerId == null ? 'Formbar ID unavailable' : `Formbar ID ${currentPlayerProfile.playerId}`;
  if (bioInput && document.activeElement !== bioInput) {
    bioInput.value = String(currentPlayerProfile.bio || '');
  }
  if (saveNote && !saveNote.innerText) {
    saveNote.innerText = '';
  }

  updateProfileBioCount();
}

async function savePlayerProfileSettings() {
  const bioInput = byId('profile-bio-input');
  const saveNote = byId('profile-save-note');
  if (!bioInput || !saveNote) {
    return;
  }

  saveNote.innerText = 'Saving profile...';

  try {
    const response = await fetch('/player-profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bio: bioInput.value,
        avatarDataUrl: playerDirectoryState.queuedAvatarDataUrl || ''
      })
    });
    const responseData = await response.json();

    if (!response.ok || !responseData.success) {
      throw new Error(responseData.message || 'failed to save profile');
    }

    playerDirectoryState.queuedAvatarDataUrl = '';
    applyPlayerProfile(responseData.playerProfile);
    leaderboardState.profileByPlayerId[currentPlayerProfile.playerId] = responseData.playerProfile;
    syncPlayerProfileAcrossUi(responseData.playerProfile);
    saveNote.innerText = 'Profile saved.';
    renderLeaderboardView();
    renderPlayerDirectory();
  } catch (error) {
    saveNote.innerText = error.message;
  }
}

function queueProfileAvatar(input) {
  if (!input || !input.files || !input.files[0]) {
    return;
  }

  const reader = new FileReader();
  reader.onload = event => {
    playerDirectoryState.queuedAvatarDataUrl = String(event.target.result || '');
    const saveNote = byId('profile-save-note');
    if (saveNote) saveNote.innerText = 'New image ready. Save profile to apply.';
    renderProfileSettings();
  };
  reader.readAsDataURL(input.files[0]);
  input.value = '';
}

function createDirectoryCard(entry) {
  const card = document.createElement('button');
  const avatar = document.createElement('img');
  const copy = document.createElement('div');
  const nameRow = document.createElement('div');
  const name = document.createElement('div');
  const id = document.createElement('div');
  const bio = document.createElement('div');

  card.type = 'button';
  card.className = 'directory-card';
  setPlayerProfileTrigger(card, entry);

  avatar.className = 'directory-avatar';
  avatar.src = getPlayerAvatarUrl(entry);
  avatar.alt = `${entry.username || 'Player'} avatar`;

  copy.className = 'directory-copy';
  nameRow.className = 'directory-name-row';
  name.className = 'directory-name';
  id.className = 'directory-id';
  bio.className = 'directory-bio';

  name.innerText = entry.username || 'Unknown Player';
  id.innerText = entry.playerId == null ? 'Legacy' : `ID ${entry.playerId}`;
  bio.innerText = String(entry.bio || '').trim() || 'No bio set yet.';

  nameRow.append(name, id);
  copy.append(nameRow, bio);
  card.append(avatar, copy);

  return card;
}

function renderPlayerDirectory() {
  const meta = byId('player-directory-meta');
  const grid = byId('player-directory-grid');
  if (!meta || !grid) {
    return;
  }

  if (playerDirectoryState.loading) {
    meta.innerText = 'Loading players...';
    grid.innerHTML = '<div class="room-empty">Loading players...</div>';
    return;
  }

  const searchValue = playerDirectoryState.searchTerm.trim().toLowerCase();
  const filteredEntries = playerDirectoryState.entries.filter(entry => {
    if (!searchValue) return true;
    return String(entry.username || '').toLowerCase().includes(searchValue)
      || String(entry.playerId || '').toLowerCase().includes(searchValue);
  });

  meta.innerText = `${filteredEntries.length} player${filteredEntries.length === 1 ? '' : 's'} shown`;
  grid.innerHTML = '';

  if (!filteredEntries.length) {
    grid.innerHTML = '<div class="room-empty">No players match your search.</div>';
    return;
  }

  filteredEntries.forEach(entry => {
    grid.appendChild(createDirectoryCard(entry));
  });
}

async function loadPlayerDirectory() {
  playerDirectoryState.loading = true;
  renderPlayerDirectory();

  try {
    const response = await fetch('/players');
    const responseData = await response.json();
    if (!response.ok || !responseData.success) {
      throw new Error(responseData.message || 'failed to load players');
    }

    playerDirectoryState.entries = Array.isArray(responseData.players) ? responseData.players : [];
  } catch (error) {
    playerDirectoryState.entries = [];
    const meta = byId('player-directory-meta');
    const grid = byId('player-directory-grid');
    if (meta) meta.innerText = 'Could not load player directory.';
    if (grid) grid.innerHTML = `<div class="room-empty">${error.message}</div>`;
  } finally {
    playerDirectoryState.loading = false;
    renderPlayerDirectory();
  }
}

function initializePlayerDirectoryPanel() {
  if (playerDirectoryState.isInitialized) {
    return;
  }

  const input = byId('player-directory-search');
  if (input) {
    input.value = playerDirectoryState.searchTerm;
    input.addEventListener('input', event => {
      playerDirectoryState.searchTerm = String(event.target.value || '');
      renderPlayerDirectory();
    });
  }

  const bioInput = byId('profile-bio-input');
  if (bioInput) {
    bioInput.addEventListener('input', () => {
      updateProfileBioCount();
      const saveNote = byId('profile-save-note');
      if (saveNote) saveNote.innerText = '';
    });
  }

  playerDirectoryState.isInitialized = true;
}

function renderMainMenu() {
  renderPlayerSummaryUi();
  renderProfileSettings();
}

function applyPlayerSummary(playerSummary, eloRatingChange) {
  if (!playerSummary) {
    return;
  }

  currentPlayerSummary = {
    ...currentPlayerSummary,
    ...playerSummary
  };

  renderMainMenu();

  if (typeof eloRatingChange === 'number') {
    const direction = eloRatingChange >= 0 ? '+' : '';
    setStatus(`Elo ${direction}${eloRatingChange} | rank ${currentPlayerSummary.rank ? `#${currentPlayerSummary.rank}` : '-'}`);
  }
}

async function loadPlayerSummary() {
  try {
    const response = await fetch('/player-summary');
    const responseData = await response.json();
    if (!response.ok || !responseData.success) {
      return;
    }

    applyPlayerSummary(responseData.playerSummary);
    applyPlayerProfile(responseData.playerSummary);
  } catch (error) {}
}

function getCurrentModeLabel() {
  if (gameMode === BOT_MATCH_MODE) return 'Bot Match';
  if (gameMode === 'fortyLine') return '40-Line Mode';
  if (gameMode === 'multiplayer') return 'Multiplayer';
  if (gameMode === 'tournament') return 'Tournament';
  if (gameMode === 'spectator') return 'Spectator';
  return 'Singleplayer';
}

function isTimeBasedMode(modeType) {
  return modeType === 'fortyLine';
}

function formatElapsedTime(milliseconds) {
  const safeMilliseconds = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(safeMilliseconds / 60000);
  const seconds = Math.floor((safeMilliseconds % 60000) / 1000);
  const remainingMilliseconds = safeMilliseconds % 1000;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(remainingMilliseconds).padStart(3, '0')}`;
}

function formatFortyLineComparison(deltaMilliseconds) {
  if (!Number.isFinite(deltaMilliseconds) || deltaMilliseconds === 0) {
    return 'TIED PB';
  }

  const deltaSeconds = (Math.abs(deltaMilliseconds) / 1000).toFixed(2);
  return deltaMilliseconds > 0
    ? `+${deltaSeconds}s slower`
    : `-${deltaSeconds}s faster`;
}

function formatFortyLineDeltaText(deltaMilliseconds) {
  if (!Number.isFinite(deltaMilliseconds)) {
    return '0.00s';
  }

  return `${(Math.abs(deltaMilliseconds) / 1000).toFixed(2)}s`;
}

function setFortyLineResultsSummary({ personalBestText, comparisonText, noteText }) {
  const personalBest = byId('forty-line-personal-best');
  const comparison = byId('forty-line-result-comparison');
  const note = byId('forty-line-results-note');

  if (personalBest && typeof personalBestText === 'string') {
    personalBest.innerText = personalBestText;
  }

  if (comparison && typeof comparisonText === 'string') {
    comparison.innerText = comparisonText;
  }

  if (note && typeof noteText === 'string') {
    note.innerText = noteText;
  }
}

function buildFortyLineResultsSummary(finalTime, previousBestTime) {
  if (!Number.isFinite(finalTime)) {
    return {
      personalBestText: '--',
      comparisonText: '--',
      noteText: 'Result unavailable.'
    };
  }

  if (!Number.isFinite(previousBestTime)) {
    return {
      personalBestText: formatElapsedTime(finalTime),
      comparisonText: 'NEW PB',
      noteText: 'First recorded 40-line run.'
    };
  }

  if (finalTime < previousBestTime) {
    return {
      personalBestText: formatElapsedTime(finalTime),
      comparisonText: 'NEW PB',
      noteText: `${formatFortyLineDeltaText(finalTime - previousBestTime)} faster than ${formatElapsedTime(previousBestTime)}.`
    };
  }

  if (finalTime === previousBestTime) {
    return {
      personalBestText: formatElapsedTime(previousBestTime),
      comparisonText: 'TIED PB',
      noteText: `Matched your best run at ${formatElapsedTime(previousBestTime)}.`
    };
  }

  return {
    personalBestText: formatElapsedTime(previousBestTime),
    comparisonText: formatFortyLineComparison(finalTime - previousBestTime),
    noteText: `Best run remains ${formatElapsedTime(previousBestTime)}.`
  };
}

function getFortyLineElapsedTime(currentTime = performance.now()) {
  if (fortyLineModeState.timerStarted) {
    return currentTime - fortyLineModeState.timerStartTime;
  }

  return fortyLineModeState.elapsedTime;
}

function resetFortyLineModeState() {
  fortyLineModeState.resultsRequestId += 1;
  fortyLineModeState.currentLinesCleared = 0;
  fortyLineModeState.timerStarted = false;
  fortyLineModeState.timerStartTime = 0;
  fortyLineModeState.elapsedTime = 0;
  fortyLineModeState.finalTime = null;
  fortyLineModeState.scoreSaved = false;
}

function startFortyLineTimerIfNeeded(startTime = performance.now()) {
  if (!isFortyLineMode() || fortyLineModeState.timerStarted || fortyLineModeState.finalTime !== null) {
    return;
  }

  fortyLineModeState.timerStarted = true;
  fortyLineModeState.timerStartTime = startTime;
  updateFortyLineUi(startTime);
}

function stopFortyLineTimer(stopTime = performance.now()) {
  if (!fortyLineModeState.timerStarted) {
    return fortyLineModeState.elapsedTime;
  }

  fortyLineModeState.elapsedTime = stopTime - fortyLineModeState.timerStartTime;
  fortyLineModeState.timerStarted = false;
  return fortyLineModeState.elapsedTime;
}

function updateFortyLineUi(currentTime = performance.now()) {
  const modeValue = byId('mode-value');
  const timerBox = byId('timer-box');
  const timerValue = byId('timer-value');

  if (modeValue) {
    modeValue.innerText = getCurrentModeLabel();
  }

  if (!timerBox || !timerValue) {
    return;
  }

  timerBox.style.display = isFortyLineMode() ? 'block' : 'none';
  if (!isFortyLineMode()) {
    timerValue.innerText = '00:00.000';
    return;
  }

  const displayedTime = fortyLineModeState.finalTime !== null
    ? fortyLineModeState.finalTime
    : getFortyLineElapsedTime(currentTime);

  timerValue.innerText = formatElapsedTime(displayedTime);
}

function showOverlayPanel(panelId) {
  const overlay = byId('overlay');
  const panelIds = [
    'main-menu-panel',
    'settings-panel',
    'companion-panel',
    'forty-line-results-panel',
    'leaderboards-panel',
    'player-stats-panel',
    'player-directory-panel',
    'profile-settings-panel',
    'online-play-panel',
    'bot-play-panel',
    'controls-panel'
  ];

  if (panelId !== 'leaderboards-panel') {
    closeLeaderboardProfile();
  }

  if (overlayCloseTimer) {
    window.clearTimeout(overlayCloseTimer);
    overlayCloseTimer = 0;
  }

  panelIds.forEach(id => {
    const panel = byId(id);
    if (!panel) {
      return;
    }

    panel.classList.remove('is-visible', 'is-closing');
    panel.style.display = id === panelId ? 'flex' : 'none';

    if (id === panelId && panel.classList.contains('menu-popout')) {
      requestAnimationFrame(() => {
        panel.classList.add('is-visible');
      });
    }
  });

  if (overlay) {
    overlay.classList.toggle('forty-line-results-overlay', panelId === 'forty-line-results-panel');
  }
}

function getActiveMenuPopoutId() {
  return ['online-play-panel', 'bot-play-panel', 'controls-panel'].find(id => {
    const panel = byId(id);
    return panel && window.getComputedStyle(panel).display !== 'none';
  }) || '';
}

function setMenuReadyStatus() {
  if (isFortyLineMode()) {
    setStatus('40-Line Mode ready');
    return;
  }

  if (gameMode === BOT_MATCH_MODE) {
    const botMatch = currentBotMatch || pendingBotMatchSetup;
    if (botMatch) {
      setStatus(botMatch.isRanked === false
        ? `${botMatch.botName} practice ready`
        : `${botMatch.botName} ready`);
      return;
    }
  }

  setStatus('singleplayer ready');
}

function closeActiveMenuPopout() {
  const panelId = getActiveMenuPopoutId();
  const panel = panelId ? byId(panelId) : null;
  if (!panel) {
    return false;
  }

  if (panelId === 'controls-panel') {
    cancelControlRebind();
  }

  panel.classList.remove('is-visible');
  panel.classList.add('is-closing');

  overlayCloseTimer = window.setTimeout(() => {
    overlayCloseTimer = 0;
    if (panelId === 'online-play-panel') {
      onlineMenuOpen = false;
    }

    if (!currentRoom) {
      setMenuReadyStatus();
    }

    showOverlayPanel('main-menu-panel');
    updateModeUi();
  }, 180);

  return true;
}

function sortLeaderboard(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  const modeType = entries[0].modeType;
  const sortedEntries = [...entries];

  sortedEntries.sort((firstEntry, secondEntry) => {
    if (firstEntry.scoreOrTime === secondEntry.scoreOrTime) {
      return new Date(firstEntry.timestamp).getTime() - new Date(secondEntry.timestamp).getTime();
    }

    if (isTimeBasedMode(modeType)) {
      return firstEntry.scoreOrTime - secondEntry.scoreOrTime;
    }

    return secondEntry.scoreOrTime - firstEntry.scoreOrTime;
  });

  return sortedEntries;
}

async function addScore(entry) {
  const response = await fetch('/leaderboard/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(entry)
  });

  const responseData = await response.json();
  if (!response.ok || !responseData.success) {
    throw new Error(responseData.message || 'failed to save leaderboard entry');
  }

  return responseData.entry;
}

async function getLeaderboard(mode, timeframe = 'allTime') {
  const response = await fetch(`/leaderboard/${encodeURIComponent(mode)}?timeframe=${encodeURIComponent(timeframe)}`);
  const responseData = await response.json();

  if (!response.ok || !responseData.success) {
    throw new Error(responseData.message || 'failed to load leaderboard');
  }

  return sortLeaderboard(responseData.entries || []);
}

function formatLeaderboardValue(entry) {
  if (isTimeBasedMode(entry.modeType)) {
    return formatElapsedTime(entry.scoreOrTime);
  }

  return String(entry.scoreOrTime);
}

function renderFortyLineLeaderboard(leaderboardEntries) {
  const leaderboardWrap = byId('forty-line-leaderboard');
  if (!leaderboardWrap) {
    return;
  }

  if (!leaderboardEntries.length) {
    leaderboardWrap.innerHTML = '<div class="room-empty">No leaderboard entries yet</div>';
    return;
  }

  leaderboardWrap.innerHTML = leaderboardEntries.slice(0, 10).map((entry, index) => {
    const timestampText = new Date(entry.timestamp).toLocaleString();
    return `
      <div class="leader-row">
        <span>#${index + 1}</span>
        <span>${entry.playerName}<br><span style="color:var(--muted); font-size:0.5rem;">${timestampText}</span></span>
        <span>${formatLeaderboardValue(entry)}</span>
      </div>
    `;
  }).join('');
}

async function loadFortyLineLeaderboard() {
  const leaderboardWrap = byId('forty-line-leaderboard');
  const timeframeSelect = byId('forty-line-timeframe');
  if (!leaderboardWrap || !timeframeSelect) {
    return;
  }

  leaderboardWrap.innerHTML = '<div class="room-empty">Loading leaderboard...</div>';

  try {
    const leaderboardEntries = await getLeaderboard('fortyLine', timeframeSelect.value);
    renderFortyLineLeaderboard(leaderboardEntries);
  } catch (error) {
    leaderboardWrap.innerHTML = `<div class="room-empty">${error.message}</div>`;
  }
}

async function loadMainMenuLeaderboard() {
  initializeLeaderboardPanel();
  activateLeaderboardTab(leaderboardState.activeTabKey);
}

function getLeaderboardTabConfig(tabKey) {
  return LEADERBOARD_TABS.find(tab => tab.key === tabKey) || LEADERBOARD_TABS[0];
}

function hashTextValue(text) {
  let hash = 0;
  const input = String(text || '');

  for (let index = 0; index < input.length; index++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function getAvatarInitials(username) {
  const words = String(username || 'Player').trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map(word => word[0]).join('');
  return (letters || 'P').toUpperCase();
}

function getPlayerAvatarUrl(entry) {
  const safeEntry = entry || {};

  if (safeEntry.avatarUrl) {
    return safeEntry.avatarUrl;
  }

  const storedAvatarUrl = buildStoredAvatarUrl(safeEntry.playerId, safeEntry.avatarVersion);
  if (storedAvatarUrl) {
    return storedAvatarUrl;
  }

  const avatarSeed = `${safeEntry.username || 'Player'}-${safeEntry.playerId || 'legacy'}`;
  const hue = hashTextValue(avatarSeed) % 360;
  const avatarSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
      <rect width="80" height="80" fill="hsl(${hue} 42% 20%)"/>
      <rect x="6" y="6" width="68" height="68" fill="hsl(${(hue + 28) % 360} 46% 32%)"/>
      <text x="40" y="48" text-anchor="middle" font-family="monospace" font-size="24" fill="#f3f6ea">${getAvatarInitials(safeEntry.username)}</text>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(avatarSvg)}`;
}

async function getLeaderboardCategory(tabKey) {
  const response = await fetch(`/leaderboards/${encodeURIComponent(tabKey)}`);
  const responseData = await response.json();

  if (!response.ok || !responseData.success) {
    throw new Error(responseData.message || 'failed to load leaderboard category');
  }

  return Array.isArray(responseData.entries) ? responseData.entries : [];
}

function getFilteredLeaderboardEntries() {
  const tabEntries = leaderboardState.entriesByTab[leaderboardState.activeTabKey] || [];
  const searchValue = leaderboardState.searchTerm.trim().toLowerCase();

  if (!searchValue) {
    return tabEntries;
  }

  return tabEntries.filter(entry => {
    const usernameText = String(entry.username || '').toLowerCase();
    const playerIdText = entry.playerId == null ? '' : String(entry.playerId).toLowerCase();
    return usernameText.includes(searchValue) || playerIdText.includes(searchValue);
  });
}

function updateLeaderboardPagination(filteredEntries) {
  const previousButton = byId('leaderboard-prev-btn');
  const nextButton = byId('leaderboard-next-btn');
  const pageCopy = byId('leaderboard-page-copy');
  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / LEADERBOARD_PAGE_SIZE));

  leaderboardState.currentPage = clamp(leaderboardState.currentPage, 1, totalPages);

  if (pageCopy) {
    pageCopy.innerText = `Page ${leaderboardState.currentPage} of ${totalPages}`;
  }

  if (previousButton) {
    previousButton.disabled = leaderboardState.currentPage <= 1;
  }

  if (nextButton) {
    nextButton.disabled = leaderboardState.currentPage >= totalPages;
  }
}

function renderLeaderboardTabs() {
  const tabsWrap = byId('leaderboard-tabs');
  if (!tabsWrap) {
    return;
  }

  tabsWrap.innerHTML = '';
  LEADERBOARD_TABS.forEach(tab => {
    const tabButton = document.createElement('button');
    const isActiveTab = tab.key === leaderboardState.activeTabKey;
    tabButton.type = 'button';
    tabButton.className = `btn leaderboard-tab ${isActiveTab ? 'active' : 'secondary inactive'}`;
    tabButton.innerText = tab.label;
    tabButton.onclick = () => {
      activateLeaderboardTab(tab.key);
    };
    tabsWrap.appendChild(tabButton);
  });
}

function createLeaderboardCard(entry, rankNumber) {
  const cardButton = document.createElement('button');
  const avatar = document.createElement('img');
  const copyWrap = document.createElement('div');
  const nameLine = document.createElement('div');
  const hintLine = document.createElement('div');

  cardButton.type = 'button';
  cardButton.className = 'leaderboard-card';
  cardButton.setAttribute('aria-label', `Open ${entry.username || 'player'} profile`);
  setPlayerProfileTrigger(cardButton, entry);

  avatar.className = 'leaderboard-avatar';
  avatar.src = getPlayerAvatarUrl(entry);
  avatar.alt = `${entry.username} avatar`;

  copyWrap.className = 'leaderboard-card-copy';
  nameLine.className = 'leaderboard-card-name';
  nameLine.innerText = entry.username || 'Unknown Player';
  hintLine.className = 'leaderboard-card-hint';
  hintLine.innerText = entry.playerId == null ? `Rank #${rankNumber}` : `Formbar ID ${entry.playerId}`;

  copyWrap.append(nameLine, hintLine);
  cardButton.append(avatar, copyWrap);

  return cardButton;
}

function renderLeaderboardGrid() {
  const leaderboardGrid = byId('leaderboard-grid');
  const leaderboardMeta = byId('leaderboard-meta');
  if (!leaderboardGrid || !leaderboardMeta) {
    return;
  }

  const activeTab = getLeaderboardTabConfig(leaderboardState.activeTabKey);
  if (leaderboardState.loadingTabKey === leaderboardState.activeTabKey) {
    leaderboardMeta.innerText = `Loading ${activeTab.label}...`;
    leaderboardGrid.innerHTML = '<div class="room-empty">Loading leaderboard...</div>';
    updateLeaderboardPagination([]);
    return;
  }

  if (leaderboardState.errorMessageByTab[leaderboardState.activeTabKey]) {
    leaderboardMeta.innerText = 'Could not load leaderboard.';
    leaderboardGrid.innerHTML = `<div class="room-empty">${leaderboardState.errorMessageByTab[leaderboardState.activeTabKey]}</div>`;
    updateLeaderboardPagination([]);
    return;
  }

  const filteredEntries = getFilteredLeaderboardEntries();
  const totalEntries = leaderboardState.entriesByTab[leaderboardState.activeTabKey] || [];
  updateLeaderboardPagination(filteredEntries);

  if (!filteredEntries.length) {
    leaderboardMeta.innerText = leaderboardState.searchTerm
      ? `No players match "${leaderboardState.searchTerm}".`
      : `${activeTab.label} contains ${totalEntries.length} players.`;
    leaderboardGrid.innerHTML = `<div class="room-empty">${leaderboardState.searchTerm ? 'No players match your search.' : activeTab.emptyText}</div>`;
    return;
  }

  const pageStart = (leaderboardState.currentPage - 1) * LEADERBOARD_PAGE_SIZE;
  const pageEntries = filteredEntries.slice(pageStart, pageStart + LEADERBOARD_PAGE_SIZE);

  leaderboardMeta.innerText = `${activeTab.label} • ${filteredEntries.length} player${filteredEntries.length === 1 ? '' : 's'} shown`;
  leaderboardGrid.innerHTML = '';

  pageEntries.forEach((entry, index) => {
    leaderboardGrid.appendChild(createLeaderboardCard(entry, pageStart + index + 1));
  });
}

function renderLeaderboardView() {
  renderLeaderboardTabs();
  renderLeaderboardGrid();
}

async function loadLeaderboardTab(tabKey) {
  leaderboardState.activeTabKey = tabKey;
  leaderboardState.loadingTabKey = tabKey;
  leaderboardState.currentPage = 1;
  renderLeaderboardView();

  try {
    leaderboardState.entriesByTab[tabKey] = await getLeaderboardCategory(tabKey);
    leaderboardState.errorMessageByTab[tabKey] = '';
  } catch (error) {
    leaderboardState.entriesByTab[tabKey] = [];
    leaderboardState.errorMessageByTab[tabKey] = error.message;
  } finally {
    leaderboardState.loadingTabKey = '';
    renderLeaderboardView();
  }
}

function activateLeaderboardTab(tabKey) {
  if (
    leaderboardState.activeTabKey === tabKey
    && Object.prototype.hasOwnProperty.call(leaderboardState.entriesByTab, tabKey)
    && !leaderboardState.errorMessageByTab[tabKey]
  ) {
    leaderboardState.currentPage = 1;
    renderLeaderboardView();
    return;
  }

  loadLeaderboardTab(tabKey);
}

function updateLeaderboardSearch(nextValue) {
  leaderboardState.searchTerm = String(nextValue || '');
  leaderboardState.currentPage = 1;
  renderLeaderboardView();
}

function changeLeaderboardPage(step) {
  const filteredEntries = getFilteredLeaderboardEntries();
  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / LEADERBOARD_PAGE_SIZE));
  leaderboardState.currentPage = clamp(leaderboardState.currentPage + step, 1, totalPages);
  renderLeaderboardView();
}

function renderLeaderboardProfileStat(label, value) {
  return `
    <div class="player-profile-stat">
      <div class="stat-label">${label}</div>
      <div class="player-profile-stat-value">${value}</div>
    </div>
  `;
}

function getPlayerProfileElements() {
  return {
    popout: byId('player-profile-popout'),
    card: byId('player-profile-card'),
    avatar: byId('player-profile-avatar'),
    name: byId('player-profile-name'),
    id: byId('player-profile-id'),
    bio: byId('player-profile-bio'),
    grid: byId('player-profile-grid')
  };
}

function setPlayerProfileTrigger(element, entry) {
  if (!element || !entry) {
    return element;
  }

  element.dataset.playerProfileTrigger = 'true';
  element.dataset.playerProfileUsername = String(entry.username || '');

  if (entry.playerId == null || entry.playerId === '') {
    delete element.dataset.playerProfileId;
  } else {
    element.dataset.playerProfileId = String(entry.playerId);
  }

  if (entry.value == null) {
    delete element.dataset.playerProfileValue;
  } else {
    element.dataset.playerProfileValue = String(entry.value);
  }

  if (entry.avatarVersion == null) {
    delete element.dataset.playerProfileAvatarVersion;
  } else {
    element.dataset.playerProfileAvatarVersion = String(entry.avatarVersion);
  }

  if (entry.bio == null) {
    delete element.dataset.playerProfileBio;
  } else {
    element.dataset.playerProfileBio = String(entry.bio);
  }

  if (entry.avatarUrl) {
    element.dataset.playerProfileAvatarUrl = String(entry.avatarUrl);
  } else {
    delete element.dataset.playerProfileAvatarUrl;
  }

  return element;
}

function getPlayerProfileEntryFromTrigger(trigger) {
  if (!trigger) {
    return null;
  }

  const playerIdText = trigger.dataset.playerProfileId;
  const valueText = trigger.dataset.playerProfileValue;
  const avatarVersionText = trigger.dataset.playerProfileAvatarVersion;

  return {
    playerId: playerIdText == null || playerIdText === '' ? null : Number(playerIdText),
    username: trigger.dataset.playerProfileUsername || 'Unknown Player',
    value: valueText == null || valueText === '' ? null : Number(valueText),
    avatarVersion: avatarVersionText == null || avatarVersionText === '' ? 0 : Number(avatarVersionText),
    bio: trigger.dataset.playerProfileBio || '',
    avatarUrl: trigger.dataset.playerProfileAvatarUrl || ''
  };
}

function getProfileBioText(playerProfile, entry) {
  if (playerProfile && String(playerProfile.bio || '').trim()) {
    return String(playerProfile.bio).trim();
  }

  if (entry.playerId == null) {
    return 'This run belongs to an older leaderboard entry without a linked player account.';
  }

  return 'No bio set yet.';
}

function getFallbackFortyLineValue(entry) {
  if (leaderboardState.activeTabKey === 'fortyLineTimes' && Number.isFinite(Number(entry.value))) {
    return formatElapsedTime(Number(entry.value));
  }

  return '--';
}

function renderLeaderboardProfile(entry, playerProfile) {
  const elements = getPlayerProfileElements();
  if (!elements.popout || !elements.card || !elements.avatar || !elements.name || !elements.id || !elements.bio || !elements.grid) {
    return;
  }

  const profileEntry = playerProfile
    ? { ...entry, avatarUrl: playerProfile.avatarUrl, avatarVersion: playerProfile.avatarVersion }
    : entry;

  elements.avatar.src = getPlayerAvatarUrl(profileEntry);
  elements.avatar.alt = `${entry.username} avatar`;
  elements.name.innerText = entry.username || 'Unknown Player';
  elements.id.innerText = entry.playerId == null ? 'Legacy leaderboard entry' : `Formbar ID ${entry.playerId}`;
  elements.bio.innerText = getProfileBioText(playerProfile, entry);
  elements.grid.innerHTML = [
    renderLeaderboardProfileStat('ELO With Bot Play', playerProfile ? String(playerProfile.overallElo) : '--'),
    renderLeaderboardProfileStat('ELO Without Bot Play', playerProfile ? String(playerProfile.pvpOnlyElo) : '--'),
    renderLeaderboardProfileStat(
      '40-Line Personal Best',
      playerProfile
        ? (playerProfile.fortyLineBestTime == null ? '--' : formatElapsedTime(playerProfile.fortyLineBestTime))
        : getFallbackFortyLineValue(entry)
    )
  ].join('');
}

function positionLeaderboardProfile(anchorElement) {
  const { card } = getPlayerProfileElements();
  if (!card) {
    return;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = 16;
  const cardRect = card.getBoundingClientRect();
  const cardWidth = cardRect.width || Math.min(360, viewportWidth - (margin * 2));
  const cardHeight = cardRect.height || 260;

  if (!anchorElement || viewportWidth <= 720) {
    card.style.setProperty('--player-profile-left', '50%');
    card.style.setProperty('--player-profile-top', '50%');
    card.style.setProperty('--player-profile-shift-x', '-50%');
    card.style.setProperty('--player-profile-shift-y', '-50%');
    return;
  }

  const anchorRect = anchorElement.getBoundingClientRect();
  const horizontalGap = 14;
  const fitsRight = anchorRect.right + horizontalGap + cardWidth <= viewportWidth - margin;
  const fitsLeft = anchorRect.left - horizontalGap - cardWidth >= margin;
  const top = clamp(
    anchorRect.top + (anchorRect.height / 2) - (cardHeight / 2),
    margin,
    viewportHeight - cardHeight - margin
  );

  card.style.setProperty('--player-profile-top', `${Math.round(top)}px`);
  card.style.setProperty('--player-profile-shift-y', '0px');

  if (fitsRight) {
    card.style.setProperty('--player-profile-left', `${Math.round(anchorRect.right + horizontalGap)}px`);
    card.style.setProperty('--player-profile-shift-x', '0px');
    return;
  }

  if (fitsLeft) {
    card.style.setProperty('--player-profile-left', `${Math.round(anchorRect.left - horizontalGap)}px`);
    card.style.setProperty('--player-profile-shift-x', '-100%');
    return;
  }

  card.style.setProperty('--player-profile-left', '50%');
  card.style.setProperty('--player-profile-top', '50%');
  card.style.setProperty('--player-profile-shift-x', '-50%');
  card.style.setProperty('--player-profile-shift-y', '-50%');
}

function showLeaderboardProfile(anchorElement) {
  const { popout } = getPlayerProfileElements();
  if (!popout) {
    return;
  }

  if (playerProfileState.closeTimer) {
    window.clearTimeout(playerProfileState.closeTimer);
    playerProfileState.closeTimer = 0;
  }

  playerProfileState.anchorElement = anchorElement || null;
  popout.classList.remove('is-closing');
  popout.classList.add('is-open');
  requestAnimationFrame(() => {
    positionLeaderboardProfile(playerProfileState.anchorElement);
  });
}

async function openLeaderboardProfile(entry, anchorElement = null) {
  leaderboardState.activeProfileEntry = entry;
  leaderboardState.activeProfilePlayerId = entry.playerId ?? null;
  renderLeaderboardProfile(entry, null);
  showLeaderboardProfile(anchorElement);

  if (entry.playerId == null) {
    return;
  }

  if (leaderboardState.profileByPlayerId[entry.playerId]) {
    renderLeaderboardProfile(entry, leaderboardState.profileByPlayerId[entry.playerId]);
    requestAnimationFrame(() => positionLeaderboardProfile(playerProfileState.anchorElement));
    return;
  }

  const requestId = ++playerProfileState.requestId;

  try {
    const response = await fetch(`/players/${encodeURIComponent(entry.playerId)}/profile`);
    const responseData = await response.json();

    if (!response.ok || !responseData.success) {
      throw new Error(responseData.message || 'failed to load profile');
    }

    leaderboardState.profileByPlayerId[entry.playerId] = responseData.playerProfile;
    if (requestId !== playerProfileState.requestId || leaderboardState.activeProfilePlayerId !== entry.playerId) {
      return;
    }

    renderLeaderboardProfile(entry, responseData.playerProfile);
    requestAnimationFrame(() => positionLeaderboardProfile(playerProfileState.anchorElement));
  } catch (error) {
    if (requestId !== playerProfileState.requestId) {
      return;
    }

    renderLeaderboardProfile(entry, null);
    requestAnimationFrame(() => positionLeaderboardProfile(playerProfileState.anchorElement));
  }
}

function closeLeaderboardProfile() {
  const { popout } = getPlayerProfileElements();
  if (!popout || !popout.classList.contains('is-open')) {
    return;
  }

  leaderboardState.activeProfileEntry = null;
  leaderboardState.activeProfilePlayerId = null;
  playerProfileState.anchorElement = null;
  playerProfileState.requestId += 1;
  popout.classList.remove('is-open');
  popout.classList.add('is-closing');

  if (playerProfileState.closeTimer) {
    window.clearTimeout(playerProfileState.closeTimer);
  }

  playerProfileState.closeTimer = window.setTimeout(() => {
    popout.classList.remove('is-closing');
    playerProfileState.closeTimer = 0;
  }, PLAYER_PROFILE_CLOSE_MS);
}

function isLeaderboardProfileOpen() {
  const { popout } = getPlayerProfileElements();
  return !!popout && popout.classList.contains('is-open');
}

function handlePlayerProfileTriggerClick(event) {
  const trigger = event.target.closest('[data-player-profile-trigger="true"]');
  const { card } = getPlayerProfileElements();

  if (!trigger) {
    if (isLeaderboardProfileOpen() && card && !card.contains(event.target)) {
      closeLeaderboardProfile();
    }
    return;
  }

  const entry = getPlayerProfileEntryFromTrigger(trigger);
  if (!entry) {
    return;
  }

  event.preventDefault();
  openLeaderboardProfile(entry, trigger);
}

function initializeLeaderboardPanel() {
  if (leaderboardState.isInitialized) {
    renderLeaderboardTabs();
    return;
  }

  const searchInput = byId('leaderboard-search');

  if (searchInput) {
    searchInput.value = leaderboardState.searchTerm;
    searchInput.addEventListener('input', event => {
      updateLeaderboardSearch(event.target.value);
    });
  }

  document.addEventListener('click', handlePlayerProfileTriggerClick);

  leaderboardState.isInitialized = true;
  renderLeaderboardTabs();
}

async function saveFortyLineResult() {
  if (fortyLineModeState.scoreSaved || fortyLineModeState.finalTime === null) {
    return;
  }

  fortyLineModeState.scoreSaved = true;

  try {
    await addScore({
      playerName: playerProfile.username,
      scoreOrTime: fortyLineModeState.finalTime,
      timestamp: new Date().toISOString(),
      modeType: 'fortyLine'
    });
  } catch (error) {
    setStatus(error.message);
  }
}

function randomBetween(botRandom, minValue, maxValue) {
  return minValue + ((maxValue - minValue) * botRandom());
}

function createBotPlayerState() {
  return {
    pos: { x: 0, y: 0 },
    matrix: null,
    type: null,
    rotation: 0
  };
}

function createBotMatchState(botMatchSetup) {
  const currentBoardState = createMatrix(12, 20);
  return {
    matchId: botMatchSetup.matchId,
    botId: botMatchSetup.botId,
    botName: botMatchSetup.botName,
    botDifficulty: botMatchSetup.botDifficulty,
    isRanked: botMatchSetup.isRanked !== false,
    currentBoardState,
    pieceBag: [],
    pieceQueue: [],
    currentPiece: createBotPlayerState(),
    random: createSeededRandom(Date.now()),
    botDecision: null,
    nextActionAt: 0,
    score: 0,
    lines: 0,
    level: 1,
    gameOver: false,
    resultReported: false
  };
}

function shuffleBotBag(botMatch) {
  const nextBag = 'IJLOSTZ'.split('');
  for (let index = nextBag.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(botMatch.random() * (index + 1));
    [nextBag[index], nextBag[swapIndex]] = [nextBag[swapIndex], nextBag[index]];
  }
  return nextBag;
}

function fillBotPieceQueue(botMatch) {
  while (botMatch.pieceQueue.length < 5) {
    if (botMatch.pieceBag.length === 0) {
      botMatch.pieceBag = shuffleBotBag(botMatch);
    }

    const pieceType = botMatch.pieceBag.pop();
    botMatch.pieceQueue.push({
      type: pieceType,
      matrix: cloneMatrix(PIECES[pieceType]),
      rotation: 0
    });
  }
}

function collideBoardState(currentBoardState, currentPiece) {
  if (!currentPiece.matrix) {
    return false;
  }

  for (let y = 0; y < currentPiece.matrix.length; y++) {
    for (let x = 0; x < currentPiece.matrix[y].length; x++) {
      if (currentPiece.matrix[y][x] === 0) {
        continue;
      }

      if ((currentBoardState[y + currentPiece.pos.y] && currentBoardState[y + currentPiece.pos.y][x + currentPiece.pos.x]) !== 0) {
        return true;
      }
    }
  }

  return false;
}

function spawnBotPiece(botMatch, currentTime = performance.now()) {
  fillBotPieceQueue(botMatch);
  const nextPiece = botMatch.pieceQueue.shift();
  fillBotPieceQueue(botMatch);

  botMatch.currentPiece.type = nextPiece.type;
  botMatch.currentPiece.matrix = nextPiece.matrix;
  botMatch.currentPiece.rotation = 0;
  botMatch.currentPiece.pos.y = 0;
  botMatch.currentPiece.pos.x = (botMatch.currentBoardState[0].length / 2 | 0) - (botMatch.currentPiece.matrix[0].length / 2 | 0);

  if (collideBoardState(botMatch.currentBoardState, botMatch.currentPiece)) {
    botMatch.gameOver = true;
    return false;
  }

  botMatch.botDecision = chooseBotDecision(botMatch);
  const botSettings = BOT_MATCH_SETTINGS[botMatch.botDifficulty];
  botMatch.nextActionAt = currentTime + randomBetween(botMatch.random, botSettings.thinkDelayMin, botSettings.thinkDelayMax);
  return true;
}

function findMoveCandidatesForBoardState(currentBoardState, currentPiece) {
  const seenRotations = new Set();
  const moveCandidates = [];
  let matrix = cloneMatrix(currentPiece.matrix);

  for (let rotationTurns = 0; rotationTurns < 4; rotationTurns++) {
    const matrixKey = serializeMatrix(matrix);
    if (!seenRotations.has(matrixKey)) {
      seenRotations.add(matrixKey);

      const pieceWidth = matrix[0].length;
      for (let x = -pieceWidth; x < currentBoardState[0].length; x++) {
        const testPiece = {
          matrix: cloneMatrix(matrix),
          pos: { x, y: 0 }
        };

        if (collideBoardState(currentBoardState, testPiece)) {
          continue;
        }

        while (!collideBoardState(currentBoardState, testPiece)) {
          testPiece.pos.y++;
        }
        testPiece.pos.y--;

        if (testPiece.pos.y < 0) {
          continue;
        }

        const testBoard = currentBoardState.map(row => row.slice());
        testPiece.matrix.forEach((row, y) => {
          row.forEach((value, dx) => {
            if (value !== 0) {
              testBoard[testPiece.pos.y + y][x + dx] = value;
            }
          });
        });

        const linesCleared = clearLinesFromBoard(testBoard);
        const moveScore = scoreAutoplayBoard(testBoard, linesCleared);

        moveCandidates.push({
          score: moveScore,
          x,
          y: testPiece.pos.y,
          matrix: cloneMatrix(matrix),
          linesCleared
        });
      }
    }

    matrix = rotateMatrix(matrix, 1);
  }

  moveCandidates.sort((firstMove, secondMove) => secondMove.score - firstMove.score);
  return moveCandidates;
}

function chooseBotDecision(botMatch) {
  const botSettings = BOT_MATCH_SETTINGS[botMatch.botDifficulty];
  const moveCandidates = findMoveCandidatesForBoardState(botMatch.currentBoardState, botMatch.currentPiece);

  if (!moveCandidates.length) {
    return null;
  }

  const topChoiceCount = Math.min(moveCandidates.length, botSettings.topChoices);
  let chosenIndex = 0;

  if (botMatch.random() < botSettings.mistakeChance) {
    chosenIndex = Math.min(topChoiceCount - 1, 1 + Math.floor(botMatch.random() * topChoiceCount));
  } else if (topChoiceCount > 1 && botMatch.random() < 0.18) {
    chosenIndex = Math.min(topChoiceCount - 1, Math.floor(botMatch.random() * 2));
  }

  return moveCandidates[chosenIndex];
}

function sweepBotBoard(botMatch) {
  let rowCount = 0;

  outer: for (let y = botMatch.currentBoardState.length - 1; y > 0; y--) {
    for (let x = 0; x < botMatch.currentBoardState[y].length; x++) {
      if (botMatch.currentBoardState[y][x] === 0) {
        continue outer;
      }
    }

    botMatch.currentBoardState.unshift(botMatch.currentBoardState.splice(y, 1)[0].fill(0));
    y++;
    rowCount++;
  }

  if (rowCount > 0) {
    botMatch.lines += rowCount;
    botMatch.score += rowCount * 10 * rowCount;
    botMatch.level = Math.max(1, Math.floor(botMatch.lines / 10) + 1);
  }

  return rowCount;
}

function addGarbageRowsToBot(botMatch, lines) {
  for (let index = 0; index < lines; index++) {
    botMatch.currentBoardState.shift();
    const garbageRow = new Array(12).fill(8);
    const holeIndex = Math.floor(botMatch.random() * 12);
    garbageRow[holeIndex] = 0;
    botMatch.currentBoardState.push(garbageRow);
  }
}

function sendGarbageToPlayerFromBot(botMatch, linesCleared) {
  const botSettings = BOT_MATCH_SETTINGS[botMatch.botDifficulty];
  const garbageLines = Math.max(0, Math.round((linesCleared - 1) * botSettings.attackStrength));

  if (garbageLines > 0) {
    addGarbageRows(garbageLines);
  }
}

function buildBotRemoteState(botMatch) {
  return {
    username: botMatch.botName,
    board: botMatch.currentBoardState.map(row => row.slice()),
    score: botMatch.score,
    lines: botMatch.lines,
    level: botMatch.level,
    gameOver: botMatch.gameOver
  };
}

function updateBotRemoteState() {
  if (!currentBotMatch) {
    remoteState = null;
    return;
  }

  remoteState = buildBotRemoteState(currentBotMatch);
  setWatchLabel(`Bot: ${currentBotMatch.botName}`);
}

async function reportBotMatchResult(result) {
  if (!currentBotMatch || currentBotMatch.resultReported) {
    return;
  }

  if (currentBotMatch.isRanked === false) {
    currentBotMatch.resultReported = true;
    return;
  }

  currentBotMatch.resultReported = true;

  try {
    const response = await fetch('/bot-match/result', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        matchId: currentBotMatch.matchId,
        botDifficulty: currentBotMatch.botDifficulty,
        result
      })
    });
    const responseData = await response.json();

    if (!response.ok || !responseData.success) {
      setStatus(responseData.message || 'bot result rejected');
      return;
    }

    if (responseData.playerSummary) {
      applyPlayerSummary(responseData.playerSummary, responseData.eloResult ? responseData.eloResult.playerAEloChange : 0);
    }
  } catch (error) {
    setStatus('bot result failed to save');
  }
}

function finishBotMatch(result) {
  if (!currentBotMatch || currentBotMatch.gameOver && currentBotMatch.resultReported) {
    return;
  }

  currentBotMatch.gameOver = true;
  updateBotRemoteState();
  reportBotMatchResult(result);

  if (result === 'win') {
    showLoseOverlay(`${currentBotMatch.botName} topped out. you win`);
  } else {
    showLoseOverlay(`${currentBotMatch.botName} won`);
  }
}

function applyBotDecision(botMatch) {
  if (!botMatch.botDecision) {
    botMatch.gameOver = true;
    return;
  }

  botMatch.currentPiece.matrix = cloneMatrix(botMatch.botDecision.matrix);
  botMatch.currentPiece.pos.x = botMatch.botDecision.x;
  botMatch.currentPiece.pos.y = 0;

  if (collideBoardState(botMatch.currentBoardState, botMatch.currentPiece)) {
    botMatch.gameOver = true;
    return;
  }

  while (!collideBoardState(botMatch.currentBoardState, botMatch.currentPiece)) {
    botMatch.currentPiece.pos.y++;
  }
  botMatch.currentPiece.pos.y--;

  botMatch.currentPiece.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value !== 0) {
        botMatch.currentBoardState[y + botMatch.currentPiece.pos.y][x + botMatch.currentPiece.pos.x] = value;
      }
    });
  });

  const linesCleared = sweepBotBoard(botMatch);
  if (linesCleared > 1) {
    sendGarbageToPlayerFromBot(botMatch, linesCleared);
  }

  updateBotRemoteState();
  if (!spawnBotPiece(botMatch)) {
    botMatch.gameOver = true;
  }
}

function updateBotMatch(currentTime) {
  if (!currentBotMatch || currentBotMatch.gameOver || gameMode !== BOT_MATCH_MODE || gameState !== 'PLAYING') {
    return;
  }

  if (currentTime < currentBotMatch.nextActionAt) {
    return;
  }

  applyBotDecision(currentBotMatch);
  if (currentBotMatch.gameOver) {
    finishBotMatch('win');
  }
}

function showFortyLineResults() {
  const finalTimeText = formatElapsedTime(fortyLineModeState.finalTime || 0);

  gameState = 'RESULTS';
  sounds.bgm.pause();
  byId('overlay').style.display = 'flex';
  showOverlayPanel('forty-line-results-panel');
  byId('forty-line-final-time').innerText = finalTimeText;
  setFortyLineResultsSummary({
    personalBestText: '--',
    comparisonText: 'Checking...',
    noteText: 'Checking your best run...'
  });
  setStatus(`40 lines cleared in ${finalTimeText}`);
  updateModeUi();
}

async function loadFortyLineResultsSummary() {
  const requestId = ++fortyLineModeState.resultsRequestId;

  try {
    const leaderboardEntries = await getLeaderboard('fortyLine', 'allTime');
    if (requestId !== fortyLineModeState.resultsRequestId) {
      return;
    }

    const previousBestEntry = leaderboardEntries.find(entry => entry.playerName === playerProfile.username);
    const previousBestTime = previousBestEntry ? Number(previousBestEntry.scoreOrTime) : null;

    setFortyLineResultsSummary(buildFortyLineResultsSummary(
      fortyLineModeState.finalTime,
      previousBestTime
    ));
  } catch (error) {
    if (requestId !== fortyLineModeState.resultsRequestId) {
      return;
    }

    setFortyLineResultsSummary({
      personalBestText: '--',
      comparisonText: 'Unavailable',
      noteText: 'Could not load your previous best.'
    });
  }
}

async function completeFortyLineMode() {
  if (!isFortyLineMode() || gameState !== 'PLAYING') {
    return;
  }

  fortyLineModeState.finalTime = stopFortyLineTimer();
  updateFortyLineUi();
  showFortyLineResults();

  await loadFortyLineResultsSummary();
  await saveFortyLineResult();
}

function renderTournamentResults() {
  const wrap = byId('tournament-results');
  const meta = byId('tournament-meta');
  const board = byId('tournament-leaderboard');
  if (!wrap || !meta || !board) return;

  if (!currentTournament) {
    wrap.style.display = 'none';
    meta.innerText = 'No tournament selected.';
    board.innerHTML = '<div class="room-empty">No tournament data yet</div>';
    return;
  }

  wrap.style.display = 'block';

  const stateText = currentTournament.finishedAt
    ? `${currentTournament.payoutStatus === 'paid' ? 'winner paid' : 'winner pending'} ${currentTournament.winnerPayout} / platform kept ${currentTournament.platformCut}`
    : (currentTournament.isLocked ? 'locked and accepting scores' : 'waiting for creator start');

  meta.innerText = `entry ${currentTournament.entryFee} | pool ${currentTournament.prizePool} | ${currentTournament.playerCount}/${currentTournament.maxPlayers} entered | ${currentTournament.submittedPlayers}/${currentTournament.playerCount} scores | ${stateText}`;

  if (!currentTournament.leaderboard || !currentTournament.leaderboard.length) {
    board.innerHTML = '<div class="room-empty">No tournament data yet</div>';
    return;
  }

  board.innerHTML = currentTournament.leaderboard.map((entry, index) => {
    const isWinner = currentTournament.winnerUserId && currentTournament.winnerUserId === entry.userId;
    const scoreText = entry.score == null ? 'waiting' : entry.score;
    return `
      <div class="leader-row${isWinner ? ' winner' : ''}">
        <span>#${index + 1}</span>
        <span>${entry.username}</span>
        <span>${scoreText}</span>
      </div>
    `;
  }).join('');

  renderTournamentControls();
}

function renderTournamentControls() {
  const wrap = byId('tournament-controls');
  const input = byId('tournament-max-players-live');
  const save = byId('save-tournament-settings-btn');
  const hint = byId('tournament-settings-hint');
  if (!wrap || !input || !save || !hint) return;

  const showControls = currentRoomType === 'tournament'
    && !!currentTournament
    && playerRole === 'player'
    && isRoomCreator;

  wrap.style.display = showControls ? 'grid' : 'none';
  if (!showControls) return;

  input.value = currentTournament.maxPlayers || 8;

  const locked = !!(currentTournament.isLocked || currentTournament.finishedAt);
  input.disabled = locked;
  save.disabled = locked;
  hint.innerText = locked
    ? 'Bracket is locked. Player limit cannot change after start.'
    : 'Open tournament only. Limit can be set from 2 to 50 players.';
}

function setCurrentTournament(tournament) {
  currentTournament = tournament || null;
  renderTournamentResults();
}

function applyCurrentRoomMode(role, roomType, tournament, isRanked = true) {
  currentRoomType = roomType || 'standard';
  currentRoomRanked = isRanked !== false;
  setCurrentTournament(tournament);

  if (role === 'spectator') {
    gameMode = 'spectator';
    return;
  }

  gameMode = currentRoomType === 'tournament' && currentTournament
    ? 'tournament'
    : 'multiplayer';
}

function getVisibleOnlineRooms() {
  return activeRooms.filter(room => {
    const roomIsRanked = room.isRanked !== false;
    return selectedOnlinePlayMode === 'ranked'
      ? roomIsRanked
      : !roomIsRanked;
  });
}

function syncOnlineModeButtons() {
  const rankedButton = byId('online-ranked-btn');
  const casualButton = byId('online-casual-btn');
  const rankedActive = selectedOnlinePlayMode === 'ranked';

  if (rankedButton) {
    rankedButton.classList.toggle('is-active', rankedActive);
    rankedButton.classList.toggle('is-inactive', !rankedActive);
    rankedButton.classList.toggle('secondary', !rankedActive);
  }

  if (casualButton) {
    casualButton.classList.toggle('is-active', !rankedActive);
    casualButton.classList.toggle('is-inactive', rankedActive);
    casualButton.classList.toggle('secondary', rankedActive);
  }
}

function updateOnlinePlayCopy() {
  const isRanked = selectedOnlinePlayMode === 'ranked';
  const title = byId('online-room-list-title');
  const copy = byId('online-play-copy');
  const roomListCopy = byId('online-room-list-copy');
  const roomListStatus = byId('online-room-list-status');
  const joinPinInput = byId('join-pin');

  if (title) {
    title.innerText = isRanked ? 'Active Ranked Rooms' : 'Active Casual Rooms';
  }

  if (copy) {
    copy.innerText = isRanked
      ? 'Create a ranked room, join a ranked room, or run a tournament.'
      : 'Create a casual room or hop into a no-rank match.';
  }

  if (roomListCopy) {
    roomListCopy.innerText = isRanked
      ? 'Select a room to join. Tournament joins charge the stored entry fee once.'
      : 'Select a casual room to join. Casual rooms never affect Elo.';
  }

  if (roomListStatus) {
    roomListStatus.innerText = isRanked ? 'Live ranked room list' : 'Live casual room list';
  }

  if (joinPinInput) {
    joinPinInput.disabled = !isRanked;
    if (!isRanked) {
      joinPinInput.value = '';
    }
  }
}

function refreshRoomTypeOptions() {
  const roomType = byId('room-type');
  if (!roomType) {
    return;
  }

  if (selectedOnlinePlayMode === 'casual') {
    roomType.innerHTML = '<option value="standard">Casual Room</option>';
  } else {
    roomType.innerHTML = `
      <option value="standard">Ranked Room</option>
      <option value="tournament">Tournament Room</option>
    `;
  }
}

function toggleRoomTypeFields() {
  const roomType = byId('room-type');
  const showTournamentFields = selectedOnlinePlayMode === 'ranked' && roomType && roomType.value === 'tournament';
  const fields = byId('tournament-create-fields');
  if (fields) {
    fields.style.display = showTournamentFields ? 'grid' : 'none';
  }
}

function setOnlinePlayMode(mode) {
  selectedOnlinePlayMode = mode === 'casual' ? 'casual' : 'ranked';
  syncOnlineModeButtons();
  updateOnlinePlayCopy();
  refreshRoomTypeOptions();
  toggleRoomTypeFields();

  const visibleRooms = getVisibleOnlineRooms();
  if (selectedRoomName && !visibleRooms.find(room => room.roomName === selectedRoomName)) {
    selectedRoomName = '';
  }

  renderRoomList();
}

function getPrimaryButtonLabel() {
  if (gameMode === 'spectator') {
    return 'WATCH';
  }

  if (gameMode === BOT_MATCH_MODE) {
    return currentBotMatch ? `PLAY ${currentBotMatch.botName.toUpperCase()}` : 'PLAY BOT MATCH';
  }

  if (isFortyLineMode()) {
    return 'PLAY 40-LINE MODE';
  }

  if (isTournamentMode()) {
    if (!currentTournament) {
      return 'TOURNAMENT';
    }

    if (currentTournament.finishedAt || currentTournament.hasSubmitted) {
      return 'RESULTS READY';
    }

    if (currentTournament.isLocked) {
      return 'PLAY TOURNAMENT';
    }

    return isRoomCreator ? 'START TOURNAMENT' : 'WAITING FOR START';
  }

  if (gameMode === 'multiplayer') {
    return 'START ROOM GAME';
  }

  return 'PLAY SINGLEPLAYER';
}

function updateStartButton() {
  const button = byId('start-room-btn');
  if (!button) return;

  const showButton = gameState === 'MENU'
    && playerRole === 'player'
    && isRoomCreator
    && gameMode === 'multiplayer';
  button.style.display = showButton ? 'block' : 'none';
  if (showButton) {
    button.innerText = 'Start Game';
  }
}

function updatePrimaryButton() {
  const button = byId('primary-btn');
  if (!button) return;

  const hidePrimary = gameMode === 'multiplayer' && playerRole === 'player' && gameState !== 'PAUSED';
  button.style.display = hidePrimary ? 'none' : 'block';
  button.innerText = getPrimaryButtonLabel();
}

function resetRoomState() {
  currentRoom = null;
  currentRoomType = 'standard';
  currentRoomRanked = true;
  currentTournament = null;
  playerRole = null;
  remoteState = null;
  spectatorBoards = {};
  spectatorMessage = '';
  isRoomCreator = false;
  gameMode = 'singleplayer';
  selectedRoomName = '';
  onlineMenuOpen = false;
  pendingBotMatchSetup = null;
  currentBotMatch = null;
  setWatchLabel('Waiting');
  renderTournamentResults();
}

function updateModeUi() {
  const isSpectator = gameMode === 'spectator';
  const isBotMatch = gameMode === BOT_MATCH_MODE;
  const roomLine = currentRoom
    ? (isTournamentMode() && currentTournament
      ? `${currentRoom} (tournament ${currentTournament.isLocked ? 'locked' : 'open'})`
      : `${currentRoom} (${currentRoomRanked ? 'ranked' : 'casual'} ${playerRole || 'player'})`)
    : (onlineMenuOpen
      ? `Browsing ${selectedOnlinePlayMode} rooms`
      : (isBotMatch && (currentBotMatch || pendingBotMatchSetup)
        ? `${(currentBotMatch || pendingBotMatchSetup).isRanked === false ? 'Practice' : 'Ranked'} bot match: ${(currentBotMatch || pendingBotMatchSetup).botName}`
        : (isFortyLineMode() ? '40-Line Mode' : 'Singleplayer only')));
  setRoomInfo(roomLine);
  byId('room-password').disabled = gameState === 'PLAYING' && !isSpectator;
  byId('online-btn').style.display = gameState === 'MENU' ? 'block' : 'none';
  byId('bot-play-btn').style.display = gameState === 'MENU' ? 'block' : 'none';
  byId('remote-wrap').style.display = (gameMode === 'multiplayer' || isBotMatch || (isSpectator && currentRoomType !== 'tournament')) ? 'block' : 'none';
  byId('watching-line').style.display = isSpectator ? 'block' : 'none';
  updateStartButton();
  updatePrimaryButton();
  renderTournamentResults();
  renderTournamentControls();
  updateFortyLineUi();
  renderPlayerSummaryUi();
}

function clearRoomForm() {
  byId('room-password').value = '';
  byId('tournament-pin').value = '';
  byId('tournament-max-players').value = '8';
  byId('join-pin').value = '';
}

function setSelectedRoom(roomName) {
  selectedRoomName = roomName || '';
  renderRoomList();
}

function requestTournamentJoinPin(roomName) {
  const typed = window.prompt(`PIN required to join tournament ${roomName}.`, byId('join-pin').value || '');
  if (typed === null) return null;
  byId('join-pin').value = typed;
  return typed;
}

function renderRoomList() {
  const list = byId('room-list');
  if (!list) return;

  const visibleRooms = getVisibleOnlineRooms();
  if (!visibleRooms.length) {
    list.innerHTML = `<div class="room-empty">No active ${selectedOnlinePlayMode} rooms on the board</div>`;
    return;
  }

  list.innerHTML = '';
  visibleRooms.forEach(room => {
    const card = document.createElement('div');
    card.className = 'room-card';
    if (selectedRoomName === room.roomName) {
      card.classList.add('selected');
    }
    card.onclick = () => {
      setSelectedRoom(room.roomName);
    };

    const isTournament = room.roomType === 'tournament';
    const roomIsRanked = room.isRanked !== false;
    const modeText = isTournament
      ? (room.locked ? 'locked bracket' : 'player-only bracket')
      : (room.playerCount >= 2 ? 'full room' : 'join as player');
    const rightText = isTournament
      ? `${room.submittedPlayers || 0}/${room.playerCount} scored`
      : `${room.spectatorCount} watch`;
    const ownsRoom = isOwnedByPlayer(room.ownerUserId);
    const canDeleteRoom = ownsRoom && (!isTournament || (!room.locked && room.playerCount <= 1));
    const actions = [
      '<button class="tiny-btn room-join-btn">JOIN</button>'
    ];
    if (!isTournament) {
      actions.push('<button class="tiny-btn dark room-spectate-btn">WATCH</button>');
    }
    if (canDeleteRoom) {
      actions.push('<button class="tiny-btn danger room-delete-btn">DELETE</button>');
    }
    card.innerHTML = `
      <div class="room-card-top">
        <span>${room.roomName}</span>
        <span>${isTournament ? 'TOURNAMENT' : (roomIsRanked ? 'RANKED' : 'CASUAL')}</span>
      </div>
      <div class="room-card-bottom">
        <span>${isTournament ? `${room.playerCount}/${room.maxPlayers || 8} entrants` : `${room.playerCount}/2 players`}</span>
        <span>${modeText}</span>
        <span>${rightText}</span>
      </div>
      ${isTournament ? `<div class="room-card-bottom" style="margin-top:6px;"><span>entry ${room.entryFee}</span><span>pool ${room.prizePool}</span><span>${room.passwordProtected ? 'code' : 'open'}</span></div>` : ''}
      <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:6px;">
        ${actions.join('')}
      </div>
    `;
    card.querySelector('.room-join-btn').onclick = e => {
      e.stopPropagation();
      setSelectedRoom(room.roomName);
      tryJoinRoom(room.roomName, false);
    };
    const spectateBtn = card.querySelector('.room-spectate-btn');
    if (spectateBtn) {
      spectateBtn.onclick = e => {
        e.stopPropagation();
        setSelectedRoom(room.roomName);
        tryJoinRoom(room.roomName, true);
      };
    }
    const deleteBtn = card.querySelector('.room-delete-btn');
    if (deleteBtn) {
      deleteBtn.onclick = e => {
        e.stopPropagation();
        deleteRoom(room.roomName);
      };
    }
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
  setOnlinePlayMode(selectedOnlinePlayMode);
  if (!currentRoom) {
    setRoomInfo(`Browsing ${selectedOnlinePlayMode} rooms`);
  }
  setStatus('opening online rooms...');
  initSocket();
  if (socket) {
    socket.emit('requestRoomList');
  }
  showOverlayPanel('online-play-panel');
  updateModeUi();
}

function closeOnlineMenu() {
  closeActiveMenuPopout();
}

function openBotPlayMenu() {
  showOverlayPanel('bot-play-panel');
}

function closeBotPlayMenu() {
  closeActiveMenuPopout();
}

function openControlsMenu() {
  renderControlsMenu();
  showOverlayPanel('controls-panel');
}

function closeControlsMenu() {
  closeActiveMenuPopout();
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
    if (data) {
      applyPlayerSummary(data);
    }
  });

  socket.on('rankUpdate', data => {
    if (data) {
      applyPlayerSummary(data, data.eloRatingChange);
    }
  });

  socket.on('roomCreated', data => {
    currentRoom = data.roomName;
    playerRole = 'player';
    isRoomCreator = !!(data && data.isCreator);
    applyCurrentRoomMode('player', data && data.roomType, data && data.tournament, data && data.isRanked);
    onlineMenuOpen = false;
    setRoomInfo(`${data.roomName} (${data && data.isRanked === false ? 'casual' : 'ranked'} player)`);
    setSelectedRoom(data.roomName);
    setStatus(data && data.isRanked === false
      ? `casual room made: ${data.roomName}`
      : (currentRoomType === 'tournament'
        ? `tournament room made: ${data.roomName}`
        : (data.passwordProtected ? `room made: ${data.roomName} (locked)` : `room made: ${data.roomName}`)));
    showMenuOverlay(`room ready: ${data.roomName}`);
  });

  socket.on('roomJoined', data => {
    pendingTournamentJoinRoom = '';
    currentRoom = data.roomName;
    playerRole = data.role;
    isRoomCreator = !!(data && data.isCreator);
    applyCurrentRoomMode(data.role, data && data.roomType, data && data.tournament, data && data.isRanked);
    onlineMenuOpen = false;
    setRoomInfo(`${data.roomName} (${data && data.isRanked === false ? 'casual' : 'ranked'} ${data.role})`);
    setSelectedRoom(data.roomName);

    if (data.role === 'spectator') {
      startSpectating();
    } else {
      setStatus(data && data.isRanked === false
        ? `joined casual room ${data.roomName}`
        : (currentRoomType === 'tournament'
          ? `joined tournament ${data.roomName}`
          : `joined ${data.roomName} as player`));
      showMenuOverlay(`joined ${data.roomName}`);
    }
  });

  socket.on('roomState', data => {
    if (!data || !data.roomName) return;

    if (currentRoom === data.roomName) {
      isRoomCreator = sameUserId(data.creatorUserId, playerProfile.userId);
      const tournament = data.tournament
        ? {
            ...data.tournament,
            hasSubmitted: !!data.tournament.leaderboard.find(entry => sameUserId(entry.userId, playerProfile.userId) && entry.score != null)
          }
        : null;
      applyCurrentRoomMode(playerRole, data.roomType || currentRoomType, tournament, data.isRanked);
    }

    if (data.roomType === 'tournament' && data.tournament) {
      const tournament = data.tournament;
      const winnerText = tournament.finishedAt && tournament.winnerUsername
        ? ` | winner ${tournament.winnerUsername}`
        : '';
      setStatus(`${data.roomName}: ${tournament.playerCount}/${tournament.maxPlayers} entered | pool ${tournament.prizePool} | ${tournament.submittedPlayers}/${tournament.playerCount} scores${winnerText}`);
    } else {
      const playerNames = (data.players || []).map(player => player.username).filter(Boolean);
      const playerText = playerNames.length ? playerNames.join(' vs ') : 'waiting for players';
      const watcherText = data.spectators === 1 ? '1 spectator' : `${data.spectators} spectators`;
      const modePrefix = data.isRanked === false ? 'casual room' : 'ranked room';
      setStatus(`${data.roomName}: ${modePrefix} | ${playerText} | ${watcherText}`);
    }
    updateModeUi();
  });

  socket.on('roomsList', rooms => {
    activeRooms = Array.isArray(rooms) ? rooms : [];
    if (selectedRoomName && !getVisibleOnlineRooms().find(room => room.roomName === selectedRoomName)) {
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

    if (data && data.roomType === 'tournament' && currentTournament) {
      setCurrentTournament({
        ...currentTournament,
        isLocked: true,
        seed: data.seed
      });
    }

    if ((gameMode === 'multiplayer' || gameMode === 'tournament') && playerRole === 'player') {
      startGame();
    }
  });

  socket.on('garbage', data => {
    if (gameState !== 'PLAYING' || (gameMode !== 'multiplayer' && gameMode !== 'tournament') || playerRole !== 'player') return;
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
    const message = data && data.message ? data.message : 'room error';
    setStatus(message);
    if (pendingTournamentJoinRoom) {
      window.alert(`Tournament join failed: ${message}`);
      pendingTournamentJoinRoom = '';
    }
  });

  socket.on('roomClosed', data => {
    const closedRoomName = data && data.roomName ? data.roomName : currentRoom;
    const message = data && data.message ? data.message : 'room closed';

    if (closedRoomName && currentRoom === closedRoomName) {
      resetRoomState();
      showMenuOverlay(message);
      updateModeUi();
      return;
    }

    setStatus(message);
  });

  socket.on('tournamentScoreAccepted', data => {
    if (data && data.tournament) {
      setCurrentTournament({
        ...data.tournament,
        hasSubmitted: true
      });
    }
    showMenuOverlay(data ? `score submitted: ${data.score}` : 'score submitted');
  });

  socket.on('tournamentUpdated', data => {
    if (data && data.tournament) {
      setCurrentTournament({
        ...data.tournament,
        hasSubmitted: !!(currentTournament && currentTournament.hasSubmitted)
      });
      setStatus(`tournament limit set to ${data.tournament.maxPlayers}`);
    }
  });

  socket.on('tournamentFinished', data => {
    if (data && data.tournament) {
      const hasSubmitted = !!data.tournament.leaderboard.find(entry => sameUserId(entry.userId, playerProfile.userId) && entry.score != null);
      setCurrentTournament({
        ...data.tournament,
        hasSubmitted
      });
    }

    if (data && sameUserId(data.winnerUserId, playerProfile.userId)) {
      return;
    }

    if (gameState === 'PLAYING' && gameMode === 'tournament') {
      showMenuOverlay(data && data.winnerUsername
        ? `tournament finished. winner: ${data.winnerUsername}`
        : 'tournament finished');
    }
  });

  socket.on('tournamentWinner', data => {
    gameOverSent = true;

    if (data && data.tournament) {
      setCurrentTournament({
        ...data.tournament,
        hasSubmitted: true
      });
    }

    const payoutText = data && data.payoutStatus === 'paid'
      ? `You won ${data.winnerPayout}. Payout sent.`
      : `You won ${data.winnerPayout}. Payout pending.`;

    window.alert(`Congratulations! ${payoutText}`);
    showMenuOverlay(payoutText);
  });

  socket.on('disconnect', () => {
    const hadRoom = !!currentRoom;
    pendingTournamentJoinRoom = '';
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
  const roomType = byId('room-type').value;
  socket.emit('createRoom', {
    roomType,
    isRanked: selectedOnlinePlayMode === 'ranked',
    password: byId('room-password').value,
    entryFee: byId('tournament-entry-fee').value,
    bonusContribution: byId('tournament-bonus').value,
    maxPlayers: byId('tournament-max-players').value,
    pin: byId('tournament-pin').value
  });
  clearRoomForm();
}

function deleteRoom(roomName) {
  if (!roomName) {
    setStatus('pick a room first');
    return;
  }

  if (!window.confirm(`Delete ${roomName}?`)) {
    return;
  }

  initSocket();
  if (!socket) return;

  socket.emit('deleteRoom', { roomName });
}

function updateTournamentSettings() {
  if (!socket || !currentRoom || !currentTournament) {
    setStatus('join a tournament first');
    return;
  }

  socket.emit('updateTournamentSettings', {
    maxPlayers: byId('tournament-max-players-live').value
  });
  setStatus('updating tournament player limit...');
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

  const room = activeRooms.find(item => item.roomName === targetRoom);
  const isPaidTournamentJoin = !!(room && room.roomType === 'tournament' && !forceSpectate);
  let joinPin = isPaidTournamentJoin
    ? byId('join-pin').value
    : '';

  if (isPaidTournamentJoin && !joinPin) {
    joinPin = requestTournamentJoinPin(targetRoom);
    if (joinPin === null) {
      setStatus('tournament join cancelled');
      return;
    }
  }

  setStatus(forceSpectate ? `watching ${targetRoom}...` : `joining ${targetRoom}...`);

  if (forceSpectate) {
    socket.emit('spectateRoom', {
      roomName: targetRoom,
      password
    });
  } else {
    pendingTournamentJoinRoom = isPaidTournamentJoin ? targetRoom : '';
    socket.emit('joinRoom', {
      roomName: targetRoom,
      password,
      pin: joinPin
    });
  }
}

function joinSelectedRoom() {
  tryJoinRoom(selectedRoomName, false);
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

function chooseFortyLineMode() {
  if (gameMode !== 'singleplayer' && gameMode !== 'fortyLine') {
    leaveRoom();
  }
  resetRoomState();
  gameMode = 'fortyLine';
  setStatus('40-Line Mode ready');
  setRoomInfo('40-Line Mode');
  updateModeUi();
  startGame();
}

async function chooseBotMatch(botDifficulty, matchStyle = 'ranked') {
  if (!BOT_MATCH_SETTINGS[botDifficulty]) {
    setStatus('unknown bot difficulty');
    return;
  }

  const isRanked = matchStyle !== 'casual';

  if (gameMode !== 'singleplayer' && gameMode !== BOT_MATCH_MODE) {
    leaveRoom();
  }

  if (!isRanked) {
    resetRoomState();
    gameMode = BOT_MATCH_MODE;
    pendingBotMatchSetup = {
      ...BOT_MATCH_SETTINGS[botDifficulty],
      matchId: `practice-${botDifficulty}-${Date.now()}`,
      isRanked: false
    };
    setStatus(`${BOT_MATCH_SETTINGS[botDifficulty].botName} practice ready`);
    setRoomInfo(`Practice bot match: ${BOT_MATCH_SETTINGS[botDifficulty].botName}`);
    updateModeUi();
    startGame();
    return;
  }

  try {
    const response = await fetch('/bot-match/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ botDifficulty })
    });
    const responseData = await response.json();

    if (!response.ok || !responseData.success) {
      setStatus(responseData.message || 'could not start bot match');
      return;
    }

    resetRoomState();
    gameMode = BOT_MATCH_MODE;
    pendingBotMatchSetup = {
      ...responseData.botMatch,
      botDifficulty,
      isRanked: true
    };
    if (responseData.playerSummary) {
      applyPlayerSummary(responseData.playerSummary);
    }
    setStatus(`${BOT_MATCH_SETTINGS[botDifficulty].botName} ready`);
    setRoomInfo(`Ranked bot match: ${BOT_MATCH_SETTINGS[botDifficulty].botName}`);
    updateModeUi();
    startGame();
  } catch (error) {
    setStatus('could not start bot match');
  }
}

function restartFortyLineMode() {
  resetRoomState();
  gameMode = 'fortyLine';
  setStatus('40-Line Mode ready');
  setRoomInfo('40-Line Mode');
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
const canAutoplayCheat = !!playerProfile.canAutoplayCheat;
const arena = createMatrix(12, 20);
let lastTime = 0;
let dropCounter = 0;
let dropInterval = 1000;
let autoplayMode = '';
let autoplayPieceKey = '';
let autoplayPlan = null;
let autoplayActionAt = 0;
const fortyLineModeState = {
  currentLinesCleared: 0,
  timerStarted: false,
  timerStartTime: 0,
  elapsedTime: 0,
  finalTime: null,
  scoreSaved: false,
  resultsRequestId: 0
};
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
  moveLeft: { down: false, timer: 0 },
  moveRight: { down: false, timer: 0 },
  softDrop: { down: false, timer: 0 }
};
const DAS_DELAY = 170;
const DAS_SPEED = 50;
const AUTOPLAY_SPEEDS = {
  human: { think: 150, rotate: 105, move: 78, drop: 52, finish: 130, hardDropBuffer: 0 },
  fast: { rotate: 65, move: 48, drop: 24, finish: 80, hardDropBuffer: 2 }
};

function resetAutoplayState() {
  autoplayPieceKey = '';
  autoplayPlan = null;
  autoplayActionAt = 0;
}

function clearHeldKeys() {
  Object.values(keys).forEach(key => {
    key.down = false;
    key.timer = 0;
  });
}

function serializeMatrix(matrix) {
  return matrix.map(row => row.join('')).join('|');
}

function clearLinesFromBoard(board) {
  let cleared = 0;
  for (let y = board.length - 1; y >= 0; y--) {
    if (board[y].every(value => value !== 0)) {
      board.splice(y, 1);
      board.unshift(new Array(board[0].length).fill(0));
      cleared++;
      y++;
    }
  }
  return cleared;
}

function getBoardStats(board) {
  const heights = new Array(board[0].length).fill(0);
  let holes = 0;

  for (let x = 0; x < board[0].length; x++) {
    let blockSeen = false;
    for (let y = 0; y < board.length; y++) {
      if (board[y][x] !== 0) {
        if (!blockSeen) {
          heights[x] = board.length - y;
          blockSeen = true;
        }
      } else if (blockSeen) {
        holes++;
      }
    }
  }

  let bumpiness = 0;
  for (let x = 0; x < heights.length - 1; x++) {
    bumpiness += Math.abs(heights[x] - heights[x + 1]);
  }

  return {
    holes,
    bumpiness,
    totalHeight: heights.reduce((sum, height) => sum + height, 0),
    maxHeight: Math.max(...heights)
  };
}

function scoreAutoplayBoard(board, linesCleared) {
  const stats = getBoardStats(board);
  return linesCleared * 100000
    - stats.holes * 7000
    - stats.bumpiness * 120
    - stats.totalHeight * 90
    - stats.maxHeight * 200;
}

function findBestAutoplayMove() {
  if (!player.matrix) return null;

  const seenRotations = new Set();
  const candidates = [];
  let matrix = cloneMatrix(player.matrix);

  for (let rotation = 0; rotation < 4; rotation++) {
    const key = serializeMatrix(matrix);
    if (!seenRotations.has(key)) {
      seenRotations.add(key);
      candidates.push({
        rotation: (player.rotation + rotation) % 4,
        turns: rotation,
        matrix: cloneMatrix(matrix)
      });
    }
    matrix = rotateMatrix(matrix, 1);
  }

  let bestMove = null;

  candidates.forEach(candidate => {
    const width = candidate.matrix[0].length;
    for (let x = -width; x < arena[0].length; x++) {
      const testPlayer = {
        matrix: candidate.matrix,
        pos: { x, y: 0 }
      };

      if (collide(arena, testPlayer)) continue;

      while (!collide(arena, testPlayer)) {
        testPlayer.pos.y++;
      }
      testPlayer.pos.y--;

      if (testPlayer.pos.y < 0) continue;

      const board = arena.map(row => row.slice());
      candidate.matrix.forEach((row, y) => {
        row.forEach((value, dx) => {
          if (value !== 0) {
            board[testPlayer.pos.y + y][x + dx] = value;
          }
        });
      });

      const linesCleared = clearLinesFromBoard(board);
      const score = scoreAutoplayBoard(board, linesCleared);

      if (!bestMove || score > bestMove.score) {
        bestMove = {
          score,
          rotation: candidate.rotation,
          turns: candidate.turns,
          x,
          y: testPlayer.pos.y
        };
      }
    }
  });

  return bestMove;
}

function runPlannedAutoplay(speed) {
  if (!player.matrix) return;

  const pieceKey = `${player.type}:${serializeMatrix(player.matrix)}:${player.pos.x}:${player.pos.y}`;
  if (pieceKey !== autoplayPieceKey) {
    const bestMove = findBestAutoplayMove();
    autoplayPieceKey = pieceKey;
    autoplayPlan = bestMove ? {
      rotation: bestMove.rotation,
      turns: bestMove.turns,
      x: bestMove.x,
      y: bestMove.y
    } : null;
    autoplayActionAt = performance.now() + (speed.think || 0);
  }

  if (!autoplayPlan) return;

  const now = performance.now();
  if (now < autoplayActionAt) return;

  if (autoplayPlan.turns > 0) {
    if (playerRotate(1)) {
      autoplayPlan.turns--;
      autoplayActionAt = now + speed.rotate;
      return;
    }
    resetAutoplayState();
    return;
  }

  if (player.pos.x < autoplayPlan.x) {
    if (movePlayer(1)) {
      autoplayActionAt = now + speed.move;
      return;
    }
    resetAutoplayState();
    return;
  }

  if (player.pos.x > autoplayPlan.x) {
    if (movePlayer(-1)) {
      autoplayActionAt = now + speed.move;
      return;
    }
    resetAutoplayState();
    return;
  }

  if (player.pos.y < Math.max(0, autoplayPlan.y - speed.hardDropBuffer)) {
    if (softDropStep()) {
      autoplayActionAt = now + speed.drop;
      return;
    }
    resetAutoplayState();
    return;
  }

  if (!collide(arena, player)) {
    hardDrop();
    resetAutoplayState();
    autoplayActionAt = now + speed.finish;
  }
}

function runAutoplay() {
  if (!autoplayMode || gameState !== 'PLAYING' || gameMode === 'spectator' || !player.matrix) return;
  runPlannedAutoplay(AUTOPLAY_SPEEDS[autoplayMode] || AUTOPLAY_SPEEDS.human);
}

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
  showOverlayPanel(id);

  if (id === 'leaderboards-panel') {
    loadMainMenuLeaderboard();
  }

  if (id === 'player-stats-panel') {
    renderPlayerSummaryUi();
  }

  if (id === 'player-directory-panel') {
    initializePlayerDirectoryPanel();
    loadPlayerDirectory();
  }

  if (id === 'profile-settings-panel') {
    initializePlayerDirectoryPanel();
    renderProfileSettings();
  }
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
  currentBotMatch = null;
  resetFortyLineModeState();
  resetAutoplayState();
  updateScoreUi();
  updateFortyLineUi();
}

function startGame() {
  if (gameMode === 'spectator') return;
  if (gameMode === BOT_MATCH_MODE && !pendingBotMatchSetup) {
    setStatus('bot match is not ready');
    return;
  }

  arena.forEach(row => row.fill(0));
  bag = [];
  pieceQueue = [];
  remoteState = null;
  resetRunStats();
  resetPieceRandom();
  fillPieceQueue();
  try {
    sounds.bgm.play();
  } catch (e) {}
  gameState = 'PLAYING';
  byId('overlay').style.display = 'none';
  showOverlayPanel('main-menu-panel');
  byId('primary-btn').onclick = handlePrimaryBtn;
  byId('primary-btn').innerText = 'PLAY AGAIN';
  byId('restart-btn').style.display = 'none';
  playerReset();
  if (gameMode === BOT_MATCH_MODE && pendingBotMatchSetup) {
    currentBotMatch = createBotMatchState(pendingBotMatchSetup);
    pendingBotMatchSetup = null;
    spawnBotPiece(currentBotMatch, performance.now());
    updateBotRemoteState();
    setWatchLabel(`Bot: ${currentBotMatch.botName}`);
    if (currentBotMatch.gameOver) {
      finishBotMatch('win');
    }
  }
  updateModeUi();

  if (socket && currentRoom && playerRole === 'player' && (gameMode === 'multiplayer' || gameMode === 'tournament')) {
    socket.emit('playerReady');
    sendStateUpdate(false);
  }
}

function startSpectating() {
  gameState = 'SPECTATING';
  remoteState = null;
  spectatorBoards = {};
  byId('overlay').style.display = 'none';
  showOverlayPanel('main-menu-panel');
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

  if (gameMode === BOT_MATCH_MODE) {
    chooseBotMatch(
      currentBotMatch ? currentBotMatch.botDifficulty : 'easyBot',
      currentBotMatch && currentBotMatch.isRanked === false ? 'casual' : 'ranked'
    );
    return;
  }

  if (isTournamentMode()) {
    if (!currentTournament) {
      setStatus('no tournament loaded');
      return;
    }

    if (currentTournament.finishedAt || currentTournament.hasSubmitted) {
      setStatus(currentTournament.winnerUsername
        ? `winner: ${currentTournament.winnerUsername}`
        : 'score already submitted');
      return;
    }

    if (!currentTournament.isLocked) {
      if (!isRoomCreator) {
        setStatus('waiting for tournament creator to start');
        return;
      }
      requestRoomStart();
      return;
    }

    startGame();
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
  if (!currentRoom || playerRole !== 'player') {
    setStatus('join a room first');
    return;
  }
  if (!socket) {
    setStatus('offline');
    return;
  }
  socket.emit('startGame');
  setStatus(isTournamentMode() ? 'locking tournament...' : 'starting room...');
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
  showOverlayPanel('main-menu-panel');
  byId('primary-btn').onclick = handlePrimaryBtn;
  byId('primary-btn').innerText = isTournamentMode() ? 'RESULTS READY' : (gameMode === 'spectator' ? 'WATCH' : 'PLAY AGAIN');
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
  showOverlayPanel('main-menu-panel');
  byId('primary-btn').onclick = handlePrimaryBtn;
  byId('primary-btn').innerText = getPrimaryButtonLabel();
  byId('restart-btn').style.display = currentRoom ? 'block' : 'none';
  setStatus(text);
  updateModeUi();
}

function returnToMainMenu() {
  resetRoomState();
  setStatus('singleplayer ready');
  setRoomInfo('Singleplayer only');
  showMenuOverlay('singleplayer ready');
}

function handleLocalGameOver() {
  if (gameState === 'GAMEOVER') return;
  if (gameMode === BOT_MATCH_MODE) {
    if (currentBotMatch) {
      currentBotMatch.gameOver = true;
      updateBotRemoteState();
      reportBotMatchResult('loss');
    }
    showLoseOverlay('you lost');
    return;
  }

  if (isTournamentMode() && !gameOverSent && socket && currentRoom && playerRole === 'player') {
    if (currentTournament) {
      setCurrentTournament({
        ...currentTournament,
        hasSubmitted: true
      });
    }
    socket.emit('submitTournamentScore', {
      score: player.score
    });
    gameOverSent = true;
    showMenuOverlay('submitting tournament score...');
    return;
  }

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
  if (!socket || !currentRoom || playerRole !== 'player' || (gameMode !== 'multiplayer' && gameMode !== 'tournament')) return;

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
    if (isFortyLineMode()) {
      updateFortyLineUi(time);
    }

    if (gameMode === BOT_MATCH_MODE) {
      updateBotMatch(time);
    }

    runAutoplay();

    ['moveLeft', 'moveRight'].forEach(action => {
      if (keys[action].down) {
        if (keys[action].timer === 0) {
          movePlayer(action === 'moveRight' ? 1 : -1);
        }
        keys[action].timer += delta;
        if (keys[action].timer > DAS_DELAY) {
          if ((keys[action].timer - DAS_DELAY) % DAS_SPEED < delta) {
            movePlayer(action === 'moveRight' ? 1 : -1);
          }
        }
      } else {
        keys[action].timer = 0;
      }
    });

    if (keys.softDrop.down) {
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

    if ((gameMode === 'multiplayer' || gameMode === 'tournament') && playerRole === 'player') {
      sendStateUpdate(false);
    }
  }

  draw();
  requestAnimationFrame(update);
}

window.addEventListener('keydown', e => {
  if (pendingControlAction) {
    handleControlRebindKeydown(e);
    return;
  }
  const controlAction = getControlActionForCode(e.code);
  if (['moveLeft', 'moveRight', 'softDrop', 'rotateClockwise', 'hardDrop'].includes(controlAction)) e.preventDefault();
  if (e.key === 'Escape' && isLeaderboardProfileOpen()) {
    closeLeaderboardProfile();
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape' && cancelControlRebind()) {
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape' && closeActiveMenuPopout()) {
    e.preventDefault();
    return;
  }
  if (e.key.toLowerCase() === 'h' && canAutoplayCheat) {
    autoplayMode = autoplayMode === 'human' ? '' : 'human';
    resetAutoplayState();
    clearHeldKeys();
    return;
  }
  if (e.key.toLowerCase() === 'u' && canAutoplayCheat) {
    autoplayMode = autoplayMode === 'fast' ? '' : 'fast';
    resetAutoplayState();
    clearHeldKeys();
    return;
  }
  if (controlAction === 'pause') {
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
  startFortyLineTimerIfNeeded();
  if (autoplayMode) return;
  if (controlAction in keys) keys[controlAction].down = true;
  if (controlAction === 'rotateClockwise') playerRotate(1);
  if (controlAction === 'rotateCounterclockwise') playerRotate(-1);
  if (controlAction === 'hardDrop') {
    hardDrop();
  }
  if (controlAction === 'holdPiece' && player.canHold) {
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
  if (autoplayMode) return;
  const controlAction = getControlActionForCode(e.code);
  if (controlAction in keys) keys[controlAction].down = false;
});

byId('overlay').addEventListener('click', event => {
  if (event.target !== event.currentTarget) {
    return;
  }

  closeActiveMenuPopout();
});

window.addEventListener('resize', () => {
  applyUiScale();
  if (isLeaderboardProfileOpen()) {
    positionLeaderboardProfile(playerProfileState.anchorElement);
  }
});

initColorPickers();
populateCompanions();
loadControls();
loadUiScale();
renderControlsMenu();
setOnlinePlayMode(selectedOnlinePlayMode);
renderTournamentResults();
updateScoreUi();
updateFortyLineUi();
renderMainMenu();
setStatus('singleplayer ready');
setRoomInfo('Singleplayer only');
setWatchLabel('Waiting');
updateModeUi();
loadPlayerSummary();
update();
