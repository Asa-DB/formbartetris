const express = require('express');
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

// Load the environment variables from the .env file
// .env files are hidden and ignored by git so users and developers can't see them
// This is a good way to store sensitive information like API keys and passwords
// It also puts the config into one easy to edit place
// .env_template shows developers what variables are needed and what they do
const dotenv = require('dotenv');
dotenv.config();
const port = process.env.PORT;
const sessionSecret = process.env.SECRET;
const jwtSecret = process.env.JWT_SECRET;
const formbarAddress = process.env.FORMBAR_URL;
const formbarLogin = formbarAddress + '/oauth';
const thisUrl = process.env.THIS_URL;
const thisUrlLogin = thisUrl + '/login';
const payUserId = process.env.PAYUSER;
const entryFee = process.env.ENTRYFEE;
const isProduction = process.env.NODE_ENV === 'production';

if (!sessionSecret) {
    throw new Error('Missing SECRET in environment variables');
}

if (!jwtSecret) {
    throw new Error('Missing JWT_SECRET in environment variables');
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

function clearSession(req) {
    req.session.token = null;
    req.session.user = null;
    req.session.refreshToken = null;
    req.session.hasPaid = false;
}

function redirectToLogin(res) {
    res.redirect(`${formbarAddress}/oauth?redirectURL=${thisUrlLogin}`);
}

function verifyToken(token) {
    return jwt.verify(token, jwtSecret);
}

function wrapExpressMiddleware(middleware) {
    return (socket, next) => middleware(socket.request, {}, next);
}

// Middleware to check if the user is authenticated
// If not, redirect to the login page
function isAuthenticated(req, res, next) {
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
                return res.redirect(`${formbarAddress}/oauth?refreshToken=${refreshToken}&redirectURL=${thisUrl}`);
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

let waitingPlayer = null;
const matches = {};

io.use(wrapExpressMiddleware(sessionMiddleware));

function makeMatchPayload(roomId, p1, p2) {
    return {
        roomId,
        players: [
            { id: p1.userId, username: p1.username },
            { id: p2.userId, username: p2.username }
        ]
    };
}

function removeSocketFromMatch(socket) {
    const roomId = socket.data.roomId;
    if (!roomId || !matches[roomId]) return;

    const match = matches[roomId];
    const otherPlayer = match.p1.socketId === socket.id ? match.p2 : match.p1;
    const otherSocket = io.sockets.sockets.get(otherPlayer.socketId);

    if (otherSocket) {
        otherSocket.emit('opponentWin', { roomId });
    }

    delete matches[roomId];
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

    socket.on('joinQueue', () => {
        if (socket.data.roomId) {
            socket.emit('queueError', { message: 'already in a match' });
            return;
        }

        if (waitingPlayer && waitingPlayer.socketId === socket.id) {
            socket.emit('queueJoined', { position: 1 });
            return;
        }

        if (!waitingPlayer) {
            waitingPlayer = {
                socketId: socket.id,
                userId: socket.data.userId,
                username: socket.data.username
            };

            socket.emit('queueJoined', { position: 1 });
            return;
        }

        if (waitingPlayer.userId === socket.data.userId) {
            socket.emit('queueJoined', { position: 1 });
            return;
        }

        const p1 = waitingPlayer;
        const p2 = {
            socketId: socket.id,
            userId: socket.data.userId,
            username: socket.data.username
        };

        waitingPlayer = null;

        const roomId = `${p1.userId}_${p2.userId}`;
        const p1Socket = io.sockets.sockets.get(p1.socketId);
        const p2Socket = io.sockets.sockets.get(p2.socketId);

        if (!p1Socket || !p2Socket) {
            if (p1Socket) {
                waitingPlayer = p1;
                p1Socket.emit('queueJoined', { position: 1 });
            }
            if (p2Socket && !p1Socket) {
                waitingPlayer = p2;
                p2Socket.emit('queueJoined', { position: 1 });
            }
            return;
        }

        matches[roomId] = { p1, p2 };
        p1Socket.join(roomId);
        p2Socket.join(roomId);
        p1Socket.data.roomId = roomId;
        p2Socket.data.roomId = roomId;

        const payload = makeMatchPayload(roomId, p1, p2);
        p1Socket.emit('matchFound', payload);
        p2Socket.emit('matchFound', payload);
    });

    socket.on('leaveQueue', () => {
        if (waitingPlayer && waitingPlayer.socketId === socket.id) {
            waitingPlayer = null;
        }
    });

    socket.on('clearLines', data => {
        const roomId = socket.data.roomId;
        if (!roomId || !matches[roomId]) return;

        const lines = Number(data && data.lines);
        const garbage = Math.max(0, lines - 1);
        if (garbage <= 0) return;

        const match = matches[roomId];
        const otherPlayer = match.p1.socketId === socket.id ? match.p2 : match.p1;
        const otherSocket = io.sockets.sockets.get(otherPlayer.socketId);
        if (!otherSocket) return;

        otherSocket.emit('garbage', { lines: garbage });
    });

    socket.on('gameOver', () => {
        const roomId = socket.data.roomId;
        if (!roomId || !matches[roomId]) return;

        const match = matches[roomId];
        const otherPlayer = match.p1.socketId === socket.id ? match.p2 : match.p1;
        const otherSocket = io.sockets.sockets.get(otherPlayer.socketId);

        if (otherSocket) {
            otherSocket.emit('opponentWin', { roomId });
            otherSocket.data.roomId = null;
        }

        socket.data.roomId = null;
        delete matches[roomId];
    });

    socket.on('disconnect', () => {
        if (waitingPlayer && waitingPlayer.socketId === socket.id) {
            waitingPlayer = null;
        }

        removeSocketFromMatch(socket);
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
