#!/usr/bin/env python3
"""
Cognee Memory Bridge for OpenClaw

This script provides a JSON-based interface to Cognee for the TypeScript plugin.
It handles initialization, adding data, searching, and managing the knowledge graph.
"""

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional

try:
    import cognee
except ImportError as e:
    print(json.dumps({"error": f"cognee not installed. Run: pip install cognee. Details: {str(e)}"}, indent=2), file=sys.stderr)
    sys.exit(1)
except Exception as e:
    # Handle other import errors (like dependency issues)
    error_msg = str(e)
    if "HTTP_422_UNPROCESSABLE_CONTENT" in error_msg:
        error_msg = "Cognee dependency error: starlette version mismatch. Try: pip install --upgrade starlette fastapi"
    print(json.dumps({"error": f"Cognee import failed: {error_msg}"}, indent=2), file=sys.stderr)
    sys.exit(1)


class CogneeBridge:
    def __init__(self, data_dir: str, llm_api_key: str, llm_provider: str = "openai", llm_model: Optional[str] = None):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.llm_api_key = llm_api_key
        self.llm_provider = llm_provider
        self.llm_model = llm_model
        self.initialized = False

    async def initialize(self):
        """Initialize Cognee with configuration."""
        if self.initialized:
            return

        try:
            # Set environment variable for LLM
            os.environ["LLM_API_KEY"] = self.llm_api_key
            if self.llm_provider != "openai":
                os.environ["LLM_PROVIDER"] = self.llm_provider
            if self.llm_model:
                os.environ["LLM_MODEL"] = self.llm_model

            # Initialize Cognee (this sets up the system)
            # Cognee uses environment variables and data directory
            self.initialized = True
            return {"status": "initialized"}
        except Exception as e:
            return {"error": str(e)}

    async def add(self, text: str) -> Dict[str, Any]:
        """Add text to Cognee."""
        try:
            await self.initialize()
            await cognee.add(text)
            return {"status": "added", "text": text[:100]}
        except Exception as e:
            return {"error": str(e)}

    async def cognify(self) -> Dict[str, Any]:
        """Generate knowledge graph from added data."""
        try:
            await self.initialize()
            await cognee.cognify()
            return {"status": "cognified"}
        except Exception as e:
            return {"error": str(e)}

    async def memify(self) -> Dict[str, Any]:
        """Add memory algorithms to the graph."""
        try:
            await self.initialize()
            await cognee.memify()
            return {"status": "memified"}
        except Exception as e:
            return {"error": str(e)}

    async def search(self, query: str, limit: int = 5) -> Dict[str, Any]:
        """Search the knowledge graph."""
        try:
            await self.initialize()
            results = await cognee.search(query)
            
            # Limit results
            limited_results = results[:limit] if isinstance(results, list) else [results]
            
            # Format results for JSON serialization
            formatted = []
            for i, result in enumerate(limited_results):
                if isinstance(result, dict):
                    formatted.append(result)
                elif isinstance(result, str):
                    formatted.append({"text": result, "index": i})
                else:
                    formatted.append({"content": str(result), "index": i})
            
            return {"status": "success", "results": formatted, "count": len(formatted)}
        except Exception as e:
            return {"error": str(e)}

    async def delete_all(self) -> Dict[str, Any]:
        """Delete all data from Cognee."""
        try:
            await self.initialize()
            await cognee.delete()
            return {"status": "deleted"}
        except Exception as e:
            return {"error": str(e)}


async def main():
    """Main entry point for the bridge."""
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: bridge.py <command> [args...]"}), file=sys.stderr)
        sys.exit(1)

    command = sys.argv[1]
    
    # Read config from environment or stdin
    data_dir = os.environ.get("COGNEE_DATA_DIR", str(Path.home() / ".openclaw" / "memory" / "cognee"))
    llm_api_key = os.environ.get("LLM_API_KEY", "")
    llm_provider = os.environ.get("LLM_PROVIDER", "openai")
    llm_model = os.environ.get("LLM_MODEL")

    if not llm_api_key:
        print(json.dumps({"error": "LLM_API_KEY environment variable required"}), file=sys.stderr)
        sys.exit(1)

    bridge = CogneeBridge(data_dir, llm_api_key, llm_provider, llm_model)

    try:
        if command == "add":
            if len(sys.argv) < 3:
                print(json.dumps({"error": "Usage: bridge.py add <text>"}), file=sys.stderr)
                sys.exit(1)
            result = await bridge.add(sys.argv[2])
        elif command == "cognify":
            result = await bridge.cognify()
        elif command == "memify":
            result = await bridge.memify()
        elif command == "search":
            if len(sys.argv) < 3:
                print(json.dumps({"error": "Usage: bridge.py search <query> [limit]"}), file=sys.stderr)
                sys.exit(1)
            limit = int(sys.argv[3]) if len(sys.argv) > 3 else 5
            result = await bridge.search(sys.argv[2], limit)
        elif command == "delete":
            result = await bridge.delete_all()
        else:
            result = {"error": f"Unknown command: {command}"}
    except Exception as e:
        result = {"error": str(e)}

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
