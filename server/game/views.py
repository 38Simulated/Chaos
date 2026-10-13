from django.db import transaction
from django.http import Http404
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from .models import MAX_SEATS, Game, Player


def _session_players(request):
    return request.session.setdefault('players', {})


def _clean_name(raw):
    name = ''.join(ch for ch in (raw or '').strip() if ch.isprintable())[:20]
    return name or 'Wizard'


def index(request):
    return render(request, 'game/index.html', {'error': request.GET.get('error')})


@require_POST
def create(request):
    with transaction.atomic():
        game = Game.objects.create()
        player = Player.objects.create(game=game, seat=0, name=_clean_name(request.POST.get('name')))
    _session_players(request)[game.code] = player.token
    request.session.modified = True
    return redirect('game', code=game.code)


@require_POST
def join(request):
    code = (request.POST.get('code') or '').strip().upper()
    game = Game.objects.filter(code=code).first()
    if not game:
        return redirect('/?error=No+game+with+that+code')
    tokens = _session_players(request)
    if tokens.get(code) and game.players.filter(token=tokens[code]).exists():
        return redirect('game', code=code)
    with transaction.atomic():
        taken = set(game.players.values_list('seat', flat=True))
        seat = -1
        if game.status == Game.LOBBY:
            seat = next((s for s in range(MAX_SEATS) if s not in taken), -1)
        player = Player.objects.create(game=game, seat=seat, name=_clean_name(request.POST.get('name')))
    tokens[code] = player.token
    request.session.modified = True
    return redirect('game', code=code)


def game_page(request, code):
    game = get_object_or_404(Game, code=code.upper())
    token = _session_players(request).get(game.code)
    player = game.players.filter(token=token).first() if token else None
    if not player:
        # not joined yet: show the join form pre-filled with the code
        return render(request, 'game/index.html', {'join_code': game.code})
    return render(request, 'game/play.html', {'game': game, 'player': player})
