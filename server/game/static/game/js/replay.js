// Replay page: plays a finished game's event log through the engine. There
// is no seat, no server connection and no key input; the engine reads the
// recorded keys in order, exactly as a reloaded game page does.
import { Chaos } from './engine/index.js';
import { gameImage } from './engine/image.js';
import { Renderer, Beeper } from './spectrum.js';
import { InputStream } from './input.js';

const $ = id => document.getElementById(id);
const canvas = $('screen');
const overlay = $('overlay');
const MAX_BEHIND = 250;   // frames of catch-up at 1x

const res = await fetch(window.CHAOS.dataUrl);
const data = await res.json();
const total = data.events.length;
const players = Object.fromEntries(data.players.map(p => [p.seat, p.name]));
const registered = new Set(data.players.filter(p => p.registered).map(p => p.seat));
const beeper = new Beeper();

let engine = null, input = null, renderer = null;
let speed = 1, playing = true, ended = false;
let seekTarget = null;    // replay fast, without waits, up to this event
let wizards = {};         // seat -> {name, cpu, dead}, as the engine set them up
let turnSeat = null;

// Build a fresh engine on the whole log; replay up to `target` at once.
function load(target = 0) {
  if (engine) {
    // the old engine stalls at its next wait: nothing ticks it or feeds it
    engine.fast = false;
    engine.onEvent = () => {};
    input.queue.length = 0;
  }
  input = new InputStream();
  input.hostSeat = data.host_seat;
  for (const s of data.human_seats) input.seats.set(s, true);
  for (const e of data.events) {
    input.push(e.kind === 'takeover' ? { type: 'takeover', seat: e.seat } : { type: e.kind, seat: e.seat, code: e.code });
  }
  const consume = input.consume.bind(input);
  input.consume = () => {
    const ev = consume();
    if (seekTarget !== null && input.consumed >= seekTarget) { seekTarget = null; engine.fast = false; }
    return ev;
  };
  wizards = {}; turnSeat = null; ended = false;
  showRounds(null);
  overlay.textContent = '';
  engine = new Chaos(gameImage(), { input, beeper, seed: data.seed, onEvent });
  input.engine = engine;
  renderer = new Renderer(canvas, engine.m, engine.spec);
  seek(target);
  renderSeats();
  engine.run(data.seed).catch(err => { console.error(err); setStatus('Replay error: ' + err.message); });
}

function seek(target) {
  target = Math.max(0, Math.min(total, Math.round(target)));
  if (target < input.consumed) { load(target); return; }
  seekTarget = target > input.consumed ? target : null;
  engine.fast = seekTarget !== null;
}

// The game ends after a fixed number of turns (twice the wizards, plus 15).
function showRounds(ev) {
  const el = document.getElementById('rounds');
  el.classList.toggle('hidden', !ev);
  if (ev) el.textContent = `${ev.left} of ${ev.total} turns left`;
}

function onEvent(ev) {
  if (ev.type === 'wizard') {
    wizards[ev.seat] = { name: engine.messageText(0x29 + ev.seat), cpu: ev.cpu, dead: false };
  } else if (ev.type === 'wizarddead' && wizards[ev.seat]) {
    wizards[ev.seat].dead = true;
  } else if (ev.type === 'turn') {
    turnSeat = ev.seat;
  } else if (ev.type === 'round') {
    showRounds(ev);
  } else if (ev.type === 'gameover') {
    turnSeat = null;
    showRounds(null);
  } else if (ev.type === 'ended') {
    ended = true;
    showResult();
  } else {
    return;
  }
  renderSeats();
}

function wizardName(seat) {
  return (wizards[seat] && wizards[seat].name) || players[seat] || `Wizard ${seat + 1}`;
}

function resultText() {
  const s = data.survivors;
  if (!s.length) return 'Game over';
  return s.length === 1 ? `${wizardName(s[0])} wins!` : `Draw between ${s.map(wizardName).join(', ')}`;
}

function showResult() {
  overlay.textContent = '';
  const p = document.createElement('p');
  p.textContent = resultText();
  const again = document.createElement('button');
  again.textContent = 'Watch again';
  again.onclick = () => { playing = true; load(0); updateButtons(); };
  overlay.append(p, again);
  updateButtons();
}

