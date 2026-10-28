"""Legacy ownership identifiers are accepted only inside the existing strict workspace boundary."""
BEHAVIOR_PREFIXES = ('langcontour-behavior-', 'vis4agent-behavior-')


def behavior_marker(name):
    for prefix in BEHAVIOR_PREFIXES:
        if name.startswith(prefix):
            return '.' + prefix.removesuffix('-behavior-') + '-owner.json'
    raise ValueError('Unrecognized behavior workspace name')
