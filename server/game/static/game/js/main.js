// Game page: connects the engine, screen, sound and the server.
import { Chaos, ANY, HOST } from './engine/index.js';
import { gameImage } from './engine/image.js';
import { Renderer, Beeper } from './spectrum.js';
import { InputStream, spectrumCode } from './input.js';

const cfg = window.CHAOS;
const $ = id => document.getElementById(id);
const canvas = $('screen');
const statusEl = $('status');
const overlay = $('overlay');
const catchup = $('catchup');
const curtain = $('curtain');

let ws = null;
let engine = null;
let renderer = null;
let started = false;
let seats = [];
let hostSeat = 0;
let humanSeats = [];
let mySeat = cfg.seat;
let names = {};           // seat -> player name
let wizards = {};         // seat -> {name, cpu, dead}, as the engine set them up
let menuSeat = null;      // seat whose spell menu is open
let turnSeat = null;      // wizard whose turn it is (menu, cast or move)
let highlightSeat = null; // seat highlighted in the seat list
let survivors = null;     // seats alive at game over
let ended = false;        // the game is over and the engine has stopped
let lastReport = null;
const beeper = new Beeper();
const input = new InputStream();

// ---------------------------------------------------------------------------
// networking
const PRIVATE_CLOSE = 4000;   // WatchConsumer: the game was made private
const CANCEL_CLOSE = 4001;    // the host cancelled the game

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}${cfg.wsPath}`);
  ws.onmessage = e => onMessage(JSON.parse(e.data));
  ws.onclose = e => {
    if (e.code === CANCEL_CLOSE) {
      // players reload to the cancelled game's page; watchers can't open it
      if (!cfg.watching) { location.reload(); return; }
      setStatus('The host cancelled this game.');
      overlay.textContent = 'This game was cancelled.';
      $('copy-watch').classList.add('hidden');
      return;
    }
    if (e.code === PRIVATE_CLOSE) {
      setStatus('The host has stopped public watching.');
      overlay.textContent = 'This game is no longer public.';
      $('copy-watch').classList.add('hidden');
      return;
    }
    setStatus('Connection lost - reconnecting...');
    setTimeout(() => location.reload(), 2000);
  };
}

function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function onMessage(msg) {
  switch (msg.type) {
    case 'init':
      mySeat = msg.you.seat;
      hostSeat = msg.host_seat;
      seats = msg.seats;
      renderSeats();
      showPublic(msg.public_watch);
      showWatchChat(msg.watch_chat);
      if (msg.status !== 'lobby') startEngine(msg.seed, msg.human_seats, msg.events);
      else showLobby();
      break;
    case 'seats':
      seats = msg.seats;
      renderSeats();
      break;
    case 'start':
      startEngine(msg.seed, msg.human_seats, []);
      break;
    case 'event':
      pushEvent(msg);
      break;
    case 'chat':
      addChat(msg.name, msg.text, msg.registered, msg.watcher);
      break;
    case 'chat_refused':
      $('chat-refused').textContent = msg.text;
      $('chat-refused').classList.remove('hidden');
      break;
    case 'settings':
      showPublic(msg.public_watch);
      showWatchChat(msg.watch_chat);
      break;
  }
}

function pushEvent(ev) {
  if (ev.kind === 'takeover') input.push({ type: 'takeover', seat: ev.seat });
  else input.push({ type: ev.kind, seat: ev.seat, code: ev.code });
}

// ---------------------------------------------------------------------------
// lobby
function isHost() { return mySeat === hostSeat; }

function showLobby() {
  const n = seats.filter(s => s.seat >= 0).length;
  overlay.textContent = isHost()
    ? `Waiting for players (${n} joined). Share the game code, then press "Start game".`
    : cfg.watching ? 'The game has not started yet.' : 'Waiting for the host to start the game...';
  $('start').classList.toggle('hidden', !isHost());
  $('lobby-hint').classList.remove('hidden');
  setStatus(isHost() ? 'You are the host' : cfg.watching ? 'Waiting for the game to start' : 'In the lobby');
}

function renderSeats() {
  const ol = $('seats');
  ol.innerHTML = '';
  names = {};
  const players = new Map();
  for (const s of seats) if (s.seat >= 0) { players.set(s.seat, s); names[s.seat] = s.name; }
  // people who joined, plus every wizard the engine has set up (computer
  // wizards and wizards the host plays for empty seats have no player)
  const order = [...new Set([...players.keys(), ...Object.keys(wizards).map(Number)])].sort((a, b) => a - b);
  for (const seat of order) {
    const p = players.get(seat), w = wizards[seat];
    const li = document.createElement('li');
    li.innerHTML = '<span class="num"></span><span class="dot"></span><span class="name"></span><span class="tag"></span>';
    const [num, dot, label, tag] = li.children;
    num.textContent = seat + 1;
    if (p) {
      dot.classList.toggle('on', p.connected);
      label.textContent = p.name;
      if (p.registered) label.append(regBadge());
      if (w && w.name !== p.name) label.append(` (${w.name})`);
      label.classList.toggle('me', seat === mySeat);
    } else {
      dot.classList.add('none');
      label.textContent = w.name;
    }
    if (w && w.dead) li.classList.add('dead');
    if (p && seat === hostSeat) tag.textContent = w && w.cpu ? 'host, computer' : 'host';
    else if (w && w.cpu) tag.textContent = 'computer';
    else if (!p || (started && humanSeats.includes(seat) && !input.seats.get(seat))) tag.textContent = 'host plays';
    else if (started && isHost() && !p.connected && humanSeats.includes(seat)) {
      const b = document.createElement('button');
      b.className = 'small'; b.textContent = 'Take over';
      b.title = 'Answer for this absent player';
      b.onclick = () => send({ type: 'takeover', seat });
      tag.appendChild(b);
    }
    li.dataset.seat = seat;
    li.classList.toggle('turn', seat === highlightSeat);
    ol.appendChild(li);
  }
  const spect = seats.filter(s => s.seat < 0);
  if (spect.length) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="num">&middot;</span><span class="hint"></span>`;
    const list = li.children[1];
    list.textContent = 'Watching: ';
    spect.forEach((s, i) => {
      list.append((i ? ', ' : '') + s.name);
      if (s.registered) list.append(regBadge());
    });
    ol.appendChild(li);
  }
}

