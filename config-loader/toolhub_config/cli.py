import argparse
import contextlib
import fcntl
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request

from . import __version__
from .config import ConfigError, load_config, read_document
from .database import apply_config, connect


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


HTTP = urllib.request.build_opener(NoRedirect, urllib.request.ProxyHandler({}))


def api(base, password, route, timeout=5, post=False):
    request = urllib.request.Request(base.rstrip('/') + '/admin/api/' + route,
                                    headers={'x-admin-password': password, 'Content-Type':'application/json'},
                                    data=b'{}' if post else None)
    with HTTP.open(request, timeout=timeout) as response:
        return json.load(response)


def sync_mcp(plan, database, base):
    db = connect(database)
    try:
        for path in plan['sync']:
            row = db.execute('SELECT id FROM Category WHERE fullPath=? AND type=\'MCP\'', (path,)).fetchone()
            if not row:
                raise ConfigError(f'MCP category missing: {path}')
            try:
                result = api(base, plan['settings']['adminPassword'], f'categories/{row[0]}/mcp-sync', timeout=70, post=True)
                if result.get('success') is not True:
                    raise ConfigError(f'MCP synchronization failed: {path}')
            except (OSError, ValueError, urllib.error.URLError):
                raise ConfigError(f'MCP synchronization failed: {path} (inspect ToolHub logs)') from None
            print(json.dumps({'synced':path, 'tools':result.get('count')}, ensure_ascii=False), flush=True)
    finally:
        db.close()


@contextlib.contextmanager
def lock(database):
    # Lifetime lock shared by loader invocations (serve keeps it until API exit).
    path = Path(str(Path(database).resolve()) + '.config.lock')
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ConfigError('Another loader/managed ToolHub already owns this database') from None
        yield
    finally:
        os.close(fd)


def _serve_locked(args, plan):
    ready = Path(args.ready_file)
    ready.unlink(missing_ok=True)
    child = None
    handlers = {}
    def stopped(signum, frame):
        raise SystemExit(128 + signum)
    try:
        for sig in (signal.SIGTERM, signal.SIGINT):
            handlers[sig] = signal.signal(sig, stopped)
        if args.init_schema:
            expected = 'file:' + str(Path(args.database).resolve())
            if os.environ.get('DATABASE_URL') != expected:
                raise ConfigError('--init-schema requires DATABASE_URL=file:<absolute --database path>')
            # Some Prisma 5 engine builds fail to create a missing SQLite file.
            # Create an empty file only; schema remains owned by upstream Prisma.
            fd = os.open(args.database, os.O_CREAT | os.O_WRONLY, 0o600)
            os.close(fd)
            child = subprocess.Popen(['bun','run','db:push','--skip-generate'],
                                     cwd=args.toolhub_dir, start_new_session=True)
            if child.wait() != 0:
                raise ConfigError('Prisma schema initialization failed')
            child = None
        print(json.dumps(apply_config(args.database, plan, backup_dir=args.backup_dir)), flush=True)
        env = dict(os.environ)
        # Do not pass Hub administration/agent credentials to arbitrary tool subprocesses.
        source = read_document(args.config)['settings']
        for key in (source['adminPasswordEnv'], source['agentSecretEnv']):
            env.pop(key, None)
        command = args.api_command or ['bun','run','apps/api/src/index.ts']
        child = subprocess.Popen(command, cwd=args.toolhub_dir, env=env, start_new_session=True)
        deadline = time.monotonic() + args.startup_timeout
        while True:
            if child.poll() is not None:
                raise ConfigError('ToolHub exited before startup completed')
            try:
                response = api(args.api_url, plan['settings']['adminPassword'], 'settings', timeout=1)
                if not isinstance(response, dict) or 'adminPassword' not in response:
                    raise ConfigError('Unexpected ToolHub API response')
                break
            except (OSError, ValueError, urllib.error.URLError):
                if time.monotonic() >= deadline:
                    raise ConfigError('Timed out waiting for ToolHub API') from None
                time.sleep(0.2)
        sync_mcp(plan, args.database, args.api_url)
        if child.poll() is not None:
            raise ConfigError('ToolHub exited during MCP synchronization')
        ready.write_text('ready\n')
        print('{"ready": true}', flush=True)
        return child.wait()
    finally:
        ready.unlink(missing_ok=True)
        if child is not None:
            # Include MCP processes, even when the API exited unexpectedly.
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
        for sig, handler in handlers.items():
            signal.signal(sig, handler)


def serve(args, plan):
    # Keep the lock until the API and all descendants have stopped, including
    # startup failure cleanup. A rejected second start must not remove readiness.
    with lock(args.database):
        return _serve_locked(args, plan)


def main(argv=None):
    parser = argparse.ArgumentParser(description='ToolHub offline configuration and startup (Linux/macOS).')
    parser.add_argument('--version', action='version', version=__version__)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('validate','check','apply','sync','serve'):
        p = sub.add_parser(name)
        p.add_argument('--config', required=True)
        p.add_argument('--mode', choices=('merge','reset'), help='Override mode from configuration')
        if name != 'validate':
            p.add_argument('--database', required=True, help='Absolute/local SQLite file path, not a file: URL')
        if name in ('apply','serve'):
            p.add_argument('--backup-dir', help='Reset backup destination; default: DB parent/backups')
        if name in ('sync','serve'):
            p.add_argument('--api-url', default='http://127.0.0.1:' + os.environ.get('PORT','3000'))
        if name == 'serve':
            p.add_argument('--init-schema', action='store_true', help='Run upstream Prisma db push under the startup lock')
            p.add_argument('--toolhub-dir', default='/opt/toolhub')
            p.add_argument('--ready-file', default='/tmp/toolhub-config.ready')
            p.add_argument('--startup-timeout', type=float, default=60)
            p.add_argument('--api-command', nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    try:
        plan = load_config(args.config, mode=args.mode)
        if args.command == 'validate':
            print(json.dumps({'valid':True, 'mode':plan['mode'], 'tools':len(plan['tools'])}))
        elif args.command == 'sync':
            sync_mcp(plan, args.database, args.api_url)
        elif args.command == 'serve':
            return serve(args, plan)
        else:
            with lock(args.database):
                print(json.dumps(apply_config(args.database, plan, check=args.command == 'check',
                                             backup_dir=getattr(args,'backup_dir',None))))
        return 0
    except ConfigError as exc:
        print(f'toolhub-config: {exc}', file=sys.stderr)
        return 2
    except (OSError, sqlite3.Error) as exc:
        # The exception text can contain data from a database or URL.
        print(f'toolhub-config: operation failed ({type(exc).__name__}); check paths, permissions and schema', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
