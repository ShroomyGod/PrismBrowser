// Does a WebContentsView render transparently over a sibling beneath it?
// Window must be SHOWN or the surface can't be captured.
const { app, BrowserWindow, WebContentsView } = require('electron');
const { PNG } = require('pngjs');
const bail = (m) => { console.error(m); try { app.exit(1); } catch (_) {} };
setTimeout(() => bail('TR_TIMEOUT'), 40000);

const BOTTOM = '<html><body style="margin:0;background:#ff0000"></body></html>';
const TOP = '<html><body style="margin:0;background:transparent">' +
            '<div style="position:absolute;top:0;left:0;width:100px;height:30px;background:#0000ff"></div>' +
            '</body></html>';

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 320, height: 240, show: true });
  await win.loadURL('about:blank');
  await new Promise((r) => setTimeout(r, 400));

  const bottom = new WebContentsView();
  win.contentView.addChildView(bottom);
  bottom.setBounds({ x: 0, y: 0, width: 320, height: 240 });
  await bottom.webContents.loadURL('data:text/html,' + encodeURIComponent(BOTTOM));

  const top = new WebContentsView();
  win.contentView.addChildView(top);
  top.setBounds({ x: 0, y: 0, width: 320, height: 240 });
  await top.webContents.loadURL('data:text/html,' + encodeURIComponent(TOP));
  try { top.setBackgroundColor('#00000000'); } catch (e) { console.log('TR bgErr=' + e.message); }

  await new Promise((r) => setTimeout(r, 1500));

  try {
    const img = await top.webContents.capturePage();
    const png = PNG.sync.read(img.toPNG());
    const at = (x, y) => { const i = (png.width * y + x) << 2;
      return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]]; };
    const box = at(20, 15);
    const bg = at(250, 150);
    console.log('TR box=' + box.join(',') + ' (want 0,0,255,255)');
    console.log('TR bg=' + bg.join(',') + ' (alpha 0 => transparent)');
    console.log(bg[3] === 0 ? 'TR TRANSPARENT_OK' : 'TR TRANSPARENT_FAIL');
  } catch (e) { console.log('TR captureErr=' + e.message); }

  app.exit(0);
}).catch((e) => bail('TR_ERR ' + (e && e.stack || e)));
