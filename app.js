const express = require('express');
const fs = require('fs');
const http = require('http');
const session = require('express-session');
const jwt = require('jsonwebtoken'); // Needed to decode the token
const sharp = require('sharp');
const path = require("path");
const { Server } = require('socket.io');
const {
    DEFAULT_ELO_K_FACTOR,
    initDb,
    saveUser,
    saveScore,
    addScore,
    calculateEloChange,
    createMatch,
    getBotRatingProfile,
    getPlayerDirectory,
    getPlayerElo,
    getPlayerMenuSummary,
    getPlayerProfile,
    getTopScores,
    getLeaderboard,
    getLeaderboardCategoryEntries,
    getPlayerRank,
    getPlayerRatingProfile,
    getPlayerStats,
    getRecentBotMatchCount,
    getRecentMatchHistoryCount,
    isMatchAlreadyProcessed,
    recordMatchHistoryEntry,
    updateCompetitorElo,
    updatePlayerProfile,
    updatePlayerStats,
} = require('./db');
const tournamentManager = require('./tournamentManager');

// Load the environment variables from the .env file
// .env files are hidden and ignored by git so users and developers can't see them
// This is a good way to store sensitive information like API keys and passwords
// It also puts the config into one easy to edit place
// .env_template shows developers what variables are needed and what they do
const dotenv = require('dotenv');
dotenv.config();
const DEFAULT_SESSION_SECRET = 'DontForgetToSetThis';
const localDevAuthPath = path.join(__dirname, 'local', 'dev-auth.js');
const localDevAuth = fs.existsSync(localDevAuthPath) ? require(localDevAuthPath) : null;
const isLocalDevAuthEnabled = Boolean(localDevAuth && localDevAuth.enabled);

const port = process.env.PORT;
const sessionSecret = process.env.SECRET || (isLocalDevAuthEnabled ? 'local-dev-session-secret' : undefined);
const formbarAddress = process.env.FORMBAR_URL;
const formbarLogin = formbarAddress + '/oauth';
const thisUrl = process.env.THIS_URL;
const thisUrlLogin = thisUrl + '/login';
const payUserId = process.env.PAYUSER;
const payUserPin = process.env.PAYUSER_PIN || '';
const entryFee = process.env.ENTRYFEE;
const MIN_TOURNAMENT_ENTRY_FEE = 120;
const DEFAULT_TOURNAMENT_MAX_PLAYERS = 8;
const MAX_TOURNAMENT_PLAYERS = 50;
const DEFAULT_BOT_NAME = 'Bot';
const BOT_ELO_GAIN_MULTIPLIER = 0.4;
const BOT_ELO_MIN_MULTIPLIER = 0.12;
const BOT_MATCH_RATE_LIMIT_WINDOW_MS = 5000;
const BOT_MATCH_REPEAT_WINDOW_MS = 10 * 60 * 1000;
const BOT_MATCH_DIMINISHING_WINDOW_MS = 24 * 60 * 60 * 1000;
const BOT_MATCH_MINIMUM_DURATION_MS = 20000;
const BOT_MATCH_MAX_REPEAT_COUNT = 8;
const PROFILE_BIO_MAX_LENGTH = 200;
const PROFILE_AVATAR_SIZE = 128;
const isProduction = process.env.NODE_ENV === 'production';
const avatarFolder = path.join(__dirname, 'public', 'avatars');

fs.mkdirSync(avatarFolder, { recursive: true });

if (!sessionSecret) {
    throw new Error('Missing SECRET in environment variables');
}

if (!isLocalDevAuthEnabled && sessionSecret === DEFAULT_SESSION_SECRET) {
    throw new Error('SECRET is still set to the placeholder value; replace it with a real session secret');
}

const app = express(); // Create the express app
const server = http.createServer(app);

initDb();

if (isProduction) {
    app.set('trust proxy', 1);
}

// Middleware to create a session
// This is used to store the user's session data
const sessionMiddleware = session({
    name: 'formbar-tetris.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    unset: 'destroy',
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        maxAge: 1000 * 60 * 60 * 4,
    }
});

app.use(sessionMiddleware);

// Set the view engine to EJS
// EJS is a templating engine for Node.js
// It allows you to create HTML templates with JavaScript
// This is a good way to create dynamic pages
app.set('view engine', 'ejs');
// Set the views directory to the views folder
// This is where the EJS templates are stored
app.set('views', path.join(__dirname, 'views'));

// Needed to read POST data from the form
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '6mb' }));

function toPositiveInteger(value, fallback = 0) {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 0) {
        return fallback;
    }

    return parsed;
}

function clearSession(req) {
    req.session.token = null;
    req.session.user = null;
    req.session.userId = null;
    req.session.refreshToken = null;
    req.session.hasPaid = false;
}

function setLocalDevSession(req) {
    const user = localDevAuth.user || {};
    req.session.token = 'local-dev-token';
    req.session.user = user.displayName || 'Local Tester';
    req.session.userId = user.id || 1;
    req.session.refreshToken = null;
    req.session.hasPaid = false;
    saveUser(req.session.userId, req.session.user);
}

function isLocalDevSession(req) {
    return isLocalDevAuthEnabled && req.session.token === 'local-dev-token';
}

function redirectToLogin(res) {
    if (isLocalDevAuthEnabled) {
        return res.redirect('/login');
    }

    res.redirect(`${formbarAddress}/oauth?redirectURL=${thisUrlLogin}`);
}

function verifyToken(token) {
    const tokenData = jwt.decode(token);

    if (!tokenData || typeof tokenData !== 'object') {
        throw new Error('Invalid token payload');
    }

    if (tokenData.exp && Date.now() >= tokenData.exp * 1000) {
        const expiredError = new Error('jwt expired');
        expiredError.name = 'TokenExpiredError';
        throw expiredError;
    }

    if (!tokenData.displayName || tokenData.id == null) {
        throw new Error('Token missing required user fields');
    }

    return tokenData;
}

async function transferDigipogs(payload) {
    const response = await fetch(`${formbarAddress}/api/digipogs/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    const responseData = await response.json().catch(() => ({}));

    if (!response.ok || !responseData.success) {
        throw new Error(responseData.message || 'digipog transfer failed');
    }

    return responseData;
}

async function chargeDigipogs({ from, amount, reason, pin }) {
    if (amount <= 0) {
        return { success: true };
    }

    if (isLocalDevAuthEnabled || (localDevAuth && localDevAuth.skipPayment === true)) {
        return { success: true };
    }

    if (String(from) === String(payUserId)) {
        return { success: true };
    }

    return transferDigipogs({
        from,
        to: payUserId,
        amount,
        reason,
        pin
    });
}

async function payTournamentWinner({ to, amount, tournamentId }) {
    if (amount <= 0 || String(to) === String(payUserId)) {
        return 'paid';
    }

    if (!payUserPin) {
        return 'pending';
    }

    try {
        await transferDigipogs({
            from: payUserId,
            to,
            amount,
            reason: `Tournament payout #${tournamentId}`,
            pin: payUserPin
        });

        return 'paid';
    } catch (err) {
        console.log('tournament payout failed', err);
        return 'pending';
    }
}

function wrapExpressMiddleware(middleware) {
    return (socket, next) => middleware(socket.request, {}, next);
}

function getAvatarUrl(playerId, avatarVersion = 0) {
    const normalizedVersion = Number.isInteger(avatarVersion) ? avatarVersion : 0;
    return normalizedVersion > 0
        ? `/avatars/${encodeURIComponent(String(playerId))}.webp?v=${normalizedVersion}`
        : '';
}

function sanitizeProfileBio(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, PROFILE_BIO_MAX_LENGTH);
}

function decodeDataUrlImage(dataUrl) {
    const input = String(dataUrl || '');
    const match = input.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);

    if (!match) {
        return null;
    }

    return {
        mimeType: match[1].toLowerCase(),
        buffer: Buffer.from(match[2], 'base64')
    };
}

async function normalizeAvatarImage(dataUrl) {
    const parsedImage = decodeDataUrlImage(dataUrl);
    if (!parsedImage || !parsedImage.buffer.length) {
        throw new Error('invalid image data');
    }

    return sharp(parsedImage.buffer)
        .rotate()
        .resize(PROFILE_AVATAR_SIZE, PROFILE_AVATAR_SIZE, {
            fit: 'cover',
            position: 'centre'
        })
        .webp({
            quality: 82,
            effort: 4
        })
        .toBuffer();
}

