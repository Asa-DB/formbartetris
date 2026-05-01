const { db, saveUser } = require('./db');

const DEFAULT_MAX_PLAYERS = 8;
const MAX_TOURNAMENT_PLAYERS = 50;

function asPublicTournament(row) {
    if (!row) return null;

    const entries = db.prepare(`
        SELECT
            user_id AS userId,
            username,
            paid_amount AS paidAmount,
            score,
            submitted_at AS submittedAt
        FROM tournament_entries
        WHERE tournament_id = ?
        ORDER BY
            CASE WHEN score IS NULL THEN 1 ELSE 0 END ASC,
            score DESC,
            submitted_at ASC,
            id ASC
    `).all(row.id);

    const submittedPlayers = entries.filter(entry => entry.score != null).length;

    return {
        id: row.id,
        roomName: row.room_name,
        creatorUserId: row.creator_user_id,
        creatorUsername: row.creator_username,
        entryFee: row.entry_fee,
        minPlayers: row.min_players,
        maxPlayers: Number(row.max_players) || DEFAULT_MAX_PLAYERS,
        prizePool: row.prize_pool,
        isLocked: !!row.is_locked,
        seed: row.seed,
        winnerUserId: row.winner_user_id,
        winnerUsername: row.winner_username,
        winnerScore: row.winner_score,
        winnerPayout: row.winner_payout,
        platformCut: row.platform_cut,
        payoutStatus: row.payout_status,
        createdAt: row.created_at,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        playerCount: entries.length,
        submittedPlayers,
        leaderboard: entries
    };
}

function getTournamentRowById(tournamentId) {
    return db.prepare(`
        SELECT *
        FROM tournaments
        WHERE id = ?
    `).get(tournamentId);
}

function getTournamentRowByRoomName(roomName) {
    return db.prepare(`
        SELECT *
        FROM tournaments
        WHERE room_name = ?
    `).get(roomName);
}

function getTournamentState(tournamentId) {
    return asPublicTournament(getTournamentRowById(tournamentId));
}

function getTournamentByRoomName(roomName) {
    return asPublicTournament(getTournamentRowByRoomName(roomName));
}

function getTournamentEntry(tournamentId, userId) {
    return db.prepare(`
        SELECT
            id,
            tournament_id AS tournamentId,
            user_id AS userId,
            username,
            paid_amount AS paidAmount,
            score,
            created_at AS createdAt,
            submitted_at AS submittedAt
        FROM tournament_entries
        WHERE tournament_id = ? AND user_id = ?
    `).get(tournamentId, userId);
}

