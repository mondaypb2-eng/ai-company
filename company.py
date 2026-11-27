"""AI Company - a team of Claude Code agents that build real projects on your PC.

Run:  python company.py     then open http://localhost:8765
Needs: Claude Code CLI installed and logged in (`claude` on PATH). Python stdlib only.
"""
import json, os, queue, re, shutil, subprocess, sys, threading, time, mimetypes, webbrowser
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

ROOT = Path(__file__).resolve().parent
PROJECTS = ROOT / "projects"
PROJECTS.mkdir(exist_ok=True)
PORT = int(os.environ.get("AI_COMPANY_PORT", "8765"))
CLAUDE = shutil.which("claude") or "claude"
AGENT_TIMEOUT = 25 * 60  # seconds per agent turn
TOOLS = "Bash,PowerShell,Read,Write,Edit,Glob,Grep"

MODELS = {
    "balanced": {"ceo": "sonnet", "pm": "sonnet", "des": "sonnet", "eng": "opus", "qa": "opus"},
    "opus": {k: "opus" for k in ("ceo", "pm", "des", "eng", "qa")},
    "sonnet": {k: "sonnet" for k in ("ceo", "pm", "des", "eng", "qa")},
}

COMMON = (
    "You are one member of a small AI software company. You work inside the project folder "
    "(your current working directory) and talk to teammates only through files in ./.company/. "
    "Work autonomously: never ask questions, make sensible decisions and write them down. "
    "Never touch anything outside the project folder. Never start a long-running process in the "
    "foreground (servers, watchers): start it in the background, use timeouts, and stop it before you finish. "
    "Prefer zero-install stacks (Python stdlib, plain Node.js, or static HTML/CSS/JS); if a package is truly "
    "needed, install it locally inside the project only. The machine is Windows with Git Bash and PowerShell; "
    "`python` and `node` are available. Human-facing text (docs, UI copy, your final message) is in Thai unless "
    "the brief asks otherwise. End your turn with a 1-3 sentence summary in Thai of what you did, for the team chat."
)
ROLES = {
    "ceo": "Your role: CEO. You turn a client brief into a clear, testable product spec and you sign off at the end.",
    "pm": "Your role: Project Manager. You break the spec into a short, ordered checklist of concrete tasks.",
    "des": "Your role: Architect & Designer. You decide the file structure, modules, data model and the visual design.",
    "eng": "Your role: Senior Engineer. You write production-quality code AND automated tests, run them, and fix until green.",
    "qa": "Your role: QA Lead. You are independent and strict. You verify by actually running things, not by trusting claims.",
}
NAMES = {"ceo": "บอสใหญ่", "pm": "พี่แพม", "des": "น้องดีไซน์", "eng": "เอ็นจิเนียร์บอม", "qa": "คิวเอ้"}


