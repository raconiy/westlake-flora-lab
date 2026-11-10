# 私有产物触发队列

测量、渲染或验收生成了新文件后，由服务器运维核对内容与五个角色的输入。审核目录位于 `/var/lib/westlake-round-approvals`，没有 HTTP 入口。只把校验过的文件交给下列命令。输入和证据应属于 root，组和其他用户均无写权限。

```sh
sudo /usr/bin/python3 -E -s -B /usr/local/lib/westlake-approved-rounds/approve_product.py \
  --job capture-next-01 --suite gap \
  --evidence /path/to/reviewed-camera-measurements.json \
  --inputs /path/to/reviewed-five-role-inputs.json
```

`asset` 接受现有 `code-inputs.json` 的字段与五个标量函数合同。`gap` 接受 `gap-inputs.json` 格式，含两份已测函数、机位占比和下一步目标。输入不接受命令、自定义模型或网络地址。worker 逐条执行受限表达式的本地测试，保存模型请求 ID、返回 token、函数源码摘要与通过断言数。每个角色最多一次测试修正。

path 单元在成功投递后唤醒服务；15 分钟一次的本地补扫可恢复关机或上一轮执行期间遗漏的文件事件。空队列不发模型请求。以新产物 SHA-256 去重，另查工单号和五个代码任务 ID。工单、证据与失败交付全部保留。已提交请求后若进程中断，原工单标记失败并等待人工核对日志，不自动重发。

```sh
systemctl status westlake-approved-rounds.path westlake-approved-rounds.timer
sudo journalctl -u westlake-approved-rounds.service -n 15
sudo ls /var/lib/westlake-approved-rounds
```

`<证据SHA>.json` 是每轮状态。五角色通过后的实际回执在 `deliveries/<证据SHA>/verified.json`，单次模型结果同目录。格式或权限错误进入 `rejected/`。从这里判断函数交付；模型账号归属和同时调用仍需对照 GPT-Load 请求日志。服务没有站点发布权限。通过的函数可供后续审核采用，队列不会自行修改线上植物。
