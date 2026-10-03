"""TWYLT adapter for the preinstalled OKF Workspace JSON CLI (Linux)."""
import json
import os
import signal
import subprocess
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field
from twylt import Tool, Requirements

Operation = Literal['migration_prepare', 'dependencies_import_prepare', 'dependencies_sources', 'dependencies_graph', 'dependencies_set_prepare', 'documentation_links_set_prepare', 'nodes_register_prepare', 'coverage_set_prepare', 'documentation_issue_prepare', 'documentation_plan', 'documentation_coverage', 'snapshot_get', 'domains_list', 'catalog_list', 'docs_search', 'nodes_get', 'graph_query', 'nodes_related', 'files_list', 'changes_prepare', 'changes_apply', 'changes_get', 'changes_discard', 'catalog_validate', 'sources_status', 'list_tools', 'describe_tools']

class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    operation: Operation = Field(description="OKF operation; describe_tools returns operation-specific JSON schemas.")
    arguments: dict[str, Any] = Field(default_factory=dict, description="Request matching the chosen OKF schema; validated by OKF. Empty for list_tools/describe_tools.")
    timeout_seconds: int = Field(default=120, ge=1, le=600, description="Execution deadline; ToolHub timeout must be at least this long.")

class Output(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    result: dict[str, Any] | list[Any] = Field(description="Unmodified OKF JSON result.")

class OKFWorkspaceTool(Tool[Input, Output]):
    input_model = Input
    output_model = Output
    name = "okf_workspace"
    version = "0.1.0"
    input_schema_name = "OKFWorkspaceInput"
    input_schema_version = "1.0.0"
    output_schema_name = "OKFWorkspaceOutput"
    output_schema_version = "1.0.0"
    description = "Create and maintain documentation through OKF Workspace: plan, coverage, search, read, prepare and explicitly apply changes. Requires initialized OKF_WORKSPACE_STATE and preinstalled okf-workspace CLI."
    requirements = Requirements(tool="pip", format="requirements.txt", content="twylt==1.0.0\npydantic>=2,<3\n")
    few_shots = []

    def biz(self, data: Input) -> Output:
        cli = os.environ.get("OKF_WORKSPACE_CLI", "okf-workspace")
        state = os.environ.get("OKF_WORKSPACE_STATE", "/okf-state")
        command = [cli, "--state", state]
        if data.operation in ("list_tools", "describe_tools"):
            if data.arguments:
                raise ValueError("list_tools/describe_tools require empty arguments")
            command.append("tools" if data.operation == "list_tools" else "describe")
            request = ""
        else:
            command.extend(["call", data.operation, "-"])
            request = json.dumps(data.arguments, ensure_ascii=False)
        if len(request.encode("utf-8")) > 16 * 1024 * 1024:
            raise ValueError("OKF request exceeds 16 MiB")
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, encoding="utf-8", start_new_session=True)
        try:
            stdout, stderr = process.communicate(request, timeout=data.timeout_seconds)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.communicate()
            raise RuntimeError("OKF timeout; inspect changes_get before retrying a write") from None
        if process.returncode:
            raise RuntimeError(f"OKF failed ({process.returncode}): {(stdout or stderr).strip()[:4000]}")
        return Output(result=json.loads(stdout))

TOOL = OKFWorkspaceTool
if __name__ == "__main__":
    OKFWorkspaceTool.run()
