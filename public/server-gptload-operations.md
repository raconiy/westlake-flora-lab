# 服务器与 GPT‑Load Agent Swarm 操作手册

服务器：`113.240.94.210`，Ubuntu，8×RTX 5090。GPT‑Load 运行在服务器回环地址 `127.0.0.1:3001`，植物预览服务运行在 `4173`。

## 连接服务器

```bash
ssh root@113.240.94.210
```

不要把 root 密码、OAuth JSON、AccessKey 或 2FA 写进网页、Git 仓库或聊天记录。

## 查看 GPT‑Load

在本机建立管理隧道：

```bash
ssh -N \
  -L 13001:127.0.0.1:3001 \
  -L 1455:127.0.0.1:1455 \
  root@113.240.94.210
```

健康检查：

```bash
curl http://127.0.0.1:13001/health
```

GPT‑Load 管理页面：`http://127.0.0.1:13001/`

账号级核验在“组 → 凭据”里查看。必须核对 `credential_id`、账号掩码、状态、成功请求和 output token；worker 数量不等于账号数量。

## Agent Swarm 的真实调用方式

公网 Site 负责收集成员建议和匿名会话；Site Worker 通过 HTTPS relay 调用服务器的 GPT‑Load；GPT‑Load 在五个 Codex 订阅账号之间调度 `gpt-6.1-sol / high`；返回结果后，Site 将建议标记为已回复或排队。

直接调用只允许在服务器或受保护的本机隧道中进行：

```bash
curl -X POST http://127.0.0.1:13001/v1/responses \
  -H "Authorization: Bearer $GPT_LOAD_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-6.1-sol","input":"审计银杏叶片持久性，给出测试标准","reasoning":{"effort":"high"}}'
```

推荐把五个账号分成五个审计面：桂花、银杏、鸡爪槭、小花小草、物理与土壤。每轮保存实际请求日志，由主控合并后再改代码；不要为了刷额度发送无意义请求。

### 当前部署边界

现在的公网页面已经接入远程 relay，relay 再把请求交给 GPT‑Load 账号池。账号池里有 5 个可用凭据，`availableAccounts: 5` 表示 5 个账号均可被调度；它不表示每次点击都会同时消耗 5 个账号。默认请求由 GPT‑Load 选择一个可用凭据完成，只有显式的 fan‑out 审计任务才会并行拆成多个请求。这样可以把“账号数量”和“worker 数量”分开核对，也避免为了刷用量发送无意义请求。

主控执行一次审计时应保存：任务 ID、使用的 `credential_id`（只保留掩码）、HTTP 状态、输入/输出 token、失败原因和合并后的代码提交。没有这些字段，就只能算计划派工，不能算真实账号协作。

## 植物代码与测试

代码目录：`/opt/westlake-flora-pages`。构建与基础测试：

```bash
cd /opt/westlake-flora-pages
npm run build
npm test
```

`npm test` 是快速回归；完整 `lib/*.test.mjs` 会包含较慢的几何快照和密度审计。任何失败都要保留日志，不能把未通过的候选直接发布。

## 5090 使用

检查 GPU：

```bash
nvidia-smi
```

CUDA smoke test 只能证明驱动和卡可用；它不等于植物渲染已经 GPU 加速。要让 GPU 真正参与 real2sim，需要部署可复现的 CUDA 几何采样、离线渲染或批量拟合服务，并把结果作为版本化资产接入网页。

## 页面故障排查

- `/api/community/health` 返回 404：Site 没有部署 Worker 入口，检查 `worker/index.ts` 和最新 Site 版本。
- `/account-usage.json` 返回 404：文件必须位于 `public/account-usage.json`。
- 页面显示旧状态：执行硬刷新（Chrome：`Cmd/Ctrl + Shift + R`），再检查 Site Worker 日志。
- 页面显示“社区服务未就绪”：先检查 Site Worker 日志，再检查 relay HTTPS health；不要把它误判为五个 GPT 账号失效。

当前公网入口：<https://westlake-flora-lab-yungu.sableborage.chatgpt.site>
