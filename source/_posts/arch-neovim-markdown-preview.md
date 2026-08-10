---
title: Arch Linux 上 Neovim + markdown-preview 实时预览搭建与踩坑全记录
date: 2026-08-10 01:20:00
updated: 2026-08-10 01:20:00
categories:
  - Linux
tags:
  - Arch Linux
  - Neovim
  - Vim
  - Markdown
  - markdown-preview.nvim
  - Node.js
  - 排障
---

# Arch Linux 上 Neovim + markdown-preview 实时预览搭建与踩坑全记录

> 记录一次在 Arch Linux 上为 Neovim 搭建 Markdown 实时预览（markdown-preview.nvim）的完整过程：与本地 Vim 的共存检查、配置落盘，以及四个连环踩坑——从 vim-plug 找不到、Ctrl+S 被终端吞掉、F5 被桌面抢走，到最终那个最隐蔽的「按键静默失败」：预览服务端缺 node_modules。重点沉淀了 headless 模式下的诊断方法论。

## 背景与目标

本机原本只装了一套 **Vim 9.2 + gvim**，用 vim-plug 管理插件（`~/.vim/plugged`），装过 coc.nvim，`~/.vimrc` 里配了中文编码和 Coc 补全快捷键。目标是：

- 装一个 Neovim，配好 markdown-preview.nvim，实现编辑 `.md` 时的浏览器实时预览；
- 全程不得影响现有 Vim 的配置与 coc.nvim。

环境：Arch Linux、bash、`TERM=xterm-256color`、Node.js v26.5.1。

## 方案选型与共存检查

### 为什么选 Neovim + markdown-preview.nvim

Markdown 编辑器的方案很多（Typora / Obsidian / Mark Text 等），但既然机器上已有 Vim 工作流，最贴合的就是 **Neovim + markdown-preview.nvim**：同一套 vim-plug、同一个插件目录，两个编辑器共享。

### 与本地 Vim 的冲突检查

| 层面 | 是否冲突 | 说明 |
|------|---------|------|
| 二进制/包 | 不冲突 | `neovim` 与 `vim`/`gvim` 是 Arch 官方源独立包，互不覆盖 |
| 配置 | 有一个坑 | Neovim 走 XDG 路径（`~/.config/nvim/`），不回退读 `~/.vimrc`；但前提是必须建独立 `init.vim`，否则 Neovim 会回退去 source `~/.vimrc`（带着 coc 配置），不干净 |
| 插件 | 不冲突 | vim-plug 两个编辑器通用，可以共享同一个 `~/.vim/plugged` 插件目录 |
| 依赖 | 已满足 | coc.nvim 和 markdown-preview 都需要 Node.js |

<!-- more -->

## 搭建步骤

### 1. 安装 Neovim

```bash
sudo pacman -S --needed neovim
```

### 2. 建独立配置 init.vim

```bash
mkdir -p ~/.config/nvim
```

`~/.config/nvim/init.vim`：

```vim
set encoding=utf-8
set fileencodings=utf-8,usc-bom,gb18030,gbk,gb2312

" 复用 ~/.vim/plugged，与 Vim 共享插件目录
call plug#begin('~/.vim/plugged')

Plug 'iamcco/markdown-preview.nvim', { 'do': 'cd app && npm install', 'for': ['markdown'] }

call plug#end()

nmap <C-p> <Plug>MarkdownPreviewToggle   " Ctrl+p 打开/刷新/关闭预览
nmap <Leader>mp <Plug>MarkdownPreviewToggle  " \mp 切换预览
nmap <Leader>ms <Plug>MarkdownPreviewStop    " \ms 停止预览
```

两点说明：

- **`'for': ['markdown']`** 让插件只对 `.md` 文件懒加载，不拖慢启动；
- **`do` 钩子用 `cd app && npm install`** 而不是官方默认的 `mkdp#util#install()`——这是踩过坑之后的加固（见坑四）。

### 3. 安装插件

```bash
nvim +'PlugInstall --sync' +qa
```

## 踩坑记录

### 坑一：`E117: Unknown function: plug#begin`

**现象**：打开 nvim 报一堆 `plug#begin` / `plug#end` 未知。

**根因**：vim-plug 的 `plug.vim` 在 `~/.vim/autoload/` 下，而 Neovim 的运行时路径不包含 `~/.vim`（XDG 化），自然找不到 `plug#begin` 函数。

**解决**：把 plug.vim 复制到 Neovim 自己的 autoload 目录：

```bash
mkdir -p ~/.config/nvim/autoload
cp ~/.vim/autoload/plug.vim ~/.config/nvim/autoload/
```

