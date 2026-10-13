import random
import secrets
import string

from django.db import models

MAX_SEATS = 8


def new_code():
    alphabet = string.ascii_uppercase.replace('O', '').replace('I', '')
    while True:
        code = ''.join(random.choice(alphabet) for _ in range(5))
        if not Game.objects.filter(code=code).exists():
            return code


def new_seed():
    return secrets.randbits(31)


class Game(models.Model):
    LOBBY, PLAYING = 'lobby', 'playing'
    code = models.CharField(max_length=8, unique=True, default=new_code)
    seed = models.BigIntegerField(default=new_seed)
    status = models.CharField(max_length=10, default=LOBBY)
    # seats occupied by humans when the game started (frozen for determinism)
    human_seats = models.JSONField(default=list, blank=True)
    created = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.code

    def host(self):
        return self.players.order_by('seat').first()

    def seat_list(self):
        return [{'seat': p.seat, 'name': p.name, 'connected': p.connected}
                for p in self.players.order_by('seat')]


class Player(models.Model):
    game = models.ForeignKey(Game, related_name='players', on_delete=models.CASCADE)
    seat = models.IntegerField()          # 0-7, or -1 for a spectator
    name = models.CharField(max_length=20)
    token = models.CharField(max_length=40, default=secrets.token_hex, unique=True)
    connected = models.BooleanField(default=False)

    class Meta:
        ordering = ['seat']

    def __str__(self):
        return '%s/%s' % (self.game.code, self.name)


class Event(models.Model):
    """One entry of a game's ordered input log (key presses, seat takeovers)."""
    game = models.ForeignKey(Game, related_name='events', on_delete=models.CASCADE)
    seq = models.IntegerField()
    seat = models.IntegerField()
    kind = models.CharField(max_length=10)    # 'down', 'up', 'takeover'
    code = models.IntegerField(default=0)

    class Meta:
        ordering = ['seq']
        unique_together = [('game', 'seq')]

    def as_dict(self):
        return {'seq': self.seq, 'seat': self.seat, 'kind': self.kind, 'code': self.code}
