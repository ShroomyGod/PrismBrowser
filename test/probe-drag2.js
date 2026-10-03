// Compare native -webkit-app-region drag in (A) the window's own webContents
// and (B) a child WebContentsView. If A moves but B doesn't, moving the shell
// chrome into a child view would break window dragging.
const { app, BrowserWindow, WebContentsView } = require('electron');
const bail = (m) => { console.error(m); try { app.exit(1); } catch (_) {} };
setTimeout(() => bail('DRAG2_TIMEOUT'), 40000);

const HTML = `<html><body style="margin:0;background:#111">
  <div style="-webkit-app-region:drag;width:100%;height:60px;background:#2b2b2b">drag</div>
  <div style="height:60px;background:#444"></div>
</body></html>`;

async function dragFrom(wc) {
  wc.sendInputEvent({ type: 'mouseMoved', x: 60, y: 30 });
  await new Promise((r) => setTimeout(r, 80));
  wc.sendInputEvent({ type: 'mouseDown', x: 60, y: 30, button: 'left', clickCount: 1 });
  await new Promise((r) => setTimeout(r, 200));
  for (let i = 1; i <= 6; i++) {
    wc.sendInputEvent({ type: 'mouseMoved', x: 60 + i * 25, y: 30 + i * 6, button: 'left' });
    await new Promise((r) => setTimeout(r, 50));
  }
  wc.sendInputEvent({ type: 'mouseUp', x: 210, y: 66, button: 'left', clickCount: 1 });
  await new Promise((r) => setTimeout(r, 400));
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 400, height: 300, x: 300, y: 300, frame: false, show: true });
  await win.loadURL('data:text/html,' + encodeURIComponent(HTML));
  await new Promise((r) => setTimeout(r, 600));

  // A: window's own webContents
  const a0 = win.getBounds();
  await dragFrom(win.webContents);
  const a1 = win.getBounds();
  const aMoved = a0.x !== a1.x || a0.y !== a1.y;
  console.log('DRAG2 own=' + (aMoved ? 'MOVED' : 'no') +
    ' ' + JSON.stringify([a0.x, a0.y]) + '->' + JSON.stringify([a1.x, a1.y]));
  if (aMoved) win.setPosition(300, 300);
  await new Promise((r) => setTimeout(r, 300));

  // B: child view
  const view = new WebContentsView();
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 400, height: 120 });
  await view.webContents.loadURL('data:text/html,' + encodeURIComponent(HTML));
  await new Promise((r) => setTimeout(r, 700));

  const b0 = win.getBounds();
  await dragFrom(view.webContents);
  const b1 = win.getBounds();
  const bMoved = b0.x !== b1.x || b0.y !== b1.y;
  console.log('DRAG2 child=' + (bMoved ? 'MOVED' : 'no') +
    ' ' + JSON.stringify([b0.x, b0.y]) + '->' + JSON.stringify([b1.x, b1.y]));

  if (aMoved && bMoved) console.log('DRAG2 CHILD_VIEW_OK');
  else if (aMoved && !bMoved) console.log('DRAG2 CHILD_VIEW_BREAKS_DRAG');
  else console.log('DRAG2 INCONCLUSIVE (native drag not driven by injected input)');

  app.exit(0);
}).catch((e) => bail('DRAG2_ERR ' + (e && e.stack || e)));
