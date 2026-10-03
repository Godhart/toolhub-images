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
