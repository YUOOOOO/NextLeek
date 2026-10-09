from __future__ import annotations

import ast
import re
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError

router = APIRouter(prefix="/strategies", tags=["strategies"])
MAX_SOURCE_BYTES = 256 * 1024
MAX_AST_NODES = 50_000
MAX_SAFE_INTEGER = 2**53 - 1
SafeInteger = Annotated[
    int, Field(strict=True, ge=-MAX_SAFE_INTEGER, le=MAX_SAFE_INTEGER)
]
Coordinate = Annotated[float, Field(strict=True, allow_inf_nan=False)]


class GraphParseIn(BaseModel):
    code: str = Field(strict=True)


class GraphModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class GraphParameter(GraphModel):
    label: str
    value: str
    unit: str = ""


class GraphBlock(GraphModel):
    id: SafeInteger
    category: str
    title: str
    description: str
    color: Literal["blue", "violet", "amber", "red", "green", "cyan"]
    x: Coordinate
    y: Coordinate
    parameters: list[GraphParameter]


class GraphEdge(GraphModel):
    id: SafeInteger
    from_: SafeInteger = Field(alias="from")
    to: SafeInteger


class GraphDefinition(GraphModel):
    blocks: list[GraphBlock]
    edges: list[GraphEdge]


class GraphParseOut(GraphDefinition):
    start: int
    end: int


def _invalid(detail: str) -> HTTPException:
    return HTTPException(status_code=422, detail=detail)


def _target_is_graph(target: ast.expr) -> bool:
    while isinstance(target, (ast.Attribute, ast.Subscript)):
        target = target.value
    return isinstance(target, ast.Name) and target.id == "strategy_graph"


def _binds_graph(node: ast.AST) -> bool:
    if isinstance(node, ast.Name):
        return node.id == "strategy_graph" and isinstance(node.ctx, (ast.Store, ast.Del))
    if isinstance(node, (ast.Attribute, ast.Subscript)):
        return isinstance(node.ctx, (ast.Store, ast.Del)) and _target_is_graph(node)
    if isinstance(node, ast.arg):
        return node.arg == "strategy_graph"
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return node.name == "strategy_graph"
    if isinstance(node, (ast.Import, ast.ImportFrom)):
        return any(
            (alias.asname or alias.name.split(".")[0]) == "strategy_graph"
            for alias in node.names
        )
    if isinstance(node, (ast.ExceptHandler, ast.MatchAs, ast.MatchStar)):
        return node.name == "strategy_graph"
    if isinstance(node, ast.MatchMapping):
        return node.rest == "strategy_graph"
    return False


def _graph_statement(tree: ast.Module) -> ast.Assign | ast.AnnAssign:
    candidates = [
        node
        for node in tree.body
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id == "strategy_graph"
        )
        or (
            isinstance(node, ast.AnnAssign)
            and isinstance(node.target, ast.Name)
            and node.target.id == "strategy_graph"
            and node.value is not None
        )
    ]
    if len(candidates) != 1:
        raise _invalid("strategy_graph 必须有且仅有一个顶层单独赋值")
    statement = candidates[0]
    target = statement.targets[0] if isinstance(statement, ast.Assign) else statement.target
    for index, node in enumerate(ast.walk(tree)):
        if index >= MAX_AST_NODES:
            raise _invalid("Python 源码结构过大，请简化代码")
        if node is not target and _binds_graph(node):
            raise _invalid("strategy_graph 不能在其他位置重复赋值、绑定、修改或删除")
    return statement


def _validate_graph(value: object) -> GraphDefinition:
    try:
        graph = GraphDefinition.model_validate(value)
    except ValidationError as exc:
        errors = exc.errors(include_url=False, include_input=False)
        detail = "; ".join(
            f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
            for error in errors[:8]
        )
        raise _invalid(f"strategy_graph 图定义无效：{detail}") from exc
    block_ids: set[int] = set()
    for block in graph.blocks:
        if block.id in block_ids:
            raise _invalid(f"节点 id 重复：{block.id}")
        block_ids.add(block.id)
    edge_ids: set[int] = set()
    connections: set[tuple[int, int]] = set()
    for edge in graph.edges:
        if edge.id in edge_ids:
            raise _invalid(f"连线 id 重复：{edge.id}")
        edge_ids.add(edge.id)
        if edge.from_ not in block_ids or edge.to not in block_ids:
            raise _invalid(f"连线 {edge.id} 的端点不存在")
        if edge.from_ == edge.to:
            raise _invalid(f"连线 {edge.id} 不允许连接节点自身")
        connection = (edge.from_, edge.to)
        if connection in connections:
            raise _invalid(f"重复连线：{edge.from_} → {edge.to}")
        connections.add(connection)
    return graph


def _utf16_offset(code: str, line_starts: list[int], line: int, column: int) -> int:
    line_start = line_starts[line - 1]
    line_end = line_starts[line] if line < len(line_starts) else len(code)
    # Python AST columns count UTF-8 bytes; browser string indices count UTF-16 units.
    line_prefix = code[line_start:line_end].encode("utf-8")[:column].decode("utf-8")
    return (len(code[:line_start].encode("utf-16-le")) + len(line_prefix.encode("utf-16-le"))) // 2


@router.post("/graph/parse", response_model=GraphParseOut, response_model_exclude_unset=True)
async def parse_strategy_graph(payload: GraphParseIn) -> GraphParseOut:
    code = payload.code
    if len(code) > MAX_SOURCE_BYTES:
        raise _invalid("Python 源码不能超过 256 KiB")
    try:
        if len(code.encode("utf-8")) > MAX_SOURCE_BYTES:
            raise _invalid("Python 源码不能超过 256 KiB")
        tree = ast.parse(code)
        statement = _graph_statement(tree)
        value = ast.literal_eval(statement.value)
    except SyntaxError as exc:
        raise _invalid(f"Python 语法错误（第 {exc.lineno} 行）：{exc.msg}") from exc
    except (ValueError, TypeError, UnicodeError) as exc:
        raise _invalid("strategy_graph 必须是 Python 字面量，不能使用调用、变量或表达式") from exc
    except (RecursionError, MemoryError) as exc:
        raise _invalid("Python 源码结构过大或嵌套过深，请简化代码") from exc
    graph = _validate_graph(value)
    line_starts = [0, *(match.end() for match in re.finditer(r"\r\n?|\n", code))]
    return GraphParseOut(
        blocks=graph.blocks,
        edges=graph.edges,
        start=_utf16_offset(code, line_starts, statement.lineno, statement.col_offset),
        end=_utf16_offset(code, line_starts, statement.end_lineno, statement.end_col_offset),
    )
