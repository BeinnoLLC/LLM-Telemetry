"""strip_js_line_comments: drop whole-line // comments, but only real ones."""
from llm_telemetry.webassets import strip_js_line_comments as strip


def test_drops_whole_line_comments():
    assert strip("// a\nconst x = 1;\n  // b\n") == "const x = 1;\n"


def test_drops_trailing_comment_but_keeps_url_strings():
    src = "const u = 'https://x.y'; // note\nconst v = \"//z\";\n"
    assert strip(src) == "const u = 'https://x.y';\nconst v = \"//z\";\n"


def test_keeps_comment_looking_line_inside_template_literal():
    src = "const t = `a\n// not a comment\nb`;\n// real\n"
    assert strip(src) == "const t = `a\n// not a comment\nb`;\n"


def test_template_with_interpolation_and_nested_template():
    src = "const t = `a ${f(`x\n// inner`)} b\n// still tpl`;\n// gone\nlet y;\n"
    assert strip(src) == "const t = `a ${f(`x\n// inner`)} b\n// still tpl`;\nlet y;\n"


def test_keeps_lines_inside_block_comment_and_licence():
    src = "/*! licence\n// keep\n*/\n/* c\n// inside\n*/\n// drop\nx;\n"
    assert strip(src) == "/*! licence\n// keep\n*/\nx;\n"


def test_regex_with_quote_or_backtick_does_not_derail():
    src = "const r = /['`\"]/g;\n// drop\nconst s = 1;\n"
    assert strip(src) == "const r = /['`\"]/g;\nconst s = 1;\n"


def test_dedent_collapses_code_indent_but_not_template_or_block_content():
    src = "function f(){\n  const t = `a\n    b`;\n  /* c\n     d */ g();\n  return 1;\n}\n"
    assert strip(src, dedent=True) == "function f(){\n const t = `a\n    b`;\n /* c\n     d */ g();\n return 1;\n}\n"
    assert strip(src) == src


def test_drops_whole_line_block_and_jsdoc_comments():
    assert strip("/* a */\nx;\n  /**\n   * doc\n   */\ny;\n") == "x;\ny;\n"


def test_keeps_licence_block_comment():
    assert strip("/*! keep */\nx;\n") == "/*! keep */\nx;\n"


def test_keeps_block_opener_inside_template_literal():
    src = "const t = `a\n/* not a comment */\nb`;\n"
    assert strip(src) == src


def test_keeps_block_opener_inside_string():
    src = "const s = '/* x */';\nconst d = \"/*\";\n"
    assert strip(src) == src


def test_keeps_regex_literal_containing_block_opener():
    src = "const r = /\\/* x/;\nconst q = /a[/*]b/;\n"
    assert strip(src) == src


def test_keeps_code_after_block_close_on_same_line():
    assert strip("/* a */ x();\n/* b\n c */ y();\n") == "/* a */ x();\n/* b\n c */ y();\n"
    assert strip("x(); /* trailing */\n") == "x(); /* trailing */\n"


def test_drops_trailing_line_comment_and_the_space_before_it():
    assert strip("foo();   // note\nbar(); //x\n") == "foo();\nbar();\n"
    assert strip("a = 1; // c\r\n") == "a = 1;\r\n"


def test_keeps_double_slash_inside_strings_and_templates():
    src = ("const a = 'https://x'; // c\nconst b = \"https://x\";\n"
           "const c = `https://x ${y}`;\nconst d = `a ${'//'} b`;\n")
    assert strip(src) == src.replace(" // c", "")


def test_keeps_double_slash_inside_regex_literal():
    assert strip("const r = /\\/\\//g; // c\n") == "const r = /\\/\\//g;\n"
    assert strip("s.replace(/[/]\\//g, '');\n") == "s.replace(/[/]\\//g, '');\n"


def test_division_followed_by_trailing_comment():
    assert strip("x = a / b; // c\ny = (a) / 2 / 3; // d\n") == "x = a / b;\ny = (a) / 2 / 3;\n"


def test_trailing_comment_after_block_close_and_licence_kept():
    assert strip("/* a\n b */ x(); // c\n") == "/* a\n b */ x();\n"
    assert strip("/*! keep // me */\n") == "/*! keep // me */\n"


def test_css_trim_drops_indentation_and_blank_lines_only():
    from llm_telemetry.webassets import _css_trim, strip_css_comments
    src = "a {\n    color: red;  \n\n\n    content: \"a  b\";\n}\n/*! lic */\n.b {\n  background: url(a  b.png);\n}\n"
    out = _css_trim(strip_css_comments(src))
    assert out == "a {\ncolor: red;\ncontent: \"a  b\";\n}\n/*! lic */\n.b {\nbackground: url(a  b.png);\n}\n"
