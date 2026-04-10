#!/usr/bin/env python3
"""
search-patterns-chroma.py

Query script for semantic pattern search via a Chroma vector database.
Called by the search-patterns MCP tool.

Usage:
    python3 scripts/py/search-patterns-chroma.py \
        --query "how to handle coroutine cancellation" \
        --n 5 \
        --db-path /path/to/.chroma

Output (stdout):
    JSON array of results:
    [{"slug": "...", "score": 0.92, "excerpt": "...", "path": "...", "category": "..."}]

    Or a status object on error:
    {"status": "SKIPPED", "reason": "..."}
    {"status": "NOT_INDEXED", "hint": "Run index-patterns-chroma.py first"}
"""

import sys
import json
import os
import argparse

# Graceful import — emit SKIPPED if deps missing
try:
    import chromadb
    from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction
except ImportError:
    print(json.dumps({
        "status": "SKIPPED",
        "reason": "chromadb not installed: pip install chromadb sentence-transformers"
    }))
    sys.exit(0)


COLLECTION_NAME = "patterns"
EMBEDDING_MODEL = "all-MiniLM-L6-v2"


def main() -> None:
    parser = argparse.ArgumentParser(description="Query Chroma pattern index")
    parser.add_argument("--query", required=True, help="Search query text")
    parser.add_argument("--n", type=int, default=5, help="Number of results to return")
    parser.add_argument("--db-path", required=True, help="Path to Chroma persistent DB directory")
    args = parser.parse_args()

    db_path = args.db_path
    query = args.query.strip()
    n = max(1, args.n)

    # Check DB exists
    if not os.path.isdir(db_path):
        print(json.dumps({
            "status": "NOT_INDEXED",
            "hint": "Run index-patterns-chroma.py first"
        }))
        sys.exit(0)

    # Connect to existing DB (no write)
    try:
        client = chromadb.PersistentClient(path=db_path)
    except Exception as e:
        print(json.dumps({
            "status": "ERROR",
            "reason": f"Could not open Chroma DB: {e}"
        }))
        sys.exit(0)

    # Check collection exists
    try:
        ef = SentenceTransformerEmbeddingFunction(model_name=EMBEDDING_MODEL)
        collection = client.get_collection(name=COLLECTION_NAME, embedding_function=ef)
    except Exception:
        print(json.dumps({
            "status": "NOT_INDEXED",
            "hint": "Run index-patterns-chroma.py first"
        }))
        sys.exit(0)

    # Handle empty query
    if not query:
        print(json.dumps([]))
        sys.exit(0)

    # Query
    try:
        results = collection.query(
            query_texts=[query],
            n_results=min(n, collection.count()),
            include=["documents", "metadatas", "distances"],
        )
    except Exception as e:
        print(json.dumps({
            "status": "ERROR",
            "reason": f"Query failed: {e}"
        }))
        sys.exit(0)

    # Cosine distance → similarity score (Chroma returns distance, lower = more similar)
    output = []
    ids = results.get("ids", [[]])[0]
    documents = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]

    for i, doc_id in enumerate(ids):
        meta = metadatas[i] if i < len(metadatas) else {}
        distance = distances[i] if i < len(distances) else 1.0
        # Convert cosine distance to similarity score (0-1 range, higher = better)
        score = round(max(0.0, 1.0 - distance), 4)
        body = documents[i] if i < len(documents) else ""
        excerpt = body[:200].replace("\n", " ").strip() if body else ""

        output.append({
            "slug": meta.get("slug") or doc_id,
            "score": score,
            "excerpt": excerpt,
            "path": meta.get("path") or "",
            "category": meta.get("category") or "",
        })

    print(json.dumps(output))


if __name__ == "__main__":
    main()
