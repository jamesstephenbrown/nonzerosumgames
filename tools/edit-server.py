#!/usr/bin/env python3
"""
nonzerosum.games live editor
============================

Serves the working copy of the site at http://localhost:4000 and, when a page is
opened with ?edit=1, injects an in-page editor: click text to change it, click an
image to swap it, then Save. Saving writes back into the real .html file in this
folder. A Publish button commits and pushes.

    python3 tools/edit-server.py

Deliberately standard library only: no pip install, no node, nothing to keep
up to date. Binds to 127.0.0.1 so nothing outside this machine can reach it.

HOW SAVING STAYS SAFE
---------------------
The browser never sends back a whole page. When a page is served for editing the
server numbers each editable element and the browser returns only
{index, innerHTML} for the blocks that actually changed. On save the server
re-reads the file from disk, finds that same element by the same numbering, and
replaces the bytes between its tags. Everything else in the file - comments,
indentation, attribute order, the <head>, scripts - is untouched, because it is
never rewritten. The numbering is computed fresh on each request and the marker
attributes are only ever added to the copy sent to the browser, never to the file.
"""

import html.parser, http.server, json, os, posixpath, re, shutil, socketserver
import subprocess, sys, urllib.parse, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 4000

# Elements whose text you can edit. Containers like <div> are deliberately absent:
# editing a wrapper would let the browser reserialise everything inside it.
EDITABLE = {"p", "h1", "h2", "h3", "h4", "li", "blockquote", "figcaption", "em", "strong"}
IMAGE_DIR = "Images/Content"


# --------------------------------------------------------------------------
# Locating editable elements in the source text
# --------------------------------------------------------------------------

class Scanner(html.parser.HTMLParser):
    """Records the byte span of each editable element's inner HTML.

    Nested editables are skipped (an <em> inside a <p> is covered by the <p>),
    so indices stay stable between serving and saving.
    """

    def __init__(self, src):
        super().__init__(convert_charrefs=False)
        self.src = src
        self.spans = []          # (tag, inner_start, inner_end)
        self._stack = []
        self._depth = 0          # how deep inside an already-editable element

    def _offset(self):
        line, col = self.getpos()
        return self._line_starts[line - 1] + col

    def feed(self, data):
        self._line_starts = [0]
        for i, ch in enumerate(data):
            if ch == "\n":
                self._line_starts.append(i + 1)
        super().feed(data)

    def handle_starttag(self, tag, attrs):
        if tag in EDITABLE:
            if self._depth == 0:
                start = self._offset() + len(self.get_starttag_text())
                self._stack.append((tag, start, len(self.spans)))
                self.spans.append([tag, start, None])
            self._depth += 1

    def handle_endtag(self, tag):
        if tag in EDITABLE and self._depth > 0:
            self._depth -= 1
            if self._depth == 0 and self._stack:
                t, start, idx = self._stack.pop()
                if t == tag:
                    self.spans[idx][2] = self._offset()


def scan(src):
    s = Scanner(src)
    try:
        s.feed(src)
    except Exception:
        pass
    return [tuple(x) for x in s.spans if x[2] is not None and x[2] >= x[1]]


def inject(src, path):
    """Return the page with edit markers and the editor attached."""
    spans = scan(src)
    out, prev = [], 0
    for i, (tag, a, b) in enumerate(spans):
        open_start = src.rfind("<" + tag, 0, a)
        if open_start < 0:
            continue
        insert_at = src.find(">", open_start)
        if insert_at < 0 or insert_at >= a:
            continue
        out.append(src[prev:insert_at])
        out.append(f' data-nz="{i}"')
        prev = insert_at
    out.append(src[prev:])
    page = "".join(out)

    editor = EDITOR_JS.replace("__PATH__", json.dumps(path))
    blob = f"<style>{EDITOR_CSS}</style><script>{editor}</script>"
    low = page.lower()
    at = low.rfind("</body>")
    return (page[:at] + blob + page[at:]) if at != -1 else page + blob


# --------------------------------------------------------------------------
# Writing changes back
# --------------------------------------------------------------------------

