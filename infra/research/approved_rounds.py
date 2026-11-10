"""Consume immutable, privately approved reconstruction work orders. All remote work uses fixed call sites."""
import argparse
import contextlib
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import uuid

import asset_rules
import gap_rules

ROLES = set(asset_rules.CONTRACTS)
SUITES = {"asset": asset_rules, "gap": gap_rules}
JOB = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}")
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}")
HASH = re.compile(r"[a-f0-9]{64}")

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def require(condition, error):
    if not condition:
        raise ValueError(error)

def strict_json(raw):
    def no_duplicates(pairs):
        result = dict(pairs)
        require(len(pairs) == len(result), "duplicate JSON field")
        return result
    return json.loads(raw, object_pairs_hook=no_duplicates)

def durable_json(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump(value, out, ensure_ascii=False, separators=(",", ":"))
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
        d = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(d)
        finally:
            os.close(d)
    finally:
        Path(tmp).unlink(missing_ok=True)

def trusted(st, owner):
    return st.st_uid == owner and not st.st_mode & (stat.S_IWGRP | stat.S_IWOTH)

@contextlib.contextmanager
def open_dir(path, owner):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        require(trusted(os.fstat(fd), owner), "untrusted input directory permissions")
        yield fd
    finally:
        os.close(fd)

def read_private(dir_fd, name, owner, max_size, digest_only=False):
    require(NAME.fullmatch(name), "unsafe input name")
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=dir_fd)
    with os.fdopen(fd, "rb") as stream:
        st = os.fstat(stream.fileno())
        require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and trusted(st, owner), "untrusted input file")
        require(0 < st.st_size <= max_size, "input file size is outside permitted range")
        if digest_only:
            digest = hashlib.sha256()
            for chunk in iter(lambda: stream.read(1024*1024), b""):
                digest.update(chunk)
            return digest.hexdigest()
        raw = stream.read(max_size + 1)
        require(len(raw) == st.st_size, "input changed during read")
        return raw

def is_uuid(value):
    return isinstance(value, str) and str(uuid.UUID(value)) == value

def text_field(value):
    return isinstance(value, str) and 0 < len(value.strip()) <= 8192

def check_gap_input(item, role):
    names = {contract[0]: key for key,contract in asset_rules.CONTRACTS.items()}
    for key in ("ownTestedRule","peerTestedRule"):
        rule = item[key]
        require(isinstance(rule, dict) and set(rule) == {"name","expression","limitations"} and text_field(rule["limitations"]), "invalid prior rule")
        parent_role = names.get(rule["name"])
        require(parent_role and ((parent_role == role) == (key == "ownTestedRule")), "incorrect parent function contract")
        asset_rules.test_rule(parent_role, rule["expression"])
    measure = item["actualPairsPercent"]
    require(isinstance(measure, dict) and 1 <= len(measure) <= 64, "missing camera measurements")
    for camera, crowns in measure.items():
        require(re.fullmatch(r"[0-9]{2}", camera) and isinstance(crowns, dict) and set(crowns) == {"foreground","middle","left"}, "unknown camera or crown")
        for values in crowns.values():
            require(isinstance(values, dict) and set(values) == {"photo","A","B"} and
                    all(type(v) in (int,float) and 0 <= v <= 100 for v in values.values()), "invalid measured percentages")
    require(text_field(item["nextObjective"]), "invalid next objective")

def validate_inputs(payload, suite="asset"):
    require(isinstance(payload, dict) and set(payload) == ROLES, "expected exactly five named contracts")
    ids = []
    for role in sorted(ROLES):
        item = payload[role]
        fields = {"previousRoleDecision","jointReview"} if suite == "asset" else {"ownTestedRule","peerTestedRule","actualPairsPercent","nextObjective"}
        require(isinstance(item, dict) and set(item) == {"codeTaskId","parents"} | fields, "unexpected contract input fields")
        require(is_uuid(item["codeTaskId"]), "invalid task id")
        parents = item["parents"]
        require(isinstance(parents, list) and 1 <= len(parents) <= 16 and all(is_uuid(p) for p in parents), "invalid parent IDs")
        require(len(parents) == len(set(parents)), "duplicate parent")
        if suite == "asset":
            require(all(text_field(item[k]) for k in fields), "invalid parent delivery")
        else:
            check_gap_input(item, role)
        ids.append(item["codeTaskId"])
    require(len(set(ids)) == len(ROLES), "duplicate code task id")
    require(not any(set(ids).intersection(item["parents"]) for item in payload.values()), "new work cannot be its own prerequisite")
    return ids

def check_ref(ref):
    require(isinstance(ref, dict) and set(ref) == {"name","sha256"}, "invalid input reference")
    require(isinstance(ref["name"], str) and NAME.fullmatch(ref["name"]), "invalid artifact name")
    require(isinstance(ref["sha256"], str) and HASH.fullmatch(ref["sha256"]), "invalid artifact digest")
    return ref

def decode_order(raw, jobname):
    doc = strict_json(raw)
    require(isinstance(doc, dict) and set(doc).difference({"suite"}) == {"schema","jobId","artifact","evidence"}, "invalid approval fields")
    require(type(doc["schema"]) is int and doc["schema"] == 1, "unknown approval schema")
    require(isinstance(doc["jobId"], str) and JOB.fullmatch(doc["jobId"]) and jobname == doc["jobId"]+".ready.json", "filename and approval id must match")
    require(doc.get("suite","asset") in SUITES, "unknown contract suite")
    inputs, evidence = check_ref(doc["artifact"]), check_ref(doc["evidence"])
    require(inputs["name"].endswith(".json"), "five-role input must be JSON")
    require(inputs["name"] != evidence["name"] and inputs["sha256"] != evidence["sha256"], "separate source evidence required")
    return doc

