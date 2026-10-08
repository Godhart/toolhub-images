# 0.5.0 — 2026-10-08

- Rebase guardrails integration on GitHub toolhub-images HEAD 622895c714225cec07e55260502fe238a70555db (0.4.0).
- Preserve GitHub source stage, no vendor, all image targets, domain/config-loader and MCP bridge.
- Pin GitHub TWYLT 1.1.0 and essential 0.2.0; install the shared essential Python module.
- Enable cooperative policy defaults; support nested runner cwd separately from business workspace.
- Map domain network policy to TWYLT_DISABLE_NETWORK; retain Docker/network controls.
- Install HDL backend without its legacy TWYLT extra; use managed TWYLT.
- Prevent dependency downgrade to TWYLT 1.0.0 in image and host domain environment.
- Add domain/transport tests and extend essential image smoke.

# 0.4.0

- Target essential: GitHub requirements и iputils-ping; build.sh и worker примера.

- Domain/worker network defaults и overrides; внутренний router traffic сохраняется.

- Domain YAML → toolsets, toolpacks, worker/router configs, env и Compose.
- Встроен toolhub-config-loader 0.1.0 и исправление идентичности REMOTE ToolHub.
- Python Docker SDK в base; target docker и настройка socket/workspace.
- Отдельный GitHub-based MCP bridge, управляемый генератором domain.
- build.sh собирает образы отдельно; Compose не содержит build.
- Валидация, staging/rollback, блокировка генерации, сохранение баз, тесты.
- Worker MCP и интеграция docsanity отложены.

# 0.3.0

- Удалён vendor/; проекты загружаются из GitHub по sources.lock.json.
- Имена сверены с каноническим RESOURCES.md.
- Target docsanity, alias okf; новый compose.docsanity.yaml.
- TWYLT TypeScript обновлён до upstream 0.2.3, локальные исправления удалены.
- Requirements файлового пака читаются из twylt-pack-filesystem 0.5.0 на GitHub.
- Сохранены интеграционные скрипты, тесты, прежние volumes и интерфейсы.

# 0.2.0

- Новый отдельный образ target okf поверх docs.
- OKF Workspace 0.2.0 + @copperbox/okf-mcp 2.1.0.
- TWYLT-адаптер okf_workspace, 25 операций OKF и 2 режима discovery.
- Отдельный bind mount /okf-state; явные init/export.
- Compose override, инструкции, пример конфигурации и сквозные тесты.
- Сохранены прежние четыре target и их тесты.
