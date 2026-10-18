from datetime import timedelta

from asgiref.sync import async_to_sync, sync_to_async
from channels.testing import WebsocketCommunicator
from django.conf import settings
from django.contrib.auth.models import Group, User
from django.test import Client, TestCase, TransactionTestCase, override_settings
from django.utils import timezone

from chaos_site.asgi import application

from . import rules
from .models import Event, Game, Player


def create_game(client, name='Host'):
    client.post('/new/', {'name': name})
    return Game.objects.latest('created')


class AnonymousPlayTests(TestCase):
    def test_create_and_join_without_an_account(self):
        host, guest = Client(), Client()
        game = create_game(host)
        guest.post('/join/', {'name': 'Guest', 'code': game.code})
        self.assertEqual(list(game.players.values_list('seat', 'user')), [(0, None), (1, None)])
        self.assertTemplateUsed(host.get(f'/g/{game.code}/'), 'game/play.html')
        self.assertTemplateUsed(guest.get(f'/g/{game.code}/'), 'game/play.html')

    def test_spells_are_hidden_unless_chosen(self):
        client = Client()
        hidden = create_game(client)
        client.post('/new/', {'name': 'Host', 'show_spells': 'on'})
        shown = Game.objects.latest('created')
        self.assertEqual((hidden.show_spells, shown.show_spells), (False, True))
        self.assertContains(client.get(f'/g/{hidden.code}/'), 'showSpells: false')
        self.assertContains(client.get(f'/g/{shown.code}/'), 'showSpells: true')

    def test_another_browser_is_not_seated(self):
        game = create_game(Client())
        self.assertTemplateUsed(Client().get(f'/g/{game.code}/'), 'game/index.html')


def started_game(host_name='Host', guest_name='Guest', events=10):
    """A started two-player game with some key events; returns (game, host, guest)."""
    host, guest = Client(), Client()
    game = create_game(host, host_name)
    guest.post('/join/', {'name': guest_name, 'code': game.code})
    Game.objects.filter(pk=game.pk).update(status=Game.PLAYING, human_seats=[0, 1])
    Event.objects.bulk_create(Event(game=game, seq=i, seat=0, kind='down', code=0x31)
                              for i in range(1, events + 1))
    game.refresh_from_db()
    return game, host, guest


class GameListTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('merlin', password='wand-of-oak-42')
        self.client.force_login(self.user)

    def mine(self, game, seat):
        Player.objects.filter(game=game, seat=seat).update(user=self.user)

    def test_active_and_finished_lists(self):
        playing, _, _ = started_game()
        self.mine(playing, 1)
        Game.objects.filter(pk=playing.pk).update(turn_seat=1, turn_seq=10)
        finished, _, _ = started_game()
        self.mine(finished, 0)
        Game.objects.filter(pk=finished.pk).update(status=Game.FINISHED, survivors=[0])

        active = self.client.get('/')
        self.assertContains(active, playing.code)
        self.assertNotContains(active, finished.code)
        self.assertContains(active, 'Your turn')
        self.assertContains(active, '1 waiting for you')

        done = self.client.get('/?show=finished')
        self.assertContains(done, finished.code)
        self.assertNotContains(done, playing.code)
        self.assertContains(done, 'You won')

        both = self.client.get('/?show=all')
        self.assertContains(both, playing.code)
        self.assertContains(both, finished.code)

    def test_state_text(self):
        game, _, _ = started_game()
        host, guest = game.players.get(seat=0), game.players.get(seat=1)
        game.turn_seat, game.turn_seq = 0, 5
        self.assertEqual(game.state_for(guest), ('Waiting for Host', False))
        game.turn_seat = None
        self.assertEqual(game.state_for(host), ("Computer wizard's turn", False))
        game.turn_seat = Game.ANYONE
        self.assertEqual(game.state_for(guest), ('Waiting for anyone', True))
        game.status, game.survivors = Game.FINISHED, [0]
        self.assertEqual(game.state_for(guest), ('Won by Host', False))
        game.survivors = [0, 3]
        self.assertEqual(game.state_for(guest), ('Draw', False))


