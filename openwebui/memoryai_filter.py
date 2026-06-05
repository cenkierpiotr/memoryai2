"""
title: MemoryAI Filter
author: cenkierpiotr
version: 1.0.0
description: >
  Automatically injects relevant memories from MemoryAI into each conversation.
  On inlet: queries MemoryAI for context relevant to the user's message and
  injects it into the system prompt. On outlet: saves the assistant's response
  to the active MemoryAI session.
license: MIT
"""

import json
import re
import urllib.request
import urllib.error
from typing import Optional, Callable, Awaitable
from pydantic import BaseModel, Field


class Filter:
    class Valves(BaseModel):
        memoryai_url: str = Field(
            default="http://100.99.158.2:3010",
            description="MemoryAI API base URL (use Tailscale IP or public Funnel URL)",
        )
        memoryai_token: str = Field(
            default="",
            description="MemoryAI Bearer token (from ADMIN_API_KEY in .env)",
        )
        max_memories: int = Field(
            default=6,
            description="Max number of memories to inject per request",
        )
        min_score: float = Field(
            default=0.45,
            description="Minimum relevance score to include a memory (0.0–1.0)",
        )
        inject_entities: bool = Field(
            default=True,
            description="Also search and inject entity facts (people, projects, tools)",
        )
        max_entities: int = Field(
            default=3,
            description="Max entity results to inject alongside memories",
        )
        save_to_session: bool = Field(
            default=True,
            description="Save user+assistant messages to a MemoryAI session for distillation",
        )
        priority: int = Field(
            default=0,
            description="Filter priority (lower = earlier). Keep at 0.",
        )

    def __init__(self):
        self.valves = self.Valves()
        self._session_cache: dict[str, str] = {}  # chat_id → memoryai_session_id

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _api(self, method: str, path: str, data: dict | None = None) -> dict:
        url = f"{self.valves.memoryai_url}{path}"
        body = json.dumps(data).encode() if data else None
        headers = {
            "Authorization": f"Bearer {self.valves.memoryai_token}",
            "Content-Type": "application/json",
        }
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return json.loads(r.read())
        except Exception:
            return {}

    def _search_memories(self, query: str) -> list[dict]:
        resp = self._api("POST", "/v1/memories/search", {
            "query": query[:600],
            "limit": self.valves.max_memories,
        })
        return resp.get("data", [])

    def _search_entities(self, query: str) -> list[dict]:
        resp = self._api("POST", "/v1/entities/search", {
            "query": query[:300],
            "limit": self.valves.max_entities,
        })
        return resp.get("data", [])

    def _get_or_create_session(self, chat_id: str, title: str) -> str | None:
        if chat_id in self._session_cache:
            return self._session_cache[chat_id]
        resp = self._api("POST", "/v1/sessions", {
            "title": f"Open WebUI — {title[:40]}",
            "model": "openwebui",
        })
        session_id = resp.get("data", {}).get("id")
        if session_id:
            self._session_cache[chat_id] = session_id
        return session_id

    def _add_message(self, session_id: str, role: str, content: str):
        self._api("POST", f"/v1/sessions/{session_id}/messages", {
            "role": role,
            "content": content[:3000],
        })

    # ── Filter hooks ──────────────────────────────────────────────────────────

    def inlet(
        self,
        body: dict,
        __user__: Optional[dict] = None,
        __event_emitter__: Optional[Callable[[dict], Awaitable[None]]] = None,
    ) -> dict:
        """
        Called before the message is sent to the LLM.
        Searches MemoryAI for relevant context and injects it into the system prompt.
        """
        if not self.valves.memoryai_token:
            return body

        messages = body.get("messages", [])
        if not messages:
            return body

        # Extract last user message as search query
        last_user_msg = next(
            (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
            "",
        )
        if isinstance(last_user_msg, list):
            last_user_msg = " ".join(
                p.get("text", "") for p in last_user_msg if isinstance(p, dict)
            )
        last_user_msg = last_user_msg.strip()
        if len(last_user_msg) < 5:
            return body

        # Query MemoryAI
        memories = self._search_memories(last_user_msg)
        entities = self._search_entities(last_user_msg) if self.valves.inject_entities else []

        # Filter by score (API returns combined_score, not score)
        memories = [m for m in memories if m.get("combined_score", m.get("score", 0)) >= self.valves.min_score]

        if not memories and not entities:
            return body

        # Build injection block
        lines = []

        if memories:
            lines.append("## Relevant memories from previous sessions")
            for m in memories:
                mtype = m.get("type", "fact")
                content = m.get("content", "").strip()
                importance = m.get("importance", 0.5)
                star = " ★" if importance >= 0.85 else ""
                lines.append(f"- [{mtype}]{star} {content}")

        if entities:
            lines.append("\n## Known entities")
            for e in entities:
                name = e.get("name", "")
                etype = e.get("type", "")
                facts = e.get("facts", [])
                fact_texts = [f.get("content", "") for f in facts[:3] if isinstance(f, dict)]
                lines.append(f"- **{name}** ({etype}): {' | '.join(fact_texts)}")

        injection = (
            "\n\n[MEMORYAI CONTEXT — from previous sessions, use when relevant]\n"
            + "\n".join(lines)
            + "\n[/MEMORYAI CONTEXT]"
        )

        # Inject into system message
        sys_msg = next((m for m in messages if m.get("role") == "system"), None)
        if sys_msg:
            sys_msg["content"] += injection
        else:
            messages.insert(0, {"role": "system", "content": injection.strip()})

        body["messages"] = messages

        # Save user message to session
        if self.valves.save_to_session:
            chat_id = body.get("session_id") or body.get("chat_id") or "default"
            title = last_user_msg[:50]
            session_id = self._get_or_create_session(chat_id, title)
            if session_id:
                self._add_message(session_id, "user", last_user_msg)

        return body

    def outlet(
        self,
        body: dict,
        __user__: Optional[dict] = None,
        __event_emitter__: Optional[Callable[[dict], Awaitable[None]]] = None,
    ) -> dict:
        """
        Called after the LLM responds.
        Saves the assistant response to the MemoryAI session.
        """
        if not self.valves.save_to_session or not self.valves.memoryai_token:
            return body

        messages = body.get("messages", [])
        last_assistant = next(
            (m.get("content", "") for m in reversed(messages) if m.get("role") == "assistant"),
            "",
        )
        if isinstance(last_assistant, list):
            last_assistant = " ".join(
                p.get("text", "") for p in last_assistant if isinstance(p, dict)
            )
        last_assistant = last_assistant.strip()
        if not last_assistant:
            return body

        chat_id = body.get("session_id") or body.get("chat_id") or "default"
        session_id = self._session_cache.get(chat_id)
        if session_id:
            self._add_message(session_id, "assistant", last_assistant)

        return body
