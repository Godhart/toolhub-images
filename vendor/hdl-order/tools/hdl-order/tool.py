from twylt import Tool, Requirements
from hdl_order.twylt_api import OrderInput, OrderOutput, execute

class HDLTool(Tool[OrderInput, OrderOutput]):
    input_model = OrderInput
    output_model = OrderOutput
    name = "hdl-order"
    version = "0.7.0"
    input_schema_name = "HDLOrderInput"
    input_schema_version = "1.0.0"
    output_schema_name = "HDLOrderOutput"
    output_schema_version = "1.0.0"
    description = 'Compute HDL compilation order across libraries; optionally render plain, CSV or ModelSim commands.'
    requirements = Requirements(tool="pip", format="requirements.txt", content="hdl-order[twylt]==0.7.0\n")
    few_shots = [{'input': {'root': 'examples/twylt-empty'}, 'output': {'compile_order': [], 'defines': {}, 'headers': [], 'rendered': None}}]

    def biz(self, data):
        return OrderOutput.model_validate(execute("order", data))

TOOL = HDLTool
if __name__ == "__main__":
    HDLTool.run()
