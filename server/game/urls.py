from django.contrib.auth import views as auth_views
from django.urls import path
from django.views.generic import TemplateView

from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('new/', views.create, name='create'),
    path('new/custom/', views.custom, name='custom'),
    path('join/', views.join, name='join'),
    path('games/', views.all_games, name='all_games'),
    path('g/<str:code>/', views.game_page, name='game'),
    path('g/<str:code>/cancel/', views.cancel, name='cancel'),
    path('g/<str:code>/delete/', views.delete, name='delete'),
    path('g/<str:code>/replay/', views.replay_page, name='replay'),
    path('g/<str:code>/replay.json', views.replay_data, name='replay_data'),
    # public games, by watch id; these never reveal the game code
    path('w/<str:watch_id>/', views.watch_page, name='watch'),
    path('w/<str:watch_id>/replay/', views.replay_page, name='watch_replay'),
    path('w/<str:watch_id>/replay.json', views.replay_data, name='watch_replay_data'),
    path('accounts/login/', auth_views.LoginView.as_view(redirect_authenticated_user=True), name='login'),
    path('accounts/logout/', auth_views.LogoutView.as_view(), name='logout'),
    path('accounts/signup/', views.signup, name='signup'),
    path('robots.txt', views.robots_txt, name='robots'),
    path('sitemap.xml', views.sitemap_xml, name='sitemap'),
    path('help/', TemplateView.as_view(template_name='game/help.html'), name='help'),
    path('help/mechanics/', TemplateView.as_view(template_name='game/mechanics.html'), name='mechanics'),
    path('privacy/', TemplateView.as_view(template_name='game/privacy.html'), name='privacy'),
]