class CancelTests(TestCase):
    def test_only_the_host_cancels(self):
        game, host, guest = started_game()
        self.assertEqual(guest.post(f'/g/{game.code}/cancel/').status_code, 404)
        late = Client()
        late.post('/join/', {'name': 'Late', 'code': game.code})     # seat -1: not the host
        self.assertEqual(game.host().seat, 0)
        self.assertEqual(late.post(f'/g/{game.code}/cancel/').status_code, 404)
        game.refresh_from_db()
        self.assertEqual(game.status, Game.PLAYING)
        self.assertRedirects(host.post(f'/g/{game.code}/cancel/'), f'/g/{game.code}/', target_status_code=200)
        game.refresh_from_db()
        self.assertEqual(game.status, Game.CANCELLED)

    def test_finished_games_stay_finished(self):
        game, host, _ = started_game()
        Game.objects.filter(pk=game.pk).update(status=Game.FINISHED, survivors=[0])
        host.post(f'/g/{game.code}/cancel/')
        game.refresh_from_db()
        self.assertEqual(game.status, Game.FINISHED)

    def test_cancelled_game_page(self):
        game, host, guest = started_game()
        host.post(f'/g/{game.code}/cancel/')
        page = host.get(f'/g/{game.code}/')
        self.assertTemplateUsed(page, 'game/cancelled.html')
        self.assertContains(page, f'/g/{game.code}/delete/')
        page = guest.get(f'/g/{game.code}/')
        self.assertTemplateUsed(page, 'game/cancelled.html')
        self.assertNotContains(page, f'/g/{game.code}/delete/')
        self.assertEqual(Client().get(f'/g/{game.code}/').status_code, 404)
        self.assertRedirects(Client().post('/join/', {'name': 'X', 'code': game.code}),
                             '/?error=That+game+was+cancelled')
        Game.objects.filter(pk=game.pk).update(public_watch=True)
        self.assertEqual(Client().get(f'/w/{game.watch_id}/').status_code, 404)

    def test_only_the_host_deletes_and_only_cancelled_games(self):
        game, host, guest = started_game()
        self.assertEqual(host.post(f'/g/{game.code}/delete/').status_code, 404)    # not cancelled
        host.post(f'/g/{game.code}/cancel/')
        self.assertEqual(guest.post(f'/g/{game.code}/delete/').status_code, 404)
        self.assertRedirects(host.post(f'/g/{game.code}/delete/'), '/', fetch_redirect_response=False)
        self.assertFalse(Game.objects.filter(pk=game.pk).exists())
        self.assertFalse(Event.objects.filter(game_id=game.pk).exists())

    def test_cancelled_list(self):
        user = User.objects.create_user('merlin', password='wand-of-oak-42')
        game, host, _ = started_game()
        Player.objects.filter(game=game, seat=0).update(user=user)
        self.client.force_login(user)
        self.assertContains(self.client.get('/'), f'/g/{game.code}/cancel/')
        self.client.post(f'/g/{game.code}/cancel/', {'next': '/?show=cancelled#games'})
        self.assertNotContains(self.client.get('/'), game.code)
        cancelled = self.client.get('/?show=cancelled')
        self.assertContains(cancelled, 'Cancelled by the host')
        self.assertContains(cancelled, f'/g/{game.code}/delete/')


class ReplayTests(TestCase):
    def finished(self, public):
        game, host, guest = started_game()
        Game.objects.filter(pk=game.pk).update(status=Game.FINISHED, survivors=[0], public_replay=public)
        return game, host, guest

    def test_replay_opens_only_after_the_game(self):
        game, host, _ = started_game()
        self.assertEqual(host.get(f'/g/{game.code}/replay/').status_code, 404)
        self.assertEqual(host.get(f'/g/{game.code}/replay.json').status_code, 404)

    def test_private_replay_is_for_the_players(self):
        game, host, guest = self.finished(public=False)
        self.assertTemplateUsed(host.get(f'/g/{game.code}/replay/'), 'game/replay.html')
        self.assertEqual(guest.get(f'/g/{game.code}/replay.json').status_code, 200)
        self.assertEqual(Client().get(f'/g/{game.code}/replay/').status_code, 404)
        self.assertEqual(Client().get(f'/g/{game.code}/replay.json').status_code, 404)

    def test_public_replay_is_for_anyone_with_the_link(self):
        game, _, _ = self.finished(public=True)
        data = Client().get(f'/g/{game.code}/replay.json').json()
        self.assertEqual((data['seed'], data['human_seats'], data['survivors']), (game.seed, [0, 1], [0]))
        self.assertEqual(len(data['events']), 10)
        self.assertEqual(data['players'], [{'seat': 0, 'name': 'Host', 'registered': False},
                                           {'seat': 1, 'name': 'Guest', 'registered': False}])

    def test_create_sets_the_replay_choice(self):
        client = Client()
        private = create_game(client)
        client.post('/new/', {'name': 'Host', 'public_replay': 'on'})
        public = Game.objects.latest('created')
        self.assertEqual((private.public_replay, public.public_replay), (False, True))


