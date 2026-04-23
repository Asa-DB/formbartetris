const sounds = {
  bgm: new Audio('music.mp3'),
  move: new Audio('move.mp3'),
  rotate: new Audio('rotate.mp3'),
  clear: new Audio('clear.mp3'),
  land: new Audio('land.mp3'),
  gameover: new Audio('gameover.mp3')
};

sounds.bgm.loop = true;

function updateVolume(val) {
  const vol = val / 100;
  Object.keys(sounds).forEach(k => sounds[k].volume = (k === 'bgm' ? vol * 0.6 : vol));
}
