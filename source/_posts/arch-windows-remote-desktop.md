---
title: Arch Linux × Windows 跨设备远程桌面搭建全记录
date: 2026-08-05 21:50:00
updated: 2026-08-05 22:20:00
categories:
  - Linux
tags:
  - Arch Linux
  - Windows
  - 远程桌面
  - RDP
  - KDE
  - Wayland
  - Tailscale
---

# Arch Linux × Windows 跨设备远程桌面搭建全记录

> 记录一次完整的「Arch Linux (KDE Plasma 6.7.3, Wayland) ↔ Windows 11」双向远程桌面搭建过程：从方案选型、双向配置，到踩过的两个 KDE 上游 bug、若干 Windows 侧坑位，以及最终的连接调优。文中 IP 均已脱敏，实际使用请替换为你的真实地址。

## 一、背景与需求

- **Arch 本机**：KDE Plasma 6.7.3，Wayland 会话，主机名 `<ARCH_HOST>`，内网 IP `<ARCH_IP>`
- **Windows 机器**：Windows 11 25H2，`ProfessionalWorkstation` 版本，内网 IP `<WIN_IP>`
- **需求**：跨设备远程桌面，两个方向都要能连

架构选型：

| 方向 | 服务端 | 客户端 |
|---|---|---|
| Windows → Arch | krdp（Plasma Wayland 原生 RDP 服务器） | Thincast Remote Desktop Client |
| Arch → Windows | Windows 原生 RDP Host | KRDC（KDE RDP 客户端） |

选 krdp 的原因：它是 KDE Plasma 对 Wayland 的原生 RDP 实现，随桌面预装，无需额外服务。但先要接受它的三条限制：

- 仅支持 NLA 认证
- 无音频、无剪贴板共享
- 登录界面 / 锁屏状态下不可访问

## 二、方向一：Windows → Arch（krdp）

### 2.1 服务端配置

1. 打开 **System Settings → Remote Desktop**（远程桌面 KCM）
2. 在 Server 区域选择要授权登录的用户（这里选了 `eliopan`）
3. 勾选 **Start on login**（autostart），保证开机后自动监听
4. 点击 Apply

krdp 默认监听 `3389` 端口。证书为**自签名**，存放在 `~/.local/share/krdpserver/`（`krdp.crt` / `krdp.key`），客户端首次连接会提示不受信任，需手动确认。

### 2.2 Bug 一：mstsc 无法连接（KDE Bug 511557）

用 Windows 自带的 **mstsc** 连接，输入 IP 和凭据后，进度走到一半报 **PostConnect failed**，无法进入桌面。

