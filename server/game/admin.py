from django.contrib import admin

from .models import Event, Game, Player


class PlayerInline(admin.TabularInline):
    model = Player
    extra = 0


@admin.register(Game)
class GameAdmin(admin.ModelAdmin):
    list_display = ('code', 'status', 'created')
    inlines = [PlayerInline]


admin.site.register(Event)
