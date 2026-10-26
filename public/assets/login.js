(() => {
  const e = new URLSearchParams(location.search).get('e');
  if (!e) return;
  const box = document.getElementById('error');
  box.textContent = e === 'locked'
    ? 'Слишком много неверных попыток. Подожди 15 минут.'
    : 'Неверный логин или пароль.';
  box.hidden = false;
  history.replaceState(null, '', '/login');
})();
