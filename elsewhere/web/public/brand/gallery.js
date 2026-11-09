// Keep gallery controls compatible with the application's same-origin script policy.
const video = document.getElementById('ident');
const button = document.getElementById('replay');
button.addEventListener('click', async () => {
  video.currentTime = 0;
  try {
    await video.play();
  } catch {
    video.controls = true;
  }
});
video.addEventListener('play', () => (button.textContent = 'Replay ident ↗'));
video.addEventListener('ended', () => (button.textContent = 'Play it again ↗'));