class Hub:
    """Fan-out of events to every open browser tab, with history replay."""
    def __init__(self):
        self.lock = threading.Lock(); self.subs = []; self.history = []

    def emit(self, **ev):
        ev["t"] = time.time()
        with self.lock:
            self.history.append(ev); self.history = self.history[-3000:]
            for q in self.subs: q.put(ev)

    def subscribe(self):
        q = queue.Queue()
        with self.lock:
            for ev in self.history: q.put(ev)
            self.subs.append(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            if q in self.subs: self.subs.remove(q)

    def reset(self):
        with self.lock: self.history = []


hub = Hub()


def slugify(text):
    s = re.sub(r"[^a-zA-Z0-9]+", "-", text.lower()).strip("-")[:30]
    return (s or "project") + "-" + time.strftime("%Y%m%d-%H%M%S")


def describe_tool(name, inp):
    inp = inp or {}
    p = inp.get("file_path") or inp.get("path") or inp.get("pattern") or ""
    p = Path(p).name if p and ("\\" in p or "/" in p) else p
    if name == "Write": return f"เขียนไฟล์ {p}"
    if name == "Edit": return f"แก้ไฟล์ {p}"
    if name == "Read": return f"อ่าน {p}"
    if name in ("Glob", "Grep"): return f"ค้นหา {p}"
    if name in ("Bash", "PowerShell"): return "รัน: " + str(inp.get("command", ""))[:90]
    return name


class Company:
    def __init__(self):
        self.proc = None; self.stopped = False; self.running = False
        self.project = None; self.cost = 0.0

    # one agent turn = one headless Claude Code run
    def agent(self, role, prompt, model):
        if self.stopped: raise RuntimeError("stopped")
        hub.emit(type="agent", id=role, state="working")
        hub.emit(type="say", id=role, text="กำลังคิด...")
        cmd = [CLAUDE, "-p", prompt, "--output-format", "stream-json", "--verbose",
               "--append-system-prompt", COMMON + "\n" + ROLES[role],
               "--tools", TOOLS, "--allowedTools", TOOLS.replace(",", " "),
               "--permission-mode", "acceptEdits", "--permission-prompts", "none",
               "--no-session-persistence", "--model", model]
        env = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDECODE")}
        flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        self.proc = subprocess.Popen(cmd, cwd=self.project, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     stdin=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace",
                                     env=env, creationflags=flags)
        timer = threading.Timer(AGENT_TIMEOUT, self.kill); timer.start()
        final, err_lines = "", []
        try:
            for line in self.proc.stdout:
                line = line.strip()
                if not line: continue
                try: ev = json.loads(line)
                except ValueError:
                    err_lines.append(line); continue
                t = ev.get("type")
                if t == "assistant":
                    for b in ev.get("message", {}).get("content", []):
                        if b.get("type") == "tool_use":
                            d = describe_tool(b.get("name"), b.get("input"))
                            hub.emit(type="say", id=role, text=d); hub.emit(type="tool", id=role, text=d)
                        elif b.get("type") == "text" and b.get("text", "").strip():
                            hub.emit(type="say", id=role, text=b["text"].strip()[-160:])
                elif t == "rate_limit_event":
                    w = ev.get("rate_limit_info", {}).get("unifiedWindows", {}).get("five_hour", {})
                    if "utilization" in w: hub.emit(type="quota", five_hour=w["utilization"])
                elif t == "result":
                    final = ev.get("result") or ""
                    self.cost += float(ev.get("total_cost_usd") or 0)
                    hub.emit(type="cost", usd=round(self.cost, 3))
                    if ev.get("is_error"): err_lines.append(final or ev.get("subtype", "error"))
            self.proc.wait()
        finally:
            timer.cancel()
        if self.stopped: raise RuntimeError("stopped")
        if self.proc.returncode != 0 and not final:
            raise RuntimeError(f"{NAMES[role]} ทำงานไม่สำเร็จ: " + " ".join(err_lines)[-400:])
        final = final.strip() or "(ไม่มีข้อความสรุป)"
        hub.emit(type="log", id=role, text=final)
        hub.emit(type="say", id=role, text=final[-160:])
        hub.emit(type="agent", id=role, state="idle")
        self.files()
        return final

    def kill(self):
        p = self.proc
        if p and p.poll() is None:
            if sys.platform == "win32":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(p.pid)], capture_output=True)
            else:
                p.kill()

    def stop(self):
        self.stopped = True; self.kill()

    def files(self):
        out = []
        for f in sorted(Path(self.project).rglob("*")):
            rel = f.relative_to(self.project).as_posix()
            if f.is_file() and not any(x in rel for x in ("node_modules/", "__pycache__/", ".git/", ".venv/")):
                out.append(rel)
        hub.emit(type="files", project=Path(self.project).name, files=out[:400])

    def qa_result(self):
        try:
            data = json.loads((Path(self.project) / ".company" / "qa.json").read_text(encoding="utf-8"))
            return bool(data.get("pass")), int(data.get("score", 0)), list(data.get("issues", []))
        except Exception as e:
            return False, 0, [f"QA ไม่ได้เขียน .company/qa.json ที่อ่านได้ ({e})"]

    def run(self, brief, max_rounds, preset, existing=None):
        m = MODELS.get(preset, MODELS["balanced"])
        self.running, self.stopped, self.cost = True, False, 0.0
        if existing:
            slug = existing
        else:
            ascii_ratio = len(re.findall(r"[a-zA-Z]", brief)) / max(1, len(brief))
            slug = slugify(brief if ascii_ratio > 0.5 else "project")
        self.project = str(PROJECTS / slug)
        (Path(self.project) / ".company").mkdir(parents=True, exist_ok=True)
        hub.reset()
        hub.emit(type="start", project=slug, brief=brief, max=max_rounds, change=bool(existing))
        try:
            if existing:
                with open(Path(self.project) / ".company" / "CHANGES.md", "a", encoding="utf-8") as f:
                    f.write(f"\n## {time.strftime('%Y-%m-%d %H:%M')}\n{brief}\n")
                self.agent("ceo", f"""Change request from the client for this EXISTING project (also appended to .company/CHANGES.md):
\"\"\"{brief}\"\"\"
Read README.md and .company/SPEC.md. Update .company/SPEC.md: add/adjust features and add numbered acceptance criteria for the
change (keep the existing ones unless the client asked to change them). Do not write code.""", m["ceo"])
                hub.emit(type="board", stage="วางแผน")
                self.agent("pm", "Read .company/SPEC.md and .company/CHANGES.md (latest entry). Append to .company/TASKS.md a new section "
                                 "for this change request: an ordered checklist (- [ ] ...) of concrete tasks mapped to the criteria. Do not write code.", m["pm"])
                self.agent("des", "Read .company/SPEC.md, the latest entry of .company/CHANGES.md and .company/DESIGN.md. Update DESIGN.md for the "
                                  "change (new modules, data, screens, states), keeping the existing visual language. Do not write application code.", m["des"])
                return self.build_loop(m, max_rounds)
            (Path(self.project) / ".company" / "BRIEF.md").write_text(brief, encoding="utf-8")
            self.agent("ceo", f"""New client brief (also saved in .company/BRIEF.md):
\"\"\"{brief}\"\"\"
Write .company/SPEC.md containing: project name, one-paragraph goal, target users, the tech stack you choose
(simplest that does the job well, runnable on this Windows PC), feature list, and 5-10 numbered acceptance criteria
that a tester can verify by running the software. Do not write code.""", m["ceo"])
            hub.emit(type="board", stage="วางแผน")
            self.agent("pm", "Read .company/SPEC.md. Write .company/TASKS.md: an ordered markdown checklist (- [ ] ...) "
                             "of 5-12 concrete engineering tasks, each mapped to acceptance criteria numbers. Do not write code.", m["pm"])
            self.agent("des", "Read .company/SPEC.md and .company/TASKS.md. Write .company/DESIGN.md: folder/file structure, "
                              "modules and their responsibilities, data model, how to run and how to test (exact commands), and if there "
                              "is a UI: layout, colour palette (hex), typography, key screens and states. Make the UI distinctive and polished. "
                              "Do not write application code.", m["des"])
            self.build_loop(m, max_rounds)
        except Exception as e:
            hub.emit(type="error", text="หยุดงานแล้ว" if self.stopped else str(e))
            for r in NAMES: hub.emit(type="agent", id=r, state="idle")
        finally:
            self.running, self.proc = False, None
            if self.project: self.files()

    def build_loop(self, m, max_rounds):
        """Engineer <-> QA until QA passes. A pass that still lists issues earns one extra polish round."""
        slug = Path(self.project).name
        passed, score, issues, polished = False, 0, [], False
        for r in range(1, max_rounds + 1):
            hub.emit(type="board", stage="พัฒนา", round=r, max=max_rounds, score=score)
            if r == 1:
                fix = ""
            elif passed:
                fix = ("\nQA passed the previous round but listed remaining issues in .company/qa.json and .company/QA_REPORT.md. "
                       "This is a polish round: fix every listed issue without breaking anything, then re-run all tests.")
            else:
                fix = ("\nQA rejected the previous round. Read .company/QA_REPORT.md and .company/qa.json and fix EVERY issue, "
                       "then re-run all tests.")
            self.agent("eng", f"""Round {r} of {max_rounds}.
Read .company/SPEC.md, .company/TASKS.md and .company/DESIGN.md.{fix}
Implement the project in the project root, following the design. Write automated tests (Python unittest, node:test,
or a small test script; no heavy frameworks unless already chosen) and RUN them; fix until they pass.
Keep .company/RUN.md up to date with exactly two sections: 'Run:' (command to start/use the app) and 'Test:' (one command that runs all tests).
Tick finished tasks in .company/TASKS.md (- [x]).""", m["eng"])
            self.agent("qa", f"""Round {r} QA. Do NOT edit application source files; you may only write in .company/ and qa_tests/.
1. Read .company/SPEC.md (acceptance criteria) and .company/RUN.md.
2. Run the Test command and record the result.
3. Actually exercise the software: run the CLI with real inputs, or start the server in the background, hit its endpoints
   with curl/python, then stop it; for browser pages, at least syntax-check every script (node --check) and verify that
   every element/ID the JS uses exists in the HTML. Write extra checks in qa_tests/ if useful.
4. Check each acceptance criterion one by one.
5. Write .company/QA_REPORT.md (Thai): per-criterion PASS/FAIL with evidence, plus bugs found.
6. Write .company/qa.json with exactly: {{"pass": true|false, "score": 0-100, "issues": ["specific, actionable problems"]}}.
   pass=true only if every criterion passes, all tests pass and score >= 85.""", m["qa"])
            passed, score, issues = self.qa_result()
            hub.emit(type="board", stage="ตรวจงาน", round=r, max=max_rounds, score=score)
            hub.emit(type="qa", round=r, passed=passed, score=score, issues=issues)
            passed = passed and score >= 85
            # clean pass -> done; pass that still lists issues -> one polish round (if rounds remain)
            if passed and (not issues or polished): break
            if passed: polished = True
        verdict = "ผ่าน QA" if passed else f"ยังไม่ผ่าน QA หลัง {max_rounds} รอบ"
        self.agent("ceo", f"""The team finished ({verdict}, QA score {score}). Read .company/QA_REPORT.md, .company/RUN.md and .company/CHANGES.md if present.
Write or update README.md for the client (Thai): what the project is, how to run it, how to test it, and honest known issues.
Your final message is the hand-over to the client.""", m["ceo"])
        hub.emit(type="done", passed=passed, score=score, project=slug, usd=round(self.cost, 3))


