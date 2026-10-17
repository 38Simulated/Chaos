from django.db import migrations, models

from game.models import new_watch_id


def fill_watch_ids(apps, schema_editor):
    Game = apps.get_model('game', 'Game')
    for row in Game.objects.filter(watch_id__isnull=True):
        row.watch_id = new_watch_id()
        row.save(update_fields=['watch_id'])


class Migration(migrations.Migration):

    dependencies = [
        ('game', '0006_game_public_replay'),
    ]

    operations = [
        migrations.AddField(
            model_name='game',
            name='public_watch',
            field=models.BooleanField(default=False),
        ),
        # existing games each need their own id, so add it empty, fill it,
        # then make it required and unique
        migrations.AddField(
            model_name='game',
            name='watch_id',
            field=models.CharField(max_length=16, null=True),
        ),
        migrations.RunPython(fill_watch_ids, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='game',
            name='watch_id',
            field=models.CharField(default=new_watch_id, max_length=16, unique=True),
        ),
    ]
