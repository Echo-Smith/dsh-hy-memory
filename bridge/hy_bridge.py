"""Sidecar entry for the DSH Hy-Memory plugin.

Runs the SDK's own stdlib HTTP server unchanged, with one addition: when no
remote embedding provider is configured, a local ONNX MiniLM embedder is
injected so the component works with zero configuration.

Only the client factory is replaced; every route, payload and error code stays
the SDK's.
"""

from __future__ import annotations

import os
import sys
import time
import traceback

LOCAL_MODEL_DIMS = 384


class LocalOnnxEmbedding:
    """Implements the SDK's EmbeddingService protocol with chromadb's bundled ONNX model."""

    def __init__(self) -> None:
        from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2

        self._fn = ONNXMiniLM_L6_V2()

    def get_embedding_dims(self) -> int:
        return LOCAL_MODEL_DIMS

    # The SDK truth-tests embeddings (`if not embedding:`) in the coding path, so
    # numpy arrays must leave this adapter as plain lists.
    def _plain(self, rows):
        return [[float(value) for value in row] for row in rows]

    async def embed(self, text: str, use_cache: bool = True):
        return self._plain(self._fn([text]))[0]

    async def embed_with_meta(self, text: str, use_cache: bool = True):
        return self._plain(self._fn([text]))[0], {"embedder": "local-onnx-minilm"}

    async def embed_batch(self, texts, use_cache: bool = True):
        return self._plain(self._fn(list(texts)))

    async def embed_queued(self, text: str, use_cache: bool = True):
        return self._plain(self._fn([text]))[0]

    async def embed_queued_with_meta(self, text: str, use_cache: bool = True):
        return self._plain(self._fn([text]))[0], {"embedder": "local-onnx-minilm"}


_lite_client = None


def _get_lite_client():
    """A lite-mode client on the same store, used for promoted text.

    Promotion already asked the model to distil the lines, so the write only
    needs embeddings. Lite mode skips the extraction/reconcile LLM call, which is
    also the step that intermittently returns an empty response from gateways.
    """
    global _lite_client
    if _lite_client is not None:
        return _lite_client
    from hy_memory.client import HyMemoryClient
    from hy_memory.config import MemoryConfig

    config = MemoryConfig.from_env()
    if os.getenv("HY_MEMORY_LOCAL_EMBED", "0") == "1":
        _lite_client = HyMemoryClient(config=config, mode="lite", embedding_service=LocalOnnxEmbedding())
    else:
        _lite_client = HyMemoryClient(config=config, mode="lite")
    return _lite_client