def apply_edits(relpath, edits):
    """edits: [{"index": n, "html": "..."}]  -> rewrite only those inner spans."""
    full = safe_path(relpath)
    src = open(full, encoding="utf-8").read()
    spans = scan(src)

    # Apply back-to-front so earlier offsets stay valid.
    for e in sorted(edits, key=lambda e: -int(e["index"])):
        i = int(e["index"])
        if i >= len(spans):
            raise IndexError(f"block {i} no longer exists in {relpath}")
        _, a, b = spans[i]
        src = src[:a] + e["html"] + src[b:]

    # Backups live in one ignored folder, never beside the file - a stray
    # page.html.nzbak next to page.html would be swept up by `git add -A`
    # and published.
    shutil.copy2(full, backup_path(relpath))         # one-level undo
    tmp = full + ".nztmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(src)
    os.replace(tmp, full)                            # atomic
    return len(edits)


BACKUP_DIR = os.path.join(ROOT, ".nz-backups")


def backup_path(relpath):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    return os.path.join(BACKUP_DIR, relpath.replace("/", "__") + ".bak")


def safe_path(relpath):
    """Resolve a request path inside ROOT, refusing anything that escapes it."""
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
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    # ---- GET ----------------------------------------------------------
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

        # Extension-less URLs, the way GitHub Pages serves them.
        if not os.path.exists(full) and os.path.exists(full + ".html"):
            full, rel = full + ".html", rel + ".html"

        if qs.get("edit") and full.endswith(".html") and os.path.isfile(full):
            try:
                page = inject(open(full, encoding="utf-8").read(), rel)
            except Exception as exc:
                return self._json(500, {"error": str(exc)})
            body = page.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return self.wfile.write(body)

        self.path = "/" + urllib.parse.quote(rel)
        return super().do_GET()

    # ---- POST ---------------------------------------------------------
    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        route = urllib.parse.urlparse(self.path).path
        try:
            data = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return self._json(400, {"error": "bad json"})

        if route == "/__save":
            try:
                n = apply_edits(data["path"], data["edits"])
            except Exception as exc:
                return self._json(500, {"error": str(exc)})
            return self._json(200, {"ok": True, "blocks": n})

        if route == "/__upload":
            import base64
            name = re.sub(r"[^A-Za-z0-9._-]", "_", data.get("name", "image.png"))
            target_dir = os.path.join(ROOT, IMAGE_DIR)
            os.makedirs(target_dir, exist_ok=True)
            stem, ext = os.path.splitext(name)
            dest = os.path.join(target_dir, name)
            n = 2
            while os.path.exists(dest):                 # never overwrite artwork
                dest = os.path.join(target_dir, f"{stem}_{n}{ext}")
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
                if code != 0 and args[0] != "commit":   # "nothing to commit" is fine
                    break
            return self._json(200, {"steps": steps})

        if route == "/__revert":
            try:
                full = safe_path(data["path"])
            except ValueError:
                return self._json(403, {"error": "forbidden"})
            bak = backup_path(data["path"])
            if not os.path.exists(bak):
                return self._json(404, {"error": "nothing to undo"})
            shutil.copy2(bak, full)
            return self._json(200, {"ok": True})

        return self._json(404, {"error": "unknown route"})


EDITOR_CSS = """
#nzbar{position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;gap:8px;
 align-items:center;padding:8px 12px;background:#17324d;color:#fff;
 font:14px/1.3 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 -2px 12px rgba(0,0,0,.3)}
#nzbar button{font:inherit;font-weight:600;border:0;border-radius:8px;padding:7px 13px;cursor:pointer;background:#33ffcc;color:#17324d}
#nzbar button[disabled]{opacity:.4;cursor:default}
#nzbar .nzspacer{flex:1}
#nzbar .nzmsg{opacity:.85;font-size:13px}
[data-nz][contenteditable="true"]{outline:1px dashed rgba(23,50,77,.45);outline-offset:3px}
[data-nz][contenteditable="true"]:focus{outline:2px solid #33ffcc;background:rgba(51,255,204,.10)}
.nzimg-hot{outline:2px dashed #33ffcc;outline-offset:3px;cursor:pointer}
.nzdirty{background:rgba(51,255,204,.16)}
"""

