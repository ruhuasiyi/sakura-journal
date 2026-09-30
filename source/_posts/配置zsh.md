---
title: 配置zsh
cover: /images/cover/cover-1.avif
date: 2026-01-05
tags: [ArchLinux]
categories: [Linux]
---


原先使用的shell是`fish`，虽然开箱即用方便，但是posix兼容性差于zsh，且配置灵活度不如zsh，遂决定改用zsh

## 安装zsh和oh-my-zsh并启用

```bash
sudo pacman -S zsh zsh-completions 
chsh -s /bin/zsh #设置zsh为默认shell
```

### 安装oh-my-zsh

这里用pacman安装，需要添加**archlinuxcn**源

```bash
sudo pacman -Ss oh-my-zsh-git
cp /usr/share/oh-my-zsh/zshrc ~/.zshrc
source ~/.zshrc
```

为了在root账户上使用oh-my-zsh，可以

```bash
sudo ln -s ~/.zshrc /root/.zshrc
```

## 终端配置

### 主题

根据 [What's the best theme for Oh My Zsh?](https://www.slant.co/topics/7553/~theme-for-oh-my-zsh) ,我选择 Powerlevel10k 主题

```bash
git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k
```

修改 `~/.zshrc`

```bash
ZSH_THEME="powerlevel10k/powerlevel10k"
```

再重新加载.zshrc，按提示配置主题，不满意可运行以下命令重新配置

```bash
p10k configure
```

### 插件

安装方式：在 `~/.zshrc` 的plugin中添加相应插件，如：

```bash
plugins=(git
        python
        z
        copypath
        extract
        zsh-autosuggestions
        zsh-syntax-highlighting
        )
```

仅介绍自用插件，更多内置插件请查看 [ohmyzsh/ohmyzsh/wiki/Plugins](https://github.com/ohmyzsh/ohmyzsh/wiki/Plugins) ,外置插件可前往 [awesome-zsh-plugins](https://github.com/unixorn/awesome-zsh-plugins) 寻找

#### 1. zsh-autosuggestions

这是一个fish-like的推测、命令补全插件

安装方式：丢到 `/usr/share/oh-my-zsh/custom/plugins` 中

```bash
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
```

#### 2. zsh-syntax-highlighting

这是一个fish-like的语法高亮插件

安装方式同上，丢到 `/usr/share/oh-my-zsh/custom/plugins` 中

```bash
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
```

#### 3. 其他内置插件

- **python**插件给`python`命令一个`py`的别名，方便运行python脚本

- **z**是一个类似`cd`的目录跳转插件，配合tab补全可以模糊模糊跳转最近使用过的目录

- **copypath**用于复制文件路径

- **extract**用于解压任何压缩包，命令为`x`