const createTournamentTxn = db.transaction(({
    roomName,
    creatorUserId,
    creatorUsername,
    entryFee,
    minPlayers,
    maxPlayers,
    bonusContribution
}) => {
    saveUser(creatorUserId, creatorUsername);

    const tournamentResult = db.prepare(`
        INSERT INTO tournaments (
            room_name,
            creator_user_id,
            creator_username,
            entry_fee,
            min_players,
            max_players,
            prize_pool
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        roomName,
        creatorUserId,
        creatorUsername,
        entryFee,
        minPlayers,
        maxPlayers,
        entryFee + bonusContribution
    );

    const tournamentId = Number(tournamentResult.lastInsertRowid);

    db.prepare(`
        INSERT INTO tournament_entries (
            tournament_id,
            user_id,
            username,
            paid_amount
        )
        VALUES (?, ?, ?, ?)
    `).run(tournamentId, creatorUserId, creatorUsername, entryFee);

    db.prepare(`
        INSERT INTO tournament_ledger (
            tournament_id,
            user_id,
            entry_type,
            amount,
            note
        )
        VALUES (?, ?, 'entry_fee', ?, ?)
    `).run(tournamentId, creatorUserId, entryFee, 'Tournament entry fee');

    if (bonusContribution > 0) {
        db.prepare(`
            INSERT INTO tournament_ledger (
                tournament_id,
                user_id,
                entry_type,
                amount,
                note
            )
            VALUES (?, ?, 'bonus_pool', ?, ?)
        `).run(tournamentId, creatorUserId, bonusContribution, 'Tournament bonus pool contribution');
    }

    return tournamentId;
});

function createTournament(options) {
    const tournamentId = createTournamentTxn(options);
    return getTournamentState(tournamentId);
}

const joinTournamentTxn = db.transaction(({ tournamentId, userId, username, paidAmount }) => {
    const tournament = getTournamentState(tournamentId);

    if (!tournament) {
        throw new Error('tournament not found');
    }

    if (tournament.playerCount >= tournament.maxPlayers) {
        throw new Error(`tournament is full (${tournament.maxPlayers} players max)`);
    }

    saveUser(userId, username);

    db.prepare(`
        INSERT INTO tournament_entries (
            tournament_id,
            user_id,
            username,
            paid_amount
        )
        VALUES (?, ?, ?, ?)
    `).run(tournamentId, userId, username, paidAmount);

    db.prepare(`
        UPDATE tournaments
        SET prize_pool = prize_pool + ?
        WHERE id = ?
    `).run(paidAmount, tournamentId);

    db.prepare(`
        INSERT INTO tournament_ledger (
            tournament_id,
            user_id,
            entry_type,
            amount,
            note
        )
        VALUES (?, ?, 'entry_fee', ?, ?)
    `).run(tournamentId, userId, paidAmount, 'Tournament entry fee');
});

function joinTournament({ tournamentId, userId, username, paidAmount }) {
    joinTournamentTxn({ tournamentId, userId, username, paidAmount });
    return getTournamentState(tournamentId);
}

function updateTournamentMaxPlayers(tournamentId, maxPlayers) {
    const tournament = getTournamentState(tournamentId);

    if (!tournament) {
        throw new Error('tournament not found');
    }

    if (tournament.isLocked || tournament.finishedAt) {
        throw new Error('tournament already started');
    }

    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > MAX_TOURNAMENT_PLAYERS) {
        throw new Error(`player limit must be between 2 and ${MAX_TOURNAMENT_PLAYERS}`);
    }

    if (tournament.playerCount > maxPlayers) {
        throw new Error(`cannot set player limit below ${tournament.playerCount}`);
    }

    db.prepare(`
        UPDATE tournaments
        SET max_players = ?
        WHERE id = ?
    `).run(maxPlayers, tournamentId);

    return getTournamentState(tournamentId);
}

function deleteTournament({ tournamentId, creatorUserId }) {
    const tournament = getTournamentState(tournamentId);

    if (!tournament) {
        throw new Error('tournament not found');
    }

    if (creatorUserId != null && String(tournament.creatorUserId) !== String(creatorUserId)) {
        throw new Error('only the tournament creator can delete this room');
    }

    if (tournament.isLocked || tournament.startedAt || tournament.finishedAt) {
        throw new Error('cannot delete a started tournament');
    }

    if (tournament.playerCount > 1) {
        throw new Error('cannot delete a tournament after other entrants have joined');
    }

    db.prepare(`
        DELETE FROM tournaments
        WHERE id = ?
    `).run(tournamentId);
}

function lockTournament(tournamentId) {
    const tournament = getTournamentState(tournamentId);

    if (!tournament) {
        throw new Error('tournament not found');
    }

    if (tournament.isLocked) {
        return tournament;
    }

    if (tournament.playerCount < tournament.minPlayers) {
        throw new Error(`need ${tournament.minPlayers} players to start`);
    }

    const seed = Math.floor(Math.random() * 2147483647) + 1;

    db.prepare(`
        UPDATE tournaments
        SET is_locked = 1,
            seed = ?,
            started_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(seed, tournamentId);

    return getTournamentState(tournamentId);
}

function submitScore({ tournamentId, userId, score }) {
    const tournament = getTournamentState(tournamentId);

    if (!tournament) {
        throw new Error('tournament not found');
    }

    if (!tournament.isLocked) {
        throw new Error('tournament has not started');
    }

    if (tournament.finishedAt) {
        throw new Error('tournament already finished');
    }

    const entry = getTournamentEntry(tournamentId, userId);

    if (!entry) {
        throw new Error('player is not in this tournament');
    }

    if (entry.score != null) {
        throw new Error('score already submitted');
    }

    db.prepare(`
        UPDATE tournament_entries
        SET score = ?,
            submitted_at = CURRENT_TIMESTAMP
        WHERE tournament_id = ? AND user_id = ?
    `).run(score, tournamentId, userId);

    const nextTournament = getTournamentState(tournamentId);
    const isComplete = nextTournament.playerCount > 0 && nextTournament.playerCount === nextTournament.submittedPlayers;

    return {
        tournament: nextTournament,
        isComplete
    };
}

function determineWinner(tournamentId) {
    const tournament = getTournamentState(tournamentId);

    if (!tournament) {
        throw new Error('tournament not found');
    }

    if (tournament.leaderboard.length === 0) {
        throw new Error('no tournament players');
    }

    const winner = tournament.leaderboard.find(entry => entry.score != null);

    if (!winner) {
        throw new Error('no submitted scores');
    }

    const { winnerPayout, platformCut } = calculatePayoutBreakdown(tournament.prizePool);

    return {
        tournament,
        winner,
        winnerPayout,
        platformCut
    };
}

function buildWinnerResult({ tournamentId, winnerUserId, winnerUsername, winnerScore }) {
    const tournament = getTournamentState(tournamentId);

    if (!tournament) {
        throw new Error('tournament not found');
    }

    const { winnerPayout, platformCut } = calculatePayoutBreakdown(tournament.prizePool);

    return {
        tournament,
        winner: {
            userId: winnerUserId,
            username: winnerUsername,
            score: winnerScore
        },
        winnerPayout,
        platformCut
    };
}

function calculatePayoutBreakdown(prizePool) {
    const winnerPayout = Math.floor(prizePool * 0.65);
    const platformCut = prizePool - winnerPayout;

    return {
        winnerPayout,
        platformCut
    };
}

const distributeRewardsTxn = db.transaction(({
    tournamentId,
    winnerUserId,
    winnerUsername,
    winnerScore,
    winnerPayout,
    platformCut,
    payoutStatus
}) => {
    const existing = getTournamentRowById(tournamentId);

    if (!existing) {
        throw new Error('tournament not found');
    }

    if (existing.finished_at) {
        return;
    }

    db.prepare(`
        UPDATE tournaments
        SET winner_user_id = ?,
            winner_username = ?,
            winner_score = ?,
            winner_payout = ?,
            platform_cut = ?,
            payout_status = ?,
            finished_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(
        winnerUserId,
        winnerUsername,
        winnerScore,
        winnerPayout,
        platformCut,
        payoutStatus,
        tournamentId
    );

    if (winnerPayout > 0) {
        db.prepare(`
            INSERT INTO tournament_ledger (
                tournament_id,
                user_id,
                entry_type,
                amount,
                note
            )
            VALUES (?, ?, 'winner_payout', ?, ?)
        `).run(tournamentId, winnerUserId, -winnerPayout, 'Winner payout');
    }

    if (platformCut > 0) {
        db.prepare(`
            INSERT INTO tournament_ledger (
                tournament_id,
                user_id,
                entry_type,
                amount,
                note
            )
            VALUES (?, NULL, 'platform_fee', ?, ?)
        `).run(tournamentId, platformCut, 'Platform retained pool share');
    }
});

function distributeRewards(options) {
    distributeRewardsTxn(options);
    return getTournamentState(options.tournamentId);
}

module.exports = {
    createTournament,
    joinTournament,
    lockTournament,
    submitScore,
    determineWinner,
    buildWinnerResult,
    distributeRewards,
    updateTournamentMaxPlayers,
    deleteTournament,
    getTournamentState,
    getTournamentByRoomName,
    getTournamentEntry,
};