（另一个偷懒方案是 `set runtimepath+=~/.vim`，但会把 vim 的目录耦合进 nvim，不推荐。）

### 坑二：`Ctrl+S` 没反应

**现象**：键位明明绑定了（`:verbose nmap <C-s>` 能查到），但按了毫无反应。

**根因**：Linux 终端把 `Ctrl+S` 当作流控命令 **XOFF**（暂停屏幕输出），根本不会传给 nvim。这是 Vim 用户的老熟人坑。

**解决**：关掉终端流控，或换个键：

```bash
# 会话内生效
stty -ixon
# 永久生效（写入 ~/.bashrc / ~/.zshrc）
echo "stty -ixon" >> ~/.bashrc
```

更稳妥的做法是干脆换键（见下文 Ctrl+P）。

### 坑三：`F5` 被桌面抢走

**现象**：改成 F5 后依旧没反应。

**根因**：笔记本的 `F5` 是屏幕亮度键，被桌面/硬件层截走，同样到不了 nvim。

**结论**：选键要避开三类：终端流控键（Ctrl+S/Q）、桌面媒体/功能键（F5~F8）、Vim 自身语义重要的键（Ctrl+O 跳转等）。`Ctrl+P` 在终端是普通控制字符、桌面不抢、Vim 默认无冲突，是最省心的选择。

### 坑四（最隐蔽）：预览按键静默失败 —— 缺 node_modules

**现象**：插件装好了、键位绑好了、插件也加载了，但按任何预览键都毫无反应、不弹浏览器、状态栏也不报错。

**根因**：预览服务端是插件 `app/` 目录下的一个 Node.js 服务。`mkdp#util#install()` 拉下来的 `app/` 只有编译产物，**`node_modules` 依赖缺失**。服务起不来，而插件对启动失败是「静默」的——这就是为什么前面一切检查看起来都正常。

**定位过程**：用 headless 模式直接触发预览函数，错误立刻现形：

```bash
nvim --headless test.md -c 'call mkdp#util#toggle_preview()' -c 'sleep 3' -c 'messages' -c 'qall'
```

输出暴露了真正的异常：

```
Error: Cannot find module 'tslib'
Require stack: ~/.vim/plugged/markdown-preview.nvim/app/lib/app/index.js
```

**解决**：进插件 app 目录补装依赖：

```bash
cd ~/.vim/plugged/markdown-preview.nvim/app && npm install
```

验证：保持 nvim 存活时能看到 node 服务进程、并确认其监听端口（本例为 `127.0.0.1:8175`，插件默认随机端口）：

```bash
ss -tlnp | grep node
```

## 诊断方法论（重点）

这次最值得沉淀的不是某个命令，而是**「按键无响应」这类静默故障的分层排查法**：

1. **确认插件有没有装上 / 有没有加载**
   ```bash
   nvim --headless test.md -c 'scriptnames' -c 'qall' | grep -i markdown
   ```

2. **确认键位有没有绑定**
   ```bash
   nvim --headless test.md -c 'verbose nmap <C-p>' -c 'qall'
   ```

3. **确认配置有没有干净加载**
   ```bash
   nvim --headless -c 'qall'   # 无输出、exit 0 即干净
   ```

4. **直接触发核心函数，把静默错误炸出来**
   ```bash
   nvim --headless test.md -c 'call mkdp#util#toggle_preview()' -c 'sleep 3' -c 'messages' -c 'qall'
   ```
   这一步把「没反应」从玄学变成可复现的错误信息，是本次破案的关键。

5. **确认服务真的起来了**（不是端口探测，而是看进程 + 端口）
   ```bash
   ps aux | grep index.js
   ss -tlnp | grep node
   ```
   注意：预览服务随 nvim 会话退出而退出，所以要在 nvim 存活时查。

## 最终快捷键

| 按键 | 功能 |
|------|------|
| `Ctrl+p` | 打开 / 刷新 / 关闭预览（首选） |
| `\mp` | 切换预览 |
| `\ms` / `Alt+s` | 停止预览 |

## 维护备忘

- **`PlugUpdate` 或重装后预览又失效**，大概率是 node_modules 又丢了，重跑 `npm install` 即可：
  ```bash
  cd ~/.vim/plugged/markdown-preview.nvim/app && npm install
  ```
- 因此配置里的 `do` 钩子建议固定为 `'cd app && npm install'`，它幂等且总能保证依赖齐全。
- Vim 也想用这个预览？插件装在共享目录 `~/.vim/plugged`，只需往 `~/.vimrc` 加一行 `Plug 'iamcco/markdown-preview.nvim', { 'do': 'cd app && npm install' }` 然后 `:PlugInstall`，两个编辑器通用。
