"""Offline SQLite reconciliation. Never run concurrently with ToolHub."""
import json
import os
from pathlib import Path
import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

from .config import ConfigError

# Fail on incompatible schema instead of trying to migrate another project's database.
REQUIRED = {
    'Category': 'id name slug isActive fullPath parentId appendPrompt type remoteUrl remoteToken mcpCommand mcpArgs mcpEnv mcpToolsCache mcpIsStateful createdAt',
    'Runner': 'id name type description config isActive',
    'Tool': 'id name slug descriptionMd agentDescription code packageJson inputSchema outputSchema examples isActive timeoutMs runnerId isMcpProxy mcpMethodName mcpSourceId createdAt updatedAt',
    'ToolCategory': 'id toolId categoryId',
    'ToolVersion': 'id toolId code inputSchema agentDescription createdAt',
    'SystemSetting': 'id rootPrompt rootAppendPrompt agentSecret adminPassword maxLogRetention',
    'ExecutionLog': 'id toolId',
}
DEFAULT_PROMPT = ('Use ToolHub listTools("/") to discover categories and tools. '
                  'Use absolute tool paths and follow their input schemas.\n{{AvailableResources}}')


def connect(path):
    path = Path(path).resolve()
    if not path.is_file():
        raise ConfigError('Database does not exist; run ToolHub prisma db push first')
    db = sqlite3.connect(path.as_uri() + '?mode=rw', uri=True, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    for table, expected in REQUIRED.items():
        columns = {row['name'] for row in db.execute(f'PRAGMA table_info("{table}")')}
        if not set(expected.split()) <= columns:
            db.close()
            raise ConfigError(f'Unsupported ToolHub database schema: {table}')
    return db


def js(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def insert(db, table, values):
    keys = list(values)
    return db.execute(f'INSERT INTO "{table}" ({",".join(keys)}) VALUES ({",".join("?" for _ in keys)})',
                      [values[k] for k in keys]).lastrowid


def update(db, table, row, values):
    changed = {k: v for k, v in values.items() if row[k] != v}
    if changed:
        db.execute(f'UPDATE "{table}" SET {",".join(k+"=?" for k in changed)} WHERE id=?',
                   [*changed.values(), row['id']])
    return bool(changed)


def reconcile(db, plan):
    if plan['mode'] == 'reset':
        # Keep schema/migration metadata. Reset also removes execution logs and history.
        for table in ('ExecutionLog', 'ToolVersion', 'ToolCategory', 'Tool', 'Category', 'Runner', 'SystemSetting'):
            db.execute(f'DELETE FROM "{table}"')
    settings = db.execute('SELECT * FROM SystemSetting').fetchall()
    if len(settings) > 1:
        raise ConfigError('Ambiguous database: more than one SystemSetting row')
    if settings:
        update(db, 'SystemSetting', settings[0], plan['settings'])
    else:
        insert(db, 'SystemSetting', dict(rootPrompt=DEFAULT_PROMPT, rootAppendPrompt='Use listTools("/folder") to navigate.',
                                        maxLogRetention=1000, **{k:v for k,v in plan['settings'].items() if k not in ('rootPrompt','rootAppendPrompt','maxLogRetention')}))
        row = db.execute('SELECT * FROM SystemSetting').fetchone()
        update(db, 'SystemSetting', row, plan['settings'])

    for runner in plan['runners']:
        values = dict(runner, config=js(runner['config']))
        row = db.execute('SELECT * FROM Runner WHERE name=?', (runner['name'],)).fetchone()
        if row:
            update(db, 'Runner', row, values)
        else:
            insert(db, 'Runner', values)

    category_ids = {}
    for full_path, cat in sorted(plan['categories'].items(), key=lambda kv: (kv[0].count('/'), kv[0])):
        parent = full_path.rpartition('/')[0]
        row = db.execute('SELECT * FROM Category WHERE fullPath=?', (full_path,)).fetchone()
        if row and row['type'] != cat['type']:
            raise ConfigError(f'Category type change requires reset or manual migration: {full_path}')
        if row and not cat['_explicit']:
            category_ids[full_path] = row['id']
            continue
        values = dict(name=cat['name'], slug=full_path.rsplit('/',1)[1], fullPath=full_path,
                      parentId=category_ids.get(parent), type=cat['type'], isActive=cat.get('isActive', True),
                      appendPrompt=cat.get('appendPrompt'), remoteUrl=cat.get('remoteUrl'), remoteToken=cat.get('remoteToken'),
                      mcpCommand=cat.get('mcpCommand'), mcpArgs=cat.get('mcpArgs'), mcpEnv=js(cat.get('mcpEnv', {})),
                      mcpIsStateful=cat.get('mcpIsStateful', False))
        if row:
            if any(row[k] != values[k] for k in ('mcpCommand','mcpArgs','mcpEnv','mcpIsStateful')):
                values['mcpToolsCache'] = None
            update(db, 'Category', row, values)
            category_ids[full_path] = row['id']
        else:
            category_ids[full_path] = insert(db, 'Category', values)

    for full_path, tool in plan['tools'].items():
        cat_id = category_ids[tool['_category']]
        runner_name = tool['_runner'] or tool.get('runnerName')
        if runner_name:
            runners = db.execute('SELECT * FROM Runner WHERE name=?', (runner_name,)).fetchall()
        elif tool.get('runnerType'):
            runners = db.execute('SELECT * FROM Runner WHERE type=?', (tool['runnerType'],)).fetchall()
        else:
            runners = []
        if len(runners) != 1 or not runners[0]['isActive']:
            raise ConfigError(f'Missing, inactive or ambiguous runner for tool: {full_path}')
        rows = db.execute('SELECT t.* FROM Tool t JOIN ToolCategory tc ON tc.toolId=t.id WHERE tc.categoryId=? AND t.slug=?',
                          (cat_id, tool['slug'])).fetchall()
        if len(rows) > 1:
            raise ConfigError(f'Ambiguous existing tool path: {full_path}')
        values = dict(name=tool['name'], slug=tool['slug'], agentDescription=tool.get('agentDescription',''),
                      descriptionMd=tool.get('descriptionMd'), code=tool.get('code') or '', packageJson=tool.get('packageJson') or '',
                      inputSchema=js(tool.get('inputSchema',{})), outputSchema=js(tool.get('outputSchema',{})),
                      examples=js(tool.get('examples',[])), timeoutMs=tool.get('timeoutMs',30000),
                      isActive=tool.get('isActive',True), runnerId=runners[0]['id'], isMcpProxy=False,
                      mcpMethodName=None, mcpSourceId=None)
        now = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        if rows:
            row = rows[0]
            if db.execute('SELECT count(*) FROM ToolCategory WHERE toolId=?', (row['id'],)).fetchone()[0] > 1:
                raise ConfigError(f'Tool has multiple category bindings; refusing an implicit shared update: {full_path}')
            changed = any(row[k] != v for k,v in values.items())
            if changed:
                update(db, 'Tool', row, dict(values, updatedAt=now))
            tool_id = row['id']
        else:
            changed = True
            tool_id = insert(db, 'Tool', dict(values, updatedAt=now))
            insert(db, 'ToolCategory', dict(toolId=tool_id, categoryId=cat_id))
        if changed:
            insert(db, 'ToolVersion', dict(toolId=tool_id, code=values['code'], inputSchema=values['inputSchema'],
                                          agentDescription=values['agentDescription']))
    # Reject preexisting gateway ancestors, even if absent from the input.
    for full_path in plan['categories']:
        parent = full_path.rpartition('/')[0]
        while parent:
            row = db.execute('SELECT type FROM Category WHERE fullPath=?', (parent,)).fetchone()
            if row and row['type'] != 'LOCAL':
                raise ConfigError(f'Existing gateway ancestor: {full_path}')
            parent = parent.rpartition('/')[0]
    if db.execute('PRAGMA foreign_key_check').fetchone():
        raise ConfigError('Foreign-key integrity check failed')
    return {'mode':plan['mode'], 'runners':len(plan['runners']), 'categories':len(plan['categories']),
            'tools':len(plan['tools']), 'mcpSync':len(plan['sync'])}


def apply_config(path, plan, check=False, backup_dir=None):
    db = connect(path)
    try:
        # Preflight against a consistent in-memory copy before backup or any destructive action.
        memory = sqlite3.connect(':memory:')
        memory.row_factory = sqlite3.Row
        db.backup(memory)
        memory.execute('PRAGMA foreign_keys=ON')
        try:
            with memory:
                summary = reconcile(memory, plan)
        finally:
            memory.close()
        if check:
            return dict(summary, checked=True)
        backup_path = None
        if plan['mode'] == 'reset':
            directory = Path(backup_dir or Path(path).resolve().parent / 'backups')
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            backup_path = directory / (datetime.now(timezone.utc).strftime('hub-%Y%m%dT%H%M%SZ-') + uuid4().hex[:8] + '.db')
            fd = os.open(backup_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(fd)
            backup = sqlite3.connect(backup_path)
            try:
                db.backup(backup)
            finally:
                backup.close()
        db.execute('BEGIN IMMEDIATE')
        try:
            summary = reconcile(db, plan)
            db.commit()
        except BaseException:
            db.rollback()
            raise
        if backup_path:
            summary['backup'] = str(backup_path)
        return summary
    finally:
        db.close()
