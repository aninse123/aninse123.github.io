# Regenerates portal/m/crm-helpers.js (mobile app) from portal/search.html.
# Run after changing any copied function:  python tests/portal/gen_mobile_helpers.py
# tests/portal/mobile_parity_*.test.mjs fails until the two match again.
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "portal", "search.html")
OUT = os.path.join(ROOT, "portal", "m", "crm-helpers.js")
page = open(SRC, encoding="utf-8").read().replace("\r\n", "\n")


def balanced(i, open_ch, close_ch):
    d = 0
    j = page.index(open_ch, i)
    while True:
        c = page[j]
        if c == open_ch:
            d += 1
        elif c == close_ch:
            d -= 1
            if d == 0:
                return j
        j += 1


def lift_fn(name):
    m = re.search(r"^(async )?function " + re.escape(name) + r"\(", page, re.M)
    assert m, name
    params_end = balanced(m.start(), "(", ")")
    return page[m.start():balanced(params_end, "{", "}") + 1]


def lift_line(name):
    m = re.search(r"^const " + re.escape(name) + r"\s*=", page, re.M)
    assert m, name
    return page[m.start():page.index("\n", m.start())]


def lift_const_block(name):
    m = re.search(r"^const " + re.escape(name) + r"\s*=", page, re.M)
    assert m, name
    return page[m.start():page.index(";", balanced(m.start(), "{", "}")) + 1]


parts = [
    lift_fn("deburr"), lift_fn("onlyDigits"), lift_line("PERSON_SALUT"), lift_fn("personNameKey"),
    lift_fn("nifFromAny"), lift_fn("foundedYear"), lift_fn("legalFormOf"), lift_fn("personAge"), lift_fn("controlTier"),
    lift_fn("linkIsCurrent"), lift_line("linkIsShareholder"), lift_line("linkIsManager"), lift_line("fmtPctOwn"),
    lift_fn("resolveOwnership"), lift_const_block("LEGACY_ORBIS_FIELD"), lift_fn("orbisValues"),
    lift_const_block("STAGES"), lift_line("FINANCIALS_YEARS"),
    lift_fn("tierOf"),  # reads the module-level tierRules below, as on the desktop
]
names = ["deburr", "onlyDigits", "PERSON_SALUT", "personNameKey", "nifFromAny", "foundedYear", "legalFormOf", "personAge",
         "controlTier", "linkIsCurrent", "linkIsShareholder", "linkIsManager", "fmtPctOwn", "resolveOwnership",
         "LEGACY_ORBIS_FIELD", "orbisValues", "STAGES", "FINANCIALS_YEARS", "tierOf"]

body = (
    "// Search CRM helpers for the mobile app, COPIED VERBATIM from portal/search.html\n"
    "// by tests/portal/gen_mobile_helpers.py. Do not edit here: change search.html and\n"
    "// regenerate. tests/portal/mobile_parity checks they still match the desktop's.\n\n"
    "export let tierRules = [];\n"
    "export function setTierRules(r){ tierRules = Array.isArray(r) ? r : []; }\n\n"
    + "\n".join(parts) + "\n\nexport { " + ", ".join(names) + " };\n"
)
open(OUT, "w", encoding="utf-8", newline="\n").write(body)
print("ok", OUT, len(body))
