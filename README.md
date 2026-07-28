# my dashboard

## постоянные кабинеты школы

пользователь настраивает шесть предметных ChatGPT-кабинетов через шестерёнку
на странице `school.html`. настройки синхронизируются между устройствами
текущего аккаунта одной строкой `public.user_data` с ключом
`school_cabinet_urls_v1`.

источники применяются в таком порядке:

1. валидный аккаунтный override из `public.user_data`;
2. статический url из `SchoolLearningConfig.cabinets` в
   `school-teacher-config.js`;
3. режим копирования промта без автоматического открытия кабинета.

пустое поле в настройках удаляет только аккаунтный override и возвращает
статический fallback. исходный `SchoolLearningConfig` во время работы не
изменяется.

dashboard не использует openai api и не хранит историю chatgpt: он формирует
текст урока, безопасно открывает внешний кабинет и детерминированно разбирает
итоговый блок. настройки кабинетов не меняют Notion, маршрут урока или его
содержимое.

для предметных кабинетов допустимы только абсолютные HTTPS-ссылки с exact
hostname `chatgpt.com` или `chat.openai.com`, без username/password и длиной
не более 2048 Unicode code points. query и fragment сохраняются, но приложение
никогда не добавляет в них промт или сведения урока.

локальный cache имеет user-scoped ключ
`school_cabinet_urls_cache_v1:<auth user id>`, не является источником истины и
исключён из общего localStorage-sync. неизвестная версия, неизвестный cabinet
id и повреждённый JSON не применяются.

доступ к `public.user_data` разрешён только роли `authenticated` и только к
строкам, где `auth.uid() = user_id`. роль `anon` не должна иметь прямых CRUD
прав; select, insert, update и delete защищены отдельными ownership policies.

чтобы безопасно изменить статический fallback:

1. найдите permanent cabinet key в `SchoolLearningConfig.cabinets`;
2. измените только его поле `url`;
3. проверьте HTTPS, exact hostname и отсутствие username/password в url;
4. не добавляйте token, jwt, service-role key или другие секреты;
5. увеличьте cache version `school-teacher-config.js` в `school.html`;
6. откройте один урок и проверьте cabinet, teacher и format;
7. подтвердите, что `LESSON_REF` и import result не изменились.

пример permanent кабинета:

```javascript
'chatgpt-software': {
  label: 'ChatGPT · Software Engineering',
  platform: 'ChatGPT',
  kind: 'permanent',
  url: 'https://chatgpt.com/g/example'
}
```

в mvp нет аккаунтных настроек для Codex, Cursor, Kimi, YouTube, книг, PDF или
документации. temporary resource не переносится в permanent config.

пустая или некорректная ссылка не блокирует урок: промт можно скопировать
вручную, а интерфейс показывает, какой кабинет нужно настроить. ссылки не
считаются секретами, но не должны содержать учётные данные или служебные ключи.