class AdminTests(TestCase):
    """Admins (the Admins group, given in the Django admin) see every game
    and can watch any replay."""
    def setUp(self):
        self.private = create_game(Client(), 'Morgana')
        Game.objects.filter(pk=self.private.pk).update(status=Game.FINISHED, survivors=[0])
        self.lobby = create_game(Client(), 'Gandalf')
        self.admin = User.objects.create_user('merlin', password='wand-of-oak-42')
        self.admin.groups.add(Group.objects.get(name='Admins'))
        self.client.force_login(self.admin)

    def test_admins_see_every_game(self):
        page = self.client.get('/games/')
        self.assertContains(page, self.private.code)
        self.assertContains(page, self.lobby.code)
        self.assertContains(self.client.get('/'), 'All games')
        found = self.client.get('/games/', {'q': 'morg'})
        self.assertContains(found, self.private.code)
        self.assertNotContains(found, self.lobby.code)
        self.assertNotContains(self.client.get('/games/', {'show': 'finished'}), self.lobby.code)

    def test_admins_can_watch_private_replays(self):
        self.assertTemplateUsed(self.client.get(f'/g/{self.private.code}/replay/'), 'game/replay.html')
        self.assertEqual(self.client.get(f'/g/{self.private.code}/replay.json').status_code, 200)

    def test_other_users_cannot(self):
        other = Client()
        other.force_login(User.objects.create_user('nimue', password='wand-of-oak-42'))
        for client in (other, Client()):
            self.assertEqual(client.get('/games/').status_code, 404)
            self.assertEqual(client.get(f'/g/{self.private.code}/replay/').status_code, 404)
        self.assertNotContains(other.get('/'), 'All games')

    def test_superusers_are_admins(self):
        boss = Client()
        boss.force_login(User.objects.create_superuser('boss', password='wand-of-oak-42'))
        self.assertContains(boss.get('/games/'), self.private.code)


class CustomRulesTests(TestCase):
    FORM = {'name': 'Host', 'custom': '1', 'turns': '30', 'next_key': 'on', 'ranges': 'on',
            'turmoil': 'on', 'troll': 'on', 'ability': '0', 'spells': '14', 'stats': 'max',
            'stats_for': 'computer'}

    def test_parse_keeps_only_valid_changes(self):
        self.assertEqual(rules.parse({'turns': '', 'ability': '', 'spells': '', 'stats': ''}), {})
        self.assertEqual(rules.parse(self.FORM), {
            'turns': 30, 'nextKey': True, 'ranges': True, 'turmoil': True, 'troll': True, 'ability': 0,
            'spells': 14, 'stats': 'max', 'statsFor': 'computer'})
        bad = {'turns': '4', 'ability': '4', 'spells': '21', 'stats': 'huge', 'stats_for': 'all'}
        self.assertEqual(rules.parse(bad), {})
        self.assertEqual(rules.parse({'turns': 'x', 'stats': 'equal', 'stats_for': 'nobody'}),
                         {'stats': 'equal', 'statsFor': 'all'})

    def test_normal_games_have_no_rules(self):
        client = Client()
        game = create_game(client)
        self.assertEqual(game.rules, {})
        page = client.get(f'/g/{game.code}/')
        self.assertNotContains(page, 'Custom rules')
        self.assertContains(page, '<script id="rules" type="application/json">{}</script>', html=True)

    def test_custom_game_keeps_its_rules_for_players_watchers_and_replays(self):
        self.assertContains(self.client.get('/new/custom/'), 'name="stats_for"')
        host = Client()
        host.post('/new/', dict(self.FORM, public_watch='on'))
        game = Game.objects.latest('created')
        self.assertEqual(game.rules['turns'], 30)
        for page in (host.get(f'/g/{game.code}/'), Client().get(f'/w/{game.watch_id}/')):
            self.assertContains(page, 'Custom rules')
            self.assertContains(page, '30 turns')
            self.assertContains(page, 'Computer wizards get the best stats')
            self.assertContains(page, '"nextKey": true')
        Game.objects.filter(pk=game.pk).update(status=Game.FINISHED)
        self.assertEqual(host.get(f'/g/{game.code}/replay.json').json()['rules'], game.rules)
        self.assertContains(host.get(f'/g/{game.code}/replay/'), 'Every wizard has ability 0')

    def test_taken_name_goes_back_to_the_custom_form(self):
        User.objects.create_user('merlin', password='wand-of-oak-42')
        page = self.client.post('/new/', dict(self.FORM, name='merlin'))
        self.assertTrue(page.url.startswith('/new/custom/?error='))


class AccountTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('merlin', password='wand-of-oak-42')

    def logged_in(self):
        client = Client()
        client.force_login(self.user)
        return client

    def test_registered_names_are_reserved(self):
        game = create_game(Client())
        for name in ('merlin', 'MERLIN', ' Merlin '):
            response = Client().post('/new/', {'name': name})
            self.assertEqual(response.status_code, 302)
            self.assertIn('error=', response.url)
            response = Client().post('/join/', {'name': name, 'code': game.code})
            self.assertTrue(response.url.startswith(f'/g/{game.code}/?error='))
        self.assertEqual(Game.objects.count(), 1)
        self.assertEqual(game.players.count(), 1)
        self.assertContains(Client().get(f'/g/{game.code}/?error=x'), 'x')

    def test_logged_in_players_use_their_username(self):
        client = self.logged_in()
        client.post('/new/', {'name': 'Morgana'})
        game = Game.objects.latest('created')
        player = game.players.get()
        self.assertEqual(player.name, 'merlin')
        self.assertTrue(player.registered)
        self.assertEqual(game.seat_list()[0]['registered'], True)

    def test_seats_claimed_on_login_keep_their_name_unregistered(self):
        client = Client()
        game = create_game(client, 'Gandalf')
        client.post('/accounts/login/', {'username': 'merlin', 'password': 'wand-of-oak-42'})
        player = game.players.get()
        self.assertEqual((player.user, player.name, player.registered), (self.user, 'Gandalf', False))

    def test_usernames_fit_a_player_name(self):
        response = Client().post('/accounts/signup/', {
            'username': 'x' * 21, 'password1': 'xk-29-quietly-Stone', 'password2': 'xk-29-quietly-Stone'})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(username='x' * 21).exists())

    def test_signup_with_a_taken_name_shows_an_error(self):
        response = Client().post('/accounts/signup/', {
            'username': 'Merlin', 'password1': 'xk-29-quietly-Stone', 'password2': 'xk-29-quietly-Stone'})
        self.assertContains(response, 'already exists')
        self.assertEqual(User.objects.count(), 1)

    def test_signup_logs_in(self):
        client = Client()
        response = client.post('/accounts/signup/', {
            'username': 'gandalf', 'password1': 'staff-of-ash-77', 'password2': 'staff-of-ash-77'})
        self.assertRedirects(response, '/')
        self.assertEqual(client.session['_auth_user_id'], str(User.objects.get(username='gandalf').pk))

    def test_login_and_logout(self):
        client = Client()
        response = client.post('/accounts/login/', {'username': 'merlin', 'password': 'wand-of-oak-42'})
        self.assertRedirects(response, '/')
        self.assertContains(client.get('/'), 'Logged in as')
        client.post('/accounts/logout/')
        self.assertNotIn('_auth_user_id', client.session)

    def test_seat_follows_the_account_to_another_browser(self):
        game = create_game(self.logged_in())
        self.assertEqual(game.players.get().user, self.user)
        other = self.logged_in()
        self.assertTemplateUsed(other.get(f'/g/{game.code}/'), 'game/play.html')
        self.assertIn(game.code, other.session['players'])

    def test_joining_again_keeps_the_same_seat(self):
        game = create_game(Client())
        first, second = self.logged_in(), self.logged_in()
        first.post('/join/', {'name': 'Merlin', 'code': game.code})
        second.post('/join/', {'name': 'Merlin', 'code': game.code})
        self.assertEqual(game.players.filter(user=self.user).count(), 1)

    def test_login_claims_seats_taken_anonymously(self):
        client = Client()
        game = create_game(client)
        client.post('/accounts/login/', {'username': 'merlin', 'password': 'wand-of-oak-42'})
        self.assertEqual(game.players.get().user, self.user)

    def test_lobby_lists_your_games(self):
        client = self.logged_in()
        game = create_game(client)
        self.assertContains(client.get('/'), game.code)

    def test_next_must_stay_on_this_site(self):
        response = Client().post('/accounts/signup/?next=https://evil.example/', {
            'username': 'morgana', 'password1': 'cauldron-99-x', 'password2': 'cauldron-99-x'})
        self.assertRedirects(response, '/')


