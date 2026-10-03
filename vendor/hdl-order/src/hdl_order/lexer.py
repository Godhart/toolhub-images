from dataclasses import dataclass
from pathlib import Path

@dataclass(frozen=True)
class Token:
    kind: str
    value: str
    path: Path
    line: int
    column: int

def lex(text: str, path: Path, language: str):
    out=[]; i=0; line=1; col=1; n=len(text)
    def advance(raw):
        nonlocal line,col
        parts=raw.split("\n")
        if len(parts)>1:
            line += len(parts)-1; col=len(parts[-1])+1
        else: col += len(raw)
    while i<n:
        c=text[i]
        if c.isspace():
            j=i+1
            while j<n and text[j].isspace(): j+=1
            advance(text[i:j]); i=j; continue
        if language=="sv" and text.startswith("//",i):
            j=text.find("\n",i); j=n if j<0 else j
            advance(text[i:j]); i=j; continue
        if language=="sv" and text.startswith("/*",i):
            j=text.find("*/",i+2); j=n if j<0 else j+2
            advance(text[i:j]); i=j; continue
        if language=="vhdl" and text.startswith("--",i):
            j=text.find("\n",i); j=n if j<0 else j
            advance(text[i:j]); i=j; continue
        if c=='"':
            sl,sc=line,col; j=i+1
            while j<n:
                if language=="sv" and text[j]=="\\": j+=2; continue
                if text[j]=='"':
                    if language=="vhdl" and j+1<n and text[j+1]=='"': j+=2; continue
                    j+=1; break
                j+=1
            raw=text[i:j]; out.append(Token("string",raw,Path(path),sl,sc)); advance(raw); i=j; continue
        if c=="\\":
            sl,sc=line,col
            if language=="sv":
                j=i+1
                while j<n and not text[j].isspace(): j+=1
            else:
                j=text.find("\\",i+1); j=n if j<0 else j+1
            raw=text[i:j]; out.append(Token("identifier",raw,Path(path),sl,sc)); advance(raw); i=j; continue
        if c.isalpha() or c=="_":
            sl,sc=line,col; j=i+1
            while j<n and (text[j].isalnum() or text[j] in "_$"): j+=1
            raw=text[i:j]; out.append(Token("identifier",raw,Path(path),sl,sc)); advance(raw); i=j; continue
        sl,sc=line,col; two=text[i:i+2]
        if two in ("::","=>",":=","<=",">=","==","!="):
            out.append(Token("punct",two,Path(path),sl,sc)); advance(two); i+=2
        else:
            out.append(Token("punct",c,Path(path),sl,sc)); advance(c); i+=1
    return out
