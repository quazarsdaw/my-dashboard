(function (root) {
  'use strict';
  root.IdentityAvatarEditor = {
    mount: function ({ core, store, getPath, getStage, onSaved, message }) {
      var $ = function (id) {
        return document.getElementById(id);
      };
      var dialog = $('avatarDialog'),
        form = $('avatarForm');
      var revision = null,
        preview = null,
        generation = 0,
        disposed = false;
      var fields = {
        skin: 'avatarSkin',
        hair: 'avatarHair',
        hairStyle: 'avatarHairStyle',
        facialHair: 'avatarFacialHair',
        glasses: 'avatarGlasses',
        faceShape: 'avatarFaceShape',
        bodyType: 'avatarBodyType',
        expression: 'avatarExpression',
      };
      var colors = [
        ['topColor', 'avatarTopColor', 'avatarTopAuto', '#748e9d'],
        ['pantsColor', 'avatarPantsColor', 'avatarPantsAuto', '#263343'],
        ['shoesColor', 'avatarShoesColor', 'avatarShoesAuto', '#e8e5db'],
      ];
      function readDraft() {
        var value = {};
        Object.keys(fields).forEach(function (key) {
          value[key] = $(fields[key]).value;
        });
        colors.forEach(function ([key, input, auto]) {
          $(input).disabled = $(auto).checked;
          value[key] = $(auto).checked ? null : $(input).value;
        });
        return core.normalizeAvatar(value);
      }
      function showFallback() {
        $('avatarPreviewFallback').hidden = false;
        $('avatarPreviewFallback').textContent =
          '3D-превью недоступно. Настройки можно сохранить.';
      }
      function updatePreview() {
        if (!dialog.open) return;
        try {
          var draft = readDraft();
          if (preview) preview.setAvatar(draft);
        } catch (err) {
          $('avatarError').textContent = message(err);
          $('avatarError').hidden = false;
        }
      }
      function closePreview() {
        generation++;
        if (preview) preview.dispose();
        preview = null;
      }
      function open() {
        var path = getPath();
        if (!path || disposed) return;
        closePreview();
        revision = path.revision;
        var avatar = core.normalizeAvatar(path.avatar);
        Object.keys(fields).forEach(function (key) {
          $(fields[key]).value = avatar[key];
        });
        colors.forEach(function ([key, input, auto, fallback]) {
          $(auto).checked = avatar[key] === null;
          $(input).value = avatar[key] || fallback;
          $(input).disabled = $(auto).checked;
        });
        $('avatarError').hidden = true;
        $('avatarPreviewFallback').textContent = 'Загружаем 3D…';
        $('avatarPreviewFallback').hidden = false;
        dialog.showModal();
        dialog.scrollTop = 0;
        var current = ++generation,
          stage = getStage();
        import('./path-avatar-preview.js?v=3')
          .then(function (mod) {
            if (disposed || generation !== current || !dialog.open) return;
            preview = mod.createAvatarPreview($('avatarPreview'), {
              ...stage,
              avatar: readDraft(),
            });
            $('avatarPreviewFallback').hidden = true;
          })
          .catch(function () {
            if (!disposed && generation === current && dialog.open)
              showFallback();
          });
      }
      function close() {
        dialog.close();
      }
      function submit(e) {
        e.preventDefault();
        try {
          var draft = readDraft();
          var saved = store.update(revision, function (path) {
            return core.updateAvatar(path, draft);
          });
          dialog.close();
          onSaved(saved);
        } catch (err) {
          $('avatarError').textContent = message(err);
          $('avatarError').hidden = false;
          $('avatarError').scrollIntoView({ block: 'nearest' });
        }
      }
      $('editAvatar').addEventListener('click', open);
      $('cancelAvatar').addEventListener('click', close);
      $('closeAvatar').addEventListener('click', close);
      dialog.addEventListener('close', closePreview);
      form.addEventListener('input', updatePreview);
      form.addEventListener('change', updatePreview);
      form.addEventListener('submit', submit);
      $('avatarPreview').addEventListener(
        'avatar-preview-unavailable',
        showFallback,
      );
      return {
        dispose: function () {
          disposed = true;
          closePreview();
          $('editAvatar').removeEventListener('click', open);
          $('cancelAvatar').removeEventListener('click', close);
          $('closeAvatar').removeEventListener('click', close);
          dialog.removeEventListener('close', closePreview);
          form.removeEventListener('input', updatePreview);
          form.removeEventListener('change', updatePreview);
          form.removeEventListener('submit', submit);
          $('avatarPreview').removeEventListener(
            'avatar-preview-unavailable',
            showFallback,
          );
        },
      };
    },
  };
})(window);
