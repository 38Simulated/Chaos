from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django import forms
from django.contrib.auth import login
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils.http import url_has_allowed_host_and_scheme, urlencode
from django.views.decorators.http import require_POST

from . import rules
from .context_processors import site_origin
from .models import MAX_NAME, MAX_SEATS, Game, Player


def _session_players(request):
    return request.session.setdefault('players', {})


def _clean_name(raw):
    name = ''.join(ch for ch in (raw or '').strip() if ch.isprintable())[:MAX_NAME]
    return name or 'Wizard'


NAME_TAKEN = 'That name belongs to a registered player. Log in, or pick another name.'


def _player_name(request):
    """The name for a new seat, or None when it is a registered player's.

    Logged-in players always play under their username, so their name can
    be trusted; nobody else may use a username, in any letter case.
    """
    if _account(request):
        return request.user.username[:MAX_NAME]
    name = _clean_name(request.POST.get('name'))
    if User.objects.filter(username__iexact=name).exists():
        return None
    return name


class SignupForm(UserCreationForm):
    """Usernames are player names, so they keep to a player name's length."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        field = self.fields['username']
        field.max_length = MAX_NAME
        field.widget.attrs['maxlength'] = MAX_NAME
        field.help_text = f'Up to {MAX_NAME} characters: letters, digits and @/./+/-/_ only. You play under this name.'

    def clean_username(self):
        username = super().clean_username()     # None when the name is taken
        if username and len(username) > MAX_NAME:
            raise forms.ValidationError(f'Use at most {MAX_NAME} characters.')
        return username


def _account(request):
    return request.user if request.user.is_authenticated else None


def _find_player(request, game):
    """This browser's seat in the game: by session token, else by account.

    A seat found through the account is put into the session too, because the
    WebSocket looks players up the same way.
    """
    tokens = _session_players(request)
    token = tokens.get(game.code)
    player = game.players.filter(token=token).first() if token else None
    if player is None and _account(request):
        player = game.players.filter(user=request.user).first()
        if player:
            tokens[game.code] = player.token
            request.session.modified = True
    return player


def _next_url(request):
    url = request.POST.get('next') or request.GET.get('next') or ''
    if url_has_allowed_host_and_scheme(url, allowed_hosts={request.get_host()},
                                       require_https=request.is_secure()):
        return url
    return ''


GAME_FILTERS = {'active': 'Active', 'finished': 'Finished', 'cancelled': 'Cancelled', 'all': 'All'}


def _my_games(user, show):
    seats = user.players.select_related('game').prefetch_related('game__players')
    if show == 'active':
        seats = seats.exclude(game__status__in=[Game.FINISHED, Game.CANCELLED])
    elif show in ('finished', 'cancelled'):
        seats = seats.filter(game__status=show)
    seats = seats.order_by(F('game__last_move').desc(nulls_last=True), '-game__created')[:100]
    rows = []
    for p in seats:
        text, mine = p.game.state_for(p)
        seated = [q for q in p.game.players.all() if q.seat >= 0]
        host = min(seated, key=lambda q: q.seat) if seated else None
        rows.append({'player': p, 'game': p.game, 'state': text, 'your_turn': mine,
                     'is_host': host is not None and host.pk == p.pk,
                     'last': p.game.last_move or p.game.created})
    return rows


LIVE_GAME_IDLE = timedelta(minutes=10)   # public games with no move for longer drop off the list
                                        # until the next move


def _live_games():
    """Public games being played, most recently moved first."""
    games = (Game.objects.filter(public_watch=True, status=Game.PLAYING,
                                 last_move__gte=timezone.now() - LIVE_GAME_IDLE)
             .prefetch_related('players__user').order_by('-last_move')[:30])
    return [{'game': g, 'state': g.state_for()[0],
             'players': [p for p in g.players.all() if p.seat >= 0]} for g in games]


def index(request):
    context = {'error': request.GET.get('error'), 'live_games': _live_games()}
    if _account(request):
        show = request.GET.get('show')
        show = show if show in GAME_FILTERS else 'active'
        context.update(show=show, filters=GAME_FILTERS, my_games=_my_games(request.user, show))
        context['your_turn_count'] = sum(r['your_turn'] for r in _my_games(request.user, 'active'))
    return render(request, 'game/index.html', context)


def custom(request):
    """The form for a game with custom rules; it posts to create()."""
    return render(request, 'game/custom.html', {
        'error': request.GET.get('error'),
        'turns': rules.TURNS, 'abilities': rules.ABILITY, 'spell_counts': rules.SPELLS,
        'stats': rules.STATS, 'stats_for': rules.STATS_FOR})


@require_POST
def create(request):
    name = _player_name(request)
    if name is None:
        back = 'custom' if request.POST.get('custom') else 'index'
        return redirect(reverse(back) + '?' + urlencode({'error': NAME_TAKEN}))
    with transaction.atomic():
        game = Game.objects.create(show_spells=bool(request.POST.get('show_spells')),
                                   public_replay=bool(request.POST.get('public_replay')),
                                   public_watch=bool(request.POST.get('public_watch')),
                                   rules=rules.parse(request.POST))
        player = Player.objects.create(game=game, seat=0, name=name,
                                       user=_account(request))
    _session_players(request)[game.code] = player.token
    request.session.modified = True
    return redirect('game', code=game.code)


@require_POST
def join(request):
    code = (request.POST.get('code') or '').strip().upper()
    game = Game.objects.filter(code=code).first()
    if not game:
        return redirect('/?error=No+game+with+that+code')
    if _find_player(request, game):
        return redirect('game', code=code)
    if game.status == Game.CANCELLED:
        return redirect('/?error=That+game+was+cancelled')
    name = _player_name(request)
    if name is None:
        return redirect(reverse('game', args=[code]) + '?' + urlencode({'error': NAME_TAKEN}))
    with transaction.atomic():
        taken = set(game.players.values_list('seat', flat=True))
        seat = -1
        if game.status == Game.LOBBY:
            seat = next((s for s in range(MAX_SEATS) if s not in taken), -1)
        player = Player.objects.create(game=game, seat=seat, name=name,
                                       user=_account(request))
    _session_players(request)[code] = player.token
    request.session.modified = True
    return redirect('game', code=code)


def game_page(request, code):
    game = get_object_or_404(Game, code=code.upper())
    player = _find_player(request, game)
    if not player and game.status == Game.CANCELLED:
        raise Http404('That game was cancelled.')
    if not player:
        # not joined yet: show the join form pre-filled with the code
        return render(request, 'game/index.html', {'join_code': game.code, 'error': request.GET.get('error')})
    is_host = _is_host(game, player)
    if game.status == Game.CANCELLED:
        return render(request, 'game/cancelled.html', {'game': game, 'is_host': is_host})
    return render(request, 'game/play.html', {
        'game': game, 'player': player, 'is_host': is_host,
        'room': game.code, 'ws_path': f'/ws/game/{game.code}/'})


def _is_host(game, player):
    host = game.host()
    return player is not None and host is not None and host.pk == player.pk


def _hosted_game(request, code):
    """The game with this code, if this browser is its host; else 404."""
    game = get_object_or_404(Game, code=code.upper())
    if not _is_host(game, _find_player(request, game)):
        raise Http404('Only the host can do that.')
    return game


@require_POST
def cancel(request, code):
    """The host stops a game that has not finished. Everyone in it is
    disconnected, and it waits under Cancelled until the host deletes it."""
    game = _hosted_game(request, code)
    with transaction.atomic():
        game = Game.objects.select_for_update().get(pk=game.pk)
        if game.status in (Game.LOBBY, Game.PLAYING):
            game.status = Game.CANCELLED
            game.turn_seat = None
            game.save(update_fields=['status', 'turn_seat'])
    if game.status == Game.CANCELLED:
        async_to_sync(get_channel_layer().group_send)('game_' + game.code, {'type': 'game.cancelled'})
    return redirect(_next_url(request) or reverse('game', args=[game.code]))


@require_POST
def delete(request, code):
    """The host deletes a cancelled game, with its moves and seats."""
    game = _hosted_game(request, code)
    if game.status != Game.CANCELLED:
        raise Http404('Only cancelled games can be deleted.')
    game.delete()
    _session_players(request).pop(game.code, None)
    request.session.modified = True
    return redirect(_next_url(request) or 'index')


def watch_page(request, watch_id):
    """A public game, watched live. The page never shows the game code, so
    watching cannot be turned into joining."""
    game = get_object_or_404(Game.objects.exclude(status=Game.CANCELLED), watch_id=watch_id, public_watch=True)
    player = _find_player(request, game)
    if player:
        return redirect('game', code=game.code)
    return render(request, 'game/play.html', {
        'game': game, 'player': None, 'watching': True, 'ws_path': f'/ws/watch/{game.watch_id}/'})


def robots_txt(request):
    """Keep search engines to the public pages: games, watch links and
    account pages are no use in search results."""
    origin = site_origin(request)['site_origin']
    lines = ['User-agent: *', 'Disallow: /g/', 'Disallow: /w/', 'Disallow: /accounts/',
             '', f'Sitemap: {origin}{reverse("sitemap")}']
    return HttpResponse('\n'.join(lines) + '\n', content_type='text/plain')


SITEMAP_PAGES = ['index', 'help', 'mechanics', 'privacy']


def sitemap_xml(request):
    origin = site_origin(request)['site_origin']
    urls = ''.join(f'<url><loc>{origin}{reverse(name)}</loc></url>' for name in SITEMAP_PAGES)
    return HttpResponse('<?xml version="1.0" encoding="UTF-8"?>'
                        f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>',
                        content_type='application/xml')


def signup(request):
    if _account(request):
        return redirect('index')
    form = SignupForm(request.POST or None)
    if request.method == 'POST' and form.is_valid():
        login(request, form.save())
        return redirect(_next_url(request) or 'index')
    return render(request, 'registration/signup.html', {'form': form, 'next': _next_url(request)})


def _watchable(request, code=None, watch_id=None):
    """A finished game this browser may watch the replay of, or 404.

    By code: the players, or anyone when the replay or the game is public.
    By watch id: public games only (the watch link's replay).
    """
    if watch_id is not None:
        game = get_object_or_404(Game, watch_id=watch_id, public_watch=True)
    else:
        game = get_object_or_404(Game, code=code.upper())
        if not (game.public_replay or game.public_watch) and not _find_player(request, game):
            raise Http404('Only the players can watch this replay.')
    if game.status != Game.FINISHED:
        raise Http404('The replay opens when the game is over.')
    return game


def replay_page(request, code=None, watch_id=None):
    game = _watchable(request, code, watch_id)
    data_url = (reverse('watch_replay_data', args=[watch_id]) if watch_id is not None
                else reverse('replay_data', args=[game.code]))
    return render(request, 'game/replay.html', {
        'game': game, 'room': game.code if watch_id is None else None, 'data_url': data_url})


def replay_data(request, code=None, watch_id=None):
    game = _watchable(request, code, watch_id)
    host = game.host()
    return JsonResponse({
        'seed': game.seed,
        'host_seat': host.seat if host else 0,
        'human_seats': game.human_seats,
        'players': [{'seat': p.seat, 'name': p.name, 'registered': p.registered}
                    for p in game.players.select_related('user') if p.seat >= 0],
        'survivors': game.survivors,
        'rules': game.rules,
        'events': [e.as_dict() for e in game.events.all()],
    })
