// A simple cartoon figure on a transparent background, for trying the tool
// without an image at hand.
export function drawDemoFigure() {
  const c = document.createElement('canvas');
  c.width = 600;
  c.height = 800;
  const g = c.getContext('2d');

  // Each draw callback is filled as its own path so shapes don't get joined.
  const blob = (color, ...draws) => {
    g.fillStyle = color;
    for (const draw of draws) { g.beginPath(); draw(); g.fill(); }
  };
  const rounded = (x, y, w, h, r) => g.roundRect(x, y, w, h, r);

  // Legs and shoes
  blob('#2f3e66', () => rounded(210, 520, 70, 200, 30), () => rounded(320, 520, 70, 200, 30));
  blob('#5b3a29', () => g.ellipse(235, 720, 60, 32, 0, 0, Math.PI * 2), () => g.ellipse(365, 720, 60, 32, 0, 0, Math.PI * 2));
  // Arms
  blob('#f2c9a0', () => g.arc(115, 470, 38, 0, Math.PI * 2), () => g.arc(485, 470, 38, 0, Math.PI * 2));
  blob('#e4572e', () => {
    g.save(); g.translate(165, 380); g.rotate(0.45); rounded(-35, -30, 70, 150, 35); g.restore();
    g.save(); g.translate(435, 380); g.rotate(-0.45); rounded(-35, -30, 70, 150, 35); g.restore();
  });
  // Body
  blob('#e4572e', () => rounded(170, 300, 260, 270, 90));
  blob('#ffc857', () => g.arc(300, 420, 34, 0, Math.PI * 2));
  // Head
  blob('#f2c9a0', () => g.arc(300, 190, 130, 0, Math.PI * 2));
  blob('#3b2a20', () => { g.arc(300, 150, 120, Math.PI * 1.05, Math.PI * 1.95); g.closePath(); });
  // Face
  blob('#ffffff', () => g.ellipse(255, 200, 24, 30, 0, 0, Math.PI * 2), () => g.ellipse(345, 200, 24, 30, 0, 0, Math.PI * 2));
  blob('#1d1d1d', () => g.arc(258, 206, 12, 0, Math.PI * 2), () => g.arc(342, 206, 12, 0, Math.PI * 2));
  g.strokeStyle = '#7a3b2e';
  g.lineWidth = 8;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(300, 245, 40, 0.2 * Math.PI, 0.8 * Math.PI);
  g.stroke();
  return c;
}
