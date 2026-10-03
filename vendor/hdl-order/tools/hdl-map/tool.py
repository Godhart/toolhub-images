from twylt import Tool, Requirements
from hdl_order.twylt_api import AnalysisInput, MapOutput, execute

class HDLTool(Tool[AnalysisInput, MapOutput]):
    input_model = AnalysisInput
    output_model = MapOutput
    name = "hdl-map"
    version = "0.7.0"
    input_schema_name = "HDLMapInput"
    input_schema_version = "1.0.0"
    output_schema_name = "HDLMapOutput"
    output_schema_version = "1.0.0"
    description = 'Map library-qualified HDL design units to source files.'
    requirements = Requirements(tool="pip", format="requirements.txt", content="hdl-order[twylt]==0.7.0\n")
    few_shots = [{'input': {'root': 'examples/twylt-empty'}, 'output': {'units': []}}]

    def biz(self, data):
        return MapOutput.model_validate(execute("map", data))

TOOL = HDLTool
if __name__ == "__main__":
    HDLTool.run()
