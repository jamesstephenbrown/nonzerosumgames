#!/usr/bin/env python3
"""
nonzerosum.games live editor
============================

    python3 tools/edit-server.py

Serves the working copy at http://localhost:4000. Add ?edit=1 to any page (or use
the bookmarklet) and an editor bar appears; edit mode then follows you from page
to page until you press Exit.

    Edit      turn editing on/off
    + Para    new paragraph after the focused block (or just press Return)
    + Image   upload an image and place it after the focused block
    Link      wrap the selected text in a link
    Up/Down   move the focused block past its neighbour
    Delete    remove the focused block
    Save      write the changes into the .html file
    Publish   git add, commit, pull --rebase, push

Standard library only: no pip, no node. Binds to 127.0.0.1.

HOW SAVING STAYS SAFE
---------------------
The browser never posts a whole page back. Each editable element is numbered when
the page is served, and the browser returns a short list of operations against
those numbers: replace this one's contents, insert this HTML after that one,
delete this one. On save the server re-reads the file, locates the same elements
in the source text, and splices bytes. Everything it is not told to change -
comments, indentation, head, scripts, attribute order - is never rewritten,
because it is never passed through a parser and re-serialised.

Inserted markup inherits the indentation of the block it follows, so the file
stays as tidy as you left it. Every save first copies the file into .nz-backups/
so the Undo button can put it straight back.
"""

import html.parser, http.server, json, os, posixpath, re, shutil, socketserver
import subprocess, sys, urllib.parse, datetime, base64

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 4000
IMAGE_DIR = "Images/Content"
BACKUP_DIR = os.path.join(ROOT, ".nz-backups")

# Text-bearing elements. Containers (div, section) are deliberately absent: letting
# the browser reserialise a wrapper is how editors mangle hand-written markup.
EDITABLE = {"p", "h1", "h2", "h3", "h4", "li", "blockquote", "figcaption"}
# ...plus the tile captions, which are spans. Without these, blog.html and index.html
# have almost nothing to edit, since they are mostly picture links.
EDITABLE_SPAN_CLASSES = {"image-title"}


# --------------------------------------------------------------------------
# Finding editable elements in the source text
# --------------------------------------------------------------------------

class Scanner(html.parser.HTMLParser):
    """Records, for every editable element, where its tags and contents begin
    and end in the raw source. Nested editables are skipped so that numbering is
    identical when serving and when saving."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.spans = []
        self._open = []
        self._depth = 0

    def feed(self, data):
        self.src = data
        self._starts = [0]
        for i, ch in enumerate(data):
            if ch == "\n":
                self._starts.append(i + 1)
        super().feed(data)

    def _offset(self):
        line, col = self.getpos()
        return self._starts[line - 1] + col

    def _is_editable(self, tag, attrs):
        if tag in EDITABLE:
            return True
        if tag == "span":
            cls = dict(attrs).get("class", "") or ""
            return any(c in EDITABLE_SPAN_CLASSES for c in cls.split())
        return False

    def handle_starttag(self, tag, attrs):
        if self._is_editable(tag, attrs):
            if self._depth == 0:
                a = self._offset()
                self.spans.append({"tag": tag, "outer_a": a,
                                   "inner_a": a + len(self.get_starttag_text()),
                                   "inner_b": None, "outer_b": None})
                self._open.append((tag, len(self.spans) - 1))
            self._depth += 1

    def handle_endtag(self, tag):
        if self._depth > 0 and (tag in EDITABLE or tag == "span"):
            self._depth -= 1
            if self._depth == 0 and self._open:
                t, idx = self._open.pop()
                if t == tag:
                    pos = self._offset()
                    close = self.src.find(">", pos)
                    self.spans[idx]["inner_b"] = pos
                    self.spans[idx]["outer_b"] = (close + 1) if close != -1 else pos


def scan(src):
    s = Scanner()
    try:
        s.feed(src)
    except Exception:
        pass
    return [x for x in s.spans
            if x["inner_b"] is not None and x["inner_b"] >= x["inner_a"]]


def indent_of(src, pos):
    """Whitespace at the start of the line containing pos, so inserted markup
    lines up with its neighbours instead of jamming against the margin."""
    line_start = src.rfind("\n", 0, pos) + 1
    m = re.match(r"[ \t]*", src[line_start:pos])
    return m.group(0) if m else ""


# --------------------------------------------------------------------------
# Serving a page with the editor attached
# --------------------------------------------------------------------------

def inject(src, path):
    spans = scan(src)
    out, prev = [], 0
    for i, sp in enumerate(spans):
        mark = src.find(">", sp["outer_a"])
        if mark == -1 or mark >= sp["inner_a"]:
            continue
        out.append(src[prev:mark])
        out.append(f' data-nz="{i}"')
        prev = mark
    out.append(src[prev:])
    page = "".join(out)

    blob = ("<style>" + EDITOR_CSS + "</style><script>"
            + EDITOR_JS.replace("__PATH__", json.dumps(path)) + "</script>")
    at = page.lower().rfind("</body>")
    return (page[:at] + blob + page[at:]) if at != -1 else page + blob


# --------------------------------------------------------------------------
# Writing changes back
# --------------------------------------------------------------------------

STRIP_ATTRS = re.compile(r'\s+(?:data-nz|data-nz-new|data-nz-bound|contenteditable|spellcheck)="[^"]*"')


def clean(fragment):
    """Remove the editor's own bookkeeping before anything touches the file."""
    frag = STRIP_ATTRS.sub("", fragment)
    frag = re.sub(r'\s*class="([^"]*)\bnzdirty\b([^"]*)"', lambda m: (
        f' class="{(m.group(1) + m.group(2)).strip()}"' if (m.group(1) + m.group(2)).strip() else ""), frag)
    frag = re.sub(r'\s*class="\s*"', "", frag)
    return frag.strip()


