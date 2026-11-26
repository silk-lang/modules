#!/usr/bin/env python3
"""Builds the "Can I use" page's data.

    python3 docs/caniuse/sync.py            # from features.json and support/*.json
    python3 docs/caniuse/sync.py --fetch    # first take the feature list from caniuse again
    python3 docs/caniuse/sync.py --fetch data-2.0.json    # the same, from a downloaded copy

The feature list (features.json) is caniuse's, from https://github.com/Fyrd/caniuse
(fulldata-json/data-2.0.json), CC BY 4.0: which features there are, what they are called and
which browsers have them. What Silk UI does with each one is ours, in support/*.json:

    {"id": "flexbox", "support": "y", "note": "", "probes": [{"sheet": ".sample { ... }"}]}

`support` is "y" (works), "a" (partly: the note says what is missing), "n" (not yet) or
"x" (does not apply to an app that is not a web page). A probe is a stylesheet that must change
how the test fixture lays out or paints: the tree's test suite adopts each one, so a "y" or "a"
that stops being true fails there. `missing` probes are the reverse, for "a" and "n": sheets
that change nothing today, which fail the day they start to work, so the page is corrected.
The fixture is in modules/tree/tests/src/css_coverage.silk: a root (class `root`) holding a
leading box (`lead`), the target (`sample`, with a text and a 20px box, `inner`, inside) and a
box after it (`after`). `root`, `lead` and `setup` are inline styles for those nodes.

areas.json says which file answers which feature. Each area has its own generated files, so
two people answering different areas never touch the same one. This writes:

    docs/src/caniuse_data.silk                         the feature list
    docs/src/caniuse_<area>.silk                       an area's answers, for the page
    docs/src/caniuse_answers.silk                      which module has which area
    modules/tree/tests/src/caniuse_probes_<area>.silk  an area's probes, for the tests
    modules/tree/tests/src/caniuse_probes.silk         which module has which area
"""
import json
import pathlib
import sys
import urllib.request

here = pathlib.Path(__file__).parent
root = here.parent.parent
SOURCE = "https://raw.githubusercontent.com/Fyrd/caniuse/main/fulldata-json/data-2.0.json"
# The caniuse categories that are about what Silk UI draws or runs.
GROUPS = {"CSS": "CSS", "CSS2": "CSS", "CSS3": "CSS", "SVG": "SVG", "JS": "JavaScript", "JS API": "JavaScript APIs"}
BROWSERS = ["chrome", "firefox", "safari"]


def since(stats):
    """The first version from which every later one has the feature, or "" when none does."""
    first = ""
    for version, flag in stats.items():
        if flag.startswith("y"):
            if not first:
                first = version
        else:
            first = ""
    return first


def fetch(copy):
    if copy:
        data = json.loads(pathlib.Path(copy).read_text())
    else:
        with urllib.request.urlopen(SOURCE) as response:
            data = json.load(response)
    features = []
    for key, entry in sorted(data["data"].items()):
        groups = [GROUPS[c] for c in entry["categories"] if c in GROUPS]
        if not groups:
            continue
        features.append({
            "id": key,
            "title": entry["title"],
            "description": entry["description"],
            "spec": entry["spec"],
            "group": groups[0],
            "browsers": {b: since(entry["stats"][b]) for b in BROWSERS},
            "usage": entry["usage_perc_y"],
        })
    (here / "features.json").write_text(
        json.dumps({"source": SOURCE, "updated": data["updated"], "features": features}, indent=1) + "\n")


def literal(text):
    return '"' + " ".join(text.split()).replace("\\", "\\\\").replace('"', '\\"') + '"'


def bytes_literal(text):
    return "b" + literal(text)


HEADER = "//! Written by docs/caniuse/sync.py from docs/caniuse; edit the files there, not this.\n"
# The areas whose probes are stylesheets for the tree's fixture.
TREE_AREAS = ["css-cascade", "css-layout", "css-text", "css-paint", "svg"]


