from pathlib import Path
from twylt.bootstrap import run_tool_file

if __name__ == "__main__":
    run_tool_file(Path(__file__).with_name("tool.py"))
