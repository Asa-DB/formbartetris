function drawMatrix(tCtx, m, o) {
  m.forEach((row, y) => {
    row.forEach((v, x) => {
      if (v !== 0) {
        tCtx.fillStyle = colors[v];
        tCtx.fillRect(x + o.x, y + o.y, 1, 1);
        tCtx.lineWidth = 0.05;
        tCtx.strokeStyle = 'rgba(0,0,0,0.5)';
        tCtx.strokeRect(x + o.x, y + o.y, 1, 1);
      }
    });
  });
}

function draw() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 0.02;
  for (let i = 0; i <= 12; i++) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 20);
    ctx.stroke();
  }
  for (let i = 0; i <= 20; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(12, i);
    ctx.stroke();
  }
  drawMatrix(ctx, arena, { x: 0, y: 0 });
  if (player.matrix) {
    let g = { pos: { ...player.pos }, matrix: player.matrix };
    while (!collide(arena, g)) g.pos.y++;
    g.pos.y--;
    ctx.globalAlpha = 0.15;
    drawMatrix(ctx, g.matrix, g.pos);
    ctx.globalAlpha = 1.0;
    drawMatrix(ctx, player.matrix, player.pos);
  }
  nextCtx.fillStyle = '#000';
  nextCtx.fillRect(0, 0, 4, 14);
  for (let i = 0; i < Math.min(pieceQueue.length, 5); i++) {
    const preview = pieceQueue[i].matrix;
    const x = preview.length === 4 ? 0 : 0.5;
    const y = 0.5 + (i * 2.6);
    drawMatrix(nextCtx, preview, { x, y });
  }
  holdCtx.fillStyle = '#000';
  holdCtx.fillRect(0, 0, 4, 4);
  if (player.holdPiece) {
    drawMatrix(holdCtx, player.holdPiece.matrix, { x: (player.holdPiece.matrix.length === 4 ? 0 : 0.5), y: 0.5 });
  }
}