$('start').onclick = () => send({ type: 'start' });
// The invite link lets people join; the watch link only lets them watch and
// never shows the game code.
async function copyLink(button, path, what) {
  const url = location.origin + path;
  try { await navigator.clipboard.writeText(url); button.textContent = 'Copied'; }
  catch { prompt(what, url); }
}
if ($('copy')) $('copy').onclick = () => copyLink($('copy'), cfg.inviteUrl, 'Invite link');
$('copy-watch').onclick = () => copyLink($('copy-watch'), cfg.watchUrl, 'Watch link');

// Public watching: the host's switch, and the watch link while it is on.
function showPublic(on) {
  if ($('public')) $('public').checked = on;
  if ($('public-note')) $('public-note').classList.toggle('hidden', !on);
  if ($('watch-row')) $('watch-row').classList.toggle('hidden', !on);
  if ($('watch-chat-row')) $('watch-chat-row').classList.toggle('hidden', !on);
}
if ($('public')) $('public').onchange = e => send({ type: 'settings', public_watch: e.target.checked });

// Whether people on the watch link can chat: the host's switch, and on the
// watch page the chat form or a note that it is off.
function showWatchChat(on) {
  if ($('watch-chat')) $('watch-chat').checked = on;
  if (!cfg.watching) return;
  $('chatform').classList.toggle('hidden', !on);
  $('chat-off').classList.toggle('hidden', on);
}
if ($('watch-chat')) $('watch-chat').onchange = e => send({ type: 'settings', watch_chat: e.target.checked });

