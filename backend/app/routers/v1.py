from fastapi import APIRouter

router = APIRouter(tags=["v1"])


@router.get("/ping", summary="API v1 smoke test")
async def ping() -> dict[str, str]:
    return {"api": "v1", "status": "ok"}
