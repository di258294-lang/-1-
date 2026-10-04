"""Pack the game into one self-contained HTML file.

Used to publish a playable web build where only inline assets are allowed.

    python3 scripts/build-single.py out/hold.html

It runs `vite build --mode single` (see vite.config.ts), which bundles every
lazily loaded chunk (e.g. the Capacitor plugins' web fallbacks) into one JS
file and inlines every asset, including the committed Pretendard subset
(src/assets/pretendard-subset.woff2), as data URIs. This script then folds
that JS and CSS into a single page. No Python dependencies.
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist-single'


def build() -> None:
    subprocess.run(['npx', 'vite', 'build', '--mode', 'single', '--logLevel', 'warn'], cwd=ROOT, check=True)


def main(target: str) -> None:
    build()
    html = (DIST / 'index.html').read_text(encoding='utf-8')
    scripts = re.findall(r'<script[^>]+src="\.?/(assets/[^"]+\.js)"', html)
    styles = re.findall(r'<link[^>]+rel="stylesheet"[^>]+href="\.?/(assets/[^"]+\.css)"', html)
    chunks = sorted(p.name for p in (DIST / 'assets').glob('*.js'))
    if len(scripts) != 1 or len(chunks) != 1:
        sys.exit(f'Expected exactly one JS chunk, found entry {scripts} and files {chunks}. '
                 'A new dynamic import must be inlined (inlineDynamicImports in vite.config.ts).')
    js = (DIST / scripts[0]).read_text(encoding='utf-8').replace('</script', '<\\/script')
    css = ''.join((DIST / path).read_text(encoding='utf-8') for path in styles)
    if re.search(r'url\((?!["\']?data:)', css):
        sys.exit('The CSS still references an external file; it would not load from a single page.')

    # The host page already pads for safe areas, so do not pad twice.
    host = ':root{--safe-top:0px;--safe-bottom:0px}'

    title = re.search(r'<title>(.*?)</title>', html).group(1)
    desc = re.search(r'<meta name="description" content="([^"]*)"', html).group(1)
    page = (
        f'<title>{title}</title>\n'
        f'<meta name="description" content="{desc}">\n'
        f'<style>{css}{host}</style>\n'
        '<div id="app"></div>\n'
        f'<script type="module">{js}</script>\n'
    )
    out = pathlib.Path(target)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding='utf-8')
    print(f'{out}  {out.stat().st_size / 1024:.0f} KB')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else str(DIST / 'hold.html'))
