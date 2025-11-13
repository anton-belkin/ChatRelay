import asyncio
import logging
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agno.tools.function import Function, ToolResult
from agno.tools.mcp import MCPTools

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=LOG_LEVEL)
logger = logging.getLogger("agent-service")

MCP_GATEWAY_URL = os.getenv("MCP_GATEWAY_URL", "http://mcp-gateway:8080")
MCP_TRANSPORT = os.getenv("MCP_TRANSPORT", "streamable-http")
TOOLKIT_TIMEOUT_SECONDS = int(os.getenv("MCP_TIMEOUT_SECONDS", "15"))

LOCAL_TOOLS: Dict[str, Dict[str, Any]] = {}


async def _generate_number(value: int = 10) -> ToolResult:
    normalized = int(value)
    return ToolResult(content=f"demo.generate_number produced value: {normalized}")


LOCAL_TOOLS["demo.generate_number"] = {
    "description": "Returns the provided integer (defaults to 10). Useful for diagnostics and tests.",
    "parameters": {
        "type": "object",
        "properties": {
            "value": {
                "type": "integer",
                "description": "The integer to echo back.",
                "default": 10,
                "minimum": -1_000_000,
                "maximum": 1_000_000,
            }
        },
    },
    "handler": _generate_number,
}


class ToolDescriptor(BaseModel):
    name: str
    description: Optional[str] = None
    parameters: Dict[str, Any]
    origin: str = Field(default="mcp")


class ToolCallRequest(BaseModel):
    name: str
    arguments: Dict[str, Any] = Field(default_factory=dict)


class ToolCallResponse(BaseModel):
    name: str
    content: str
    origin: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


app = FastAPI(title="Tool Agent Service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

toolkit: Optional[MCPTools] = None
toolkit_lock = asyncio.Lock()
tool_cache: List[ToolDescriptor] = []
last_refresh: float = 0.0


def _serialize_function(func: Function) -> ToolDescriptor:
    data = func.to_dict()
    return ToolDescriptor(
        name=data.get("name", func.name),
        description=data.get("description"),
        parameters=data.get("parameters") or {"type": "object", "properties": {}},
        origin="mcp",
    )


def _serialize_local_tools() -> List[ToolDescriptor]:
    descriptors: List[ToolDescriptor] = []
    for name, payload in LOCAL_TOOLS.items():
        descriptors.append(
            ToolDescriptor(
                name=name,
                description=payload.get("description"),
                parameters=payload.get("parameters") or {"type": "object", "properties": {}},
                origin="local",
            )
        )
    return descriptors


async def _ensure_toolkit(force: bool = False) -> Optional[MCPTools]:
    global toolkit, tool_cache, last_refresh
    async with toolkit_lock:
        if toolkit is None:
            toolkit = MCPTools(
                url=MCP_GATEWAY_URL,
                transport=MCP_TRANSPORT,  # type: ignore[arg-type]
                timeout_seconds=TOOLKIT_TIMEOUT_SECONDS,
            )
        try:
            await toolkit.connect(force=force)
            tool_cache = _serialize_local_tools()
            tool_cache.extend(_serialize_function(func) for func in toolkit.functions.values())
            last_refresh = time.time()
            return toolkit
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning("Failed to initialize MCP toolkit: %s", exc)
            if force:
                # drop toolkit so that the next call retries from scratch
                toolkit = None
            tool_cache = _serialize_local_tools()
            last_refresh = time.time()
            return None


async def _ensure_connected_if_stale() -> Optional[MCPTools]:
    if toolkit is None:
        return await _ensure_toolkit(force=True)
    if toolkit.initialized:
        try:
            if await toolkit.is_alive():
                return toolkit
        except Exception:  # pragma: no cover - fall back to reconnect
            pass
    return await _ensure_toolkit(force=True)


def _normalize_tool_result(name: str, origin: str, result: ToolResult) -> ToolCallResponse:
    metadata: Dict[str, Any] = {}
    if result.images:
        metadata["images"] = len(result.images)
    if result.videos:
        metadata["videos"] = len(result.videos)
    if result.audios:
        metadata["audios"] = len(result.audios)
    if result.files:
        metadata["files"] = len(result.files)
    return ToolCallResponse(name=name, content=result.content, origin=origin, metadata=metadata)


async def _call_local_tool(name: str, arguments: Dict[str, Any]) -> Optional[ToolCallResponse]:
    payload = LOCAL_TOOLS.get(name)
    if not payload:
        return None
    handler = payload.get("handler")
    if handler is None:
        raise HTTPException(status_code=500, detail=f"Local tool '{name}' is not configured correctly.")
    try:
        maybe_result = handler(**arguments)  # type: ignore[arg-type]
    except TypeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid arguments for '{name}': {exc}") from exc
    if asyncio.iscoroutine(maybe_result):
        result: ToolResult = await maybe_result  # type: ignore[assignment]
    else:
        result = maybe_result  # type: ignore[assignment]
    return _normalize_tool_result(name=name, origin="local", result=result)


async def _call_mcp_tool(name: str, arguments: Dict[str, Any]) -> ToolCallResponse:
    client = await _ensure_connected_if_stale()
    if client is None or not client.initialized:
        raise HTTPException(status_code=503, detail="MCP tools are not available right now.")

    function = client.functions.get(name)
    if function is None or function.entrypoint is None:
        raise HTTPException(status_code=404, detail=f"Tool '{name}' is not registered.")

    try:
        result = await function.entrypoint(**arguments)  # type: ignore[misc]
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Tool '%s' failed: %s", name, exc)
        raise HTTPException(status_code=500, detail=f"Tool '{name}' failed: {exc}") from exc

    return _normalize_tool_result(name=name, origin="mcp", result=result)


@app.on_event("startup")
async def startup_event() -> None:
    await _ensure_toolkit(force=True)
    logger.info("Tool service ready with %d tool(s).", len(tool_cache))


@app.on_event("shutdown")
async def shutdown_event() -> None:
    if toolkit and toolkit.initialized:
        await toolkit.close()


@app.get("/health")
async def healthcheck() -> Dict[str, Any]:
    return {
        "status": "ok",
        "tools": len(tool_cache),
        "lastRefreshEpoch": last_refresh,
        "gatewayUrl": MCP_GATEWAY_URL,
    }


@app.get("/tools")
async def list_tools(force: bool = False) -> Dict[str, Any]:
    if force:
        await _ensure_toolkit(force=True)
    elif not tool_cache or (time.time() - last_refresh) > 60:
        await _ensure_connected_if_stale()
    return {"tools": tool_cache, "updatedAt": last_refresh}


@app.post("/call-tool", response_model=ToolCallResponse)
async def call_tool(payload: ToolCallRequest) -> ToolCallResponse:
    arguments = payload.arguments or {}
    local_response = await _call_local_tool(payload.name, arguments)
    if local_response:
        return local_response
    return await _call_mcp_tool(payload.name, arguments)
