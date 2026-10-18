# Regenerates portal/mun-holidays.js (the Search CRM company page's municipal holiday)
# from functions/outreach/places.js, the table the scheduler uses.
# Run after changing places.js:  python tests/portal/gen_mun_holidays.py
# tests/portal/mun_holidays_2026-10-18.test.mjs fails until the two match again.
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "functions", "outreach", "places.js")
UTIL = os.path.join(ROOT, "functions", "outreach", "schedule_util.js")
OUT = os.path.join(ROOT, "portal", "mun-holidays.js")


def build():
    src = open(SRC, encoding="utf-8").read().replace("\r\n", "\n")
    util = open(UTIL, encoding="utf-8").read().replace("\r\n", "\n")
    a = src.index("// ── Municipalities (14 Oct 2026 data round) — generated: begin")
    b = src.index("module.exports")
    e0 = util.index("function easter(y) {")
    e1 = util.index("\n}\n", e0) + 3
    return (
        "// Generated from functions/outreach/places.js by tests/portal/gen_mun_holidays.py — do not edit.\n"
        "// Municipal holidays for the Search CRM company page (search.html imports it when needed).\n"
        + util[e0:e1]
        + "const munEaster = easter;\n\n"
        + src[a:b]
        + "// The municipality's name without its preposition: \"na Covilhã\" → \"Covilhã\"; the two Calhetas and Lagoas keep their region.\n"
        "function munName(k) {\n"
        "  const n = String(IN_CITY[k] || k).replace(/^(em|no|na|nos|nas) /, '');\n"
        "  const r = /\\((acores|madeira|algarve)\\)/.exec(k);\n"
        "  return r ? `${n} (${({ acores: 'Açores', madeira: 'Madeira', algarve: 'Algarve' })[r[1]]})` : n;\n"
        "}\n"
        "// Next date (YYYY-MM-DD) of the municipality's holiday, today included.\n"
        "function nextMunHoliday(k, today) {\n"
        "  const y = Number(today.slice(0, 4));\n"
        "  for (const yy of [y, y + 1]) { const md = munHolidayMD(k, yy); if (md && `${yy}-${md}` >= today) return `${yy}-${md}`; }\n"
        "  return '';\n"
        "}\n\n"
        "export { IN_CITY, MUN_HOL, municipalityOf, munHolidayMD, munName, nextMunHoliday };\n"
    )


if __name__ == "__main__":
    open(OUT, "w", encoding="utf-8", newline="\n").write(build())
    print("wrote", OUT)
