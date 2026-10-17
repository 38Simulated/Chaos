from django.contrib.auth.signals import user_logged_in
from django.dispatch import receiver

from .models import Player


@receiver(user_logged_in)
def claim_session_seats(sender, request, user, **kwargs):
    """Seats taken in this browser before logging in move to the account."""
    tokens = list((request.session.get('players') or {}).values())
    if tokens:
        Player.objects.filter(token__in=tokens, user=None).update(user=user)
