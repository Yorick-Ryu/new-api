# Claude Desktop 一键配置

控制台的一键配置弹窗提供 ChatGPT、Claude Code、Claude 桌面版三个独立选项。桌面版沿用 Claude 分组，模型列表仅保留完整原生 Claude ID；确认后复用符合条件的密钥，必要时创建密钥。

桌面版链接使用 `codexbei://configure/claude-desktop` 与 `preset=claude-desktop-v1`。其余字段为 `base_url`、`api_key`、`model`，网关地址必须为 HTTPS。保留现有用户确认、密钥读取授权和参数验证；真实密钥不写入 DOM、浏览器存储或日志。带密钥的完整链接不得写入截图或记录。

兼容：已发布的 CodexBei 0.1.12 不支持此 route，需要先发布包含桌面接收端的新版本，再部署网站。接收端在未安装 Claude 时显示引导并等待安装，保存时保留已有联网偏好。回滚网站代码可移除新增入口；已创建的用户密钥和本机 profile 不会随网站回滚自动删除。

安全参考：[OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)、[Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。这些是本改动的检查依据，不代表完成整个标准的认证。
