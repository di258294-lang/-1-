"""Build the one Pretendard subset the game ships: src/assets/pretendard-subset.woff2.

Pretendard's dynamic-subset CSS is 92 @font-face rules (~520 KB fetched on
first load) and the full font is ~3 MB inside the native apps. The game only
ever draws the text in its own source, so we keep exactly those glyphs (plus
ASCII and common punctuation) in a single variable woff2.

    npm run font            # after changing any Korean copy
    npm run font:check      # CI: fails if src uses Hangul the subset lacks

Requires: pip install fonttools brotli
"""
import pathlib
import sys

from fontTools import subset

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT = ROOT / 'node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2'
OUT = ROOT / 'src/assets/pretendard-subset.woff2'

# Always present, even if no source file happens to use them yet.
EXTRA = '·…‥←→↑↓–—‘’“”′″%‰₩×÷±≈≠≤≥°•∙■□▲▼△▽●○◆◇★☆※〈〉《》「」『』【】・'

SOURCE_GLOBS = ['src/**/*.ts', 'src/**/*.css', 'index.html']


def used_text() -> str:
    chars = set(chr(c) for c in range(0x20, 0x7F))
    chars.update(EXTRA)
    for pattern in SOURCE_GLOBS:
        for path in ROOT.glob(pattern):
            chars.update(path.read_text(encoding='utf-8'))
    return ''.join(sorted(c for c in chars if c.isprintable()))


def build(out: pathlib.Path = OUT) -> pathlib.Path:
    if not FONT.exists():
        sys.exit(f'Missing {FONT.relative_to(ROOT)}. Run npm install first.')
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']  # keeps tnum for tabular numbers
    opts.name_IDs = ['*']
    opts.hinting = False
    opts.notdef_outline = True
    font = subset.load_font(str(FONT), opts)
    sub = subset.Subsetter(opts)
    sub.populate(text=used_text())
    sub.subset(font)
    out.parent.mkdir(parents=True, exist_ok=True)
    subset.save_font(font, str(out), opts)
    return out


if __name__ == '__main__':
    path = build()
    hangul = sum(1 for c in used_text() if 0xAC00 <= ord(c) <= 0xD7A3)
    print(f'{path.relative_to(ROOT)}  {path.stat().st_size / 1024:.1f} KB  ({hangul} Hangul syllables)')
