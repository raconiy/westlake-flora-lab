"""Run one finite producer-to-review handoff on the private research coordinator.
On the coordinator host: python3 run-gated-review.py reviewed-batch.json
An interrupted run can use the same immutable manifest; request keys are idempotent.
The coordinator intentionally accepts data records, not code execution.
"""
import hashlib
import json
import re
import sys
import os
import sqlite3
import time
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8788"
ROLES = {"infra", "physics", "botany", "scene", "qa"}


def validate(plan):
    producers, review = plan["producers"], plan["review"]
    if not re.fullmatch(r"[A-Za-z0-9-]{1,64}", plan["batch"]):
        raise ValueError("invalid batch")
    if not 1 <= len(producers) <= 5 or len({x["role"] for x in producers}) != len(producers):
        raise ValueError("provide one to five distinct producers")
    for item in [*producers, review]:
        if item["role"] not in ROLES or not item["title"].strip() or not item["prompt"].strip():
            raise ValueError("missing role or deliverable")
    if review.get("handoffFrom"):
        raise ValueError("review parents are the live producer outputs")


def run(plan, submit, statuses, pause=time.sleep, clock=time.monotonic, timeout=900):
    validate(plan)
    deadline = clock() + timeout

    def enqueue(item, stage, parents):
        key = plan["batch"] + "-" + stage + "-" + item["role"]
        task = submit({"title": item["title"], "prompt": item["prompt"], "kind": "research",
                       "role": item["role"], "requestKey": key, "handoffFrom": parents})
        print(json.dumps({"stage": stage, "role": item["role"], "task": task, "parents": parents}), flush=True)
        return task

    def complete(ids):
        while clock() < deadline:
            states = statuses(ids)
            for ident in ids:
                s = states.get(ident)
                if s and s["status"] not in ("queued", "running", "leased", "completed"):
                    raise RuntimeError(f"{ident}: {s['status']}; review blocked, no automatic reinference")
            if all(states.get(i, {}).get("status") == "completed" for i in ids):
                for i in ids:
                    result = states[i].get("result") or {}
                    if (result.get("kind") != "research_artifact" or not result.get("artifact", {}).get("records")
                            or json.loads(result["modelOutput"]) != result["artifact"]):
                        raise RuntimeError(f"{i}: no usable artifact")
                    if hashlib.sha256(result["modelOutput"].encode()).hexdigest() != result["fullOutput"]["sha256"]:
                        raise RuntimeError(f"{i}: artifact hash mismatch")
                return
            pause(5)
        raise TimeoutError("private coordinator batch deadline; resume with the same manifest")

    parents = [enqueue(x, "produce", x.get("handoffFrom", [])) for x in plan["producers"]]
    complete(parents)
    child = enqueue(plan["review"], "review", parents)
    complete([child])
    return child


if __name__ == "__main__":
    plan = json.loads(Path(sys.argv[1]).read_text())
    token = (Path(os.environ.get("CREDENTIALS_DIRECTORY", "/etc/westlake-swarm"))/"admin-token").read_text().strip()

    def api(path, body=None):
        req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body else None,
                                     headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=12) as response:
            return json.load(response)

    def exact_states(ids):
        # The administrative list is capped at 200; long queues can hide known task IDs.
        with sqlite3.connect("file:/var/lib/westlake-research-coordinator/sessions.sqlite?mode=ro",uri=True) as db:
            args=",".join("?" for _ in ids)
            matches=db.execute(f"SELECT id,status,result FROM tasks WHERE id IN ({args})",ids)
            return {i:{"status":s,"result":json.loads(r) if r else None} for i,s,r in matches}

    run(plan, lambda body: api("/api/suggestions", body)["task"]["id"], exact_states)
