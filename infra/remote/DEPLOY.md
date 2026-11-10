# 更新公网助手 relay

适用于云谷服务器现有布局。HTTP 服务读取 `/opt/relay-secrets.env`，由 `/usr/bin/node /opt/remote-reply.mjs` 仅监听 127.0.0.1:80。HTTPS 服务读取 `/opt/relay-tls/{key,fullchain}.pem`，监听 443 并转发至 `127.0.0.1:80`。更新 HTTP 服务即会影响两个入口。以下命令在服务器本地执行。

1. 将新 `remote-reply.mjs` 和 `community-consumer.mjs` 放入一个仅包含发布文件的临时目录。进入该目录后运行以下检查，备份现有代码。状态密钥通过 systemd 的 `LoadCredential` 交给进程，候选与正式进程使用相同的读取方式。

   ```sh
   node --check remote-reply.mjs
   node --check community-consumer.mjs
   cp -p /opt/remote-reply.mjs /opt/remote-reply.previous.mjs
   install -m 0644 remote-reply.mjs /opt/remote-reply.candidate.mjs
   install -d -m 0755 /etc/systemd/system/westlake-relay.service.d
   cat >/etc/systemd/system/westlake-relay.service.d/community-status.conf <<'UNIT'
   [Service]
   LoadCredential=gateway-status-token:/var/lib/gpt-load/auth.key
   Environment=RELAY_HOST=127.0.0.1
   UNIT
   systemctl daemon-reload
   systemd-run --unit=westlake-reply-check --collect \
     --property=EnvironmentFile=/opt/relay-secrets.env \
     --property=LoadCredential=gateway-status-token:/var/lib/gpt-load/auth.key \
     /usr/bin/env RELAY_HOST=127.0.0.1 RELAY_PORT=18789 /usr/bin/node /opt/remote-reply.candidate.mjs
   curl --fail --silent http://127.0.0.1:18789/health
   ```

   期望 `capacitySource` 为 `gpt-load-management`，`availableAccounts` 为当前可用凭据数。若返回 503，核查 systemd 是否成功加载 `gateway-status-token`、GPT‑Load 管理接口能否正常响应。无 systemd 的隔离测试可显式设置 `GPT_LOAD_STATUS_KEY_FILE`。
2. 在候选端口发送一个 chat 和一个 triage 请求，只检验状态、是否有回复和提案数。使用服务环境中的 token，不把 token 放在命令参数或输出中。这一步会产生两次真实模型请求。

   ```sh
   systemd-run --pipe --wait --collect --quiet --property=EnvironmentFile=/opt/relay-secrets.env /usr/bin/node --input-type=module - <<'JS'
   for (const [kind,input] of [['chat','简述银杏短枝上的叶序。'],['triage','建议在银杏从夏季切换到冬季时验证多年短枝仍被保留。']]) {
     const r=await fetch('http://127.0.0.1:18789/complete',{method:'POST',headers:{authorization:'Bearer '+process.env.COMMUNITY_RELAY_TOKEN,'content-type':'application/json'},body:JSON.stringify({kind,input}),signal:AbortSignal.timeout(160000)});
     const b=await r.json();
     console.log(kind,r.status,'有答复',Boolean(b.reply),'提案数',b.suggestions?.length,'错误',b.error);
     if(!r.ok||!b.reply||!Array.isArray(b.suggestions)||(kind==='triage'&&!b.suggestions.length))process.exit(1);
   }
   JS
   ```
3. 切换 HTTP 程序并核验现有 HTTPS 地址。启动器会沿用 `RELAY_PORT`、`RELAY_HOST`、`GPT_LOAD_URL` 及两个已有进程内 token。HTTPS 前置代理和 ACME 证书续签无需修改。

   ```sh
   mv /opt/remote-reply.candidate.mjs /opt/remote-reply.mjs
   systemctl restart westlake-relay.service
   ss -ltn 'sport = :80'
   curl --fail --silent http://127.0.0.1/health
   curl --fail --silent https://113-240-94-210.sslip.io/health
   systemctl stop westlake-reply-check
   ```
4. 将 `remote-reply.mjs` 放到活动消费者程序所在目录，再更新同目录的 `community-consumer.mjs`。消费者复用相邻模块中的凭据统计函数。新装时按 unit 中的路径安装两份 JS，D1 消费凭据由 `LoadCredential` 引入。当前服务器的本机 HTTP 端口是 80，unit 的 `LOCAL_RELAY_URL` 应为 `http://127.0.0.1:80`。消费者空闲时重启。公网 `/api/community/health` 应报告新鲜消费者心跳，随后用网页问一个问题并提交一条建议，验证答复和待审提案。执行器数量由消费者心跳报告。
5. HTTP 回滚可用 `install -m 0644 /opt/remote-reply.previous.mjs /opt/remote-reply.rollback.mjs && mv /opt/remote-reply.rollback.mjs /opt/remote-reply.mjs && systemctl restart westlake-relay`，然后再次核对两个健康入口。若消费者也已更新，使用同次发布前保留的消费者版本恢复，并保留其私有 outbox。

独立测试可在仓库根目录运行 `node --test infra/remote/*.test.mjs infra/community/test/*.test.mjs`。测试使用隔离的回环 HTTP 服务及受控上游响应。
