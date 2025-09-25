import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'docs';
const SIDEBAR = '_sidebar.md';
const NAV_PATH = path.join(ROOT, '_nav.json');

const nav = fs.existsSync(NAV_PATH) ? JSON.parse(fs.readFileSync(NAV_PATH,'utf8')) : {};
nav.labels ||= {};
nav.hidden ||= [];
nav.extHidden ||= [];
nav.indexLabel ||= '概要';
nav.linkFolders ??= false; // ← フォルダ見出しをリンク化したい場合は true に

const isHiddenDir  = (name) => name.startsWith('.') || nav.hidden.includes(name);
const isHiddenFile = (name) => nav.extHidden.includes(name);
const isMd = (p) => /\.md$/i.test(p);

const rmPrefix = (s) => s.replace(/^\d+[-_]?/, '');
const humanize = (s) => rmPrefix(s).replace(/\.md$/i,'').replace(/[-_]/g,' ');

function readFirstTitle(fullPath) {
  const raw = fs.readFileSync(fullPath, 'utf8');
  // frontmatter
  const fm = raw.match(/^---\s*[\s\S]*?---/);
  if (fm) {
    const t = fm[0].match(/^\s*title\s*:\s*(.+)\s*$/mi);
    if (t) return t[1].trim().replace(/^["']|["']$/g,'');
  }
  // first H1
  const h1 = raw.match(/^\s*#\s+(.+)\s*$/m);
  if (h1) return h1[1].trim();
  return null;
}

function labelFor(dir, name) {
  // 1) labels の明示指定（パス優先）
  if (name) {
    const p = path.posix.join(dir || '', name);
    if (nav.labels[p]) return nav.labels[p];
    if (nav.labels[name]) return nav.labels[name];
  } else if (dir && nav.labels[dir]) {
    return nav.labels[dir];
  }

  // 2) ファイルは本文からタイトルを拾う
  if (name && isMd(name)) {
    const full = path.join(ROOT, dir, name);
    if (fs.existsSync(full)) {
      const t = readFirstTitle(full);
      if (t) return t;
    }
    return humanize(name);
  }

  // 3) ディレクトリは整形名
  return humanize((dir || '').split('/').pop() || '');
}

function docsifyLink(dir, name) {
  // /foo/bar.md -> /foo/bar, /foo/README.md -> /foo/
  const p = name ? path.posix.join('/', dir, name.replace(/\.md$/i,'')) : path.posix.join('/', dir, '');
  return p.replace(/\/README$/i, '/').replace(/\/index$/i, '/');
}

function walk(dir = '') {
  const abs = path.join(ROOT, dir);
  const entries = fs.readdirSync(abs, { withFileTypes: true })
    .filter(e => !(e.isDirectory() ? isHiddenDir(e.name) : isHiddenFile(e.name)))
    .sort((a,b) => a.name.localeCompare(b.name, 'ja', { numeric: true, sensitivity: 'base' }));

  const folders = [];
  const files = [];
  for (const e of entries) {
    if (e.isDirectory()) folders.push(e.name);
    else if (isMd(e.name)) files.push(e.name);
  }

  const indexFile =
      files.find(f => /^readme\.md$/i.test(f))
   || files.find(f => /^index\.md$/i.test(f))
   || null;

  const children = folders.map(f => ({ type:'dir', name:f, ...walk(path.posix.join(dir, f)) }));
  const pages = files
    .filter(f => f !== indexFile)
    .map(f => ({ type:'file', name:f }));

  return { dir, indexFile, pages, children };
}

function emit(node, depth = 0, out = []) {
  const indent = '  '.repeat(depth);

  // ディレクトリ見出し（非リンク or リンク切替）
  if (node.dir !== '') {
    const folderLabel = labelFor(node.dir);
    if (nav.linkFolders) {
      const link = docsifyLink(node.dir, 'README.md'); // README or index のどちらでもOKなURL
      out.push(`${indent}- [${folderLabel}](${link})`);
    } else {
      out.push(`${indent}- ${folderLabel}`);
    }
    depth++;
  }

  // index (README / index) を最初の子項目として表示
  if (node.indexFile) {
    const idxLabel = labelFor(node.dir, node.indexFile) || nav.indexLabel;
    const idxLink  = docsifyLink(node.dir, node.indexFile);
    out.push(`${'  '.repeat(depth)}- [${idxLabel}](${idxLink})`);
  }

  // その他のページ
  for (const p of node.pages) {
    const label = labelFor(node.dir, p.name);
    const link  = docsifyLink(node.dir, p.name);
    out.push(`${'  '.repeat(depth)}- [${label}](${link})`);
  }

  // サブディレクトリ
  for (const c of node.children) emit(c, depth, out);

  return out;
}

// 生成
const tree = walk('');
const lines = emit(tree);
fs.writeFileSync(path.join(ROOT, SIDEBAR), lines.join('\n') + '\n', 'utf8');
console.log(`✔ Generated ${path.join(ROOT, SIDEBAR)} (${lines.length} lines)`);
