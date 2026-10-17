"""WebSocket protocol for a Chaos game.

The server never runs the game itself. Every browser runs the same
deterministic engine from the game's seed; the server only orders the
players' key presses into a single log and broadcasts it, so all engines
see exactly the same input at exactly the same logical points.

Client -> server:
  {"type": "key", "kind": "down"|"up", "code": n}
  {"type": "start"}                       host only, in the lobby
  {"type": "takeover", "seat": n}         host only: answer for an absent seat
  {"type": "chat", "text": "..."}
  {"type": "state", "seq": n, "turn": seat|-1|null}
                                          seated players: whose key the engine
                                          waits for after event n
  {"type": "state", "seq": n, "survivors": [seat, ...]}
                                          seated players: the game ended
  {"type": "settings", "public_watch": b, "watch_chat": b}
                                          host only, either or both: let anyone
                                          watch; let watchers chat
Server -> client:
  {"type": "init", ...}                   on connect: seats, seed, full log
  {"type": "seats", "seats": [...]}       lobby / connection changes
  {"type": "start", "seed", "human_seats"}
  {"type": "event", "seq", "seat", "kind", "code"}
  {"type": "chat", "name", "registered", "text"}
                                          "watcher": true when it is from the
                                          watch link
  {"type": "chat_refused", "text"}        to a watcher whose chat was refused
  {"type": "settings", "public_watch": b, "watch_chat": b}

"registered" (in chat messages and in each seat) is true when the player is
logged in and plays under their username, which nobody else may use.

Watchers of a public game connect to /ws/watch/<watch id>/ (WatchConsumer)
and get the same messages, except that the init message leaves out the game
code. They cannot play; while the game's watch_chat is on they can chat,
sending {"type": "chat", "name", "text"}. A logged-in watcher always chats
under their username; anyone else names themselves, but not with a
registered username or the name of one of the game's players.

When the host cancels a game (an HTTP POST, see views.cancel), every
connection to it is closed with code 4001, and new ones are refused.
"""
import time

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db import IntegrityError, transaction
from django.contrib.auth.models import User
from django.db.models import Max
from django.utils import timezone

from .models import MAX_NAME, Event, Game, Player

PRIVATE_CLOSE = 4000    # closes watchers' connections when a game is made private
CANCEL_CLOSE = 4001     # closes every connection to a game the host cancelled
VALID_CODES = set(range(0x30, 0x3A)) | set(range(0x41, 0x5B)) | {0x0D, 0x20, 0x0C}
WATCHER_CHAT_GAP = 1.0  # seconds a watcher must wait between chat messages


class GameConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.code = self.scope['url_route']['kwargs']['code'].upper()
        self.group = 'game_' + self.code
        session = self.scope.get('session') or {}
        token = (session.get('players') or {}).get(self.code)
        self.player = await self.load_player(token, self.scope.get('user'))
        if not self.player:
            await self.close()
            return
        if self.player.game.status == Game.CANCELLED:
            await self.accept()
            await self.close(code=CANCEL_CLOSE)
            self.player = None
            return
        self.game_id = self.player.game_id
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        await self.set_connected(True)
        await self.send_json(await self.init_message())
        await self.broadcast_seats()

    async def disconnect(self, close_code):
        if getattr(self, 'player', None):
            await self.set_connected(False)
            await self.channel_layer.group_discard(self.group, self.channel_name)
            await self.broadcast_seats()

    async def receive_json(self, msg, **kwargs):
        t = msg.get('type')
        if t == 'key':
            await self.on_key(msg)
        elif t == 'start':
            await self.on_start()
        elif t == 'takeover':
            await self.on_takeover(msg)
        elif t == 'state':
            await self.on_state(msg)
        elif t == 'settings':
            await self.on_settings(msg)
        elif t == 'chat':
            text = chat_text(msg)
            if text:
                await self.send_chat(self.player.name, self.player.registered, text)

    async def send_chat(self, name, registered, text, watcher=False):
        chat = {'type': 'chat', 'name': name, 'registered': registered, 'text': text}
        if watcher:
            chat['watcher'] = True
        await self.channel_layer.group_send(self.group, {'type': 'relay', 'msg': chat})

    async def on_key(self, msg):
        kind = msg.get('kind')
        code = msg.get('code')
        if kind not in ('down', 'up') or code not in VALID_CODES or self.player.seat < 0:
            return
        ev = await self.append_event(self.player.seat, kind, code)
        if ev:
            await self.channel_layer.group_send(self.group, {'type': 'relay', 'msg': dict(type='event', **ev)})

    async def on_start(self):
        started = await self.start_game()
        if started:
            # players who joined but never opened the game page are not in
            # the browsers' seat lists yet; send it before the engine starts
            await self.broadcast_seats()
            await self.channel_layer.group_send(self.group, {'type': 'relay', 'msg': dict(type='start', **started)})

    async def on_state(self, msg):
        if self.player.seat < 0:
            return
        seq = msg.get('seq')
        if not isinstance(seq, int) or isinstance(seq, bool) or seq < 0:
            return
        if 'survivors' in msg:
            survivors = msg['survivors']
            if (isinstance(survivors, list) and len(survivors) <= 8
                    and all(isinstance(s, int) and 0 <= s < 8 for s in survivors)):
                await self.record_state(seq, None, sorted(set(survivors)))
            return
        turn = msg.get('turn')
        if turn is None or (isinstance(turn, int) and not isinstance(turn, bool) and -1 <= turn < 8):
            await self.record_state(seq, turn, None)

    async def on_takeover(self, msg):
        if not await self.is_host():
            return
        seat = msg.get('seat')
        if not isinstance(seat, int) or not 0 <= seat < 8:
            return
        ev = await self.append_event(seat, 'takeover', 0)
        if ev:
            await self.channel_layer.group_send(self.group, {'type': 'relay', 'msg': dict(type='event', **ev)})

    async def on_settings(self, msg):
        changes = {k: msg[k] for k in ('public_watch', 'watch_chat') if isinstance(msg.get(k), bool)}
        if not changes or not await self.is_host():
            return
        settings = await self.change_settings(changes)
        await self.channel_layer.group_send(self.group, dict(type='game.settings', **settings))

    async def relay(self, event):
        await self.send_json(event['msg'])

    async def game_settings(self, event):
        await self.send_json({'type': 'settings', 'public_watch': event['public_watch'],
                              'watch_chat': event['watch_chat']})

    async def game_cancelled(self, event):
        await self.close(code=CANCEL_CLOSE)

    async def broadcast_seats(self):
        seats = await self.seats()
        await self.channel_layer.group_send(self.group, {'type': 'relay', 'msg': {'type': 'seats', 'seats': seats}})

    # ---- database helpers ---------------------------------------------------
    @database_sync_to_async
    def load_player(self, token, user):
        players = Player.objects.select_related('game', 'user').filter(game__code=self.code)
        player = players.filter(token=token).first() if token else None
        if player is None and user is not None and user.is_authenticated:
            player = players.filter(user=user).first()
        return player

    @database_sync_to_async
    def set_connected(self, value):
        Player.objects.filter(pk=self.player.pk).update(connected=value)

    @database_sync_to_async
    def seats(self):
        return Game.objects.get(pk=self.game_id).seat_list()

    @database_sync_to_async
    def is_host(self):
        game = Game.objects.get(pk=self.game_id)
        host = game.host()
        return host is not None and host.pk == self.player.pk

    @database_sync_to_async
    def change_settings(self, changes):
        Game.objects.filter(pk=self.game_id).update(**changes)
        game = Game.objects.get(pk=self.game_id)
        return {'public_watch': game.public_watch, 'watch_chat': game.watch_chat}

    @database_sync_to_async
    def init_message(self):
        game = Game.objects.get(pk=self.game_id)
        msg = self.game_state(game)
        msg.update(code=game.code, you={'seat': self.player.seat, 'name': self.player.name})
        return msg

    @staticmethod
    def game_state(game):
        host = game.host()
        return {
            'type': 'init',
            'seed': game.seed,
            'status': game.status,
            'public_watch': game.public_watch,
            'watch_chat': game.watch_chat,
            'host_seat': host.seat if host else 0,
            'seats': game.seat_list(),
            'human_seats': game.human_seats,
            'events': [e.as_dict() for e in game.events.all()],
        }

    @database_sync_to_async
    def start_game(self):
        with transaction.atomic():
            game = Game.objects.select_for_update().get(pk=self.game_id)
            host = game.host()
            if game.status != Game.LOBBY or not host or host.pk != self.player.pk:
                return None
            game.status = Game.PLAYING
            game.human_seats = sorted(p.seat for p in game.players.all() if p.seat >= 0)
            game.last_move = timezone.now()
            game.save()
            return {'seed': game.seed, 'human_seats': game.human_seats}

    @database_sync_to_async
    def append_event(self, seat, kind, code):
        for _ in range(5):
            try:
                with transaction.atomic():
                    game = Game.objects.select_for_update().get(pk=self.game_id)
                    # finished games still take keys: the result screen waits
                    # for one, and a wrongly reported end must not freeze play
                    if game.status not in (Game.PLAYING, Game.FINISHED):
                        return None
                    seq = (game.events.aggregate(m=Max('seq'))['m'] or 0) + 1
                    ev = Event.objects.create(game=game, seq=seq, seat=seat, kind=kind, code=code)
                    Game.objects.filter(pk=game.pk).update(last_move=timezone.now())
                    return ev.as_dict()
            except IntegrityError:
                continue
        return None

    @database_sync_to_async
    def record_state(self, seq, turn, survivors):
        """Store a browser's report of whose turn it is, or of the result.

        Every seated player's browser reports the same thing, so a report
        made at an earlier event than the stored one is stale and ignored.
        A finished game reopens if a later report shows play went on, which
        undoes a false or mistaken game-over report.
        """
        with transaction.atomic():
            game = Game.objects.select_for_update().get(pk=self.game_id)
            last = game.events.aggregate(m=Max('seq'))['m'] or 0
            if game.status in (Game.LOBBY, Game.CANCELLED) or seq > last or seq < game.turn_seq:
                return
            if survivors is not None:
                game.status, game.survivors, game.turn_seat = Game.FINISHED, survivors, None
            elif game.status == Game.FINISHED:
                if seq == game.turn_seq:
                    return    # the result screen waiting for a key
                game.status, game.survivors, game.turn_seat = Game.PLAYING, [], turn
            else:
                game.turn_seat = turn
            game.turn_seq = seq
            game.save(update_fields=['status', 'survivors', 'turn_seat', 'turn_seq'])