@override_settings(CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}})
class WebSocketTests(TransactionTestCase):
    def connect(self, client, code):
        cookie = f'{settings.SESSION_COOKIE_NAME}={client.cookies[settings.SESSION_COOKIE_NAME].value}'
        return WebsocketCommunicator(application, f'/ws/game/{code}/', headers=[
            (b'cookie', cookie.encode()), (b'origin', b'http://testserver')])

    @async_to_sync
    async def check(self, communicator):
        connected, _ = await communicator.connect()
        message = await communicator.receive_json_from() if connected else None
        await communicator.disconnect()
        return message

    def test_account_seat_connects_without_a_session_token(self):
        user = User.objects.create_user('merlin', password='wand-of-oak-42')
        host = Client()
        host.force_login(user)
        game = create_game(host, 'Merlin')
        other = Client()
        other.force_login(user)  # a fresh session with no token for the game
        message = self.check(self.connect(other, game.code))
        self.assertEqual(message['you'], {'seat': 0, 'name': 'merlin'})    # the username

    def test_start_sends_seats_of_players_not_connected(self):
        host = Client()
        game = create_game(host, 'Host')
        Client().post('/join/', {'name': 'Guest', 'code': game.code})

        @async_to_sync
        async def start():
            communicator = self.connect(host, game.code)
            await communicator.connect()
            await communicator.receive_json_from()             # init
            await communicator.receive_json_from()             # seats on connect
            await communicator.send_json_to({'type': 'start'})
            messages = [await communicator.receive_json_from() for _ in range(2)]
            await communicator.disconnect()
            return messages

        seats, started = start()
        self.assertEqual(seats['type'], 'seats')
        self.assertEqual([s['name'] for s in seats['seats']], ['Host', 'Guest'])
        self.assertEqual((started['type'], started['human_seats']), ('start', [0, 1]))

    def report(self, client, code, *messages):
        """Send messages and wait until the consumer has handled them."""
        @async_to_sync
        async def run():
            communicator = self.connect(client, code)
            await communicator.connect()
            for message in messages:
                await communicator.send_json_to(message)
            await communicator.send_json_to({'type': 'chat', 'text': 'done'})
            while (await communicator.receive_json_from())['type'] != 'chat':
                pass
            await communicator.disconnect()
        run()

    def turn(self, game):
        game.refresh_from_db()
        return game.status, game.turn_seat, game.turn_seq

    def test_turn_reports_keep_the_latest(self):
        game, host, guest = started_game()
        self.report(guest, game.code, {'type': 'state', 'seq': 5, 'turn': 1})
        self.assertEqual(self.turn(game), (Game.PLAYING, 1, 5))
        self.report(host, game.code,
                    {'type': 'state', 'seq': 3, 'turn': 0},      # stale
                    {'type': 'state', 'seq': 11, 'turn': 0},     # past the log
                    {'type': 'state', 'seq': 5, 'turn': 'x'})    # malformed
        self.assertEqual(self.turn(game), (Game.PLAYING, 1, 5))
        self.report(host, game.code, {'type': 'state', 'seq': 5, 'turn': None})
        self.assertEqual(self.turn(game), (Game.PLAYING, None, 5))

    def test_spectators_do_not_report(self):
        game, _, _ = started_game()
        watcher = Client()
        watcher.post('/join/', {'name': 'Watcher', 'code': game.code})
        self.report(watcher, game.code, {'type': 'state', 'seq': 5, 'turn': 1})
        self.assertEqual(self.turn(game), (Game.PLAYING, None, 0))

    def test_game_over_and_reopening(self):
        game, host, guest = started_game()
        self.report(host, game.code,
                    {'type': 'state', 'seq': 10, 'survivors': [1]},
                    {'type': 'state', 'seq': 10, 'turn': -1})    # the result screen
        game.refresh_from_db()
        self.assertEqual((game.status, game.survivors, game.turn_seat), (Game.FINISHED, [1], None))
        # play went on after a wrong report: a later one reopens the game
        Event.objects.create(game=game, seq=11, seat=1, kind='down', code=0x31)
        self.report(guest, game.code, {'type': 'state', 'seq': 11, 'turn': 0})
        game.refresh_from_db()
        self.assertEqual((game.status, game.survivors, game.turn_seat), (Game.PLAYING, [], 0))

    def watch(self, game, client=None):
        headers = [(b'origin', b'http://testserver')]
        if client is not None:
            cookie = f'{settings.SESSION_COOKIE_NAME}={client.cookies[settings.SESSION_COOKIE_NAME].value}'
            headers.append((b'cookie', cookie.encode()))
        return WebsocketCommunicator(application, f'/ws/watch/{game.watch_id}/', headers=headers)

    def test_watchers_of_a_public_game_get_the_game_but_not_the_code(self):
        game, _, _ = started_game()
        self.assertIsNone(self.check(self.watch(game)))     # not public
        Game.objects.filter(pk=game.pk).update(public_watch=True)
        message = self.check(self.watch(game))
        self.assertEqual((message['type'], message['you']['seat'], len(message['events'])), ('init', -1, 10))
        self.assertNotIn('code', message)
        self.assertNotIn(game.code, str(message))

    def test_watchers_cannot_play_or_change_settings(self):
        game, host, _ = started_game()
        Game.objects.filter(pk=game.pk).update(public_watch=True)

        @async_to_sync
        async def run():
            watcher = self.watch(game)
            await watcher.connect()
            await watcher.receive_json_from()
            for msg in ({'type': 'key', 'kind': 'down', 'code': 0x31}, {'type': 'start'},
                        {'type': 'takeover', 'seat': 1},
                        {'type': 'settings', 'public_watch': False, 'watch_chat': False}):
                await watcher.send_json_to(msg)
            self.assertTrue(await watcher.receive_nothing())
            await watcher.disconnect()
        run()
        game.refresh_from_db()
        self.assertEqual((game.events.count(), game.public_watch, game.watch_chat), (10, True, True))

    async def next_of(self, communicator, kind):
        while True:
            msg = await communicator.receive_json_from()
            if msg['type'] == kind:
                return msg

    def test_watchers_chat_under_a_name_of_their_own(self):
        game, host, _ = started_game()
        Game.objects.filter(pk=game.pk).update(public_watch=True)
        User.objects.create_user('Merlin', password='wand-of-oak-42')

        @async_to_sync
        async def run():
            player = self.connect(host, game.code)
            await player.connect()
            watcher = self.watch(game)
            await watcher.connect()
            await watcher.receive_json_from()
            refusals = []
            for name in ('', 'merlin', 'GUEST'):     # none, registered, a player's
                await watcher.send_json_to({'type': 'chat', 'name': name, 'text': 'hi'})
                refusals.append((await self.next_of(watcher, 'chat_refused'))['text'])
            await watcher.send_json_to({'type': 'chat', 'name': 'Nimue', 'text': 'go on'})
            heard = await self.next_of(player, 'chat')
            await self.next_of(watcher, 'chat')     # its own copy
            await watcher.send_json_to({'type': 'chat', 'name': 'Nimue', 'text': 'too soon'})
            self.assertTrue(await watcher.receive_nothing(timeout=0.3))   # within a second: dropped
            await watcher.disconnect()
            await player.disconnect()
            return refusals, heard
        refusals, heard = run()
        self.assertEqual(refusals, ['Type a name to chat.'] + ['That name is taken. Pick another.'] * 2)
        self.assertEqual(heard, {'type': 'chat', 'name': 'Nimue', 'registered': False,
                                 'text': 'go on', 'watcher': True})

    def test_logged_in_watchers_chat_as_themselves(self):
        game, _, _ = started_game()
        Game.objects.filter(pk=game.pk).update(public_watch=True)
        viewer = Client()
        viewer.force_login(User.objects.create_user('Merlin', password='wand-of-oak-42'))

        @async_to_sync
        async def run():
            watcher = self.watch(game, viewer)
            await watcher.connect()
            await watcher.receive_json_from()
            await watcher.send_json_to({'type': 'chat', 'name': 'Host', 'text': 'hello'})
            heard = await self.next_of(watcher, 'chat')
            await watcher.disconnect()
            return heard
        heard = run()
        self.assertEqual((heard['name'], heard['registered'], heard['watcher']), ('Merlin', True, True))

    def test_host_turns_watcher_chat_off(self):
        game, host, guest = started_game()
        Game.objects.filter(pk=game.pk).update(public_watch=True)
        self.report(guest, game.code, {'type': 'settings', 'watch_chat': False})   # not the host
        game.refresh_from_db()
        self.assertTrue(game.watch_chat)

        @async_to_sync
        async def run():
            watcher = self.watch(game)
            await watcher.connect()
            await watcher.receive_json_from()
            communicator = self.connect(host, game.code)
            await communicator.connect()
            await communicator.send_json_to({'type': 'settings', 'watch_chat': False})
            told = await self.next_of(watcher, 'settings')
            await watcher.send_json_to({'type': 'chat', 'name': 'Nimue', 'text': 'hi'})
            refused = await self.next_of(watcher, 'chat_refused')
            await watcher.disconnect()
            await communicator.disconnect()
            return told, refused
        told, refused = run()
        self.assertEqual(told, {'type': 'settings', 'public_watch': True, 'watch_chat': False})
        self.assertEqual(refused['text'], 'The host has turned off chat for watchers.')
        game.refresh_from_db()
        self.assertEqual((game.public_watch, game.watch_chat), (True, False))

    def test_host_turns_public_watching_off(self):
        game, host, guest = started_game()
        Game.objects.filter(pk=game.pk).update(public_watch=True)
        self.report(guest, game.code, {'type': 'settings', 'public_watch': False})   # not the host
        game.refresh_from_db()
        self.assertTrue(game.public_watch)

        @async_to_sync
        async def run():
            watcher = self.watch(game)
            await watcher.connect()
            await watcher.receive_json_from()
            communicator = self.connect(host, game.code)
            await communicator.connect()
            await communicator.send_json_to({'type': 'settings', 'public_watch': False})
            while (await communicator.receive_json_from())['type'] != 'settings':
                pass
            closed = await watcher.receive_output()
            while closed['type'] != 'websocket.close':    # seats updates first
                closed = await watcher.receive_output()
            await communicator.disconnect()
            return closed
        self.assertEqual(run(), {'type': 'websocket.close', 'code': 4000})
        game.refresh_from_db()
        self.assertFalse(game.public_watch)

    def test_cancelling_disconnects_everyone(self):
        game, host, guest = started_game()
        Game.objects.filter(pk=game.pk).update(public_watch=True)

        async def closed(communicator):
            message = await communicator.receive_output()
            while message['type'] != 'websocket.close':
                message = await communicator.receive_output()
            return message['code']

        @async_to_sync
        async def run():
            player, watcher = self.connect(guest, game.code), self.watch(game)
            for communicator in (player, watcher):
                await communicator.connect()
            await sync_to_async(host.post)(f'/g/{game.code}/cancel/')
            return [await closed(player), await closed(watcher)]
        self.assertEqual(run(), [4001, 4001])

        @async_to_sync
        async def reconnect():
            communicator = self.connect(guest, game.code)
            await communicator.connect()
            return await closed(communicator)
        self.assertEqual(reconnect(), 4001)
        self.assertIsNone(self.check(self.watch(game)))

    def test_idle_games_leave_the_live_list_until_the_next_move(self):
        game, host, _ = started_game()
        Game.objects.filter(pk=game.pk).update(public_watch=True,
                                               last_move=timezone.now() - timedelta(minutes=11))
        self.assertNotContains(Client().get('/'), f'/w/{game.watch_id}/')
        self.report(host, game.code, {'type': 'key', 'kind': 'down', 'code': 0x31})
        self.assertContains(Client().get('/'), f'/w/{game.watch_id}/')

    def test_stranger_is_refused(self):
        game = create_game(Client())
        stranger = Client()
        stranger.get('/')
        stranger.session.save()
        stranger.cookies[settings.SESSION_COOKIE_NAME] = stranger.session.session_key
        self.assertIsNone(self.check(self.connect(stranger, game.code)))
        self.assertEqual(Player.objects.count(), 1)


