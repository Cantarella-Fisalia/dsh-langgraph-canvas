from typing import TypedDict


class TeamState(TypedDict):
    topic: str
    research_notes: str
    draft: str
    review_ok: bool
    revision_count: int