这是上游已知的兼容性问题（[KDE Bug 511557](https://bugs.kde.org/show_bug.cgi?id=511557)），**至今未修复**，本质是 mstsc 与 krdp 在连接握手阶段不兼容，与证书、密码无关。

**解法**：放弃 mstsc，改用基于 FreeRDP 的 **Thincast Remote Desktop Client** 作为 Windows 端客户端。新建连接时填 `<ARCH_IP>:3389`，勾选允许保存凭据。

### 2.3 Bug 二：PAM 认证失败，黑窗闪退（KDE Bug 521776）

Thincast 上第一次连接会弹出自签名证书警告，点继续后**弹出一个黑框直接闪退**，Arch 端也没有任何授权确认框，仿佛连接根本没到达认证阶段。

**排查过程**：

1. 先在 Arch 本地验证密码本身没问题：
   ```
   su - <用户名>
   ```
   密码输入正确，确认不是密码错误。
2. 查看 krdp 服务日志，发现关键报错：
   ```
   journalctl --user -u app-org.kde.krdpserver.service
   # pam_unix(login:auth): authentication failure
   ```
3. 查看 systemd 服务文件，定位根因：
   ```
   cat /usr/lib/systemd/user/app-org.kde.krdpserver.service
   ```
   发现其中有 `NoNewPrivileges=true`。

**根因**是上游 [KDE Bug 521776](https://bugs.kde.org/show_bug.cgi?id=521776)：`NoNewPrivileges=true` 阻止了 `unix_chkpwd` 提权校验密码，导致 PAM 认证必然失败。上游在 6.7.2 已通过移除该设置修复，但 **Arch 的 6.7.3 打包仍残留该设置**，所以必须手动覆盖。

**解法**：写一个 systemd user 覆盖文件，强制把该设置关掉：

```bash
mkdir -p ~/.config/systemd/user/app-org.kde.krdpserver.service.d
```

```ini
# ~/.config/systemd/user/app-org.kde.krdpserver.service.d/override.conf
[Service]
NoNewPrivileges=false
```

应用覆盖并重启服务：

```bash
systemctl --user daemon-reload
systemctl --user restart app-org.kde.krdpserver.service
```

> ⚠️ 注意：`NoNewPrivileges=false` 属于「禁用安全缓解措施」，可能触发安全策略拦截（本机安装的 Claude Code 权限系统就拦过一次）。请理解这个操作的含义后再执行。

重启后重新用 Thincast 连接，授权框正常弹出，认证通过，桌面成功显示。

### 2.4 附带坑：pam_faillock 账户锁定

排查过程中反复认证失败，累计触发了 **pam_faillock** 账户锁定：

- 默认策略 `deny=3`、`unlock_time=600`（配置文件 `/etc/security/faillock.conf` 为空即用默认值）
- 由于 `/etc/pam.d/system-auth` 的 preauth 段包含了 faillock，**连 sudo 都一并被锁**——表现为 sudo 输入正确密码也报认证失败

处理方式：等约 600 秒自动解锁（可查看锁定剩余时间确认），解锁后清掉计数：

```bash
sudo faillock --reset
```

这是排查期最容易忽视的连带问题，特此记录。

## 三、方向二：Arch → Windows（Windows RDP Host）

### 3.1 Windows 端前置检查

RDP Host 需要 Windows **Pro 及以上**版本，先确认版本：

```
reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion" /v EditionID
:: 返回 ProfessionalWorkstation 即为 Pro 级，满足条件
```

其余关键检查项（管理员权限 cmd）：

```
:: 远程桌面未被策略禁用（0 表示允许）
reg query "HKLM\SYSTEM\CurrentControlSet\Control\Terminal Server" /v fDenyTSConnections

:: 远程桌面服务是否在运行
sc query TermService

:: 是否有监听 3389
netstat -an | findstr :3389

:: 会话与监听器状态
qwinsta
```

### 3.2 大坑：3389 无 LISTEN，重启才恢复

排查时遇到了一个非常迷惑的现象：

- `sc query TermService` 显示服务 **RUNNING**
- `fDenyTSConnections` 注册表为 `0x0`，配置正常
- 防火墙的远程桌面规则全部启用
- 但 `netstat -an | findstr :3389` **无任何返回**
- `qwinsta` 也**没有 RDP-Tcp 监听器**
- 尝试 `net stop TermService` 被拒绝，无法重启服务

结论：服务状态与配置长时间不同步，属于偶发问题。最终靠 **Settings 里先关闭再开启远程桌面，然后重启 Windows** 解决——重启后 `netstat` 正常出现 `LISTEN`，`qwinsta` 也能看到 RDP-Tcp。

> 教训：遇到「服务显示正常但端口无监听」时，先不要盲目去改注册表和防火墙，**先重启**再谈排查。

### 3.3 KRDC 连接配置

Windows 端就绪后，用 KRDC 连接 `<WIN_IP>:3389`。连接对话框中有几个关键填写项：

| 字段 | 填什么 |
|---|---|
| 服务器 / Host | `<WIN_IP>:3389` |
| **username** | **用户账号名**（不是电脑名称） |
| domain | 留空 |

**username 到底填什么**（这是最容易踩的）:

- 电脑名称（主机名，如 `DESKTOP-XXXX`）是**错的**——那用于服务器地址，不是凭据
- 填 Windows 的**登录账号名**；不确定时在 Windows 上执行：
  ```
  whoami
  :: 返回 DESKTOP-XXXX\用户名，取反斜杠后面那段
  ```
- 微软账户登录则填**完整邮箱**，domain 依旧留空
- 若本地账户名与其他东西冲突，可在用户名前加 `.\`（如 `.\用户名`）强制指本机账户

另外，连接过程中 KRDC 曾出现**卡死无响应**的情况，直接 `pkill -f krdc` 重开即可，也可用朴素参数（关闭音频、不共享媒体、避免全屏）降低客户端出问题的概率。

### 3.4 连接慢：Windows 反向 DNS 解析

连接成功后观察到一个新问题：`netstat` 显示 Windows 的 3389 与本机端口已建立 TCP 连接（网络层是通的），但 **KRDC 要等很久才进桌面**。

根因：**Windows 的 RDP 服务器收到连接后，会对客户端 IP 做反向 DNS 解析**。家用路由器没有给设备配置主机名解析，这次反向查询要一直等到超时（默认约 30 秒）才放弃，于是卡在进桌面之前。

**解法**：在 Windows 上以管理员身份编辑 hosts 文件，让反向解析秒查：

```
notepad C:\Windows\System32\drivers\etc\hosts
```

追加一行（把本机 Arch 的 IP 和主机名写进去）：

```
<ARCH_IP>    <ARCH_HOST>
```

保存后重新连接，立即进入桌面。

### 3.5 桌面布局与缩放不一致

远程桌面显示的快捷方式摆放和缩放大小与 Windows 原机不同——这是 **RDP 的固有行为**：远程会话是全新会话，其**分辨率由客户端决定**，不是物理显示器。分辨率一变，Windows 就重新排布图标、重新计算 DPI 缩放。

**解法**：让远程会话尽量贴近原机：

- 确认 Windows 物理显示器的**原生分辨率**（如 1920×1080）
- 在 KRDC 连接设置里把 **resolution** 设为与该分辨率一致 ← 关键
- **desktop scale factor** 保持 100%（不想放大就 100%）
- **device scale factor** 保持 100%——它管的是本机（Arch）高分屏的适配，与「Windows 布局是否一致」无关；只有本地是 2K/4K 且开了系统缩放时才需要动

### 3.6 RDP 会话隔离：物理桌面看不到

连接后会发现：**在 Windows 物理屏幕上刚打开的程序，远程会话里看不到**。

原因：RDP 是**独立会话**。你在物理屏幕（控制台会话）打开的东西，活在控制台会话里；RDP 连进去是另一个隔离的会话，两边桌面互不可见——你看到的是远程会话自己的桌面，不是物理屏幕的实时画面（且你连入时物理屏通常还会自动锁定）。

这是 RDP 的固有机制，不是故障。如果目标是「直接看/操作物理桌面上已经开着的东西」，两个方向：

- 连接**控制台会话**：`mstsc /v:<WIN_IP> /admin`，Linux 端可用 `xfreerdp` 加 `/admin` 参数
- 改用 **RustDesk** 这类「屏幕控制」工具，它才是真正接管物理桌面

## 四、踩坑清单速查

| # | 现象 | 根因 | 解法 |
|---|---|---|---|
| 1 | mstsc 报 PostConnect failed | KDE Bug 511557（未修复） | 改用 Thincast 客户端 |
| 2 | Thincast 黑窗闪退、无授权框 | KDE Bug 521776：`NoNewPrivileges=true` 破坏 PAM | systemd user override 置 false |
| 3 | 多次失败后 sudo 被锁 | pam_faillock（deny=3, unlock 600s） | 等解锁 + `sudo faillock --reset` |
| 4 | Windows 3389 无 LISTEN | TermService 状态与配置不同步 | 关闭重开远程桌面 + 重启 Windows |
| 5 | RDP 连接等 30s+ | Windows 反向 DNS 解析超时 | Windows hosts 加本机主机名 |
| 6 | 远程桌面布局/缩放不同 | RDP 新会话、分辨率由客户端决定 | resolution 设为物理显示器原生值 |
| 7 | 物理桌面的程序看不到 | RDP 会话隔离 | `/admin` 控制台会话，或 RustDesk |

## 五、最终形态

- **Windows → Arch**：Thincast 客户端 + krdp（含 `NoNewPrivileges` 覆盖），连接成功，授权框正常
- **Arch → Windows**：KRDC + Windows RDP Host（重启后正常监听 3389），连接成功，秒进桌面
- 两个方向均验证可用

## 六、跨网络方案：Tailscale

上面的方案只能在家用，出门就没法连了——因为 Windows 在路由器 NAT 后面，公网摸不到它的 3389。这里用 Tailscale 打通跨网络 RDP。

### 6.1 Tailscale 是什么

Tailscale 基于 WireGuard 建立加密隧道，给每台加入的设备分配一个虚拟内网 IP（`100.x.x.x`），所有设备之间通过这个虚拟 IP 直接通信，底层是 WireGuard 点对点加密，无需暴露任何公网端口。免费方案支持 100 台设备，对个人使用完全够用。

KRDC 用 Tailscale IP 连 RDP 的逻辑跟局域网完全一致——客户端根本不关心你给的是物理 IP 还是虚拟 IP，只要网络层通就行。

### 6.2 Arch 端安装与配置

安装：

```bash
sudo pacman -S tailscale
```

启动服务并设为开机自启：

```bash
sudo systemctl enable --now tailscaled
```

登录认证（会输出一个链接，浏览器打开，用 Google / GitHub / Microsoft 账号登录）：

```bash
tailscale up
```

认证完成后验证：

```bash
tailscale status
```

输出示例（IP 脱敏）：

```
100.x.y.z  archlinux  user@  linux   -
```

对应设备拿到的就是 `100.x.y.z` 这个虚拟 IP。

### 6.3 Windows 端安装与配置

1. 打开 https://tailscale.com/download/windows ，下载安装
2. 用**同一个账号**登录
3. 安装完成弹出 "open local settings / open admin console / close" 时，直接选 **close**

回到 Arch 端再次执行 `tailscale status`，确认两台设备都在网络内：

```
100.x.y.z  archlinux  user@  linux    -
100.a.b.c  pdd        user@  windows  -
```

### 6.4 用 KRDC 跨网络连接

现在 KRDC 的「服务器地址」不再填局域网 IP，改成填 Windows 的 Tailscale IP：

| 字段 | 值 |
|---|---|
| 服务器 / Host | `100.a.b.c:3389`（Windows 在 `tailscale status` 里显示的 IP） |
| username | 同局域网配置（Windows 登录账号名） |
| domain | 留空 |

其余配置完全不变。无论是在家、在公司、在星巴克，只要两台设备都有网，KRDC 就能连上。

### 6.5 原理简述

```
┌──────────┐          Tailscale 隧道          ┌──────────┐
│   KRDC   │ ──── 100.x.y.z ═══════ 100.a.b.c ──── │  Windows  │
│  (Arch)  │  TCP 3389 走加密的 WireGuard 链路    │  RDP Host │
└──────────┘                                    └──────────┘
```

KRDC 不需要任何特殊配置——它只知道要连 `100.a.b.c:3389` 这个 RDP 端点，至于数据包怎么过去的是 Tailscale 的事。底层的 WireGuard 隧道保证了跨公网也能端到端加密通信，同时不用在路由器上开放任何端口。

> 本文覆盖局域网（一至五节）与跨网络（第六节）两个场景。自托管 RustDesk 是另一种备选方案，需要额外维护一台中继服务器，在本文不展开。