class SearchEngineTests(TestCase):
    NOINDEX = '<meta name="robots" content="noindex">'

    def test_public_pages_are_described_and_canonical(self):
        for path in ('/', '/help/', '/help/mechanics/', '/privacy/'):
            page = self.client.get(path + '?show=all')
            self.assertContains(page, '<meta name="description"')
            self.assertContains(page, f'<link rel="canonical" href="http://testserver{path}">')
            self.assertContains(page, '<meta property="og:image" content="http://testserver/static/game/img/og.png">')
            self.assertNotContains(page, self.NOINDEX)

    def test_private_pages_are_not_indexed(self):
        game, host, guest = started_game()
        Game.objects.filter(pk=game.pk).update(public_watch=True)
        for client, path in ((host, f'/g/{game.code}/'), (Client(), f'/g/{game.code}/'),
                             (Client(), f'/w/{game.watch_id}/'), (Client(), '/accounts/login/'),
                             (Client(), '/accounts/signup/'), (Client(), '/?error=x'),
                             (Client(), '/new/custom/')):
            page = client.get(path)
            self.assertContains(page, self.NOINDEX, msg_prefix=path)
            self.assertNotContains(page, 'rel="canonical"', msg_prefix=path)

    def test_robots_and_sitemap(self):
        robots = self.client.get('/robots.txt')
        self.assertEqual(robots['Content-Type'], 'text/plain')
        for line in ('Disallow: /g/', 'Disallow: /w/', 'Disallow: /accounts/',
                     'Sitemap: http://testserver/sitemap.xml'):
            self.assertIn(line, robots.content.decode().splitlines())
        sitemap = self.client.get('/sitemap.xml').content.decode()
        for path in ('/', '/help/', '/help/mechanics/', '/privacy/'):
            self.assertIn(f'<loc>http://testserver{path}</loc>', sitemap)

    @override_settings(ALLOWED_HOSTS=['www.example.com', 'example.com'], CANONICAL_HOST='www.example.com',
                       SESSION_COOKIE_SECURE=True)
    def test_other_host_names_redirect_to_the_canonical_one(self):
        response = self.client.get('/help/?x=1', HTTP_HOST='example.com')
        self.assertEqual((response.status_code, response['Location']), (301, 'https://www.example.com/help/?x=1'))
        self.assertEqual(self.client.get('/help/', HTTP_HOST='www.example.com').status_code, 200)

    @override_settings(SESSION_COOKIE_SECURE=True)
    def test_addresses_are_https_behind_the_proxy(self):
        self.assertContains(self.client.get('/help/'), '<link rel="canonical" href="https://testserver/help/">')


