import sublime
import sublime_plugin
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import json
import threading
import os

STATUS_KEY = "toolhub_status"
IGNORE_DIRS = {'.git', 'node_modules', 'dist', '.next', 'build', 'coverage', '.cache', '__pycache__', '.venv'}

def update_status_bar(msg="⚡ ToolHub: Ready (9999)"):
    def _update():
        sublime.status_message(msg)
        win = sublime.active_window()
        if win and win.active_view():
            win.active_view().set_status(STATUS_KEY, msg)
    sublime.set_timeout(_update, 0)

# Хелпер для потокобезопасного выполнения функций Sublime API в главном UI-треде
def run_on_main_thread(fn, timeout=10.0):
    res = {"data": None, "error": None}
    evt = threading.Event()

    def _wrapper():
        try:
            res["data"] = fn()
        except Exception as e:
            res["error"] = e
        finally:
            evt.set()

    sublime.set_timeout(_wrapper, 0)
    if not evt.wait(timeout):
        raise TimeoutError("Sublime main thread timeout")

    if res["error"]:
        raise res["error"]
    return res["data"]

class ToolHubEventListener(sublime_plugin.EventListener):
    def on_activated(self, view):
        update_status_bar()

class ToolhubApplyPatchCommand(sublime_plugin.TextCommand):
    def run(self, edit, text, mode="replace_full"):
        if mode == "replace_selection":
            for region in self.view.sel():
                if not region.empty():
                    self.view.replace(edit, region, text)
        else:
            all_region = sublime.Region(0, self.view.size())
            self.view.replace(edit, all_region, text)

class ToolhubSearchReplaceCommand(sublime_plugin.TextCommand):
    def run(self, edit, find_text, replace_text, replace_all=True):
        if not find_text:
            return
        regions = self.view.find_all(find_text, sublime.LITERAL)
        if not regions:
            return
        if not replace_all:
            regions = regions[:1]
        for region in reversed(regions):
            self.view.replace(edit, region, replace_text)

class ReusableHTTPServer(HTTPServer):
    allow_reuse_address = True

