import pytest
from fastapi.testclient import TestClient

from app.api.routes.strategies import MAX_AST_NODES, MAX_SOURCE_BYTES
from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def _block(block_id: int) -> dict[str, object]:
    return {
        "id": block_id,
        "category": "signal",
        "title": "均线信号",
        "description": "价格突破均线",
        "color": "blue",
        "x": 120,
        "y": -40.5,
        "parameters": [{"label": "周期", "value": "20", "unit": "日"}],
    }


def _parse(client: TestClient, code: str):
    return client.post("/api/strategies/graph/parse", json={"code": code})


def _assert_invalid(response) -> None:
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)
    assert response.json()["detail"]


def test_parse_graph_with_new_blocks_and_edges(client) -> None:
    graph = {
        "blocks": [_block(1), _block(2), _block(3)],
        "edges": [{"id": 1, "from": 1, "to": 2}, {"id": 2, "from": 2, "to": 3}],
    }
    code = f"strategy_graph = {graph!r}"
    response = _parse(client, code)
    assert response.status_code == 200
    assert response.json() == {**graph, "start": 0, "end": len(code.encode("utf-16-le")) // 2}


@pytest.mark.parametrize("assignment", ["strategy_graph =", "strategy_graph: dict ="])
def test_parse_empty_graph_and_preserve_omitted_unit(client, assignment) -> None:
    code = f"{assignment} {{'blocks': [], 'edges': []}}\n"
    response = _parse(client, code)
    assert response.status_code == 200
    assert response.json() == {"blocks": [], "edges": [], "start": 0, "end": len(code) - 1}

    block = _block(1)
    block["parameters"] = [{"label": "阈值", "value": "0"}]
    response = _parse(client, f"{assignment} {{'blocks': [{block!r}], 'edges': []}}")
    assert response.status_code == 200
    assert response.json()["blocks"][0]["parameters"] == block["parameters"]


@pytest.mark.parametrize("newline", ["\n", "\r\n", "\r"])
def test_offsets_use_utf16_and_cover_only_assignment(client, newline) -> None:
    prefix = f"# 策略 🚀{newline}label = '中文😀'; "
    statement = (
        "strategy_graph: dict = {"
        f"{newline}    'blocks': [],{newline}    'edges': []{newline}"
        "}"
    )
    suffix = f"; label = '保留'  # 不属于图赋值{newline}"
    code = prefix + statement + suffix
    response = _parse(client, code)
    assert response.status_code == 200
    result = response.json()
    assert result["start"] == len(prefix.encode("utf-16-le")) // 2
    assert result["end"] == len((prefix + statement).encode("utf-16-le")) // 2
    encoded = code.encode("utf-16-le")
    replaced = (
        encoded[: result["start"] * 2]
        + "strategy_graph = {'blocks': [], 'edges': []}".encode("utf-16-le")
        + encoded[result["end"] * 2 :]
    ).decode("utf-16-le")
    assert replaced.startswith(prefix)
    assert replaced.endswith(suffix)


def test_unicode_line_separator_inside_string_does_not_shift_offsets(client) -> None:
    prefix = "label = '中文\u2028😀'\n"
    statement = "strategy_graph = {'blocks': [], 'edges': []}"
    response = _parse(client, prefix + statement)
    assert response.status_code == 200
    assert response.json()["start"] == len(prefix.encode("utf-16-le")) // 2
    assert response.json()["end"] == len((prefix + statement).encode("utf-16-le")) // 2


@pytest.mark.parametrize(
    "code",
    [
        "strategy_graph = {",
        "strategy_graph = {'blocks': [], 'edges': []}\ndef broken(: pass",
        "strategy_graph = {'blocks': [], 'edges': []}\n\x00",
    ],
)
def test_syntax_errors_have_readable_detail(client, code) -> None:
    _assert_invalid(_parse(client, code))


@pytest.mark.parametrize(
    "value",
    [
        "dict(blocks=[], edges=[])",
        "graph_from_elsewhere",
        "{'blocks': [item for item in []], 'edges': []}",
        "{'blocks': [], 'edges': []} | {}",
        "__import__('os').system('echo unsafe')",
    ],
)
def test_nonliteral_graphs_are_rejected(client, value) -> None:
    _assert_invalid(_parse(client, f"strategy_graph = {value}"))


def test_parse_never_executes_graph_or_surrounding_code(client, tmp_path) -> None:
    marker = tmp_path / "must-not-exist"
    source = f"from pathlib import Path\nPath({str(marker)!r}).write_text('unsafe')\n"
    valid = _parse(client, source + "strategy_graph = {'blocks': [], 'edges': []}")
    assert valid.status_code == 200
    assert not marker.exists()

    unsafe = _parse(
        client,
        "from pathlib import Path\n"
        f"strategy_graph = Path({str(marker)!r}).write_text('unsafe')",
    )
    _assert_invalid(unsafe)
    assert not marker.exists()


@pytest.mark.parametrize(
    "extra",
    [
        "strategy_graph = {'blocks': [], 'edges': []}",
        "def other():\n    strategy_graph = {}",
        "if True:\n    strategy_graph = {}",
        "other = strategy_graph = {}",
        "strategy_graph += {}",
        "del strategy_graph",
        "strategy_graph['blocks'] = []",
        "(strategy_graph['blocks'], other) = ([], [])",
        "def other(strategy_graph):\n    pass",
        "import json as strategy_graph",
        "def strategy_graph():\n    pass",
        "result = [strategy_graph for strategy_graph in []]",
        "match {}:\n    case strategy_graph:\n        pass",
    ],
)
def test_other_graph_bindings_are_rejected(client, extra) -> None:
    _assert_invalid(
        _parse(client, "strategy_graph = {'blocks': [], 'edges': []}\n" + extra)
    )


@pytest.mark.parametrize(
    "code",
    [
        "# 没有图定义",
        "def other():\n    strategy_graph = {'blocks': [], 'edges': []}",
        "other = strategy_graph = {'blocks': [], 'edges': []}",
        "strategy_graph: dict",
    ],
)
def test_graph_requires_one_standalone_top_level_assignment(client, code) -> None:
    _assert_invalid(_parse(client, code))


@pytest.mark.parametrize(
    "blocks, edges",
    [
        ([_block(1), _block(1)], []),
        ([_block(1)], [{"id": 1, "from": 1, "to": 2}]),
        ([_block(1)], [{"id": 1, "from": 1, "to": 1}]),
        (
            [_block(1), _block(2)],
            [{"id": 1, "from": 1, "to": 2}, {"id": 2, "from": 1, "to": 2}],
        ),
        (
            [_block(1), _block(2)],
            [{"id": 1, "from": 1, "to": 2}, {"id": 1, "from": 2, "to": 1}],
        ),
        ([], [{"id": 1, "from": 1, "to": 2}]),
    ],
)
def test_duplicate_ids_and_bad_edges_are_rejected(client, blocks, edges) -> None:
    _assert_invalid(_parse(client, f"strategy_graph = {{'blocks': {blocks!r}, 'edges': {edges!r}}}"))


@pytest.mark.parametrize(
    "field, value",
    [
        ("id", True),
        ("id", 1.5),
        ("id", 2**53),
        ("id", -(2**53)),
        ("id", "1"),
        ("color", "orange"),
        ("x", "10"),
        ("x", True),
        ("description", None),
        ("parameters", [{"label": "周期", "value": 20}]),
        ("parameters", [{"label": "周期", "value": "20", "unit": None}]),
    ],
)
def test_invalid_block_fields_are_rejected_without_coercion(client, field, value) -> None:
    block = {**_block(1), field: value}
    _assert_invalid(_parse(client, f"strategy_graph = {{'blocks': [{block!r}], 'edges': []}}"))


@pytest.mark.parametrize("coordinate", ["1e309", "-1e309"])
def test_nonfinite_coordinates_are_rejected(client, coordinate) -> None:
    block = repr(_block(1)).replace("'x': 120", f"'x': {coordinate}")
    _assert_invalid(_parse(client, f"strategy_graph = {{'blocks': [{block}], 'edges': []}}"))


@pytest.mark.parametrize(
    "edge",
    [
        {"id": True, "from": 1, "to": 2},
        {"id": 2**53, "from": 1, "to": 2},
        {"id": 1, "from": True, "to": 2},
        {"id": 1, "from": 1, "to": "2"},
    ],
)
def test_invalid_edge_fields_are_rejected(client, edge) -> None:
    graph = {"blocks": [_block(1), _block(2)], "edges": [edge]}
    _assert_invalid(_parse(client, f"strategy_graph = {graph!r}"))


@pytest.mark.parametrize(
    "value",
    ["[]", "{'blocks': [], 'edges': [], 'extra': 1}", "{'blocks': (), 'edges': []}"],
)
def test_graph_shape_is_strict(client, value) -> None:
    _assert_invalid(_parse(client, f"strategy_graph = {value}"))


@pytest.mark.parametrize("character", ["x", "中"])
def test_source_size_is_bounded_by_utf8_bytes(client, character) -> None:
    code = "#" + character * (MAX_SOURCE_BYTES // len(character.encode("utf-8")) + 1)
    _assert_invalid(_parse(client, code))


def test_ast_size_is_bounded(client) -> None:
    code = "strategy_graph = {'blocks': [], 'edges': []}\nvalues = [" + "0," * MAX_AST_NODES + "]"
    assert len(code.encode("utf-8")) < MAX_SOURCE_BYTES
    _assert_invalid(_parse(client, code))
