---
title: 使用 Vaultwarden 自建 Bitwarden 服务端
date: 2026-01-09
tags: [Bitwarden, 服务器]
categories: [运维]
---


bitwarden是一个自由开源、跨平台的密码管理器，且提供浏览器插件，支持自动填充、totp、passkey等功能。

## 服务端选择

Vaultwarden 是一个基于Rust开发的**轻量级** Bitwarden 服务端，支持MFA、多用户、多设备同步等。

## 使用 Docker Compose 构建

```bash
$ mkdir vaultwarden && cd vaultwarden
$ vim compose.yml

services:
  vaultwarden:
    image: vaultwarden/server:1.35.1 # 显式指定版本号，防止使用latest拉取到n年前的版本
    container_name: vaultwarden
    restart: always
    environment:
      DOMAIN: "https://example.com" # 使用反向代理时必填；您的域名；Vaultwarden 需要知道它是 https 才能正确处理附件
      SIGNUPS_ALLOWED: "true" # 创建账户后，使用 "false" 停用此选项，这样就不会有陌生人注册了

    volumes:
      - ./vw-data:/data # : 前面的路径可以修改
    ports:
      - 1145:80 # 您可以将 1145 替换为您喜欢的端口



$ sudo docker compose up -d
```

### 使用nginx反代

先在`/etc/nginx/sites-available`创建一个`.conf`配置文件

```bash
$ sudo vim /etc/nginx/sites-available/example.conf

# 默认服务器块 - 拒绝所有其他访问
server {
    listen 1146 ssl default_server; # 1146改为外网访问使用的端口
    listen [::]:1146 ssl default_server; # 1146改为外网访问使用的端口

    ssl_certificate /path/to/cert.pem; # ssl证书公钥
    ssl_certificate_key /path/to/private.key; # ssl证书私钥

    # 默认拒绝所有请求
    return 403;
}

# vaultwarden 专用服务器块
server {
    listen 1146 ssl; # 1146改为外网访问使用的端口
    server_name example.com; # 保持与compose.yml里设置的一致

    ssl_certificate /path/to/cert.pem; # ssl证书公钥
    ssl_certificate_key /path/to/private.key; # ssl证书私钥

    # SSL 配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # 安全头
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";

    # 反向代理配置
    location / {
        proxy_pass http://127.0.0.1:1145; # 1145改为vaultwarden的端口
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 限制只允许特定域名访问
        if ($host != 'example.com') { # 保持与compose.yml里设置的一致
            return 403;
        }
    }
}
```

软链接到`/etc/nginx/sites-enabled/`启用配置文件

```bash
$ sudo ln -s /etc/nginx/sites-available/example.conf /etc/nginx/sites-enabled/example.com.conf
```

检查并重载nginx

```bash
$ sudo nginx -t


nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful


$sudo nginx -s reload
```

随后访问`https://example.com:1146`检查是否正常运行