class ToolHubHTTPHandler(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        try:
            body = json.dumps(data, ensure_ascii=False, default=str).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            print(f"⚠️ Error sending response: {e}")

    def _get_or_open_view(self, window, file_path):
        if not file_path:
            return window.active_view()

        abs_path = os.path.abspath(file_path)
        for view in window.views():
            if view.file_name() and os.path.abspath(view.file_name()) == abs_path:
                window.focus_view(view)
                return view

        # Если файл не открыт — открываем во вкладке
        opened_view = window.open_file(abs_path)
        return opened_view

    def do_GET(self):
        try:
            parsed_url = urlparse(self.path)
            path = parsed_url.path
            query_params = parse_qs(parsed_url.query)

            # 1. Считывание любого файла по пути (или активного, если path пуст)
            if path in ('/read-file', '/active-file'):
                requested_path = query_params.get('path', [None])[0]

                def _read_logic():
                    window = sublime.active_window()
                    if not window:
                        return {"error": "No active window in Sublime"}, 400

                    target_file = requested_path
                    if target_file and not os.path.isabs(target_file):
                        folders = window.folders()
                        if folders:
                            target_file = os.path.join(folders[0], target_file)

                    view = None
                    if target_file:
                        abs_target = os.path.abspath(target_file)
                        for v in window.views():
                            if v.file_name() and os.path.abspath(v.file_name()) == abs_target:
                                view = v
                                break

                    # Если файла нет в открытых вкладках, проверяем диск
                    if not view and target_file:
                        if not os.path.exists(target_file):
                            return {"error": f"File not found: {target_file}"}, 404
                        try:
                            with open(target_file, 'r', encoding='utf-8', errors='replace') as f:
                                content = f.read()
                            return {
                                "filePath": os.path.abspath(target_file),
                                "selection": "",
                                "fullContent": content,
                                "isOpenedInEditor": False
                            }, 200
                        except Exception as ex:
                            return {"error": f"Failed to read file from disk: {str(ex)}"}, 500

                    # Если путь не указан — берем активный view
                    if not view:
                        view = window.active_view()

                    if not view:
                        return {"error": "No active document in Sublime"}, 404

                    file_p = view.file_name() or "Unsaved Document"
                    sel_text = "".join([view.substr(r) for r in view.sel() if not r.empty()])
                    full_text = view.substr(sublime.Region(0, view.size()))

                    return {
                        "filePath": file_p,
                        "selection": sel_text,
                        "fullContent": full_text,
                        "isOpenedInEditor": True
                    }, 200

                res, status = run_on_main_thread(_read_logic)
                self._send_json(res, status)
                if status == 200:
                    update_status_bar("📖 [ToolHub] Файл успешно считан")

            # 2. Список файлов проекта
            elif path == '/project-files':
                def _files_logic():
                    window = sublime.active_window()
                    folders = window.folders() if window else []
                    if not folders:
                        return {"folders": [], "files": [], "totalCount": 0, "warning": "No project folders opened"}, 200

                    all_files = []
                    for folder in folders:
                        if not os.path.exists(folder):
                            continue
                        try:
                            for root, dirs, files in os.walk(folder, topdown=True, followlinks=True):
                                dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
                                for f in files:
                                    full_p = os.path.join(root, f)
                                    try:
                                        rel_p = os.path.relpath(full_p, folder)
                                        all_files.append(rel_p)
                                    except Exception:
                                        pass
                                    if len(all_files) >= 2000:
                                        break
                                if len(all_files) >= 2000:
                                    break
                        except Exception:
                            pass

                    return {
                        "folders": folders,
                        "files": all_files,
                        "totalCount": len(all_files)
                    }, 200

                res, status = run_on_main_thread(_files_logic)
                self._send_json(res, status)
                if status == 200:
                    update_status_bar(f"📂 [ToolHub] Найдено файлов: {res.get('totalCount', 0)}")

            else:
                self._send_json({"error": "Endpoint not found"}, 404)

        except Exception as e:
            print(f"❌ [ToolHub GET Error]: {e}")
            self._send_json({"error": f"Internal Sublime Bridge Error: {str(e)}"}, 500)

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body_bytes = self.rfile.read(length) if length > 0 else b'{}'
            body = json.loads(body_bytes.decode('utf-8')) if body_bytes else {}

            # 3. Точечный поиск и замена (с авто-открытием файла)
            if self.path == '/search-replace':
                file_path = body.get('filePath')
                find_text = body.get('find')
                replace_text = body.get('replace')
                replace_all = body.get('replaceAll', True)

                # Защита от пустых аргументов и галлюцинаций LLM
                if not find_text:
                    return self._send_json({"error": "Validation Error: 'find' parameter cannot be empty"}, 400)
                if replace_text is None:
                    return self._send_json({"error": "Validation Error: 'replace' parameter is required (can be empty string for deletion)"}, 400)

                def _replace_logic():
                    window = sublime.active_window()
                    if not window:
                        return {"error": "No active window in Sublime"}, 400

                    view = self._get_or_open_view(window, file_path)
                    if not view:
                        return {"error": f"Could not open or locate file: {file_path}"}, 404

                    full_content = view.substr(sublime.Region(0, view.size()))
                    if find_text not in full_content:
                        return {
                            "error": f"Target string not found in target file",
                            "find": find_text[:100]
                        }, 404

                    view.run_command("toolhub_search_replace", {
                        "find_text": find_text,
                        "replace_text": replace_text,
                        "replace_all": replace_all
                    })

                    return {
                        "success": True,
                        "message": "Search & replace complete!",
                        "filePath": view.file_name() or file_path
                    }, 200

                res, status = run_on_main_thread(_replace_logic)
                self._send_json(res, status)
                if status == 200:
                    update_status_bar("🎯 [ToolHub] Точечная замена выполнена!")

            # 4. Полный патч файла (с авто-открытием)
            elif self.path == '/apply-patch':
                file_path = body.get('filePath')
                patch_text = body.get('text')
                mode = body.get('mode', 'replace_full')

                if patch_text is None:
                    return self._send_json({"error": "Validation Error: 'text' parameter is required"}, 400)

                def _patch_logic():
                    window = sublime.active_window()
                    if not window:
                        return {"error": "No active window in Sublime"}, 400

                    view = self._get_or_open_view(window, file_path)
                    if not view:
                        return {"error": f"Could not open or locate file: {file_path}"}, 404

                    view.run_command("toolhub_apply_patch", {
                        "text": patch_text,
                        "mode": mode
                    })

                    return {
                        "success": True,
                        "message": "Patch applied successfully!",
                        "filePath": view.file_name() or file_path
                    }, 200

                res, status = run_on_main_thread(_patch_logic)
                self._send_json(res, status)
                if status == 200:
                    update_status_bar("✨ [ToolHub] Патч применён!")

            else:
                self._send_json({"error": "Endpoint not found"}, 404)

        except Exception as e:
            print(f"❌ [ToolHub POST Error]: {e}")
            self._send_json({"error": f"Internal Sublime Bridge Error: {str(e)}"}, 500)

    def log_message(self, format, *args):
        return

server_instance = None

def start_server():
    global server_instance
    try:
        server_instance = ReusableHTTPServer(('127.0.0.1', 9999), ToolHubHTTPHandler)
        update_status_bar("⚡ ToolHub: Ready (9999)")
        server_instance.serve_forever()
    except Exception as e:
        print(f"⚠️ ToolHub Bridge Error: {e}")

def plugin_loaded():
    threading.Thread(target=start_server, daemon=True).start()
    print("🚀 [ToolHub Bridge v3] Active on http://127.0.0.1:9999")

def plugin_unloaded():
    global server_instance
    if server_instance:
        server_instance.shutdown()