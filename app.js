const express = require('express');
const session = require('express-session');
const jwt = require('jsonwebtoken'); // Needed to decode the token
const path = require("path");

// Load the environment variables from the .env file
// .env files are hidden and ignored by git so users and developers can't see them
// This is a good way to store sensitive information like API keys and passwords
// It also puts the config into one easy to edit place
// .env_template shows developers what variables are needed and what they do
const dotenv = require('dotenv');
dotenv.config();
const port = process.env.PORT;
const sessionSecret = process.env.SECRET;
const formbarAddress = process.env.FORMBAR_URL;
const formbarLogin = formbarAddress + '/oauth';
const thisUrl = process.env.THIS_URL;
const thisUrlLogin = thisUrl + '/login';
const payUserId = process.env.PAYUSER;
const entryFee = process.env.ENTRYFEE;

const app = express(); // Create the express app

// Middleware to create a session
// This is used to store the user's session data
app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

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

// Middleware to check if the user is authenticated
// If not, redirect to the login page
function isAuthenticated(req, res, next) {
    // Does this session have a user already?
    if (req.session.user) { 
        // Get the token data from the session
        const tokenData = req.session.token;
        // See if it's expired
        try {
            // Check if the token has expired
            const currentTime = Math.floor(Date.now() / 1000);
            if (tokenData.exp < currentTime) {
                throw new Error('Token has expired');
            }
            // If not, continue to the next middleware  
            next();
        } catch (err) {
            // If it's expired, redirect to the login page  
            res.redirect(`${formbarAddress}/oauth?refreshToken=${tokenData.refreshToken}&redirectURL=${thisUrl}`);
        }
    } else {
        // If no user, redirect to the login page
        res.redirect(`${formbarAddress}/oauth?redirectURL=${thisUrlLogin}`);
    }
}

// Login page
app.get('/login', (req, res) => {
    // Formbar will send a token in the query string if the user successfully logged in
    if (req.query.token) {
        let tokenData = jwt.decode(req.query.token);
        req.session.token = tokenData;
        // Store the user's display name in the session
        req.session.user = tokenData.displayName;
        // Redirect to the home page
        res.redirect('/');
    } else {
        // If no token, redirect to the Formbar login page
        res.redirect(`${formbarLogin}?redirectURL=${thisUrlLogin}`);
    };
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
        res.render('tetris');
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
    const userId = req.session.token.id;
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

// Put all the static files in the public folder so they're organized
// Also prevents users from accessing files outside the public folder
// Put this at the bottom so it only runs for requests that don't match any other routes
app.use(express.static(path.join(__dirname, 'public')));

// Start the server
app.listen(port, () => {
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