EDITOR_JS = r"""
(function(){
  var PATH = __PATH__, dirty = {}, on = false;

  var bar = document.createElement('div');
  bar.id = 'nzbar';
  bar.innerHTML = '<button id="nztoggle">Edit</button>'
    + '<button id="nzsave" disabled>Save</button>'
    + '<button id="nzpub">Publish</button>'
    + '<span class="nzspacer"></span><span class="nzmsg" id="nzmsg"></span>';
  document.addEventListener('DOMContentLoaded', function(){ document.body.appendChild(bar); });
  if (document.readyState !== 'loading') document.body.appendChild(bar);

  function msg(t){ document.getElementById('nzmsg').textContent = t || ''; }
  function blocks(){ return document.querySelectorAll('[data-nz]'); }

  function setEditing(state){
    on = state;
    blocks().forEach(function(el){
      el.contentEditable = state ? 'true' : 'false';
      if (state && !el.dataset.nzBound){
        el.dataset.nzBound = '1';
        el.addEventListener('input', function(){
          dirty[el.getAttribute('data-nz')] = el.innerHTML;
          el.classList.add('nzdirty');
          document.getElementById('nzsave').disabled = false;
        });
        // Paste as plain text, so Word/browser styling never enters the file.
        el.addEventListener('paste', function(e){
          e.preventDefault();
          var t = (e.clipboardData || window.clipboardData).getData('text/plain');
          document.execCommand('insertText', false, t);
        });
      }
    });
    document.querySelectorAll('img').forEach(function(img){
      if (img.closest('#nzbar')) return;
      img.classList.toggle('nzimg-hot', state);
      if (state && !img.dataset.nzBound){ img.dataset.nzBound='1'; img.addEventListener('click', swap); }
    });
    document.getElementById('nztoggle').textContent = state ? 'Editing' : 'Edit';
    msg(state ? 'Click text to edit. Click an image to replace it.' : '');
  }

  // Images: the file is uploaded into Images/Content, then the <img> that owns it
  // is marked dirty by rewriting the parent block's HTML.
  function swap(e){
    e.preventDefault(); e.stopPropagation();
    var img = e.currentTarget;
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = function(){
      var f = inp.files[0]; if(!f) return;
      var fr = new FileReader();
      fr.onload = function(){
        msg('Uploading ' + f.name + '...');
        fetch('/__upload', {method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({name: f.name, data: fr.result})})
        .then(function(r){return r.json();})
        .then(function(j){
          if (j.error) return msg('Upload failed: ' + j.error);
          img.src = j.src;
          var host = img.closest('[data-nz]');
          if (host){
            dirty[host.getAttribute('data-nz')] = host.innerHTML;
            host.classList.add('nzdirty');
          } else {
            msg('Uploaded to ' + j.src + ' - image is outside an editable block, so update the src by hand.');
          }
          document.getElementById('nzsave').disabled = false;
          msg('Image replaced. Save to write it into the file.');
        });
      };
      fr.readAsDataURL(f);
    };
    inp.click();
  }

  document.getElementById('nztoggle').onclick = function(){ setEditing(!on); };

  document.getElementById('nzsave').onclick = function(){
    var edits = Object.keys(dirty).map(function(i){ return {index:i, html:dirty[i]}; });
    if (!edits.length) return msg('Nothing changed.');
    msg('Saving ' + edits.length + ' block(s)...');
    fetch('/__save', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({path: PATH, edits: edits})})
    .then(function(r){ return r.json(); })
    .then(function(j){
      if (j.error) return msg('Save failed: ' + j.error);
      dirty = {};
      document.querySelectorAll('.nzdirty').forEach(function(e){ e.classList.remove('nzdirty'); });
      document.getElementById('nzsave').disabled = true;
      msg('Saved ' + j.blocks + ' block(s) to ' + PATH);
    });
  };

  document.getElementById('nzpub').onclick = function(){
    if (Object.keys(dirty).length) return msg('Save first.');
    var m = prompt('Commit message:', 'Edits from the browser');
    if (m === null) return;
    msg('Publishing...');
    fetch('/__publish', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({message: m})})
    .then(function(r){ return r.json(); })
    .then(function(j){
      var bad = (j.steps||[]).filter(function(s){ return !s.ok && s.cmd.indexOf('commit') !== 0; });
      msg(bad.length ? ('Publish stopped at: ' + bad[0].cmd + ' - ' + bad[0].out)
                     : 'Published. Live in about a minute.');
    });
  };
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