function renderSeats() {
  const ol = $('seats');
  ol.innerHTML = '';
  const seats = [...new Set([...Object.keys(players), ...Object.keys(wizards)].map(Number))].sort((a, b) => a - b);
  for (const seat of seats) {
    const w = wizards[seat];
    const li = document.createElement('li');
    li.innerHTML = '<span class="num"></span><span class="dot none"></span><span class="name"></span><span class="tag"></span>';
    const [num, , label, tag] = li.children;
    num.textContent = seat + 1;
    const person = players[seat];
    label.textContent = person || (w ? w.name : '');
    if (person && registered.has(seat)) {
      const b = document.createElement('span');
      b.className = 'reg'; b.textContent = '✓'; b.title = 'Registered player';
      label.append(b);
    }
    if (person && w && w.name !== person) label.append(` (${w.name})`);
    if (w && w.cpu) tag.textContent = 'computer';
    else if (seat === data.host_seat && person) tag.textContent = 'host';
    if (w && w.dead) li.classList.add('dead');
    li.classList.toggle('turn', seat === turnSeat);
    ol.appendChild(li);
  }
}

function setStatus(text) { $('status').textContent = text; }

function updateButtons() {
  $('play').textContent = playing && !ended ? 'Pause' : 'Play';
  $('play').disabled = ended;
}

// Engine time: like the game page's ticker, sped up by `speed`.
function startTicker() {
  const chan = new MessageChannel();
  let last = performance.now(), owed = 0, running = false;
  const step = () => {
    if (owed < 1 || !playing) { running = false; return; }
    owed--;
    engine.tick();
    renderer.flashFrame = (renderer.flashFrame + 1) & 31;
    chan.port2.postMessage(0);
  };
  chan.port1.onmessage = step;
  setInterval(() => {
    const now = performance.now();
    if (playing) owed = Math.min(owed + (now - last) / 20 * speed, MAX_BEHIND * speed);
    last = now;
    if (!running && owed >= 1) { running = true; step(); }
  }, 20);
  const draw = () => {
    renderer.draw();
    // the last key's release is never read once the engine has ended
    const done = ended ? total : input.consumed;
    $('bar').style.width = (total ? 100 * done / total : 100) + '%';
    $('position').textContent = `${done.toLocaleString()} of ${total.toLocaleString()} inputs`;
    if (!ended) {
      const turn = turnSeat !== null ? `${wizardName(turnSeat)}'s turn` : 'Setting up';
      setStatus(seekTarget !== null ? 'Jumping…' : playing ? turn : `Paused: ${turn}`);
    } else {
      setStatus(resultText());
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

// ---- controls ---------------------------------------------------------------
$('play').onclick = () => { playing = !playing; updateButtons(); };
$('restart').onclick = () => { playing = true; load(0); updateButtons(); };
$('toend').onclick = () => { playing = true; if (!ended) seek(total); updateButtons(); };
$('speed').onchange = e => { speed = +e.target.value; updateSound(); };
$('track').onclick = e => {
  const r = e.currentTarget.getBoundingClientRect();
  playing = true;
  const target = (e.clientX - r.left) / r.width * total;
  if (ended || target < input.consumed) load(target); else seek(target);
  updateButtons();
};

// Sound on/off and volume, shared with the game page; sound only at 1x.
function loadSetting(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; }
}
function saveSetting(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
}
const soundBox = $('sound'), volumeSlider = $('volume');
soundBox.checked = loadSetting('chaos.sound', '1') === '1';
volumeSlider.value = loadSetting('chaos.volume', '50');
beeper.setVolume(volumeSlider.value / 50);
function updateSound() { beeper.enabled = soundBox.checked && speed === 1; }
updateSound();
soundBox.onchange = () => { updateSound(); saveSetting('chaos.sound', soundBox.checked ? '1' : '0'); };
volumeSlider.oninput = () => beeper.setVolume(volumeSlider.value / 50);
volumeSlider.onchange = () => { saveSetting('chaos.volume', volumeSlider.value); beeper.test(); };
// browsers start audio only after a click on the page
document.addEventListener('click', () => beeper.ensure());

load(0);
updateButtons();
startTicker();
