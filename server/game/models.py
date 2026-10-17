import random
import secrets
import string

from django.conf import settings
from django.db import models

from . import rules

MAX_SEATS = 8
MAX_NAME = 20     # player names, and usernames (players use theirs as their name)


def new_code():
    alphabet = string.ascii_uppercase.replace('O', '').replace('I', '')
    while True:
        code = ''.join(random.choice(alphabet) for _ in range(5))
        if not Game.objects.filter(code=code).exists():
            return code


def new_seed():
    return secrets.randbits(31)


def new_watch_id():
    # random, so a watch link cannot be turned into the game code (which
    # lets people join) or guessed
    return secrets.token_urlsafe(9)


class Game(models.Model):
    LOBBY, PLAYING, FINISHED = 'lobby', 'playing', 'finished'
    CANCELLED = 'cancelled'   # stopped by the host; only the host can delete it
    ANYONE = -1   # turn_seat: any player may press a key
    code = models.CharField(max_length=8, unique=True, default=new_code)
    seed = models.BigIntegerField(default=new_seed)
    status = models.CharField(max_length=10, default=LOBBY)
    # seats occupied by humans when the game started (frozen for determinism)
    human_seats = models.JSONField(default=list, blank=True)
    # False: while a wizard picks a spell, the other browsers cover the screen
    show_spells = models.BooleanField(default=True)
    # True: anyone with the link can watch the replay once the game is over;
    # False: only the people who were in the game
    public_replay = models.BooleanField(default=False)
    # True: anyone can watch the game live from its watch link, and it is
    # listed on the front page while it is played (the replay is public too)
    public_watch = models.BooleanField(default=False)
    # True: people watching from the watch link can use the chat; the host
    # can switch it during the game
    watch_chat = models.BooleanField(default=True)
    # the game's public name: watch links use it instead of the code
    watch_id = models.CharField(max_length=16, unique=True, default=new_watch_id)
    created = models.DateTimeField(auto_now_add=True)
    last_move = models.DateTimeField(null=True, blank=True)

    # Reported by the players' browsers, which run the game (the server does
    # not). turn_seat is the seat whose player must press a key, ANYONE, or
    # None while no person is needed (a computer wizard's turn). turn_seq is
    # the event the report was made at; older reports are ignored.
    turn_seat = models.IntegerField(null=True, blank=True)
    turn_seq = models.IntegerField(default=0)
    survivors = models.JSONField(default=list, blank=True)   # seats alive at game over
    # custom rules (game/rules.py), fixed when the game is created; {} is the original game
    rules = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return self.code

    def rule_list(self):
        return rules.describe(self.rules)

    def host(self):
        # the lowest seat: people who joined after the start watch from seat -1
        return self.players.filter(seat__gte=0).order_by('seat').first()

    def seat_name(self, seat):
        player = next((p for p in self.players.all() if p.seat == seat), None)
        return player.name if player else f'computer wizard {seat + 1}'

    def state_for(self, player=None):
        """How the game stands for this player, or for someone watching
        (player None): (text, is it their turn)."""
        seat = player.seat if player else None
        if self.status == Game.LOBBY:
            return 'In the lobby', False
        if self.status == Game.CANCELLED:
            return 'Cancelled by the host', False
        if self.status == Game.FINISHED:
            if len(self.survivors) == 1:
                winner = self.survivors[0]
                return ('You won' if winner == seat else f'Won by {self.seat_name(winner)}'), False
            return 'Draw', False
        if self.turn_seat == Game.ANYONE:
            return 'Waiting for anyone', seat is not None and seat >= 0
        if self.turn_seat is None:
            return ("Computer wizard's turn" if self.turn_seq else 'In progress'), False
        if self.turn_seat == seat:
            return 'Your turn', True
        return f'Waiting for {self.seat_name(self.turn_seat)}', False

    def seat_list(self):
        return [{'seat': p.seat, 'name': p.name, 'registered': p.registered, 'connected': p.connected}
                for p in self.players.select_related('user').order_by('seat')]


class Player(models.Model):
    game = models.ForeignKey(Game, related_name='players', on_delete=models.CASCADE)
    seat = models.IntegerField()          # 0-7, or -1 for a spectator
    name = models.CharField(max_length=MAX_NAME)
    token = models.CharField(max_length=64, default=secrets.token_hex, unique=True)
    # set when the player was logged in, so the seat follows the account
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                             related_name='players', on_delete=models.SET_NULL)
    connected = models.BooleanField(default=False)

    class Meta:
        ordering = ['seat']

    def __str__(self):
        return '%s/%s' % (self.game.code, self.name)

    @property
    def registered(self):
        """Played under the name of the account that owns the seat. A seat
        taken without an account keeps the name picked for it even after its
        browser logs in, so that name is not shown as registered."""
        return self.user_id is not None and self.name == self.user.username[:MAX_NAME]


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
