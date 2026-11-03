# dsh-plugin-token-audit

给 **DeepSeek Harness** 用的 Token 用量审计插件：一张悬浮小卡片，随时知道今天烧了多少、钱还剩多少、哪几个任务最费。

```
<p align="center">
  <img src="https://github.com/user-attachments/assets/7ca3ff6b-ba83-4bbd-b993-88b94765a1b5" alt="Token 审计悬浮卡片（展开状态）" width="266" />
</p>

```

收起后是一条 26px 高的胶囊：

```
◉ TOK 11.78M ▬▬▬▭▭
```

---

## 特性

- **日 / 月 / 年** 三段分布，柱状图带 tooltip
- **当日消耗 Top5 任务**：token、时长、调用次数、工具调用数
- **账户余额**：充值 + 赠金分开展示，自动合并成可用总额
- **剩余 token 估算**：按「余额 ÷ 单价」换算，`~` 表示估算值；也可手动指定预算
- **SAO 风格 UI**：青色细线、四角括号、分段式血条、等宽数字
- **可拖动**，位置和页签记忆在 localStorage
- **只读**：不写任何文件，不碰你的凭据

## 数据从哪来

| 指标 | 来源 |
|---|---|
| 每次调用的 token | 会话日志 `~/.dsh/sessions/**/session.v4.jsonl.zstd` 里 `assistant/message.data.usage` |
| 任务划分 | 一轮对话 = 一个任务，按 `turn/start` ~ `turn/end` 圈定 |
| 任务时长 | `turn/end.time - turn/start.time` |
| 任务名 | 该轮第一条 `user/message` 的正文 |
| 余额 | DSH 账号服务 `deepseekAccount.getBalance()` |

不需要任何 API Key，也不读 `.credentials.yaml`。

---

## 安装

### 前提

- DeepSeek Harness 桌面端 `0.2.x`
- Node.js ≥ 22

### 一键安装

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

macOS / Linux：

```bash
bash install.sh
```

装完**完全退出 DSH（含托盘图标）再重新打开**。

### 手动安装（三行）

1. 在 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 里加：

   ```json
   "dsh-plugin-token-audit": "file:/绝对路径/to/dsh-plugin-token-audit"
   ```

2. 在同一个文件的 `dsh.profile.bundles` 数组里追加 `"dsh-plugin-token-audit"`

3. 在 `~/.dsh/profiles/desktop` 下执行 `pnpm install`

### 卸载

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
```

---

## 使用

| 操作 | 效果 |
|---|---|
| 单击胶囊 | 展开面板 |
| 拖动标题栏 / 胶囊 | 移动位置 |
| 点 `×` | 收起为胶囊（唯一收起方式） |
| 点 `LEFT xx` | 手动指定 token 预算 |
| 点 `BAL ¥x @2` | 设置单价（¥ / 百万 token） |
| 点 `[DAY] [MON] [YEAR]` | 切换时间维度 |

### 配置项

`cordis.patch.yml`：

```yaml
- insert:
    - id: token-audit
      name: 'dsh-plugin-token-audit'
      config:
        port: 48921         # 本地只读 HTTP 端口
        budget: 20000000    # 默认日预算（token），0 表示不显示
```

改完要重启 DSH。

---

## 关于「剩余 token」

DSH 本身没有「剩余 token」的概念——平台给的是**余额（钱）**，不是 token 额度。所以这里做了换算：

```
剩余 token ≈ 余额 ÷ 单价 × 1,000,000
```

- 单价默认 `2`（¥ / 百万 token），可以在面板上改
- 实际计费分「缓存未命中输入 / 缓存命中输入 / 输出」三档，单一单价只是一个近似
- 数字后面的 `~` 就是提醒你「这是估的」
- 手动输入的预算优先级更高，显示为 `*`

## 已知限制

1. **只统计本机当前用户**的会话，不含网页版、不含其他设备
2. **不是账单**：token 数取自 provider 返回的 usage，比启发式估算准，但计费口径仍以平台为准
3. **余额查询依赖 DSH 内部服务**，DSH 大版本升级后可能需要适配
4. **Windows 优先**：`install.ps1` 是一等公民，`install.sh` 是等价移植，未在 macOS 上实测

---

## 为什么不用 `cordis.patch.yml` 安装

因为 **DSH 会在你改任何设置时重写 profile 的 `cordis.patch.yml`**，手写进去的条目会被抹掉。

正确的做法是做成 bundle（`dsh.bundle.patch` 指向包内自带的 `cordis.patch.yml`），由 profile 的 `bundles` 列表引入。这个仓库就是这么做的。

另一个坑：非 `insert` 形式的 patch 条目如果 `id` 不存在，会被**静默跳过**，不报错也不生效。

## 目录结构

```
lib/core.js        会话日志解析与聚合（纯函数，可单独测试）
lib/index.js       主机端：本地 HTTP 服务 + 余额查询
lib/client.js      浏览器端：悬浮卡片 UI
cordis.patch.yml   bundle 自带 patch
install.ps1        一键安装（Windows）
install.sh         一键安装（macOS / Linux）
```

调试用：主机端启动会写一行信标到 `%TEMP%/dsh-token-audit-boot.log`。

## License

MIT

---

<sub>English: A token-usage audit plugin for DeepSeek Harness. Reads local session logs to show daily/monthly/yearly token consumption and today's top-5 heaviest tasks, and queries the built-in account service for wallet balance. Ships as a SAO-styled floating capsule. Read-only, no credentials touched.</sub>
