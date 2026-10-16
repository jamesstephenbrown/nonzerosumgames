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


def img_spans(src):
    """Every <img> tag's position, counted over the raw source including any in
    comments, so the numbering is identical when serving and when saving.

    Scanned character by character rather than with <img[^>]*>, because a ">"
    inside a quoted attribute is legal and common here - alt text on this site
    uses it as an arrow ("Light Sensitivity > Movement > Eyes"). A naive regex
    ends the tag at that arrow, which both corrupts the attribute when markers
    are inserted and invents a tag with no alt text out of the remainder."""
    spans = []
    for m in re.finditer(r"<img\b", src, re.I):
        i, quote = m.end(), None
        while i < len(src):
            c = src[i]
            if quote:
                if c == quote:
                    quote = None
            elif c in "\"'":
                quote = c
            elif c == ">":
                spans.append((m.start(), i + 1))
                break
            i += 1
    return spans


def attr_re(name):
    """Either quote style. Single quotes are used here whenever the value itself
    contains a double quote, e.g. alt='"WIN!" say both the hawks'."""
    return re.compile(r"\b" + name + r"""\s*=\s*("([^"]*)"|'([^']*)')""", re.I)


def get_attr(tag, name):
    m = attr_re(name).search(tag)
    if not m:
        return None
    return m.group(2) if m.group(2) is not None else m.group(3)


def set_attr(tag, name, value):
    """Rewrite one attribute inside a single tag, leaving the rest of it alone.

    ">" is escaped as well as "<": a raw ">" inside an attribute would end the
    tag as far as tag-matching is concerned, splitting one tag into two. The
    original quote style is kept, so a hand-written alt='...' stays that way."""
    raw = value or ""
    m = attr_re(name).search(tag)
    single = bool(m and m.group(3) is not None)
    v = raw.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    v = v.replace("'", "&#39;") if single else v.replace('"', "&quot;")
    q = "'" if single else '"'
    if m:
        return tag[:m.start()] + f"{name}={q}{v}{q}" + tag[m.end():]
    if tag.rstrip().endswith("/>"):
        return tag.rstrip()[:-2].rstrip() + f' {name}="{v}" />'
    return tag.rstrip()[:-1].rstrip() + f' {name}="{v}">'


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

    # Number the images too, so alt text and src can be edited even when the
    # image sits outside any editable block - which on this site is most of them.
    imgs, prev, n = [], 0, 0
    for a, b in img_spans(page):
        tag = page[a:b]
        close = tag.rstrip().endswith("/>")
        new = (tag.rstrip()[:-2].rstrip() if close else tag.rstrip()[:-1].rstrip()) \
            + f' data-nz-img="{n}"' + ("/>" if close else ">")
        imgs.append(page[prev:a]); imgs.append(new); prev = b; n += 1
    imgs.append(page[prev:])
    page = "".join(imgs)

    blob = ("<style>" + EDITOR_CSS + "</style><script>"
            + EDITOR_JS.replace("__PATH__", json.dumps(path)) + "</script>")
    at = page.lower().rfind("</body>")
    return (page[:at] + blob + page[at:]) if at != -1 else page + blob


# --------------------------------------------------------------------------
# Writing changes back
# --------------------------------------------------------------------------

# Any data-nz* attribute, not a list of specific ones: an earlier version listed
# data-nz and data-nz-new, so data-nz-img was written straight into a page.
STRIP_ATTRS = re.compile(
    r'''\s+(?:data-nz[\w-]*|contenteditable|spellcheck)\s*=\s*("[^"]*"|'[^']*')''', re.I)
EDITOR_CLASSES = ("nzdirty", "nzimg-hot", "nzfocus", "nzflash")


def clean(fragment):
    """Remove the editor's own bookkeeping before anything touches the file."""
    frag = STRIP_ATTRS.sub("", fragment)

    def declass(m):
        kept = [c for c in m.group(2).split() if c not in EDITOR_CLASSES]
        return f' class="{" ".join(kept)}"' if kept else ""
    frag = re.sub(r'\s*class\s*=\s*(["\'])([^"\']*)\1', declass, frag)
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
        elif kind == "img":
            # Only the named attributes of one <img> change; nothing else in the
            # tag, and nothing around it, is touched.
            a, b = img_spans(src)[int(op["index"])]
            tag = src[a:b]
            for name in ("alt", "src"):
                if name in op:
                    tag = set_attr(tag, name, op[name])
            splices.append((a, b, tag))
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
# Read-only inspection: page check, and the list of pages for the link picker
# --------------------------------------------------------------------------

