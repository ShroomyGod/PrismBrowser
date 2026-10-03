// Determine the mechanics of the fix: (a) can the window's own webContents
// view be raised above child WebContentsViews, and (b) does
// BrowserWindow.fromWebContents() still resolve a child view's webContents?
const { app, BrowserWindow, WebContentsView } = require('electron');
const bail = (m) => { console.error(m); try { app.exit(1); } catch (_) {} };
setTimeout(() => bail('Z_TIMEOUT'), 40000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 400, height: 300, show: false });
  await win.loadURL('data:text/html,<body style="background:#0c0c0c">shell</body>');

  const cv = win.contentView;
  console.log('Z children=' + (cv.children ? cv.children.length : 'n/a'));

  const child = new WebContentsView();
  cv.addChildView(child);
  await child.webContents.loadURL('data:text/html,<body>page</body>');
  console.log('Z childrenAfter=' + cv.children.length);

  // Which index is the window's own webContents view?
  cv.children.forEach((v, i) => {
    const isSelf = v.webContents && v.webContents.id === win.webContents.id;
    console.log('Z child[' + i + '] self=' + !!isSelf +
      ' id=' + (v.webContents ? v.webContents.id : '?'));
  });

  // Can we raise the window's own view above the child?
  try {
    const selfView = cv.children.find((v) => v.webContents &&
      v.webContents.id === win.webContents.id);
    if (selfView) {
      cv.removeChildView(selfView);
      cv.addChildView(selfView);   // re-append => topmost
      const now = cv.children.map((v) =>
        (v.webContents && v.webContents.id === win.webContents.id) ? 'self' : 'child');
      console.log('Z reorder=' + now.join('>'));
      console.log('Z REORDER_OK');
    } else {
      console.log('Z REORDER_NO_HANDLE (window view not in children)');
    }
  } catch (e) {
    console.log('Z REORDER_FAIL ' + e.message);
  }

  // Does fromWebContents resolve a child view back to the window?
  try {
    const w2 = BrowserWindow.fromWebContents(child.webContents);
    console.log('Z fromChildView=' + (w2 ? 'resolved' : 'NULL'));
  } catch (e) { console.log('Z fromChildViewErr=' + e.message); }
  try {
    const w3 = BrowserWindow.fromWebContents(win.webContents);
    console.log('Z fromOwn=' + (w3 ? 'resolved' : 'NULL'));
  } catch (e) { console.log('Z fromOwnErr=' + e.message); }

  // setBackgroundColor on the window's own view?
  console.log('Z selfSetBg=' + (typeof win.contentView.setBackgroundColor));

  app.exit(0);
}).catch((e) => bail('Z_ERR: ' + (e && e.stack || e)));
