"""ASGI entry point: HTTP via Django, WebSockets via Channels (served by Daphne)."""
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'chaos_site.settings')
django_asgi_app = get_asgi_application()

from channels.auth import AuthMiddlewareStack  # noqa: E402
from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402

from django.contrib.staticfiles.handlers import ASGIStaticFilesHandler  # noqa: E402

import game.routing  # noqa: E402

# Daphne serves the static files itself (JS, CSS and the game image), so a
# single `daphne chaos_site.asgi:application` process runs everything.
application = ProtocolTypeRouter({
    'http': ASGIStaticFilesHandler(django_asgi_app),
    'websocket': AllowedHostsOriginValidator(
        AuthMiddlewareStack(URLRouter(game.routing.websocket_urlpatterns))
    ),
})