def apply_ops(relpath, ops):
    """ops: replace / insert / insert_before / delete, addressed by block number.

    Every operation is turned into a (start, end, replacement) splice against the
    original text, then applied from the end of the file backwards so that earlier
    offsets stay valid."""
    full = safe_path(relpath)
    src = open(full, encoding="utf-8").read()
    spans = scan(src)
    splices = []

    for op in ops:
        kind = op.get("op")
        if kind == "replace":
            sp = spans[int(op["index"])]
            splices.append((sp["inner_a"], sp["inner_b"], clean(op["html"])))
        elif kind == "delete":
            sp = spans[int(op["index"])]
            line_start = src.rfind("\n", 0, sp["outer_a"]) + 1
            start = line_start if src[line_start:sp["outer_a"]].strip() == "" else sp["outer_a"]
            end = sp["outer_b"]
            if src[end:end + 1] == "\n":
                end += 1
            splices.append((start, end, ""))
        elif kind == "insert":
            sp = spans[int(op["after"])]
            pad = indent_of(src, sp["outer_a"])
            body = "\n".join(pad + line for line in clean(op["html"]).splitlines())
            splices.append((sp["outer_b"], sp["outer_b"], "\n" + body))
        elif kind == "insert_before":
            sp = spans[int(op["before"])]
            pad = indent_of(src, sp["outer_a"])
            body = "\n".join(pad + line for line in clean(op["html"]).splitlines())
            splices.append((sp["outer_a"], sp["outer_a"], body + "\n" + pad))
        else:
            raise ValueError(f"unknown op {kind!r}")

    for start, end, text in sorted(splices, key=lambda s: -s[0]):
        src = src[:start] + text + src[end:]

    os.makedirs(BACKUP_DIR, exist_ok=True)
    shutil.copy2(full, backup_path(relpath))
    tmp = full + ".nztmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(src)
    os.replace(tmp, full)
    return len(splices)


def backup_path(relpath):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    return os.path.join(BACKUP_DIR, relpath.replace("/", "__") + ".bak")


def safe_path(relpath):
    rel = posixpath.normpath("/" + relpath.lstrip("/")).lstrip("/")
    full = os.path.realpath(os.path.join(ROOT, rel))
    if full != ROOT and not full.startswith(ROOT + os.sep):
        raise ValueError("path escapes site root")
    return full


