"""ASGI entry point: HTTP via Django, WebSockets via Channels (served by Daphne)."""
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'chaos_site.settings')
django_asgi_app = get_asgi_application()

from channels.auth import AuthMiddlewareStack  # noqa: E402
from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402

from django.conf import settings  # noqa: E402
from django.contrib.staticfiles.handlers import ASGIStaticFilesHandler  # noqa: E402
from django.contrib.staticfiles.storage import staticfiles_storage  # noqa: E402
from django.views.static import serve  # noqa: E402

import game.routing  # noqa: E402


class StaticFilesHandler(ASGIStaticFilesHandler):
    """Daphne serves the static files itself (JS and CSS).

    In debug mode they come straight from the apps' static folders, and
    browsers must revalidate them on every use. Otherwise
    they come from STATIC_ROOT, where collectstatic wrote the hashed copies the
    pages link to. A hashed name changes whenever the file does, so browsers
    may cache those for a year.
    """

    def serve(self, request):
        if settings.DEBUG:
            # plain names: make browsers check for a newer copy every time,
            # or a cached old module can run against a newer one
            response = super().serve(request)
            response['Cache-Control'] = 'no-cache'
            return response
        name = request.path.removeprefix(self.base_url.path)
        response = serve(request, name, document_root=settings.STATIC_ROOT)
        if name in hashed_names:
            response['Cache-Control'] = 'public, max-age=31536000, immutable'
        return response


hashed_names = set(getattr(staticfiles_storage, 'hashed_files', {}).values())

# A single `daphne chaos_site.asgi:application` process runs everything.
application = ProtocolTypeRouter({
    'http': StaticFilesHandler(django_asgi_app),
    'websocket': AllowedHostsOriginValidator(
        AuthMiddlewareStack(URLRouter(game.routing.websocket_urlpatterns))
    ),
})