def install_bridge_routes() -> None:
    """Add scene-aware read routes the SDK server does not expose.

    The SDK's own /api/v1/list and /api/v1/search do not forward ``scene``, so
    working and coding memories (separate stores) would be invisible to the
    panel and to recall. These routes forward the whole supported surface.
    """
    import json

    from hy_memory import server as sdk_server

    base = sdk_server.MemoryHTTPHandler

    class BridgeHandler(base):
        def do_POST(self):  # noqa: N802 - http.server naming
            path = self.path.split("?")[0].rstrip("/")
            if not path.startswith("/bridge/"):
                return super().do_POST()
            body = sdk_server._read_json_body(self)
            if body is None:
                return sdk_server._json_response(self, 400, {"error": "invalid JSON body"})
            try:
                client = sdk_server._get_client()
                if path == "/bridge/v1/list":
                    result = _list(client, body)
                elif path == "/bridge/v1/search":
                    result = _search(client, body)
                elif path == "/bridge/v1/stats":
                    result = _stats(client, body)
                elif path == "/bridge/v1/delete":
                    result = _delete(client, body)
                elif path == "/bridge/v1/add_lite":
                    result = _add_lite(body)
                elif path == "/bridge/v1/add_scene":
                    result = _add_scene(client, body)
                elif path == "/bridge/v1/complete":
                    result = _complete(body)
                elif path == "/bridge/v1/update":
                    result = _update(client, body)
                elif path == "/bridge/v1/history":
                    result = _history(client, body)
                elif path == "/bridge/v1/stats_overview":
                    result = _stats_overview(client, body)
                elif path == "/bridge/v1/metrics":
                    result = _metrics(client, body)
                elif path == "/bridge/v1/recent_history":
                    result = _recent_history(client, body)
                elif path == "/bridge/v1/finalize":
                    result = _finalize(client, body)
                else:
                    return sdk_server._json_response(self, 404, {"error": "not_found", "path": path})
                return sdk_server._json_response(self, 200, result)
            except Exception as error:  # surface the real message, as the SDK does
                import traceback

                traceback.print_exc()
                return sdk_server._json_response(self, 500, {"error": str(error)})

    sdk_server.MemoryHTTPHandler = BridgeHandler

    def _names(body, plural, singular):
        values = body.get(plural)
        if isinstance(values, list) and values:
            return [str(value) for value in values if value]
        single = body.get(singular)
        return [str(single)] if single else None

    def _list(client, body):
        kwargs = {"limit": int(body.get("limit") or 50), "offset": int(body.get("offset") or 0), "order": body.get("order") or "desc"}
        user_ids = _names(body, "user_ids", "user_id")
        agent_ids = _names(body, "agent_ids", "agent_id")
        session_ids = _names(body, "session_ids", "session_id")
        if user_ids:
            kwargs["user_ids"] = user_ids
        if agent_ids:
            kwargs["agent_ids"] = agent_ids
        if session_ids:
            kwargs["session_ids"] = session_ids
        if body.get("layers"):
            kwargs["layers"] = body["layers"]
        if body.get("statuses"):
            kwargs["statuses"] = body["statuses"]
        kwargs["scene"] = body.get("scene") or "all"
        return client.list_memories(**kwargs)

    _session_map = {"at": 0.0, "map": {}}

    def _session_map_refresh(client, user_ids):
        """memory_id to session_id, refreshed once a minute.

        The chat search returns rows without their session id, so the session
        tier could never match. One listing of the same user fills the gap; it
        is cached because searches are frequent and sessions change slowly.
        """
        now = time.time()
        cached = _session_map
        if now - cached["at"] < 60 and cached["map"]:
            return cached["map"]
        mapping = {}
        try:
            page = client.list_memories(user_ids=user_ids, limit=500, offset=0, scene="chat")
            rows = page.get("memories") if isinstance(page, dict) else page
            if isinstance(rows, dict):
                rows = rows.get("memories") or rows.get("normal") or []
            if isinstance(page, dict) and isinstance(page.get("vdb"), dict):
                rows = page["vdb"].get("memories") or rows
            for row in rows or []:
                if not isinstance(row, dict):
                    continue
                memory_id = row.get("memory_id") or row.get("id")
                session_id = row.get("session_id")
                if memory_id and session_id:
                    mapping[str(memory_id)] = str(session_id)
        except Exception:
            mapping = cached["map"]
        _session_map["at"] = now
        _session_map["map"] = mapping
        return mapping

    def _enrich_sessions(client, body, result):
        memory = result.get("memories") if isinstance(result, dict) else None
        if not isinstance(memory, dict):
            return result
        rows = []
        for key in ("normal", "proactive", "schema"):
            value = memory.get(key)
            if isinstance(value, list):
                rows.extend(value)
        if not rows:
            return result
        user_ids = _names(body, "user_ids", "user_id")
        mapping = _session_map_refresh(client, user_ids or [""])
        for row in rows:
            if not isinstance(row, dict) or row.get("session_id"):
                continue
            memory_id = str(row.get("memory_id") or row.get("id") or "")
            session_id = mapping.get(memory_id)
            if session_id:
                row["session_id"] = session_id
        return result

    def _search(client, body):
        query = body.get("query")
        if not query:
            raise ValueError("query is required")
        kwargs = {"limit": int(body.get("limit") or 10)}
        user_ids = _names(body, "user_ids", "user_id")
        if user_ids:
            kwargs["user_ids"] = user_ids
        agent_ids = _names(body, "agent_ids", "agent_id")
        if agent_ids:
            kwargs["agent_ids"] = agent_ids
        session_ids = _names(body, "session_ids", "session_id")
        if session_ids:
            kwargs["session_ids"] = session_ids
        if body.get("scene"):
            kwargs["scene"] = body["scene"]
        if body.get("search_mode"):
            kwargs["search_mode"] = body["search_mode"]
        if body.get("workspace_id"):
            kwargs["workspace_id"] = str(body["workspace_id"])
        if body.get("branch"):
            kwargs["branch"] = str(body["branch"])
        if body.get("min_score") is not None:
            kwargs["min_score"] = float(body["min_score"])
        result = client.search(query, **kwargs)
        try:
            result = _enrich_sessions(client, body, result)
        except Exception:
            pass
        return result

    def _complete(body):
        """Plain completion through the same endpoint the SDK uses.

        The SDK's own model calls disable the thinking channel; promotion reuses
        this route so it cannot hit a reasoning-only empty response.
        """
        import openai

        prompt = str(body.get("prompt") or "").strip()
        if not prompt:
            raise ValueError("prompt is required")
        base_url = os.getenv("MEMORY_LLM_BASE_URL") or None
        api_key = os.getenv("MEMORY_LLM_API_KEY") or "not-needed"
        model = os.getenv("MEMORY_LLM_MODEL") or "gpt-4.1-mini"
        client = openai.OpenAI(api_key=api_key, base_url=base_url, timeout=90.0)
        kwargs = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": int(body.get("maxTokens") or 600),
        }
        lowered = model.lower()
        if any(name in lowered for name in ("deepseek", "kimi", "qwen", "hunyuan")):
            kwargs["extra_body"] = {"thinking": {"type": "disabled"}}
            kwargs["temperature"] = 1.0 if "kimi" in lowered else 0.6
        response = client.chat.completions.create(**kwargs)
        text = (response.choices[0].message.content or "").strip()
        return {"text": text, "model": model}

    def _update(client, body):
        """Edit a memory in place.

        `update` is the SDK's own edit path; the panel used to delete and re-add,
        which lost the memory's history and its id.
        """
        memory_id = str(body.get("memory_id") or body.get("id") or "").strip()
        content = body.get("content")
        if not memory_id:
            raise ValueError("memory_id is required")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("content is required")
        kwargs = {}
        for key in ("kind", "variant", "task"):
            if body.get(key):
                kwargs[key] = str(body[key])
        return client.update(memory_id, content.strip(), **kwargs)

    def _history(client, body):
        """The change history of one memory."""
        memory_id = str(body.get("memory_id") or body.get("id") or "").strip()
        if not memory_id:
            raise ValueError("memory_id is required")
        return {"events": client.history(memory_id)}

    def _stats_overview(client, body):
        """Cheap per-tier counts, straight from the SDK's own aggregation."""
        user_ids = _names(body, "user_ids", "user_id") or ["dsh"]
        kwargs = {"user_id": user_ids[0]}
        statuses = body.get("statuses")
        if isinstance(statuses, list) and statuses:
            kwargs["statuses"] = [str(s) for s in statuses]
        return client.memory_stats(**kwargs)

    def _metrics(client, body):
        """System load as the SDK sees it."""
        minutes = int(body.get("minutes") or 60)
        return client.get_metrics(minutes)

    def _recent_history(client, body):
        """What the engine did recently, newest first."""
        user_ids = _names(body, "user_ids", "user_id") or ["dsh"]
        agent_ids = _names(body, "agent_ids", "agent_id") or None
        limit = int(body.get("limit") or 20)
        return {"events": client.get_recent_history(user_ids[0], agent_ids, limit)}

    def _finalize(client, body):
        """Turn one caller session into an episode narrative.

        Opt-in at the SDK level (MEMORY_SESSION_EPISODE_ENABLED). Calls are
        idempotent per (user, agent, session), so a retry cannot duplicate the
        narrative — which is what makes it safe to run on session end.
        """
        session_id = str(body.get("session_id") or "").strip()
        if not session_id:
            raise ValueError("session_id is required")
        kwargs = {
            "user_id": str(body.get("user_id") or "dsh"),
            "session_id": session_id,
        }
        if body.get("agent_id"):
            kwargs["agent_id"] = str(body["agent_id"])
        if body.get("language"):
            kwargs["language"] = str(body["language"])
        return client.finalize_session(**kwargs)

    def _add_scene(client, body):
        """SDK add that honours an explicit scene.

        The HTTP /api/v1/add route drops `scene` and re-derives it from the
        payload, so a coding or working batch landed in the chat store. This
        calls the SDK directly with the scene and workspace the capture layer
        decided on.
        """
        if not body.get("data"):
            raise ValueError("data is required")
        kwargs = {"user_id": str(body.get("user_id") or "")}
        for key in ("agent_id", "session_id", "source"):
            if body.get(key):
                kwargs[key] = str(body[key])
        if body.get("scene"):
            kwargs["scene"] = str(body["scene"])
        if body.get("workspace_id"):
            kwargs["workspace_id"] = str(body["workspace_id"])
        if body.get("branch"):
            kwargs["branch"] = str(body["branch"])
        result = client.add(body["data"], **kwargs)
        # The SDK reports real token usage per write; without it the panel can
        # only estimate. Pass it through so memory can be accounted for
        # separately from the conversation.
        if isinstance(result, dict) and body.get("with_usage"):
            tokens = result.get("extract_tokens") or {}
            result = {
                **result,
                "usage": {
                    "prompt": int(tokens.get("prompt") or 0),
                    "completion": int(tokens.get("completion") or 0),
                    "total": int(tokens.get("total") or 0),
                },
            }
        return result

    def _add_lite(body):
        data = body.get("data")
        if isinstance(data, list):
            text = "\n".join(
                str(item.get("content") or "").strip()
                for item in data
                if isinstance(item, dict) and str(item.get("content") or "").strip()
            )
        else:
            text = str(data or "").strip()
        if not text:
            raise ValueError("data is required")
        kwargs = {"user_id": str(body.get("user_id") or "")}
        for key in ("agent_id", "session_id", "source"):
            if body.get(key):
                kwargs[key] = str(body[key])
        if body.get("memory_at"):
            kwargs["memory_at"] = body["memory_at"]
        return _get_lite_client().add(text, **kwargs)

    def _stats(client, body):
        user_ids = _names(body, "user_ids", "user_id") or [""]
        page = client.list_memories(user_ids=user_ids, limit=1, offset=0, scene="all")
        totals = page.get("totals") or {}
        return {"scene": "stats", "totals": {store: int(totals.get(store, 0) or 0) for store in ("chat", "working", "coding")}}

    def _delete(client, body):
        memory_id = body.get("id")
        if not memory_id:
            raise ValueError("id is required")
        attempts = []
        if body.get("kind"):
            attempts.append({"kind": body["kind"]})
        attempts.append({})
        if body.get("variant"):
            attempts.append({"variant": body["variant"]})
        last = None
        for extra in attempts:
            try:
                return client.delete(memory_id, **extra)
            except Exception as error:  # try the next namespace hint
                last = error
        raise last if last else RuntimeError("delete failed")


def install_factory() -> None:
    from hy_memory import server as sdk_server
    from hy_memory.client import HyMemoryClient
    from hy_memory.config import MemoryConfig

    use_local = os.getenv("HY_MEMORY_LOCAL_EMBED", "0") == "1"

    def build():
        config = MemoryConfig.from_env()
        if use_local:
            return HyMemoryClient(config=config, embedding_service=LocalOnnxEmbedding())
        return HyMemoryClient(config=config)

    def get_client():
        if sdk_server._client is not None:
            return sdk_server._client
        client = build()
        sdk_server._client = client
        return sdk_server._client

    sdk_server._get_client = get_client


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="DSH Hy-Memory sidecar")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    if os.getenv("HY_MEMORY_LOCAL_EMBED", "0") == "1":
        os.environ.setdefault("MEMORY_EMBEDDING_DIMS", str(LOCAL_MODEL_DIMS))

    install_bridge_routes()
    install_factory()
    from hy_memory import server as sdk_server

    print(f"hy-bridge: starting on {args.host}:{args.port} local_embed={os.getenv('HY_MEMORY_LOCAL_EMBED','0')}", flush=True)
    try:
        sdk_server.run_server(port=args.port, host=args.host)
    except Exception:
        traceback.print_exc()
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