def git(*args):
    r = subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)

        if parsed.path == "/__status":
            code, out = git("status", "--porcelain")
            return self._json(200, {"ok": code == 0, "status": out})

        rel = urllib.parse.unquote(parsed.path).lstrip("/")
        if rel == "" or rel.endswith("/"):
            rel += "index.html"
        try:
            full = safe_path(rel)
        except ValueError:
            return self._json(403, {"error": "forbidden"})

        if not os.path.exists(full) and os.path.exists(full + ".html"):
            full, rel = full + ".html", rel + ".html"

        # Edit mode is sticky, so following a link keeps the editor.
        want = (qs.get("edit") or [None])[0]
        cookie_on = "nzedit=1" in (self.headers.get("Cookie") or "")

        if want == "0":
            self.send_response(302)
            self.send_header("Location", "/" + urllib.parse.quote(rel))
            self.send_header("Set-Cookie", "nzedit=; Path=/; Max-Age=0")
            self.end_headers()
            return

        if ((want == "1") or (want is None and cookie_on)) \
                and full.endswith(".html") and os.path.isfile(full):
            try:
                page = inject(open(full, encoding="utf-8").read(), rel)
            except Exception as exc:
                return self._json(500, {"error": str(exc)})
            body = page.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Set-Cookie", "nzedit=1; Path=/; SameSite=Lax")
            self.end_headers()
            return self.wfile.write(body)

        self.path = "/" + urllib.parse.quote(rel)
        return super().do_GET()

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        route = urllib.parse.urlparse(self.path).path
        try:
            data = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return self._json(400, {"error": "bad json"})

        if route == "/__save":
            try:
                n = apply_ops(data["path"], data["ops"])
            except Exception as exc:
                return self._json(500, {"error": f"{type(exc).__name__}: {exc}"})
            return self._json(200, {"ok": True, "ops": n})

        if route == "/__upload":
            name = re.sub(r"[^A-Za-z0-9._-]", "_", data.get("name", "image.png"))
            os.makedirs(os.path.join(ROOT, IMAGE_DIR), exist_ok=True)
            stem, ext = os.path.splitext(name)
            dest = os.path.join(ROOT, IMAGE_DIR, name)
            n = 2
            while os.path.exists(dest):           # never overwrite existing artwork
                dest = os.path.join(ROOT, IMAGE_DIR, f"{stem}_{n}{ext}")
                n += 1
            with open(dest, "wb") as f:
                f.write(base64.b64decode(data["data"].split(",", 1)[-1]))
            return self._json(200, {"ok": True,
                                    "src": "./" + IMAGE_DIR + "/" + os.path.basename(dest)})

        if route == "/__publish":
            msg = data.get("message") or f"Edits {datetime.date.today().isoformat()}"
            steps = []
            for args in (("add", "-A"), ("commit", "-m", msg), ("pull", "--rebase"), ("push",)):
                code, out = git(*args)
                steps.append({"cmd": " ".join(args), "ok": code == 0, "out": out[-800:]})
                if code != 0 and args[0] != "commit":
                    break
            return self._json(200, {"steps": steps})

        if route == "/__revert":
            try:
                safe_path(data["path"])
            except ValueError:
                return self._json(403, {"error": "forbidden"})
            bak = backup_path(data["path"])
            if not os.path.exists(bak):
                return self._json(404, {"error": "nothing to undo"})
            shutil.copy2(bak, safe_path(data["path"]))
            return self._json(200, {"ok": True})

        return self._json(404, {"error": "unknown route"})


EDITOR_CSS = """
#nzbar{position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;gap:6px;
 align-items:center;padding:8px 12px;background:#17324d;color:#fff;flex-wrap:wrap;
 font:13px/1.3 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 -2px 12px rgba(0,0,0,.3)}
#nzbar button{font:inherit;font-weight:600;border:0;border-radius:7px;padding:6px 11px;
 cursor:pointer;background:#33ffcc;color:#17324d}
#nzbar button.sec{background:rgba(255,255,255,.17);color:#fff}
#nzbar button[disabled]{opacity:.35;cursor:default}
#nzbar .nzspacer{flex:1}
#nzbar .nzmsg{opacity:.9}
[data-nz][contenteditable="true"]{outline:1px dashed rgba(23,50,77,.4);outline-offset:3px}
[data-nz][contenteditable="true"]:focus{outline:2px solid #33ffcc;background:rgba(51,255,204,.10)}
.nzimg-hot{outline:2px dashed #33ffcc;outline-offset:3px;cursor:pointer}
.nzdirty{background:rgba(51,255,204,.16)}
.nzfocus{box-shadow:0 0 0 3px rgba(51,255,204,.55)}
"""