// ---------------------------------------------------------------------------
// engine
function startEngine(seed, human, events) {
  if (started) return;
  started = true;
  humanSeats = human;
  overlay.textContent = '';
  $('start').classList.add('hidden');
  $('lobby-hint').classList.add('hidden');
  input.hostSeat = hostSeat;
  for (const s of human) input.seats.set(s, true);
  input.onNeed = who => updateTurn(who);
  // the engine may already be waiting on that seat, so redraw the turn too
  input.onTakeover = () => { renderSeats(); updateTurn(input.waitingFor); reportState(); };
  engine = new Chaos(gameImage(), { input, beeper, seed, rules: cfg.rules, onEvent: onEngineEvent });
  input.engine = engine;
  renderer = new Renderer(canvas, engine.m, engine.spec);
  renderer.hint = () => showRanges ? engine.rangeHint : null;
  renderSeats();
  if (events.length) {
    input.replaying = true;
    engine.fast = true;
    setStatus('Catching up...');
    catchup.classList.remove('hidden');
    for (const ev of events) pushEvent(ev);
  }
  startTicker();
  canvas.focus();
  engine.run(seed).catch(err => { console.error(err); overlay.textContent = 'Engine error: ' + err.message; });
}

// Engine time runs on timers, not requestAnimationFrame: browsers pause rAF in
// background tabs, which would freeze the game for a player who switches away.
// Owed frames run one at a time, yielding between them (MessageChannel is not
// throttled) so the engine's awaiting code runs before the next frame.
function startTicker() {
  const MAX_BEHIND = 250;   // frames (5s) of catch-up at most
  const chan = new MessageChannel();
  let last = performance.now(), owed = 0, running = false;
  const step = () => {
    if (owed < 1) { running = false; return; }
    owed--;
    engine.tick();
    renderer.flashFrame = (renderer.flashFrame + 1) & 31;
    chan.port2.postMessage(0);
  };
  chan.port1.onmessage = step;
  setInterval(() => {
    const now = performance.now();
    owed = Math.min(owed + (now - last) / 20, MAX_BEHIND);
    last = now;
    if (!running && owed >= 1) { running = true; step(); }
  }, 20);
  const draw = () => {
    renderer.draw();
    if (input.replaying) showCatchup();
    updateCurtain();
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

// Progress over the dimmed screen while a reloaded page replays the log.
// The total includes events that arrive during the replay.
function showCatchup() {
  const total = input.consumed + input.queue.length;
  const pct = total ? Math.floor(100 * input.consumed / total) : 100;
  $('catchup-bar').style.width = pct + '%';
  $('catchup-count').textContent =
    `${input.consumed.toLocaleString()} of ${total.toLocaleString()} inputs replayed`;
}

// When spells are hidden, a wizard's spell menu (spell list, spell info,
// "Illusion?") is covered in every browser that cannot answer for that seat.
// The engine runs the same in every browser; only the drawing differs.
function canSeeMenu(seat) {
  return seat === mySeat || (!input.seats.get(seat) && isHost());
}

function updateCurtain() {
  const hide = !cfg.showSpells && menuSeat !== null && !canSeeMenu(menuSeat);
  if (hide) {
    const who = wizardName(menuSeat);
    $('curtain-text').textContent = `${who} is choosing a spell…`;
  }
  curtain.classList.toggle('hidden', !hide);
}

// The game ends after a fixed number of turns (twice the wizards, plus 15).
function showRounds(ev) {
  const el = document.getElementById('rounds');
  el.classList.toggle('hidden', !ev);
  if (ev) el.textContent = `${ev.left} of ${ev.total} turns left`;
}

function onEngineEvent(ev) {
  if (ev.type === 'turn') {
    menuSeat = ev.phase === 'menu' ? ev.seat : null;
    turnSeat = ev.seat;
    updateTurn(input.waitingFor);
  }
  if (ev.type === 'gameover' || ev.type === 'newgame') menuSeat = turnSeat = null;
  if (ev.type === 'round') showRounds(ev);
  if (ev.type === 'gameover' || ev.type === 'newgame') showRounds(null);
  if (ev.type === 'caughtup') {
    catchup.classList.add('hidden');
    updateTurn(input.waitingFor);
  }
  if (ev.type === 'newgame') wizards = {};
  if (ev.type === 'wizard') {
    wizards[ev.seat] = { name: engine.messageText(0x29 + ev.seat), cpu: ev.cpu, dead: false };
    renderSeats();
  }
  if (ev.type === 'wizarddead' && wizards[ev.seat]) {
    wizards[ev.seat].dead = true;
    renderSeats();
  }
  if (ev.type === 'gameover') {
    survivors = ev.survivors;
    reportState();
  }
  if (ev.type === 'ended') {
    // rooms that played on before games ended have events after the end
    if (input.replaying) input.finishReplay();
    ended = true;
    showResult();
  }
}

// Tell the server whose key the engine is waiting for, or the result, so the
// lobby can show it. Every seated browser reports; the server keeps the
// report made at the latest event.
function reportState() {
  if (mySeat < 0 || input.replaying || ended || !engine) return;
  let msg;
  if (survivors) {
    msg = { type: 'state', seq: input.consumed, survivors };
  } else {
    const who = input.waitingFor;
    let turn = null;    // nobody: a computer wizard is acting
    if (computersTurn()) turn = null;
    else if (who === ANY) turn = -1;
    else if (who === HOST) turn = hostSeat;
    else if (who !== null && !engine.isComputer(who)) turn = input.seats.get(who) ? who : hostSeat;
    msg = { type: 'state', seq: input.consumed, turn };
  }
  const report = JSON.stringify(survivors || msg.turn);
  if (report === lastReport) return;
  lastReport = report;
  send(msg);
}

// A computer wizard's turn: the engine may still poll its keys, but no
// person needs to press anything.
function computersTurn() {
  return turnSeat !== null && engine.isComputer(turnSeat);
}

function wizardName(seat) {
  return (wizards[seat] && wizards[seat].name) || names[seat] || `Wizard ${seat + 1}`;
}

function showResult() {
  const text = !survivors ? 'Game over'
    : survivors.length === 1 ? `${wizardName(survivors[0])} wins!`
    : `Draw between ${survivors.map(wizardName).join(', ')}`;
  setStatus('Game over');
  highlightSeat = null;
  for (const li of $('seats').children) li.classList.remove('turn');
  overlay.textContent = '';
  const p = document.createElement('p');
  p.textContent = text;
  const replay = document.createElement('a');
  replay.href = cfg.replayUrl; replay.textContent = 'Watch the replay';
  const a = document.createElement('a');
  a.href = '/'; a.textContent = 'Home';
  overlay.append(p, replay, a);
  if ($('cancel-game')) $('cancel-game').classList.add('hidden');
}

// who: seat index, ANY or HOST
function canAnswer(who) {
  if (mySeat < 0 || input.replaying || ended) return false;
  if (who === ANY) return true;
  if (who === HOST) return isHost();
  if (who === mySeat) return true;
  return !input.seats.get(who) && isHost();
}

function updateTurn(who) {
  if (input.replaying || ended) return;
  reportState();
  const computer = computersTurn();
  const mine = !computer && canAnswer(who);
  let text;
  if (computer) text = `${wizardName(turnSeat)} is playing (computer wizard)`;
  else if (who === ANY) text = 'Press any key to continue';
  else if (who === HOST) text = isHost() ? 'Your move: set up the game' : `Waiting for ${names[hostSeat] || 'the host'}`;
  else if (mine) text = who === mySeat ? 'Your move' : `Your move (for seat ${who + 1})`;
  else text = `Waiting for ${names[who] || 'a computer wizard / host'} (seat ${who + 1})`;
  setStatus(text, mine);
  highlightSeat = computer ? turnSeat : who;
  for (const li of $('seats').children) li.classList.toggle('turn', +li.dataset.seat === highlightSeat);
}

function setStatus(text, highlight = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('you', highlight);
}

// ---------------------------------------------------------------------------
// keyboard: send presses for the player who may answer; auto-repeat held keys
const held = new Map();   // code -> timer
const REPEAT_DELAY = 150, REPEAT_RATE = 120;

function keyDown(code) {
  if (held.has(code)) return;
  beeper.ensure();
  if (!engine || !canAnswer(input.waitingFor)) return;
  send({ type: 'key', kind: 'down', code });
  const t = setTimeout(function rep() {
    if (!held.has(code)) return;
    if (canAnswer(input.waitingFor)) send({ type: 'key', kind: 'down', code });
    held.set(code, setTimeout(rep, REPEAT_RATE));
  }, REPEAT_DELAY);
  held.set(code, t);
}

function keyUp(code) {
  if (!held.has(code)) return;
  clearTimeout(held.get(code));
  held.delete(code);
  send({ type: 'key', kind: 'up', code });
}

const typing = e => e.target.id === 'chatinput' || e.target.id === 'chatname';
document.addEventListener('keydown', e => {
  if (typing(e)) return;
  if (rangesKey(e)) return;
  const code = spectrumCode(e);
  if (code === null) return;
  e.preventDefault();
  keyDown(code);
});
document.addEventListener('keyup', e => {
  if (typing(e)) return;
  const code = spectrumCode(e);
  if (code === null) return;
  keyUp(code);
});
window.addEventListener('blur', () => { for (const c of [...held.keys()]) keyUp(c); });
canvas.addEventListener('click', () => { canvas.focus(); beeper.ensure(); });
// Sound on/off and volume are remembered in this browser.
function loadSetting(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; }
}
function saveSetting(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private window or storage blocked */ }
}
const soundBox = $('sound'), volumeSlider = $('volume');
soundBox.checked = loadSetting('chaos.sound', '1') === '1';
volumeSlider.value = loadSetting('chaos.volume', '50');
beeper.enabled = soundBox.checked;
beeper.setVolume(volumeSlider.value / 50);
soundBox.onchange = () => {
  beeper.enabled = soundBox.checked;
  saveSetting('chaos.sound', soundBox.checked ? '1' : '0');
};
volumeSlider.oninput = () => beeper.setVolume(volumeSlider.value / 50);
volumeSlider.onchange = () => {
  saveSetting('chaos.volume', volumeSlider.value);
  if (!soundBox.checked) { soundBox.checked = true; soundBox.onchange(); }
  beeper.test();
};

