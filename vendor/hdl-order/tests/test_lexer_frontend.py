from hdl_order.symbols import scan_file

def test_sv_comments_strings_and_layout(tmp_path):
    p=tmp_path/'x.sv'
    p.write_text('// module fake1;\nstring s = \"module fake2; // no\";\n/* module fake3; */\nmodule\n/* split */ real_module // tail\n( input logic clk );\nendmodule\n')
    assert [(x.kind,x.name) for x in scan_file(p,'lib')]==[('module','real_module')]

def test_vhdl_comments_and_layout(tmp_path):
    p=tmp_path/'x.vhd'
    p.write_text('-- entity fake is end;\nentity\n Real -- tail\nis\nend entity;\narchitecture\n RTL -- comment\nof\n Real\nis\nbegin\nend architecture;\n')
    assert [(x.kind,x.name,x.owner) for x in scan_file(p,'lib')]==[('entity','real',None),('architecture','rtl','real')]

def test_multiline_comment_location(tmp_path):
    p=tmp_path/'x.sv'; p.write_text('/* a\nb\nc */\nmodule real; endmodule\n')
    assert scan_file(p,'lib')[0].line==4

def test_sv_escaped_identifier(tmp_path):
    p=tmp_path/'x.sv'; p.write_text('module \\odd.name ; endmodule\n')
    assert scan_file(p,'lib')[0].name=='\\odd.name'

def test_keywords_in_comments_do_not_create_units(tmp_path):
    p=tmp_path/'x.vhd'; p.write_text('entity real is\nend entity;\n-- architecture fake of real is\n')
    assert [x.kind for x in scan_file(p,'lib')]==['entity']
