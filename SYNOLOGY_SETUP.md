# 在 Synology NAS 上设置每周邮件提醒定时任务

## 前置要求

1. 确保你的 Vercel 应用已经部署
2. 在 Vercel 环境变量中配置了 `CRON_SECRET`
3. 你的 Synology NAS 可以通过网络访问你的 Vercel 应用

## 步骤 1: 上传脚本到 Synology NAS

1. 将 `synology-cron.sh` 文件上传到你的 Synology NAS（建议放在 `/volume1/scripts/` 或类似目录）

2. 通过 SSH 连接到你的 NAS，或者使用 File Station 上传文件

## 步骤 2: 配置脚本

编辑 `synology-cron.sh` 文件，更新以下变量：

```bash
YOUR_APP_URL="https://your-app.vercel.app"  # 替换为你的 Vercel 应用 URL
CRON_SECRET="your-cron-secret-here"          # 替换为你在 Vercel 中设置的 CRON_SECRET
```

**获取 CRON_SECRET:**
- 在 Vercel Dashboard 中，进入你的项目
- 进入 Settings → Environment Variables
- 找到 `CRON_SECRET` 变量的值（如果没有，需要先添加一个）

## 步骤 3: 设置脚本权限

通过 SSH 连接到 NAS，执行：

```bash
chmod +x /path/to/synology-cron.sh
```

例如：
```bash
chmod +x /volume1/scripts/synology-cron.sh
```

## 步骤 4: 测试脚本

手动运行一次测试：

```bash
/path/to/synology-cron.sh
```

检查日志文件确认是否成功：
```bash
cat /var/log/weekly-reminder.log
```

## 步骤 5: 设置 Cron 任务（方法 1：使用 Synology 控制面板）

### 通过 DSM 控制面板设置：

1. 登录 DSM（Synology DiskStation Manager）
2. 打开 **控制面板** → **任务计划器**
3. 点击 **新增** → **计划的任务** → **用户定义的脚本**
4. 配置如下：
   - **任务名称**: `Weekly Expiry Reminder`
   - **用户**: `root` 或你的管理员用户
   - **运行**: `自定义脚本`
   - **脚本**: `/volume1/scripts/synology-cron.sh`（你的脚本路径）
   - **运行频率**: 
     - 选择 **每月**
     - **星期**: 选择 **星期日**
     - **时间**: `20:00`（晚上 8 点）

5. 点击 **确定** 保存

## 步骤 5 备选：使用 crontab（方法 2）

如果控制面板设置不工作，可以通过 SSH 使用 crontab：

1. SSH 连接到 NAS
2. 编辑 crontab：
   ```bash
   sudo crontab -e
   ```

3. 添加以下行（每周日晚上 8 点执行）：
   ```bash
   0 20 * * 0 /volume1/scripts/synology-cron.sh
   ```

   Cron 表达式说明：
   - `0` - 分钟（0分）
   - `20` - 小时（20点，即晚上8点）
   - `*` - 每月的每一天
   - `*` - 每个月
   - `0` - 星期几（0 = 星期日）

4. 保存并退出（在 vi 中：按 `Esc`，输入 `:wq`，按 Enter）

5. 验证 crontab：
   ```bash
   sudo crontab -l
   ```

## 步骤 6: 验证和监控

1. 检查日志文件：
   ```bash
   tail -f /var/log/weekly-reminder.log
   ```

2. 如果日志目录不存在，脚本会自动创建。或者手动创建：
   ```bash
   sudo mkdir -p /var/log
   sudo touch /var/log/weekly-reminder.log
   sudo chmod 666 /var/log/weekly-reminder.log
   ```

## 故障排除

### 问题 1: 脚本没有执行
- 检查脚本权限：`ls -l /path/to/synology-cron.sh`
- 检查 cron 服务是否运行
- 查看系统日志：`cat /var/log/synolog/sys.log | grep cron`

### 问题 2: API 调用失败
- 检查网络连接：`curl -I https://your-app.vercel.app`
- 验证 CRON_SECRET 是否正确
- 检查 Vercel 应用是否正常运行
- 查看脚本日志：`cat /var/log/weekly-reminder.log`

### 问题 3: 权限错误
- 确保脚本有执行权限
- 如果使用 crontab，确保使用 `sudo` 运行

## 注意事项

1. **时区问题**: Synology NAS 的时区设置会影响 cron 执行时间。确保 NAS 的时区设置正确。
2. **网络访问**: 确保 NAS 可以访问互联网并连接到你的 Vercel 应用。
3. **安全性**: 
   - 不要将 `CRON_SECRET` 提交到代码仓库
   - 确保脚本文件权限设置合理（只有管理员可读写）
4. **日志轮转**: 定期清理日志文件，避免占用过多空间：
   ```bash
   # 只保留最近 100 行日志
   tail -n 100 /var/log/weekly-reminder.log > /tmp/weekly-reminder.log.tmp
   mv /tmp/weekly-reminder.log.tmp /var/log/weekly-reminder.log
   ```

## 时区调整

如果你需要不同的时区，可以调整 cron 时间。例如，如果 NAS 在 PST（UTC-8），而你想要 UTC 时间晚上 8 点执行：

- UTC 20:00 = PST 12:00（中午）
- 所以 cron 应该设置为：`0 12 * * 0`

或者使用 `TZ` 环境变量在脚本中设置时区：
```bash
export TZ='UTC'
# ... rest of script
```
