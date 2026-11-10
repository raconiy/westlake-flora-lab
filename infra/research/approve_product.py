"""Private operator: publish stable evidence first, then atomically place an approved round on the local queue."""
import argparse
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

from approved_rounds import JOB, SUITES, require, strict_json, trusted, validate_inputs

BASE = Path("/var/lib/westlake-round-approvals")

def source(path, limit):
    fd = os.open(path, os.O_NOFOLLOW | os.O_RDONLY | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as data:
        st = os.fstat(data.fileno())
        require(trusted(st, 0) and stat.S_ISREG(st.st_mode) and 0 < st.st_size <= limit, "expected bounded, root-owned immutable input")
        result = data.read(limit+1)
        require(len(result) == st.st_size, "file changed during read")
        return result

def place(path, content, gid):
    if path.exists():
        require(path.read_bytes() == content, "existing approval or file conflicts")
        return
    fd, tmp = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            os.fchown(out.fileno(), 0, gid)
            os.fchmod(out.fileno(), 0o640)
            out.write(content)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp,path)
        fd_dir = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd_dir)
        finally:
            os.close(fd_dir)
    finally:
        Path(tmp).unlink(missing_ok=True)

def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--job", required=True)
    cli.add_argument("--suite", default="asset", choices=sorted(SUITES))
    cli.add_argument("--evidence", required=True, type=Path)
    cli.add_argument("--inputs", required=True, type=Path)
    args = cli.parse_args()
    require(os.geteuid() == 0, "only the server operator can approve work")
    require(JOB.fullmatch(args.job), "invalid job id")
    require(args.evidence.suffix.lower() in (".json",".png",".jpg",".jpeg",".csv",".glb",".ply",".zip"), "unsupported evidence extension")
    evidence = source(args.evidence, 256*1024*1024)
    inputs = source(args.inputs, 128*1024)
    validate_inputs(strict_json(inputs),args.suite)
    group = grp.getgrnam("westlake-approved").gr_gid
    doc = {"schema":1,"jobId":args.job,"suite":args.suite}
    with (BASE/"approval.lock").open("a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        for key,data,ext in (("evidence",evidence,args.evidence.suffix.lower()),("artifact",inputs,".json")):
            sha = hashlib.sha256(data).hexdigest()
            ref = {"name":sha+ext,"sha256":sha}
            doc[key] = ref
            place(BASE/"artifacts"/ref["name"], data, group)
        require(doc["evidence"]["sha256"] != doc["artifact"]["sha256"], "distinct evidence and inputs required")
        place(BASE/"inbox"/(args.job+".ready.json"), json.dumps(doc, sort_keys=True).encode(), group)
    print(json.dumps(doc, sort_keys=True))

if __name__ == "__main__":
    main()