class WatchConsumer(GameConsumer):
    """Someone watching a public game: receives everything the players'
    browsers do, but has no seat and can only chat (while the host lets
    watchers chat). Never told the game code.
    """
    async def connect(self):
        self.player = None
        self.last_chat = None
        self.game_id = await self.public_game(self.scope['url_route']['kwargs']['watch_id'])
        if self.game_id is None:
            await self.close()
            return
        self.group = 'game_' + await self.game_code()
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        await self.send_json(await self.init_message())

    async def disconnect(self, close_code):
        if getattr(self, 'game_id', None) is not None:
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def receive_json(self, msg, **kwargs):
        if msg.get('type') != 'chat':
            return      # watchers can't play
        text = chat_text(msg)
        if not text:
            return
        now = time.monotonic()
        if self.last_chat is not None and now - self.last_chat < WATCHER_CHAT_GAP:
            return
        name, registered, refusal = await self.chat_name(msg.get('name'))
        if refusal:
            await self.send_json({'type': 'chat_refused', 'text': refusal})
            return
        self.last_chat = now
        await self.send_chat(name, registered, text, watcher=True)

    async def game_settings(self, event):
        if not event['public_watch']:
            await self.close(code=PRIVATE_CLOSE)    # the host made the game private
        else:
            await super().game_settings(event)

    @database_sync_to_async
    def chat_name(self, raw):
        """(name, registered, refusal): who a watcher chats as, or why not."""
        game = Game.objects.get(pk=self.game_id)
        if not game.watch_chat:
            return None, False, 'The host has turned off chat for watchers.'
        user = self.scope.get('user')
        if user is not None and user.is_authenticated:
            return user.username[:MAX_NAME], True, None
        name = ''.join(ch for ch in str(raw or '').strip() if ch.isprintable())[:MAX_NAME]
        if not name:
            return None, False, 'Type a name to chat.'
        if (User.objects.filter(username__iexact=name).exists()
                or game.players.filter(name__iexact=name).exists()):
            return None, False, 'That name is taken. Pick another.'
        return name, False, None

    @database_sync_to_async
    def public_game(self, watch_id):
        return (Game.objects.filter(watch_id=watch_id, public_watch=True).exclude(status=Game.CANCELLED)
                .values_list('pk', flat=True).first())

    @database_sync_to_async
    def game_code(self):
        return Game.objects.get(pk=self.game_id).code

    @database_sync_to_async
    def init_message(self):
        msg = self.game_state(Game.objects.get(pk=self.game_id))
        msg['you'] = {'seat': -1, 'name': ''}
        return msg


def chat_text(msg):
    return str(msg.get('text', ''))[:200].strip()
