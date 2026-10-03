from twylt import Tool, Requirements
from hdl_order.twylt_api import DependenciesInput, DependenciesOutput, execute

class HDLTool(Tool[DependenciesInput, DependenciesOutput]):
    input_model = DependenciesInput
    output_model = DependenciesOutput
    name = "hdl-dependencies"
    version = "0.7.0"
    input_schema_name = "HDLDependenciesInput"
    input_schema_version = "1.0.0"
    output_schema_name = "HDLDependenciesOutput"
    output_schema_version = "1.0.0"
    description = 'List include and explicit file dependencies; optionally explain one project file.'
    requirements = Requirements(tool="pip", format="requirements.txt", content="hdl-order[twylt]==0.7.0\n")
    few_shots = [{'input': {'root': 'examples/twylt-empty'}, 'output': {'includes': [], 'explicit': [], 'completeness': 'include-and-explicit-only', 'explanation': None}}]

    def biz(self, data):
        return DependenciesOutput.model_validate(execute("dependencies", data))

TOOL = HDLTool
if __name__ == "__main__":
    HDLTool.run()
