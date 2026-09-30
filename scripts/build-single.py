"""Pack the Vite build into one self-contained HTML file.

Used to publish a playable web build where only inline assets are allowed.
The Pretendard variable font is subset to the glyphs the game actually uses
and embedded as a data URI, so the file stays small and needs no font host.

    npm run build && python3 scripts/build-single.py out/hold.html

Requires: pip install fonttools brotli
"""
import base64
import pathlib
import re
import sys

from fontTools import subset

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
FONT = ROOT / 'node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2'


def used_text() -> str:
    chars = set(chr(c) for c in range(0x20, 0x7F))
    chars.update('·…←→원%')
    for path in list((ROOT / 'src').rglob('*.ts')) + [ROOT / 'index.html']:
        chars.update(path.read_text(encoding='utf-8'))
    return ''.join(sorted(c for c in chars if c.isprintable()))


def subset_font() -> str:
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    font = subset.load_font(str(FONT), opts)
    sub = subset.Subsetter(opts)
    sub.populate(text=used_text())
    sub.subset(font)
    out = ROOT / 'dist' / 'pretendard-subset.woff2'
    subset.save_font(font, str(out), opts)
    return base64.b64encode(out.read_bytes()).decode()


def main(target: str) -> None:
    html = (DIST / 'index.html').read_text(encoding='utf-8')
    js_path = re.search(r'<script[^>]+src="/(assets/[^"]+\.js)"', html).group(1)
    css_path = re.search(r'<link[^>]+href="/(assets/[^"]+\.css)"', html).group(1)
    js = (DIST / js_path).read_text(encoding='utf-8').replace('</script', '<\\/script')
    css = (DIST / css_path).read_text(encoding='utf-8')
    css = re.sub(r'@font-face\{[^}]*\}', '', css)

    font_face = (
        "@font-face{font-family:'Pretendard Variable';font-weight:45 920;font-style:normal;"
        f"font-display:swap;src:url(data:font/woff2;base64,{subset_font()}) format('woff2-variations')}}"
    )
    # The host page already pads for safe areas, so do not pad twice.
    host = ':root{--safe-top:0px;--safe-bottom:0px}'

    title = re.search(r'<title>(.*?)</title>', html).group(1)
    desc = re.search(r'<meta name="description" content="([^"]*)"', html).group(1)
    page = (
        f'<title>{title}</title>\n'
        f'<meta name="description" content="{desc}">\n'
        f'<style>{font_face}{css}{host}</style>\n'
        '<div id="app"></div>\n'
        f'<script type="module">{js}</script>\n'
    )
    out = pathlib.Path(target)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding='utf-8')
    print(f'{out}  {out.stat().st_size / 1024:.0f} KB')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else str(ROOT / 'dist/hold.html'))
