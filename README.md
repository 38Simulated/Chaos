# Chaos Online

A multiplayer browser remake of Julian Gollop's *Chaos: The Battle of Wizards*
(ZX Spectrum, 1985). Up to eight wizards, human or computer, fight on the
original board with the original spells, graphics and sound.

Play it at **https://www.thebattleofwizards.com/**.

## How it works

The game is the original, not a reimagining. Its Z80 machine code was
disassembled and ported routine by routine to JavaScript, and the engine reads
its graphics, fonts, text and tables straight from the original game's memory.
The screen and beeper are emulated, so it looks and sounds like a Spectrum.

The server never runs the game. Every browser runs the same deterministic
engine from the same random seed, and the server only puts the players' key
presses into one ordered log and broadcasts it. Every browser sees the same
events in the same order, so they all stay in step without exchanging any game
state. The same log replays finished games and lets people watch games in
progress.

| Part | Technology |
| --- | --- |
| Web and WebSocket server | Django 5.2, Channels, Daphne |
| Storage | PostgreSQL |
| Broadcast | Redis |
| Game engine | JavaScript (ES modules), ported from the Z80 code |

## Repository

| Path | What's there |
| --- | --- |
| `server/` | The Django site; setup, tests and deployment are in [server/README.md](server/README.md) |
| `server/game/static/game/js/engine/` | The game engine |
| `docs/ARCHITECTURE.md` | [How the site works](docs/ARCHITECTURE.md) |
| `docs/MECHANICS.md` | [Every rule of the game](docs/MECHANICS.md), worked out from the original |
| `docs/TURMOIL_BUG.md` | [Why Turmoil hung the original](docs/TURMOIL_BUG.md), and what the remake does instead |
| `re/` | Reverse-engineering notes, maps and tools (a headless Spectrum, lockstep comparison of the original and the port) |
| `tools/build_assets.py` | Rebuilds the engine's copy of the game's memory from a Chaos tape |
| `compose*.yaml`, `.github/workflows/` | Docker Compose files and the VPS deployment |

## Running it locally

You need Python, plus PostgreSQL and Redis (Docker is the easiest way). From
`server/`:

```powershell
docker run -d --name chaos-redis -p 6379:6379 redis
docker run -d --name chaos-postgres -p 5432:5432 -e POSTGRES_USER=chaos -e POSTGRES_PASSWORD=chaos -e POSTGRES_DB=chaos postgres:18
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python manage.py migrate
python -m daphne -b 127.0.0.1 -p 8000 chaos_site.asgi:application
```

Then open http://127.0.0.1:8000/. Run the tests with `python manage.py test game`.
[server/README.md](server/README.md) has the details, including running the
whole site with Docker Compose.
