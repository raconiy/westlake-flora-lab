"""Build a self-contained, filterable HTML view of the reviewed public work log."""
import argparse
import hashlib
import html
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path


def esc(value):
    return html.escape(str(value), quote=True)


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def unpack(body):
    """Preserve multimodal order while keeping binary image data out of visible text."""
    data = body["input"]
    if isinstance(data, str):
        return "<pre>" + esc(data) + "</pre>"
    fragments = []
    for message in data:
        fragments.append("<h5>" + esc(message.get("role", "")) + "</h5>")
        for part in message["content"]:
            if part["type"] == "input_text":
                fragments.append("<pre>" + esc(part["text"]) + "</pre>")
            elif part["type"] == "input_image":
                url = part["image_url"]
                if not url.startswith(("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,")):
                    raise ValueError("Unexpected external image in public dispatch")
                fragments.append('<img loading="lazy" class="attachment" alt="本次请求发出的对照图" src="' + esc(url) + '">')
            else:
                raise ValueError("Unhandled prompt part " + part["type"])
    return "".join(fragments)


ROLES = {"seam":"材质接缝", "tone":"草坪明暗", "scale":"草叶尺度与视距", "contact":"接触与禁入边界", "qa":"独立验收"}
ROLES.update({
    "range_recovery": "分段断流回归", "range_integrity": "HTTP 字节范围完整性",
    "cancel_progress": "取消、重试与进度", "wind_observation": "草叶可见密度与风动",
    "receipt_attribution": "模型与网页回执归因",
})
CLOCK = timezone(timedelta(hours=8))


def stamp(ms):
    return datetime.fromtimestamp(ms / 1000, CLOCK).strftime("%H:%M:%S.%f")[:-3] if ms is not None else "未记录"


def request_card(row, root):
    body = row["requestBody"]
    wire = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
    if sha(wire) != row["bodySha256"] or sha(row["responseText"]) != row["outputSha256"]:
        raise ValueError("Dispatch integrity failure: " + row["taskId"])
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", row["taskId"]):
        raise ValueError("Invalid task filename")
    rel = "requests/" + row["taskId"] + ".json"
    (root / rel).write_bytes(wire.encode("utf-8"))
    valid = row["validation"]
    identity = row["credentialId"]
    return f'''<details class="request" data-role="{esc(row["role"])}" data-stage="{esc(row["stage"])}">
<summary><span class="code">{esc(row["stage"])} · #{esc(identity)}</span><strong>{esc(ROLES[row["role"]])}</strong><span>{esc(row["purpose"])}</span></summary>
<div class="body"><p><b>用途与去向</b>　{esc(row["disposition"])}　{esc(row.get("adoptedIn") or "")}</p>
<p class="meta">{esc(row["taskId"])}　·　{esc(row.get("gatewayModel"))} / {esc(row.get("gatewayEffort"))}　·　上海时间 {stamp(row["gatewayStartedAtMs"])} – {stamp(row["gatewayEndedAtMs"])}　·　输入 {esc(row["inputTokens"])} / 输出 {esc(row["outputTokens"])} token</p>
<p>前置交付　{esc(", ".join(row["parents"]) or "无")}　·　验证　{esc(valid.get("casesPassed",0))} 项　·　上游请求 {esc(row["requestId"])}</p>
<h4>发送的原始提示词</h4><a href="{esc(rel)}" download>下载这一次的原始请求体</a><h5>岗位指令</h5><pre>{esc(body["instructions"])}</pre><h5>任务输入与交接</h5>{unpack(body)}
<details><summary>查看模型返回原文</summary><pre>{esc(row["responseText"])}</pre></details>
<p class="meta">请求体 SHA-256　{esc(row["bodySha256"])}</p></div></details>'''


def concurrency_summary(rows):
    """Sweep actual upstream intervals, counting each credential once at any instant."""
    events = {}
    accounts = set()
    for row in rows:
        for attempt in row["gatewayAttempts"]:
            account = attempt["credentialId"]
            start, end = attempt["startedAtMs"], attempt["endedAtMs"]
            if end < start:
                raise ValueError("Inverted upstream interval")
            accounts.add(account)
            for at, delta in ((start, 1), (end, -1)):
                events.setdefault(at, []).append((account, delta))
    if not events:
        return "本批次暂无可核验的上游时间区间。"
    active = {}
    common_ms = 0
    first, last = min(events), max(events)
    previous = first
    for at, changes in sorted(events.items()):
        if len(active) == len(accounts):
            common_ms += at - previous
        for account, delta in changes:
            active[account] = active.get(account, 0) + delta
            if not active[account]:
                del active[account]
        previous = at
    window = last - first
    percent = 100 * common_ms / window if window else 0
    return (f"首末上游请求之间共 {window / 1000:,.3f} 秒。"
            f"{len(accounts)} 个账号共同推理 {common_ms / 1000:,.3f} 秒，占这段时间的 {percent:.1f}%。")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    root = parser.parse_args().directory
    data = json.loads((root / "records.json").read_text())
    leaders = json.loads((root / "lead-briefs.json").read_text())
    rows = data["records"]
    checks = []
    for entry in leaders:
        if sha(entry["prompt"]) != entry["sha256"]:
            raise ValueError("Lead brief integrity failure")
        checks.append(f'<details><summary><b>{esc(entry["id"])}　{esc(entry["title"])}</b><span>{esc(entry["purpose"])}</span></summary><pre>{esc(entry["prompt"])}</pre></details>')
    stages = "".join(f'<tr><th>{esc(x["stage"])}</th><td>{esc(x["verifiedRequests"])}</td><td>{esc(", ".join(map(str,x["credentialIds"])))}</td><td>{x["commonUpstreamOverlapMs"]/1000:.3f} 秒</td></tr>' for x in data["stages"])
    roles = "".join(f'<option value="{esc(k)}">{esc(v)}</option>' for k,v in ROLES.items() if any(r["role"] == k for r in rows))
    stage_options = "".join(f'<option>{esc(x["stage"])}</option>' for x in data["stages"])
    template = (Path(__file__).with_name("prompt-journal.template.html")).read_text()
    (root / "requests").mkdir(exist_ok=True)
    quota = data.get("quotaSnapshot", {})
    accounts = sorted(quota.get("accounts", []), key=lambda row: row["credentialId"])
    observation = "本批次未取得上游额度快照。"
    if accounts:
        samples = "、".join(f'#{a["credentialId"]} {a["remainingPct"]}%' for a in accounts)
        observation = f'上游七日剩余额度缓存于 {stamp(quota["readAtMs"])} 读取。各账号采样于 {stamp(min(a["sampledAtMs"] for a in accounts))} 至 {stamp(max(a["sampledAtMs"] for a in accounts))}。{samples}。'
    fields = {"concurrency":esc(concurrency_summary(rows)), "quota":esc(observation), "date":datetime.fromtimestamp(min(r["startedAtMs"] for r in rows)/1000,CLOCK).strftime("%Y-%m-%d"), "verified":sum(x["verifiedRequests"] for x in data["stages"]), "in":f'{sum(int(r["inputTokens"] or 0) for r in rows):,}', "out":f'{sum(int(r["outputTokens"] or 0) for r in rows):,}', "stages":stages, "roles":roles, "stageOptions":stage_options, "leaders":"".join(checks), "cards":"".join(request_card(r, root) for r in rows)}
    for key, value in fields.items():
        template = template.replace("{{" + key + "}}", str(value))
    (root / "index.html").write_text(template)


if __name__ == "__main__":
    main()
