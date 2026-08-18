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
├── .venv/              # Python 虚拟环境（部署时自行创建，git 忽略）
└── data/               # 默认数据目录（SQLite 数据库，git 忽略）
```

## 环境要求

- Python 3.11 或更高
- Node.js 18 或更高（含 npm）
- 无需预装数据库——SQLite 随首次启动自动创建

---

## 完整部署步骤（从拉取代码开始）

### 第 1 步：拉取代码

```bash
git clone https://github.com/FDSJK/SmartLabel.git
cd SmartLabel
```

> 克隆下来的目录名为 `SmartLabel`，下文以它为准。

### 第 2 步：创建虚拟环境并安装后端依赖

```bash
# 在仓库根目录（SmartLabel/）下执行
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -e "backend[dev]"
```

- `-e`：以可编辑模式安装本地包 `ling-label-backend`。
- `[dev]`：附带 pytest / httpx 等测试依赖；**生产环境可去掉 `[dev]`**，只装运行依赖。

### 第 3 步：配置环境变量

后端通过环境变量配置（前缀 `LING_`）。**最重要的必做项是 `LING_SECRET_KEY`**——它是给登录令牌（JWT）签名/验签的密钥，默认值公开可见，不修改则他人可伪造登录令牌。

1. **生成一个随机密钥（只生成一次，之后固定复用）**：

   ```bash
   openssl rand -hex 32
   # 例如输出：3f9a2c...（复制这一串）
   ```

2. **设置它**（二选一）：

   - **临时**（当前终端有效）：启动后端前执行

     ```bash
     export LING_SECRET_KEY="<上一步生成的字符串>"
     ```

   - **持久**（推荐）：写入 shell 配置文件 `~/.zshrc` 或 `~/.bashrc`

     ```bash
     echo 'export LING_SECRET_KEY="<上一步生成的字符串>"' >> ~/.zshrc
     source ~/.zshrc
     ```

3. 其他可选变量（需要时再设）：

   ```bash
   export LING_WORK_DIR=/srv/ling-label/data   # 数据库文件位置，默认 ./data
   export LING_ACCESS_TOKEN_EXPIRE_MINUTES=480 # 登录有效期（分钟），默认 480
   ```

> **重要**：目前后端**不读取 `.env` 文件**，只认真正的 shell 环境变量，所以必须用 `export`（或部署脚本、systemd 的 `Environment=`）。
> 另外：密钥一旦确定就**不要每次启动都重新生成**，否则旧登录令牌会全部失效、所有用户被踢下线。

### 第 4 步：启动后端（端口 8080）

```bash
cd backend
../.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080
```

- `--host 0.0.0.0`：允许局域网其他机器访问（仅本机使用可去掉）。
- 开发调试可加 `--reload`（代码改动自动重载，生产勿用）。

首次启动会自动创建 SQLite 数据库（`metadata.db`）并写入默认管理员账号，日志会正常输出无报错即启动成功。

### 第 5 步：安装并启动前端（端口 5173）

另开一个终端：

```bash
cd ../frontend
npm install
npm run dev -- --host 0.0.0.0
```

- `--host 0.0.0.0`：让局域网其他机器能访问前端；仅本机访问可去掉。
- 开发模式下 Vite 会把 `/api` 请求代理到后端 `http://localhost:8080`（见 `frontend/vite.config.ts`）。

浏览器访问：

- 本机：http://localhost:5173
- 局域网其他机器：http://<服务器IP>:5173

### 第 6 步：登录并初始化

1. 用默认管理员账号登录：

   | 用户名 | 密码 |
   | --- | --- |
   | `admin` | `admin` |

2. 登录后**立即修改默认密码**。
3. （可选）在「系统设置」页设置**工作目录**——决定标注数据（批次/图像/标注）落盘位置，见下文「数据目录说明」。

---

## 环境变量参考

后端通过环境变量配置，均带 `LING_` 前缀（定义在 `backend/app/core/config.py`）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LING_WORK_DIR` | `./data` | SQLite 数据库文件 `metadata.db` 所在目录 |
| `LING_SECRET_KEY` | `dev-secret-change-in-production` | JWT 签名密钥，**生产环境务必修改** |
| `LING_ALGORITHM` | `HS256` | JWT 签名算法 |
| `LING_ACCESS_TOKEN_EXPIRE_MINUTES` | `480` | 登录令牌有效期（分钟） |

## 数据目录说明（两个「工作目录」）

系统里有两个容易混淆的「工作目录」概念，部署时要分清：

1. **环境变量 `LING_WORK_DIR`**：决定 **SQLite 数据库文件 `metadata.db`** 放在哪里（后端启动时创建）。
2. **「系统设置」页里的工作目录**：决定**标注数据**（批次、图像、标注 JSON）放在哪里，由管理员在网页界面设置，存于数据库 `settings` 表（`WORK_DIR`），未设置时回退到环境变量 `LING_WORK_DIR`。

> 修改 `LING_WORK_DIR` 相当于「换数据库文件的位置」：如果新目录没有旧数据库，后端会新建一个**空库**（之前的用户、批次都看不到）。要么在首次启动前就设好，要么把旧的 `metadata.db` 一起搬过去。

## 生产 / 局域网部署（反向代理）

开发模式（`npm run dev`）适合调试；正式部署建议把前端构建成静态文件，用 Nginx 统一托管并反代后端。

1. **后端**（去掉 `--reload`）：

   ```bash
   cd backend
   ../.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080
   ```

2. **前端构建**：

   ```bash
   cd frontend
   npm run build    # 产物在 frontend/dist/
   ```

3. **Nginx** 托管静态文件并把 `/api` 转发到后端：

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

   前端请求 `/api` 为相对路径（`frontend/src/api/client.ts`），经同源反代后无需改动前端配置。

> 后端 CORS 当前固定允许 `http://localhost:5173`（`backend/app/main.py`）。经 Nginx 或 Vite 反代时浏览器请求为同源，通常无需改；只有前后端**直接跨源**访问时才需调整 `allow_origins`。

## 运行测试

```bash
# 后端
cd backend && ../.venv/bin/pytest -q

# 前端
cd frontend && npm test
```

## 更多文档

- 用户操作说明：[docs/软件使用指南.md](docs/软件使用指南.md)
