from twylt import Tool, Requirements
from hdl_order.twylt_api import AnalysisInput, SymbolsOutput, execute

class HDLTool(Tool[AnalysisInput, SymbolsOutput]):
    input_model = AnalysisInput
    output_model = SymbolsOutput
    name = "hdl-symbols"
    version = "0.7.0"
    input_schema_name = "HDLSymbolsInput"
    input_schema_version = "1.0.0"
    output_schema_name = "HDLSymbolsOutput"
    output_schema_version = "1.0.0"
    description = 'List HDL design-unit declarations with library, owner and source location.'
    requirements = Requirements(tool="pip", format="requirements.txt", content="hdl-order[twylt]==0.7.0\n")
    few_shots = [{'input': {'root': 'examples/twylt-empty'}, 'output': {'symbols': []}}]

    def biz(self, data):
        return SymbolsOutput.model_validate(execute("symbols", data))

TOOL = HDLTool
if __name__ == "__main__":
    HDLTool.run()
