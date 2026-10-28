from typing import Annotated, TypedDict
import operator
from langgraph.graph import StateGraph, START, END


class State(TypedDict):
    results: Annotated[list[str], operator.add]


def researcher(state):
    """并行收集事实。"""
    return {"results": ["facts"]}


def analyst(state):
    """并行整理分析。"""
    return {"results": ["analysis"]}


def summarize(state):
    """等待两个分支完成后汇总。"""
    return {}


builder = StateGraph(State)
builder.add_node("researcher", researcher)
builder.add_node("analyst", analyst)
builder.add_node("summarize", summarize)
builder.add_edge(START, "researcher")
builder.add_edge(START, "analyst")
builder.add_edge(["researcher", "analyst"], "summarize")
builder.add_edge("summarize", END)
graph = builder.compile()
