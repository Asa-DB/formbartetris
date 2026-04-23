const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { TABLES_SQL } = require('./schema');

const dbFolder = __dirname;
const dbPath = path.join(dbFolder, 'formbartetris.sqlite');

if (!fs.existsSync(dbFolder)) {
    fs.mkdirSync(dbFolder, { recursive: true });
}

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDb() {
    db.exec(TABLES_SQL);
}

function saveUser(id, username, passwordHash = null) {
    const stmt = db.prepare(`
        INSERT INTO users (id, username, password_hash)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            username = excluded.username,
            password_hash = COALESCE(excluded.password_hash, users.password_hash)
    `);

    return stmt.run(id, username, passwordHash);
}

function saveScore(userId, score) {
    const stmt = db.prepare(`
        INSERT INTO scores (user_id, score)
        VALUES (?, ?)
    `);

    return stmt.run(userId, score);
}

function createMatch(player1, player2, winner = null) {
    const stmt = db.prepare(`
        INSERT INTO matches (player1, player2, winner)
        VALUES (?, ?, ?)
    `);

    return stmt.run(player1, player2, winner);
}

function getTopScores(limit = 10) {
    const stmt = db.prepare(`
        SELECT
            scores.id,
            scores.score,
            scores.created_at,
            users.id AS user_id,
            users.username
        FROM scores
        JOIN users ON users.id = scores.user_id
        ORDER BY scores.score DESC, scores.created_at ASC
        LIMIT ?
    `);

    return stmt.all(limit);
}

function getRecentMatches(limit = 10) {
    const stmt = db.prepare(`
        SELECT *
        FROM matches
        ORDER BY created_at DESC
        LIMIT ?
    `);

    return stmt.all(limit);
}

module.exports = {
    db,
    initDb,
    saveUser,
    saveScore,
    createMatch,
    getTopScores,
    getRecentMatches,
};
