const express = require('express');
const fs = require('fs');
const http = require('http');
const session = require('express-session');
const jwt = require('jsonwebtoken'); // Needed to decode the token
const path = require("path");
const { Server } = require('socket.io');
const {
    initDb,
    saveUser,
    saveScore,
    createMatch,
    getTopScores,
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
const isProduction = process.env.NODE_ENV === 'production';

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
        res.render('tetris', {
            player: {
                userId: req.session.userId,
                username: req.session.user,
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

app.post('/matches/create', isAuthenticated, (req, res) => {
    const player1 = Number(req.body.player1);
    const player2 = Number(req.body.player2);
    const winner = req.body.winner ? Number(req.body.winner) : null;

    if (!Number.isInteger(player1) || !Number.isInteger(player2)) {
        return res.status(400).json({ success: false, message: 'invalid match players' });
    }

    const result = createMatch(player1, player2, winner);
    res.json({ success: true, id: result.lastInsertRowid });
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

function isTournamentRoom(room) {
    return !!(room && room.roomType === 'tournament' && room.tournamentId);
}

function normalizeRoomType(value) {
    return value === 'tournament' ? 'tournament' : 'standard';
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
        passwordProtected: !!room.password,
        locked: !!room.locked,
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
                playerCount: tournament ? tournament.playerCount : room.players.length,
                spectatorCount: room.spectators.length,
                passwordProtected: !!room.password,
                locked: !!room.locked,
                entryFee: tournament ? tournament.entryFee : null,
                prizePool: tournament ? tournament.prizePool : null,
                submittedPlayers: tournament ? tournament.submittedPlayers : null
            };
        });
}

function sendRoomList(targetSocket) {
    if (targetSocket) {
        targetSocket.emit('roomsList', getRoomList());
        return;
    }

    io.emit('roomsList', getRoomList());
}

function removeSocketFromRoom(socket) {
    const roomName = socket.data.roomName;
    if (!roomName || !rooms[roomName]) return;

    const room = rooms[roomName];
    const wasPlayer = room.players.includes(socket.id);
    const hadOpponent = room.players.some(id => id !== socket.id);

    if (!isTournamentRoom(room) && wasPlayer && socket.data.isPlaying && hadOpponent) {
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
        username: socket.data.username
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
        const roomName = makeRoomName();
        const password = data && typeof data.password === 'string' && data.password.trim()
            ? data.password.trim()
            : null;
        const baseRoom = {
            roomType,
            password,
            locked: false,
            creatorSocketId: socket.id,
            creatorUserId: socket.data.userId,
            creatorUsername: socket.data.username,
            players: [socket.id],
            spectators: [],
            tournamentId: null
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

        if (isUserAlreadyInRoom(room, socket.data.userId)) {
            socket.emit('roomError', { message: 'you are already in this room' });
            return;
        }

        if (isTournamentRoom(room)) {
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
                    if (socket.data.userId === room.creatorUserId) {
                        room.creatorSocketId = socket.id;
                    }

                    socket.join(roomName);
                    socket.data.roomName = roomName;
                    socket.data.roomRole = 'player';
                    socket.data.isPlaying = false;

                    socket.emit('roomJoined', {
                        roomName,
                        roomType: 'tournament',
                        role: 'player',
                        creatorSocketId: room.creatorSocketId || null,
                        isCreator: room.creatorUserId === socket.data.userId,
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
            role,
            creatorSocketId: room.creatorSocketId || null,
            isCreator: room.creatorUserId === socket.data.userId
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

        room.spectators.push(socket.id);
        socket.join(roomName);
        socket.data.roomName = roomName;
        socket.data.roomRole = 'spectator';
        socket.data.isPlaying = false;

        socket.emit('roomJoined', {
            roomName,
            roomType: room.roomType || 'standard',
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

    socket.on('startGame', () => {
        const roomName = socket.data.roomName;
        if (!roomName || socket.data.roomRole !== 'player' || !rooms[roomName]) return;

        const room = rooms[roomName];
        if (room.creatorUserId !== socket.data.userId) {
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

        io.to(roomName).emit('gameStart', {
            roomName,
            startedBy: socket.data.username
        });
    });

    socket.on('playerReady', () => {
        const roomName = socket.data.roomName;
        if (!roomName || socket.data.roomRole !== 'player' || !rooms[roomName]) return;

        if (isTournamentRoom(rooms[roomName])) {
            return;
        }

        socket.data.isPlaying = true;
        io.to(roomName).emit('playerStarted', {
            roomName,
            userId: socket.data.userId,
            username: socket.data.username
        });
    });

    socket.on('stateUpdate', data => {
        const roomName = socket.data.roomName;
        if (!roomName || socket.data.roomRole !== 'player' || !rooms[roomName]) return;

        if (isTournamentRoom(rooms[roomName])) {
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

        if (isTournamentRoom(rooms[roomName])) {
            return;
        }

        const lines = Number(data && data.lines);
        const garbage = Math.max(0, lines - 1);
        if (garbage <= 0) return;

        sendToOtherPlayers(roomName, socket.id, 'garbage', { lines: garbage });
        sendToSpectators(roomName, 'roomMessage', {
            roomName,
            message: `${socket.data.username} sent ${garbage} garbage`
        });
    });

    socket.on('gameOver', () => {
        const roomName = socket.data.roomName;
        if (!roomName || socket.data.roomRole !== 'player' || !rooms[roomName]) return;

        if (isTournamentRoom(rooms[roomName])) {
            socket.data.isPlaying = false;
            return;
        }

        socket.data.isPlaying = false;

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

        try {
            const submission = tournamentManager.submitScore({
                tournamentId: room.tournamentId,
                userId: socket.data.userId,
                score
            });

            let tournament = submission.tournament;

            if (submission.isComplete) {
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
