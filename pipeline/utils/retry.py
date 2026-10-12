"""Retry helper with exponential backoff for transient ingest failures."""
from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


def retry_call(
    fn: Callable[[], T],
    *,
    max_attempts: int = 3,
    base_delay_sec: float = 2.0,
    max_delay_sec: float = 30.0,
    retry_on: tuple[type[BaseException], ...] = (Exception,),
) -> T:
    """Call ``fn`` up to ``max_attempts`` times with exponential backoff."""
    attempt = 0
    last_err: BaseException | None = None
    while attempt < max_attempts:
        attempt += 1
        try:
            return fn()
        except retry_on as exc:
            last_err = exc
            if attempt >= max_attempts:
                break
            delay = min(base_delay_sec * (2 ** (attempt - 1)), max_delay_sec)
            logger.warning(
                "Retry %d/%d after %s: %s",
                attempt,
                max_attempts,
                delay,
                exc,
            )
            time.sleep(delay)
    assert last_err is not None
    raise last_err
