"""GitHub Actions workflow commands (https://docs.github.com/actions/using-workflows/workflow-commands)."""
from __future__ import annotations

import json
import os
from typing import Any


def gh_error(message: str) -> None:
    print(f"::error::{message}")


def gh_warning(message: str) -> None:
    print(f"::warning::{message}")


def append_step_summary(title: str, body: str) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"### {title}\n\n{body}\n\n")
    except OSError:
        pass


def append_step_summary_json(title: str, data: dict[str, Any]) -> None:
    append_step_summary(title, f"```json\n{json.dumps(data, indent=2)}\n```")