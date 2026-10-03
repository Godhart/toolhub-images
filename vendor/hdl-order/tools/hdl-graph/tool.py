from twylt import Tool, Requirements
from hdl_order.twylt_api import GraphInput, GraphOutput, execute

class HDLTool(Tool[GraphInput, GraphOutput]):
    input_model = GraphInput
    output_model = GraphOutput
    name = "hdl-graph"
    version = "0.7.0"
    input_schema_name = "HDLGraphInput"
    input_schema_version = "1.0.0"
    output_schema_name = "HDLGraphOutput"
    output_schema_version = "1.0.0"
    description = 'Get the partial syntactic HDL design-unit graph using dependent/dependency roles.'
    requirements = Requirements(tool="pip", format="requirements.txt", content="hdl-order[twylt]==0.7.0\n")
    few_shots = [{'input': {'root': 'examples/twylt-empty'}, 'output': {'nodes': [], 'edges': [], 'completeness': 'partial', 'rendered': None}}]

    def biz(self, data):
        return GraphOutput.model_validate(execute("graph", data))

TOOL = HDLTool
if __name__ == "__main__":
    HDLTool.run()
