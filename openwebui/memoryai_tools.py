"""
title: MemoryAI Tools
author: cenkierpiotr
version: 1.0.0
description: >
  Gives the AI model direct access to MemoryAI tools: search memories,
  save facts, recall entities, and end sessions with distillation.
  The model decides when to use these tools based on conversation context.
license: MIT
"""

import json
import urllib.request
import urllib.error
from typing import Optional
from pydantic import BaseModel, Field


class Tools:
    class Valves(BaseModel):
        memoryai_url: str = Field(
            default="http://100.99.158.2:3010",
            description="MemoryAI API base URL",
        )
        memoryai_token: str = Field(
            default="",
            description="MemoryAI Bearer token",
        )

    def __init__(self):
        self.valves = self.Valves()

    def _api(self, method: str, path: str, data: dict | None = None) -> dict:
        url = f"{self.valves.memoryai_url}{path}"
        body = json.dumps(data).encode() if data else None
        headers = {
            "Authorization": f"Bearer {self.valves.memoryai_token}",
            "Content-Type": "application/json",
        }
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=8) as r:
                return json.loads(r.read())
        except Exception as e:
            return {"error": str(e)}

    def memory_search(self, query: str, limit: int = 8) -> str:
        """
        Search your persistent memory for facts, decisions, and context from previous sessions.
        Use this when the user asks about something you may have discussed before,
        or when you need context about the user's projects, preferences, or history.
        :param query: What to search for — describe the topic in natural language
        :param limit: How many results to return (default 8, max 20)
        :return: Relevant memories as formatted text
        """
        if not self.valves.memoryai_token:
            return "MemoryAI token not configured."

        resp = self._api("POST", "/v1/memories/search", {
            "query": query,
            "limit": min(limit, 20),
        })
        memories = resp.get("data", [])
        if not memories:
            return "No relevant memories found."

        lines = [f"Found {len(memories)} memories:\n"]
        for m in memories:
            mtype = m.get("type", "fact")
            content = m.get("content", "")
            importance = m.get("importance", 0.5)
            score = m.get("score", 0)
            star = " ★" if importance >= 0.85 else ""
            lines.append(f"[{mtype}{star}] (score: {score:.2f}) {content}")

        return "\n".join(lines)

    def memory_save(
        self,
        content: str,
        memory_type: str = "fact",
        importance: float = 0.7,
    ) -> str:
        """
        Save an important fact, decision, or preference to persistent memory.
        Call this proactively when you learn something worth remembering:
        user preferences, technical decisions, project context, personal details.
        :param content: The fact or information to remember (be specific and self-contained)
        :param memory_type: One of: fact, decision, preference, instruction, entity_relation, summary
        :param importance: How important is this (0.0–1.0). Use 0.9+ for critical decisions/rules.
        :return: Confirmation message
        """
        if not self.valves.memoryai_token:
            return "MemoryAI token not configured."

        valid_types = {"fact", "decision", "preference", "instruction", "entity_relation", "summary"}
        if memory_type not in valid_types:
            memory_type = "fact"
        importance = max(0.1, min(1.0, float(importance)))

        resp = self._api("POST", "/v1/memories", {
            "content": content,
            "type": memory_type,
            "importance": importance,
        })

        if "error" in resp:
            return f"Failed to save: {resp['error']}"
        mem_id = resp.get("data", {}).get("id", "?")
        return f"Memory saved (id: {mem_id[:8]}, type: {memory_type}, importance: {importance})"

    def entity_get(self, name: str) -> str:
        """
        Retrieve everything known about a named entity: person, project, company, or tool.
        Use this when the user mentions a name and you want full context about it.
        :param name: The name of the entity to look up
        :return: Entity facts as formatted text
        """
        if not self.valves.memoryai_token:
            return "MemoryAI token not configured."

        resp = self._api("GET", f"/v1/entities/by-name/{urllib.request.quote(name)}")
        entity = resp.get("data")
        if not entity:
            return f"No entity found for '{name}'."

        lines = [
            f"Entity: {entity.get('name')} ({entity.get('type', 'unknown')})",
            f"Description: {entity.get('description') or '—'}",
        ]
        facts = entity.get("facts", [])
        if facts:
            lines.append(f"Facts ({len(facts)}):")
            for f in facts[:10]:
                lines.append(f"  • {f.get('content', '')}")

        return "\n".join(lines)

    def entity_save(
        self,
        name: str,
        entity_type: str,
        facts: list[str],
        description: str = "",
    ) -> str:
        """
        Save or update a named entity with associated facts.
        Use for people, projects, companies, servers, tools — anything with a proper name
        that comes up repeatedly in conversations.
        :param name: Entity name (e.g. "Dell server", "CRMHub7", "Piotr")
        :param entity_type: One of: person, project, company, tool, server, other
        :param facts: List of fact strings about this entity
        :param description: Optional one-sentence description
        :return: Confirmation message
        """
        if not self.valves.memoryai_token:
            return "MemoryAI token not configured."

        valid_types = {"person", "project", "company", "tool", "server", "other"}
        if entity_type not in valid_types:
            entity_type = "other"

        resp = self._api("POST", "/v1/entities", {
            "name": name,
            "type": entity_type,
            "description": description,
            "facts": [{"content": f} for f in facts if f.strip()],
        })

        if "error" in resp:
            return f"Failed to save entity: {resp['error']}"
        entity_id = resp.get("data", {}).get("id", "?")
        return f"Entity '{name}' saved (id: {entity_id[:8]}, {len(facts)} facts)"

    def memory_get_context(self, topics: str) -> str:
        """
        Load a broader memory context for multiple topics at once.
        Use this at the start of a conversation when you need to recall
        everything relevant to the topics being discussed.
        :param topics: Comma-separated topics or a description of the conversation context
        :return: All relevant memories and entities as formatted text
        """
        if not self.valves.memoryai_token:
            return "MemoryAI token not configured."

        resp = self._api("POST", "/v1/memories/search", {
            "query": topics,
            "limit": 12,
        })
        memories = resp.get("data", [])

        entity_resp = self._api("POST", "/v1/entities/search", {
            "query": topics,
            "limit": 4,
        })
        entities = entity_resp.get("data", [])

        if not memories and not entities:
            return "No relevant context found in memory."

        lines = []
        if memories:
            lines.append(f"## Memories ({len(memories)})")
            for m in memories:
                mtype = m.get("type", "fact")
                content = m.get("content", "")
                imp = m.get("importance", 0.5)
                star = " ★" if imp >= 0.85 else ""
                lines.append(f"[{mtype}{star}] {content}")

        if entities:
            lines.append(f"\n## Entities ({len(entities)})")
            for e in entities:
                name = e.get("name", "")
                etype = e.get("type", "")
                facts = e.get("facts", [])
                ftexts = [f.get("content", "") for f in facts[:2] if isinstance(f, dict)]
                lines.append(f"**{name}** ({etype}): {' | '.join(ftexts)}")

        return "\n".join(lines)
