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
Server -> client:
  {"type": "init", ...}                   on connect: seats, seed, full log
  {"type": "seats", "seats": [...]}       lobby / connection changes
  {"type": "start", "seed", "human_seats"}
  {"type": "event", "seq", "seat", "kind", "code"}
  {"type": "chat", "name", "text"}
"""
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db import IntegrityError, transaction
from django.db.models import Max

from .models import Event, Game, Player

VALID_CODES = set(range(0x30, 0x3A)) | set(range(0x41, 0x5B)) | {0x0D, 0x20, 0x0C}


class GameConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.code = self.scope['url_route']['kwargs']['code'].upper()
        self.group = 'game_' + self.code
        session = self.scope.get('session') or {}
        token = (session.get('players') or {}).get(self.code)
        self.player = await self.load_player(token)
        if not self.player:
            await self.close()
            return
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
        elif t == 'chat':
            text = str(msg.get('text', ''))[:200].strip()
            if text:
                await self.channel_layer.group_send(self.group, {
                    'type': 'relay', 'msg': {'type': 'chat', 'name': self.player.name, 'text': text}})

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
            await self.channel_layer.group_send(self.group, {'type': 'relay', 'msg': dict(type='start', **started)})

    async def on_takeover(self, msg):
        if not await self.is_host():
            return
        seat = msg.get('seat')
        if not isinstance(seat, int) or not 0 <= seat < 8:
            return
        ev = await self.append_event(seat, 'takeover', 0)
        if ev:
            await self.channel_layer.group_send(self.group, {'type': 'relay', 'msg': dict(type='event', **ev)})

    async def relay(self, event):
        await self.send_json(event['msg'])

    async def broadcast_seats(self):
        seats = await self.seats()
        await self.channel_layer.group_send(self.group, {'type': 'relay', 'msg': {'type': 'seats', 'seats': seats}})

    # ---- database helpers ---------------------------------------------------
    @database_sync_to_async
    def load_player(self, token):
        if not token:
            return None
        return Player.objects.select_related('game').filter(token=token, game__code=self.code).first()

    @database_sync_to_async
    def set_connected(self, value):
        Player.objects.filter(pk=self.player.pk).update(connected=value)

    @database_sync_to_async
    def seats(self):
        return Game.objects.get(pk=self.player.game_id).seat_list()

    @database_sync_to_async
    def is_host(self):
        game = Game.objects.get(pk=self.player.game_id)
        host = game.host()
        return host is not None and host.pk == self.player.pk

    @database_sync_to_async
    def init_message(self):
        game = Game.objects.get(pk=self.player.game_id)
        host = game.host()
        return {
            'type': 'init',
            'code': game.code,
            'seed': game.seed,
            'status': game.status,
            'you': {'seat': self.player.seat, 'name': self.player.name},
            'host_seat': host.seat if host else 0,
            'seats': game.seat_list(),
            'human_seats': game.human_seats,
            'events': [e.as_dict() for e in game.events.all()],
        }

    @database_sync_to_async
    def start_game(self):
        with transaction.atomic():
            game = Game.objects.select_for_update().get(pk=self.player.game_id)
            host = game.host()
            if game.status != Game.LOBBY or not host or host.pk != self.player.pk:
                return None
            game.status = Game.PLAYING
            game.human_seats = sorted(p.seat for p in game.players.all() if p.seat >= 0)
            game.save()
            return {'seed': game.seed, 'human_seats': game.human_seats}

    @database_sync_to_async
    def append_event(self, seat, kind, code):
        for _ in range(5):
            try:
                with transaction.atomic():
                    game = Game.objects.select_for_update().get(pk=self.player.game_id)
                    if game.status != Game.PLAYING:
                        return None
                    seq = (game.events.aggregate(m=Max('seq'))['m'] or 0) + 1
                    ev = Event.objects.create(game=game, seq=seq, seat=seat, kind=kind, code=code)
                    return ev.as_dict()
            except IntegrityError:
                continue
        return None
