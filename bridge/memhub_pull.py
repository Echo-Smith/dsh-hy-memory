#!/usr/bin/env python3
"""Read MemHub's own Hy-Memory store read-only and print a JSON array.

DSH host half (`src/memhub.js`) runs this file with the plugin's venv
interpreter before importing anything:

    python bridge/memhub_pull.py \
        --one-memory-home ~/.one-memory \
        --data-dir ~/.one-memory/hy-memory \
        --expect-dims 384 --limit 500

Guarantees:
- the source tree is only stat'ed and copied; nothing under the MemHub home is
  ever opened for writing (the SDK client reads a temp copy);
- the store's embedding dimension is probed first; a mismatch exits with
  `embedding_mismatch` and both values instead of importing anything;
- a live MemHub runtime (`runtime*.json` pid) exits with `memhub_locked`;
- stdout is a JSON array of `{ content, tags?, createdAt? }` entries;
- failures print one JSON object to stderr and exit non-zero:
  `{ "error": code, "message": msg, "details": {...} }`.

Exit codes: 0 ok, 2 embedding_mismatch, 3 memhub_locked, 4 not_found,
5 pull_failed.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

EXIT_CODES = {
    "embedding_mismatch": 2,
    "memhub_locked": 3,
    "memhub_not_detected": 4,
    "pull_failed": 5,
}

# Hy-Memory store roots to try inside <one-memory>/hy-memory, in preference order.
# MemHub 1.0.5 nests `governed-v2` with explicit config paths; a plain
# MEMORY_DATA_DIR store would use the SDK layout directly in the same root.
STORE_LAYOUTS = (
    ("memhub", "vector"),
    ("sdk", os.path.join("data", "vector_db")),
)


class Failure(Exception):
    def __init__(self, code: str, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


def emit_error(failure: Failure) -> int:
    payload: Dict[str, Any] = {"error": failure.code, "message": failure.message}
    if failure.details:
        payload["details"] = failure.details
    print(json.dumps(payload, ensure_ascii=False), file=sys.stderr, flush=True)
    return EXIT_CODES.get(failure.code, 5)


def find_store(data_dir: Path) -> Dict[str, Any]:
    """Locate a Hy-Memory store below the MemHub hy-memory directory."""
    candidates = [data_dir]
    governed = data_dir / "governed-v2"
    if governed.is_dir():
        candidates.insert(0, governed)
    for root in candidates:
        for layout, relative in STORE_LAYOUTS:
            vector = root / relative
            if (vector / "chroma.sqlite3").is_file():
                return {"root": root, "layout": layout, "vector": vector}
    raise Failure(
        "memhub_not_detected",
        f"no Hy-Memory Chroma store under {data_dir}",
        {"dataDir": str(data_dir)},
    )


def probe_dimension(vector: Path) -> Dict[str, Any]:
    """Read collection dimensions and the embedding count without locking."""
    chroma = vector / "chroma.sqlite3"
    uri = f"file:{chroma}?mode=ro"
    try:
        connection = sqlite3.connect(uri, uri=True)
    except sqlite3.Error:
        try:
            connection = sqlite3.connect(f"file:{chroma}?mode=ro&immutable=1", uri=True)
        except sqlite3.Error as error:
            raise Failure("memhub_locked", f"cannot open {chroma} read-only: {error}", {"vector": str(vector)})
    try:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(collections)")}
        dimensions: List[int] = []
        if "dimension" in columns:
            for (dimension,) in connection.execute("SELECT dimension FROM collections"):
                if isinstance(dimension, int) and dimension > 0:
                    dimensions.append(dimension)
        collections = connection.execute("SELECT COUNT(*) FROM collections").fetchone()[0]
        try:
            embeddings = connection.execute("SELECT COUNT(*) FROM embeddings").fetchone()[0]
        except sqlite3.Error:
            embeddings = 0
        try:
            users = [
                str(row[0])
                for row in connection.execute(
                    "SELECT DISTINCT string_value FROM embedding_metadata "
                    "WHERE key = 'user_id' AND string_value IS NOT NULL AND string_value != ''"
                )
            ]
        except sqlite3.Error:
            users = []
    except sqlite3.Error as error:
        raise Failure("pull_failed", f"cannot read {chroma}: {error}", {"vector": str(vector)})
    finally:
        connection.close()
    return {
        "dimensions": sorted(set(dimensions)),
        "collections": int(collections or 0),
        "embeddings": int(embeddings or 0),
        "users": users,
    }


def runtime_pids(home: Path) -> List[int]:
    """PIDs published by a running MemHub runtime (read-only stat of JSON files)."""
    pids: List[int] = []
    try:
        names = sorted(home.glob("runtime*.json"))
    except OSError:
        return pids
    for path in names:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for key in ("pid", "parent_pid"):
            pid = payload.get(key)
            if isinstance(pid, int) and pid > 0 and pid not in pids:
                pids.append(pid)
    return pids


def live_pids(pids: List[int]) -> List[int]:
    alive: List[int] = []
    for pid in pids:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            continue
        except PermissionError:
            alive.append(pid)
            continue
        except OSError:
            continue
        alive.append(pid)
    return alive


def copy_store(store: Dict[str, Any], workspace: Path) -> Path:
    """Copy the store into `workspace` so the SDK can never write the source."""
    target = workspace / "store"
    shutil.copytree(
        store["root"],
        target,
        ignore=shutil.ignore_patterns("logs", "*.log", "__pycache__"),
        symlinks=True,
    )
    return target


def build_config(copy_root: Path, layout: str, dims: Optional[int]):
    from hy_memory.config import MemoryConfig

    # All derived SDK paths (logs, cache, history, coding, graph) follow this.
    os.environ["MEMORY_DATA_DIR"] = str(copy_root)
    config = MemoryConfig.from_env()
    config.enable_graph = False
    if layout == "memhub":
        config.vector_store.persist_directory = str(copy_root / "vector")
        config.cache.db_path = str(copy_root / "cache.sqlite3")
        config.history.db_path = str(copy_root / "history.sqlite3")
        config.coding.db_path = str(copy_root / "coding.sqlite3")
    else:
        config.vector_store.persist_directory = str(copy_root / "data" / "vector_db")
        config.cache.db_path = str(copy_root / "data" / "cache.db")
        config.history.db_path = str(copy_root / "data" / "history.db")
        config.coding.db_path = str(copy_root / "data" / "coding_memory.db")
    if dims:
        config.vector_store.embedding_dims = dims
        config.embedder.embedding_dims = dims
    return config


def millis(value: Any) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    if number <= 0:
        return 0
    return int(number * 1000) if number < 1e12 else int(number)


def entry_of(memory: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    content = memory.get("content")
    if not isinstance(content, str) or not content.strip():
        return None
    entry: Dict[str, Any] = {"content": content}
    tags = memory.get("tags")
    if isinstance(tags, list):
        clean = [str(tag) for tag in tags if str(tag).strip()]
        if clean:
            entry["tags"] = clean
    created = millis(memory.get("created_at") or memory.get("gmt_created") or memory.get("memory_at"))
    if created:
        entry["createdAt"] = created
    return entry


def memories_of(page: Any) -> List[Dict[str, Any]]:
    if not isinstance(page, dict):
        return []
    memories = page.get("memories")
    if isinstance(memories, list):
        return [memory for memory in memories if isinstance(memory, dict)]
    # plain chat shape: {"vdb": {"memories": [...]}, ...}
    vdb = page.get("vdb")
    if isinstance(vdb, dict) and isinstance(vdb.get("memories"), list):
        return [memory for memory in vdb["memories"] if isinstance(memory, dict)]
    return []


def read_entries(
    store: Dict[str, Any],
    limit: int,
    dims: Optional[int],
    users: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    from hy_memory.client import HyMemoryClient

    workspace = Path(tempfile.mkdtemp(prefix="dsh-memhub-pull-"))
    client = None
    entries: List[Dict[str, Any]] = []
    page_size = max(1, min(100, limit))
    user_ids = users or [""]
    # The SDK logs to stdout via loguru; keep stdout clean for the JSON array.
    with contextlib.redirect_stdout(sys.stderr):
        try:
            copy_root = copy_store(store, workspace)
            config = build_config(copy_root, store["layout"], dims)
            client = HyMemoryClient(config=config, mode="lite")
            offset = 0
            while len(entries) < limit:
                page = client.list_memories(
                    user_ids=user_ids, limit=page_size, offset=offset, order="desc", scene="all"
                )
                page_memories = memories_of(page)
                if not page_memories:
                    break
                for memory in page_memories:
                    entry = entry_of(memory)
                    if entry is not None:
                        entries.append(entry)
                    if len(entries) >= limit:
                        break
                offset += len(page_memories)
                if len(page_memories) < page_size:
                    break
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    pass
    shutil.rmtree(workspace, ignore_errors=True)
    return entries


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Read MemHub's Hy-Memory store read-only")
    parser.add_argument("--one-memory-home", default=os.getenv("ONE_MEMORY_HOME") or os.path.expanduser("~/.one-memory"))
    parser.add_argument("--data-dir", default="")
    parser.add_argument("--expect-dims", type=int, default=0)
    parser.add_argument("--limit", type=int, default=500)
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    home = Path(os.path.expanduser(args.one_memory_home))
    data_dir = Path(os.path.expanduser(args.data_dir)) if args.data_dir else home / "hy-memory"
    limit = max(1, int(args.limit))
    try:
        if not home.is_dir():
            raise Failure("memhub_not_detected", f"MemHub home {home} does not exist", {"home": str(home)})
        store = find_store(data_dir)
        probe = probe_dimension(store["vector"])
        source_dims = probe["dimensions"][-1] if probe["dimensions"] else None
        details = {
            "store": str(store["root"]),
            "layout": store["layout"],
            "sourceDims": source_dims,
            "targetDims": args.expect_dims or None,
            "collections": probe["collections"],
            "entries": probe["embeddings"],
        }
        # A dimension difference is not fatal: this worker only reads text, and the
        # host re-embeds every imported entry with this store's own embedder. The
        # values stay in the payload so the panel can explain the copy.
        locked = live_pids(runtime_pids(home))
        if locked:
            raise Failure(
                "memhub_locked",
                f"MemHub runtime (pid {locked[0]}) holds the Hy-Memory store; close MemHub and retry",
                {**details, "pids": locked},
            )
        entries = read_entries(store, limit, source_dims, probe.get("users") or [""])
        print(json.dumps(entries, ensure_ascii=False), flush=True)
        return 0
    except Failure as failure:
        return emit_error(failure)
    except Exception as error:  # never leak a traceback into the host's parser
        return emit_error(Failure("pull_failed", f"{type(error).__name__}: {error}"))


if __name__ == "__main__":
    sys.exit(main())