SKIP_SCHEMES = ("http://", "https://", "//", "mailto:", "tel:", "javascript:", "data:", "#")
HEAVY_IMAGE_BYTES = 500_000


def list_pages():
    """Every page at the top level, with its <h1>, for the link picker."""
    out = []
    for fn in sorted(os.listdir(ROOT)):
        if not fn.endswith(".html") or fn.startswith("_"):
            continue
        try:
            s = open(os.path.join(ROOT, fn), encoding="utf-8", errors="ignore").read(6000)
        except OSError:
            continue
        m = re.search(r"<h1[^>]*>(.*?)</h1>", s, re.S) or re.search(r"<title>(.*?)</title>", s, re.S)
        title = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).strip() if m else ""
        out.append({"file": fn, "title": title[:70]})
    return out


def check_page(relpath):
    """Report broken local targets, missing alt text and heavy images.

    Read-only: it never writes, so it cannot affect the markup. External URLs are
    counted but not fetched - no network calls, no waiting."""
    full = safe_path(relpath)
    src = open(full, encoding="utf-8", errors="ignore").read()
    # Commented-out markup is not live, so it should not be reported as broken -
    # placeholders parked in comments are a normal way to stage the next post.
    src = re.sub(r"<!--.*?-->", "", src, flags=re.S)
    base = os.path.dirname(full)
    missing, noalt, heavy = [], [], []
    external = 0

    # Script and style bodies are not markup: the menu loader on every page
    # contains $("a[href='" + pageName + "']"), which otherwise reads as a link
    # to a file literally named '" + pageName + "'.
    link_src = re.sub(r"<(script|style)\b.*?</\1>", "", src, flags=re.S | re.I)

    for attr, _, dq, sq in re.findall(r'''\b(href|src)\s*=\s*("([^"]*)"|'([^']*)')''', link_src):
        url = dq if dq else sq
        u = url.strip()
        if not u or u.startswith(SKIP_SCHEMES):
            if u.startswith(("http://", "https://", "//")):
                external += 1
            continue
        target = u.split("?")[0].split("#")[0]
        if not target:
            continue
        cand = os.path.normpath(os.path.join(base, target.lstrip("/") if target.startswith("/") else target))
        if target.startswith("/"):
            cand = os.path.normpath(os.path.join(ROOT, target.lstrip("/")))
        if os.path.exists(cand) or os.path.exists(cand + ".html") or os.path.isdir(cand):
            continue
        missing.append({"attr": attr, "url": u})

    for a, b in img_spans(src):
        tag = src[a:b]
        u = get_attr(tag, "src") or ""
        alt_val = get_attr(tag, "alt")
        if alt_val is None or not alt_val.strip():
            noalt.append({"url": u})
        if u and not u.startswith(SKIP_SCHEMES):
            p = os.path.normpath(os.path.join(base, u))
            if os.path.isfile(p):
                size = os.path.getsize(p)
                if size > HEAVY_IMAGE_BYTES:
                    heavy.append({"url": u, "kb": round(size / 1024)})

    # The same alt text on two different pictures almost always means an <img>
    # block was copied and the description never updated. The same alt on the
    # same picture is fine, so compare by distinct src.
    by_alt = {}
    for a, b in img_spans(src):
        tag = src[a:b]
        av, sv = get_attr(tag, "alt"), get_attr(tag, "src")
        if not av or not av.strip() or not sv:
            continue
        by_alt.setdefault(av.strip(), set()).add(sv)
    dupes = [{"alt": k, "urls": sorted(v)} for k, v in by_alt.items() if len(v) > 1]
    dupes.sort(key=lambda d: -len(d["urls"]))

    return {"page": relpath, "missing": missing, "noalt": noalt, "dupes": dupes,
            "heavy": heavy, "external": external}


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

        if parsed.path == "/__pages":
            return self._json(200, {"pages": list_pages()})

        if parsed.path == "/__check":
            want = (qs.get("path") or ["index.html"])[0]
            try:
                return self._json(200, check_page(want))
            except Exception as exc:
                return self._json(500, {"error": str(exc)})

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
 font:13px/1.3 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 -2px 12px rgba(0,0,0,.3);
 isolation:isolate;pointer-events:auto}
