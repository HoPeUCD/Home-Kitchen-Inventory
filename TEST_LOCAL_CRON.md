# 本地测试 Cron 脚本

## 步骤 1: 启动本地开发服务器

在终端运行：
```bash
npm run dev
```

默认会在 `http://localhost:3000` 启动。

## 步骤 2: 设置环境变量

确保你的 `.env.local` 文件包含：
```
CRON_SECRET=88888888
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SMTP_HOST=your-smtp-host
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=your-email@example.com
```

## 步骤 3: 测试脚本

在新的终端窗口运行：
```bash
./test-cron-local.sh
```

或者：
```bash
bash test-cron-local.sh
```

## 预期输出

### 成功的情况：
```
Testing Weekly Reminder API...
URL: http://localhost:3000/api/cron/weekly-reminder
Secret: 88888888

Making API call...
==========================================
Response Status Code: 200
==========================================
Response Body:
{
  "success": true,
  "message": "Weekly reminder processed",
  "timestamp": "2026-01-09T...",
  "results": [...]
}
==========================================
✅ SUCCESS: Weekly reminder sent successfully
```

### 失败的情况（常见错误）：

1. **连接被拒绝** (Connection refused)
   - 检查开发服务器是否在运行：`npm run dev`
   - 确认端口是 3000

2. **401 Unauthorized**
   - 检查 `CRON_SECRET` 是否匹配
   - 检查 `.env.local` 文件中的值

3. **500 Internal Server Error**
   - 检查其他环境变量（SMTP, SUPABASE_SERVICE_ROLE_KEY）是否正确
   - 查看开发服务器的控制台输出

## 调试技巧

1. **查看详细 curl 输出**：
   编辑 `test-cron-local.sh`，可以看到更详细的 HTTP 请求/响应

2. **手动测试 API**：
   ```bash
   curl -X GET \
     -H "Authorization: Bearer 88888888" \
     -H "Content-Type: application/json" \
     http://localhost:3000/api/cron/weekly-reminder
   ```

3. **检查日志**：
   ```bash
   cat test-weekly-reminder.log
   ```

4. **测试单个功能**：
   如果邮件发送有问题，可以先用 Postman 或 curl 测试 `/api/send-expiry-reminder` 端点
