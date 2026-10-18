"""Custom rules for a game, chosen on the custom game page.

A game's rules are stored with it and handed to every browser's engine (see
static/game/js/engine/rules.js), like the seed. Only rules that differ from
the original are stored, so an empty dict is the original game.
"""

TURNS = range(5, 100)
ABILITY = range(0, 4)
SPELLS = range(11, 21)
STATS = {'equal': 'the same random stats', 'max': 'the best stats', 'min': 'the worst stats'}
STATS_FOR = {'all': 'every wizard', 'human': 'human wizards', 'computer': 'computer wizards'}
SWITCHES = {
    'nextKey': ('next_key', 'N moves the cursor to the next piece that hasn\'t moved'),
    'ranges': ('ranges', 'Movement, shooting and spell ranges are shown on the board'),
    'turmoil': ('turmoil', 'Turmoil can be a starting spell'),
    'troll': ('troll', 'The Troll, left out of the original, is in the game'),
}


def _number(value, allowed):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n in allowed else None


def parse(data):
    """The rules from the custom game form (a QueryDict or dict). Fields left
    at "original", or invalid, are left out."""
    rules = {}
    turns = _number(data.get('turns'), TURNS)
    if turns is not None:
        rules['turns'] = turns
    for key, (field, _) in SWITCHES.items():
        if data.get(field):
            rules[key] = True
    ability = _number(data.get('ability'), ABILITY)
    if ability is not None:
        rules['ability'] = ability
    spells = _number(data.get('spells'), SPELLS)
    if spells is not None:
        rules['spells'] = spells
    if data.get('stats') in STATS:
        rules['stats'] = data['stats']
        rules['statsFor'] = data.get('stats_for') if data.get('stats_for') in STATS_FOR else 'all'
    return rules


def describe(rules):
    """The rules as short sentences for people in or watching the game."""
    lines = []
    if 'turns' in rules:
        lines.append(f'{rules["turns"]} turns')
    for key, (_, text) in SWITCHES.items():
        if rules.get(key):
            lines.append(text)
    if 'ability' in rules:
        lines.append(f'Every wizard has ability {rules["ability"]}')
    if 'spells' in rules:
        lines.append(f'Every wizard starts with {rules["spells"]} spells and Disbelieve')
    if 'stats' in rules:
        who = STATS_FOR.get(rules.get('statsFor'), STATS_FOR['all'])
        lines.append(f'{who[0].upper()}{who[1:]} get {STATS[rules["stats"]]}')
    return lines