async function savePlayerAvatar(playerId, dataUrl) {
    const outputBuffer = await normalizeAvatarImage(dataUrl);
    await fs.promises.writeFile(path.join(avatarFolder, `${playerId}.webp`), outputBuffer);
}

// Middleware to check if the user is authenticated
// If not, redirect to the login page
function isAuthenticated(req, res, next) {
    if (isLocalDevSession(req)) {
        return next();
    }

    // Does this session have a user already?
    if (req.session.user && req.session.token) { 
        try {
            const tokenData = verifyToken(req.session.token);
            req.session.user = tokenData.displayName;
            req.session.userId = tokenData.id;
            req.session.refreshToken = tokenData.refreshToken;
            // If not, continue to the next middleware  
            next();
        } catch (err) {
            const refreshToken = req.session.refreshToken;
            clearSession(req);

            if (err.name === 'TokenExpiredError' && refreshToken) {
                return res.redirect(`${formbarAddress}/oauth?refreshToken=${refreshToken}&redirectURL=${thisUrlLogin}`);
            }

            return redirectToLogin(res);
        }
    } else {
        // If no user, redirect to the login page
        redirectToLogin(res);
    }
}

// Login page
app.get('/login', (req, res) => {
    if (isLocalDevAuthEnabled) {
        setLocalDevSession(req);
        return res.redirect('/');
    }

    // Formbar will send a token in the query string if the user successfully logged in
    if (req.query.token) {
        try {
            const tokenData = verifyToken(req.query.token);
            req.session.token = req.query.token;
            req.session.user = tokenData.displayName;
            req.session.userId = tokenData.id;
            req.session.refreshToken = tokenData.refreshToken;
            saveUser(tokenData.id, tokenData.displayName);
            // Redirect to the home page
            return res.redirect('/');
        } catch (err) {
            clearSession(req);
            return res.status(401).send('invalid login token');
        }
    }

    // If no token, redirect to the Formbar login page
    res.redirect(`${formbarLogin}?redirectURL=${thisUrlLogin}`);
});

// Home page
app.get('/', isAuthenticated, (req, res) => {
    // Note that the isAuthenticated middleware will redirect to the login page if the user is not authenticated
    // Send the home page
    res.render('index', { entryFee: entryFee }); // Go look at the index.ejs template to see how the entry fee is displayed 
});

// metaphorical ticket booth man who kicks you out if you don't have a ticket
app.get('/tetris', isAuthenticated, (req, res) => {
    // If the user has paid, send the Tetris page
    if (req.session.hasPaid) {
        // Reset the hasPaid flag so the user can play again
        req.session.hasPaid = false;
        const playerProfile = getPlayerProfile(req.session.userId);
        res.render('tetris', {
            player: {
                userId: req.session.userId,
                username: req.session.user,
                canAutoplayCheat: String(req.session.userId) === String(payUserId),
                profile: playerProfile ? {
                    ...playerProfile,
                    avatarUrl: getAvatarUrl(playerProfile.playerId, playerProfile.avatarVersion)
                } : null,
            }
        });
    } else {
        // If the user hasn't paid, redirect to the home page
        res.redirect('/');
    }
});

