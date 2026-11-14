"""strip_js_line_comments: drop whole-line // comments, but only real ones."""
from llm_telemetry.webassets import strip_js_line_comments as strip


def test_drops_whole_line_comments():
    assert strip("// a\nconst x = 1;\n  // b\n") == "const x = 1;\n"


def test_keeps_trailing_comment_and_url_strings():
    src = "const u = 'https://x.y'; // note\nconst v = \"//z\";\n"
    assert strip(src) == src


def test_keeps_comment_looking_line_inside_template_literal():
    src = "const t = `a\n// not a comment\nb`;\n// real\n"
    assert strip(src) == "const t = `a\n// not a comment\nb`;\n"


def test_template_with_interpolation_and_nested_template():
    src = "const t = `a ${f(`x\n// inner`)} b\n// still tpl`;\n// gone\nlet y;\n"
    assert strip(src) == "const t = `a ${f(`x\n// inner`)} b\n// still tpl`;\nlet y;\n"


def test_keeps_lines_inside_block_comment_and_licence():
    src = "/*! licence\n// keep\n*/\n/* c\n// inside\n*/\n// drop\nx;\n"
    assert strip(src) == "/*! licence\n// keep\n*/\n/* c\n// inside\n*/\nx;\n"


def test_regex_with_quote_or_backtick_does_not_derail():
    src = "const r = /['`\"]/g;\n// drop\nconst s = 1;\n"
    assert strip(src) == "const r = /['`\"]/g;\nconst s = 1;\n"


def test_dedent_collapses_code_indent_but_not_template_or_block_content():
    src = "function f(){\n  const t = `a\n    b`;\n  /* c\n     d */\n  return 1;\n}\n"
    assert strip(src, dedent=True) == "function f(){\n const t = `a\n    b`;\n /* c\n     d */\n return 1;\n}\n"
    assert strip(src) == src
