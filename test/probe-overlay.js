// Can a top WebContentsView render transparently over a sibling beneath it?
// If yes, the shell chrome can sit ABOVE the page and its dropdowns/menu can
// overlay page content (the bug the user is seeing).
const { app, BrowserWindow, WebContentsView } = require('electron');
const { PNG } = require('pngjs');

const bail = (m) => { console.error(m); try { app.exit(1); } catch (_) {} };
setTimeout(() => bail('OVERLAY_TIMEOUT'), 40000);

const BOTTOM_HTML =
  '<html><body style="margin:0;background:#ff0000"></body></html>';
const TOP_HTML =
  '<html><body style="margin:0;background:transparent">' +
  '<div style="position:absolute;top:0;left:0;width:120px;height:40px;background:#0000ff"></div>' +
  '</body></html>';

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 400, height: 300, show: false });
  win.loadURL('about:blank');
  await new Promise((r) => win.webContents.once('did-finish-load', r));

  const bottom = new WebContentsView();
  win.contentView.addChildView(bottom);
  bottom.setBounds({ x: 0, y: 0, width: 400, height: 300 });
  await bottom.webContents.loadURL('data:text/html,' + encodeURIComponent(BOTTOM_HTML));

  const top = new WebContentsView();
  win.contentView.addChildView(top);
  top.setBounds({ x: 0, y: 0, width: 400, height: 300 });
  await top.webContents.loadURL('data:text/html,' + encodeURIComponent(TOP_HTML));

  // Try to make the top view's own backdrop transparent.
  const bgFns = ['setBackgroundColor'].filter((f) => typeof top[f] === 'function');
  console.log('OVERLAY viewFns=' + bgFns.join(','));
  if (bgFns.length) {
    try { top.setBackgroundColor('#00000000'); console.log('OVERLAY bgSet=ok'); }
    catch (e) { console.log('OVERLAY bgSet=fail ' + e.message); }
  }

  await new Promise((r) => setTimeout(r, 1200));

  // Capture the TOP view: alpha 0 in the background => not painting opaque.
  try {
    const img = await top.webContents.capturePage();
    const png = PNG.sync.read(img.toPNG());
    const at = (x, y) => {
      const i = (png.width * y + x) << 2;
      return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
    };
    console.log('OVERLAY topSize=' + png.width + 'x' + png.height);
    console.log('OVERLAY boxPixel=' + at(20, 20).join(',') + ' (expect 0,0,255,255)');
    console.log('OVERLAY bgPixel=' + at(300, 200).join(',') + ' (alpha 0 = transparent)');
    const alpha = at(300, 200)[3];
    console.log(alpha === 0 ? 'OVERLAY TRANSPARENT_OK' : 'OVERLAY TRANSPARENT_FAIL alpha=' + alpha);
  } catch (e) {
    console.log('OVERLAY captureError=' + e.message);
  }

  // Also capture the bottom view; if it shows red where the top view's box is
  // not, that tells us nothing about occlusion, but confirms both render.
  try {
    const img2 = await bottom.webContents.capturePage();
    const p2 = PNG.sync.read(img2.toPNG());
    const i = (p2.width * 200 + 300) << 2;
    console.log('OVERLAY bottomPixel=' + p2.data[i] + ',' + p2.data[i + 1] + ',' + p2.data[i + 2]);
  } catch (e) { console.log('OVERLAY bottomErr=' + e.message); }

  app.exit(0);
}).catch((e) => bail('OVERLAY_ERROR: ' + (e && e.stack || e)));
