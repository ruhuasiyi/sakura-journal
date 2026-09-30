---
title: Btrfs下配置swapfile并启用休眠
date: 2026-01-05
tags: [ArchLinux, btrfs]
categories: [Linux]
---


## 配置swap

为防止swapfile被拍进快照里，我们需要单独为swapfile建一个子卷

```bash
$ sudo mount /dev/nvme0n1p4 -o subvolid=0 /mnt #挂载父卷
$ sudo btrfs subvolume create /mnt/@swap
```

 创建并启用swapfile

```bash
$ sudo btrfs filesystem mkswapfile --size 16G /mnt/@swap/swapfile
$ sudo chattr +C /mnt/@swap/swapfile #禁用CoW
$ sudo swapon /mnt/@swap/swapfile
```

随后查看`/proc/swaps`，确保成功激活

```bash
$ cat /proc/swaps
Filename                Type        Size        Used        Priority
/mnt/@swap/swapfile                          file        16777212    0        -2
```

编辑`/etc/fstab`，永久启用swapfile

```bash
# 首先将@swap子卷挂载到/swap
UUID=f3e8494a-ff37-4932-9085-e03dce5ab458     /swap        btrfs        subvol=@swap    0 0

# 然后启用swapfile
/swap/swapfile        none        swap        sw    0 0
```

重启系统，再查看`/proc/swaps`，确保swapfile成功启用

#### 配置zswap

在稳定版的官方内核中，zswap被默认启用，有：

```bash
$ cat /sys/module/zswap/parameters/enabled
Y
```

要使用zstd作为默认压缩算法，要启动`zstd`和`zstd_compress`这两个内核模块

```bash
$ sudo vim /etc/mkinitcpio.conf


MODULES=(zstd zstd_compress)
```

随后运行`mkinitcpio`更新initramfs

```bash
$ sudo mkinitcpio -p linux
```

修改内核参数，指定zstd为默认压缩算法

rEFInd引导下，修改`/boot/refind_linux.conf`，添加参数`zswap.compressor=zstd`

重启系统，查看`/sys/module/zswap/parameters/compressor`

```bash
$ cat /sys/module/zswap/parameters/compressor
zstd
```

## 配置并启动休眠

配置**initramfs**，在**udev**钩子后加入**resume**钩子

```bash
$ sudo vim /etc/mkinitcpio.conf


HOOKS=(base udev ... resume)


$ sudo mkinitcpio -p linux
```

在Btrfs下，需要使用`$ sudo btrfs inspect-internal map-swapfile /swap/swapfile -r`获取偏移量

```bash
$ sudo btrfs inspect-internal map-swapfile /swap/swapfile -r
2982144
```

添加内核参数

```bash
resume=UUID=f3e8494a-ff37-4932-9085-e03dce5ab458 resume_offset=2982144 hibernate.compressor=zstd
```

随后重启系统运行`systemctl hibernate`测试休眠是否正常

Gnome下可以安装 [Power Off Options](https://extensions.gnome.org/extension/8189/power-off-options/) 插件来添加休眠按钮

### 参考资料：

- [[内容投稿] 一文说清swap,zram,zswap，交换空间和内存压缩方案](https://bbs.deepin.org.cn/post/270814)

- [电源管理/挂起与休眠](https://wiki.archlinuxcn.org/wiki/%E7%94%B5%E6%BA%90%E7%AE%A1%E7%90%86/%E6%8C%82%E8%B5%B7%E4%B8%8E%E4%BC%91%E7%9C%A0)
