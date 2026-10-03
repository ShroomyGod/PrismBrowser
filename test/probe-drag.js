// RISK TEST for the layout fix: if the shell moves into a child
// WebContentsView (so its popups paint above the page), the frameless
// window's drag region must still work from that child view.
const { app, BrowserWindow, WebContentsView } = require('electron');
const bail = (m) => { console.error(m); try { app.exit(1); } catch (_) {} };
setTimeout(() => bail('DRAG_TIMEOUT'), 40000);

const HTML = `<html><body style="margin:0;background:#111">
  <div id="drag" style="-webkit-app-region:drag;width:100%;height:60px;background:#2b2b2b"></div>
  <div style="height:60px;background:#444"></div>
</body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 400, height: 300, x: 300, y: 300,
    frame: false, show: true
  });
  await win.loadURL('about:blank');

  const view = new WebContentsView();
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 400, height: 120 });
  await view.webContents.loadURL('data:text/html,' + encodeURIComponent(HTML));
  await new Promise((r) => setTimeout(r, 900));

  const before = win.getBounds();
  console.log('DRAG before=' + JSON.stringify(before));

  // Synthesise a drag starting inside the child view's drag region.
  const wc = view.webContents;
  wc.sendInputEvent({ type: 'mouseEnter', x: 100, y: 30, modifiers: [] });
  wc.sendInputEvent({ type: 'mousePressed', x: 100, y: 30, button: 'left', clickCount: 1, modifiers: [] });
  await new Promise((r) => setTimeout(r, 200));
  for (let i = 1; i <= 8; i++) {
    wc.sendInputEvent({ type: 'mouseMoved', x: 100 + i * 20, y: 30 + i * 5, button: 'left', modifiers: [] });
    await new Promise((r) => setTimeout(r, 50));
  }
  wc.sendInputEvent({ type: 'mouseReleased', x: 260, y: 70, button: 'left', clickCount: 1, modifiers: [] });
  await new Promise((r) => setTimeout(r, 500));

  const after = win.getBounds();
  console.log('DRAG after=' + JSON.stringify(after));
  const moved = before.x !== after.x || before.y !== after.y;
  console.log(moved ? 'DRAG CHILD_VIEW_OK' : 'DRAG CHILD_VIEW_FAIL');

  app.exit(moved ? 0 : 1);
}).catch((e) => bail('DRAG_ERR ' + (e && e.stack || e)));
