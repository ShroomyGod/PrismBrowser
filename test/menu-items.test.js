// menu-items.test.js — the ⋮ menu tree is data, so it can be checked without
// launching Electron: every item must be well formed, and every `action` it
// names must be dispatched by shell.js. That last check is what stops a menu row
// from shipping as a decorative label that logs "no handler" when clicked.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const menu = require(path.join(ROOT, 'src', 'shell', 'menu-items.js'));
const shellSrc = fs.readFileSync(path.join(ROOT, 'src', 'shell', 'shell.js'), 'utf8');
const preloadSrc = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'shell.js'), 'utf8');

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log('  ok   ' + name);
  } else {
    failures++;
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

// The MENU_ACTIONS table in shell.js, as written.
function handledActions() {
  const start = shellSrc.indexOf('const MENU_ACTIONS = {');
  if (start === -1) return null;
  const end = shellSrc.indexOf('\n};', start);
  if (end === -1) return null;
  const body = shellSrc.slice(start, end);
  const found = new Set();
  const re = /^\s{2}'([a-z0-9-]+)':/gm;
  let m;
  while ((m = re.exec(body))) found.add(m[1]);
  return found;
}

console.log('menu-items');

check('exports sections', Array.isArray(menu.sections) && menu.sections.length > 0);
check('exports icons', !!menu.icons && Object.keys(menu.icons).length > 0);

const ids = new Set();
const usedActions = new Set();
let treeWellFormed = true;
let shapeProblem = '';

for (const section of menu.sections) {
  if (!Array.isArray(section.items) || !section.items.length) {
    treeWellFormed = false;
    shapeProblem = 'section without items';
    break;
  }
  for (const item of section.items) {
    for (const node of [item].concat(item.submenu || [])) {
      if (node.separator) {
        if (!node.id) { treeWellFormed = false; shapeProblem = 'separator without id'; }
        continue;
      }
      if (!node.id || !node.label) { treeWellFormed = false; shapeProblem = 'item missing id/label'; }
      if (ids.has(node.id)) { treeWellFormed = false; shapeProblem = 'duplicate id ' + node.id; }
      ids.add(node.id);
      // A row must do something: either it opens a submenu, lists dynamic rows,
      // or dispatches an action.
      if (!node.action && !node.submenu && !node.list) {
        treeWellFormed = false;
        shapeProblem = node.id + ' has no action, submenu, or list';
      }
      if (node.action) usedActions.add(node.action);
      if (node.list && typeof node.list !== 'string') {
        treeWellFormed = false;
        shapeProblem = node.id + ' has a non-string list';
      }
    }
  }
}
check('tree is well formed', treeWellFormed, shapeProblem);

// Every `list` kind named by the tree must be handled by loadMenuList, or the
// submenu silently renders empty.
const usedLists = [];
(function walk(list) {
  for (const item of list) {
    if (item.list) usedLists.push(item.list);
    if (item.submenu) walk(item.submenu);
  }
})(menu.sections.flatMap((s) => s.items));
const listBody = shellSrc.slice(shellSrc.indexOf('async function loadMenuList'));
const unknownLists = usedLists.filter((kind) => !listBody.includes("kind === '" + kind + "'"));
check(
  'every dynamic list kind is loaded',
  usedLists.length > 0 && unknownLists.length === 0,
  'unloaded: ' + unknownLists.join(', ')
);

const actions = handledActions();
check('shell.js defines MENU_ACTIONS', !!actions);

const missing = [];
for (const action of usedActions) {
  if (actions && !actions.has(action)) missing.push(action);
}
check(
  'every menu action has a handler',
  missing.length === 0,
  'unhandled: ' + missing.join(', ')
);

// Actions the handlers call on the shell bridge must exist in the preload.
const bridgeCalls = new Set();
const callRe = /\bS\.([A-Za-z][A-Za-z0-9_]*)\s*\(/g;
let cm;
while ((cm = callRe.exec(shellSrc))) bridgeCalls.add(cm[1]);
const bridgeMissing = [];
for (const name of bridgeCalls) {
  if (!new RegExp('(^|[\\s{,])' + name + '\\s*:', 'm').test(preloadSrc)) bridgeMissing.push(name);
}
check('shell only calls preload methods that exist', bridgeMissing.length === 0, 'missing: ' + bridgeMissing.join(', '));

// The user explicitly asked for everything in Chrome's ⋮ menu except Google Lens.
const allText = [];
(function walk(list) {
  for (const item of list) {
    allText.push(String(item.label || ''));
    if (item.submenu) walk(item.submenu);
  }
})(menu.sections.flatMap((s) => s.items));
check('no Google Lens entry', !allText.some((t) => /lens/i.test(t)), allText.filter((t) => /lens/i.test(t)).join(', '));

const required = ['New tab', 'New window', 'New incognito window', 'Passwords and autofill', 'History',
  'Downloads', 'Bookmarks and lists', 'Tab groups', 'Extensions', 'Delete browsing data…', 'Zoom',
  'Print…', 'Translate…', 'Find and edit', 'Cast, save and share', 'More tools', 'Help', 'Settings', 'Exit'];
const notPresent = required.filter((label) => !allText.includes(label));
check('all requested Chrome menu entries exist', notPresent.length === 0, 'missing: ' + notPresent.join(', '));

// Internal pages the menu links to must actually be served by prism://.
for (const page of ['clear', 'shortcuts']) {
  check('prism://' + page + ' exists', fs.existsSync(path.join(ROOT, 'src', 'pages', page + '.html')));
}



if (failures) {
  console.error('\n' + failures + ' menu check(s) failed');
  process.exit(1);
}
console.log('\nmenu-items: all checks passed');