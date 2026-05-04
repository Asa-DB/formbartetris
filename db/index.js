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

const DEFAULT_ELO_RATING = 1000;
const DEFAULT_ELO_K_FACTOR = 32;

function hasColumn(tableName, columnName) {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().some(column => column.name === columnName);
}

function usersTableHasUniqueUsernameConstraint() {
    const usersTable = db.prepare(`
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = 'users'
    `).get();

    if (!usersTable || !usersTable.sql) {
        return false;
    }

    return /username\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(usersTable.sql);
}

function migrateUsersTableToNonUniqueUsername() {
    if (!usersTableHasUniqueUsernameConstraint()) {
        return;
    }

    const usersHasBio = hasColumn('users', 'bio');
    const usersHasAvatarVersion = hasColumn('users', 'avatar_version');

    db.exec('PRAGMA foreign_keys = OFF');

    try {
        db.transaction(() => {
            db.exec(`
                CREATE TABLE users_new (
                    id INTEGER PRIMARY KEY,
                    username TEXT NOT NULL,
                    password_hash TEXT,
                    bio TEXT NOT NULL DEFAULT '',
                    avatar_version INTEGER NOT NULL DEFAULT 0,
                    elo_rating INTEGER NOT NULL DEFAULT 1000,
                    total_wins INTEGER NOT NULL DEFAULT 0,
                    total_losses INTEGER NOT NULL DEFAULT 0,
                    bot_wins_easy INTEGER NOT NULL DEFAULT 0,
                    bot_wins_medium INTEGER NOT NULL DEFAULT 0,
                    bot_wins_hard INTEGER NOT NULL DEFAULT 0,
                    player_vs_player_wins INTEGER NOT NULL DEFAULT 0
                );

                INSERT INTO users_new (
                    id,
                    username,
                    password_hash,
                    bio,
                    avatar_version,
                    elo_rating,
                    total_wins,
                    total_losses,
                    bot_wins_easy,
                    bot_wins_medium,
                    bot_wins_hard,
                    player_vs_player_wins
                )
                SELECT
                    id,
                    username,
                    password_hash,
                    ${usersHasBio ? 'bio' : "''"},
                    ${usersHasAvatarVersion ? 'avatar_version' : '0'},
                    elo_rating,
                    total_wins,
                    total_losses,
                    bot_wins_easy,
                    bot_wins_medium,
                    bot_wins_hard,
                    player_vs_player_wins
                FROM users;

                DROP TABLE users;
                ALTER TABLE users_new RENAME TO users;
            `);
        })();
    } finally {
        db.exec('PRAGMA foreign_keys = ON');
    }
}

function initDb() {
    db.exec(TABLES_SQL);

    if (!hasColumn('users', 'elo_rating')) {
        db.exec(`ALTER TABLE users ADD COLUMN elo_rating INTEGER NOT NULL DEFAULT ${DEFAULT_ELO_RATING}`);
    }

    if (!hasColumn('users', 'bio')) {
        db.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
    }

    if (!hasColumn('users', 'avatar_version')) {
        db.exec('ALTER TABLE users ADD COLUMN avatar_version INTEGER NOT NULL DEFAULT 0');
    }

    if (!hasColumn('users', 'total_wins')) {
        db.exec('ALTER TABLE users ADD COLUMN total_wins INTEGER NOT NULL DEFAULT 0');
    }

    if (!hasColumn('users', 'total_losses')) {
        db.exec('ALTER TABLE users ADD COLUMN total_losses INTEGER NOT NULL DEFAULT 0');
    }

    if (!hasColumn('users', 'bot_wins_easy')) {
        db.exec('ALTER TABLE users ADD COLUMN bot_wins_easy INTEGER NOT NULL DEFAULT 0');
    }

    if (!hasColumn('users', 'bot_wins_medium')) {
        db.exec('ALTER TABLE users ADD COLUMN bot_wins_medium INTEGER NOT NULL DEFAULT 0');
    }

    if (!hasColumn('users', 'bot_wins_hard')) {
        db.exec('ALTER TABLE users ADD COLUMN bot_wins_hard INTEGER NOT NULL DEFAULT 0');
    }

    if (!hasColumn('users', 'player_vs_player_wins')) {
        db.exec('ALTER TABLE users ADD COLUMN player_vs_player_wins INTEGER NOT NULL DEFAULT 0');
    }

    if (!hasColumn('tournaments', 'max_players')) {
        db.exec('ALTER TABLE tournaments ADD COLUMN max_players INTEGER NOT NULL DEFAULT 8');
    }

    if (!hasColumn('elo_match_history', 'match_id')) {
        db.exec("ALTER TABLE elo_match_history ADD COLUMN match_id TEXT NOT NULL DEFAULT ''");
    }

    if (!hasColumn('leaderboard_entries', 'user_id')) {
        db.exec('ALTER TABLE leaderboard_entries ADD COLUMN user_id INTEGER');
    }

    if (hasColumn('elo_match_history', 'match_id')) {
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_elo_match_history_match_player ON elo_match_history(match_id, player_id)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_elo_match_history_match_id ON elo_match_history(match_id)');
    }

    migrateUsersTableToNonUniqueUsername();
    backfillLeaderboardEntryUserIds();
}