// ---------------------------------------------------------------------------
// Range indicators (how far the piece being moved, shooting, or a spell can
// reach): each browser's own choice, remembered, and off until turned on.
// The engine works them out in every game; this only decides whether they are
// drawn. R switches them while the cursor is on the board, where the game
// ignores R, so it is never sent; elsewhere R is a key like any other (a spell
// in the spell list, a letter of a name).
let showRanges = loadSetting('chaos.ranges', '0') === '1';
// the key lists and the pad's R button say which it is
function showRangesState() {
  for (const el of document.querySelectorAll('.ranges-state')) el.textContent = showRanges ? 'ranges on' : 'ranges off';
  const b = document.querySelector('.pad [data-ranges]');
  if (b) b.classList.toggle('on', showRanges);
}
function setRanges(on) {
  showRanges = on;
  showRangesState();
  saveSetting('chaos.ranges', on ? '1' : '0');
}
showRangesState();
function rangesKey(e) {
  if (e.key.toUpperCase() !== 'R' || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (!engine || !(engine.rangeHint || engine.selecting)) return false;
  e.preventDefault();
  if (!e.repeat) setRanges(!showRanges);
  return true;
}

// ---------------------------------------------------------------------------
// on-screen keys, for touch screens: each button presses and releases a
// Spectrum key just as the keyboard does (holding one repeats it)
const pad = $('pad');
if (pad) {
  const key = (k, label, sub, cls) => ({ code: typeof k === 'number' ? k : k.charCodeAt(0), label, sub, cls });
  const groups = [
    ['pad-grid dpad', [key('Q', '↖'), key('W', '↑'), key('E', '↗'), key('A', '←'),
      key('S', 'Select', null, 'select'), key('D', '→'), key('Z', '↙'), key('X', '↓'), key('C', '↘')]],
    ['pad-grid actions', [key('K', 'K', 'cancel'), key('I', 'I', 'info'), key('0', '0', 'end turn'),
      key('Y', 'Y', 'yes'), key('N', 'N', 'no / next'), { ranges: true, label: 'R', sub: 'ranges', subCls: 'ranges-state' },
      { toggle: true, label: 'ABC', sub: 'letters', cls: 'wide3' }]],
    ['pad-row digits', [...'1234567890'].map(d => key(d, d))],
    ['pad-row letters hidden', [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(l => key(l, l)).concat(
      [key(0x0C, '⌫', null, 'wide'), key(0x20, 'Space', null, 'wide'), key(0x0D, 'Enter', null, 'wide')])],
  ];
  for (const [cls, keys] of groups) {
    const div = document.createElement('div');
    div.className = cls;
    for (const k of keys) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = k.label;
      if (k.sub) {
        const s = document.createElement('small');
        s.textContent = k.sub;
        if (k.subCls) s.className = k.subCls;
        b.append(s);
      }
      if (k.cls) b.className = k.cls;
      if (k.toggle) b.dataset.toggle = '1';
      else if (k.ranges) b.dataset.ranges = '1';
      else b.dataset.code = k.code;
      div.append(b);
    }
    pad.append(div);
  }
  showRangesState();
  const letters = pad.querySelector('.letters');
  const release = b => {
    if (!b.classList.contains('pressed')) return;
    b.classList.remove('pressed');
    keyUp(+b.dataset.code);
  };
  pad.addEventListener('pointerdown', e => {
    const b = e.target.closest('button');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.toggle) {
      b.classList.toggle('on', letters.classList.toggle('hidden') === false);
      return;
    }
    if (b.dataset.ranges) { setRanges(!showRanges); return; }
    b.setPointerCapture(e.pointerId);
    b.classList.add('pressed');
    keyDown(+b.dataset.code);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    pad.addEventListener(type, e => { const b = e.target.closest('button'); if (b) release(b); });
  }
  pad.addEventListener('contextmenu', e => e.preventDefault());

  // shown by default on touch screens; the choice is remembered in this browser
  const padBox = $('pad-on');
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  padBox.checked = loadSetting('chaos.pad', coarse ? '1' : '0') === '1';
  pad.classList.toggle('hidden', !padBox.checked);
  padBox.onchange = () => {
    pad.classList.toggle('hidden', !padBox.checked);
    saveSetting('chaos.pad', padBox.checked ? '1' : '0');
  };
}

// ---------------------------------------------------------------------------
// chat
// Watchers who aren't logged in name themselves; the name is remembered in
// this browser.
const chatName = $('chatname');
if (chatName) chatName.value = loadSetting('chaos.watchName', '');
$('chatform').onsubmit = e => {
  e.preventDefault();
  const v = $('chatinput').value.trim();
  if (!v) return;
  const msg = { type: 'chat', text: v };
  if (chatName) {
    msg.name = chatName.value.trim();
    if (!msg.name) { chatName.focus(); return; }
    saveSetting('chaos.watchName', msg.name);
  }
  if (cfg.watching) $('chat-refused').classList.add('hidden');
  send(msg);
  $('chatinput').value = '';
  if (!cfg.watching) canvas.focus();
};
// shown after the names of logged-in players: nobody else may use their name
function regBadge() {
  const b = document.createElement('span');
  b.className = 'reg'; b.textContent = '✓'; b.title = 'Registered player';
  return b;
}

function addChat(name, text, registered, watcher) {
  const div = document.createElement('div');
  div.innerHTML = '<span class="who"></span>: <span></span>';
  div.children[0].textContent = name;
  if (registered) div.children[0].append(regBadge());
  if (watcher) {
    const w = document.createElement('span');
    w.className = 'watcher'; w.textContent = ' (watching)';
    div.children[0].append(w);
  }
  div.children[1].textContent = text;
  $('chatlog').appendChild(div);
  $('chatlog').scrollTop = 1e9;
}

connect();
