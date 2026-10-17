from django.conf import settings


def version(request):
    """The site's version and deployed commit, for the page footer."""
    return {'site_version': settings.VERSION, 'site_commit': settings.COMMIT}


def site_origin(request):
    """The site's address, for links that search engines and link previews
    need in full. Behind the HTTPS proxy, Daphne sees plain HTTP."""
    scheme = 'https' if settings.SESSION_COOKIE_SECURE else request.scheme
    return {'site_origin': f'{scheme}://{request.get_host()}'}
