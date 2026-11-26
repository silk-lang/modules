#!/usr/bin/env python3
"""Writes examples/src/core/plans_css.silk from the CSS files here.

A Silk library cannot embed files that are not Silk sources, so the example package carries
the sheets as string constants. Run this after editing plans.css or running build-tailwind.sh.
"""
import pathlib

here = pathlib.Path(__file__).parent


def literal(name):
    text = (here / name).read_text()
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


(here.parent / "examples/src/core/plans_css.silk").write_text(
    "//! The stylesheets of the plan pickers, as text: what a build compiles and embeds for\n"
    '//! `App.stylesheet("styles/plans.css")`. Written by docs/styles/sync.py from the CSS files\n'
    "//! in docs/styles; edit those, not this.\n\n"
    "/// `docs/styles/plans.css`, which `core/plans_sheet.silk` is written for.\n"
    f"pub const PLAIN: string = {literal('plans.css')}\n\n"
    "/// `docs/styles/plans.tailwind.css`, which Tailwind wrote for `core/plans_tailwind.silk`.\n"
    f"pub const TAILWIND: string = {literal('plans.tailwind.css')}\n\n"
    "/// `docs/styles/inbox.tailwind.css`, which Tailwind wrote for `core/inbox_tailwind.silk`.\n"
    f"pub const INBOX: string = {literal('inbox.tailwind.css')}\n"
)
