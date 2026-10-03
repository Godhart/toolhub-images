from twylt import Tool, Requirements
from hdl_order.twylt_api import AnalysisInput, CheckOutput, execute

class HDLTool(Tool[AnalysisInput, CheckOutput]):
    input_model = AnalysisInput
    output_model = CheckOutput
    name = "hdl-check"
    version = "0.7.0"
    input_schema_name = "HDLCheckInput"
    input_schema_version = "1.0.0"
    output_schema_name = "HDLCheckOutput"
    output_schema_version = "1.0.0"
    description = 'Check HDL project: duplicate symbols and unresolved includes. Cycles and analysis failures are TWYLT business errors.'
    requirements = Requirements(tool="pip", format="requirements.txt", content="hdl-order[twylt]==0.7.0\n")
    few_shots = [{'input': {'root': 'examples/twylt-empty'}, 'output': {'ok': True, 'compilation_units': 0, 'design_units': 0, 'headers': 0, 'duplicates': [], 'unresolved_includes': 0}}]

    def biz(self, data):
        return CheckOutput.model_validate(execute("check", data))

TOOL = HDLTool
if __name__ == "__main__":
    HDLTool.run()
