from django.urls import path

from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('new/', views.create, name='create'),
    path('join/', views.join, name='join'),
    path('g/<str:code>/', views.game_page, name='game'),
]
