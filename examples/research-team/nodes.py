def research(state):
    """研究主题，整理可供写作使用的资料。"""
    return {"research_notes": "关于 " + state["topic"] + " 的资料"}


def writer(state):
    """根据研究资料撰写内容，记录修改轮次。"""
    return {"draft": state["research_notes"], "revision_count": state.get("revision_count", 0) + 1}


def reviewer(state):
    """检查草稿；两轮内允许修改，达到上限后结束。"""
    return {"review_ok": bool(state.get("draft"))}


def route_review(state):
    return "done" if state["review_ok"] or state["revision_count"] >= 2 else "revise"
