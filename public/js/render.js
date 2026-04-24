function drawMatrix(tCtx, m, o) {
  m.forEach((row, y) => {
    row.forEach((v, x) => {
      if (v !== 0) {
        tCtx.fillStyle = colors[v];
        tCtx.fillRect(x + o.x, y + o.y, 1, 1);
        tCtx.fillStyle = 'rgba(255,255,255,0.18)';
        tCtx.fillRect(x + o.x, y + o.y, 1, 0.16);
        tCtx.fillRect(x + o.x, y + o.y, 0.16, 1);
        tCtx.lineWidth = 0.05;
        tCtx.strokeStyle = 'rgba(6,10,14,0.9)';
        tCtx.strokeRect(x + o.x, y + o.y, 1, 1);
      }
    });
  });
}

function drawBoardSnapshot(tCtx, board, width, height) {
  tCtx.fillStyle = '#08111a';
  tCtx.fillRect(0, 0, width, height);
  tCtx.strokeStyle = '#12202a';
  tCtx.lineWidth = 0.02;
  for (let i = 0; i <= width; i++) {
    tCtx.beginPath();
    tCtx.moveTo(i, 0);
    tCtx.lineTo(i, height);
    tCtx.stroke();
  }
  for (let i = 0; i <= height; i++) {
    tCtx.beginPath();
    tCtx.moveTo(0, i);
    tCtx.lineTo(width, i);
    tCtx.stroke();
  }
  if (board && board.length) {
    drawMatrix(tCtx, board, { x: 0, y: 0 });
  }
}

function draw() {
  if (gameMode === 'spectator') {
    drawBoardSnapshot(ctx, remoteState && remoteState.board ? remoteState.board : [], 12, 20);
  } else {
    drawBoardSnapshot(ctx, arena, 12, 20);
    if (player.matrix) {
      let g = { pos: { ...player.pos }, matrix: player.matrix };
      while (!collide(arena, g)) g.pos.y++;
      g.pos.y--;
      ctx.globalAlpha = 0.15;
      drawMatrix(ctx, g.matrix, g.pos);
      ctx.globalAlpha = 1.0;
      drawMatrix(ctx, player.matrix, player.pos);
    }
  }
  nextCtx.fillStyle = '#08111a';
  nextCtx.fillRect(0, 0, 4, 6);
  for (let i = 0; i < Math.min(pieceQueue.length, 2); i++) {
    const preview = pieceQueue[i].matrix;
    const x = preview.length === 4 ? 0 : 0.5;
    const y = 0.5 + (i * 2.6);
    drawMatrix(nextCtx, preview, { x, y });
  }
  holdCtx.fillStyle = '#08111a';
  holdCtx.fillRect(0, 0, 4, 4);
  if (player.holdPiece) {
    drawMatrix(holdCtx, player.holdPiece.matrix, { x: (player.holdPiece.matrix.length === 4 ? 0 : 0.5), y: 0.5 });
  }
  if (remoteCtx) {
    drawBoardSnapshot(remoteCtx, remoteState && remoteState.board ? remoteState.board : [], 12, 20);
  }
}
