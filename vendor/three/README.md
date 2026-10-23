# three.js 0.180.0

локальные browser es modules из официального npm-пакета `three@0.180.0`.
исходный пакет: https://registry.npmjs.org/three/-/three-0.180.0.tgz
sha1 архива: `b930cabfb524f6d36bf63e874b4d866888b50487`.
лицензия mit сохранена в `LICENSE`.

`path-scene.js` импортирует только `three.module.min.js`; он импортирует
`three.core.min.js` относительным путём. runtime-загрузка с cdn не требуется.
