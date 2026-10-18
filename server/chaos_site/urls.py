from django.conf import settings
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path('', include('game.urls')),
]
# the Django admin, only where DJANGO_ADMIN_PATH (settings.ADMIN_PATH) puts it
if settings.ADMIN_PATH:
    urlpatterns.append(path(settings.ADMIN_PATH, admin.site.urls))
