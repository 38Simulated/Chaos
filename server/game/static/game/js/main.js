// Game page: connects the engine, screen, sound and the server.
import { Chaos, ANY, HOST } from './engine/index.js';
import { Renderer, Beeper } from './spectrum.js';
import { InputStream, spectrumCode } from './input.js';

const cfg = window.CHAOS;
const $ = id => document.getElementById(id);
const canvas = $('screen');
const statusEl = $('status');
const overlay = $('overlay');

let ws = null;
let engine = null;
let renderer = null;
let started = false;
let seats = [];
let hostSeat = 0;
let humanSeats = [];
let mySeat = cfg.seat;
let names = {};           // seat -> player name
let wizardNames = {};     // seat -> name typed in game
const beeper = new Beeper();
const input = new InputStream();

// ---------------------------------------------------------------------------
// asset
async function loadImage() {
  const res = await fetch(cfg.asset);
  if (!res.ok) throw new Error('missing');
  return new Uint8Array(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------
// networking
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/game/${cfg.code}/`);
  ws.onmessage = e => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
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
      if (msg.status === 'playing') startEngine(msg.seed, msg.human_seats, msg.events);
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
      addChat(msg.name, msg.text);
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
    : 'Waiting for the host to start the game...';
  $('start').classList.toggle('hidden', !isHost());
  $('lobby-hint').classList.remove('hidden');
  setStatus(isHost() ? 'You are the host' : 'In the lobby');
}

function renderSeats() {
  const ol = $('seats');
  ol.innerHTML = '';
  names = {};
  for (const s of seats) {
    if (s.seat < 0) continue;
    names[s.seat] = s.name;
    const li = document.createElement('li');
    li.innerHTML = `<span class="num">${s.seat + 1}</span><span class="dot ${s.connected ? 'on' : ''}"></span>
      <span class="${s.seat === mySeat ? 'me' : ''}"></span><span class="tag"></span>`;
    li.children[2].textContent = s.name + (wizardNames[s.seat] && wizardNames[s.seat] !== s.name ? ` (${wizardNames[s.seat]})` : '');
    const tag = li.children[3];
    if (s.seat === hostSeat) tag.textContent = 'host';
    if (started && isHost() && s.seat !== mySeat && !s.connected && humanSeats.includes(s.seat)) {
      const b = document.createElement('button');
      b.className = 'small'; b.textContent = 'Take over';
      b.title = 'Answer for this absent player';
      b.onclick = () => send({ type: 'takeover', seat: s.seat });
      tag.appendChild(b);
    }
    li.dataset.seat = s.seat;
    ol.appendChild(li);
  }
  const spect = seats.filter(s => s.seat < 0);
  if (spect.length) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="num">&middot;</span><span class="hint"></span>`;
    li.children[1].textContent = 'Watching: ' + spect.map(s => s.name).join(', ');
    ol.appendChild(li);
  }
}

$('start').onclick = () => send({ type: 'start' });
$('copy').onclick = async () => {
  const url = `${location.origin}/g/${cfg.code}/`;
  try { await navigator.clipboard.writeText(url); $('copy').textContent = 'Copied'; }
  catch { prompt('Invite link', url); }
};

// ---------------------------------------------------------------------------
// engine
async function startEngine(seed, human, events) {
  if (started) return;
  started = true;
  humanSeats = human;
  overlay.textContent = '';
  $('start').classList.add('hidden');
  $('lobby-hint').classList.add('hidden');
  let bin;
  try { bin = await loadImage(); }
  catch {
    overlay.textContent = 'The game image (chaos.bin) is missing on the server. Run "python tools/build_assets.py" with your copy of the Chaos tape.';
    return;
  }
  input.hostSeat = hostSeat;
  for (const s of human) input.seats.set(s, true);
  input.onNeed = who => updateTurn(who);
  engine = new Chaos(bin, { input, beeper, seed, onEvent: onEngineEvent });
  input.engine = engine;
  renderer = new Renderer(canvas, engine.m, engine.spec);
  renderSeats();
  if (events.length) {
    input.replaying = true;
    engine.fast = true;
    setStatus('Catching up...');
    for (const ev of events) pushEvent(ev);
  }
  startTicker();
  canvas.focus();
  engine.run(seed).catch(err => { console.error(err); overlay.textContent = 'Engine error: ' + err.message; });
}

function startTicker() {
  let last = performance.now(), acc = 0;
  const frame = now => {
    acc += Math.min(now - last, 200);
    last = now;
    while (acc >= 20) { engine.tick(); renderer.flashFrame = (renderer.flashFrame + 1) & 31; acc -= 20; }
    renderer.draw();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function onEngineEvent(ev) {
  if (ev.type === 'caughtup') updateTurn(input.waitingFor);
  if (ev.type === 'newgame') wizardNames = {};
}

// who: seat index, ANY or HOST
function canAnswer(who) {
  if (mySeat < 0 || input.replaying) return false;
  if (who === ANY) return true;
  if (who === HOST) return isHost();
  if (who === mySeat) return true;
  return !input.seats.get(who) && isHost();
}

function updateTurn(who) {
  if (input.replaying) return;
  const mine = canAnswer(who);
  let text;
  if (who === ANY) text = 'Press any key to continue';
  else if (who === HOST) text = isHost() ? 'Your move: set up the game' : `Waiting for ${names[hostSeat] || 'the host'}`;
  else if (mine) text = who === mySeat ? 'Your move' : `Your move (for seat ${who + 1})`;
  else text = `Waiting for ${names[who] || 'a computer wizard / host'} (seat ${who + 1})`;
  setStatus(text, mine);
  for (const li of $('seats').children) li.classList.toggle('turn', +li.dataset.seat === who);
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

document.addEventListener('keydown', e => {
  if (e.target.id === 'chatinput') return;
  const code = spectrumCode(e);
  if (code === null) return;
  e.preventDefault();
  keyDown(code);
});
document.addEventListener('keyup', e => {
  if (e.target.id === 'chatinput') return;
  const code = spectrumCode(e);
  if (code === null) return;
  keyUp(code);
});
window.addEventListener('blur', () => { for (const c of [...held.keys()]) keyUp(c); });
canvas.addEventListener('click', () => { canvas.focus(); beeper.ensure(); });
$('sound').onchange = e => { beeper.enabled = e.target.checked; };

// ---------------------------------------------------------------------------
// chat
$('chatform').onsubmit = e => {
  e.preventDefault();
  const v = $('chatinput').value.trim();
  if (v) send({ type: 'chat', text: v });
  $('chatinput').value = '';
  canvas.focus();
};
function addChat(name, text) {
  const div = document.createElement('div');
  div.innerHTML = '<span class="who"></span>: <span></span>';
  div.children[0].textContent = name;
  div.children[1].textContent = text;
  $('chatlog').appendChild(div);
  $('chatlog').scrollTop = 1e9;
}

connect();
