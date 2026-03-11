const FORMBAR_ADDRESS = 'https://formbar.yorktechapps.com';
const express = require('express');
const session = require('express-session');
const path = require("path");
const app = express();
const port = 3000;

app.use(session({
    secret: 'TYFuUfoKCfl9sQhLHu9sQhLH2_0f',
    resave: false,
    saveUninitialized: true
}));

app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '/index.html'));
});

// metaphorical ticket booth man who kicks you out if you don't have a ticket
app.get('/tetris.html', (req, res) => {
    if (req.session.hasPaid) {
        req.session.hasPaid = false;
        res.sendFile(path.join(__dirname, '/tetris.html'));
    } else {
        res.redirect('/');
    }
});

app.post('/submitpage', (req, res) => {
    const userId = req.body.from;
    
    const payload = {
        from: userId,
        to: 91,
        amount: 50,
        reason: 'Play Tetris',
        pin: req.body.pin
    };

    fetch(`${FORMBAR_ADDRESS}/api/digipogs/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
        .then((transferResult) => transferResult.json())
        .then((responseData) => {
            if (responseData.success) {
                req.session.hasPaid = true;
                res.redirect('/tetris.html');
            } else {
                res.send("payment failed!! error: " + responseData.message);
            }
        })
        .catch(err => {
            console.log("something broke in the fetch", err);
            res.status(500).send("internal error");
        });
});

app.use(express.static(__dirname));

app.listen(port, () => {
    console.log(`server is running on http://localhost:${port}`);
});