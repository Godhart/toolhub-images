# Исходники и изменения

- ToolHub: https://github.com/Talos-popcorn/toolhub
  commit `61c19ca0d3639545f5e7f8461b8998506a1592f7`.
  Код включён в vendor/toolhub, лицензия AGPL-3.0 сохранена.
  Изменения: Prisma DATABASE_URL вместо фиксированного пути; seed читает пароли
  из окружения и не выводит их; bun.lock пересогласован Bun 1.4.2, поскольку
  исходный lock не проходил frozen install. UI и API не изменены.
- TWYLT Python: https://github.com/Godhart/twylt и https://pypi.org/project/twylt/
  Устанавливается версия 1.0.0 из PyPI.
- TWYLT TypeScript: пользовательский архив twylt-typescript-0.1.0.zip, MIT.
  Не предполагается существование опубликованного npm-пакета @twylt/core.
  Исправлены main/types/exports на dist/src/*, импорт Ajv для NodeNext,
  тип CJS interop ajv-formats и запись x-schema-version через Record.
  Протокол и бизнес-логика не менялись; исходные тесты сохранены.
  Добавлен package-lock.json.
- HDL: пользовательский архив hdl-order-0.7.0-twylt.zip.
  Устанавливается local source package с extra twylt, VUnit 4.7.1.
  Код, тесты и документация сохранены без функциональных изменений.
- Список зависимостей файлового пака взят из filesystem-twylt-pack-0.1.0.zip.
  Сам файловой пак не встроен в образ и подключается с хоста.

При распространении образа соблюдайте лицензии компонентов, в частности AGPL
ToolHub. Соответствующие исходники и контейнерные изменения включены в комплект.