def run_registered(payload, output_dir):
    order = json.loads((output_dir/"approved.json").read_text())
    suite = order.get("suite", "asset")
    credential_dir = Path(os.environ["CREDENTIALS_DIRECTORY"])
    require(credential_dir.is_absolute() and (credential_dir/"inference-key").is_file(), "systemd inference credential unavailable")
    inputs = output_dir/"inputs.json"
    durable_json(inputs, payload)
    # Absolute trusted script + two data paths and a validated enum. No shell or model-generated program.
    tool = Path(__file__).resolve().with_name("write-asset-rules.py")
    subprocess.run([sys.executable, "-E", "-s", "-B", str(tool), str(output_dir), str(inputs), suite],
                   cwd=output_dir, check=True, timeout=510)
    spec = SUITES[suite]
    receipts = {}
    for role, item in payload.items():
        for path in sorted(output_dir.glob(role+"-*.json")):
            row = strict_json(path.read_bytes())
            if row.get("state") != "tested":
                continue
            require(row.get("role") == role and row.get("taskId") == item["codeTaskId"] and row.get("parents") == item["parents"], "receipt lineage mismatch")
            require(row.get("model") == "gpt-6.1-sol" and row.get("requestId") and row.get("upstreamId"), "missing inference request receipt")
            usage = row.get("usage")
            require(isinstance(usage, dict) and type(usage.get("output_tokens")) is int and usage["output_tokens"] > 0, "missing output usage")
            rule = row["rule"]
            require(hashlib.sha256(row["modelOutput"].encode()).hexdigest() == row["outputSha256"], "model artifact digest mismatch")
            require(strict_json(row["modelOutput"]) == rule and rule["name"] == spec.CONTRACTS[role][0], "returned function identity mismatch")
            passed = spec.test_rule(role, rule["expression"])
            require(passed == row["testsPassed"], "function test evidence differs")
            receipts[role] = {"taskId":item["codeTaskId"],"requestId":row["requestId"],"outputTokens":usage["output_tokens"],"outputSha256":row["outputSha256"],"assertions":passed}
            break
    require(set(receipts) == ROLES, "five completed code receipts are required")
    durable_json(output_dir/"verified.json", receipts)

def drain(inbox, artifacts, state, *, run, trusted_uid=0):
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    result = {"started":0, "succeeded":0, "failed":0, "rejected":0, "skipped":0}
    with open_dir(inbox, trusted_uid) as inbox_fd, open_dir(artifacts, trusted_uid) as assets_fd, (state/"drain.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        previous = []
        for path in state.glob("*.json"):
            if not HASH.fullmatch(path.stem):
                continue
            row = strict_json(path.read_bytes())
            if row["status"] == "running":
                row.update(status="failed", reason="interrupted; reconcile existing receipts before authorizing new work", finishedAt=now())
                durable_json(path, row)
            previous.append(row)
        for name in sorted(os.listdir(inbox_fd)):
            if not name.endswith(".ready.json"):
                continue
            raw = b""
            try:
                raw = read_private(inbox_fd, name, trusted_uid, 4096)
                doc = decode_order(raw, name)
                evidence, source = doc["evidence"], doc["artifact"]
                marker = state/(evidence["sha256"]+".json")
                if marker.is_file():
                    result["skipped"] += 1
                    continue
                require(read_private(assets_fd, evidence["name"], trusted_uid, 256*1024*1024, True) == evidence["sha256"], "source evidence hash mismatch")
                data = read_private(assets_fd, source["name"], trusted_uid, 128*1024)
                require(hashlib.sha256(data).hexdigest() == source["sha256"], "input digest mismatch")
                payload = strict_json(data)
                ids = validate_inputs(payload, doc.get("suite","asset"))
                require(not any(set(ids).intersection(prev["taskIds"]) or prev["jobId"] == doc["jobId"] for prev in previous), "task IDs or approval ID have already been consumed")
            except (OSError, ValueError, TypeError, KeyError, RecursionError, ArithmeticError, SyntaxError) as exc:
                key = hashlib.sha256(name.encode("utf-8","surrogateescape")+b"\0"+raw).hexdigest()
                dest = state/"rejected"/(key+".json")
                if not dest.exists():
                    durable_json(dest,{"status":"rejected","file":name,"reason":str(exc)[:220],"time":now()})
                result["rejected"] += 1
                continue
            row = {"status":"running","jobId":doc["jobId"],"suite":doc.get("suite","asset"),"evidenceSha256":evidence["sha256"],
                   "inputsSha256":source["sha256"],"taskIds":ids,"startedAt":now()}
            durable_json(marker, row)
            previous.append(row)
            result["started"] += 1
            output_dir = state/"deliveries"/evidence["sha256"]
            try:
                durable_json(output_dir/"approved.json", doc)
                run(payload, output_dir)
                row["status"] = "succeeded"
            except Exception as exc:
                row.update(status="failed",reason=type(exc).__name__,detail=str(exc)[:220])
            row["finishedAt"] = now()
            durable_json(marker, row)
            result[row["status"]] += 1
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("inbox", type=Path)
    parser.add_argument("artifacts", type=Path)
    parser.add_argument("state", type=Path)
    args = parser.parse_args()
    print(json.dumps(drain(args.inbox, args.artifacts, args.state, run=run_registered)), flush=True)
