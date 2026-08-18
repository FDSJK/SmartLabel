# 灵标（Ling Label）

在线图像分割标注工具。前后端分离：后端 FastAPI 提供 REST API 与标注数据落盘，前端 React + Vite 提供标注编辑器界面。

## 技术栈

| 端 | 技术 |
| --- | --- |
| 后端 | Python 3.11+ / FastAPI / SQLAlchemy / SQLite / Pydantic v2 |
| 前端 | Node 18+ / React 18 / TypeScript / Vite / Zustand / react-konva / recharts |

## 目录结构

```
ling-auto-label/
├── backend/            # FastAPI 后端（app/ 包 + pyproject.toml + 测试）
├── frontend/           # React + Vite 前端
├── docs/               # 使用指南、设计文档
├── .venv/              # Python 虚拟环境（需自行创建）
└── data/               # 默认数据目录（SQLite 数据库；已被 .gitignore 忽略）
```

## 环境要求

- Python 3.11 或更高
- Node.js 18 或更高（含 npm）
- 无需预装数据库——SQLite 随数据目录自动创建

## 本地启动

### 1. 安装后端依赖

在仓库根目录创建虚拟环境并安装：

```bash
python3 -m venv .venv
.venv/bin/pip install -e "backend[dev]"
```

> `[dev]` 附带 pytest / httpx 等测试依赖；仅运行可去掉 `[dev]`。

### 2. 启动后端（端口 8080）

```bash
cd backend
../.venv/bin/uvicorn app.main:app --reload --port 8080
```

首次启动会自动创建 SQLite 数据库并写入默认管理员账号。

### 3. 启动前端（端口 5173）

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 **http://localhost:5173**。

开发模式下 Vite 会把 `/api` 请求代理到 `http://localhost:8080`（见 `frontend/vite.config.ts`）。

### 4. 登录

默认管理员账号（后端首次启动时自动创建）：

| 用户名 | 密码 |
| --- | --- |
| `admin` | `admin` |

> 生产环境请登录后立即修改默认密码。

## 环境变量

后端通过环境变量配置，均带 `LING_` 前缀（见 `backend/app/core/config.py`）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LING_WORK_DIR` | `./data` | SQLite 数据库文件 `metadata.db` 所在目录 |
| `LING_SECRET_KEY` | `dev-secret-change-in-production` | JWT 签名密钥，**生产环境务必修改** |
| `LING_ALGORITHM` | `HS256` | JWT 签名算法 |
| `LING_ACCESS_TOKEN_EXPIRE_MINUTES` | `480` | 登录令牌有效期（分钟） |

示例：

```bash
export LING_WORK_DIR=/srv/ling-label/data
export LING_SECRET_KEY="$(openssl rand -hex 32)"
```

## 数据目录说明（两个「工作目录」）

系统里有两个容易混淆的「工作目录」概念，部署时要分清：

1. **环境变量 `LING_WORK_DIR`**：决定 **SQLite 数据库文件 `metadata.db`** 放在哪里（后端启动时创建）。
2. **「系统设置」页里的工作目录**：决定**标注数据**（批次、图像、标注 JSON）放在哪里，由管理员在网页界面设置，存于数据库 `settings` 表（`WORK_DIR`），未设置时回退到环境变量 `LING_WORK_DIR`。

## 局域网 / 生产部署

### 方式一：反向代理（推荐）

1. **后端**（去掉 `--reload`，监听所有网卡）：

   ```bash
   cd backend
   ../.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080
   ```

2. **前端**构建出静态文件：

   ```bash
   cd frontend
   npm run build    # 产物在 frontend/dist/
   ```

3. 用 Nginx 等反向代理同时托管前端静态文件，并把 `/api` 转发到后端：

   ```nginx
   server {
       listen 80;
       server_name _;

       root /path/to/frontend/dist;
       index index.html;

       location / { try_files $uri $uri/ /index.html; }

       location /api/ {
           proxy_pass http://127.0.0.1:8080;
           proxy_set_header Host $host;
       }
   }
   ```

   前端请求 `/api` 为相对路径（见 `frontend/src/api/client.ts`），经同源反代后无需改动前端配置。

### 方式二：开发模式直接暴露（临时/小团队）

```bash
# 后端
cd backend && ../.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080

# 前端（--host 使局域网可访问）
cd frontend && npm run dev -- --host 0.0.0.0
```

局域网用户访问 `http://<服务器IP>:5173`。

> 注意：后端 CORS 当前固定允许 `http://localhost:5173`（`backend/app/main.py`）。若前后端不同源访问，需相应调整 `allow_origins`。

## 运行测试

```bash
# 后端
cd backend && ../.venv/bin/pytest -q

# 前端
cd frontend && npm test
```

## 更多文档

- 用户操作说明：[docs/软件使用指南.md](docs/软件使用指南.md)
