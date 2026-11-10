# 私有研究工单的依赖调度

运维审核工单及引用的测量文件后，在协调器所在服务器运行一次命令。命令在本次工单活动期间每两秒检查一次前置产物，按依赖自动交接；全部分支结束或超时退出。没有常驻服务。面向网站访客的建议继续走原有审批入口。

工具位于服务器 `/opt/westlake-swarm/tools/research-dag`。运行者需要读取该机私有协调器的 SQLite 和现有管理员凭据。命令仅向回环端口 8788 提交 `kind=research`；代码执行、GPU 渲染、发布和账号配额由各自系统管理。角色表示职责，实际使用的账号另查 GPT-Load 回执。

## 使用

1. 运维准备一个仅本人或 root 能写的工单和对应证据 JSON。生产模式要求两个文件的所有者为 root，检查文件内容的 SHA-256。每项任务列出 1 至 8 个实际存在的标量路径，调度器把取到的数值连同证据摘要放入该任务提示。
2. 每个节点填写唯一的 `id`、`role`、`title`、`prompt`、`facts` 和 `depends`。允许 botany、physics、scene、infra、qa 五种职责。一个计划最多 64 项。每项前置最多 6 个，跨职责交接使用已完成节点的真实任务 ID。缺失前置、循环、证据不完整会在提交前报错。
3. **仅回放**，使用示例的实际图像测量文件和模拟耗时。此命令只访问本地文件。

   ```sh
   cd /opt/westlake-swarm/tools/research-dag
   python3 research_dag.py replay example/approved-example.json --evidence-dir example --timings example/timings.json
   ```

4. **提交一份已审核的正式工单**。以下路径供运维替换。

   ```sh
   cd /opt/westlake-swarm/tools/research-dag
   python3 research_dag.py run /private/approved.json --evidence-dir /private/evidence --timeout 900
   ```

调度器看到前置结果后检查类型、状态、非空结构化记录、模型原文 SHA-256 及原文解析结果。不同职责可立即接力。同一职责同时最多一份工作，两个通过此工具启动的计划共用文件锁和对全协调器活动研究任务的计数，上限五份。其他入口独立提交的新任务仍按协调器自己的规则运行。单条工作失败仅阻断依赖分支，其他就绪任务继续。全数成功退出 0，含失败或被阻断的节点退出 2。

同一工单可使用相同命令恢复。生产账本在 `/var/lib/westlake-research-dag/<batch>.json`，保存工单内容摘要、真实任务 ID、每项状态及永久提交错误。稳定请求键由批次名和节点 ID 组成。程序从 SQLite 精确读取已保存的键并复用其状态。如果 HTTP 响应丢失，下轮先查库。重复运行已完成的工单不会重新投递。改动已登记的工单内容需要新的批次名。空工单 `{"schema":1,"batch":"nothing-pending","evidence":null,"nodes":[]}` 会直接退出。

## 本轮验证

示例使用校园冠层 C 候选的 GPU 渲染评估 JSON。回放中的快链 QA 在第 2 个模拟时点收到前两份结果，力学分支第 9 个时点完成，第 12 个时点收齐。上述时点只用于检验调度行为。生产机的额外只读验证用此前六条真实研究回执独立对照数据库，连续两次读取同键，核对真实任务 ID、职责与模型原文 SHA。该核验与上述示例回放都不创建新推理请求。

   ```sh
   cd /opt/westlake-swarm/tools/research-dag
   python3 check_dag_history.py example/stored-task-identities.json
   ```