EDITOR_JS = r"""
(function(){
  var PATH = __PATH__, on = false, last = null;
  var repl = {};        // index -> new innerHTML
  var dels = {};        // index -> true
  var structural = false;

  var bar = document.createElement('div');
  bar.id = 'nzbar';
  bar.innerHTML =
      '<button id="nztoggle">Edit</button>'
    + '<button id="nzpara" class="sec">+ Para</button>'
    + '<button id="nzimg"  class="sec">+ Image</button>'
    + '<button id="nzlink" class="sec">Link</button>'
    + '<button id="nzup"   class="sec" title="Move up">&#9650;</button>'
    + '<button id="nzdown" class="sec" title="Move down">&#9660;</button>'
    + '<button id="nzdel"  class="sec" title="Delete block">Delete</button>'
    + '<button id="nzsave" disabled>Save</button>'
    + '<button id="nzpub">Publish</button>'
    + '<span class="nzspacer"></span><span class="nzmsg" id="nzmsg"></span>'
    + '<button id="nzundo" class="sec">Undo</button>'
    + '<button id="nzexit" class="sec">Exit</button>';

  function msg(t){ var e=document.getElementById('nzmsg'); if(e) e.textContent=t||''; }
  function dirtyCount(){ return Object.keys(repl).length + Object.keys(dels).length
                              + document.querySelectorAll('[data-nz-new]').length; }
  function touched(){
    document.getElementById('nzsave').disabled = dirtyCount() === 0;
  }
  function markDirty(el){
    el.classList.add('nzdirty');
    if (el.hasAttribute('data-nz')) repl[el.getAttribute('data-nz')] = el.innerHTML;
    touched();
  }
  function focusOn(el){
    if (last) last.classList.remove('nzfocus');
    last = el; if (el) el.classList.add('nzfocus');
  }

  function bind(el){
    if (el.dataset.nzBound) return;
    el.dataset.nzBound = '1';
    el.addEventListener('focus', function(){ focusOn(el); });
    el.addEventListener('click', function(){ focusOn(el); });
    el.addEventListener('input', function(){ markDirty(el); });
    el.addEventListener('paste', function(e){          // never let styled HTML in
      e.preventDefault();
      var t = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, t);
    });
    el.addEventListener('keydown', function(e){
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (e.shiftKey){ document.execCommand('insertLineBreak'); markDirty(el); return; }
      splitAt(el);
    });
  }

  // Return splits the block: whatever sits after the caret moves into a new <p>.
  function splitAt(el){
    var sel = window.getSelection();
    var tail = '';
    if (sel && sel.rangeCount){
      var r = sel.getRangeAt(0);
      r.deleteContents();
      var after = document.createRange();
      after.selectNodeContents(el);
      after.setStart(r.endContainer, r.endOffset);
      var frag = after.extractContents();
      var tmp = document.createElement('div');
      tmp.appendChild(frag);
      tail = tmp.innerHTML;
    }
    markDirty(el);
    addBlock(el, '<p>' + (tail || '<br>') + '</p>');
  }

  // New blocks carry no data-nz. They are saved as "insert after <anchor>", where
  // the anchor is the nearest preceding numbered block.
  function addBlock(afterEl, html){
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var node = tmp.firstElementChild;
    node.setAttribute('data-nz-new', '1');
    afterEl.parentNode.insertBefore(node, afterEl.nextSibling);
    if (node.tagName !== 'IMG'){
      node.contentEditable = 'true';
      bind(node);
      node.focus();
    }
    structural = true;
    focusOn(node);
    touched();
    return node;
  }

  function anchorIndexFor(node){
    var p = node.previousElementSibling;
    while (p){
      if (p.hasAttribute('data-nz')) return p.getAttribute('data-nz');
      p = p.previousElementSibling;
    }
    return null;   // nothing numbered before it: insert before the following one
  }
  function followIndexFor(node){
    var n = node.nextElementSibling;
    while (n){
      if (n.hasAttribute('data-nz')) return n.getAttribute('data-nz');
      n = n.nextElementSibling;
    }
    return null;
  }

  function setEditing(state){
    on = state;
    document.querySelectorAll('[data-nz]').forEach(function(el){
      el.contentEditable = state ? 'true' : 'false';
      el.spellcheck = true;
      if (state) bind(el);
    });
    document.querySelectorAll('img').forEach(function(img){
      if (img.closest('#nzbar')) return;
      img.classList.toggle('nzimg-hot', state);
      if (state && !img.dataset.nzBound){
        img.dataset.nzBound = '1';
        img.addEventListener('click', function(e){ e.preventDefault(); swap(img); });
      }
    });
    document.getElementById('nztoggle').textContent = state ? 'Editing' : 'Edit';
    msg(state ? 'Return for a new paragraph, shift-Return for a line break.' : '');
  }

  function upload(file, done){
    var fr = new FileReader();
    fr.onload = function(){
      msg('Uploading ' + file.name + '...');
      fetch('/__upload', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({name:file.name, data:fr.result})})
      .then(function(r){ return r.json(); })
      .then(function(j){ j.error ? msg('Upload failed: ' + j.error) : done(j.src); });
    };
    fr.readAsDataURL(file);
  }
  function pickFile(cb){
    var i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*';
    i.onchange = function(){ if (i.files[0]) upload(i.files[0], cb); };
    i.click();
  }

  function swap(img){
    pickFile(function(src){
      img.src = src;
      var host = img.closest('[data-nz]') || img.closest('[data-nz-new]');
      if (host) markDirty(host);
      else { structural = true; touched(); msg('Image replaced. Save to write it in.'); }
      msg('Image replaced. Save to write it in.');
    });
  }

  function init(){
  document.body.appendChild(bar);

  document.getElementById('nztoggle').onclick = function(){ setEditing(!on); };

  document.getElementById('nzpara').onclick = function(){
    if (!on) return msg('Turn Edit on first.');
    if (!last) return msg('Click a block first.');
    addBlock(last, '<p><br></p>');
  };

  document.getElementById('nzimg').onclick = function(){
    if (!on) return msg('Turn Edit on first.');
    if (!last) return msg('Click a block first.');
    pickFile(function(src){
      var node = addBlock(last, '<img src="' + src + '" alt="">');
      node.classList.add('nzimg-hot');
      msg('Image added. Give it alt text by editing the file, or Save as is.');
    });
  };

  document.getElementById('nzlink').onclick = function(){
    if (!on) return msg('Turn Edit on first.');
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) return msg('Select some text first.');
    var host = sel.anchorNode && sel.anchorNode.parentElement
             && sel.anchorNode.parentElement.closest('[data-nz],[data-nz-new]');
    if (!host) return msg('Selection is not inside an editable block.');
    var url = prompt('Link to (page.html, or a full https:// address):', '');
    if (!url) return;
    document.execCommand('createLink', false, url);
    // Match the site convention: outside links open in a new tab.
    host.querySelectorAll('a[href="' + url + '"]').forEach(function(a){
      if (/^https?:\/\//i.test(url) && url.indexOf('nonzerosum.games') === -1)
        a.setAttribute('target', '_blank');
    });
    markDirty(host);
  };

  function move(dir){
    if (!on) return msg('Turn Edit on first.');
    if (!last) return msg('Click a block first.');
    var sib = dir < 0 ? last.previousElementSibling : last.nextElementSibling;
    while (sib && !(sib.hasAttribute('data-nz') || sib.hasAttribute('data-nz-new')
                    || sib.tagName === 'IMG')){
      sib = dir < 0 ? sib.previousElementSibling : sib.nextElementSibling;
    }
    if (!sib) return msg('Nothing to swap with in this section.');
    if (dir < 0) last.parentNode.insertBefore(last, sib);
    else last.parentNode.insertBefore(sib, last);
    structural = true; touched();
    msg('Moved. Save to write it in.');
  }
  document.getElementById('nzup').onclick   = function(){ move(-1); };
  document.getElementById('nzdown').onclick = function(){ move(1); };

  document.getElementById('nzdel').onclick = function(){
    if (!on) return msg('Turn Edit on first.');
    if (!last) return msg('Click a block first.');
    if (!confirm('Delete this block?')) return;
    if (last.hasAttribute('data-nz')){
      dels[last.getAttribute('data-nz')] = true;
      delete repl[last.getAttribute('data-nz')];
    }
    structural = true;
    last.parentNode.removeChild(last);
    focusOn(null); touched();
    msg('Deleted. Save to write it in.');
  };

  document.getElementById('nzsave').onclick = function(){
    var ops = [];
    Object.keys(repl).forEach(function(i){
      if (!dels[i]) ops.push({op:'replace', index:i, html:repl[i]});
    });
    Object.keys(dels).forEach(function(i){ ops.push({op:'delete', index:i}); });

    // Moves and insertions are both expressed as: take this element's markup and
    // place it next to a numbered neighbour.
    document.querySelectorAll('[data-nz-new]').forEach(function(node){
      var a = anchorIndexFor(node), b = followIndexFor(node);
      var html = node.outerHTML;
      if (a !== null) ops.push({op:'insert', after:a, html:html});
      else if (b !== null) ops.push({op:'insert_before', before:b, html:html});
    });
    document.querySelectorAll('[data-nz]').forEach(function(node){
      var i = node.getAttribute('data-nz');
      var prev = node.previousElementSibling;
      var expected = String(Number(i) - 1);
      if (prev && prev.hasAttribute('data-nz') && prev.getAttribute('data-nz') !== expected){
        if (!dels[i]){ dels[i] = true; ops.push({op:'delete', index:i});
          ops.push({op:'insert', after:prev.getAttribute('data-nz'), html:node.outerHTML}); }
      }
    });

    if (!ops.length) return msg('Nothing changed.');
    msg('Saving ' + ops.length + ' change(s)...');
    fetch('/__save', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({path:PATH, ops:ops})})
    .then(function(r){ return r.json(); })
    .then(function(j){
      if (j.error) return msg('Save failed: ' + j.error);
      // Reload so the numbering matches the file again.
      location.reload();
    });
  };

  document.getElementById('nzundo').onclick = function(){
    if (!confirm('Undo the last save to this page?')) return;
    fetch('/__revert', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({path:PATH})})
    .then(function(r){ return r.json(); })
    .then(function(j){ j.error ? msg(j.error) : location.reload(); });
  };

  document.getElementById('nzpub').onclick = function(){
    if (dirtyCount()) return msg('Save first.');
    msg('Checking what would go up...');
    // Publish stages everything in the folder, so show exactly what that is
    // before anything is committed. A stray file is easy to miss otherwise.
    fetch('/__status').then(function(r){ return r.json(); }).then(function(s){
      var lines = (s.status || '').split('\n').filter(function(l){ return l.trim(); });
      if (!lines.length) return msg('Nothing to publish - no changes in the folder.');
      var list = lines.slice(0, 25).join('\n')
               + (lines.length > 25 ? '\n...and ' + (lines.length - 25) + ' more' : '');
      if (!confirm('Publish these ' + lines.length + ' change(s)?\n\n' + list)) return msg('Cancelled.');
      doPublish();
    });
  };

  function doPublish(){
    var m = prompt('Commit message:', 'Edits from the browser');
    if (m === null) return msg('Cancelled.');
    msg('Publishing...');
    fetch('/__publish', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({message:m})})
    .then(function(r){ return r.json(); })
    .then(function(j){
      var bad = (j.steps||[]).filter(function(s){ return !s.ok && s.cmd.indexOf('commit') !== 0; });
      msg(bad.length ? ('Stopped at ' + bad[0].cmd + ': ' + bad[0].out)
                     : 'Published. Live in about a minute.');
    });
  }

  document.getElementById('nzexit').onclick = function(){
    if (dirtyCount() && !confirm('You have unsaved changes. Leave anyway?')) return;
    location = location.pathname + '?edit=0';
  };

  window.addEventListener('beforeunload', function(e){
    if (dirtyCount()){ e.preventDefault(); e.returnValue = ''; }
  });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
"""


def main():
    os.chdir(ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as srv:
        print(f"  site     {ROOT}")
        print(f"  serving  http://localhost:{PORT}/")
        print(f"  edit     http://localhost:{PORT}/index.html?edit=1")
        print("  ctrl-C to stop")
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\n  stopped")


if __name__ == "__main__":
    main()
