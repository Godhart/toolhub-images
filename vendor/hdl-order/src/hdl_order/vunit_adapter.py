from pathlib import Path
from vunit import VUnit
class VUnitAdapter:
    def __init__(self):
        self.vu=VUnit.from_argv([],compile_builtins=False);self.libs={};self.sources={}
    def add_library(self,name):
        if name not in self.libs:self.libs[name]=self.vu.add_library(name)
        return self.libs[name]
    def add_source(self,library,path,file_type,include_dirs=(),defines=None):
        kw={"file_type":file_type}
        if file_type in ("verilog","systemverilog"):
            kw["include_dirs"]=[str(Path(x)) for x in include_dirs];kw["defines"]=dict(defines or {})
        sf=self.add_library(library).add_source_file(str(Path(path)),**kw);self.sources[Path(path).resolve()]=sf;return sf
    def add_dependency(self,a,b):self.sources[Path(a).resolve()].add_dependency_on(self.sources[Path(b).resolve()])
    @staticmethod
    def source_path(s):return Path(s.name).resolve()
    @staticmethod
    def library_name(s):
        x=getattr(s,"library",None);return x.name if hasattr(x,"name") else str(x)
    def compile_order(self):return list(self.vu.get_compile_order())
