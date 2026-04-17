#!/usr/bin/env python3
"""
index-patterns-chroma.py

One-off script that indexes all docs/**/*.md pattern documents into a
Chroma vector database for semantic search via the search-patterns MCP tool.

Usage:
    python3 scripts/py/index-patterns-chroma.py --project-root <path> [--force-rebuild]

Output:
    stderr: progress messages
    stdout: JSON summary {"indexed": N, "db_path": "..."}

Requires:
    pip install chromadb sentence-transformers
"""

import sys
import json
import os
import re
import argparse

# Graceful import — emit SKIPPED if deps missing
try:
    import chromadb
    from chromadb.utils import embedding_functions
except ImportError:
    print(json.dumps({
        "status": "SKIPPED",
        "reason": "chromadb not installed: pip install chromadb sentence-transformers"
    }))
    sys.exit(0)

# sentence-transformers is a separate dep from chromadb
try:
    from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction
except ImportError:
    print(json.dumps({
        "status": "SKIPPED",
        "reason": "sentence-transformers not installed: pip install sentence-transformers"
    }))
    sys.exit(0)


COLLECTION_NAME = "patterns"
EMBEDDING_MODEL = "all-MiniLM-L6-v2"


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Extract YAML frontmatter and body from a markdown file."""
    if not content.startswith("---"):
        return {}, content

    end = content.find("\n---", 3)
    if end == -1:
        return {}, content

    frontmatter_block = content[3:end].strip()
    body = content[end + 4:].strip()

    meta = {}
    for line in frontmatter_block.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # Simple key: value parsing (handles quoted and unquoted values)
        m = re.match(r'^(\w[\w\-]*)\s*:\s*(.+)$', line)
        if m:
            key = m.group(1)
            value = m.group(2).strip().strip('"').strip("'")
            meta[key] = value

    return meta, body


def find_docs(project_root: str) -> list[dict]:
    """Walk docs/**/*.md and return list of document dicts."""
    docs_dir = os.path.join(project_root, "docs")
    documents = []

    if not os.path.isdir(docs_dir):
        print(f"[WARN] docs/ directory not found at {docs_dir}", file=sys.stderr)
        return documents

    for root, _dirs, files in os.walk(docs_dir):
        for filename in files:
            if not filename.endswith(".md"):
                continue

            filepath = os.path.join(root, filename)
            rel_path = os.path.relpath(filepath, project_root).replace("\\", "/")

            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
            except OSError as e:
                print(f"[WARN] Could not read {rel_path}: {e}", file=sys.stderr)
                continue

            meta, body = parse_frontmatter(content)

            # Use slug from frontmatter or derive from filename
            slug = meta.get("slug") or os.path.splitext(filename)[0]
            description = meta.get("description") or ""
            category = meta.get("category") or ""
            scope = meta.get("scope") or ""

            # Build searchable text: description + body (truncated for embedding)
            searchable = f"{description}\n\n{body}"[:4000]

            documents.append({
                "id": slug,
                "text": searchable,
                "meta": {
                    "slug": slug,
                    "description": description,
                    "category": category,
                    "scope": str(scope),
                    "path": rel_path,
                },
            })

    return documents


def main() -> None:
    parser = argparse.ArgumentParser(description="Index pattern docs into Chroma")
    parser.add_argument("--project-root", required=True, help="Root of the AndroidCommonDoc project")
    parser.add_argument("--force-rebuild", action="store_true", help="Drop and rebuild the collection")
    args = parser.parse_args()

    project_root = os.path.abspath(args.project_root)
    db_path = os.path.join(project_root, ".chroma")

    print(f"[INFO] Project root: {project_root}", file=sys.stderr)
    print(f"[INFO] Chroma DB path: {db_path}", file=sys.stderr)

    # Initialize Chroma client
    client = chromadb.PersistentClient(path=db_path)

    # Set up embedding function
    ef = SentenceTransformerEmbeddingFunction(model_name=EMBEDDING_MODEL)

    # Handle force rebuild
    if args.force_rebuild:
        try:
            client.delete_collection(COLLECTION_NAME)
            print(f"[INFO] Dropped existing collection '{COLLECTION_NAME}'", file=sys.stderr)
        except Exception:
            pass  # Collection may not exist yet

    collection = client.get_or_create_collection(
        name=COLLECTION_NAME,
        embedding_function=ef,
        metadata={"hnsw:space": "cosine"},
    )

    # Discover and index documents
    documents = find_docs(project_root)
    print(f"[INFO] Found {len(documents)} markdown files in docs/", file=sys.stderr)

    if not documents:
        print(json.dumps({"indexed": 0, "db_path": db_path}))
        return

    # Upsert in batches to avoid memory issues
    batch_size = 50
    indexed = 0

    for i in range(0, len(documents), batch_size):
        batch = documents[i:i + batch_size]
        ids = [doc["id"] for doc in batch]
        texts = [doc["text"] for doc in batch]
        metadatas = [doc["meta"] for doc in batch]

        collection.upsert(ids=ids, documents=texts, metadatas=metadatas)
        indexed += len(batch)
        print(f"[INFO] Indexed {indexed}/{len(documents)} documents...", file=sys.stderr)

    print(f"[INFO] Done. Collection '{COLLECTION_NAME}' has {collection.count()} entries.", file=sys.stderr)
    print(json.dumps({"indexed": indexed, "db_path": db_path}))


if __name__ == "__main__":
    main()
