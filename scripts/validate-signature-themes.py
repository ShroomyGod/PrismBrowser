from pathlib import Path
import re
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
engine = (root / 'src/pages/theme-engine.js').read_text(encoding='utf-8')
assets = re.findall(r"artwork: '(theme-[^']+\.svg)'", engine)
assert len(assets) >= 40, f'Expected at least 40 illustrated presets; found {len(assets)}'
assert len(assets) == len(set(assets)), 'Illustration asset references must be unique'
for asset in assets:
    file = root / 'assets' / asset
    assert file.is_file(), f'Missing artwork: {asset}'
    svg = ET.parse(file).getroot()
    assert svg.tag.endswith('svg'), f'Invalid SVG root: {asset}'
    assert svg.get('viewBox'), f'Missing scalable viewBox: {asset}'
    assert not any(node.tag.rsplit('}', 1)[-1].lower() in {'script', 'foreignobject'} for node in svg.iter()), f'Active content in artwork: {asset}'
package = (root / 'package.json').read_text(encoding='utf-8')
assert 'assets/theme-*.svg' in package, 'Build must include theme artwork'
print(f'Validated {len(assets)} distinct illustrated themes and packaged SVGs')
