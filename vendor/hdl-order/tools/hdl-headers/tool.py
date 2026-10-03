from twylt import Tool, Requirements
from hdl_order.twylt_api import AnalysisInput, HeadersOutput, execute

class HDLTool(Tool[AnalysisInput, HeadersOutput]):
    input_model = AnalysisInput
    output_model = HeadersOutput
    name = "hdl-headers"
    version = "0.7.0"
    input_schema_name = "HDLHeadersInput"
    input_schema_version = "1.0.0"
    output_schema_name = "HDLHeadersOutput"
    output_schema_version = "1.0.0"
    description = 'List headers, their transitive users, and unresolved includes.'
    requirements = Requirements(tool="pip", format="requirements.txt", content="hdl-order[twylt]==0.7.0\n")
    few_shots = [{'input': {'root': 'examples/twylt-empty'}, 'output': {'headers': [], 'unresolved': []}}]

    def biz(self, data):
        return HeadersOutput.model_validate(execute("headers", data))

TOOL = HDLTool
if __name__ == "__main__":
    HDLTool.run()
