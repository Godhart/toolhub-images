from twylt import Tool, Requirements
from hdl_order.twylt_api import ManifestInput, ManifestOutput, execute

class HDLTool(Tool[ManifestInput, ManifestOutput]):
    input_model = ManifestInput
    output_model = ManifestOutput
    name = "hdl-manifest"
    version = "0.7.0"
    input_schema_name = "HDLManifestInput"
    input_schema_version = "1.0.0"
    output_schema_name = "HDLManifestOutput"
    output_schema_version = "1.0.0"
    description = 'Export dependency-manifest 1.0 as a JSON object for OKF import; coverage is partial.'
    requirements = Requirements(tool="pip", format="requirements.txt", content="hdl-order[twylt]==0.7.0\n")
    few_shots = [{'input': {'root': 'examples/twylt-empty', 'project_id': 'empty-demo'}, 'output': {'manifest': {'format': 'dependency-manifest', 'version': '1.0', 'producer': {'name': 'hdl-order', 'version': '0.7.0', 'analyzer': 'hdl-order-syntactic'}, 'scope': {'project': 'empty-demo', 'profile': 'default', 'area': 'hdl', 'configuration': {'defines': {}, 'include_roots': ['rtl'], 'include_search': [], 'explicit_dependencies': []}}, 'sources': [{'id': 'rtl'}], 'nodes': [], 'edges': [], 'coverage': {'status': 'partial', 'files': [], 'relation_types': [], 'limitations': ['HDL symbol edges are syntactic observations, not the complete VUnit semantic graph.', 'Unresolved symbol references may be absent. Missing edges must not delete previous observations.']}, 'diagnostics': []}}}]

    def biz(self, data):
        return ManifestOutput.model_validate(execute("manifest", data))

TOOL = HDLTool
if __name__ == "__main__":
    HDLTool.run()
