"""The checked-in time zone tables, read back from src/temporal_timezone_data.silk, and written
as a QuickJS `temporal/tzdata_generated.c`.

The C oracles compile QuickJS's pinned timezone.c against this file, so the C and native kernels
know the same zone names, aliases and regions (scripts/generate_timezones.py writes the Silk
side). The tables hold no rules: the engine reads those from `silk.time`.
"""
import re
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def tables(root=ROOT):
    source = (root / 'src/temporal_timezone_data.silk').read_text()

    def decode(body):
        return bytes(int(escape, 16) if escape else ord(char) for escape, char in re.findall(r'\\x([0-9a-f]{2})|(.)', body))

    def literal(function, name):
        return decode(re.search(r'pub fn ' + function + r'\(.*?let ' + name + r' = b"(.*?)"', source, re.S).group(1))

    def strings(function):
        offsets, data = literal(function, 'offsets'), literal(function, 'data')
        bounds = [struct.unpack_from('<H', offsets, at)[0] for at in range(0, len(offsets), 2)]
        return [data[bounds[i]:bounds[i + 1]].decode('ascii') for i in range(len(bounds) - 1)]

    def ints(function):
        data = literal(function, 'data')
        return [struct.unpack_from('<H', data, at)[0] for at in range(0, len(data), 2)]

    zones = strings('tzZoneName')
    # The checked-in tables hold names only. The C tables still need a transition list for each
    # zone, so each gets the one sentinel row, with offset zero.
    transitions = [[(-(1 << 63), 0)] for _ in zones]
    aliases = list(zip(strings('tzAliasName'), ints('tzAliasCanonicalId')))
    regions = list(zip(strings('tzRegionName'), strings('tzRegionZones')))
    return zones, transitions, aliases, strings('tzName'), regions


def c_string(text):
    return '"' + text.replace('\0', '\\000') + '"'


def c_source(root=ROOT):
    zones, transitions, aliases, names, regions = tables(root)
    out = ['/* Written by scripts/timezone_tables.py from the checked-in SilkJS tables. */', '#include "timezone.h"', '']
    for index, rows in enumerate(transitions):
        out.append(f'static const TZTransition tz_trans_{index}[] = {{')
        out += ['    { INT64_MIN, %d },' % offset if start == -(1 << 63) else '    { %dLL, %d },' % (start, offset) for start, offset in rows]
        out += ['};', '']
    out.append('const TZAlias ti_tz_aliases[] = {')
    out += [f'    {{ {c_string(alias)}, {target} }},' for alias, target in aliases]
    out += ['};', 'const int ti_tz_alias_count = countof(ti_tz_aliases);', '', 'const TZData ti_tz_zone_data[] = {']
    out += [f'    {{ {c_string(name)}, tz_trans_{index}, {len(transitions[index])} }},' for index, name in enumerate(zones)]
    out += ['};', 'const int ti_tz_zone_count = countof(ti_tz_zone_data);', '', 'const char * const ti_tz_names[] = {']
    out += [f'    {c_string(name)},' for name in names]
    out += ['};', 'const int ti_tz_name_count = countof(ti_tz_names);', '', 'const TiTzRegion ti_tz_region_tab[] = {']
    out += [f'    {{ {c_string(region)}, {c_string(members)} }},' for region, members in regions]
    out += ['};', 'const int ti_tz_region_count = countof(ti_tz_region_tab);', '']
    return '\n'.join(out)


def write_c(directory):
    """Writes `temporal/tzdata_generated.c` under `directory` and returns its path."""
    path = Path(directory) / 'temporal/tzdata_generated.c'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(c_source())
    return path
