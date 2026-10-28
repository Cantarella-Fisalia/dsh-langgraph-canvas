from langgraph.graph import StateGraph, START, END
from state import TeamState
from nodes import research, writer, reviewer, route_review

builder = StateGraph(TeamState)
builder.add_node("research", research)
builder.add_node("writer", writer)
builder.add_node("reviewer", reviewer)
builder.add_edge(START, "research")
builder.add_edge("research", "writer")
builder.add_edge("writer", "reviewer")
builder.add_conditional_edges("reviewer", route_review, {"revise": "writer", "done": END})
graph = builder.compile()
