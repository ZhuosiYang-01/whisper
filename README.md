# 纸条

一个给两个人使用的延迟送达文字 PWA。当前仓库包含可运行的 Next.js 前端、本地演示数据，以及 Supabase 数据库、RLS、Cron 和 Edge Function 基础。

## 本地运行

```bash
npm install
copy .env.example .env.local
npm run dev
```

未配置环境变量时，页面使用本地预览数据。配置后，用户可以只用全局唯一用户名注册或登录。

## Supabase 配置

1. 新建 Supabase 项目，在 Authentication 设置中启用邮箱登录并关闭邮箱确认。界面不会收集真实邮箱或密码，应用会在内部把用户名映射为登录凭据。
2. 安装 Supabase CLI，执行 `supabase link --project-ref <project-ref>` 与 `supabase db push`。
3. 部署函数：`supabase functions deploy deliver-notes --no-verify-jwt`。
4. 生成 VAPID 密钥，将 `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT` 和高熵 `CRON_SECRET` 写入 Edge Function secrets。Service Role Key 由 Supabase 托管运行时提供，不放入前端环境文件。
5. 在 Vault 中创建 `project_url` 与相同的 `cron_secret`，再执行第二条 migration 中的 `cron.schedule`。该任务每分钟领取到期纸条。
6. 将项目 URL、Publishable Key 或旧版 anon key、VAPID Public Key 写入 `.env.local`，再部署到支持 HTTPS 的平台。

需要用户提供的内容只有：Supabase Project URL、前端可公开的 Publishable/anon Key、VAPID Public Key，以及在 Supabase 后台设置的 VAPID Private Key、VAPID Subject、Cron Secret。不要把 Service Role Key 或 VAPID Private Key 写进 Next.js 环境变量。

## 安全边界

- 浏览器不能直接读取自己发送的纸条，也不能读取尚未打开的正文。
- `pending_note_count()` 只返回数量，`unread_note_index()` 只返回到达日期与 ID，`open_note()` 才返回正文并原子标记为已打开。
- `seal_note()` 在数据库内解析同空间的另一个成员并计算送达时间，客户端不能指定收件人或精确随机结果。
- 对正文、参与者、空间和送达规则的更新由触发器拒绝。
- 一次性邀请只保存 token 的 SHA-256 摘要，并在事务中锁定后消费；一个用户只能属于一个空间，一个空间在接受邀请时强制限两人。

## PWA 与通知

`public/sw.js` 提供基础离线壳和固定通知文案。iPhone 上需用 Safari 添加到主屏幕后，再从已安装的 PWA 内授权通知。生产接入还需用 `pushManager.subscribe()` 将订阅写入 `push_subscriptions`，前端界面已保留通知授权入口。

## Cloudflare Pages 部署

在 Cloudflare Pages 中连接本仓库，使用以下构建设置：

- 生产分支：`main`
- 框架预设：`Next.js (Static HTML Export)`
- 构建命令：`npm run build`
- 构建输出目录：`out`

在 Pages 项目的环境变量中配置 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY`。它们会在构建时写入前端产物，不要配置 Service Role Key 或其他私密密钥。
