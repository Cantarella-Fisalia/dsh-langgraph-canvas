from typing import TypedDict
from langgraph.graph import StateGraph, START, END


class State(TypedDict):
    request_type: str
    response: str


def classify(state):
    """检查请求类型，交给对应处理节点。"""
    return {}


def support(state):
    """处理支持请求。"""
    return {"response": "Support response"}


def research(state):
    """处理研究请求。"""
    return {"response": "Research response"}


def route(state):
    return state["request_type"]


builder = StateGraph(State)
builder.add_node("classify", classify)
builder.add_node("support", support)
builder.add_node("research", research)
builder.add_edge(START, "classify")
builder.add_conditional_edges("classify", route, {"support": "support", "research": "research"})
builder.add_edge("support", END)
builder.add_edge("research", END)
graph = builder.compile()
