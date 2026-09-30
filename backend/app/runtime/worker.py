import asyncio
import logging

from redis.asyncio import Redis

from app.core.config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("nextleek.runtime")


async def run() -> None:
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    try:
        while True:
            await redis.set("nextleek:runtime:heartbeat", "alive", ex=30)
            logger.info("runtime heartbeat")
            await asyncio.sleep(10)
    finally:
        await redis.aclose()


if __name__ == "__main__":
    asyncio.run(run())
