"""Portable dependency observations; never infer edges from compilation order."""
import hashlib
import json
import subprocess
from pathlib import Path


def sha(path):
    return 'sha256:' + hashlib.sha256(Path(path).read_bytes()).hexdigest()


def capture(roots):
    return {p.resolve(): sha(p) for root in roots for p in Path(root).rglob('*') if p.is_file() and '.git' not in p.parts}


def build_manifest(result, project_id, profile='default', before=None):
    from . import __version__
    roots = [('rtl', result.root.resolve())]
    for i, root in enumerate(result.include_dirs):
        root = root.resolve()
        if not any(root == p or p in root.parents for _, p in roots):
            roots.append((f'include-{i}', root))
    nodes, edges, files, diagnostics = [], [], {}, []
    paths = {(result.root / x.path).resolve() for x in result.ordered}
    paths.update(result.include_graph.headers)
    paths.update(p.resolve() for p, _ in result.unit_map.values())
    for p in sorted(paths):
        location = next(((name, p.relative_to(root).as_posix()) for name, root in roots if p == root or root in p.parents), None)
        if location is None:
            key = 'external:' + hashlib.sha256(str(p).encode()).hexdigest()[:24]
            nodes.append({'id': key, 'kind': 'external', 'name': p.name, 'uri': p.as_uri()})
            diagnostics.append({'severity': 'warning', 'code': 'external_root', 'message': f'File outside declared roots: {p.name}'})
        else:
            source, relative = location
            key = f'file:{source}:{relative}'
            content_hash = sha(p)
            if before is not None and before.get(p) != content_hash:
                raise ValueError(f'input changed during analysis or was outside captured inputs: {p}')
            nodes.append({'id': key, 'kind': 'file', 'source': source, 'path': relative, 'content_hash': content_hash})
        files[p] = key
    for unit, (p, line) in sorted(result.unit_map.items()):
        nodes.append({'id': 'unit:' + unit.label(), 'kind': 'symbol', 'name': unit.name,
                      'file': files[p.resolve()], 'attributes': {'language': 'vhdl' if p.suffix.lower() in ('.vhd', '.vhdl') else 'verilog',
                      'library': unit.library, 'symbol_kind': unit.kind}, 'line': line})
    for e in result.unit_edges:
        edges.append({'dependent': 'unit:' + e.source.label(), 'dependency': 'unit:' + e.target.label(),
                      'relation': 'hdl.' + e.relation, 'evidence': {'file': files[e.path.resolve()], 'line': e.line, 'precision': 'symbol'}})
    for source, includes in result.include_graph.edges.items():
        for e in includes:
            if e.target is not None:
                edges.append({'dependent': files[source.resolve()], 'dependency': files[e.target.resolve()], 'relation': 'hdl.includes',
                              'evidence': {'file': files[source.resolve()], 'line': e.line, 'precision': 'line'}})
            else:
                diagnostics.append({'severity': 'warning', 'code': 'unresolved_include', 'message': e.spelling})
    for a, b, reason in result.explicit:
        edge = {'dependent': files[a.resolve()], 'dependency': files[b.resolve()], 'relation': 'hdl.explicit'}
        if reason: edge['note'] = reason
        edges.append(edge)
    if result.duplicates:
        raise ValueError('dependency export refuses duplicate design-unit identities')
    unique = {json.dumps(e, sort_keys=True): e for e in edges}
    try:
        commit = subprocess.check_output(['git', '-C', str(result.root), 'rev-parse', 'HEAD'], stderr=subprocess.DEVNULL, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        commit = None
    return {
        'format': 'dependency-manifest', 'version': '1.0',
        'producer': {'name': 'hdl-order', 'version': __version__, 'analyzer': 'hdl-order-syntactic'},
        'scope': {'project': project_id, 'profile': profile, 'area': 'hdl',
                  'configuration': {'defines': result.defines, 'include_roots': [name for name, _ in roots],
                                    'include_search': [next(({'source': name, 'path': str(p.resolve().relative_to(root).as_posix())} for name, root in roots if p.resolve() == root or root in p.resolve().parents), {'external': str(p)}) for p in result.include_dirs],
                                    'explicit_dependencies': [{'dependent': files[a.resolve()], 'dependency': files[b.resolve()]} for a,b,_ in result.explicit]}},
        'sources': [{'id': name, **({'revision': commit} if name == 'rtl' and commit else {})} for name, _ in roots],
        'nodes': nodes, 'edges': [unique[k] for k in sorted(unique)],
        'coverage': {'status': 'partial', 'files': sorted(n['id'] for n in nodes if n['kind'] == 'file'),
                     'relation_types': sorted({e['relation'] for e in edges}),
                     'limitations': ['HDL symbol edges are syntactic observations, not the complete VUnit semantic graph.',
                                     'Unresolved symbol references may be absent. Missing edges must not delete previous observations.']},
        'diagnostics': diagnostics
    }
