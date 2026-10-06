"""Optional native integration: TOOLHUB_DIR and BUN_BIN select a prepared upstream checkout."""
import asyncio
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request

import pytest
import yaml
from test_domains import fixture, generate


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


@pytest.mark.skipif(not os.environ.get('TOOLHUB_DIR'), reason='requires prepared ToolHub checkout and Bun')
def test_router_worker_bridge(fixture, tmp_path, monkeypatch):
    for key in list(os.environ):
        if key.lower().endswith("_proxy"):
            monkeypatch.delenv(key)
    source, config, _ = fixture
    root = Path(generate(source)['root'])
    worker_port, router_port, bridge_port = port(), port(), port()
    # Native equivalents of container bind mounts and service DNS.
    pack = root/'config/worker/echo.toolpack'
    pack.write_text(pack.read_text().replace('/tools/echo/', str(root/'tools/echo')+'/'))
    router = root/'config/_router_/toolhub.yaml'
    router.write_text(router.read_text().replace('http://toolhub-test-worker:3000', f'http://127.0.0.1:{worker_port}'))
    env = dict(os.environ, TOOLHUB_ADMIN_PASSWORD=config['domain']['admin_pass'],
               TOOLHUB_AGENT_PASSWORD=config['domain']['agent_pass'], NO_PROXY='127.0.0.1,localhost')
    env['PATH'] = str(Path(sys.executable).parent)+':'+str(Path(os.environ['BUN_BIN']).parent)+':'+env['PATH']
    processes = []
    logs = []
    try:
        for name, number in [('worker',worker_port),('_router_',router_port)]:
            ready=tmp_path/(name+'.ready'); log=(tmp_path/(name+'.log')).open('w+')
            logs.append(log)
            processes.append(subprocess.Popen([sys.executable,'-m','toolhub_config','serve',
                '--config',str(root/'config'/name/'toolhub.yaml'), '--database',str(root/'data'/name/'hub.db'),
                '--toolhub-dir',os.environ['TOOLHUB_DIR'],'--ready-file',str(ready),'--init-schema'],
                env=dict(env, PORT=str(number),DATABASE_URL='file:'+str(root/'data'/name/'hub.db')),stdout=log,stderr=log))
            deadline=time.monotonic()+60
            while not ready.exists():
                if processes[-1].poll() is not None or time.monotonic()>deadline:
                    log.flush(); log.seek(0); pytest.fail(log.read())
                time.sleep(.1)
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        req=urllib.request.Request(f'http://127.0.0.1:{router_port}/worker/custom/path/echo',
             data=b'{"text":"native-router"}',headers={'Content-Type':'application/json','x-agent-password':env['TOOLHUB_AGENT_PASSWORD']})
        with opener.open(req,timeout=20) as response:
            assert json.load(response)['data']=={'text':'native-router'}
        log=(tmp_path/'bridge.log').open('w+');logs.append(log)
        processes.append(subprocess.Popen([str(Path(sys.executable).parent/'toolhub-mcp'),
             '--transport','streamable-http','--host','127.0.0.1','--port',str(bridge_port),
             '--url',f'http://127.0.0.1:{router_port}'],env=env,stdout=log,stderr=log))
        deadline=time.monotonic()+20
        while True:
            try:
                with socket.create_connection(('127.0.0.1',bridge_port),timeout=.2): break
            except OSError:
                if processes[-1].poll() is not None or time.monotonic()>deadline:
                    log.flush();log.seek(0);pytest.fail(log.read())
                time.sleep(.1)
        async def call():
            from mcp.client.streamable_http import streamable_http_client
            from mcp import ClientSession
            async with streamable_http_client(f'http://127.0.0.1:{bridge_port}/mcp') as streams:
                async with ClientSession(streams[0],streams[1]) as session:
                    await session.initialize()
                    listing=await session.list_tools()
                    assert {t.name for t in listing.tools}=={'toolhub_list','toolhub_call'}
                    result=await session.call_tool('toolhub_call',{'path':'/worker/custom/path/echo','arguments':{'text':'native-mcp'}})
                    assert not result.is_error
                    assert 'native-mcp' in result.model_dump_json()
        asyncio.run(call())
    finally:
        for process in reversed(processes):
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill();process.wait()
        for log in logs: log.close()