// Submit page
// This is the page where the user enters their ID and PIN to pay for the game
app.post('/submitpage', isAuthenticated, (req, res) => {
    // Get the user's ID from the session
    // You don't need to get it from the form because the user is already authenticated
    const userId = req.session.userId;

    if (isLocalDevSession(req) || (localDevAuth && localDevAuth.skipPayment === true)) {
        req.session.hasPaid = true;
        return res.redirect('/tetris');
    }

    // Allow the arcade owner to self-checkout for debugging without requiring
    // the payment API to process a transfer back to the same account.
    if (String(userId) === String(payUserId)) {
        req.session.hasPaid = true;
        return res.redirect('/tetris');
    }

    // Create the payload for the API request
    // The payload is the data that will be sent to the API request
    const payload = {
        from: userId, // The user's ID
        to: payUserId, // The user's ID
        amount: entryFee, // The amount of digipogs to send
        reason: 'Play Tetris', // The reason for the transfer
        pin: req.body.pin // The user's PIN
    };

    // Send the API request to transfer the digipogs
    // Use HTTP because we don't need live connections and websokcets
    fetch(`${formbarAddress}/api/digipogs/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
    // Parse the response from the API request  
    .then((transferResult) => transferResult.json())
    .then((responseData) => {
        // If the payment was successful, set the hasPaid flag to true and redirect to the Tetris page
        if (responseData.success) {
            req.session.hasPaid = true;
            res.redirect('/tetris');
        } else {
            // If the payment failed, send an error message
            res.send("payment failed!! error: " + responseData.message);
        }
    })
    .catch(err => {
        // If there was an error, send an error message
        console.log("something broke in the fetch", err);
        res.status(500).send("internal error");
    });
});

// tiny helper routes for testing the db stuff while the project is still small
app.get('/scores/top', isAuthenticated, (req, res) => {
    res.json(getTopScores());
});

app.post('/scores/save', isAuthenticated, (req, res) => {
    const score = Number(req.body.score);

    if (!Number.isFinite(score)) {
        return res.status(400).json({ success: false, message: 'invalid score' });
    }

    saveScore(req.session.userId, score);
    res.json({ success: true });
});

app.post('/leaderboard/add', isAuthenticated, (req, res) => {
    const scoreOrTime = Number(req.body.scoreOrTime);
    const modeType = typeof req.body.modeType === 'string' ? req.body.modeType.trim() : '';
    const timestamp = typeof req.body.timestamp === 'string' && req.body.timestamp.trim()
        ? req.body.timestamp.trim()
        : new Date().toISOString();
    const playerName = req.session.user || req.body.playerName;

    if (!playerName || !modeType || !Number.isFinite(scoreOrTime)) {
        return res.status(400).json({ success: false, message: 'invalid leaderboard entry' });
    }

    addScore({
        playerName,
        playerId: req.session.userId,
        scoreOrTime: Math.floor(scoreOrTime),
        timestamp,
        modeType
    });

    res.json({
        success: true,
        entry: {
            playerName,
            scoreOrTime: Math.floor(scoreOrTime),
            timestamp,
            modeType
        }
    });
});

app.get('/leaderboard/:modeType', isAuthenticated, (req, res) => {
    const modeType = typeof req.params.modeType === 'string' ? req.params.modeType.trim() : '';
    const timeframe = typeof req.query.timeframe === 'string' ? req.query.timeframe.trim() : 'allTime';

    if (!modeType) {
        return res.status(400).json({ success: false, message: 'missing mode type' });
    }

    const leaderboardEntries = getLeaderboard(modeType, timeframe);
    res.json({ success: true, entries: leaderboardEntries });
});

app.get('/leaderboards/:categoryKey', isAuthenticated, (req, res) => {
    const categoryKey = typeof req.params.categoryKey === 'string' ? req.params.categoryKey.trim() : '';

    if (!categoryKey) {
        return res.status(400).json({ success: false, message: 'missing leaderboard category' });
    }

    const entries = getLeaderboardCategoryEntries(categoryKey);
    if (!entries.length && !['eloNoBots', 'eloWithBots', 'fortyLineTimes'].includes(categoryKey)) {
        return res.status(404).json({ success: false, message: 'unknown leaderboard category' });
    }

    res.json({
        success: true,
        categoryKey,
        entries
    });
});

app.get('/players/:playerId/rank', isAuthenticated, (req, res) => {
    const playerId = Number(req.params.playerId);

    if (!Number.isInteger(playerId)) {
        return res.status(400).json({ success: false, message: 'invalid player id' });
    }

    res.json({
        success: true,
        ...getPlayerRankSummary(playerId)
    });
});

app.get('/players/:playerId/profile', isAuthenticated, (req, res) => {
    const playerId = Number(req.params.playerId);

    if (!Number.isInteger(playerId)) {
        return res.status(400).json({ success: false, message: 'invalid player id' });
    }

    const playerProfile = getPlayerProfile(playerId);
    if (!playerProfile) {
        return res.status(404).json({ success: false, message: 'player not found' });
    }

    res.json({
        success: true,
        playerProfile: {
            ...playerProfile,
            avatarUrl: getAvatarUrl(playerProfile.playerId, playerProfile.avatarVersion)
        }
    });
});

app.get('/players', isAuthenticated, (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const players = getPlayerDirectory(search).map(player => ({
        ...player,
        avatarUrl: getAvatarUrl(player.playerId, player.avatarVersion)
    }));

    res.json({
        success: true,
        players
    });
});

app.get('/player-summary', isAuthenticated, (req, res) => {
    const playerSummary = getPlayerMenuSummary(req.session.userId);

    if (!playerSummary) {
        return res.status(404).json({ success: false, message: 'player not found' });
    }

    res.json({
        success: true,
        playerSummary: {
            ...playerSummary,
            avatarUrl: getAvatarUrl(playerSummary.playerId, playerSummary.avatarVersion)
        }
    });
});

app.post('/player-profile', isAuthenticated, async (req, res) => {
    const playerId = req.session.userId;
    const bio = sanitizeProfileBio(req.body.bio);
    const avatarDataUrl = typeof req.body.avatarDataUrl === 'string' ? req.body.avatarDataUrl.trim() : '';
    const currentProfile = getPlayerProfile(playerId);

    if (!currentProfile) {
        return res.status(404).json({ success: false, message: 'player not found' });
    }

    let avatarVersion = currentProfile.avatarVersion || 0;

    try {
        if (avatarDataUrl) {
            await savePlayerAvatar(playerId, avatarDataUrl);
            avatarVersion += 1;
        }
    } catch (error) {
        return res.status(400).json({ success: false, message: 'invalid profile image' });
    }

    updatePlayerProfile(playerId, {
        bio,
        avatarVersion
    });

    const nextProfile = getPlayerProfile(playerId);
    res.json({
        success: true,
        playerProfile: {
            ...nextProfile,
            avatarUrl: getAvatarUrl(nextProfile.playerId, nextProfile.avatarVersion)
        }
    });
});

app.post('/bot-match/start', isAuthenticated, (req, res) => {
    const botDifficulty = typeof req.body.botDifficulty === 'string' ? req.body.botDifficulty.trim() : '';
    const pendingBotMatch = createBotMatchSession(req.session.userId, botDifficulty);

    if (!pendingBotMatch) {
        return res.status(400).json({ success: false, message: 'invalid bot difficulty' });
    }

    res.json({
        success: true,
        botMatch: pendingBotMatch,
        playerSummary: getPlayerRankSummary(req.session.userId)
    });
});

app.post('/bot-match/result', isAuthenticated, (req, res) => {
    const botDifficulty = typeof req.body.botDifficulty === 'string' ? req.body.botDifficulty.trim() : '';
    const botDifficultyConfig = getBotDifficultyConfig(botDifficulty);
    const result = typeof req.body.result === 'string' ? req.body.result.trim() : '';
    const matchId = typeof req.body.matchId === 'string' ? req.body.matchId.trim() : '';

    if (!botDifficultyConfig || !matchId) {
        return res.status(400).json({ success: false, message: 'invalid bot match payload' });
    }

    const matchResult = handleMatchResult({
        matchId,
        playerA: getPlayerCompetitor(req.session.userId, req.session.user),
        playerB: getBotCompetitor(botDifficultyConfig.botId, botDifficultyConfig.botName),
        result,
        modeType: 'botRanked',
        botDifficulty,
        matchTimestamp: new Date().toISOString()
    });

    if (!matchResult.success) {
        return res.status(400).json(matchResult);
    }

    res.json({
        success: true,
        ignored: !!matchResult.ignored,
        eloResult: matchResult.eloResult,
        playerSummary: matchResult.playerSummary
    });
});

app.post('/matches/create', isAuthenticated, (req, res) => {
    const player1 = Number(req.body.player1);
    const player2 = Number(req.body.player2);
    const winner = req.body.winner ? Number(req.body.winner) : null;

    if (!Number.isInteger(player1) || !Number.isInteger(player2)) {
        return res.status(400).json({ success: false, message: 'invalid match players' });
    }

    if (winner !== player1 && winner !== player2) {
        const debugMatch = createMatch(player1, player2, winner);
        return res.json({ success: true, id: debugMatch.lastInsertRowid, ignored: true });
    }

    const debugMatchId = `debug-${player1}-${player2}-${Date.now()}`;
    const winningPlayerId = winner;
    const losingPlayerId = winner === player1 ? player2 : player1;
    const matchResult = handleMatchResult({
        matchId: debugMatchId,
        playerA: getPlayerCompetitor(winningPlayerId),
        playerB: getPlayerCompetitor(losingPlayerId),
        result: 'win',
        modeType: 'playerVsPlayerRanked',
        matchTimestamp: new Date().toISOString()
    });

    if (!matchResult.success) {
        return res.status(400).json(matchResult);
    }

    res.json({
        success: true,
        debugMatchId,
        eloResult: matchResult.eloResult,
        playerSummary: matchResult.playerSummary
    });
});

// Put all the static files in the public folder so they're organized
// Also prevents users from accessing files outside the public folder
// Put this at the bottom so it only runs for requests that don't match any other routes
app.use(express.static(path.join(__dirname, 'public')));

const io = new Server(server, {
    cors: {
        origin: thisUrl,
        credentials: true,
    }
});

const adjectives = ['pink', 'lazy', 'angry', 'blue', 'sleepy', 'tiny', 'happy', 'weird', 'fast', 'soft'];
const animals = ['fox', 'cat', 'panda', 'turtle', 'bear', 'rabbit', 'otter', 'lizard', 'wolf', 'duck'];
const rooms = {};
const pendingBotMatches = new Map();
const BOT_MATCH_OPTIONS = {
    easyBot: { botId: 'easyBot', botName: 'Easy Bot' },
    mediumBot: { botId: 'mediumBot', botName: 'Medium Bot' },
    hardBot: { botId: 'hardBot', botName: 'Hard Bot' }
};

function isTournamentRoom(room) {
    return !!(room && room.roomType === 'tournament' && room.tournamentId);
}

function normalizeRoomType(value) {
    return value === 'tournament' ? 'tournament' : 'standard';
}

function sameUserId(a, b) {
    return String(a) === String(b);
}

function getConnectedPlayerUserIds(room) {
    return room.players
        .map(socketId => io.sockets.sockets.get(socketId))
        .filter(Boolean)
        .map(socket => socket.data.userId);
}

function isUserAlreadyInRoom(room, userId) {
    return getConnectedPlayerUserIds(room).includes(userId);
}

function assignStandardRoomCreator(room) {
    if (!room || isTournamentRoom(room)) {
        return;
    }

    const currentCreatorSocket = room.creatorSocketId
        ? io.sockets.sockets.get(room.creatorSocketId)
        : null;

    if (currentCreatorSocket && room.players.includes(room.creatorSocketId)) {
        room.creatorUserId = currentCreatorSocket.data.userId;
        room.creatorUsername = currentCreatorSocket.data.username;
        return;
    }

    const nextCreatorSocketId = room.players.find(socketId => io.sockets.sockets.get(socketId)) || null;
    room.creatorSocketId = nextCreatorSocketId;

    if (!nextCreatorSocketId) {
        room.creatorUserId = null;
        room.creatorUsername = null;
        return;
    }

    const nextCreatorSocket = io.sockets.sockets.get(nextCreatorSocketId);
    room.creatorUserId = nextCreatorSocket.data.userId;
    room.creatorUsername = nextCreatorSocket.data.username;
}

io.use(wrapExpressMiddleware(sessionMiddleware));

function makeRoomName() {
    let tries = 0;

    while (tries < 1000) {
        const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
        const animal = animals[Math.floor(Math.random() * animals.length)];
        const roomName = `${adjective} ${animal}`;

        if (!rooms[roomName]) {
            return roomName;
        }

        tries++;
    }

    return `room ${Date.now()}`;
}

function getRoomInfo(roomName) {
    const room = rooms[roomName];
    if (!room) return null;

    const creatorSocket = room.creatorSocketId ? io.sockets.sockets.get(room.creatorSocketId) : null;
    const tournament = isTournamentRoom(room)
        ? tournamentManager.getTournamentState(room.tournamentId)
        : null;

    return {
        roomName,
        roomType: room.roomType || 'standard',
        isRanked: room.isRanked !== false,
        passwordProtected: !!room.password,
        locked: !!room.locked,
        ownerUserId: room.ownerUserId || null,
        ownerUsername: room.ownerUsername || null,
        creatorSocketId: room.creatorSocketId || null,
        creatorUserId: room.creatorUserId || (creatorSocket ? creatorSocket.data.userId : null),
        creatorUsername: creatorSocket ? creatorSocket.data.username : room.creatorUsername || null,
        players: room.players.map(socketId => {
            const playerSocket = io.sockets.sockets.get(socketId);
            return {
                socketId,
                userId: playerSocket ? playerSocket.data.userId : null,
                username: playerSocket ? playerSocket.data.username : 'player'
            };
        }),
        spectators: room.spectators.length,
        tournament
    };
}

function getRoomList() {
    return Object.keys(rooms)
        .sort()
        .map(roomName => {
            const room = rooms[roomName];
            const tournament = isTournamentRoom(room)
                ? tournamentManager.getTournamentState(room.tournamentId)
                : null;

            return {
                roomName,
                roomType: room.roomType || 'standard',
                isRanked: room.isRanked !== false,
                playerCount: tournament ? tournament.playerCount : room.players.length,
                spectatorCount: room.spectators.length,
                passwordProtected: !!room.password,
                locked: !!room.locked,
                ownerUserId: room.ownerUserId || null,
                entryFee: tournament ? tournament.entryFee : null,
                maxPlayers: tournament ? tournament.maxPlayers : null,
                prizePool: tournament ? tournament.prizePool : null,
                submittedPlayers: tournament ? tournament.submittedPlayers : null
            };
        });
}

function getOtherPlayerSocket(roomName, currentSocketId) {
    const room = rooms[roomName];
    if (!room) {
        return null;
    }

    for (const socketId of room.players) {
        if (socketId === currentSocketId) {
            continue;
        }

        const otherSocket = io.sockets.sockets.get(socketId);
        if (otherSocket) {
            return otherSocket;
        }
    }

    return null;
}

function getPlayerCompetitor(playerId, fallbackPlayerName = 'player') {
    const playerProfile = getPlayerRatingProfile(playerId);

    if (playerProfile) {
        return playerProfile;
    }

    return {
        playerId,
        playerName: fallbackPlayerName,
        eloRating: getPlayerElo(playerId),
        competitorType: 'player'
    };
}

function getBotCompetitor(botId, botName = DEFAULT_BOT_NAME) {
    return getBotRatingProfile(botId, botName);
}

function getPlayerRankSummary(playerId) {
    const playerSummary = getPlayerMenuSummary(playerId);

    if (!playerSummary) {
        return {
            playerId,
            eloRating: getPlayerElo(playerId),
            rank: getPlayerRank(playerId),
            totalWins: 0,
            totalLosses: 0,
            botWinsEasy: 0,
            botWinsMedium: 0,
            botWinsHard: 0,
            playerVsPlayerWins: 0
        };
    }

    return playerSummary;
}

function sendRankUpdate(targetSocket, eloRatingChange = 0) {
    if (!targetSocket || !targetSocket.data || targetSocket.data.userId == null) {
        return;
    }

    targetSocket.emit('rankUpdate', {
        ...getPlayerRankSummary(targetSocket.data.userId),
        eloRatingChange
    });
}

function createBotMatchId(playerId, botId) {
    return `bot-${playerId}-${botId}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function createRoomMatchId(roomName) {
    return `room-${roomName.replace(/\s+/g, '-')}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function getBotDifficultyConfig(botDifficulty) {
    return BOT_MATCH_OPTIONS[botDifficulty] || null;
}

function getBotWinStatField(botDifficulty) {
    if (botDifficulty === 'easyBot') return 'botWinsEasy';
    if (botDifficulty === 'mediumBot') return 'botWinsMedium';
    if (botDifficulty === 'hardBot') return 'botWinsHard';
    return null;
}

function createBotMatchSession(playerId, botDifficulty) {
    const botDifficultyConfig = getBotDifficultyConfig(botDifficulty);
    if (!botDifficultyConfig) {
        return null;
    }

    const matchId = createBotMatchId(playerId, botDifficultyConfig.botId);
    const pendingBotMatch = {
        matchId,
        playerId,
        botId: botDifficultyConfig.botId,
        botName: botDifficultyConfig.botName,
        botDifficulty,
        modeType: 'botRanked',
        createdAt: Date.now(),
        completed: false
    };

    pendingBotMatches.set(matchId, pendingBotMatch);
    return pendingBotMatch;
}

function getBotEloGainMultiplier(playerId, botId) {
    const recentBotMatchCount = getRecentBotMatchCount(playerId, botId, BOT_MATCH_DIMINISHING_WINDOW_MS);
    const diminishingMultiplier = Math.max(BOT_ELO_MIN_MULTIPLIER, 1 - (recentBotMatchCount * 0.08));
    return Math.max(BOT_ELO_MIN_MULTIPLIER, Math.round(BOT_ELO_GAIN_MULTIPLIER * diminishingMultiplier * 100) / 100);
}

function getAdjustedBotMatchEloResult(playerCompetitor, botCompetitor, result) {
    const standardEloResult = calculateEloChange(playerCompetitor, botCompetitor, {
        playerAScore: result,
        kFactor: DEFAULT_ELO_K_FACTOR
    });

    if (standardEloResult.playerAEloChange <= 0) {
        return {
            ...standardEloResult,
            botEloGainMultiplier: 1
        };
    }

    const botEloGainMultiplier = getBotEloGainMultiplier(playerCompetitor.playerId, botCompetitor.botId);
    const reducedPlayerEloChange = Math.max(1, Math.round(standardEloResult.playerAEloChange * botEloGainMultiplier));

    return {
        ...standardEloResult,
        playerAEloChange: reducedPlayerEloChange,
        playerBEloChange: -reducedPlayerEloChange,
        playerANewElo: playerCompetitor.eloRating + reducedPlayerEloChange,
        playerBNewElo: botCompetitor.eloRating - reducedPlayerEloChange,
        botEloGainMultiplier
    };
}

function updateStatsForMatch(playerId, matchResult) {
    const updatedPlayerStats = {
        ...getPlayerStats(playerId)
    };

    if (matchResult === 'win') {
        updatedPlayerStats.totalWins += 1;
    } else if (matchResult === 'loss') {
        updatedPlayerStats.totalLosses += 1;
    }

    return updatedPlayerStats;
}

function applyModeSpecificStats(updatedPlayerStats, matchData, matchResult) {
    if (matchData.modeType === 'playerVsPlayerRanked' && matchResult === 'win') {
        updatedPlayerStats.playerVsPlayerWins += 1;
    }

    if (matchData.modeType === 'botRanked' && matchResult === 'win') {
        const botWinStatField = getBotWinStatField(matchData.botDifficulty);
        if (botWinStatField) {
            updatedPlayerStats[botWinStatField] += 1;
        }
    }

    return updatedPlayerStats;
}

function updateLeaderboardForMatch(matchData) {
    if (!matchData || matchData.scoreOrTime == null || !matchData.leaderboardModeType) {
        return;
    }

    addScore({
        playerName: matchData.playerA.playerName,
        scoreOrTime: matchData.scoreOrTime,
        timestamp: matchData.matchTimestamp,
        modeType: matchData.leaderboardModeType
    });
}

function isRapidlyRepeatedBotMatch(playerId, botId) {
    const recentBotMatchCount = getRecentBotMatchCount(playerId, botId, BOT_MATCH_REPEAT_WINDOW_MS);
    return recentBotMatchCount >= BOT_MATCH_MAX_REPEAT_COUNT;
}

function validateMatchData(matchData) {
    if (!matchData || !matchData.matchId) {
        return { isValid: false, message: 'missing match id' };
    }

    if (!matchData.playerA || !Number.isInteger(Number(matchData.playerA.playerId))) {
        return { isValid: false, message: 'invalid playerA' };
    }

    if (matchData.playerB && matchData.playerB.playerId != null) {
        if (!Number.isInteger(Number(matchData.playerB.playerId))) {
            return { isValid: false, message: 'invalid playerB' };
        }

        if (String(matchData.playerA.playerId) === String(matchData.playerB.playerId)) {
            return { isValid: false, message: 'player cannot play against themselves' };
        }
    }

    if (matchData.result !== 'win' && matchData.result !== 'loss') {
        return { isValid: false, message: 'invalid result' };
    }

    if (!matchData.modeType) {
        return { isValid: false, message: 'missing mode type' };
    }

    return { isValid: true };
}

function validateBotMatchLegitimacy(matchData) {
    const pendingBotMatch = pendingBotMatches.get(matchData.matchId);

    if (!pendingBotMatch) {
        return { isValid: false, message: 'bot match session not found' };
    }

    if (pendingBotMatch.completed) {
        return { isValid: false, message: 'bot match already completed' };
    }

    if (String(pendingBotMatch.playerId) !== String(matchData.playerA.playerId)) {
        return { isValid: false, message: 'bot match belongs to a different player' };
    }

    if (pendingBotMatch.botId !== matchData.playerB.botId) {
        return { isValid: false, message: 'bot match bot mismatch' };
    }

    if (pendingBotMatch.botDifficulty !== matchData.botDifficulty) {
        return { isValid: false, message: 'bot difficulty mismatch' };
    }

    const elapsedTime = Date.now() - pendingBotMatch.createdAt;
    if (elapsedTime < BOT_MATCH_MINIMUM_DURATION_MS) {
        return { isValid: false, message: 'bot match ended too quickly' };
    }

    if (isRapidlyRepeatedBotMatch(matchData.playerA.playerId, pendingBotMatch.botId)) {
        return { isValid: false, message: 'too many rapid bot matches' };
    }

    return { isValid: true, pendingBotMatch };
}

function validateRateLimit(matchData) {
    const recentMatchCount = getRecentMatchHistoryCount(matchData.playerA.playerId, BOT_MATCH_RATE_LIMIT_WINDOW_MS);

    if (recentMatchCount > 0) {
        return { isValid: false, message: 'match submissions are happening too quickly' };
    }

    return { isValid: true };
}

function persistPlayerMatchHistory(matchData, playerEloChange, playerEloAfter) {
    recordMatchHistoryEntry({
        matchId: matchData.matchId,
        playerId: matchData.playerA.playerId,
        opponentType: matchData.playerB.competitorType,
        opponentId: matchData.playerB.competitorType === 'bot' ? matchData.playerB.botId : matchData.playerB.playerId,
        opponentName: matchData.playerB.competitorType === 'bot' ? matchData.playerB.botName : matchData.playerB.playerName,
        matchResult: matchData.result,
        modeType: matchData.modeType,
        playerEloChange,
        playerEloAfter,
        createdAt: matchData.matchTimestamp
    });
}

function handleMatchResult(matchData) {
    const matchTimestamp = matchData.matchTimestamp || new Date().toISOString();
    const normalizedMatchData = {
        ...matchData,
        matchTimestamp
    };

    const validation = validateMatchData(normalizedMatchData);
    if (!validation.isValid) {
        return { success: false, rejected: true, message: validation.message };
    }

    if (isMatchAlreadyProcessed(normalizedMatchData.matchId)) {
        return { success: true, ignored: true, message: 'duplicate match submission ignored' };
    }

    const rateLimitValidation = validateRateLimit(normalizedMatchData);
    if (!rateLimitValidation.isValid) {
        return { success: false, rejected: true, message: rateLimitValidation.message };
    }

    if (normalizedMatchData.playerB.competitorType === 'bot') {
        const botValidation = validateBotMatchLegitimacy(normalizedMatchData);
        if (!botValidation.isValid) {
            return { success: false, rejected: true, message: botValidation.message };
        }
    }

    let eloResult;
    if (normalizedMatchData.playerB.competitorType === 'bot') {
        eloResult = getAdjustedBotMatchEloResult(
            normalizedMatchData.playerA,
            normalizedMatchData.playerB,
            normalizedMatchData.result === 'win' ? 1 : 0
        );
    } else {
        eloResult = calculateEloChange(normalizedMatchData.playerA, normalizedMatchData.playerB, {
            playerAScore: normalizedMatchData.result === 'win' ? 1 : 0,
            kFactor: DEFAULT_ELO_K_FACTOR
        });
    }

    updateCompetitorElo(normalizedMatchData.playerA, eloResult.playerANewElo);
    updateCompetitorElo(normalizedMatchData.playerB, eloResult.playerBNewElo);

    const updatedPlayerAStats = applyModeSpecificStats(
        updateStatsForMatch(normalizedMatchData.playerA.playerId, normalizedMatchData.result),
        normalizedMatchData,
        normalizedMatchData.result
    );
    updatePlayerStats(normalizedMatchData.playerA.playerId, updatedPlayerAStats);

    if (normalizedMatchData.playerB.competitorType === 'player') {
        const playerBLossOrWin = normalizedMatchData.result === 'win' ? 'loss' : 'win';
        const updatedPlayerBStats = applyModeSpecificStats(
            updateStatsForMatch(normalizedMatchData.playerB.playerId, playerBLossOrWin),
            { ...normalizedMatchData, modeType: 'playerVsPlayerRanked' },
            playerBLossOrWin
        );
        updatePlayerStats(normalizedMatchData.playerB.playerId, updatedPlayerBStats);
        createMatch(
            normalizedMatchData.playerA.playerId,
            normalizedMatchData.playerB.playerId,
            normalizedMatchData.result === 'win' ? normalizedMatchData.playerA.playerId : normalizedMatchData.playerB.playerId
        );
    }

    persistPlayerMatchHistory(normalizedMatchData, eloResult.playerAEloChange, eloResult.playerANewElo);

    if (normalizedMatchData.playerB.competitorType === 'player') {
        persistPlayerMatchHistory({
            ...normalizedMatchData,
            playerA: normalizedMatchData.playerB,
            playerB: normalizedMatchData.playerA,
            result: normalizedMatchData.result === 'win' ? 'loss' : 'win'
        }, eloResult.playerBEloChange, eloResult.playerBNewElo);
    } else {
        const pendingBotMatch = pendingBotMatches.get(normalizedMatchData.matchId);
        if (pendingBotMatch) {
            pendingBotMatch.completed = true;
        }
    }

    updateLeaderboardForMatch(normalizedMatchData);

    return {
        success: true,
        eloResult,
        playerSummary: getPlayerRankSummary(normalizedMatchData.playerA.playerId)
    };
}

function finalizeStandardRoomMatch(roomName, winnerSocket, loserSocket, resultDetails = {}) {
    const room = rooms[roomName];
    if (!room || room.matchResultRecorded || !winnerSocket || !loserSocket) {
        return null;
    }

    if (room.isRanked === false) {
        room.matchResultRecorded = true;
        winnerSocket.data.isPlaying = false;
        loserSocket.data.isPlaying = false;
        return {
            winnerPlayerId: winnerSocket.data.userId,
            loserPlayerId: loserSocket.data.userId,
            winnerNewElo: null,
            loserNewElo: null
        };
    }

    const winnerCompetitor = getPlayerCompetitor(winnerSocket.data.userId, winnerSocket.data.username);
    const loserCompetitor = getPlayerCompetitor(loserSocket.data.userId, loserSocket.data.username);
    const matchResult = handleMatchResult({
        matchId: room.activeMatchId,
        playerA: winnerCompetitor,
        playerB: loserCompetitor,
        result: 'win',
        modeType: 'playerVsPlayerRanked',
        matchTimestamp: new Date().toISOString(),
        kFactor: resultDetails.kFactor
    });

    if (!matchResult.success) {
        return matchResult;
    }

    sendRankUpdate(winnerSocket, matchResult.eloResult.playerAEloChange);
    sendRankUpdate(loserSocket, matchResult.eloResult.playerBEloChange);

    return {
        winnerPlayerId: winnerCompetitor.playerId,
        loserPlayerId: loserCompetitor.playerId,
        winnerNewElo: matchResult.eloResult.playerANewElo,
        loserNewElo: matchResult.eloResult.playerBNewElo
    };
}

function sendRoomList(targetSocket) {
    if (targetSocket) {
        targetSocket.emit('roomsList', getRoomList());
        return;
    }

    io.emit('roomsList', getRoomList());
}

function closeRoom(roomName, message) {
    const room = rooms[roomName];
    if (!room) return;

    [...room.players, ...room.spectators].forEach(socketId => {
        const memberSocket = io.sockets.sockets.get(socketId);
        if (!memberSocket) return;

        memberSocket.leave(roomName);
        memberSocket.data.roomName = null;
        memberSocket.data.roomRole = null;
        memberSocket.data.isPlaying = false;
        memberSocket.emit('roomClosed', {
            roomName,
            message
        });
    });

    delete rooms[roomName];
    sendRoomList();
}

function removeSocketFromRoom(socket) {
    const roomName = socket.data.roomName;
    if (!roomName || !rooms[roomName]) return;

    const room = rooms[roomName];
    const wasPlayer = room.players.includes(socket.id);
    const hadOpponent = room.players.some(id => id !== socket.id);
    const wasTournamentPlayer = isTournamentRoom(room) && wasPlayer && socket.data.isPlaying;
    const winnerSocket = !isTournamentRoom(room) && wasPlayer && socket.data.isPlaying
        ? getOtherPlayerSocket(roomName, socket.id)
        : null;

    if (!isTournamentRoom(room) && wasPlayer && socket.data.isPlaying && hadOpponent) {
        finalizeStandardRoomMatch(roomName, winnerSocket, socket);
        sendToOtherPlayers(roomName, socket.id, 'opponentWin', { roomName });
    }

    if (wasPlayer && !isTournamentRoom(room)) {
        sendToSpectators(roomName, 'roomMessage', {
            roomName,
            message: `${socket.data.username} left`
        });
    }

    room.players = room.players.filter(id => id !== socket.id);
    room.spectators = room.spectators.filter(id => id !== socket.id);

    if (room.creatorSocketId === socket.id) {
        room.creatorSocketId = null;
    }

    socket.leave(roomName);

    if (!isTournamentRoom(room) && room.players.length === 0 && room.spectators.length === 0) {
        delete rooms[roomName];
    } else {
        if (isTournamentRoom(room)) {
            const replacementSocketId = room.players.find(socketId => {
                const playerSocket = io.sockets.sockets.get(socketId);
                return playerSocket && playerSocket.data.userId === room.creatorUserId;
            });
            if (replacementSocketId) {
                room.creatorSocketId = replacementSocketId;
            }
        } else {
            assignStandardRoomCreator(room);
        }
        io.to(roomName).emit('roomState', getRoomInfo(roomName));
    }

    sendRoomList();

    if (wasTournamentPlayer) {
        maybeFinishTournamentBySurvivor(roomName).catch(err => {
            console.log('tournament finish after disconnect failed', err);
        });
    }

    socket.data.roomName = null;
    socket.data.roomRole = null;
    socket.data.isPlaying = false;
}

function sendToOtherPlayers(roomName, fromSocketId, eventName, payload) {
    const room = rooms[roomName];
    if (!room) return;

    room.players.forEach(socketId => {
        if (socketId === fromSocketId) return;
        const otherSocket = io.sockets.sockets.get(socketId);
        if (otherSocket) {
            otherSocket.emit(eventName, payload);
        }
    });
}

function getActiveOpponentSockets(roomName, fromSocketId) {
    const room = rooms[roomName];
    if (!room) return [];

    return room.players
        .filter(socketId => socketId !== fromSocketId)
        .map(socketId => io.sockets.sockets.get(socketId))
        .filter(otherSocket => otherSocket && otherSocket.data.isPlaying);
}

function getTournamentGarbageLines(baseGarbage, playerCount) {
    if (baseGarbage <= 0) return 0;

    const scale = Math.min(1, 4 / Math.max(2, playerCount));
    const scaled = Math.round(baseGarbage * scale);

    // Large tournament lobbies still get pressure, but only on strong clears.
    if (scaled === 0 && baseGarbage >= 2) {
        return 1;
    }

    return scaled;
}

function getTournamentScore(room, userId, fallback = 0) {
    if (!room || !room.tournamentScores) {
        return fallback;
    }

    const direct = room.tournamentScores[userId];
    const stringKey = room.tournamentScores[String(userId)];
    const score = direct != null ? direct : stringKey;

    return Math.max(0, toPositiveInteger(score, fallback));
}

async function finalizeTournamentWithWinner(roomName, winnerSocket) {
    const room = rooms[roomName];
    if (!room || !isTournamentRoom(room) || !winnerSocket) return null;

    const tournament = tournamentManager.getTournamentState(room.tournamentId);
    if (!tournament || tournament.finishedAt) {
        return tournament;
    }

    const winnerScore = getTournamentScore(room, winnerSocket.data.userId, 0);
    room.tournamentScores[winnerSocket.data.userId] = winnerScore;

    try {
        tournamentManager.submitScore({
            tournamentId: room.tournamentId,
            userId: winnerSocket.data.userId,
            score: winnerScore
        });
    } catch (err) {
        if (!String(err.message || '').includes('score already submitted')) {
            throw err;
        }
    }

    const winnerResult = tournamentManager.buildWinnerResult({
        tournamentId: room.tournamentId,
        winnerUserId: winnerSocket.data.userId,
        winnerUsername: winnerSocket.data.username,
        winnerScore
    });

    const payoutStatus = await payTournamentWinner({
        to: winnerResult.winner.userId,
        amount: winnerResult.winnerPayout,
        tournamentId: room.tournamentId
    });

    const nextTournament = tournamentManager.distributeRewards({
        tournamentId: room.tournamentId,
        winnerUserId: winnerResult.winner.userId,
        winnerUsername: winnerResult.winner.username,
        winnerScore: winnerResult.winner.score,
        winnerPayout: winnerResult.winnerPayout,
        platformCut: winnerResult.platformCut,
        payoutStatus
    });

    room.locked = true;
    room.tournamentFinalizing = false;
    winnerSocket.data.isPlaying = false;

    io.to(roomName).emit('tournamentFinished', {
        roomName,
        tournament: nextTournament,
        winnerUserId: winnerResult.winner.userId,
        winnerUsername: winnerResult.winner.username,
        winnerPayout: winnerResult.winnerPayout,
        payoutStatus
    });

    winnerSocket.emit('tournamentWinner', {
        roomName,
        tournament: nextTournament,
        winnerPayout: winnerResult.winnerPayout,
        payoutStatus
    });

    sendRoomState(roomName);
    sendRoomList();

    return nextTournament;
}

async function maybeFinishTournamentBySurvivor(roomName) {
    const room = rooms[roomName];
    if (!room || !isTournamentRoom(room) || room.tournamentFinalizing) return null;

    const tournament = tournamentManager.getTournamentState(room.tournamentId);
    if (!tournament || tournament.finishedAt) return tournament;

    const activePlayers = room.players
        .map(socketId => io.sockets.sockets.get(socketId))
        .filter(playerSocket => playerSocket && playerSocket.data.isPlaying);

    if (activePlayers.length !== 1) {
        return tournament;
    }

    room.tournamentFinalizing = true;

    try {
        return await finalizeTournamentWithWinner(roomName, activePlayers[0]);
    } finally {
        room.tournamentFinalizing = false;
    }
}

function sendToSpectators(roomName, eventName, payload) {
    const room = rooms[roomName];
    if (!room) return;

    room.spectators.forEach(socketId => {
        const watcherSocket = io.sockets.sockets.get(socketId);
        if (watcherSocket) {
            watcherSocket.emit(eventName, payload);
        }
    });
}

function sendRoomState(roomName) {
    const info = getRoomInfo(roomName);
    if (info) {
        io.to(roomName).emit('roomState', info);
    }
}

io.on('connection', socket => {
    const session = socket.request.session;

    if (!session || !session.userId || !session.user) {
        socket.emit('queueError', { message: 'not logged in' });
        socket.disconnect();
        return;
    }

    socket.data.userId = session.userId;
    socket.data.username = session.user;

    socket.emit('socketReady', {
        userId: socket.data.userId,
        username: socket.data.username,
        ...getPlayerRankSummary(socket.data.userId)
    });

    sendRoomList(socket);

    socket.on('requestRoomList', () => {
        sendRoomList(socket);
    });

    socket.on('createRoom', data => {
        if (socket.data.roomName) {
            socket.emit('roomError', { message: 'leave your room first' });
            return;
        }

        const roomType = normalizeRoomType(data && data.roomType);
        const isRanked = roomType === 'tournament' ? true : data && data.isRanked !== false;
        const roomName = makeRoomName();
        const password = data && typeof data.password === 'string' && data.password.trim()
            ? data.password.trim()
            : null;
        const baseRoom = {
            roomType,
            isRanked,
            password,
            locked: false,
            activeMatchId: null,
            matchResultRecorded: false,
            ownerUserId: socket.data.userId,
            ownerUsername: socket.data.username,
            creatorSocketId: socket.id,
            creatorUserId: socket.data.userId,
            creatorUsername: socket.data.username,
            players: [socket.id],
            spectators: [],
            tournamentId: null,
            tournamentScores: Object.create(null),
            tournamentFinalizing: false
        };

        const finishRoomCreate = tournament => {
            if (tournament) {
                baseRoom.tournamentId = tournament.id;
                baseRoom.locked = tournament.isLocked;
            }

            rooms[roomName] = baseRoom;

            socket.join(roomName);
            socket.data.roomName = roomName;
            socket.data.roomRole = 'player';
            socket.data.isPlaying = false;

            socket.emit('roomCreated', {
                roomName,
                roomType,
                isRanked,
                passwordProtected: !!password,
                creatorSocketId: socket.id,
                isCreator: true,
                tournament
            });

            sendRoomState(roomName);
            sendRoomList();
        };

        if (roomType !== 'tournament') {
            finishRoomCreate(null);
            return;
        }

        const tournamentEntryFee = toPositiveInteger(data && data.entryFee);
        const bonusContribution = toPositiveInteger(data && data.bonusContribution);
        const minPlayers = Math.max(2, toPositiveInteger(data && data.minPlayers, 2));
        const requestedMaxPlayers = toPositiveInteger(data && data.maxPlayers, DEFAULT_TOURNAMENT_MAX_PLAYERS);
        const maxPlayers = Math.min(MAX_TOURNAMENT_PLAYERS, Math.max(2, requestedMaxPlayers));
        const pin = data && typeof data.pin === 'string' ? data.pin : '';

        if (tournamentEntryFee < MIN_TOURNAMENT_ENTRY_FEE) {
            socket.emit('roomError', {
                message: `tournament entry fee must be at least ${MIN_TOURNAMENT_ENTRY_FEE}`
            });
            return;
        }

        const totalCharge = tournamentEntryFee + bonusContribution;

        (async () => {
            try {
                if (!isLocalDevAuthEnabled) {
                    await chargeDigipogs({
                        from: socket.data.userId,
                        amount: totalCharge,
                        reason: `Create tournament room ${roomName}`,
                        pin
                    });
                }

                const tournament = tournamentManager.createTournament({
                    roomName,
                    creatorUserId: socket.data.userId,
                    creatorUsername: socket.data.username,
                    entryFee: tournamentEntryFee,
                    minPlayers,
                    maxPlayers,
                    bonusContribution
                });

                finishRoomCreate(tournament);
            } catch (err) {
                socket.emit('roomError', { message: err.message || 'could not create tournament' });
            }
        })();
    });

    socket.on('joinRoom', data => {
        if (socket.data.roomName) {
            socket.emit('roomError', { message: 'leave your room first' });
            return;
        }

        const roomName = data && typeof data.roomName === 'string' ? data.roomName.trim() : '';
        const password = data && typeof data.password === 'string' ? data.password : '';
        const room = rooms[roomName];

        if (!room) {
            socket.emit('roomError', { message: 'room not found' });
            return;
        }

        if (room.password && room.password !== password) {
            socket.emit('roomError', { message: 'wrong password' });
            return;
        }

        if (isTournamentRoom(room)) {
            if (isUserAlreadyInRoom(room, socket.data.userId)) {
                socket.emit('roomError', { message: 'you are already in this room' });
                return;
            }

            const tournament = tournamentManager.getTournamentState(room.tournamentId);
            const existingEntry = tournamentManager.getTournamentEntry(room.tournamentId, socket.data.userId);
            const pin = data && typeof data.pin === 'string' ? data.pin : '';

            if (room.locked && !existingEntry) {
                socket.emit('roomError', { message: 'tournament already locked' });
                return;
            }

            (async () => {
                try {
                    if (!existingEntry) {
                        if (!isLocalDevAuthEnabled) {
                            await chargeDigipogs({
                                from: socket.data.userId,
                                amount: tournament.entryFee,
                                reason: `Join tournament room ${roomName}`,
                                pin
                            });
                        }

                        tournamentManager.joinTournament({
                            tournamentId: room.tournamentId,
                            userId: socket.data.userId,
                            username: socket.data.username,
                            paidAmount: tournament.entryFee
                        });
                    }

                    room.players.push(socket.id);
                    if (sameUserId(socket.data.userId, room.creatorUserId)) {
                        room.creatorSocketId = socket.id;
                    }

                    socket.join(roomName);
                    socket.data.roomName = roomName;
                    socket.data.roomRole = 'player';
                    socket.data.isPlaying = false;

                    socket.emit('roomJoined', {
                        roomName,
                        roomType: 'tournament',
                        isRanked: true,
                        role: 'player',
                        creatorSocketId: room.creatorSocketId || null,
                        isCreator: sameUserId(room.creatorUserId, socket.data.userId),
                        tournament: tournamentManager.getTournamentState(room.tournamentId)
                    });

                    sendRoomState(roomName);
                    sendRoomList();
                } catch (err) {
                    socket.emit('roomError', { message: err.message || 'could not join tournament' });
                }
            })();
            return;
        }

        const role = room.players.length < 2 ? 'player' : 'spectator';
        if (role === 'player') {
            room.players.push(socket.id);
            assignStandardRoomCreator(room);
        } else {
            room.spectators.push(socket.id);
        }

        socket.join(roomName);
        socket.data.roomName = roomName;
        socket.data.roomRole = role;
        socket.data.isPlaying = false;

        socket.emit('roomJoined', {
            roomName,
            roomType: room.roomType || 'standard',
            isRanked: room.isRanked !== false,
            role,
            creatorSocketId: room.creatorSocketId || null,
            isCreator: sameUserId(room.creatorUserId, socket.data.userId)
        });

        sendRoomState(roomName);
        sendRoomList();
    });

    socket.on('spectateRoom', data => {
        if (socket.data.roomName) {
            socket.emit('roomError', { message: 'leave your room first' });
            return;
        }

        const roomName = data && typeof data.roomName === 'string' ? data.roomName.trim() : '';
        const password = data && typeof data.password === 'string' ? data.password : '';
        const room = rooms[roomName];

        if (!room) {
            socket.emit('roomError', { message: 'room not found' });
            return;
        }

        if (room.password && room.password !== password) {
            socket.emit('roomError', { message: 'wrong password' });
            return;
        }

        if (isTournamentRoom(room)) {
            socket.emit('roomError', { message: 'live feed disabled for tournaments' });
            return;
        }

        room.spectators.push(socket.id);
        socket.join(roomName);
        socket.data.roomName = roomName;
        socket.data.roomRole = 'spectator';
        socket.data.isPlaying = false;

        socket.emit('roomJoined', {
            roomName,
            roomType: room.roomType || 'standard',
            isRanked: room.isRanked !== false,
            role: 'spectator',
            creatorSocketId: room.creatorSocketId || null,
            isCreator: false
        });

        sendRoomState(roomName);
        sendRoomList();
    });

    socket.on('leaveRoom', () => {
        removeSocketFromRoom(socket);
    });

    socket.on('deleteRoom', data => {
        const roomName = data && typeof data.roomName === 'string' ? data.roomName.trim() : '';
        const room = rooms[roomName];

        if (!room) {
            socket.emit('roomError', { message: 'room not found' });
            return;
        }

        if (!sameUserId(room.ownerUserId, socket.data.userId)) {
            socket.emit('roomError', { message: 'only the room owner can delete this room' });
            return;
        }

        try {
            if (isTournamentRoom(room)) {
                tournamentManager.deleteTournament({
                    tournamentId: room.tournamentId,
                    creatorUserId: socket.data.userId
                });
            }

            closeRoom(roomName, `${roomName} was deleted by ${socket.data.username}`);
        } catch (err) {
            socket.emit('roomError', { message: err.message || 'could not delete room' });
        }
    });

    socket.on('updateTournamentSettings', data => {
        const roomName = socket.data.roomName;
        if (!roomName || socket.data.roomRole !== 'player' || !rooms[roomName]) return;

        const room = rooms[roomName];
        if (!isTournamentRoom(room)) {
            socket.emit('roomError', { message: 'not a tournament room' });
            return;
        }

        if (!sameUserId(room.creatorUserId, socket.data.userId)) {
            socket.emit('roomError', { message: 'only the room creator can change tournament settings' });
            return;
        }

        try {
            const tournament = tournamentManager.updateTournamentMaxPlayers(
                room.tournamentId,
                toPositiveInteger(data && data.maxPlayers)
            );

            sendRoomState(roomName);
            sendRoomList();
            socket.emit('tournamentUpdated', { tournament });
        } catch (err) {
            socket.emit('roomError', { message: err.message || 'could not update tournament settings' });
        }
    });

    socket.on('startGame', () => {
        const roomName = socket.data.roomName;
        if (!roomName || socket.data.roomRole !== 'player' || !rooms[roomName]) return;

        const room = rooms[roomName];
        if (!sameUserId(room.creatorUserId, socket.data.userId)) {
            socket.emit('roomError', { message: 'only the room creator can start' });
            return;
        }

        if (isTournamentRoom(room)) {
            try {
                const tournament = tournamentManager.lockTournament(room.tournamentId);
                room.locked = true;
                io.to(roomName).emit('gameStart', {
                    roomName,
                    roomType: 'tournament',
                    seed: tournament.seed,
                    startedBy: socket.data.username
                });
                sendRoomState(roomName);
                sendRoomList();
            } catch (err) {
                socket.emit('roomError', { message: err.message || 'could not start tournament' });
            }
            return;
        }

        if (room.players.length < 2) {
            socket.emit('roomError', { message: 'need 2 players to start' });
            return;
        }

        room.players.forEach(socketId => {
            const playerSocket = io.sockets.sockets.get(socketId);
            if (playerSocket) {
                playerSocket.data.isPlaying = false;
            }
        });
        room.activeMatchId = createRoomMatchId(roomName);
        room.matchResultRecorded = false;

        io.to(roomName).emit('gameStart', {
            roomName,
            startedBy: socket.data.username
        });
    });

    socket.on('playerReady', () => {
        const roomName = socket.data.roomName;
        if (!roomName || socket.data.roomRole !== 'player' || !rooms[roomName]) return;

        socket.data.isPlaying = true;

        const room = rooms[roomName];
        if (room && isTournamentRoom(room)) {
            room.tournamentScores[socket.data.userId] = getTournamentScore(room, socket.data.userId, 0);
            return;
        }

        io.to(roomName).emit('playerStarted', {
            roomName,
            userId: socket.data.userId,
            username: socket.data.username
        });
    });

    socket.on('stateUpdate', data => {
        const roomName = socket.data.roomName;
        if (!roomName || socket.data.roomRole !== 'player' || !rooms[roomName]) return;

        const room = rooms[roomName];

        if (isTournamentRoom(room)) {
            room.tournamentScores[socket.data.userId] = Math.max(0, toPositiveInteger(data && data.score));
            return;
        }

        const payload = {
            roomName,
            userId: socket.data.userId,
            username: socket.data.username,
            board: Array.isArray(data && data.board) ? data.board : [],
            score: Number(data && data.score) || 0,
            level: Number(data && data.level) || 1,
            lines: Number(data && data.lines) || 0,
            gameOver: !!(data && data.gameOver)
        };

        sendToSpectators(roomName, 'spectatorState', payload);
        sendToOtherPlayers(roomName, socket.id, 'opponentState', payload);
    });

    socket.on('clearLines', data => {
        const roomName = socket.data.roomName;
        if (!roomName || socket.data.roomRole !== 'player' || !rooms[roomName]) return;

        const room = rooms[roomName];

        const lines = Number(data && data.lines);
        let garbage = Math.max(0, lines - 1);
        if (garbage <= 0) return;

        if (isTournamentRoom(room)) {
            const tournament = tournamentManager.getTournamentState(room.tournamentId);
            const activeOpponents = getActiveOpponentSockets(roomName, socket.id);
            if (!tournament || activeOpponents.length === 0) return;

            garbage = getTournamentGarbageLines(garbage, tournament.playerCount);
            if (garbage <= 0) return;

            activeOpponents.forEach(otherSocket => {
                otherSocket.emit('garbage', {
                    lines: garbage
                });
            });
            return;
        }

        sendToOtherPlayers(roomName, socket.id, 'garbage', { lines: garbage });
        sendToSpectators(roomName, 'roomMessage', {
            roomName,
            message: `${socket.data.username} sent ${garbage} garbage`
        });
    });

    socket.on('gameOver', () => {
        const roomName = socket.data.roomName;
        if (!roomName || socket.data.roomRole !== 'player' || !rooms[roomName]) return;

        const room = rooms[roomName];

        if (isTournamentRoom(room)) {
            socket.data.isPlaying = false;
            maybeFinishTournamentBySurvivor(roomName).catch(err => {
                console.log('tournament finish after gameOver failed', err);
            });
            return;
        }

        socket.data.isPlaying = false;
        const winnerSocket = getOtherPlayerSocket(roomName, socket.id);
        finalizeStandardRoomMatch(roomName, winnerSocket, socket);

        sendToOtherPlayers(roomName, socket.id, 'opponentWin', { roomName });
        sendToSpectators(roomName, 'roomMessage', {
            roomName,
            message: `${socket.data.username} lost`
        });
        sendToSpectators(roomName, 'spectatorState', {
            roomName,
            userId: socket.data.userId,
            username: socket.data.username,
            board: [],
            score: 0,
            level: 1,
            lines: 0,
            gameOver: true
        });
    });

    socket.on('submitTournamentScore', async data => {
        const roomName = socket.data.roomName;
        if (!roomName || socket.data.roomRole !== 'player' || !rooms[roomName]) return;

        const room = rooms[roomName];
        if (!isTournamentRoom(room)) return;

        const score = Math.max(0, toPositiveInteger(data && data.score));
        socket.data.isPlaying = false;
        room.tournamentScores[socket.data.userId] = score;

        try {
            const submission = tournamentManager.submitScore({
                tournamentId: room.tournamentId,
                userId: socket.data.userId,
                score
            });

            let tournament = submission.tournament;

            const survivorWinnerTournament = await maybeFinishTournamentBySurvivor(roomName);
            if (survivorWinnerTournament) {
                tournament = survivorWinnerTournament;
            }

            if (!tournament.finishedAt && submission.isComplete) {
                const winnerResult = tournamentManager.determineWinner(room.tournamentId);
                const payoutStatus = await payTournamentWinner({
                    to: winnerResult.winner.userId,
                    amount: winnerResult.winnerPayout,
                    tournamentId: room.tournamentId
                });

                tournament = tournamentManager.distributeRewards({
                    tournamentId: room.tournamentId,
                    winnerUserId: winnerResult.winner.userId,
                    winnerUsername: winnerResult.winner.username,
                    winnerScore: winnerResult.winner.score,
                    winnerPayout: winnerResult.winnerPayout,
                    platformCut: winnerResult.platformCut,
                    payoutStatus
                });
            }

            room.locked = true;
            socket.emit('tournamentScoreAccepted', {
                roomName,
                score,
                tournament
            });
            sendRoomState(roomName);
            sendRoomList();
        } catch (err) {
            socket.emit('roomError', { message: err.message || 'could not submit tournament score' });
        }
    });

    socket.on('disconnect', () => {
        removeSocketFromRoom(socket);
    });
});

// Start the server
server.listen(port, () => {
    console.log(`Server is running on ${thisUrl}`);
});


/*****************************************************************************************\
Things to do:
- Add a /profile endpoint. If you are in the list of managers in the .env, you can see it.
  Otherwise, you are redirected to the home page. Managers can change the entry fee with
  a form if you change the netry fee to a regular variable.
- Add a /logout endpoint. This will log the user out and redirect them to the login page.
- Add an sqlite3 database to store the user's data.
- Sell tickets instead of individual payments. Save in database.
- Handle games on the server. Use socket.io to send the game state to the client.
- If the game is handled by the server, you can safely track their score and store in db.
- If games are handled by the server, you can make two-player battle-tetris.
\*****************************************************************************************/