def module(area):
    return area.replace("-", "_")


def main():
    if "--fetch" in sys.argv:
        at = sys.argv.index("--fetch") + 1
        fetch(sys.argv[at] if at < len(sys.argv) else "")
    catalog = json.loads((here / "features.json").read_text())
    # Silk UI's own APIs that caniuse has no feature for, in features.json's shape plus a `link`.
    catalog["features"] += json.loads((here / "silk.json").read_text())
    areas = json.loads((here / "areas.json").read_text())
    where = {}
    for area, ids in areas.items():
        for key in ids:
            if key in where:
                sys.exit(f"areas.json: {key} is in {where[key]} and {area}")
            where[key] = area
    for feature in catalog["features"]:
        if feature["id"] not in where:
            sys.exit(f"areas.json: {feature['id']} is in no area")

    support = {}
    for area in areas:
        path = here / "support" / f"{area}.json"
        for entry in json.loads(path.read_text()):
            key = entry["id"]
            if where.get(key) != area:
                sys.exit(f"{path.name}: {key} belongs to {where.get(key, 'no area')} (areas.json)")
            if key in support:
                sys.exit(f"{path.name}: {key} is answered twice")
            if entry["support"] not in ("y", "a", "n", "x"):
                sys.exit(f"{path.name}: {key} has support {entry['support']!r}")
            if entry["support"] in ("y", "a") and not entry.get("probes") and not entry.get("evidence"):
                sys.exit(f"{path.name}: {key} claims support with no probe and no evidence")
            if entry["support"] in ("a", "n", "x") and not entry.get("note"):
                sys.exit(f"{path.name}: {key} needs a note saying what is missing")
            if area not in TREE_AREAS and (entry.get("probes") or entry.get("missing")):
                sys.exit(f"{path.name}: {key} has stylesheet probes, which only the tree's areas run")
            support[key] = entry

    rows = []
    for feature in catalog["features"]:
        rows.append(
            "    Feature { "
            f"id: {literal(feature['id'])}, title: {literal(feature['title'])}, "
            f"about: {literal(feature['description'])}, link: {literal(feature.get('link', 'https://caniuse.com/' + feature['id']))}, "
            f"group: {literal(feature['group'])}, area: {literal(where[feature['id']])}, "
            f"chrome: {literal(feature['browsers']['chrome'])}, "
            f"firefox: {literal(feature['browsers']['firefox'])}, "
            f"safari: {literal(feature['browsers']['safari'])} }},"
        )
    (root / "docs/src/caniuse_data.silk").write_text(
        HEADER +
        "//! The features caniuse lists (https://github.com/Fyrd/caniuse, CC BY 4.0): what each is\n"
        "//! called and which browsers have it.\n"
        "import silk.core.ownership { Copy }\n\n"
        "pub struct Feature {\n"
        "  pub id: string<'static>,\n  pub title: string<'static>,\n  pub about: string<'static>,\n"
        "  /// The feature's page on caniuse.com.\n  pub link: string<'static>,\n"
        "  pub group: string<'static>,\n"
        "  /// Which file of docs/caniuse/support answers it.\n  pub area: string<'static>,\n"
        "  /// The first version of each browser that has it for good, or nothing.\n"
        "  pub chrome: string<'static>,\n  pub firefox: string<'static>,\n  pub safari: string<'static>,\n"
        "}\n\nimpl Copy for Feature {}\n\n"
        "/// What Silk UI does with a feature.\n"
        "pub struct Answer {\n"
        "  /// \"y\" works, \"a\" partly, \"n\" not yet, \"x\" does not apply, \"u\" not checked yet.\n"
        "  pub support: string<'static>,\n  pub note: string<'static>,\n}\n\nimpl Copy for Answer {}\n\n"
        f"pub const COUNT: usize = {len(rows)}\n\n"
        "pub fn features() -> [Feature; COUNT] {\n  return [\n" + "\n".join(rows) + "\n  ]\n}\n"
    )

    for area, ids in areas.items():
        arms = []
        for key in ids:
            if key in support:
                entry = support[key]
                arms.append(
                    f"  if id == {literal(key)} {{\n    return Answer {{ support: {literal(entry['support'])}, "
                    f"note: {literal(entry.get('note', ''))} }}\n  }}\n")
        (root / f"docs/src/caniuse_{module(area)}.silk").write_text(
            HEADER + f"//! The answers of docs/caniuse/support/{area}.json.\n"
            "import caniuse_data { Answer }\n\n"
            "pub fn answer(id: string) -> Answer {\n" + "".join(arms)
            + ("  drop id\n" if not arms else "")
            + "  return Answer { support: \"u\", note: \"\" }\n}\n")
    (root / "docs/src/caniuse_answers.silk").write_text(
        HEADER + "//! The answer to a feature, from its area's module.\n"
        "import caniuse_data { Answer, Feature }\n"
        + "".join(f"import caniuse_{module(a)}\n" for a in areas)
        + "\npub fn answer(feature: Feature) -> Answer {\n"
        + "".join(f"  if feature.area == {literal(a)} {{\n    return caniuse_{module(a)}.answer(feature.id)\n  }}\n" for a in areas)
        + "  return Answer { support: \"u\", note: \"\" }\n}\n")

    total = 0
    for area in TREE_AREAS:
        probes = []
        for key in areas[area]:
            entry = support.get(key, {})
            for works, name in ((True, "probes"), (False, "missing")):
                for probe in entry.get(name, []):
                    probes.append(
                        "    Probe { "
                        f"feature: {literal(key)}, works: {'true' if works else 'false'}, "
                        f"root: {bytes_literal(probe.get('root', ''))}, lead: {bytes_literal(probe.get('lead', ''))}, "
                        f"setup: {bytes_literal(probe.get('setup', ''))}, base: {literal(probe.get('base', ''))}, "
                        f"sheet: {literal(probe['sheet'])} }},"
                    )
        total += len(probes)
        body = "  drop at\n  return Option<Probe>.None\n"
        if probes:
            body = (
                "  let table = [\n" + "\n".join(probes) + "\n  ]\n"
                "  if at < table.length {\n    return Option<Probe>.some(table[at])\n  }\n"
                "  return Option<Probe>.None\n")
        (root / f"modules/tree/tests/src/caniuse_probes_{module(area)}.silk").write_text(
            HEADER + f"//! The probes of docs/caniuse/support/{area}.json.\n"
            "import caniuse_probe { Probe }\nimport silk.core.option { Option }\n\n"
            "/// Probe `at`, none past the last.\n"
            "pub fn probe(at: usize) -> Option<Probe> {\n" + body + "}\n")
    (root / "modules/tree/tests/src/caniuse_probes.silk").write_text(
        HEADER + "//! Every area's probes, one area after another.\n"
        "import caniuse_probe { Probe }\nimport silk.core.option { Option }\n"
        + "".join(f"import caniuse_probes_{module(a)}\n" for a in TREE_AREAS)
        + f"\npub const AREAS: usize = {len(TREE_AREAS)}\n\n"
        "/// Probe `at` of area `area`, none past the last.\n"
        "pub fn probe(area: usize, at: usize) -> Option<Probe> {\n"
        + "".join(f"  if area == {n} {{\n    return caniuse_probes_{module(a)}.probe(at)\n  }}\n" for n, a in enumerate(TREE_AREAS))
        + "  return Option<Probe>.None\n}\n")

    def said(key):
        return support.get(key, {}).get("support", "u")
    for area, ids in areas.items():
        counts = {s: sum(1 for key in ids if said(key) == s) for s in "yanxu"}
        print(f"{area}: {len(ids)} features, {counts}")
    print(f"{total} probes")


main()
