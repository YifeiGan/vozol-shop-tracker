# VOZOL Orlando Shop Tracker

Orlando 门店拜访清单。前端是 Vite + React，登录和数据在 **Firebase**（Google）：Authentication + Firestore。

## 本地启动
1. 安装 Node.js 18+
2. 在项目目录运行 `npm install`
3. 复制 `.env.example` 为 `.env`
4. 填入 Firebase 网页应用配置（见下方）
5. 运行 `npm run dev`，打开 `http://localhost:5173`

## Firebase 配置
1. 打开 [Firebase Console](https://console.firebase.google.com/) 新建项目
2. 添加一个 **Web** 应用，把配置填进 `.env`：
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
3. Authentication → Sign-in method 打开 **Google**，以及可选的 **Email/Password**
4. 创建 Firestore 数据库（生产模式即可）
5. Firestore → 规则，粘贴本仓库 `firestore.rules` 后发布  
   或在已登录 Firebase CLI 后执行 `npx firebase deploy --only firestore:rules`

首次用 Google 登录会自动创建 `sales` 档案。若要变成经理，到 Firestore 的 `profiles/{你的uid}`，把 `role` 改成 `manager`。

## V1 已实现
- Google 登录（可选邮箱/密码）
- Sales / Manager 角色（权限由 Firestore 规则保证）
- 云端门店读取、新建、修改
- Manager 可查看团队门店和分配负责人
- 门店下 visits 子集合写入拜访记录
- 门店详情默认最近 3 次，可展开最近 10 次
- Excel 导出入口预留

## 部署成网站（Firebase Hosting）
1. 确认本地 `.env` 已填好（构建时会写进网站）
2. 登录 Firebase CLI（首次）：
   ```bash
   npx firebase-tools login
   ```
3. 一键构建并发布：
   ```bash
   npm run deploy
   ```
4. 完成后终端会给出网址，类似：
   `https://vozol-orlando-management.web.app`
5. 到 Authentication → Settings → **Authorized domains**，确认已有该域名（一般会自动加入）

以后改代码再部署，重复第 3 步即可。

## 注意
不要把 Firebase **Admin / service account** 私钥写入 `.env` 或任何前端文件。前端只使用网页应用配置。
