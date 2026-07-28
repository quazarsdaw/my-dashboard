# my dashboard

## постоянные кабинеты школы

`SchoolLearningConfig.cabinets` в `school-teacher-config.js` — единственный
источник постоянных кабинетов. школьный модуль не использует openai api и не
хранит историю chatgpt: dashboard формирует текст урока, открывает внешний
кабинет и детерминированно разбирает итоговый блок.

чтобы безопасно изменить постоянный кабинет:

1. найдите permanent cabinet key в `SchoolLearningConfig.cabinets`;
2. измените только его поле `url`;
3. проверьте `https`, exact hostname и отсутствие username/password в url;
4. не записывайте url в notion, localstorage, supabase или lesson;
5. при следующем изменении config увеличьте cache version
   `school-teacher-config.js?v=2` в `school.html`;
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

для chatgpt допустимы только `chatgpt.com` и `chat.openai.com`. в mvp нет
codex url. для cursor допустимы только `cursor.com` и `www.cursor.com`.
temporary resource не переносится в permanent config.

пустая или некорректная ссылка не блокирует урок: промт можно скопировать
вручную, а интерфейс показывает ключ, который нужно настроить. ссылки являются
обычной публичной frontend-конфигурацией и не должны содержать token, jwt,
service-role key или другие секреты.