function backfillLeaderboardEntryUserIds() {
    if (!hasColumn('leaderboard_entries', 'user_id')) {
        return;
    }

    const uniqueUsers = db.prepare(`
        SELECT id, username
        FROM users
        WHERE username IN (
            SELECT username
            FROM users
            GROUP BY username
            HAVING COUNT(*) = 1
        )
    `).all();

    const updateLeaderboardEntryUserId = db.prepare(`
        UPDATE leaderboard_entries
        SET user_id = ?
        WHERE user_id IS NULL AND player_name = ?
    `);

    const applyBackfill = db.transaction(players => {
        players.forEach(player => {
            updateLeaderboardEntryUserId.run(player.id, player.username);
        });
    });

    applyBackfill(uniqueUsers);
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

function getDefaultPlayerStats() {
    return {
        totalWins: 0,
        totalLosses: 0,
        botWinsEasy: 0,
        botWinsMedium: 0,
        botWinsHard: 0,
        playerVsPlayerWins: 0
    };
}

function getPlayerStats(playerId) {
    const statement = db.prepare(`
        SELECT
            total_wins AS totalWins,
            total_losses AS totalLosses,
            bot_wins_easy AS botWinsEasy,
            bot_wins_medium AS botWinsMedium,
            bot_wins_hard AS botWinsHard,
            player_vs_player_wins AS playerVsPlayerWins
        FROM users
        WHERE id = ?
    `);
    const playerStats = statement.get(playerId);

    if (!playerStats) {
        return getDefaultPlayerStats();
    }

    return {
        totalWins: Number(playerStats.totalWins) || 0,
        totalLosses: Number(playerStats.totalLosses) || 0,
        botWinsEasy: Number(playerStats.botWinsEasy) || 0,
        botWinsMedium: Number(playerStats.botWinsMedium) || 0,
        botWinsHard: Number(playerStats.botWinsHard) || 0,
        playerVsPlayerWins: Number(playerStats.playerVsPlayerWins) || 0
    };
}

function updatePlayerStats(playerId, playerStats) {
    const normalizedStats = {
        ...getDefaultPlayerStats(),
        ...playerStats
    };
    const statement = db.prepare(`
        UPDATE users
        SET total_wins = ?,
            total_losses = ?,
            bot_wins_easy = ?,
            bot_wins_medium = ?,
            bot_wins_hard = ?,
            player_vs_player_wins = ?
        WHERE id = ?
    `);

    return statement.run(
        normalizedStats.totalWins,
        normalizedStats.totalLosses,
        normalizedStats.botWinsEasy,
        normalizedStats.botWinsMedium,
        normalizedStats.botWinsHard,
        normalizedStats.playerVsPlayerWins,
        playerId
    );
}

function normalizeEloRating(eloRating) {
    const parsedRating = Number(eloRating);

    if (!Number.isFinite(parsedRating)) {
        return DEFAULT_ELO_RATING;
    }

    return Math.max(0, Math.round(parsedRating));
}

function normalizePlayerResult(result) {
    if (typeof result === 'number') {
        return Math.max(0, Math.min(1, result));
    }

    if (typeof result === 'string') {
        if (result === 'win') return 1;
        if (result === 'loss') return 0;
        if (result === 'draw') return 0.5;
    }

    if (result && typeof result === 'object') {
        if (typeof result.playerAScore === 'number') {
            return Math.max(0, Math.min(1, result.playerAScore));
        }

        if (result.winner === 'playerA') return 1;
        if (result.winner === 'playerB') return 0;
        if (result.winner === 'draw') return 0.5;
    }

    return 0.5;
}

function getKFactor(result) {
    if (result && typeof result === 'object' && Number.isFinite(Number(result.kFactor))) {
        return Math.max(1, Math.round(Number(result.kFactor)));
    }

    return DEFAULT_ELO_K_FACTOR;
}

function calculateExpectedScore(playerRating, opponentRating) {
    return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
}

function calculateEloChange(playerA, playerB, result) {
    const playerARating = normalizeEloRating(playerA && playerA.eloRating);
    const playerBRating = normalizeEloRating(playerB && playerB.eloRating);
    const playerAResult = normalizePlayerResult(result);
    const expectedScoreForPlayerA = calculateExpectedScore(playerARating, playerBRating);
    const kFactor = getKFactor(result);
    const playerAEloChange = Math.round(kFactor * (playerAResult - expectedScoreForPlayerA));
    const playerBEloChange = -playerAEloChange;

    return {
        playerAEloChange,
        playerBEloChange,
        playerANewElo: normalizeEloRating(playerARating + playerAEloChange),
        playerBNewElo: normalizeEloRating(playerBRating + playerBEloChange),
        expectedScoreForPlayerA,
        expectedScoreForPlayerB: 1 - expectedScoreForPlayerA,
        kFactor
    };
}

function getPlayerElo(playerId) {
    const statement = db.prepare(`
        SELECT elo_rating
        FROM users
        WHERE id = ?
    `);
    const player = statement.get(playerId);

    if (!player) {
        return DEFAULT_ELO_RATING;
    }

    return normalizeEloRating(player.elo_rating);
}

function getPlayerRatingProfile(playerId) {
    const statement = db.prepare(`
        SELECT
            id,
            username,
            elo_rating
        FROM users
        WHERE id = ?
    `);
    const player = statement.get(playerId);

    if (!player) {
        return null;
    }

    return {
        playerId: player.id,
        playerName: player.username,
        eloRating: normalizeEloRating(player.elo_rating),
        competitorType: 'player'
    };
}

function updatePlayerElo(playerId, newElo) {
    const statement = db.prepare(`
        UPDATE users
        SET elo_rating = ?
        WHERE id = ?
    `);

    return statement.run(normalizeEloRating(newElo), playerId);
}

function getPlayerRank(playerId) {
    const statement = db.prepare(`
        SELECT
            id,
            elo_rating
        FROM users
        ORDER BY elo_rating DESC, id ASC
    `);
    const rankedPlayers = statement.all();

    for (let index = 0; index < rankedPlayers.length; index++) {
        if (String(rankedPlayers[index].id) === String(playerId)) {
            return index + 1;
        }
    }

    return null;
}

function getBotRatingProfile(botId, botName = 'Bot') {
    const selectStatement = db.prepare(`
        SELECT
            bot_id,
            bot_name,
            elo_rating
        FROM bot_ratings
        WHERE bot_id = ?
    `);
    let botRating = selectStatement.get(botId);

    if (!botRating) {
        const insertStatement = db.prepare(`
            INSERT INTO bot_ratings (bot_id, bot_name, elo_rating)
            VALUES (?, ?, ?)
        `);
        insertStatement.run(botId, botName, DEFAULT_ELO_RATING);
        botRating = selectStatement.get(botId);
    }

    return {
        botId: botRating.bot_id,
        botName: botRating.bot_name,
        eloRating: normalizeEloRating(botRating.elo_rating),
        competitorType: 'bot'
    };
}

function updateBotElo(botId, newElo, botName = 'Bot') {
    const normalizedElo = normalizeEloRating(newElo);
    const statement = db.prepare(`
        INSERT INTO bot_ratings (bot_id, bot_name, elo_rating, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(bot_id) DO UPDATE SET
            bot_name = excluded.bot_name,
            elo_rating = excluded.elo_rating,
            updated_at = CURRENT_TIMESTAMP
    `);

    return statement.run(botId, botName, normalizedElo);
}

function updateCompetitorElo(competitor, newElo) {
    if (competitor && competitor.competitorType === 'bot') {
        return updateBotElo(competitor.botId, newElo, competitor.botName);
    }

    return updatePlayerElo(competitor.playerId, newElo);
}

function isMatchAlreadyProcessed(matchId) {
    const statement = db.prepare(`
        SELECT id
        FROM elo_match_history
        WHERE match_id = ?
    `);

    return !!statement.get(matchId);
}

function recordMatchHistoryEntry(matchHistoryEntry) {
    const statement = db.prepare(`
        INSERT INTO elo_match_history (
            match_id,
            player_id,
            opponent_type,
            opponent_id,
            opponent_name,
            match_result,
            mode_type,
            player_elo_change,
            player_elo_after,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return statement.run(
        matchHistoryEntry.matchId,
        matchHistoryEntry.playerId,
        matchHistoryEntry.opponentType,
        String(matchHistoryEntry.opponentId),
        matchHistoryEntry.opponentName,
        matchHistoryEntry.matchResult,
        matchHistoryEntry.modeType,
        matchHistoryEntry.playerEloChange,
        matchHistoryEntry.playerEloAfter,
        matchHistoryEntry.createdAt
    );
}

function getRecentMatchHistoryCount(playerId, millisecondsBack) {
    const cutoffTime = new Date(Date.now() - millisecondsBack).toISOString();
    const statement = db.prepare(`
        SELECT COUNT(*) AS matchCount
        FROM elo_match_history
        WHERE player_id = ?
          AND created_at >= ?
    `);
    const matchCount = statement.get(playerId, cutoffTime);

    return Number(matchCount && matchCount.matchCount) || 0;
}

function getRecentBotMatchCount(playerId, botId, millisecondsBack) {
    const cutoffTime = new Date(Date.now() - millisecondsBack).toISOString();
    const statement = db.prepare(`
        SELECT COUNT(*) AS matchCount
        FROM elo_match_history
        WHERE player_id = ?
          AND opponent_type = 'bot'
          AND opponent_id = ?
          AND created_at >= ?
    `);
    const matchCount = statement.get(playerId, String(botId), cutoffTime);

    return Number(matchCount && matchCount.matchCount) || 0;
}

function getPlayerMenuSummary(playerId) {
    const statement = db.prepare(`
        SELECT
            id,
            username,
            bio,
            avatar_version AS avatarVersion,
            elo_rating AS eloRating,
            total_wins AS totalWins,
            total_losses AS totalLosses,
            bot_wins_easy AS botWinsEasy,
            bot_wins_medium AS botWinsMedium,
            bot_wins_hard AS botWinsHard,
            player_vs_player_wins AS playerVsPlayerWins
        FROM users
        WHERE id = ?
    `);
    const playerSummary = statement.get(playerId);

    if (!playerSummary) {
        return null;
    }

    return {
        playerId: playerSummary.id,
        playerName: playerSummary.username,
        bio: String(playerSummary.bio || ''),
        avatarVersion: Number(playerSummary.avatarVersion) || 0,
        eloRating: normalizeEloRating(playerSummary.eloRating),
        rank: getPlayerRank(playerId),
        totalWins: Number(playerSummary.totalWins) || 0,
        totalLosses: Number(playerSummary.totalLosses) || 0,
        botWinsEasy: Number(playerSummary.botWinsEasy) || 0,
        botWinsMedium: Number(playerSummary.botWinsMedium) || 0,
        botWinsHard: Number(playerSummary.botWinsHard) || 0,
        playerVsPlayerWins: Number(playerSummary.playerVsPlayerWins) || 0
    };
}

function getPvpOnlyEloByPlayer(playerId) {
    const statement = db.prepare(`
        SELECT COALESCE(SUM(player_elo_change), 0) AS eloChange
        FROM elo_match_history
        WHERE player_id = ?
          AND mode_type = 'playerVsPlayerRanked'
    `);
    const result = statement.get(playerId);

    return DEFAULT_ELO_RATING + (Number(result && result.eloChange) || 0);
}

function getBestFortyLineTimeForPlayer(playerId) {
    if (playerId == null) {
        return null;
    }

    const statement = db.prepare(`
        SELECT MIN(score_or_time) AS bestTime
        FROM leaderboard_entries
        WHERE mode_type = 'fortyLine'
          AND user_id = ?
    `);
    const result = statement.get(playerId);

    if (!result || result.bestTime == null) {
        return null;
    }

    return Number(result.bestTime);
}

function buildOverallEloLeaderboardEntries() {
    const players = db.prepare(`
        SELECT
            id,
            username,
            avatar_version AS avatarVersion,
            elo_rating AS eloRating
        FROM users
    `).all();

    return players
        .map(player => ({
            playerId: player.id,
            username: player.username,
            avatarVersion: Number(player.avatarVersion) || 0,
            value: normalizeEloRating(player.eloRating)
        }))
        .sort((firstPlayer, secondPlayer) => {
            if (secondPlayer.value !== firstPlayer.value) {
                return secondPlayer.value - firstPlayer.value;
            }

            return String(firstPlayer.username).localeCompare(String(secondPlayer.username), undefined, { sensitivity: 'base' })
                || firstPlayer.playerId - secondPlayer.playerId;
        });
}

function buildPvpOnlyEloLeaderboardEntries() {
    const players = db.prepare(`
        SELECT id, username, avatar_version AS avatarVersion
        FROM users
    `).all();
    const pvpOnlyChanges = db.prepare(`
        SELECT
            player_id AS playerId,
            COALESCE(SUM(player_elo_change), 0) AS eloChange
        FROM elo_match_history
        WHERE mode_type = 'playerVsPlayerRanked'
        GROUP BY player_id
    `).all();
    const pvpOnlyChangeByPlayerId = new Map(
        pvpOnlyChanges.map(entry => [String(entry.playerId), Number(entry.eloChange) || 0])
    );

    return players
        .map(player => ({
            playerId: player.id,
            username: player.username,
            avatarVersion: Number(player.avatarVersion) || 0,
            value: DEFAULT_ELO_RATING + (pvpOnlyChangeByPlayerId.get(String(player.id)) || 0)
        }))
        .sort((firstPlayer, secondPlayer) => {
            if (secondPlayer.value !== firstPlayer.value) {
                return secondPlayer.value - firstPlayer.value;
            }

            return String(firstPlayer.username).localeCompare(String(secondPlayer.username), undefined, { sensitivity: 'base' })
                || firstPlayer.playerId - secondPlayer.playerId;
        });
}

function buildFortyLineLeaderboardEntries() {
    const fortyLineEntries = getEntriesForMode('fortyLine');
    const bestEntryByPlayer = new Map();

    fortyLineEntries.forEach(entry => {
        const entryKey = entry.playerId != null
            ? `player:${entry.playerId}`
            : `legacy:${entry.playerName}`;
        const existingEntry = bestEntryByPlayer.get(entryKey);

        if (!existingEntry) {
            bestEntryByPlayer.set(entryKey, {
                playerId: entry.playerId,
                username: entry.playerName,
                avatarVersion: Number(entry.avatarVersion) || 0,
                value: Number(entry.scoreOrTime) || 0,
                timestamp: entry.timestamp
            });
            return;
        }

        const isBetterTime = entry.scoreOrTime < existingEntry.value;
        const isEarlierTie = entry.scoreOrTime === existingEntry.value
            && new Date(entry.timestamp).getTime() < new Date(existingEntry.timestamp).getTime();

        if (isBetterTime || isEarlierTie) {
            existingEntry.value = Number(entry.scoreOrTime) || 0;
            existingEntry.timestamp = entry.timestamp;
            if (entry.playerId != null) {
                existingEntry.playerId = entry.playerId;
                existingEntry.avatarVersion = Number(entry.avatarVersion) || 0;
            }
            existingEntry.username = entry.playerName;
        }
    });

    return Array.from(bestEntryByPlayer.values())
        .sort((firstPlayer, secondPlayer) => {
            if (firstPlayer.value !== secondPlayer.value) {
                return firstPlayer.value - secondPlayer.value;
            }

            return new Date(firstPlayer.timestamp).getTime() - new Date(secondPlayer.timestamp).getTime();
        });
}

function getLeaderboardCategoryEntries(categoryKey) {
    if (categoryKey === 'eloNoBots') {
        return buildPvpOnlyEloLeaderboardEntries();
    }

    if (categoryKey === 'eloWithBots') {
        return buildOverallEloLeaderboardEntries();
    }

    if (categoryKey === 'fortyLineTimes') {
        return buildFortyLineLeaderboardEntries();
    }

    return [];
}

function getPvpOnlyRank(playerId) {
    const rankedPlayers = buildPvpOnlyEloLeaderboardEntries();

    for (let index = 0; index < rankedPlayers.length; index++) {
        if (String(rankedPlayers[index].playerId) === String(playerId)) {
            return index + 1;
        }
    }

    return null;
}

function getPlayerProfile(playerId) {
    const playerSummary = getPlayerMenuSummary(playerId);

    if (!playerSummary) {
        return null;
    }

    const pvpOnlyElo = getPvpOnlyEloByPlayer(playerId);
    const fortyLineBestTime = getBestFortyLineTimeForPlayer(playerId);
    const totalBotWins = (playerSummary.botWinsEasy || 0)
        + (playerSummary.botWinsMedium || 0)
        + (playerSummary.botWinsHard || 0);

    return {
        playerId: playerSummary.playerId,
        username: playerSummary.playerName,
        bio: playerSummary.bio,
        avatarVersion: playerSummary.avatarVersion,
        overallElo: playerSummary.eloRating,
        overallRank: playerSummary.rank,
        pvpOnlyElo,
        pvpOnlyRank: getPvpOnlyRank(playerId),
        totalWins: playerSummary.totalWins,
        totalLosses: playerSummary.totalLosses,
        playerVsPlayerWins: playerSummary.playerVsPlayerWins,
        botWinsEasy: playerSummary.botWinsEasy,
        botWinsMedium: playerSummary.botWinsMedium,
        botWinsHard: playerSummary.botWinsHard,
        totalBotWins,
        fortyLineBestTime
    };
}

function addScore(entry) {
    const statement = db.prepare(`
        INSERT INTO leaderboard_entries (player_name, user_id, score_or_time, timestamp, mode_type)
        VALUES (?, ?, ?, ?, ?)
    `);

    return statement.run(
        entry.playerName,
        entry.playerId ?? null,
        entry.scoreOrTime,
        entry.timestamp,
        entry.modeType
    );
}

function isTimeBasedMode(modeType) {
    return modeType === 'fortyLine';
}

function sortLeaderboard(entries) {
    if (!entries.length) {
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

function getEntryTimestamp(entryTimestamp) {
    return new Date(entryTimestamp).getTime();
}

function isEntryInLastMilliseconds(entryTimestamp, millisecondsBack) {
    const entryTime = getEntryTimestamp(entryTimestamp);
    const currentTime = Date.now();

    if (Number.isNaN(entryTime)) {
        return false;
    }

    return entryTime >= currentTime - millisecondsBack;
}

function isAllTimeTimeframe(timeframe) {
    return timeframe === 'allTime' || timeframe === 'all';
}

function isWeeklyTimeframe(timeframe) {
    return timeframe === 'weekly' || timeframe === 'week';
}

function isDailyTimeframe(timeframe) {
    return timeframe === 'daily' || timeframe === 'today';
}

function isEntryWithinTimeframe(entryTimestamp, timeframe) {
    if (isAllTimeTimeframe(timeframe)) {
        return true;
    }

    if (isWeeklyTimeframe(timeframe)) {
        return isEntryInLastMilliseconds(entryTimestamp, 7 * 24 * 60 * 60 * 1000);
    }

    if (isDailyTimeframe(timeframe)) {
        return isEntryInLastMilliseconds(entryTimestamp, 24 * 60 * 60 * 1000);
    }

    return true;
}

function getEntriesForMode(modeType) {
    const statement = db.prepare(`
        SELECT
            leaderboard_entries.id,
            COALESCE(leaderboard_entries.user_id, users.id) AS playerId,
            COALESCE(users.username, leaderboard_entries.player_name) AS playerName,
            COALESCE(users.avatar_version, 0) AS avatarVersion,
            leaderboard_entries.score_or_time AS scoreOrTime,
            leaderboard_entries.timestamp,
            leaderboard_entries.mode_type AS modeType
        FROM leaderboard_entries
        LEFT JOIN users ON users.id = leaderboard_entries.user_id
        WHERE mode_type = ?
    `);

    return statement.all(modeType);
}

function allTimeLeaderboard(modeType) {
    return sortLeaderboard(getEntriesForMode(modeType));
}

function weeklyLeaderboard(modeType) {
    const leaderboardEntries = getEntriesForMode(modeType).filter(entry => {
        return isEntryWithinTimeframe(entry.timestamp, 'weekly');
    });

    return sortLeaderboard(leaderboardEntries);
}

function dailyLeaderboard(modeType) {
    const leaderboardEntries = getEntriesForMode(modeType).filter(entry => {
        return isEntryWithinTimeframe(entry.timestamp, 'daily');
    });

    return sortLeaderboard(leaderboardEntries);
}

function getLeaderboard(modeType, timeframe = 'allTime') {
    if (isWeeklyTimeframe(timeframe)) {
        return weeklyLeaderboard(modeType);
    }

    if (isDailyTimeframe(timeframe)) {
        return dailyLeaderboard(modeType);
    }

    return allTimeLeaderboard(modeType);
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

function updatePlayerProfile(playerId, { bio, avatarVersion }) {
    const normalizedBio = typeof bio === 'string' ? bio : '';
    const hasAvatarVersion = Number.isInteger(avatarVersion) && avatarVersion >= 0;

    const statement = db.prepare(`
        UPDATE users
        SET bio = ?,
            avatar_version = CASE
                WHEN ? THEN ?
                ELSE avatar_version
            END
        WHERE id = ?
    `);

    return statement.run(
        normalizedBio,
        hasAvatarVersion ? 1 : 0,
        hasAvatarVersion ? avatarVersion : 0,
        playerId
    );
}

function getPlayerDirectory(searchTerm = '', limit = 60) {
    const normalizedSearch = String(searchTerm || '').trim().toLowerCase();
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 60, 120));
    const statement = db.prepare(`
        SELECT
            id,
            username,
            bio,
            avatar_version AS avatarVersion,
            elo_rating AS overallElo
        FROM users
        WHERE LOWER(username) LIKE ?
           OR CAST(id AS TEXT) LIKE ?
        ORDER BY username COLLATE NOCASE ASC, id ASC
        LIMIT ?
    `);
    const searchPattern = `%${normalizedSearch}%`;

    return statement.all(searchPattern, searchPattern, normalizedLimit).map(player => ({
        playerId: player.id,
        username: player.username,
        bio: String(player.bio || ''),
        avatarVersion: Number(player.avatarVersion) || 0,
        overallElo: normalizeEloRating(player.overallElo)
    }));
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
    DEFAULT_ELO_K_FACTOR,
    DEFAULT_ELO_RATING,
    getDefaultPlayerStats,
    initDb,
    isMatchAlreadyProcessed,
    saveUser,
    saveScore,
    addScore,
    allTimeLeaderboard,
    calculateEloChange,
    createMatch,
    dailyLeaderboard,
    getBotRatingProfile,
    getPlayerElo,
    getPlayerMenuSummary,
    getPlayerProfile,
    getPlayerDirectory,
    getTopScores,
    getLeaderboard,
    getLeaderboardCategoryEntries,
    getPlayerRank,
    getPlayerRatingProfile,
    getPlayerStats,
    getRecentBotMatchCount,
    getRecentMatchHistoryCount,
    getRecentMatches,
    recordMatchHistoryEntry,
    sortLeaderboard,
    updateBotElo,
    updateCompetitorElo,
    updatePlayerElo,
    updatePlayerProfile,
    updatePlayerStats,
    weeklyLeaderboard,
};
