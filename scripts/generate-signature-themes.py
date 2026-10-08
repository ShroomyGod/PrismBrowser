from pathlib import Path

# The 35-theme gallery (Default / Clean, Neon Purple, Ocean Blue, ...) is pure
# CSS: multi-stop gradient frames plus repeating-gradient texture overlays
# (stars, rain, bubbles, waves, ember) defined in src/pages/theme-engine.js.
# No SVG files are required, so there is nothing to generate. This script is
# kept so existing tooling that invokes it keeps working; previously generated
# SVGs under assets/ remain on disk and stay packaged but are unreferenced.
THEMES = []

print(f'Generated {len(THEMES)} unique theme illustrations (gallery is CSS-only)')
