"""Approved local rounds use synthetic, offline five-role input. No inference is made."""
import concurrent.futures
import hashlib
import json
import os
import tempfile
import threading
import unittest
import uuid
from pathlib import Path

from approved_rounds import drain


ROLES = ("botany", "physics", "scene", "infra", "qa")


def fixture_id(tag):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "https://example.invalid/approved-round-test/" + tag))


def five_roles():
    return {
        role: {
            "codeTaskId": fixture_id(role + "/code"),
            "parents": [fixture_id(role + "/handoff"), fixture_id("joint-review")],
            "previousRoleDecision": "Compare fixed camera measurements for this role.",
            "jointReview": "Use the registered camera and retain the control when evidence is incomplete.",
        }
        for role in ROLES
    }


def put_json(path, data):
    content = (json.dumps(data, sort_keys=True) + "\n").encode()
    path.write_bytes(content)
    path.chmod(0o600)
    return hashlib.sha256(content).hexdigest()


class ApprovedRoundsTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.inbox, self.artifacts, self.state = (self.root / n for n in ("inbox", "artifacts", "state"))
        for directory in (self.inbox, self.artifacts, self.state):
            directory.mkdir(mode=0o700)
        self.inputs = five_roles()
        self.source = self.artifacts / "contracts.json"
        self.measurement = self.artifacts / "measurement.json"
        self.evidence_sha = put_json(self.measurement, {"sample": "camera-01", "occlusionError": 0.041})
        self.calls = []

    def approval(self, digest, tag="round-a", name=None, evidence=None, suite=None):
        job_id = fixture_id(tag)
        path = self.inbox / (job_id + ".ready.json")
        job = {"schema": 1, "jobId": job_id, "artifact": {
            "name": name or self.source.name, "sha256": digest,
        }, "evidence": evidence or {"name": self.measurement.name, "sha256": self.evidence_sha}}
        if suite is not None:
            job["suite"] = suite
        put_json(path, job)
        return path

    def run_ok(self, payload, ledger_dir):
        self.calls.append(payload)
        # The production writer creates per-role output in this ledger. Keep the
        # shape recognisable while never loading a model or executing its reply.
        directory = Path(ledger_dir)
        directory.mkdir(parents=True, exist_ok=True)
        for role in ROLES:
            put_json(directory / (role + "-1.json"), {
                "role": role, "taskId": payload[role]["codeTaskId"],
                "state": "tested", "testsPassed": 1,
            })

    def scan(self, runner=None):
        return drain(self.inbox, self.artifacts, self.state,
                     run=runner or self.run_ok, trusted_uid=os.getuid())

    def status(self):
        record = self.state / (self.evidence_sha + ".json")
        return json.loads(record.read_text())["status"]

    def test_empty_and_unapproved_input_do_no_work(self):
        self.scan()
        put_json(self.source, self.inputs)
        (self.inbox / "almost.ready.json.tmp").write_text("{}")
        self.scan()
        self.assertEqual(self.calls, [])

    def test_valid_round_is_running_before_callback_and_preserves_evidence(self):
        digest = put_json(self.source, self.inputs)
        work = self.approval(digest)
        original = {p: p.read_bytes() for p in (work, self.source, self.measurement)}

        def capture(payload, directory):
            self.assertEqual(self.status(), "running")
            approval = json.loads((Path(directory) / "approved.json").read_text())
            self.assertEqual(approval.get("suite", "asset"), "asset")
            self.run_ok(payload, directory)

        self.scan(capture)
        self.assertEqual(self.calls, [self.inputs])
        self.assertEqual(self.status(), "succeeded")
        self.assertEqual({p: p.read_bytes() for p in original}, original)

    def test_deduplicates_by_content_across_jobs_and_source_filenames(self):
        digest = put_json(self.source, self.inputs)
        self.approval(digest)
        self.scan()
        second = self.artifacts / "independently-named.json"
        self.assertEqual(put_json(second, self.inputs), digest)
        self.approval(digest, "round-b", second.name)
        self.scan()
        self.scan()
        self.assertEqual(self.calls, [self.inputs])
        self.assertEqual(self.status(), "succeeded")
        self.assertEqual(len(list(self.inbox.glob("*.ready.json"))), 2)
        self.assertTrue(second.is_file())

    def test_same_measurement_cannot_be_rebilled_with_new_task_ids(self):
        first = put_json(self.source, self.inputs)
        self.approval(first)
        self.scan()
        second_input = five_roles()
        for role in ROLES:
            second_input[role]["codeTaskId"] = fixture_id(role + "/replacement")
        other = self.artifacts / "new-ids.json"
        second = put_json(other, second_input)
        self.assertNotEqual(first, second)
        self.approval(second, "round-b", other.name)
        self.scan()
        self.assertEqual(self.calls, [self.inputs])
        self.assertEqual(self.status(), "succeeded")

    def test_competing_drains_dispatch_the_same_evidence_once(self):
        digest = put_json(self.source, self.inputs)
        self.approval(digest)
        self.approval(digest, "round-b")
        inside, other_scanning, release = (threading.Event() for _ in range(3))

        def run_first(payload, directory):
            inside.set()
            if not release.wait(4):
                raise RuntimeError("test did not release the runner")
            self.run_ok(payload, directory)

        def competing_scan():
            other_scanning.set()
            try:
                self.scan()
            except BlockingIOError:
                # An explicit busy lock and a no-op are both safe here.
                pass

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(self.scan, run_first)
            try:
                self.assertTrue(inside.wait(3))
                b = pool.submit(competing_scan)
                self.assertTrue(other_scanning.wait(3))
            finally:
                release.set()
            a.result(timeout=4)
            b.result(timeout=4)
        self.assertEqual(self.calls, [self.inputs])
        self.assertEqual(self.status(), "succeeded")

    def test_missing_or_wrong_content_cannot_dispatch(self):
        missing = self.approval("a" * 64, name="missing.json")
        digest = put_json(self.source, self.inputs)
        mismatch = self.approval("b" * 64, "other")
        self.scan()
        self.scan()
        self.assertEqual(self.calls, [])
        self.assertTrue(missing.is_file() and mismatch.is_file())
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), digest)

    def test_failed_callback_is_terminal_and_keeps_attempt_output(self):
        digest = put_json(self.source, self.inputs)
        work = self.approval(digest)
        partial = []

        def fail(payload, directory):
            self.calls.append(payload)
            directory = Path(directory)
            directory.mkdir(parents=True, exist_ok=True)
            file = directory / "attempt-note.json"
            put_json(file, {"finishedRoles": ["botany"]})
            partial.append(file)
            raise RuntimeError("offline test runner stopped after the first role")

        self.scan(fail)
        self.assertEqual(self.status(), "failed")
        self.assertTrue(partial[0].is_file())
        self.approval(digest, "duplicate-after-failure")
        self.scan()
        self.assertEqual(self.calls, [self.inputs])
        self.assertEqual(self.status(), "failed")
        self.assertTrue(work.is_file() and self.source.is_file())

    def test_artifact_symlink_is_rejected_even_when_target_matches_digest(self):
        outside = self.root / "outside.json"
        digest = put_json(outside, self.inputs)
        self.source.symlink_to(outside)
        self.approval(digest)
        self.scan()
        self.assertEqual(self.calls, [])
        self.assertTrue(self.source.is_symlink())
        self.assertEqual(hashlib.sha256(outside.read_bytes()).hexdigest(), digest)

    def test_approval_symlink_is_rejected_even_when_target_contains_valid_approval(self):
        digest = put_json(self.source, self.inputs)
        work = self.approval(digest)
        outside = self.root / "copied-approval.json"
        work.rename(outside)
        work.symlink_to(outside)
        self.scan()
        self.assertEqual(self.calls, [])
        self.assertTrue(work.is_symlink() and outside.is_file())

    def test_missing_or_mismatched_measurements_cannot_dispatch(self):
        digest = put_json(self.source, self.inputs)
        self.approval(digest, "missing-by-name", evidence={"name": "absent.json", "sha256": self.evidence_sha})
        self.approval(digest, "wrong-digest", evidence={"name": self.measurement.name, "sha256": "c"*64})
        work = self.approval(digest, "no-evidence-property")
        job = json.loads(work.read_text())
        del job["evidence"]
        put_json(work, job)
        self.scan()
        self.assertEqual(self.calls, [])

    def test_contract_cannot_double_as_its_own_measurement(self):
        digest = put_json(self.source, self.inputs)
        self.approval(digest, evidence={"name": self.source.name, "sha256": digest})
        self.scan()
        self.assertEqual(self.calls, [])

    def test_invalid_early_order_does_not_block_later_valid_order(self):
        bad = self.inbox / "000-bad.ready.json"
        put_json(bad, {"schema": 1, "jobId": "000-bad"})
        self.approval(put_json(self.source, self.inputs))
        result = self.scan()
        self.assertEqual((result["rejected"], result["succeeded"]), (1, 1))
        self.assertEqual(self.calls, [self.inputs])
        self.assertTrue(bad.exists())
        self.assertEqual(self.status(), "succeeded")

    def test_gap_suite_rejects_contract_inputs_from_asset_suite(self):
        self.approval(put_json(self.source, self.inputs), suite="gap")
        result = self.scan()
        self.assertEqual(result["rejected"], 1)
        self.assertEqual(self.calls, [])

    def test_unknown_suite_cannot_dispatch(self):
        digest = put_json(self.source, self.inputs)
        self.approval(digest, suite="other")
        self.scan()
        self.assertEqual(self.calls, [])

    def test_symlink_measurement_cannot_dispatch(self):
        digest = put_json(self.source, self.inputs)
        outside = self.root / "outside-measurement.json"
        self.measurement.rename(outside)
        self.measurement.symlink_to(outside)
        self.approval(digest)
        self.scan()
        self.assertEqual(self.calls, [])

    def test_group_writable_approval_cannot_dispatch(self):
        digest = put_json(self.source, self.inputs)
        work = self.approval(digest)
        work.chmod(0o620)
        self.scan()
        self.assertEqual(self.calls, [])

    def test_group_writable_source_cannot_dispatch(self):
        digest = put_json(self.source, self.inputs)
        self.source.chmod(0o620)
        self.approval(digest)
        self.scan()
        self.assertEqual(self.calls, [])

    def test_unknown_or_missing_role_contract_cannot_dispatch(self):
        self.inputs["unrecognized"] = self.inputs.pop("physics")
        digest = put_json(self.source, self.inputs)
        self.approval(digest)
        self.scan()
        self.scan()
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
