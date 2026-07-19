"""Thin Groq JSON helper shared by LLM agents."""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Optional

from groq import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    Groq,
    RateLimitError,
)

DEFAULT_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
CRITIC_MODEL = os.getenv("GROQ_CRITIC_MODEL", "llama-3.1-8b-instant")


def _api_key(api_key: Optional[str] = None) -> str:
    key = (api_key or os.getenv("GROQ_API_KEY") or "").strip()
    if not key:
        raise ValueError("GROQ_API_KEY is missing — add it to .env and save the file.")
    return key


def parse_json(raw: str) -> Any:
    cleaned = re.sub(r"```json\s*", "", raw or "", flags=re.IGNORECASE)
    cleaned = cleaned.replace("```", "").strip()
    if not cleaned:
        raise ValueError("Groq returned an empty response")
    return json.loads(cleaned)


def llm_json(
    system: str,
    user: str,
    *,
    api_key: Optional[str] = None,
    temperature: float = 0.3,
    model: Optional[str] = None,
    retries: int = 2,
) -> Any:
    """Call Groq chat completions and parse a JSON object response."""
    client = Groq(
        api_key=_api_key(api_key),
        timeout=60.0,
        max_retries=0,  # we handle retries ourselves below
    )
    last_err: Optional[BaseException] = None

    for attempt in range(retries + 1):
        try:
            completion = client.chat.completions.create(
                model=model or DEFAULT_MODEL,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=temperature,
                response_format={"type": "json_object"},
            )
            content = completion.choices[0].message.content or ""
            return parse_json(content)
        except RateLimitError as err:
            last_err = err
            if attempt >= retries:
                break
            time.sleep(1.5 * (attempt + 1))
        except (APIConnectionError, APITimeoutError) as err:
            last_err = err
            if attempt >= retries:
                raise ConnectionError(
                    "Could not reach Groq API. Check network / GROQ_API_KEY and retry."
                ) from err
            time.sleep(0.8 * (attempt + 1))
        except APIStatusError as err:
            msg = getattr(err, "message", None) or str(err)
            raise RuntimeError(f"Groq API error ({err.status_code}): {msg}") from err
        except json.JSONDecodeError as err:
            raise ValueError(f"Groq returned invalid JSON: {err}") from err

    raise RuntimeError(f"Groq request failed after retries: {last_err}")
