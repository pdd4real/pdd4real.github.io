---
title: Fish Shell 下编译 SDL2 的 undefined reference 问题
date: 2026-08-05 23:08:00
updated: 2026-08-05 23:08:00
description: 从 SDL2 链接报错出发，梳理 pkg-config、GCC 参数和 Fish Shell 命令替换的关系。
categories:
  - Linux
tags:
  - SDL2
  - Fish Shell
  - GCC
  - pkg-config
---

# Fish Shell 下编译 SDL2 的 undefined reference 问题

C/C++ 编译过程分为编译（Compile）和链接（Link）两个独立阶段。本文从一次 SDL2 链接报错出发，梳理 `pkg-config`、GCC 参数以及 Fish Shell 命令替换之间的关系。

<!-- more -->

## 1. `pkg-config` 到底是干什么用的？

在 Linux 下使用第三方库（如 SDL2）时，库的头文件（`.h`）和动态链接库文件（`.so`）通常散落在系统的各个角落。让程序员手动去查这些路径非常折磨人。

`pkg-config` 就是一个**统一的包信息查询工具**。当你安装库时，库会向系统注册一个 `.pc` 描述文件。`pkg-config` 通过读取这个文件，自动帮你生成给 GCC 用的参数。

### 参数解析：`pkg-config --cflags --libs sdl2`

- **`sdl2`**：告诉工具你要查询的是哪个库（寻找 `sdl2.pc` 文件）。
- **`--cflags` (Compiler Flags)**：服务于**编译阶段**。
  - 它返回类似 `-I/usr/include/SDL2 -D_GNU_SOURCE=1 -D_REENTRANT` 的结果。
  - **作用**：告诉编译器（gcc）去哪里找 `SDL.h`，以及需要定义哪些预处理宏。如果没有这个参数，gcc 会报 `fatal error: SDL2/SDL.h: No such file or directory`。
- **`--libs` (Linker Flags)**：服务于**链接阶段**。
  - 它返回类似 `-lSDL2` 的结果。
  - **作用**：告诉链接器（ld），在把你的 `main.o` 打包成可执行文件时，把系统里的 `libSDL2.so` 绑进去。如果没有这个参数，就会报你最初遇到的 `undefined reference to 'SDL_CreateWindow'`。

## 2. Fish Shell 的命令替换解析机制

命令替换，指的是执行括号里的命令，并把它的输出结果交给外层命令（比如把 `pkg-config` 的输出交给 `gcc`）。

问题的根源在于：**Fish 和传统的 Bash/Zsh 在处理空格时的哲学完全相反。**

- **Bash/Zsh 的做法（按空格拆分）**：

  默认情况下，Bash 会根据**空格、制表符和换行符**来切分命令输出。

  所以 `$()` 输出的 `-I/usr... -lSDL2` 会被 Bash 完美地切成 4 个独立的参数喂给 GCC：

  1. `-I/usr/include/SDL2`
  2. `-D_GNU_SOURCE=1`
  3. `-D_REENTRANT`
  4. `-lSDL2`

- **Fish 的做法（只按换行拆分）**：

  Fish 的设计者认为，按空格拆分经常会导致文件名带有空格时出错（比如 `rm (ls)` 如果遇到 `a b.txt` 会被错误拆成两个文件）。因此，**Fish 规定命令替换的输出只按换行符（Newline）拆分**。

  因为 `pkg-config` 的输出只有单行文字，Fish 就把它当成了一个**完整的、内部带空格的单一字符串参数**。

  在 Fish 眼里，你实际执行的命令等同于：

  `gcc main.c -o main "-I/usr/include/SDL2 -D_GNU_SOURCE=1 -D_REENTRANT -lSDL2"`

  此时，GCC 看到这个长长的、带引号的怪物参数，完全不认识它，直接把它当成无效参数忽略了，因此 `-lSDL2` 也就没有生效。

## 3. 为什么 `eval` 或 `string split` 能解决问题？

既然知道了 Fish 是因为“把一堆参数当成了单个字符串”导致的报错，解决思路就是**强制拆分**。

### 原理 A：`string split`

```
gcc main.c -o main (pkg-config --cflags --libs sdl2 | string split -n " ")
```

这个方法最精准。`| string split -n " "` 是 Fish 内置的字符串处理命令，明确告诉 Fish：“请把前面传过来的长字符串，**遇到空格就切一刀**”。

切完后，单行字符串变成了一个数组（列表），这就成功模拟了 Bash 的默认行为，GCC 拿到了 4 个独立参数。

### 原理 B：`eval`

```
eval gcc main.c -o main (pkg-config --cflags --libs sdl2)
```

`eval` 的工作机制是**二次解析**。

1. Fish 首先把括号里的内容替换成了那个长字符串。
2. 此时整个命令变成了 `eval gcc main.c -o main -I/usr/include... -lSDL2`。
3. 然后 `eval` 把这整行内容当作你在终端里手打的一样，**从头到尾重新按照常规语法解析一遍**。在常规语法中，打在终端上的空格当然是参数分隔符，所以参数被正确分开了。