class WatchTests(TestCase):
    """Public games: watched by their watch id, which never gives the code away."""
    def public_game(self, **fields):
        game, host, guest = started_game()
        Game.objects.filter(pk=game.pk).update(public_watch=True, last_move=timezone.now(), **fields)
        game.refresh_from_db()
        return game, host, guest

    def test_watch_page_is_for_public_games_only(self):
        game, _, _ = started_game()
        self.assertEqual(Client().get(f'/w/{game.watch_id}/').status_code, 404)
        self.assertEqual(Client().get('/w/no-such-game/').status_code, 404)
        Game.objects.filter(pk=game.pk).update(public_watch=True)
        page = Client().get(f'/w/{game.watch_id}/')
        self.assertTemplateUsed(page, 'game/play.html')
        self.assertContains(page, 'watching: true')
        self.assertNotContains(page, game.code)

    def test_players_following_the_watch_link_get_their_seat(self):
        game, host, _ = self.public_game()
        self.assertRedirects(host.get(f'/w/{game.watch_id}/'), f'/g/{game.code}/')

    def test_live_list_shows_public_games_being_played(self):
        public, _, _ = self.public_game(turn_seat=1, turn_seq=5)
        private, _, _ = started_game()
        lobby = create_game(Client())
        Game.objects.filter(pk=lobby.pk).update(public_watch=True)
        page = Client().get('/')
        self.assertContains(page, f'/w/{public.watch_id}/')
        self.assertContains(page, 'Waiting for Guest')
        for game in (public, private, lobby):
            self.assertNotContains(page, game.code)
        self.assertNotContains(page, f'/w/{private.watch_id}/')
        self.assertNotContains(page, f'/w/{lobby.watch_id}/')

    def test_watch_replay_needs_a_finished_public_game(self):
        game, _, _ = self.public_game()
        self.assertEqual(Client().get(f'/w/{game.watch_id}/replay/').status_code, 404)
        Game.objects.filter(pk=game.pk).update(status=Game.FINISHED, survivors=[0])
        page = Client().get(f'/w/{game.watch_id}/replay/')
        self.assertTemplateUsed(page, 'game/replay.html')
        self.assertNotContains(page, game.code)
        data = Client().get(f'/w/{game.watch_id}/replay.json')
        self.assertEqual(len(data.json()['events']), 10)
        self.assertNotContains(data, game.code)
        # a public game's replay is public by its code too
        self.assertEqual(Client().get(f'/g/{game.code}/replay.json').status_code, 200)
        Game.objects.filter(pk=game.pk).update(public_watch=False)
        self.assertEqual(Client().get(f'/w/{game.watch_id}/replay.json').status_code, 404)

    def test_create_sets_the_watch_choice(self):
        client = Client()
        private = create_game(client)
        client.post('/new/', {'name': 'Host', 'public_watch': 'on'})
        public = Game.objects.latest('created')
        self.assertEqual((private.public_watch, public.public_watch), (False, True))
        self.assertNotEqual(private.watch_id, public.watch_id)