#nzbar *{pointer-events:auto}
/* The site's subscribe link is fixed to the bottom-left corner at 200% size -
   exactly where the Edit and Save buttons sit - and will take the clicks. Push
   the page up and move that link clear while the editor is on screen. */
body{padding-bottom:64px}
.subscribe{bottom:64px !important;z-index:1 !important}
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
#nzpanel{position:fixed;right:14px;bottom:56px;width:min(430px,92vw);max-height:62vh;overflow:auto;
 z-index:2147483647;background:#fff;color:#17324d;border-radius:12px;padding:14px 16px;
 box-shadow:0 8px 30px rgba(0,0,0,.35);font:13px/1.45 -apple-system,BlinkMacSystemFont,sans-serif}
#nzpanel h4{margin:0 0 8px;font-size:14px}
#nzpanel ul{margin:4px 0 12px;padding-left:18px}
#nzpanel li{margin:3px 0;word-break:break-word}
#nzpanel .ok{color:#1a7f4f}
#nzpanel .bad{color:#c0392b;font-weight:600}
#nzpanel input{width:100%;box-sizing:border-box;padding:7px 9px;margin:6px 0;border:1px solid #cbd6e2;border-radius:7px;font:inherit}
#nzpanel .row{padding:6px 8px;border-radius:6px;cursor:pointer}
#nzpanel .row:hover{background:#eaf6ff}
#nzpanel .row b{display:block}
#nzpanel .row span{opacity:.6;font-size:12px}
#nzpanel .close{float:right;cursor:pointer;opacity:.5;font-size:16px;line-height:1}
.nzflash{animation:nzflash 1.6s ease}
@keyframes nzflash{0%,100%{background:transparent}30%{background:rgba(255,80,80,.35)}}
"""

EDITOR_JS = r"""
(function(){
  var PATH = __PATH__, on = false, last = null, leaving = false;
  var repl = {};        // index -> new innerHTML
  var dels = {};        // index -> true
  var imgOps = {};      // image index -> {alt, src} for images outside any block
  var structural = false;

  var bar = document.createElement('div');
  bar.id = 'nzbar';
  bar.innerHTML =
      '<button type="button" id="nztoggle">Edit</button>'
    + '<button type="button" id="nzpara" class="sec">+ Para</button>'
    + '<button type="button" id="nzimg"  class="sec">+ Image</button>'
    + '<button type="button" id="nzlink" class="sec">Link</button>'
    + '<button type="button" id="nzcheck" class="sec">Check</button>'
    + '<button type="button" id="nzup"   class="sec" title="Move up">&#9650;</button>'
    + '<button type="button" id="nzdown" class="sec" title="Move down">&#9660;</button>'
    + '<button type="button" id="nzdel"  class="sec" title="Delete block">Delete</button>'
    + '<button type="button" id="nzsave" disabled>Save</button>'
    + '<button type="button" id="nzpub">Publish</button>'
    + '<span class="nzspacer"></span><span class="nzmsg" id="nzmsg"></span>'
    + '<button type="button" id="nzundo" class="sec">Undo</button>'
    + '<button type="button" id="nzexit" class="sec">Exit</button>';

  function msg(t){ var e=document.getElementById('nzmsg'); if(e) e.textContent=t||''; }
  function dirtyCount(){ return Object.keys(repl).length + Object.keys(dels).length
                              + Object.keys(imgOps).length
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

  // Shared popover for the link picker and the check report.
  function closePanel(){
    var old = document.getElementById('nzpanel');
    if (old) old.parentNode.removeChild(old);
  }
  function panel(title){
    closePanel();
    var p = document.createElement('div');
    p.id = 'nzpanel';
    var h = document.createElement('div');
    h.innerHTML = '<span class="close">&times;</span><h4>' + title + '</h4>';
    h.querySelector('.close').onclick = closePanel;
    p.appendChild(h);
    document.body.appendChild(p);
    return p;
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

  // An image inside an editable block rides along when that block is saved.
  // One outside any block (most of them here) is saved as a targeted attribute
  // change to that single <img> tag instead.
  function imageChanged(img){
    var host = img.closest('[data-nz],[data-nz-new]');
    if (host){ markDirty(host); return; }
    var i = img.getAttribute('data-nz-img');
    if (i === null) return msg('That image cannot be addressed; edit it in the file.');
    imgOps[i] = {index:i, alt: img.getAttribute('alt') || '', src: img.getAttribute('src')};
    img.classList.add('nzdirty');
    touched();
  }

  function swap(img){
    var p = panel('Image');
    var prev = document.createElement('img');
    prev.src = img.getAttribute('src');
    prev.style.cssText = 'max-width:100%;max-height:120px;display:block;margin:4px 0 10px;border-radius:6px';
    p.appendChild(prev);

    var lab = document.createElement('div');
    lab.innerHTML = '<b>Alt text</b> <span style="opacity:.6">(what a screen reader says)</span>';
    p.appendChild(lab);
    var alt = document.createElement('input');
    alt.value = img.getAttribute('alt') || '';
    alt.placeholder = 'Describe the picture';
    p.appendChild(alt);
    alt.oninput = function(){ img.setAttribute('alt', alt.value); imageChanged(img); };

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Replace image...';
    btn.style.cssText = 'margin-top:8px;font:inherit;font-weight:600;border:0;border-radius:7px;padding:7px 12px;background:#33ffcc;color:#17324d;cursor:pointer';
    btn.onclick = function(){
      pickFile(function(src){
        img.src = src; prev.src = src;
        imageChanged(img);
        msg('Image replaced. Save to write it in.');
      });
    };
    p.appendChild(btn);

    var note = document.createElement('p');
    note.style.cssText = 'margin:10px 0 0;opacity:.6';
    note.textContent = 'Changes are written when you press Save.';
    p.appendChild(note);
    alt.focus();
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

    // Opening the picker moves focus, which destroys the selection, so keep a
    // copy of the range and restore it before the link is applied.
    var saved = sel.getRangeAt(0).cloneRange();

    fetch('/__pages').then(function(r){ return r.json(); }).then(function(d){
      var p = panel('Link to');
      var filter = document.createElement('input');
      filter.placeholder = 'Filter pages, or paste a full https:// address';
      p.appendChild(filter);
      var list = document.createElement('div');
      p.appendChild(list);

      function apply(url){
        closePanel();
        var s = window.getSelection();
        s.removeAllRanges(); s.addRange(saved);
        document.execCommand('createLink', false, url);
        host.querySelectorAll('a[href="' + url + '"]').forEach(function(a){
          // Match the site convention: outside links open in a new tab.
          if (/^https?:\/\//i.test(url) && url.indexOf('nonzerosum.games') === -1)
            a.setAttribute('target', '_blank');
        });
        markDirty(host);
        msg('Linked to ' + url);
      }

      function draw(){
        var q = filter.value.toLowerCase().trim();
        list.innerHTML = '';
        if (/^https?:\/\//i.test(filter.value.trim())){
          var ext = document.createElement('div');
          ext.className = 'row';
          ext.innerHTML = '<b>Use this address</b><span>' + filter.value.trim()
                        + ' - opens in a new tab</span>';
          ext.onclick = function(){ apply(filter.value.trim()); };
          list.appendChild(ext);
          return;
        }
        d.pages.filter(function(pg){
          return !q || pg.file.toLowerCase().indexOf(q) > -1
                    || (pg.title || '').toLowerCase().indexOf(q) > -1;
        }).slice(0, 60).forEach(function(pg){
          var row = document.createElement('div');
          row.className = 'row';
          row.innerHTML = '<b>' + (pg.title || pg.file) + '</b><span>' + pg.file + '</span>';
          row.onclick = function(){ apply(pg.file); };
          list.appendChild(row);
        });
      }
      filter.oninput = draw; draw(); filter.focus();
    });
  };

  document.getElementById('nzcheck').onclick = function(){
    msg('Checking page...');
    fetch('/__check?path=' + encodeURIComponent(PATH))
    .then(function(r){ return r.json(); })
    .then(function(j){
      if (j.error) return msg('Check failed: ' + j.error);
      msg('');
      var p = panel('Check: ' + j.page);
      function section(title, items, render){
        var h = document.createElement('h4');
        h.innerHTML = title + ' ' + (items.length
          ? '<span class="bad">' + items.length + '</span>'
          : '<span class="ok">none</span>');
        p.appendChild(h);
        if (!items.length) return;
        var ul = document.createElement('ul');
        items.forEach(function(it){
          var li = document.createElement('li');
          li.innerHTML = render(it);
          li.style.cursor = 'pointer';
          li.onclick = function(){ reveal(it.url); };
          ul.appendChild(li);
        });
        p.appendChild(ul);
      }
      section('Broken links and images', j.missing, function(i){
        return '<code>' + i.attr + '</code> &rarr; ' + i.url; });
      section('Images with no alt text', j.noalt, function(i){
        return i.url || '(no src)'; });
      section('Same alt on different pictures', (j.dupes || []).map(function(d){
        return {url: d.urls[0], alt: d.alt, urls: d.urls};
      }), function(i){
        return '&ldquo;' + i.alt + '&rdquo;<br><span style="opacity:.65">'
             + i.urls.join('<br>') + '</span>'; });
      section('Heavy images', j.heavy, function(i){
        return i.url + ' &mdash; ' + i.kb + ' KB'; });
      var foot = document.createElement('p');
      foot.style.cssText = 'margin:10px 0 0;opacity:.6';
      foot.textContent = j.external + ' external link(s) not checked. Click any item to jump to it.';
      p.appendChild(foot);
    });
  };

  function reveal(url){
    if (!url) return;
    var el = document.querySelector('[src="' + url + '"],[href="' + url + '"]');
    if (!el) return msg('Could not locate that on the page.');
    el.scrollIntoView({behavior:'smooth', block:'center'});
    el.classList.add('nzflash');
    setTimeout(function(){ el.classList.remove('nzflash'); }, 1800);
  }

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
    Object.keys(imgOps).forEach(function(i){
      ops.push({op:'img', index:i, alt:imgOps[i].alt, src:imgOps[i].src});
    });

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
      // Clear the dirty state BEFORE reloading, or the beforeunload guard below
      // fires against our own reload and asks whether to leave the page.
      repl = {}; dels = {}; imgOps = {}; structural = false; leaving = true;
      document.querySelectorAll('[data-nz-new]').forEach(function(n){
        n.removeAttribute('data-nz-new');
      });
      touched();
      msg('Saved. Reloading...');
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
    if (leaving) return;                 // our own reload, after a successful save
    if (dirtyCount()){ e.preventDefault(); e.returnValue = ''; }
  });
  }

  // Click probe. The handlers are attached, so if a button still does nothing
  // the click is landing on something else. This reports, in the bar, whatever
  // element is actually topmost at the point clicked.
  document.addEventListener('click', function(e){
    var hit = document.elementFromPoint(e.clientX, e.clientY);
    var bx = bar.getBoundingClientRect();
    var overBar = e.clientY >= bx.top;
    if (!overBar) return;
    var desc = hit ? (hit.tagName.toLowerCase()
                     + (hit.id ? '#' + hit.id : '')
                     + (hit.className && typeof hit.className === 'string'
                        ? '.' + hit.className.trim().split(/\s+/).join('.') : ''))
                   : 'nothing';
    var m = document.getElementById('nzmsg');
    if (m) m.textContent = 'click hit: ' + desc;
  }, true);

  // If anything in here throws, the bar can end up on screen with no handlers
  // attached - buttons that look fine and do nothing. Surface it instead.
  function safeInit(){
    try {
      init();
      // Visible proof that every handler attached. If you can see this text but
      // the buttons do nothing, the script is fine and something is sitting on
      // top of the bar intercepting the clicks.
      var t = document.getElementById('nztoggle');
      var wired = typeof t.onclick === 'function';
      // Put the diagnosis on the button itself. If this reads "Edit (2)" there
      // are two bars on the page: getElementById wires the first while the
      // second is the one on screen, which would look exactly like dead buttons.
      var bars = document.querySelectorAll('#nzbar').length;
      t.textContent = 'Edit (' + bars + ')';
      bar.querySelectorAll('#nztoggle').forEach(function(b){
        b.textContent = 'Edit (' + bars + ')';
      });
      msg(wired ? 'ready' : 'WIRING FAILED');
      // Unmissable signal: the whole bar turns GREEN once every handler is
      // attached. Dark blue means the script never got this far. No hunting for
      // small text, no console needed.
      bar.style.background = wired ? '#1a7f4f' : '#8b1a1a';
    }
    catch (err) {
      var m = document.getElementById('nzmsg');
      if (m) m.textContent = 'Editor error: ' + (err && err.message ? err.message : err);
      try { bar.style.background = '#8b1a1a'; } catch (e) {}
      console.error('[nz editor]', err);
    }
  }
  window.addEventListener('error', function(e){
    var m = document.getElementById('nzmsg');
    if (m && !m.textContent) m.textContent = 'Page error: ' + e.message;
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safeInit);
  else safeInit();
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
