// Forms with class "confirm" ask first, with the question in data-confirm.
document.addEventListener('submit', e => {
  const form = e.target;
  if (form.classList.contains('confirm') && !window.confirm(form.dataset.confirm)) e.preventDefault();
});
