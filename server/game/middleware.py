from django.conf import settings
from django.http import HttpResponsePermanentRedirect


class CanonicalHostMiddleware:
    """Redirect requests for any other host name (say, the bare domain when
    the site is www.example.com) to CANONICAL_HOST, keeping the path, so the
    site has one address. WebSockets do not pass through here; pages only
    open them on the host they were served from."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        canonical = settings.CANONICAL_HOST
        if canonical and request.get_host() != canonical:
            scheme = 'https' if settings.SESSION_COOKIE_SECURE else request.scheme
            return HttpResponsePermanentRedirect(f'{scheme}://{canonical}{request.get_full_path()}')
        return self.get_response(request)
