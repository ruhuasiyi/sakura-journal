---
title: 记一次将ext4迁移到btrfs并开启透明压缩
date: 2026-01-04
tags: [ArchLinux, btrfs]
categories: [Linux]
---


想更换桌面环境，苦于ext4的快照不够方便、优雅，遂折腾转为btrfs

## 使用`btrfs-convert`转换

确保磁盘有一定的空间，进入到livecd

首先检查磁盘问题，防止带着问题上战场。

```bash
fsck.ext4 /dev/nvme0n1p4
```

随后双手合十，祈求执行以下命令转换。

```bash
btrfs-convert /dev/nvme0n1p4
```

在转换途中会在目标分区中生成快照，如果报错执行以下命令回滚。

```bash
btrfs-convert -r /dev/nvme0n1p4
```


## 重建初始化内存盘

挂载磁盘、**chroot**并重建**initramfs**：

```bash
mount /dev/nvme0n1p4 /mnt
arch-chroot /mnt
mkinitcpio --preset linux
```

## 启动透明压缩

启动透明压缩前保证磁盘有足够的空间，否则先保证可以正常进入系统后删除快照：

```bash
btrfs subvolume delete /mnt/ext2_saved
```

启动透明压缩（需要较长时间）：

```bash
btrfs filesystem defragment -r -v -czstd /mnt
```

## 创建子卷（subvolume）

创建子卷并迁移数据

```bash
btrfs subvolume create /mnt/@
btrfs subvolume create /mnt/@home
btrfs subvolume create /mnt/@var
btrfs subvolume create /mnt/@usr_local
btrfs subvolume create /mnt/@opt
btrfs subvolume create /mnt/@snapshots
btrfs subvolume set-default /mnt/@
mkdir /mnt/.snapshots
mv /mnt/home/* /mnt/@home/
...
```

挂载子卷并创建fstab

```bash
# 先卸载已挂载的分区
umount /mnt

# 分别挂载
mount /dev/nvme0n1p4 -o subvolume=@,compress=zstd /mnt
mount /dev/nvme0n1p4 -o subvolume=@home,compress=zstd /mnt/home
mount /dev/nvme0n1p4 -o subvolume=@var,compress=zstd /mnt/var
mount /dev/nvme0n1p4 -o subvolume=@usr_local,compress=zstd /mnt/usr/local
mount /dev/nvme0n1p4 -o subvolume=@opt,compress=zstd /mnt/opt
mount /dev/nvme0n1p4 -o subvolume=@snapshots,compress=zstd /mnt/.snapshots
mount /dev/nvme0n1p1 /mnt/boot/efi

# 创建fstab
genfstab -U /mnt > /mnt/etc/fstab
```

检查`/etc/fstab`，将根分区调整为**rw**，将快照的压缩去除

```bash
# /dev/nvme0n1p4
UUID=f3e8494a-ff37-4932-9085-e03dce5ab458    /             btrfs         rw,relatime,compress=zstd:3,ssd,discard=async,space_cache=v2,subvol=/@    0 0

# /dev/nvme0n1p4
UUID=f3e8494a-ff37-4932-9085-e03dce5ab458    /home         btrfs         rw,relatime,compress=zstd:3,ssd,discard=async,space_cache=v2,subvol=/@home    0 0

# /dev/nvme0n1p4
UUID=f3e8494a-ff37-4932-9085-e03dce5ab458    /opt          btrfs         rw,relatime,compress=zstd:3,ssd,discard=async,space_cache=v2,subvol=/@opt    0 0

# /dev/nvme0n1p4
UUID=f3e8494a-ff37-4932-9085-e03dce5ab458    /usr/local    btrfs         rw,relatime,compress=zstd:3,ssd,discard=async,space_cache=v2,subvol=/@usr_local    0 0

# /dev/nvme0n1p4
UUID=f3e8494a-ff37-4932-9085-e03dce5ab458    /var          btrfs         rw,relatime,compress=zstd:3,ssd,discard=async,space_cache=v2,subvol=/@var    0 0

# /dev/nvme0n1p4
UUID=f3e8494a-ff37-4932-9085-e03dce5ab458    /.snapshots    btrfs         rw,relatime,compress=zstd:3,ssd,discard=async,space_cache=v2,subvol=/@snapshots    0 0

# /dev/nvme0n1p1
UUID=C4EE-5413          /boot/efi     vfat          rw,relatime,fmask=0022,dmask=0022,codepage=437,iocharset=ascii,shortname=mixed,utf8,errors=remount-ro    0 2
```

## 更新引导

rEFInd下：

修改`/mnt/boot/refind_linux.conf`

```bash
"Boot with standard options"  "root=UUID=f3e8494a-ff37-4932-9085-e03dce5ab458 rootflags=subvol=@ rootfstype=btrfs rw quiet splash loglevel=3 nvidia-drm.modeset=1 nvidia-drm.fbdev=1"
"Boot to single-user mode"    "root=UUID=f3e8494a-ff37-4932-9085-e03dce5ab458 rootflags=subvol=@ rootfstype=btrfs rw quiet splash loglevel=3 nvidia-drm.modeset=1 nvidia-drm.fbdev=1 single"
"Boot with minimal options"   "ro root=/dev/nvme0n1p4"
```

## 通过balance回收数据

引导进入系统后终端执行以下命令（需要较长一段时间）

```bash
btrfs balance start /
```

## 其他

### 禁用var目录的CoW

```bash
chattr +C /mnt/var
```
