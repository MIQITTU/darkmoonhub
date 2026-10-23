#!/usr/bin/env python3
"""Wraps each pages/<name>.html in the shared page shell and writes public/<name>.html.
First line of each page file is JSON: {"title": "...", "desc": "..."}. Run: python3 build.py"""
import json, pathlib, html
ROOT = pathlib.Path(__file__).parent
SITE = "Darkmoon Hub"
SHELL = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="theme-color" content="#05050b">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;700&family=IBM+Plex+Sans:wght@400;600&family=JetBrains+Mono:wght@400;600;700&display=swap">
{css}<link rel="stylesheet" href="assets/style.css">
</head>
<body data-page="{page}">
<div id="top"></div>
<main class="wrap">
{body}
</main>
<div id="foot"></div>
<script src="assets/app.js"></script>
{scripts}{script}
</body>
</html>
"""
def build():
    out = ROOT / "public"
    for f in sorted((ROOT / "pages").glob("*.html")):
        first, rest = f.read_text(encoding="utf-8").split("\n", 1)
        m = json.loads(first)
        body, _, script = rest.partition("<script>")
        script = "<script>" + script if script else ""
        title = SITE if f.stem == "index" else f'{m["title"]} · {SITE}'
        src = lambda s: s if "/" in s else "assets/" + s
        scripts = "".join(f'<script src="{src(s)}"></script>\n' for s in m.get("scripts", []))
        css = "".join(f'<link rel="stylesheet" href="{c}">\n' for c in m.get("css", []))
        (out / f.name).write_text(SHELL.format(title=html.escape(title), desc=html.escape(m.get("desc", "")), body=body.strip(), scripts=scripts, script=script.strip(), css=css, page=f.name), encoding="utf-8")
    print("built", len(list((ROOT / "pages").glob("*.html"))), "pages")
if __name__ == "__main__":
    build()
