# 五职责数据队列

协调器保存任务、租约和交接。五个身份分别做植物形态、根土力学、场景、基础设施和验收。每个身份只可领取自己职责的 `research` 单。提交者使用私有管理入口，成员仍可通过公开页面问助手或提建议。公开建议进入这条队列前需项目负责人审核。

每项工作的交付物是 JSON。每条记录包括对象、属性、取值、单位、来源类别、依据和验收条件。执行器通过 Unix socket 请求固定模型，随后校验结果并保存原文 SHA-256、模型响应 ID、用量、交接任务 ID、参考资料摘要和时间。模型没有文件、代码执行、发布或接触密钥的工具。服务返回 `completed` 表示数据格式通过并已入库。生物学正确性、实现测试和公开发布另行核验。

## 服务器上的操作

授权运维人员可通过 SSH 登录服务器后查看：

```sh
systemctl status westlake-research-coordinator westlake-research-infer
systemctl list-units 'westlake-research@*'
sudo python3 /opt/westlake-swarm/verify-research.py --summary
```

协调器监听服务器自己的 `127.0.0.1:8788`。管理员向 `POST /api/suggestions` 提交 `role`、`kind: "research"`、`title`、`prompt` 和稳定的 `requestKey`。相同内容重试时保留原键。需要跨工种协作时，在 `handoffFrom` 填已完成任务 ID。执行器在领取时收到前序任务的摘要和记录摘录，同时保留来源 ID。完成后读取 `GET /api/tasks`。禁止在提交内容中附带凭证。匿名账号编号由管理员在 GPT-Load 上游日志核对。

## 服务边界

协调器、推理代理及每一职责各有独立非 root 用户。安装时在已审查的公开仓库版本运行 `node infra/research/build-public-context.mjs /tmp/approved.json`，再由运维安装为固定上下文。系统服务使用 `LoadCredential`；管理员令牌仅进入协调器，每个执行器仅得到自身角色令牌，推理代理仅得到生产推理凭据。只有运维可以直接读取原始 GPT-Load 库。执行器的私有写目录仅保存幂等回执。中途退出后，已有回执会复用，结果未知的推理转为待人工核查的失败，避免重复消费。

默认源码和已审核的公开上下文部署在 `/opt/westlake-swarm/research`。根目录属 root，运行服务无写权限。固定上下文 `context/approved.json` 按五个职责提供已公开源码或物种依据，外部提交者不可指定文件路径。systemd 单元在 `systemd/`，Node 22.13 或更新版本可运行：

```sh
node --test infra/local/test/infra.test.mjs infra/research/research.test.mjs
```

### 查看重建派工原文

云谷草坪页面的“查看草坪实拍对照、五岗提示词与调用记录”可按岗位和轮次筛选。展开单次任务能看到实际发送的文本、对照图、上游请求编号及采用结果。主控任务书单列。原始 JSON 含请求体的 SHA-256，可以复核。公开批次放在 `public/capture17/lawn-r4/`。更新公开回执后运行 `python3 infra/research/build_prompt_journal.py public/capture17/lawn-r4` 重新生成可离线打开的页面。

研究推理服务在调用网关前将请求正文原样写入服务器私有目录 `/var/lib/westlake-research-prompts/`，结束时以同一 attemptId 写回执；尚缺回执的尝试保留供排查。请求记录不含 HTTP 授权头。公开记录由主控从项目批次选取，成员私聊保留在服务端。