co = Company()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)): body = json.dumps(body, ensure_ascii=False)
        if isinstance(body, str): body = body.encode("utf-8")
        self.send_response(code); self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def safe(self, project, rel=""):
        base = (PROJECTS / project).resolve()
        target = (base / rel).resolve()
        if PROJECTS.resolve() not in base.parents or (target != base and base not in target.parents):
            return None
        return target

    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        if u.path == "/":
            return self.send(200, (ROOT / "office.html").read_bytes(), "text/html; charset=utf-8")
        if u.path == "/pixel-office.js":
            return self.send(200, (ROOT / "pixel-office.js").read_bytes(), "text/javascript; charset=utf-8")
        if u.path == "/api/events":
            self.send_response(200); self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache"); self.end_headers()
            sub = hub.subscribe()
            try:
                while True:
                    try: ev = sub.get(timeout=15); data = "data: " + json.dumps(ev, ensure_ascii=False) + "\n\n"
                    except queue.Empty: data = ": ping\n\n"
                    self.wfile.write(data.encode("utf-8")); self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                pass
            finally:
                hub.unsubscribe(sub)
            return
        if u.path == "/api/state":
            return self.send(200, {"running": co.running, "project": Path(co.project).name if co.project else None})
        if u.path == "/api/projects":
            ps = sorted([p.name for p in PROJECTS.iterdir() if p.is_dir() and not p.name.startswith("_")], reverse=True)
            return self.send(200, ps)
        if u.path == "/api/file":
            t = self.safe(q.get("project", [""])[0], q.get("path", [""])[0])
            if not t or not t.is_file(): return self.send(404, {"error": "not found"})
            return self.send(200, t.read_bytes()[:400000].decode("utf-8", "replace"), "text/plain; charset=utf-8")
        if u.path == "/api/files":
            t = self.safe(q.get("project", [""])[0])
            if not t or not t.is_dir(): return self.send(404, [])
            fs = [f.relative_to(t).as_posix() for f in sorted(t.rglob("*")) if f.is_file()
                  and not any(x in f.as_posix() for x in ("node_modules/", "__pycache__/", ".git/"))]
            return self.send(200, fs[:400])
        if u.path.startswith("/preview/"):
            parts = unquote(u.path[len("/preview/"):]).split("/", 1)
            rel = parts[1] if len(parts) > 1 and parts[1] else "index.html"
            t = self.safe(parts[0], rel)
            if t and t.is_dir(): t = t / "index.html"
            if not t or not t.is_file(): return self.send(404, "ไม่พบไฟล์", "text/plain; charset=utf-8")
            return self.send(200, t.read_bytes(), mimetypes.guess_type(t.name)[0] or "application/octet-stream")
        self.send(404, {"error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get("Content-Length") or 0)
        try: body = json.loads(self.rfile.read(n) or b"{}")
        except ValueError: body = {}
        if u.path == "/api/start":
            if co.running: return self.send(409, {"error": "ทีมกำลังทำงานอยู่"})
            brief = str(body.get("brief", "")).strip()
            if not brief: return self.send(400, {"error": "กรุณาใส่โจทย์"})
            rounds = max(1, min(10, int(body.get("rounds", 4))))
            existing = str(body.get("project") or "").strip() or None
            if existing:
                target = self.safe(existing)
                if not target or not target.is_dir():
                    return self.send(404, {"error": "ไม่พบโปรเจกต์นี้"})
            threading.Thread(target=co.run, args=(brief, rounds, body.get("preset", "balanced"), existing), daemon=True).start()
            return self.send(200, {"ok": True})
        if u.path == "/api/stop":
            co.stop(); return self.send(200, {"ok": True})
        if u.path == "/api/open":
            t = self.safe(str(body.get("project", "")))
            if t and t.is_dir() and sys.platform == "win32": os.startfile(str(t))
            return self.send(200, {"ok": bool(t)})
        self.send(404, {"error": "not found"})


if __name__ == "__main__":
    for s in (sys.stdout, sys.stderr):
        try: s.reconfigure(encoding="utf-8", errors="replace")
        except Exception: pass
    if not shutil.which("claude"):
        print("ไม่พบคำสั่ง claude - ติดตั้ง Claude Code และล็อกอินก่อน"); sys.exit(1)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://localhost:{PORT}"
    print(f"AI Company เปิดแล้วที่ {url}  (กด Ctrl+C เพื่อปิด)")
    if "--no-browser" not in sys.argv: webbrowser.open(url)
    try: srv.serve_forever()
    except KeyboardInterrupt: co.stop()
